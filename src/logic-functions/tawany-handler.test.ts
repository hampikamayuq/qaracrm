import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runTawany } from './tawany-handler';
import type { DataApi } from 'src/lib/data';
import type { AiClient, ChatResult } from 'src/lib/ai-client';

vi.mock('src/lib/tawany/prompt-builder', () => ({
  buildSystemPrompt: () => 'system',
  buildMessages: () => [{ role: 'user', content: 'oi' }],
}));

const UUID = '00000000-0000-4000-8000-000000000000';

const chatResult = (over: Partial<ChatResult>): ChatResult => ({
  content: null,
  finishReason: 'stop',
  toolCalls: [],
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  ...over,
});

const makeData = (): DataApi => ({
  get: vi.fn().mockImplementation(async (obj: string) =>
    obj === 'conversation'
      ? { id: UUID, leadId: 'l1', summary: null }
      : { id: 'l1', name: { firstName: 'Maria', lastName: 'Silva' }, stage: 'NOVO', score: 50, intent: null, tags: [] },
  ),
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
