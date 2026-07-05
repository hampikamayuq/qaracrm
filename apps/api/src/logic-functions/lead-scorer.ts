// Lead-scorer logic function. Server-side callable wrapper around the
// scorer orchestrator. When a `classification` is supplied, runs the
// scorer with it. When omitted, falls back to the message + lead signal
// path inside the orchestrator (heuristic-only). On every successful run
// writes `score` and `scoreReasons` back to the lead record so the kanban
// chip and downstream ranking reflect the latest signal.
//
// ponytail: no retry on update failure. A failed write is logged by the
// Twenty runtime; the caller sees the computed score in the response and
// can re-trigger. Keep this LF thin — the actual scoring logic lives in
// src/lib/lead-score/orchestrator.ts and is unit-tested there.

import {
  runLeadScorer,
  type OrchestratorResult,
} from 'src/lib/lead-score/orchestrator';
import type { ClassificationResult } from 'src/lib/classification/schema';
import type { AiClient } from 'src/lib/ai-client';
import type { DataApi } from 'src/lib/data';

export type LeadScorerInput = {
  leadId: string;
  classification?: ClassificationResult;
};

export type LeadScorerDeps = { ai?: AiClient | null; data: DataApi };

export type LeadScorerResponse = OrchestratorResult & {
  leadId: string;
  written: boolean;
};

export const runLeadScorerLF = async (
  input: LeadScorerInput,
  deps: LeadScorerDeps,
): Promise<LeadScorerResponse | null> => {
  if (typeof input.leadId !== 'string' || input.leadId.length === 0) return null;

  const lead = (await deps.data.get('lead', input.leadId, {
    id: true,
    intent: true,
    source: true,
  })) as { id?: string; intent?: string | null; source?: string | null } | null;
  if (!lead) return null;

  const messages = (await deps.data.list('chatMessage', {
    filter: { conversation: { lead: { id: { eq: input.leadId } } } },
    orderBy: { sentAt: 'DESC' },
    limit: 10,
    select: { id: true, body: true, sentAt: true },
  })) as Array<{ id: string; body?: string | null; sentAt?: string | null }>;

  // orchestrator expects chronological order; we pulled desc for the
  // 'most recent' semantic, then reverse to oldest-first.
  const recent = [...messages]
    .sort((a, b) => String(a.sentAt ?? '').localeCompare(String(b.sentAt ?? '')))
    .map((m) => ({ body: m.body ?? null }));

  const result = await runLeadScorer(
    { intent: lead.intent ?? null, source: lead.source ?? null },
    recent,
    input.classification ?? null,
    { ai: deps.ai ?? null },
  );

  await deps.data.update('lead', input.leadId, {
    score: result.score,
    scoreReasons: result.reasons,
  });

  return { leadId: input.leadId, ...result, written: true };
};
