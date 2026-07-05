import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runTawany, runTawanyHandler } from './tawany-handler';
import type { DataApi } from 'src/lib/data';
import type { AiClient, ChatResult } from 'src/lib/ai-client';

vi.mock('src/lib/tawany/prompt-builder', () => ({
  buildSystemPrompt: () => 'system',
  buildMessages: () => [{ role: 'user', content: 'oi' }],
}));

vi.mock('./qara-classifier', () => ({
  runQaraClassifier: vi.fn(),
}));

vi.mock('src/lib/lead-score/orchestrator', () => ({
  runLeadScorer: vi.fn(),
}));

import { runQaraClassifier } from './qara-classifier';
import { runLeadScorer } from 'src/lib/lead-score/orchestrator';

const UUID = '00000000-0000-4000-8000-000000000000';
const LEAD_ID = 'l1';

const chatResult = (over: Partial<ChatResult>): ChatResult => ({
  content: null,
  finishReason: 'stop',
  toolCalls: [],
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  ...over,
});

const makeData = (): DataApi => ({
  get: vi.fn().mockImplementation(async (obj: string) => {
    if (obj === 'conversation') return { id: UUID, leadId: LEAD_ID, status: 'OPEN', needsHuman: false, summary: null };
    if (obj === 'lead') return { id: LEAD_ID, name: { firstName: 'Maria', lastName: 'Silva' }, stage: 'NOVO', score: 50, intent: null, source: 'INDICACAO', tags: [] };
    return { id: LEAD_ID, name: { firstName: 'Maria', lastName: 'Silva' }, stage: 'NOVO', score: 50, intent: null, tags: [] };
  }),
  list: vi.fn().mockImplementation(async (obj: string) =>
    obj === 'chatMessage'
      ? [{ id: 'm1', direction: 'IN', body: 'oi', sentAt: '2026-07-04T10:00:00Z' }]
      : [{ defaultPriceCents: 55000, rjPriceCents: null, spPriceCents: null, telePriceCents: null }],
  ),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
});

const makeAi = (...results: ChatResult[]): AiClient => {
  const chat = vi.fn();
  for (const r of results) chat.mockResolvedValueOnce(r);
  return { chat } as unknown as AiClient;
};

beforeEach(() => {
  process.env.DEFAULT_MODEL_PATIENT = 'minimax/minimax-m3';
  vi.mocked(runQaraClassifier).mockReset();
  vi.mocked(runLeadScorer).mockReset();
});

