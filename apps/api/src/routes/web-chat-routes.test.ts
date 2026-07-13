import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../lib/deps', () => ({ prisma: {} }));
vi.mock('../lib/ai-client', () => ({ createAiClient: vi.fn() }));

const mocks = vi.hoisted(() => ({
  handleWebChatMessage: vi.fn(),
  findWebConversation: vi.fn(),
  runTawany: vi.fn().mockResolvedValue(undefined),
  dataList: vi.fn(),
}));

// data.list é usado pelo endpoint de histórico; o mock precisa expô-lo.
vi.mock('../lib/prisma-data-api', () => ({
  createPrismaDataApi: () => ({ list: mocks.dataList }),
}));

vi.mock('../logic-functions/web-chat', () => ({
  handleWebChatMessage: mocks.handleWebChatMessage,
  findWebConversation: mocks.findWebConversation,
}));

vi.mock('../lib/shadow', () => ({
  runTawanyForProcessedMessages: mocks.runTawany,
}));

const SESSION = '33333333-3333-4333-8333-333333333333';

const req = (overrides: Partial<Request>): Request => overrides as Request;

const res = () => {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response as unknown as Response & typeof response;
};

describe('web-chat routes — POST /message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.WEB_WIDGET_TOKEN;
    mocks.findWebConversation.mockResolvedValue({ id: 'conv-1' });
    mocks.handleWebChatMessage.mockResolvedValue({
      processedMessages: [],
      isNewSession: false,
      conversationId: 'conv-1',
      messageId: 'msg-1',
    });
  });

  afterEach(() => {
    delete process.env.WEB_WIDGET_TOKEN;
  });

  it('fail-closed: sem WEB_WIDGET_TOKEN configurado → 401', async () => {
    const { receiveWebChatMessage } = await import('./web-chat-routes');
    const response = res();
    await receiveWebChatMessage(
      req({ headers: { 'x-widget-token': 'anything' }, body: {} }),
      response,
    );
    expect(response.status).toHaveBeenCalledWith(401);
  });

  it('token errado → 401', async () => {
    process.env.WEB_WIDGET_TOKEN = 'segredo-do-widget';
    const { receiveWebChatMessage } = await import('./web-chat-routes');
    const response = res();
    await receiveWebChatMessage(
      req({
        headers: { 'x-widget-token': 'errado' },
        body: { webSessionId: SESSION, text: 'oi', clientMsgId: 'c1' },
      }),
      response,
    );
    expect(response.status).toHaveBeenCalledWith(401);
    expect(mocks.handleWebChatMessage).not.toHaveBeenCalled();
  });

  it('token válido + sessão existente → 200 aceito', async () => {
    process.env.WEB_WIDGET_TOKEN = 'segredo-do-widget';
    const { receiveWebChatMessage } = await import('./web-chat-routes');
    const response = res();
    await receiveWebChatMessage(
      req({
        headers: { 'x-widget-token': 'segredo-do-widget' },
        body: { webSessionId: SESSION, text: 'oi de novo', clientMsgId: 'c2' },
      }),
      response,
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, conversationId: 'conv-1', messageId: 'msg-1' }),
    );
  });

  it('nova sessão sem nome/telefone → 400', async () => {
    process.env.WEB_WIDGET_TOKEN = 'segredo-do-widget';
    mocks.findWebConversation.mockResolvedValueOnce(null); // primeira mensagem
    const { receiveWebChatMessage } = await import('./web-chat-routes');
    const response = res();
    await receiveWebChatMessage(
      req({
        headers: { 'x-widget-token': 'segredo-do-widget' },
        body: { webSessionId: SESSION, text: 'oi', clientMsgId: 'c1' },
      }),
      response,
    );
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'name_and_phone_required' }),
    );
    expect(mocks.handleWebChatMessage).not.toHaveBeenCalled();
  });

  it('body inválido (webSessionId não-uuid) → 400', async () => {
    process.env.WEB_WIDGET_TOKEN = 'segredo-do-widget';
    const { receiveWebChatMessage } = await import('./web-chat-routes');
    const response = res();
    await receiveWebChatMessage(
      req({
        headers: { 'x-widget-token': 'segredo-do-widget' },
        body: { webSessionId: 'nao-e-uuid', text: 'oi', clientMsgId: 'c1' },
      }),
      response,
    );
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_body' }));
  });
});

