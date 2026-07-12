import { describe, it, expect } from 'vitest';
import { TAWANY_PERSONA_PROMPT, QARA_KNOWLEDGE_PROMPT } from './prompts';
import { PROFESSIONALS, SERVICES } from 'src/seed/seed';

// Guard anti-drift de preços. Incidente de produção passado: um valor no prompt
// da Tawany não existia na tabela Service, o guard bloqueou a resposta e o bot
// travou. Este teste FALHA se alguém editar um preço no prompt sem sincronizar o
// seed (fonte dos preços canônicos da clínica).

// R$ 450,00 = 45000 centavos. Formato BR: "." = milhar, "," = decimal.
const toCents = (raw: string): number => {
  const [reais, cents = ''] = raw.replace(/\./g, '').split(',');
  return Number(reais) * 100 + Number(cents.padEnd(2, '0').slice(0, 2));
};

// Só casa R$ seguido de dígito — ignora placeholders como "R$ [valor]".
const extractPriceCents = (text: string): number[] => {
  const matches = text.match(/R\$\s*([0-9][0-9.,]*)/g) ?? [];
  return matches.map((m) => toCents(m.replace(/R\$\s*/, '').replace(/[.,]$/, '')));
};

const seedPriceCents = new Set<number>();
for (const list of [PROFESSIONALS, SERVICES]) {
  for (const item of list as Record<string, unknown>[]) {
    for (const [key, val] of Object.entries(item)) {
      if (key.endsWith('PriceCents') && typeof val === 'number') seedPriceCents.add(val);
    }
  }
}

const promptPriceCents = [
  ...new Set([...extractPriceCents(TAWANY_PERSONA_PROMPT), ...extractPriceCents(QARA_KNOWLEDGE_PROMPT)]),
].sort((a, b) => a - b);

describe('anti-drift de preços prompt <-> seed', () => {
  it('extrai pelo menos um preço dos prompts', () => {
    expect(promptPriceCents.length).toBeGreaterThan(0);
  });

  it.each(promptPriceCents)('R$ %d centavos citado no prompt existe no seed', (cents) => {
    expect(seedPriceCents).toContain(cents);
  });
});