describe('runTawany', () => {
  it('replies (via sendWhatsApp stub) when guard passes', async () => {
    const data = makeData();
    const r = await runTawany(
      { messageId: 'm1', conversationId: UUID },
      { ai: makeAi(chatResult({ content: 'Olá Maria!', finishReason: 'stop' })), data },
    );
    expect(r.status).toBe('replied');
    expect(r.content).toBe('Olá Maria!');
    expect(data.create).toHaveBeenCalledWith('chatMessage', expect.objectContaining({ direction: 'OUT', body: 'Olá Maria!' }));
  });

  it('executes tool calls then replies', async () => {
    const data = makeData();
    const r = await runTawany(
      { messageId: 'm1', conversationId: UUID },
      {
        ai: makeAi(
          chatResult({
            finishReason: 'tool_calls',
            toolCalls: [{ id: 'tc1', name: 'listServices', arguments: JSON.stringify({ activeOnly: true }) }],
          }),
          chatResult({ content: 'Temos estes serviços', finishReason: 'stop' }),
        ),
        data,
      },
    );
    expect(r.status).toBe('replied');
    expect(r.toolCalls).toBe(1);
  });

  it('hands off when the model calls handoffToHuman', async () => {
    const data = makeData();
    const r = await runTawany(
      { messageId: 'm1', conversationId: UUID },
      {
        ai: makeAi(
          chatResult({
            finishReason: 'tool_calls',
            toolCalls: [{ id: 'tc1', name: 'handoffToHuman', arguments: JSON.stringify({ conversationId: UUID, reason: 'urgencia' }) }],
          }),
        ),
        data,
      },
    );
    expect(r.status).toBe('handoff');
    expect(data.update).toHaveBeenCalledWith('conversation', UUID, expect.objectContaining({ needsHuman: true }));
  });

  it('hands off when reply fails the price guard', async () => {
    const data = makeData();
    const r = await runTawany(
      { messageId: 'm1', conversationId: UUID },
      { ai: makeAi(chatResult({ content: 'A consulta custa R$ 999,00.', finishReason: 'stop' })), data },
    );
    expect(r.status).toBe('handoff');
  });

  it('hands off on ai-client error', async () => {
    const data = makeData();
    const ai = { chat: vi.fn().mockRejectedValue(new Error('OpenRouter timeout')) } as unknown as AiClient;
    const r = await runTawany({ messageId: 'm1', conversationId: UUID }, { ai, data });
    expect(r.status).toBe('handoff');
  });

  it('hands off after MAX_ITERATIONS tool turns', async () => {
    const data = makeData();
    const loop = chatResult({
      finishReason: 'tool_calls',
      toolCalls: [{ id: 'tc1', name: 'listServices', arguments: JSON.stringify({ activeOnly: true }) }],
    });
    const r = await runTawany(
      { messageId: 'm1', conversationId: UUID },
      { ai: makeAi(...(Array(7).fill(loop) as ChatResult[])), data },
    );
    expect(r.status).toBe('handoff');
  });

  it('hands off on tool execution error', async () => {
    const data = makeData();
    (data.list as ReturnType<typeof vi.fn>).mockImplementation(async (obj: string) => {
      if (obj === 'service') throw new Error('DB down');
      if (obj === 'chatMessage') return [{ id: 'm1', direction: 'IN', body: 'oi', sentAt: '2026-07-04T10:00:00Z' }];
      return [{ defaultPriceCents: 55000 }];
    });
    const r = await runTawany(
      { messageId: 'm1', conversationId: UUID },
      {
        ai: makeAi(
          chatResult({
            finishReason: 'tool_calls',
            toolCalls: [{ id: 'tc1', name: 'listServices', arguments: JSON.stringify({ activeOnly: true }) }],
          }),
        ),
        data,
      },
    );
    expect(r.status).toBe('handoff');
  });
});

