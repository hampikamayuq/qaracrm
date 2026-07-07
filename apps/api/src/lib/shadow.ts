import type { AiClient } from './ai-client';
import type { DataApi } from './data';
import { runTawanyHandler, type TawanySendMode } from '../logic-functions/tawany-handler';

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

// SHADOW_MODE → modo de envio da Tawany:
//   shadow         → 'test'         (observação pura: sugestão TEST_SENT, nunca envia)
//   human_approval → 'suggest_only' (sugestão PENDING; aprovação humana envia via /api/tawany/approve)
//   autopilot      → 'send'         (envia e marca SENT)
const SEND_MODE_BY_SHADOW_MODE: Record<ShadowMode, TawanySendMode> = {
  shadow: 'test',
  human_approval: 'suggest_only',
  autopilot: 'send',
};

// Roda a Tawany para as mensagens processadas pelo webhook, em TODOS os modos.
// Sempre via runTawanyHandler para aplicar os gates de entrada (conversa
// fechada/needsHuman, opt-out, prompt-injection) antes de qualquer chamada de IA.
export const runTawanyForProcessedMessages = async (
  messages: ProcessedShadowMessage[],
  deps: { createAi: () => AiClient; data: DataApi },
): Promise<void> => {
  if (messages.length === 0) return;
  const mode = getShadowMode();
  const sendMode = SEND_MODE_BY_SHADOW_MODE[mode];

  let ai: AiClient | undefined;
  try {
    ai = deps.createAi();
  } catch {
    // sem OPENROUTER_API_KEY: runTawanyHandler trata a config ausente com handoff
    ai = undefined;
  }

  await Promise.all(messages.map(async (message) => {
    const chatMessage = await deps.data.get('chatMessage', message.messageId, {
      id: true,
      conversationId: true,
      direction: true,
      body: true,
      agentHandled: true,
    });
    if (!chatMessage) {
      console.error('[tawany] processed message not found:', message.messageId);
      return;
    }

    const result = await runTawanyHandler(
      chatMessage as { id: string; conversationId: string; direction: 'IN' | 'OUT'; body: string; agentHandled?: boolean },
      // shadow é observação pura: não marca agentHandled, para a mensagem
      // continuar elegível a um run real depois (ex.: sugestão manual no inbox).
      { ai, data: deps.data, sendMode, markHandled: mode !== 'shadow' },
    );

    if (mode === 'shadow' && result.status !== 'skipped') {
      await recordShadowRun(deps.data, {
        conversationId: message.conversationId,
        messageId: message.messageId,
        tawanyReply: result.content ?? '',
        twentyReply: '',
        tawanyToolCalls: result.toolCalls ?? 0,
        match: false,
      });
    }
  }));
};
