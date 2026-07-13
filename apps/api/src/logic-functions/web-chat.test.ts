import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataApi } from '../lib/data';
import { handleWebChatMessage } from './web-chat';

const mocks = vi.hoisted(() => ({
  runBots: vi.fn().mockResolvedValue({ handled: false }),
  emitInboundMessage: vi.fn(),
}));

vi.mock('../lib/bots/runner', () => ({
  runBotsForInbound: mocks.runBots,
}));

vi.mock('../lib/events', () => ({
  emitInboundMessage: mocks.emitInboundMessage,
}));

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
  ...over,
});

const processDebounce = () => ({
  check: vi.fn().mockReturnValue({ status: 'process' as const }),
  isOptOut: vi.fn().mockReturnValue(false),
});

const SESSION = '11111111-1111-4111-8111-111111111111';

const baseMsg = {
  webSessionId: SESSION,
  name: 'Maria Silva',
  phone: '5511999998888',
  text: 'Oi, quero agendar',
  clientMsgId: 'c1',
  sentAt: '2026-07-12T10:00:00.000Z',
};

describe('handleWebChatMessage — ingestão WEB', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('primeira mensagem cria lead (por phone) + conversa WEB + dispatch Tawany', async () => {
    const list = vi.fn().mockResolvedValue([]); // sem dup, sem conversa, sem lead
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: 'lead-1' }) // lead
      .mockResolvedValueOnce({ id: 'conv-1' }) // conversation
      .mockResolvedValueOnce({ id: 'msg-1' }); // chatMessage
    const update = vi.fn().mockResolvedValue({ id: 'conv-1' });

    const result = await handleWebChatMessage(baseMsg, api({ list, create, update }), processDebounce());

    expect(create).toHaveBeenNthCalledWith(
      1,
      'lead',
      expect.objectContaining({ name: 'Maria Silva', phone: '5511999998888', source: 'WEB' }),
    );
    expect(create).toHaveBeenNthCalledWith(
      2,
      'conversation',
      expect.objectContaining({ leadId: 'lead-1', channel: 'WEB', externalId: SESSION, status: 'OPEN' }),
    );
    expect(create).toHaveBeenNthCalledWith(
      3,
      'chatMessage',
      expect.objectContaining({
        conversationId: 'conv-1',
        direction: 'IN',
        body: 'Oi, quero agendar',
        externalId: `web-${SESSION}-c1`,
        messageType: 'TEXT',
        agentHandled: false,
      }),
    );
    expect(mocks.emitInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', preview: 'Oi, quero agendar' }),
    );
    expect(result.processedMessages).toEqual([{ conversationId: 'conv-1', messageId: 'msg-1' }]);
    expect(result.isNewSession).toBe(true);
  });

  it('reusa um lead existente por telefone ao criar a conversa', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([]) // dedup
      .mockResolvedValueOnce([]) // sem conversa WEB
      .mockResolvedValueOnce([{ id: 'lead-existing' }]); // lead por telefone
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: 'conv-1' })
      .mockResolvedValueOnce({ id: 'msg-1' });

    await handleWebChatMessage(baseMsg, api({ list, create, update: vi.fn() }), processDebounce());

    expect(create).toHaveBeenNthCalledWith(
      1,
      'conversation',
      expect.objectContaining({ leadId: 'lead-existing' }),
    );
  });

  it('dedupa reenvio do widget (mesmo clientMsgId) por externalId', async () => {
    const list = vi.fn().mockResolvedValueOnce([{ id: 'already' }]);
    const create = vi.fn();

    const result = await handleWebChatMessage(baseMsg, api({ list, create }), processDebounce());

    expect(create).not.toHaveBeenCalled();
    expect(mocks.emitInboundMessage).not.toHaveBeenCalled();
    expect(result.processedMessages).toEqual([]);
  });

  it('reusa conversa WEB existente sem recriar lead', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([]) // dedup
      .mockResolvedValueOnce([{ id: 'conv-9', leadId: 'lead-9', status: 'OPEN' }]); // conversa existente
    const create = vi.fn().mockResolvedValue({ id: 'msg-2' });

    const result = await handleWebChatMessage(
      { ...baseMsg, clientMsgId: 'c2' },
      api({ list, create }),
      processDebounce(),
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith('chatMessage', expect.objectContaining({ conversationId: 'conv-9' }));
    expect(result.isNewSession).toBe(false);
  });

  it('bot casa: não segue para a Tawany (processedMessages vazio)', async () => {
    mocks.runBots.mockResolvedValueOnce({ handled: true });
    const list = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'conv-9', leadId: 'lead-9', status: 'OPEN' }]);
    const create = vi.fn().mockResolvedValue({ id: 'msg-2' });

    const result = await handleWebChatMessage(baseMsg, api({ list, create }), processDebounce());

    expect(result.processedMessages).toEqual([]);
  });
});
