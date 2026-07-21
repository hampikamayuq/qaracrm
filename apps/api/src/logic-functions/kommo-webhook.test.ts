import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataApi } from '../lib/data';

const mocks = vi.hoisted(() => ({
  emitInboundMessage: vi.fn(),
  runBotsForInbound: vi.fn().mockResolvedValue({ handled: false }),
  isKommoConfigured: vi.fn().mockReturnValue(false),
  getKommoLead: vi.fn(),
  getKommoContact: vi.fn(),
}));

vi.mock('../lib/deps', () => ({ prisma: {} }));

vi.mock('../lib/events', () => ({
  emitInboundMessage: mocks.emitInboundMessage,
}));

vi.mock('../lib/bots/runner', () => ({
  runBotsForInbound: mocks.runBotsForInbound,
}));

vi.mock('../lib/kommo-client', () => ({
  isKommoConfigured: mocks.isKommoConfigured,
  getKommoLead: mocks.getKommoLead,
  getKommoContact: mocks.getKommoContact,
  kommoBreaker: { execute: (fn: () => unknown) => fn() },
}));

const { handleKommoWebhook, handleKommoSalesbotHook } = await import('./kommo-webhook');

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
  ...over,
});

// Mesmo helper dos testes do meta/evolution-webhook: debounce imediato.
const processDebounce = () => ({
  check: vi.fn().mockReturnValue({ status: 'process' as const }),
  isOptOut: vi.fn().mockReturnValue(false),
});

const inboundBody = (over: object = {}) => ({
  message: {
    add: [{
      id: 'km-1',
      chat_id: 'chat-9',
      talk_id: '77',
      contact_id: '31',
      text: 'Oi, quero agendar',
      created_at: '1752000000',
      entity_type: 'lead',
      entity_id: '123',
      type: 'incoming',
      author: { name: 'Maria' },
      ...over,
    }],
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runBotsForInbound.mockResolvedValue({ handled: false });
  mocks.isKommoConfigured.mockReturnValue(false);
});

afterEach(() => {
  delete process.env.KOMMO_STAGE_MAP;
  delete process.env.KOMMO_DEFAULT_PIPELINE;
});

describe('handleKommoWebhook — mensagem incoming', () => {
  it('cria lead (vínculo kommoLeadId + tags iniciais) + conversa KOMMO + IN liberada para a Tawany', async () => {
    process.env.KOMMO_DEFAULT_PIPELINE = 'dermatologia-clinica';
    const list = vi
      .fn()
      .mockResolvedValueOnce([]) // dedup chatMessage
      .mockResolvedValueOnce([]) // conversation
      .mockResolvedValueOnce([]); // lead por kommoLeadId
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: 'lead-1' })
      .mockResolvedValueOnce({ id: 'conv-1' })
      .mockResolvedValueOnce({ id: 'msg-1' });
    const update = vi.fn().mockResolvedValue({ id: 'conv-1' });

    const result = await handleKommoWebhook(inboundBody(), api({ list, create, update }), processDebounce());

    expect(create).toHaveBeenNthCalledWith(1, 'lead', expect.objectContaining({
      source: 'KOMMO',
      kommoLeadId: '123',
      tags: expect.arrayContaining(['status:novo-lead', 'pipeline:dermatologia-clinica']),
    }));
    expect(create).toHaveBeenNthCalledWith(2, 'conversation', expect.objectContaining({
      leadId: 'lead-1',
      channel: 'KOMMO',
      externalId: 'chat-9',
      status: 'OPEN',
    }));
    expect(create).toHaveBeenNthCalledWith(3, 'chatMessage', expect.objectContaining({
      conversationId: 'conv-1',
      direction: 'IN',
      body: 'Oi, quero agendar',
      externalId: 'kommo:km-1',
      agentHandled: false,
    }));
    expect(mocks.emitInboundMessage).toHaveBeenCalled();
    expect(result.messages).toBe(1);
    expect(result.processedMessages).toEqual([{ conversationId: 'conv-1', messageId: 'msg-1' }]);
  });

  it('dedupa retry pelo externalId da mensagem', async () => {
    const list = vi.fn().mockResolvedValueOnce([{ id: 'msg-existente' }]);
    const create = vi.fn();

    const result = await handleKommoWebhook(inboundBody(), api({ list, create }), processDebounce());

    expect(create).not.toHaveBeenCalled();
    expect(result.messages).toBe(0);
    expect(result.processedMessages).toEqual([]);
  });

  it('bot deterministico atendeu: mensagem não vai para a Tawany', async () => {
    mocks.runBotsForInbound.mockResolvedValue({ handled: true });
    const list = vi
      .fn()
      .mockResolvedValueOnce([]) // dedup
      .mockResolvedValueOnce([{ id: 'conv-1', leadId: 'lead-1', status: 'OPEN' }]);
    const create = vi.fn().mockResolvedValueOnce({ id: 'msg-1' });

    const result = await handleKommoWebhook(inboundBody(), api({ list, create }), processDebounce());

    expect(result.messages).toBe(1);
    expect(result.processedMessages).toEqual([]);
  });

  it('opt-out marca conversa PENDING_HUMAN e lead optedOut, sem Tawany', async () => {
    const debounce = processDebounce();
    debounce.isOptOut.mockReturnValue(true);
    const list = vi
      .fn()
      .mockResolvedValueOnce([]) // dedup
      .mockResolvedValueOnce([{ id: 'conv-1', leadId: 'lead-1', status: 'OPEN' }]);
    const create = vi.fn().mockResolvedValueOnce({ id: 'msg-1' });
    const update = vi.fn().mockResolvedValue({});

    const result = await handleKommoWebhook(
      inboundBody({ text: 'PARAR' }),
      api({ list, create, update }),
      debounce,
    );

    expect(update).toHaveBeenCalledWith('conversation', 'conv-1', expect.objectContaining({
      needsHuman: true,
      status: 'PENDING_HUMAN',
      handoffReason: 'opt_out_detected',
    }));
    expect(update).toHaveBeenCalledWith('lead', 'lead-1', expect.objectContaining({ optedOut: true }));
    expect(result.processedMessages).toEqual([]);
  });
});

