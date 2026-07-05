// QARA classifier logic function. Server-side callable wrapper around the
// classification orchestrator. On a successful LLM classification, writes the
// suggested tags back to the lead (deduped with existing tags). On fallback,
// returns the result without writing — a malformed LLM response is a signal
// to NOT auto-tag the lead.
//
// ponytail: keeps external behavior minimal. No triggers wired here; the LF
// is callable via REST. tawany-handler imports the orchestrator directly (not
// this LF) for the hot path to avoid the 1-3s cold-start of a serverless
// round-trip. The LF is the on-demand / batch interface.

import { classifyMessage, type ClassifyResult } from 'src/lib/classification/orchestrator';
import type { AiClient } from 'src/lib/ai-client';
import type { DataApi } from 'src/lib/data';

export type QaraClassifierInput = {
  message: string;
  leadId: string;
  conversationId?: string;
};

export type QaraClassifierDeps = { ai: AiClient; data: DataApi };

export type QaraClassifierResponse = ClassifyResult & { tagsWritten: number };

const mergeTags = (current: ReadonlyArray<string> | undefined, suggested: ReadonlyArray<string>): string[] => {
  const seen = new Set<string>(current ?? []);
  const out: string[] = [...(current ?? [])];
  for (const tag of suggested) {
    if (typeof tag !== 'string' || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
};

export const runQaraClassifier = async (
  input: QaraClassifierInput,
  deps: QaraClassifierDeps,
): Promise<QaraClassifierResponse | null> => {
  if (typeof input.message !== 'string' || input.message.trim().length === 0) return null;
  if (typeof input.leadId !== 'string' || input.leadId.length === 0) return null;

  const { result, path } = await classifyMessage(
    { message: input.message, leadId: input.leadId, conversationId: input.conversationId },
    deps,
  );

  if (path !== 'llm' || result.tags_sugeridas.length === 0) {
    return { result, path, tagsWritten: 0 };
  }

  const existing = (await deps.data.get('lead', input.leadId, { tags: true })) as { tags?: string[] } | null;
  const merged = mergeTags(existing?.tags, result.tags_sugeridas);
  await deps.data.update('lead', input.leadId, { tags: merged });
  return { result, path, tagsWritten: result.tags_sugeridas.length };
};
