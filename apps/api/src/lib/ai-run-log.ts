import type { DataApi } from './data';

export type AiRunLogInput = {
  layer: string;
  model?: string | null;
  fallbackUsed?: boolean;
  latencyMs?: number;
  success: boolean;
  validationPass?: boolean;
  reason?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostCents?: number;
};

export const recordAiRun = async (
  data: DataApi,
  input: AiRunLogInput,
): Promise<void> => {
  try {
    await data.create('aiRunLog', {
      layer: input.layer,
      ...(input.model ? { model: input.model } : {}),
      fallbackUsed: input.fallbackUsed ?? false,
      ...(typeof input.latencyMs === 'number' ? { latencyMs: input.latencyMs } : {}),
      success: input.success,
      ...(typeof input.validationPass === 'boolean' ? { validationPass: input.validationPass } : {}),
      ...(input.reason ? { reason: input.reason.slice(0, 500) } : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.messageId ? { messageId: input.messageId } : {}),
      ...(typeof input.promptTokens === 'number' ? { promptTokens: input.promptTokens } : {}),
      ...(typeof input.completionTokens === 'number' ? { completionTokens: input.completionTokens } : {}),
      ...(typeof input.totalTokens === 'number' ? { totalTokens: input.totalTokens } : {}),
      ...(typeof input.estimatedCostCents === 'number' ? { estimatedCostCents: input.estimatedCostCents } : {}),
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    // ponytail: audit logging is best-effort; patient flow must not fail if
    // the app has not synced the technical object yet.
    console.error('[ai-run-log] failed:', (e as Error).message);
  }
};