describe('runTawanyHandler', () => {
  it('skips outbound and already-handled messages', async () => {
    const data = makeData();
    const r = await runTawanyHandler(
      { id: 'm1', conversationId: UUID, direction: 'OUT', body: 'oi' },
      { ai: makeAi(chatResult({ content: 'ok' })), data },
    );
    expect(r.status).toBe('skipped');
    expect(data.get).not.toHaveBeenCalled();
  });

  it('skips when conversation is closed', async () => {
    const data = makeData();
    (data.get as ReturnType<typeof vi.fn>).mockImplementation(async (obj: string) =>
      obj === 'conversation' ? { id: UUID, leadId: LEAD_ID, status: 'RESOLVED', needsHuman: false } : null,
    );
    const r = await runTawanyHandler(
      { id: 'm1', conversationId: UUID, direction: 'IN', body: 'oi' },
      { ai: makeAi(chatResult({ content: 'ok' })), data },
    );
    expect(r.status).toBe('skipped');
    expect(vi.mocked(runQaraClassifier)).not.toHaveBeenCalled();
  });

  it('runs Tawany and then calls runQaraClassifier with the inbound body + leadId', async () => {
    const data = makeData();
    vi.mocked(runQaraClassifier).mockResolvedValue(null);
    const r = await runTawanyHandler(
      { id: 'm1', conversationId: UUID, direction: 'IN', body: 'Quero marcar consulta' },
      { ai: makeAi(chatResult({ content: 'Olá!', finishReason: 'stop' })), data },
    );
    expect(r.status).toBe('replied');
    expect(vi.mocked(runQaraClassifier)).toHaveBeenCalledWith(
      { message: 'Quero marcar consulta', leadId: LEAD_ID, conversationId: UUID },
      expect.objectContaining({ data }),
    );
  });

  it('classifier failure does not break Tawany (logs and continues)', async () => {
    const data = makeData();
    vi.mocked(runQaraClassifier).mockRejectedValue(new Error('classifier boom'));
    const r = await runTawanyHandler(
      { id: 'm1', conversationId: UUID, direction: 'IN', body: 'oi' },
      { ai: makeAi(chatResult({ content: 'Olá!', finishReason: 'stop' })), data },
    );
    expect(r.status).toBe('replied');
    expect(data.update).toHaveBeenCalledWith('chatMessage', 'm1', { agentHandled: true });
  });

  it('skips classifier when conversation has no leadId', async () => {
    const data = makeData();
    (data.get as ReturnType<typeof vi.fn>).mockImplementation(async (obj: string) =>
      obj === 'conversation' ? { id: UUID, leadId: null, status: 'OPEN', needsHuman: false } : null,
    );
    const r = await runTawanyHandler(
      { id: 'm1', conversationId: UUID, direction: 'IN', body: 'oi' },
      { ai: makeAi(chatResult({ content: 'Olá!', finishReason: 'stop' })), data },
    );
    expect(r.status).toBe('replied');
    expect(vi.mocked(runQaraClassifier)).not.toHaveBeenCalled();
  });

  it('calls runLeadScorer after classifier and writes score + scoreReasons back to the lead', async () => {
    const data = makeData();
    vi.mocked(runQaraClassifier).mockResolvedValue({
      path: 'llm',
      tagsWritten: 1,
      result: {
        intencao_principal: 'agendar',
        temperatura: 'HOT',
        prioridade: 'P1',
        pipeline_funil: 'dermatologia-clinica',
        medico_indicado: null,
        unidade: null,
        confianca: 0.9,
        tags_sugeridas: ['LEAD_QUENTE'],
        proxima_acao: 'handoff',
        razoes: ['agendar detected'],
      },
    });
    vi.mocked(runLeadScorer).mockResolvedValue({
      score: 95,
      reasons: ['temperatura: HOT', 'intencao: agendar', 'prioridade: P1'],
      path: 'heuristic',
    });
    const r = await runTawanyHandler(
      { id: 'm1', conversationId: UUID, direction: 'IN', body: 'Quero marcar consulta' },
      { ai: makeAi(chatResult({ content: 'Olá!', finishReason: 'stop' })), data },
    );
    expect(r.status).toBe('replied');
    expect(vi.mocked(runLeadScorer)).toHaveBeenCalledWith(
      { intent: null, source: 'INDICACAO' },
      expect.any(Array),
      expect.objectContaining({ temperatura: 'HOT', prioridade: 'P1' }),
      expect.objectContaining({ ai: expect.anything() }),
    );
    expect(data.update).toHaveBeenCalledWith('lead', LEAD_ID, {
      score: 95,
      scoreReasons: ['temperatura: HOT', 'intencao: agendar', 'prioridade: P1'],
    });
  });

  it('runs scorer with null classification when the classifier returns null', async () => {
    const data = makeData();
    vi.mocked(runQaraClassifier).mockResolvedValue(null);
    vi.mocked(runLeadScorer).mockResolvedValue({
      score: 50,
      reasons: ['heuristic only'],
      path: 'heuristic',
    });
    await runTawanyHandler(
      { id: 'm1', conversationId: UUID, direction: 'IN', body: 'oi' },
      { ai: makeAi(chatResult({ content: 'Olá!', finishReason: 'stop' })), data },
    );
    expect(vi.mocked(runLeadScorer)).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Array),
      null,
      expect.objectContaining({ ai: expect.anything() }),
    );
  });

  it('scorer failure does not break Tawany (logs and continues)', async () => {
    const data = makeData();
    vi.mocked(runQaraClassifier).mockResolvedValue(null);
    vi.mocked(runLeadScorer).mockRejectedValue(new Error('scorer boom'));
    const r = await runTawanyHandler(
      { id: 'm1', conversationId: UUID, direction: 'IN', body: 'oi' },
      { ai: makeAi(chatResult({ content: 'Olá!', finishReason: 'stop' })), data },
    );
    expect(r.status).toBe('replied');
    expect(data.update).toHaveBeenCalledWith('chatMessage', 'm1', { agentHandled: true });
  });
});
