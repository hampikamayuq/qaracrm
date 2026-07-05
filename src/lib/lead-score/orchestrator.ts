// Lead-scorer orchestrator. Pure: takes deps and the lead/classification
// inputs, returns { score, reasons, path }. The LF in
// src/logic-functions/lead-scorer.ts handles Twenty data fetching + the
// write back to the lead record. The orchestrator stays the single source
// of truth for "how do we compute the score from these inputs."
//
// Spec: docs/superpowers/2026-07-03-qara-twenty-design.md §6.1
// Strategy: heuristic first. In the ambiguous 45-65 band, escalate to the
// LLM (when an AiClient is provided). If the LLM errors, fall back to the
// heuristic and surface the fallback in `reasons`.

import type { AiClient } from 'src/lib/ai-client';
import type { ClassificationResult } from 'src/lib/classification/schema';
import { heuristicScore, type HeuristicLead, type HeuristicMessage, type HeuristicResult } from './heuristic';
import { llmScore } from './llm';

export type OrchestratorPath = 'heuristic' | 'llm' | 'fallback';

export type OrchestratorDeps = {
  ai?: AiClient | null;
};

export type OrchestratorResult = HeuristicResult & { path: OrchestratorPath };

const AMBIGUOUS_MIN = 45;
const AMBIGUOUS_MAX = 65;

// ponytail: the spec calls for "LLM in the ambiguous band, fall back to
// heuristic on error." The band is intentionally tight: clear hot/cold
// don't need an LLM call. Hot leads with a 95+ heuristic score would only
// pay the latency cost if they fall back INTO the band.
export const runLeadScorer = async (
  lead: HeuristicLead,
  recentMessages: HeuristicMessage[],
  classification: ClassificationResult | null,
  deps: OrchestratorDeps = {},
): Promise<OrchestratorResult> => {
  const heuristic = heuristicScore(lead, recentMessages, classification);

  const isAmbiguous = heuristic.score >= AMBIGUOUS_MIN && heuristic.score <= AMBIGUOUS_MAX;

  if (!isAmbiguous) {
    return { ...heuristic, path: 'heuristic' };
  }

  // Ambiguous band: escalate to LLM when we have both a classification
  // and an AiClient. Otherwise the heuristic answer IS the answer.
  if (!classification || !deps.ai) {
    return { ...heuristic, path: 'heuristic' };
  }

  try {
    const llm = await llmScore(lead, recentMessages, classification, deps.ai);
    return { score: llm.score, reasons: llm.reasons, path: 'llm' };
  } catch (e) {
    return {
      score: heuristic.score,
      reasons: [...heuristic.reasons, `LLM error; using heuristic: ${(e as Error).message}`],
      path: 'fallback',
    };
  }
};
