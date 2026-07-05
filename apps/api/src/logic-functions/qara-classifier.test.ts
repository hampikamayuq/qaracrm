import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runQaraClassifier } from './qara-classifier';
import type { DataApi } from 'src/lib/data';
import type { AiClient } from 'src/lib/ai-client';

vi.mock('src/lib/classification/orchestrator', () => ({
  classifyMessage: vi.fn(),
}));

import { classifyMessage } from 'src/lib/classification/orchestrator';

const UUID = '00000000-0000-4000-8000-000000000000';

const makeData = (): DataApi => ({
  get: vi.fn().mockImplementation(async (obj: string) => {
    if (obj === 'lead') return { id: UUID, tags: [] };
    return { id: UUID };
  }),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
});

const makeAi = (): AiClient => ({ chat: vi.fn() } as unknown as AiClient);

beforeEach(() => {
  vi.mocked(classifyMessage).mockReset();
});

describe('qara-classifier LF', () => {
  it('rejects (returns null) when message is missing', async () => {
    const data = makeData();
    const ai = makeAi();
    const r = await runQaraClassifier(
      { leadId: UUID } as unknown as { message: string; leadId: string },
      { data, ai },
    );
    expect(r).toBeNull();
    expect(classifyMessage).not.toHaveBeenCalled();
  });

  it('rejects when message is empty string', async () => {
    const data = makeData();
    const ai = makeAi();
    const r = await runQaraClassifier(
      { message: '   ', leadId: UUID },
      { data, ai },
    );
    expect(r).toBeNull();
  });

  it('returns the classifier result and writes suggested tags to the lead', async () => {
    const data = makeData();
    const ai = makeAi();
    vi.mocked(classifyMessage).mockResolvedValue({
      path: 'llm',
      result: {
        intencao_principal: 'agendar',
        temperatura: 'HOT',
        prioridade: 'P1',
        pipeline_funil: 'dermatologia-clinica',
        medico_indicado: 'Dr. Diego Galvez',
        unidade: 'Copacabana',
        confianca: 0.92,
        tags_sugeridas: ['LEAD_QUENTE', 'AGENDAR', 'HUMANO'],
        proxima_acao: 'enviar horários',
        razoes: ['paciente quer marcar'],
      },
    });
    const r = await runQaraClassifier(
      { message: 'Quero agendar', leadId: UUID, conversationId: UUID },
      { data, ai },
    );
    expect(r).not.toBeNull();
    expect(r!.path).toBe('llm');
    expect(r!.result.temperatura).toBe('HOT');
    expect(data.update).toHaveBeenCalledWith(
      'lead',
      UUID,
      expect.objectContaining({
        tags: expect.arrayContaining(['LEAD_QUENTE', 'AGENDAR', 'HUMANO']),
      }),
    );
  });

  it('skips tag write when path is fallback (no tag suggestions)', async () => {
    const data = makeData();
    const ai = makeAi();
    vi.mocked(classifyMessage).mockResolvedValue({
      path: 'fallback',
      result: {
        intencao_principal: 'outro',
        temperatura: 'WARM',
        prioridade: 'P3',
        pipeline_funil: 'dermatologia-clinica',
        medico_indicado: null,
        unidade: null,
        confianca: 0,
        tags_sugeridas: [],
        proxima_acao: 'fallback',
        razoes: ['fallback'],
      },
    });
    const r = await runQaraClassifier(
      { message: 'oi', leadId: UUID },
      { data, ai },
    );
    expect(r!.path).toBe('fallback');
    expect(data.update).not.toHaveBeenCalled();
  });
});