describe('handleKommoWebhook — mensagem outgoing (humano/bot do Kommo)', () => {
  it('espelha como OUT e marca humano-assumiu', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([]) // dedup
      .mockResolvedValueOnce([{ id: 'conv-1', leadId: 'lead-1', status: 'OPEN' }])
      .mockResolvedValueOnce([]); // recentOut (echo próprio)
    const create = vi.fn().mockResolvedValueOnce({ id: 'msg-out' });
    const update = vi.fn().mockResolvedValue({});

    const result = await handleKommoWebhook(
      inboundBody({ type: 'outgoing', text: 'Já respondo!' }),
      api({ list, create, update }),
      processDebounce(),
    );

    expect(create).toHaveBeenCalledWith('chatMessage', expect.objectContaining({
      direction: 'OUT',
      body: 'Já respondo!',
      agentHandled: true,
      deliveryStatus: 'SENT',
    }));
    expect(update).toHaveBeenCalledWith('conversation', 'conv-1', expect.objectContaining({
      needsHuman: false,
      status: 'PENDING_PATIENT',
    }));
    expect(result.messages).toBe(1);
    expect(result.processedMessages).toEqual([]);
  });

  it('eco recente da resposta enviada pelo QARA via salesbot NÃO duplica o OUT', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([]) // dedup por id (o eco vem com id real do Kommo)
      .mockResolvedValueOnce([{ id: 'conv-1', leadId: 'lead-1', status: 'OPEN' }])
      .mockResolvedValueOnce([{ id: 'msg-out-qara', sentAt: new Date(1752000000 * 1000 - 30_000).toISOString() }]);
    const create = vi.fn();

    const result = await handleKommoWebhook(
      inboundBody({ type: 'outgoing', text: 'Olá! Posso ajudar?' }),
      api({ list, create }),
      processDebounce(),
    );

    expect(create).not.toHaveBeenCalled();
    expect(result.messages).toBe(0);
  });
});

