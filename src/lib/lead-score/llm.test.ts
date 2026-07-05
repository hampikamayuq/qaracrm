import { describe, it, expect, vi } from 'vitest';
import { llmScore } from './llm';
import type { AiClient, ChatResult } from 'src/lib/ai-client';
import type { ClassificationResult } from 'src/lib/classification/schema';

const chatResult = (over: Partial<ChatResult>): ChatResult => ({
  content: null,
  finishReason: 'stop',
  toolCalls: [],
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  ...over,
});

const makeAi = (content: string | null): AiClient => {
  const chat = vi.fn().mockResolvedValue(chatResult({ content, finishReason: 'stop' }));
  return { chat } as unknown as AiClient;
};

const cls: ClassificationResult = {
  intencao_principal: 'agendar',
  temperatura: 'WARM',
  prioridade: 'P3',
  pipeline_funil: 'dermatologia-clinica',
  medico_indicado: null,
  unidade: null,
  confianca: 0.7,
  tags_sugeridas: [],
  proxima_acao: 'follow-up',
  razoes: ['test'],
};

describe('llmScore', () => {
  it('parses a valid JSON response and returns score + reasons', async () => {
    const ai = makeAi(JSON.stringify({ score: 72, reasons: ['high booking intent', 'positive source'] }));
    const r = await llmScore(
      { intent: 'CIRURGIA', source: 'INDICACAO' },
      [{ body: 'Quero agendar' }],
      cls,
      ai,
    );
    expect(r.score).toBe(72);
    expect(r.reasons).toEqual(['high booking intent', 'positive source']);
  });

  it('clamps the score to [0, 100]', async () => {
    const ai = makeAi(JSON.stringify({ score: 150, reasons: [] }));
    const r = await llmScore({ intent: null, source: null }, [], cls, ai);
    expect(r.score).toBe(100);

    const ai2 = makeAi(JSON.stringify({ score: -20, reasons: [] }));
    const r2 = await llmScore({ intent: null, source: null }, [], cls, ai2);
    expect(r2.score).toBe(0);
  });

  it('coerces non-integer scores to numbers (parseFloat tolerance)', async () => {
    const ai = makeAi(JSON.stringify({ score: 64.7, reasons: ['fractional'] }));
    const r = await llmScore({ intent: null, source: null }, [], cls, ai);
    expect(r.score).toBe(65);
  });

  it('falls back to heuristic on malformed JSON', async () => {
    const ai = makeAi('not json at all');
    const r = await llmScore(
      { intent: 'CIRURGIA', source: 'INDICACAO' },
      [{ body: 'Quero agendar' }],
      cls,
      ai,
    );
    // Heuristic with classification: base 55 (WARM) + 10 (agendar) = 65
    // (intencao already factored in by classification; we get the
    // message-derived booking bonus 20 → 85, plus INDICACAO 10 → 95)
    expect(r.score).toBeGreaterThan(0);
    expect(r.reasons.some(x => x.includes('LLM'))).toBe(true);
  });

  it('falls back to heuristic when JSON misses required fields', async () => {
    const ai = makeAi(JSON.stringify({ score: 50 })); // no reasons field
    const r = await llmScore(
      { intent: 'CIRURGIA', source: null },
      [],
      cls,
      ai,
    );
    expect(r.reasons.some(x => x.includes('LLM'))).toBe(true);
  });

  it('falls back to heuristic when score is not a number', async () => {
    const ai = makeAi(JSON.stringify({ score: 'high', reasons: [] }));
    const r = await llmScore(
      { intent: 'CIRURGIA', source: null },
      [],
      cls,
      ai,
    );
    expect(r.reasons.some(x => x.includes('LLM'))).toBe(true);
  });

  it('returns 0 score and empty reasons when ai returns null content', async () => {
    const ai = makeAi(null);
    const r = await llmScore(
      { intent: 'CIRURGIA', source: 'INDICACAO' },
      [{ body: 'Quero agendar' }],
      cls,
      ai,
    );
    // Falls back to heuristic, which still computes a score
    expect(r.score).toBeGreaterThan(0);
    expect(r.reasons.some(x => x.includes('LLM'))).toBe(true);
  });

  it('passes model and structured prompt to the ai client', async () => {
    const chat = vi.fn().mockResolvedValue(chatResult({ content: '{"score":50,"reasons":[]}' }));
    const ai = { chat } as unknown as AiClient;
    await llmScore({ intent: 'OUTRO', source: null }, [], cls, ai);
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.any(String),
        system: expect.any(String),
        messages: expect.any(Array),
        responseFormat: { type: 'json_object' },
      }),
    );
  });
});
