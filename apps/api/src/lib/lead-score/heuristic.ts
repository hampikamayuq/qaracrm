// Lead-scorer heuristic (pure, no Twenty API, no LLM).
// Spec: docs/superpowers/2026-07-03-qara-twenty-design.md §6.1
// First-pass weights; tune in one place. The orchestrator escalates to the
// LLM in the ambiguous 45-65 band.

import type { ClassificationResult } from 'src/lib/classification/schema';

export type HeuristicLead = {
  intent?: string | null;
  source?: string | null;
};

export type HeuristicMessage = {
  body?: string | null;
};

export type HeuristicResult = {
  score: number;
  reasons: string[];
};

const BOOKING = /(agendar|marcar|consulta|horário)/i;
const HESITATION = /(caro|desisti|talvez|não sei)/i;

const TEMPERATURA_BASE: Record<ClassificationResult['temperatura'], number> = {
  HOT: 80,
  WARM: 55,
  COLD: 25,
};

const clamp = (n: number): number => Math.max(0, Math.min(100, n));

// ponytail: weights are the first-pass defaults from spec §6.1. They're
// wrong for some edge cases — easy to tune here without touching the LF.
// When a classification is provided AND its self-reported confidence is
// >= 0.5, temperatura anchors the base. Below 0.5 we fall through to the
// message + intent + source signals (the same path used when no
// classification is provided). This protects against an LLM mis-fire.
export const heuristicScore = (
  lead: HeuristicLead,
  recentMessages: HeuristicMessage[],
  classification: ClassificationResult | null,
): HeuristicResult => {
  let score = 50;
  const reasons: string[] = [];

  const useClassification = classification !== null && classification.confianca >= 0.5;

  if (useClassification) {
    score = TEMPERATURA_BASE[classification.temperatura];
    reasons.push(`temperatura: ${classification.temperatura}`);

    if (classification.intencao_principal === 'agendar') {
      score += 10;
      reasons.push('intencao: agendar');
    }
    if (classification.prioridade === 'P1') {
      score += 5;
      reasons.push('prioridade: P1');
    }
  } else {
    if (lead.intent && lead.intent !== 'OUTRO') {
      score += 15;
      reasons.push(`intent: ${lead.intent}`);
    }
  }

  if (lead.source === 'INDICACAO') {
    score += 10;
    reasons.push('source: INDICACAO');
  }

  // ponytail: cap at 1 match per message-category — five "quero agendar"
  // messages shouldn't multiply the bonus.
  const bodies = recentMessages.map(m => m.body ?? '');
  if (bodies.some(b => BOOKING.test(b))) {
    score += 20;
    reasons.push('mensagem: intenção de agendar');
  }
  if (bodies.some(b => HESITATION.test(b))) {
    score -= 15;
    reasons.push('mensagem: hesitação');
  }

  return { score: clamp(score), reasons };
};
