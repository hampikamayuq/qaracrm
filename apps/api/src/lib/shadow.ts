import type { AiClient } from './ai-client';
import type { DataApi } from './data';
import { runTawany } from '../logic-functions/tawany-handler';

export type ShadowMode = 'shadow' | 'human_approval' | 'autopilot';
export type ProcessedShadowMessage = { conversationId: string; messageId: string };

type FetchLike = (
  input: string,
  init: { method: 'POST'; headers: Record<string, string>; body: Buffer },
) => Promise<unknown>;

const VALID_MODES = new Set<ShadowMode>(['shadow', 'human_approval', 'autopilot']);

export const getShadowMode = (): ShadowMode => {
  const mode = process.env.SHADOW_MODE ?? 'shadow';
  if (!VALID_MODES.has(mode as ShadowMode)) throw new Error(`Invalid SHADOW_MODE: ${mode}`);
  return mode as ShadowMode;
};

export const isShadowMode = (): boolean => getShadowMode() === 'shadow';
export const isHumanApprovalMode = (): boolean => getShadowMode() === 'human_approval';
export const isAutopilotMode = (): boolean => getShadowMode() === 'autopilot';

export const forwardWebhookToTwenty = async (
  params: {
    rawBody: Buffer;
    signature?: string;
    url?: string;
    fetchImpl?: FetchLike;
  },
): Promise<boolean> => {
  const url = params.url ?? process.env.TWENTY_FORWARD_URL;
  if (!url) return false;

  const fetchImpl = params.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': params.signature ?? '',
    },
    body: params.rawBody,
  });
  return true;
};

export const recordShadowRun = async (
  data: DataApi,
  params: {
    conversationId: string;
    messageId: string;
    tawanyReply: string;
    twentyReply: string;
    tawanyToolCalls: number;
    match: boolean;
  },
): Promise<void> => {
  try {
    await data.create('activity', {
      targetType: 'conversation',
      targetId: params.conversationId,
      conversationId: params.conversationId,
      body: JSON.stringify({
        type: 'shadow_run',
        messageId: params.messageId,
        tawanyReply: params.tawanyReply.slice(0, 500),
        twentyReply: params.twentyReply.slice(0, 500),
        tawanyToolCalls: params.tawanyToolCalls,
        match: params.match,
      }),
    });
  } catch (error) {
    console.error('[shadow] failed to record:', (error as Error).message);
  }
};

export const runShadowForProcessedMessages = async (
  messages: ProcessedShadowMessage[],
  deps: { createAi: () => AiClient; data: DataApi },
): Promise<void> => {
  if (!isShadowMode() || messages.length === 0) return;

  const ai = deps.createAi();
  await Promise.all(messages.map(async (message) => {
    const result = await runTawany({
      messageId: message.messageId,
      conversationId: message.conversationId,
    }, { ai, data: deps.data });
    await recordShadowRun(deps.data, {
      conversationId: message.conversationId,
      messageId: message.messageId,
      tawanyReply: result.content,
      twentyReply: '',
      tawanyToolCalls: result.toolCalls,
      match: false,
    });
  }));
};
