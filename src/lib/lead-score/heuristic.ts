// Lead-scorer heuristic (pure, no Twenty API, no LLM).
// Spec: docs/superpowers/2026-07-03-qara-twenty-design.md §6.1
// First-pass weights; tune in one place. The orchestrator escalates to the
// LLM in the ambiguous 45-65 band.

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

const clamp = (n: number): number => Math.max(0, Math.min(100, n));

// ponytail: weights (+15/+20/+10/-15) are the first-pass defaults from
// spec §6.1. They're wrong for some edge cases — easy to tune here
// without touching the LF.
export const heuristicScore = (
  lead: HeuristicLead,
  recentMessages: HeuristicMessage[],
): HeuristicResult => {
  let score = 50;
  const reasons: string[] = [];

  if (lead.intent && lead.intent !== 'OUTRO') {
    score += 15;
    reasons.push(`intent: ${lead.intent}`);
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
