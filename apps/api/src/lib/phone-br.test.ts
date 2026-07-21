import { describe, expect, it } from 'vitest';
import { candidatePhonesBR, normalizePhoneBRDigits } from './phone-br';

describe('normalizePhoneBRDigits', () => {
  it('normaliza formatos comuns BR para dígitos com DDI 55', () => {
    expect(normalizePhoneBRDigits('+55 (11) 99999-8888')).toBe('5511999998888');
    expect(normalizePhoneBRDigits('11 99999-8888')).toBe('5511999998888');
    expect(normalizePhoneBRDigits('1133334444')).toBe('551133334444');
    expect(normalizePhoneBRDigits('5511999998888')).toBe('5511999998888');
  });

  it('mantém números não-BR (fora do shape local) como dígitos e rejeita vazio', () => {
    // Heurística assume BR para 10/11 dígitos; números longos ficam como estão.
    expect(normalizePhoneBRDigits('+44 20 7946 0958')).toBe('442079460958');
    expect(normalizePhoneBRDigits('sem numero')).toBeNull();
    expect(normalizePhoneBRDigits('')).toBeNull();
  });
});

describe('candidatePhonesBR', () => {
  it('gera os dois formatos gravados pelos webhooks (com e sem +)', () => {
    expect(candidatePhonesBR('(11) 99999-8888')).toEqual(['5511999998888', '+5511999998888']);
  });

  it('vazio para entrada sem dígitos', () => {
    expect(candidatePhonesBR('—')).toEqual([]);
  });
});
