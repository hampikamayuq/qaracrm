import { LEADS_NOVOS_RISK_KEYWORDS, LEADS_NOVOS_RULES, type LeadsNovosRule } from './rules';

const normalize = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export const matchLeadsNovosRule = (text: string): LeadsNovosRule | null => {
  const normalized = normalize(text);
  if (LEADS_NOVOS_RISK_KEYWORDS.some((keyword) => normalized.includes(normalize(keyword)))) {
    return null;
  }
  return LEADS_NOVOS_RULES.find((rule) =>
    rule.keywords.some((keyword) => normalized.includes(normalize(keyword))),
  ) ?? null;
};
