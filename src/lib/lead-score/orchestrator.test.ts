import { describe, it, expect, vi } from 'vitest';
import { runLeadScorer } from './orchestrator';
import type { AiClient, ChatResult } from 'src/lib/ai-client';
import type { ClassificationResult } from 'src/lib/classification/schema';

const chatResult = (over: Partial<ChatResult>): ChatResult => ({
  content: null,
  finishReason: 'stop',
  toolCalls: [],
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  ...over,
});

const cls = (over: Partial<ClassificationResult> = {}): ClassificationResult => ({
  intencao_principal: 'informacao',
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

const makeAi = (content: string): AiClient => {
  const chat = vi.fn().mockResolvedValue(chatResult({ content, finishReason: 'stop' }));
  return { chat } as unknown as AiClient;
};

describe('runLeadScorer (no classification → heuristic only)', () => {
  it('returns path: heuristic when classification is null', async () => {
    const r = await runLeadScorer({ intent: 'OUTRO', source: null }, [], null);
    expect(r.path).toBe('heuristic');
    expect(r.score).toBe(50);
  });

  it('uses heuristic for clear-hot (WARM + agendar = 65 → upper edge of ambiguous)', async () => {
    // 55 (WARM) + 10 (agendar) = 65 — at the edge, treated as ambiguous
    // per the band definition (45-65 inclusive).
    const ai = makeAi(JSON.stringify({ score: 75, reasons: ['hot'] }));
    const r = await runLeadScorer(
      { intent: null, source: null },
      [],
      cls({ intencao_principal: 'agendar' }),
      { ai },
    );
    // 65 is in the ambiguous band (45-65 inclusive), so the LLM should
    // fire and the result reflects the LLM, not the heuristic.
    expect(r.score).toBe(75);
    expect(r.path).toBe('llm');
  });

  it('uses heuristic for clear-hot (HOT = 80) without LLM', async () => {
    const ai = makeAi(JSON.stringify({ score: 99, reasons: [] }));
    const chat = ai.chat as ReturnType<typeof vi.fn>;
    const r = await runLeadScorer(
      { intent: null, source: null },
      [],
      cls({ temperatura: 'HOT' }),
      { ai },
    );
    expect(r.path).toBe('heuristic');
    expect(r.score).toBe(80);
    expect(chat).not.toHaveBeenCalled();
  });

  it('uses heuristic for clear-cold (COLD = 25) without LLM', async () => {
    const ai = makeAi(JSON.stringify({ score: 99, reasons: [] }));
    const chat = ai.chat as ReturnType<typeof vi.fn>;
    const r = await runLeadScorer(
      { intent: null, source: null },
      [],
      cls({ temperatura: 'COLD' }),
      { ai },
    );
    expect(r.path).toBe('heuristic');
    expect(r.score).toBe(25);
    expect(chat).not.toHaveBeenCalled();
  });
});

describe('runLeadScorer (ambiguous band → LLM)', () => {
  it('escalates to LLM when score is in 45-65 band', async () => {
    // 55 (WARM) + 0 (no agendar) = 55 — squarely in the band
    const ai = makeAi(JSON.stringify({ score: 60, reasons: ['willing but undecided'] }));
    const r = await runLeadScorer(
      { intent: null, source: null },
      [],
      cls({ intencao_principal: 'informacao' }),
      { ai },
    );
    expect(r.path).toBe('llm');
    expect(r.score).toBe(60);
    expect(r.reasons).toContain('willing but undecided');
  });

  it('uses heuristic when ambiguous but no ai provided', async () => {
    const r = await runLeadScorer(
      { intent: null, source: null },
      [],
      cls({ intencao_principal: 'informacao' }),
      {},
    );
    expect(r.path).toBe('heuristic');
    expect(r.score).toBe(55);
  });

  it('uses heuristic when ambiguous but no classification provided', async () => {
    const ai = makeAi(JSON.stringify({ score: 99, reasons: [] }));
    const r = await runLeadScorer(
      { intent: 'CIRURGIA', source: null },
      [{ body: 'Quero agendar' }],
      null,
      { ai },
    );
    // 50 + 15 (intent) + 20 (booking) = 85 → clear-hot heuristic path
    expect(r.path).toBe('heuristic');
    expect(r.score).toBe(85);
  });

  it('falls back to heuristic when LLM throws', async () => {
    const ai = {
      chat: vi.fn().mockRejectedValue(new Error('OpenRouter timeout')),
    } as unknown as AiClient;
    const r = await runLeadScorer(
      { intent: null, source: null },
      [],
      cls({ intencao_principal: 'informacao' }),
      { ai },
    );
    expect(r.path).toBe('fallback');
    expect(r.score).toBe(55);
    expect(r.reasons.some(x => x.includes('LLM error'))).toBe(true);
  });

  it('falls back to heuristic when LLM returns malformed JSON', async () => {
    const ai = makeAi('not json');
    const r = await runLeadScorer(
      { intent: null, source: null },
      [],
      cls({ intencao_principal: 'informacao' }),
      { ai },
    );
    // llmScore catches its own parse failures and returns heuristic
    // shape, so the orchestrator treats this as a successful LLM call.
    expect(r.path).toBe('llm');
    expect(r.score).toBe(55);
    expect(r.reasons.some(x => x.includes('LLM error'))).toBe(true);
  });

  it('boundary score 45 is ambiguous (lower edge, inclusive)', async () => {
    // Build a classification that lands at 45. base COLD=25, +20 via
    // booking-keyword message → 45.
    const ai = makeAi(JSON.stringify({ score: 50, reasons: ['nudge'] }));
    const r = await runLeadScorer(
      { intent: null, source: null },
      [{ body: 'Quero agendar uma consulta' }],
      cls({ temperatura: 'COLD' }),
      { ai },
    );
    expect(r.path).toBe('llm');
    expect(r.score).toBe(50);
  });

  it('boundary score 65 is ambiguous (upper edge, inclusive)', async () => {
    // 55 (WARM) + 10 (agendar) = 65.
    const ai = makeAi(JSON.stringify({ score: 68, reasons: ['agendar detected'] }));
    const r = await runLeadScorer(
      { intent: null, source: null },
      [],
      cls({ intencao_principal: 'agendar' }),
      { ai },
    );
    expect(r.path).toBe('llm');
    expect(r.score).toBe(68);
  });
});
