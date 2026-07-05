import { describe, it, expect } from 'vitest';
import { heuristicScore } from './heuristic';
import type { ClassificationResult } from 'src/lib/classification/schema';

const cls = (over: Partial<ClassificationResult> = {}): ClassificationResult => ({
  intencao_principal: 'agendar',
  temperatura: 'WARM',
  prioridade: 'P3',
  pipeline_funil: 'dermatologia-clinica',
  medico_indicado: null,
  unidade: null,
  confianca: 0.9,
  tags_sugeridas: [],
  proxima_acao: 'follow-up',
  razoes: ['test'],
  ...over,
});

describe('heuristicScore (no classification)', () => {
  it('returns base 50 with no signals and no classification', () => {
    const r = heuristicScore({ intent: 'OUTRO', source: 'outro' }, [], null);
    expect(r.score).toBe(50);
    expect(r.reasons).toEqual([]);
  });

  it('adds 15 for a specific intent (not OUTRO)', () => {
    const r = heuristicScore({ intent: 'CIRURGIA', source: 'outro' }, [], null);
    expect(r.score).toBe(65);
    expect(r.reasons).toContain('intent: CIRURGIA');
  });

  it('adds 10 when source is INDICACAO (uppercase enum value)', () => {
    const r = heuristicScore({ intent: 'OUTRO', source: 'INDICACAO' }, [], null);
    expect(r.score).toBe(60);
    expect(r.reasons).toContain('source: INDICACAO');
  });

  it('does NOT add 10 when source is lowercase "indicacao" (enum is uppercase)', () => {
    // ponytail: regression — SELECT value is 'INDICACAO' per lead.object.ts:47.
    // Lowercase never fires in production; this guards against re-introducing
    // the bug.
    const r = heuristicScore({ intent: 'OUTRO', source: 'indicacao' }, [], null);
    expect(r.score).toBe(50);
    expect(r.reasons).not.toContain('source: INDICACAO');
    expect(r.reasons).not.toContain('source: indicacao');
  });

  it('adds 20 when a recent message matches booking keywords (case-insensitive)', () => {
    const r = heuristicScore(
      { intent: 'OUTRO', source: 'outro' },
      [{ body: 'Quero agendar uma consulta amanhã' }],
      null,
    );
    expect(r.score).toBe(70);
    expect(r.reasons).toContain('mensagem: intenção de agendar');
  });

  it('subtracts 15 when a recent message matches hesitation keywords', () => {
    const r = heuristicScore(
      { intent: 'OUTRO', source: 'outro' },
      [{ body: 'Achei caro, talvez não dê' }],
      null,
    );
    expect(r.score).toBe(35);
    expect(r.reasons).toContain('mensagem: hesitação');
  });

  it('combines all positive signals into a single hot score', () => {
    const r = heuristicScore(
      { intent: 'CIRURGIA', source: 'INDICACAO' },
      [{ body: 'Quero marcar uma consulta' }],
      null,
    );
    // 50 + 15 + 10 + 20 = 95
    expect(r.score).toBe(95);
  });

  it('clamps to 0 on the low end', () => {
    const r = heuristicScore(
      { intent: 'OUTRO', source: 'outro' },
      [{ body: 'Não sei, desisti' }],
      null,
    );
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it('clamps to 100 on the high end', () => {
    const r = heuristicScore(
      { intent: 'CIRURGIA', source: 'INDICACAO' },
      [{ body: 'Quero agendar' }, { body: 'Vou marcar horário' }],
      null,
    );
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it('counts at most one match per message-category (no double-counting)', () => {
    const r = heuristicScore(
      { intent: 'OUTRO', source: 'outro' },
      [
        { body: 'Quero agendar' },
        { body: 'Vou marcar uma consulta' },
      ],
      null,
    );
    expect(r.score).toBe(70);
    expect(r.reasons.filter(r => r === 'mensagem: intenção de agendar').length).toBe(1);
  });
});

describe('heuristicScore (with classification)', () => {
  it('uses HOT temperature as base 80 (replacing the message-only base of 50)', () => {
    const r = heuristicScore(
      { intent: 'OUTRO', source: 'outro' },
      [],
      cls({ temperatura: 'HOT' }),
    );
    expect(r.score).toBe(80);
    expect(r.reasons).toContain('temperatura: HOT');
  });

  it('uses WARM temperature as base 55', () => {
    const r = heuristicScore(
      { intent: 'OUTRO', source: 'outro' },
      [],
      cls({ temperatura: 'WARM' }),
    );
    expect(r.score).toBe(55);
    expect(r.reasons).toContain('temperatura: WARM');
  });

  it('uses COLD temperature as base 25', () => {
    const r = heuristicScore(
      { intent: 'OUTRO', source: 'outro' },
      [],
      cls({ temperatura: 'COLD' }),
    );
    expect(r.score).toBe(25);
    expect(r.reasons).toContain('temperatura: COLD');
  });

  it('adds 10 when intencao_principal is "agendar" (replaces the older intent-based 15)', () => {
    const r = heuristicScore(
      { intent: 'OUTRO', source: 'outro' },
      [],
      cls({ temperatura: 'WARM', intencao_principal: 'agendar' }),
    );
    // base 55 (WARM) + 10 (agendar) = 65
    expect(r.score).toBe(65);
    expect(r.reasons).toContain('intencao: agendar');
  });

  it('adds 5 for P1 prioridade (boosts high-priority lead)', () => {
    const r = heuristicScore(
      { intent: 'OUTRO', source: 'outro' },
      [],
      cls({ temperatura: 'WARM', prioridade: 'P1' }),
    );
    // base 55 + 5 = 60
    expect(r.score).toBe(60);
    expect(r.reasons).toContain('prioridade: P1');
  });

  it('falls back to message-based scoring when classification confianca < 0.5', () => {
    // ponytail: low confidence = don't trust the classification — use the
    // message + intent + source signals instead. The score should look like
    // the no-classification path: 50 base, plus message-derived adjustments.
    const r = heuristicScore(
      { intent: 'CIRURGIA', source: 'outro' },
      [{ body: 'Quero agendar' }],
      cls({ temperatura: 'COLD', confianca: 0.3 }),
    );
    // fallback path: 50 + 15 (intent) + 20 (booking) = 85, no temperature reason
    expect(r.score).toBe(85);
    expect(r.reasons).not.toContain('temperatura: COLD');
  });

  it('classification path with HOT + agendar + P1 = 80 + 10 + 5 = 95', () => {
    const r = heuristicScore(
      { intent: 'OUTRO', source: 'outro' },
      [],
      cls({ temperatura: 'HOT', intencao_principal: 'agendar', prioridade: 'P1' }),
    );
    expect(r.score).toBe(95);
  });

  it('classification path clamps to 0 when COLD + hesitation message', () => {
    // base 25 (COLD) - 15 (hesitacao) = 10
    const r = heuristicScore(
      { intent: 'OUTRO', source: 'outro' },
      [{ body: 'Achei caro, talvez não dê' }],
      cls({ temperatura: 'COLD' }),
    );
    expect(r.score).toBe(10);
  });

  it('classification path still respects the source INDICACAO bonus', () => {
    // base 55 (WARM) + 10 (INDICACAO) = 65
    const r = heuristicScore(
      { intent: 'OUTRO', source: 'INDICACAO' },
      [],
      cls({ temperatura: 'WARM' }),
    );
    expect(r.score).toBe(65);
    expect(r.reasons).toContain('source: INDICACAO');
  });
});
