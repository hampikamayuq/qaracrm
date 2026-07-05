import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runLeadScorerLF } from './lead-scorer';
import type { DataApi } from 'src/lib/data';

vi.mock('src/lib/lead-score/orchestrator', () => ({
  runLeadScorer: vi.fn(),
}));

import { runLeadScorer } from 'src/lib/lead-score/orchestrator';

const UUID = '00000000-0000-4000-8000-000000000000';

const makeData = (overrides: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockImplementation(async (obj: string) => {
    if (obj === 'lead') return { id: UUID, intent: 'CIRURGIA', source: 'INDICACAO' };
    return { id: UUID };
  }),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
  ...overrides,
});

beforeEach(() => {
  vi.mocked(runLeadScorer).mockReset();
});

describe('lead-scorer LF', () => {
  it('rejects (returns null) when leadId is missing', async () => {
    const data = makeData();
    const r = await runLeadScorerLF(
      {} as unknown as { leadId: string },
      { data },
    );
    expect(r).toBeNull();
    expect(runLeadScorer).not.toHaveBeenCalled();
  });

  it('rejects when lead is not found in the data layer', async () => {
    const data = makeData({
      get: vi.fn().mockResolvedValue(null),
    });
    const r = await runLeadScorerLF({ leadId: UUID }, { data });
    expect(r).toBeNull();
    expect(runLeadScorer).not.toHaveBeenCalled();
    expect(data.update).not.toHaveBeenCalled();
  });

  it('passes the lead.intent + lead.source + most recent messages to the orchestrator', async () => {
    const data = makeData();
    vi.mocked(runLeadScorer).mockResolvedValue({
      score: 80,
      reasons: ['temperatura: HOT'],
      path: 'heuristic',
    });
    await runLeadScorerLF({ leadId: UUID }, { data });

    expect(runLeadScorer).toHaveBeenCalledWith(
      { intent: 'CIRURGIA', source: 'INDICACAO' },
      expect.any(Array),
      null,
      { ai: null },
    );
  });

  it('passes the classification through when provided', async () => {
    const data = makeData();
    vi.mocked(runLeadScorer).mockResolvedValue({
      score: 75,
      reasons: ['temperatura: WARM', 'intencao: agendar'],
      path: 'llm',
    });
    const classification = {
      intencao_principal: 'agendar' as const,
      temperatura: 'WARM' as const,
      prioridade: 'P2' as const,
      pipeline_funil: 'dermatologia-clinica' as const,
      medico_indicado: null,
      unidade: null,
      confianca: 0.9,
      tags_sugeridas: [],
      proxima_acao: 'follow-up',
      razoes: [],
    };
    await runLeadScorerLF({ leadId: UUID, classification }, { data });
    expect(runLeadScorer).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Array),
      classification,
      expect.any(Object),
    );
  });

  it('writes score + scoreReasons back to the lead', async () => {
    const data = makeData();
    vi.mocked(runLeadScorer).mockResolvedValue({
      score: 92,
      reasons: ['temperatura: HOT', 'intencao: agendar', 'prioridade: P1'],
      path: 'heuristic',
    });
    const r = await runLeadScorerLF({ leadId: UUID }, { data });
    expect(r).not.toBeNull();
    expect(r!.score).toBe(92);
    expect(r!.path).toBe('heuristic');
    expect(r!.written).toBe(true);
    expect(data.update).toHaveBeenCalledWith('lead', UUID, {
      score: 92,
      scoreReasons: ['temperatura: HOT', 'intencao: agendar', 'prioridade: P1'],
    });
  });

  it('sorts messages oldest-first before handing them to the orchestrator', async () => {
    const data = makeData({
      list: vi.fn().mockImplementation(async (object: string) => {
        if (object === 'chatMessage') {
          // desc response (most recent first)
          return [
            { id: 'm3', body: 'Hoje', sentAt: '2026-07-04T12:00:00Z' },
            { id: 'm2', body: 'Ontem', sentAt: '2026-07-03T12:00:00Z' },
            { id: 'm1', body: 'Anteontem', sentAt: '2026-07-02T12:00:00Z' },
          ];
        }
        return [];
      }),
    });
    vi.mocked(runLeadScorer).mockResolvedValue({
      score: 60,
      reasons: [],
      path: 'heuristic',
    });
    await runLeadScorerLF({ leadId: UUID }, { data });
    const passed = vi.mocked(runLeadScorer).mock.calls[0][1] as Array<{ body: string | null }>;
    expect(passed.map((m) => m.body)).toEqual(['Anteontem', 'Ontem', 'Hoje']);
  });
});
