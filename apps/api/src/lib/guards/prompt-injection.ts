// ponytail: regex-based guard for common prompt-injection attempts.
// Escalate to an ML classifier only if real false positives justify the latency.
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all|every|previous|todas?)?\s*(as?\s*)?(instru[cç][oõ]es\s+(anteriores?|previas?|pr[eé]vias?)|previous\s+instructions|all\s+instructions)/iu,
  /esque[cç]a\s+(tudo|as?\s+instru[cç][oõ]es|o\s+que\s+(foi|lhe\s+foi)\s+(dito|informado))/iu,
  /(voc[eê]|you)\s+(are|[eé]|agora\s+[eé]|are\s+now)\s+(now\s+)?(an?\s+|um(a)?\s+)?(admin|root|hacker|jailbreak|dan|unrestricted)/iu,
  /a\s+partir\s+de\s+agora\s+(voc[eê]\s+)?[eé]\s+(admin|root|hacker|jailbreak|dan|irrestrito)/iu,
  /\b(jailbreak|DAN mode|developer mode)\b/iu,
  /system\s*:\s*you\s+are/iu,
  /<\|im_start\|>|<\|im_end\|>/iu,
];

export type InjectionResult = { safe: true } | { safe: false; reason: 'prompt_injection' };

export const detectInjection = (text: string): InjectionResult => {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) return { safe: false, reason: 'prompt_injection' };
  }
  return { safe: true };
};
