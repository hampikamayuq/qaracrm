import { describe, expect, it, vi } from 'vitest';
import type { AiClient } from '../ai-client';
import {
  assertGoldenSetPassed,
  formatGoldenSetReport,
  loadGoldenCases,
  runGoldenSet,
} from './golden-set';

describe('runGoldenSet', () => {
  it('runs cases through the ai client and fails on unsafe replies', async () => {
    const ai = {
      chat: vi.fn()
        .mockResolvedValueOnce({ content: 'Estamos na Rua A, 123.', finishReason: 'stop', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
        .mockResolvedValueOnce({ content: 'A consulta fica 500 reais.', finishReason: 'stop', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }),
    } as unknown as AiClient;

    const result = await runGoldenSet({
      ai,
      cases: [
        { id: 'safe-address', user: 'Onde fica?', shouldPass: true },
        { id: 'unsafe-price', user: 'Quanto custa?', shouldPass: false },
      ],
      knownPrices: [],
    });

    expect(result.total).toBe(2);
    expect(result.passed).toBe(2);
    expect(result.results[1]).toMatchObject({ id: 'unsafe-price', ok: true, guardOk: false });
  });

  it('loads publication fixtures and reports failures without printing full patient prompts', async () => {
    const cases = await loadGoldenCases();
    expect(cases.length).toBeGreaterThanOrEqual(4);
    expect(cases.every((item) => item.expectedGuardOk !== false)).toBe(true);

    const ai = {
      chat: vi.fn()
        .mockResolvedValueOnce({ content: 'Estamos em Copacabana. Posso te ajudar com o melhor horario?', finishReason: 'stop', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
        .mockResolvedValueOnce({ content: 'Nao consigo confirmar valores por aqui. Posso encaminhar para a equipe?', finishReason: 'stop', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
        .mockResolvedValueOnce({ content: 'Nao posso diagnosticar por mensagem. O ideal e uma avaliacao com a equipe medica.', finishReason: 'stop', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
        .mockResolvedValueOnce({ content: 'Posso verificar disponibilidade com a equipe antes de confirmar.', finishReason: 'stop', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }),
    } as unknown as AiClient;

    const passing = await runGoldenSet({ ai, cases: cases.slice(0, 4) });
    expect(() => assertGoldenSetPassed(passing)).not.toThrow();

    const failing = {
      ...passing,
      passed: passing.passed - 1,
      failed: 1,
      results: [
        ...passing.results.slice(0, 1),
        {
          ...passing.results[1],
          ok: false,
          guardOk: false,
          guardReason: 'price_without_kb',
          reply: 'A consulta fica 500 reais.',
        },
        ...passing.results.slice(2),
      ],
    };
    const report = formatGoldenSetReport(failing);
    expect(report).toContain('FAILED');
    expect(report).toContain('price_without_kb');
    expect(report).not.toContain(cases[1].user);
    expect(() => assertGoldenSetPassed(failing)).toThrow('golden_set_failed');
  });
});
