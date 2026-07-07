export type ValidationContext = {
  knownPrices?: number[]; // in cents
  maxLength?: number;
  sensitiveKeywords?: string[];
};

export type ValidationResult = { ok: true } | { ok: false; reason: string };

const DEFAULT_MAX_LENGTH = 1024;
const MOHS_OR_SKIN_CANCER_PATTERN = /\bMohs\b|c[aâ]ncer\s+de\s+pele/iu;
const HYPOTHESIS_MARKERS =
  /\b(se\s+for|se\s+for\s+mesmo|pode\s+ser|talvez\s+seja|suspeita\s+de|poss[ií]vel|eventual|caso\s+seja|em\s+caso\s+de)\b/iu;
// Affirmative diagnosis/prescription/promise PATTERNS — not disease names.
// Blocking words like "dermatite" would make a dermatology bot unable to say
// "a Dra. Manuela atende dermatite atópica" and hand off every conversation.
const DEFAULT_SENSITIVE_KEYWORDS = [
  'você tem ',
  'voce tem ', // affirmative diagnosis
  'seu diagnóstico',
  'seu diagnostico',
  'tome ',
  'tomar ',
  'mg de ', // prescription
  'receito ',
  'prescrevo ',
  'vou te curar',
  'garanto',
  'prometo',
  'com certeza', // outcome promises
];

// Promessa de horário: a Tawany NÃO tem agenda real, então "agendei/confirmado
// para <dia/hora>" é sempre invenção. Exige as duas partes (verbo de confirmação
// + indicação de dia/hora) para não bloquear frases legítimas como
// "vou verificar com a equipe os horários".
const SCHEDULING_CLAIM_PATTERN =
  /\b(agendei|marquei|reservei|confirmei|agendad[oa]|marcad[oa]|confirmad[oa])\s+(?:(?:a|o|sua|seu|voc[êe])\s+)?(?:\w+\s+)?(?:para|pra)\b/iu;
const DATE_TIME_HINT_PATTERN =
  /\b(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo|amanh[ãa]|hoje|\d{1,2}\s*(?:h\b|hs\b|horas\b|:\d{2})|\d{1,2}\/\d{1,2})/iu;

// Promessa de resultado: complementa os keywords ("garanto", "prometo", "com
// certeza") com as formas nominais que eles não pegam.
const OUTCOME_PROMISE_PATTERN =
  /\b(resultado\s+garantido|garantia\s+de\s+resultado|cura\s+garantida|sucesso\s+garantido|resolver?\s+100\s*%|100\s*%\s+de\s+(?:sucesso|cura|efic[áa]cia|melhora))/iu;

const extractPrices = (text: string): number[] => {
  const matches = text.matchAll(/R\$\s?(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{2}))?/gi);
  const prices: number[] = [];
  for (const m of matches) {
    const intPart = m[1].replace(/\./g, '');
    const centsPart = m[2] ? m[2].padEnd(2, '0') : '00';
    const cents = parseInt(intPart, 10) * 100 + parseInt(centsPart, 10);
    if (!isNaN(cents) && cents > 0) prices.push(cents);
  }
  return prices;
};

export const validateReply = (text: string, context: ValidationContext): ValidationResult => {
  const maxLength = context.maxLength ?? DEFAULT_MAX_LENGTH;
  const sensitive = (context.sensitiveKeywords ?? DEFAULT_SENSITIVE_KEYWORDS).map((k) =>
    k.toLowerCase(),
  );

  // 1. Length
  if (text.length > maxLength) {
    return { ok: false, reason: `length_exceeds_${maxLength}` };
  }

  // 2. Price check
  const knownPrices = context.knownPrices ?? [];
  if (knownPrices.length > 0) {
    const prices = extractPrices(text);
    for (const p of prices) {
      if (!knownPrices.includes(p)) {
        return { ok: false, reason: `price_not_in_kb: ${p}` };
      }
    }
  }

  // 3. Sensitive topics
  const lower = text.toLowerCase();
  for (const keyword of sensitive) {
    if (lower.includes(keyword)) {
      return { ok: false, reason: `sensitive_topic: ${keyword}` };
    }
  }

  if (MOHS_OR_SKIN_CANCER_PATTERN.test(text) && !HYPOTHESIS_MARKERS.test(text)) {
    return { ok: false, reason: 'mohs_or_skin_cancer_affirmative_statement' };
  }

  // 4. Promessa de horário sem agenda real
  if (SCHEDULING_CLAIM_PATTERN.test(text) && DATE_TIME_HINT_PATTERN.test(text)) {
    return { ok: false, reason: 'schedule_promise_without_agenda' };
  }

  // 5. Promessa de resultado
  if (OUTCOME_PROMISE_PATTERN.test(text)) {
    return { ok: false, reason: 'outcome_promise' };
  }

  return { ok: true };
};
