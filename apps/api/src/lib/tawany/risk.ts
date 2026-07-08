import type { TawanyContext } from './context';

export type TawanyRiskLevel = 'low' | 'medium' | 'high';

const PRICE_PATTERN = /\b(?:R\$\s?\d+|\d+\s*(?:reais|real))\b/iu;
const SCHEDULING_PATTERN = /\b(agendar|agendamento|consulta|hor[aá]rio|encaixe|retorno)\b/iu;
const MEDICAL_PATTERN = /\b(cpf|diagn[oó]stico|receita|prescri[cç][aã]o|exame|laudo)\b/iu;

export const classifyTawanyRisk = (
  reply: string,
  ctx: Pick<TawanyContext, 'lead'>,
): TawanyRiskLevel => {
  if (MEDICAL_PATTERN.test(reply)) return 'high';
  if (PRICE_PATTERN.test(reply) || SCHEDULING_PATTERN.test(reply)) return 'medium';
  if (ctx.lead?.score !== undefined && ctx.lead.score >= 90) return 'medium';
  return 'low';
};
