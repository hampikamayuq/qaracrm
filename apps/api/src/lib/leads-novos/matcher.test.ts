import { describe, expect, it } from 'vitest';
import { matchLeadsNovosRule } from './matcher';

describe('matchLeadsNovosRule', () => {
  it('matches safe administrative intents with accent-insensitive text', () => {
    expect(matchLeadsNovosRule('Oi, tudo bem?')?.name).toBe('greeting');
    expect(matchLeadsNovosRule('Vocês aceitam convênio?')?.name).toBe('insurance');
    expect(matchLeadsNovosRule('Qual o endereço da clínica?')?.name).toBe('address');
  });

  it('matches booking intent without pretending to access the agenda', () => {
    const rule = matchLeadsNovosRule('Quero marcar uma consulta');
    expect(rule?.name).toBe('booking');
    expect(rule?.reply).toContain('dia ou período');
  });

  it('does not match clinical risk, photos, post-op or complaints', () => {
    for (const text of [
      'Minha pinta cresceu e sangrou',
      'Vou mandar uma foto para diagnóstico',
      'Estou no pós-operatório com febre',
      'Quero fazer uma reclamação grave',
    ]) {
      expect(matchLeadsNovosRule(text)).toBeNull();
    }
  });
});
