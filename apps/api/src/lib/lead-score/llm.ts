// Lead-scorer LLM module. Called by the orchestrator in the ambiguous
// 45-65 band (Task 4). Pure: takes the same inputs as the heuristic plus
// an AiClient; never touches Twenty's data API.

import { modelWithFallback, type AiClient } from 'src/lib/ai-client';
import { stripJsonFences } from 'src/lib/ai/parse-json';
import type { ClassificationResult } from 'src/lib/classification/schema';
import { QARA_SCORE_PROMPT } from 'src/lib/prompts';
import { heuristicScore, type HeuristicLead, type HeuristicMessage, type HeuristicResult } from './heuristic';

export type LlmScoreInput = {
  lead: HeuristicLead;
  recentMessages: HeuristicMessage[];
  classification: ClassificationResult;
  ai: AiClient;
};

const clamp = (n: number): number => Math.max(0, Math.min(100, n));

const parseScoreJson = (raw: string | null): { score: number; reasons: string[] } | null => {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(raw));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as { score?: unknown; reasons?: unknown };
  if (typeof obj.score !== 'number' || !Number.isFinite(obj.score)) return null;
  if (!Array.isArray(obj.reasons)) return null;
  const reasons = obj.reasons.filter((r): r is string => typeof r === 'string');
  return { score: clamp(Math.round(obj.score)), reasons };
};

// ponytail: any LLM hiccup (bad JSON, missing fields, non-numeric score)
// falls back to the heuristic with a single "LLM error; using heuristic"
// reason. The orchestrator decides whether to write the score; here we
// just compute.
export const llmScore = async (
  lead: HeuristicLead,
  recentMessages: HeuristicMessage[],
  classification: ClassificationResult,
  ai: AiClient,
): Promise<HeuristicResult> => {
  const last = recentMessages
    .filter(m => typeof m.body === 'string' && m.body.length > 0)
    .slice(-10)
    .map(m => m.body as string)
    .join('\n');

  const userBlock =
    `lead.intent: ${lead.intent ?? 'null'}\n` +
    `lead.source: ${lead.source ?? 'null'}\n` +
    `classification.temperatura: ${classification.temperatura}\n` +
    `classification.pipeline_funil: ${classification.pipeline_funil}\n` +
    `classification.prioridade: ${classification.prioridade}\n` +
    `classification.intencao_principal: ${classification.intencao_principal}\n\n` +
    `Últimas mensagens (mais recentes por último):\n${last || '(nenhuma)'}\n\n` +
    `Responda APENAS com JSON: {"score": <0-100>, "reasons": ["...", "..."]}`;

  // ponytail: no try/catch around ai.chat() itself — a network/timeout
  // failure must propagate so the orchestrator's own catch marks path:
  // 'fallback'. Only unusable *content* (bad JSON, missing fields) is
  // handled here via parseScoreJson, which returns null instead of throwing.
  const res = await ai.chat({
    model: modelWithFallback(
      process.env.DEFAULT_MODEL_INTERNAL,
      process.env.DEFAULT_MODEL_INTERNAL_FALLBACK,
      'minimax/minimax-m3',
    ),
    system: QARA_SCORE_PROMPT,
    messages: [{ role: 'user', content: userBlock }],
    responseFormat: { type: 'json_object' },
  });
  const parsed = parseScoreJson(res.content);
  if (parsed) return parsed;

  const fallback = heuristicScore(lead, recentMessages, classification);
  return {
    score: fallback.score,
    reasons: [...fallback.reasons, 'LLM error; using heuristic'],
  };
};