describe('web-chat routes — GET /stream (SSE)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('conecta, recebe OUT via push e emite heartbeat', async () => {
    vi.useFakeTimers();
    const { streamWebChat } = await import('./web-chat-routes');
    const { pushWebChatEvent } = await import('../lib/web-chat-events');
    const response = res();

    streamWebChat(req({ params: { webSessionId: SESSION }, on: vi.fn() }), response);

    // Handshake de conexão.
    expect(response.write).toHaveBeenCalledWith(expect.stringContaining('event: connected'));

    // Evento OUT chega ao stream.
    pushWebChatEvent(SESSION, {
      type: 'message',
      direction: 'OUT',
      text: 'resposta ao vivo',
      at: '2026-07-12T10:00:00.000Z',
      messageId: 'm-out',
    });
    expect(response.write).toHaveBeenCalledWith(expect.stringContaining('resposta ao vivo'));

    // Heartbeat após 25s.
    vi.advanceTimersByTime(25_000);
    expect(response.write).toHaveBeenCalledWith(': ping\n\n');
  });

  it('webSessionId inválido → 400', async () => {
    const { streamWebChat } = await import('./web-chat-routes');
    const response = res();
    streamWebChat(req({ params: { webSessionId: 'x' } }), response);
    expect(response.status).toHaveBeenCalledWith(400);
  });
});

describe('web-chat routes — GET /history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.WEB_WIDGET_TOKEN;
  });

  afterEach(() => {
    delete process.env.WEB_WIDGET_TOKEN;
  });

  const authedReq = () =>
    req({
      headers: { 'x-widget-token': 'segredo-do-widget' },
      params: { webSessionId: SESSION },
    });

  it('token errado → 401', async () => {
    process.env.WEB_WIDGET_TOKEN = 'segredo-do-widget';
    const { getWebChatHistory } = await import('./web-chat-routes');
    const response = res();
    await getWebChatHistory(
      req({ headers: { 'x-widget-token': 'errado' }, params: { webSessionId: SESSION } }),
      response,
    );
    expect(response.status).toHaveBeenCalledWith(401);
    expect(mocks.findWebConversation).not.toHaveBeenCalled();
  });

  it('sem WEB_WIDGET_TOKEN configurado → 401 (fail-closed)', async () => {
    const { getWebChatHistory } = await import('./web-chat-routes');
    const response = res();
    await getWebChatHistory(authedReq(), response);
    expect(response.status).toHaveBeenCalledWith(401);
  });

  it('sessão fresca (sem conversa) → 200 { ok:true, messages:[] }', async () => {
    process.env.WEB_WIDGET_TOKEN = 'segredo-do-widget';
    mocks.findWebConversation.mockResolvedValueOnce(null);
    const { getWebChatHistory } = await import('./web-chat-routes');
    const response = res();
    await getWebChatHistory(authedReq(), response);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ ok: true, messages: [] });
    expect(mocks.dataList).not.toHaveBeenCalled();
  });

  it('sessão com mensagens → devolve em ordem cronológica, shape do contrato', async () => {
    process.env.WEB_WIDGET_TOKEN = 'segredo-do-widget';
    mocks.findWebConversation.mockResolvedValueOnce({ id: 'conv-1' });
    // data.list devolve DESC (mais recente primeiro); o handler inverte para ASC.
    mocks.dataList.mockResolvedValueOnce([
      { id: 'm3', direction: 'OUT', body: 'terceira', sentAt: '2026-07-12T10:00:02.000Z' },
      { id: 'm2', direction: 'IN', body: 'segunda', sentAt: '2026-07-12T10:00:01.000Z' },
      { id: 'm1', direction: 'IN', body: 'primeira', sentAt: '2026-07-12T10:00:00.000Z' },
    ]);
    const { getWebChatHistory } = await import('./web-chat-routes');
    const response = res();
    await getWebChatHistory(authedReq(), response);

    expect(response.status).toHaveBeenCalledWith(200);
    const payload = response.json.mock.calls[0][0];
    expect(payload.ok).toBe(true);
    expect(payload.messages).toEqual([
      { direction: 'IN', text: 'primeira', at: '2026-07-12T10:00:00.000Z', messageId: 'm1' },
      { direction: 'IN', text: 'segunda', at: '2026-07-12T10:00:01.000Z', messageId: 'm2' },
      { direction: 'OUT', text: 'terceira', at: '2026-07-12T10:00:02.000Z', messageId: 'm3' },
    ]);

    // Consultou capado em 50 (últimas), DESC por sentAt.
    expect(mocks.dataList).toHaveBeenCalledWith(
      'chatMessage',
      expect.objectContaining({ orderBy: { sentAt: 'DESC' }, limit: 50 }),
    );
  });

  it('messageId do histórico é o id do ChatMessage — casa com o OUT do SSE (dedupe)', async () => {
    process.env.WEB_WIDGET_TOKEN = 'segredo-do-widget';
    mocks.findWebConversation.mockResolvedValueOnce({ id: 'conv-1' });
    // Mesmo id que o sendViaWeb empurra no evento OUT do SSE.
    mocks.dataList.mockResolvedValueOnce([
      { id: 'm-out', direction: 'OUT', body: 'resposta ao vivo', sentAt: '2026-07-12T10:00:00.000Z' },
    ]);
    const { getWebChatHistory } = await import('./web-chat-routes');
    const response = res();
    await getWebChatHistory(authedReq(), response);

    const payload = response.json.mock.calls[0][0];
    expect(payload.messages[0].messageId).toBe('m-out');
  });
});
