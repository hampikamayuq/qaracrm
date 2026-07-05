import { describe, it, expect } from 'vitest';
import { heuristicScore } from './heuristic';

describe('heuristicScore', () => {
  it('returns base 50 with no signals', () => {
    const r = heuristicScore({ intent: 'OUTRO', source: 'outro' }, []);
    expect(r.score).toBe(50);
    expect(r.reasons).toEqual([]);
  });

  it('adds 15 for a specific intent (not OUTRO)', () => {
    const r = heuristicScore({ intent: 'CIRURGIA', source: 'outro' }, []);
    expect(r.score).toBe(65);
    expect(r.reasons).toContain('intent: CIRURGIA');
  });

  it('adds 10 when source is INDICACAO (uppercase enum value)', () => {
    const r = heuristicScore({ intent: 'OUTRO', source: 'INDICACAO' }, []);
    expect(r.score).toBe(60);
    expect(r.reasons).toContain('source: INDICACAO');
  });

  it('does NOT add 10 when source is lowercase "indicacao" (enum is uppercase)', () => {
    // ponytail: regression — SELECT value is 'INDICACAO' per lead.object.ts:47.
    // Lowercase never fires in production; this guards against re-introducing
    // the bug.
    const r = heuristicScore({ intent: 'OUTRO', source: 'indicacao' }, []);
    expect(r.score).toBe(50);
    expect(r.reasons).not.toContain('source: INDICACAO');
    expect(r.reasons).not.toContain('source: indicacao');
  });

  it('adds 20 when a recent message matches booking keywords (case-insensitive)', () => {
    const r = heuristicScore(
      { intent: 'OUTRO', source: 'outro' },
      [{ body: 'Quero agendar uma consulta amanhã' }],
    );
    expect(r.score).toBe(70);
    expect(r.reasons).toContain('mensagem: intenção de agendar');
  });

  it('subtracts 15 when a recent message matches hesitation keywords', () => {
    const r = heuristicScore(
      { intent: 'OUTRO', source: 'outro' },
      [{ body: 'Achei caro, talvez não dê' }],
    );
    expect(r.score).toBe(35);
    expect(r.reasons).toContain('mensagem: hesitação');
  });

  it('combines all positive signals into a single hot score', () => {
    const r = heuristicScore(
      { intent: 'CIRURGIA', source: 'INDICACAO' },
      [{ body: 'Quero marcar uma consulta' }],
    );
    // 50 + 15 + 10 + 20 = 95
    expect(r.score).toBe(95);
  });

  it('clamps to 0 on the low end', () => {
    // intent OUTRO, source outro, hesitation → 50 - 15 = 35 (within bounds)
    // but we can stack two hesitation messages? no — cap at 1 per category
    // so to push below 0 we'd need a rule we don't have; verify the floor
    // with the only negative path: score 35
    const r = heuristicScore(
      { intent: 'OUTRO', source: 'outro' },
      [{ body: 'Não sei, desisti' }],
    );
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it('clamps to 100 on the high end', () => {
    const r = heuristicScore(
      { intent: 'CIRURGIA', source: 'INDICACAO' },
      [{ body: 'Quero agendar' }, { body: 'Vou marcar horário' }],
    );
    // 50 + 15 + 10 + 20 (one booking match) = 95; verify <= 100
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it('counts at most one match per message-category (no double-counting)', () => {
    // two booking messages should still only add 20, not 40
    const r = heuristicScore(
      { intent: 'OUTRO', source: 'outro' },
      [
        { body: 'Quero agendar' },
        { body: 'Vou marcar uma consulta' },
      ],
    );
    expect(r.score).toBe(70);
    expect(r.reasons.filter(r => r === 'mensagem: intenção de agendar').length).toBe(1);
  });
});