describe('handleKommoWebhook — leads e estágios', () => {
  it('leads[status] mapeado move a tag de estágio e grava Activity STAGE_CHANGE', async () => {
    process.env.KOMMO_STAGE_MAP = '{"7:55":"agendado"}';
    const list = vi.fn().mockResolvedValueOnce([{ id: 'lead-1', tags: ['status:qualificado', 'pipeline:tricologia'] }]);
    const create = vi.fn().mockResolvedValue({ id: 'act-1' });
    const update = vi.fn().mockResolvedValue({});

    const result = await handleKommoWebhook(
      { leads: { status: [{ id: '123', status_id: '55', pipeline_id: '7' }] } },
      api({ list, create, update }),
      processDebounce(),
    );

    expect(update).toHaveBeenCalledWith('lead', 'lead-1', {
      tags: ['pipeline:tricologia', 'status:agendado'],
    });
    expect(create).toHaveBeenCalledWith('activity', expect.objectContaining({
      targetType: 'lead',
      targetId: 'lead-1',
      type: 'STAGE_CHANGE',
    }));
    const body = JSON.parse((create.mock.calls[0][1] as { body: string }).body);
    expect(body).toMatchObject({ type: 'stage_change', from: 'qualificado', to: 'agendado', note: 'kommo' });
    expect(result.statusChanges).toBe(1);
  });

  it('estágio sem mapeamento não move o lead: só nota de auditoria', async () => {
    process.env.KOMMO_STAGE_MAP = '{"7:55":"agendado"}';
    const list = vi.fn().mockResolvedValueOnce([{ id: 'lead-1', tags: ['status:qualificado'] }]);
    const create = vi.fn().mockResolvedValue({ id: 'act-1' });
    const update = vi.fn();

    await handleKommoWebhook(
      { leads: { status: [{ id: '123', status_id: '99', pipeline_id: '7' }] } },
      api({ list, create, update }),
      processDebounce(),
    );

    expect(update).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith('activity', expect.objectContaining({ type: 'NOTE' }));
  });

  it('leads[add] cria lead vinculado com valor estimado', async () => {
    const list = vi.fn().mockResolvedValueOnce([]); // lead por kommoLeadId
    const create = vi.fn().mockResolvedValueOnce({ id: 'lead-1' }).mockResolvedValue({ id: 'act-1' });
    const update = vi.fn().mockResolvedValue({});

    const result = await handleKommoWebhook(
      { leads: { add: [{ id: '123', name: 'Maria', price: '350' }] } },
      api({ list, create, update }),
      processDebounce(),
    );

    expect(create).toHaveBeenNthCalledWith(1, 'lead', expect.objectContaining({
      name: 'Maria',
      source: 'KOMMO',
      kommoLeadId: '123',
    }));
    expect(update).toHaveBeenCalledWith('lead', 'lead-1', { estimatedValue: 350 });
    expect(result.leads).toBe(1);
  });
});

describe('handleKommoSalesbotHook', () => {
  it('ingere a mensagem e casa lead existente por telefone (backfill do vínculo)', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([]) // dedup
      .mockResolvedValueOnce([]) // conversation
      .mockResolvedValueOnce([]) // lead por kommoLeadId
      .mockResolvedValueOnce([{ id: 'lead-2', tags: [] }]); // lead por telefone (1º candidato)
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: 'conv-1' })
      .mockResolvedValueOnce({ id: 'msg-1' });
    const update = vi.fn().mockResolvedValue({});

    const result = await handleKommoSalesbotHook(
      {
        message_id: 'm-1',
        message_text: 'Oi!',
        lead_id: '123',
        talk_id: '77',
        contact_name: 'Maria',
        contact_phone: '(11) 99999-8888',
      },
      api({ list, create, update }),
      processDebounce(),
    );

    expect(list).toHaveBeenNthCalledWith(4, 'lead', expect.objectContaining({
      filter: { phone: { eq: '5511999998888' } },
    }));
    expect(update).toHaveBeenCalledWith('lead', 'lead-2', { kommoLeadId: '123' });
    expect(create).toHaveBeenNthCalledWith(1, 'conversation', expect.objectContaining({
      leadId: 'lead-2',
      channel: 'KOMMO',
    }));
    expect(result.messages).toBe(1);
    expect(result.processedMessages).toEqual([{ conversationId: 'conv-1', messageId: 'msg-1' }]);
  });

  it('payload sem texto é ignorado sem lançar', async () => {
    const result = await handleKommoSalesbotHook({ lead_id: '1' }, api(), processDebounce());
    expect(result).toEqual({ messages: 0, leads: 0, statusChanges: 0, processedMessages: [] });
  });
});
