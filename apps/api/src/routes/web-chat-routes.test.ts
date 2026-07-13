import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../lib/deps', () => ({ prisma: {} }));
vi.mock('../lib/prisma-data-api', () => ({ createPrismaDataApi: () => ({}) }));
vi.mock('../lib/ai-client', () => ({ createAiClient: vi.fn() }));

const mocks = vi.hoisted(() => ({
  handleWebChatMessage: vi.fn(),
  findWebConversation: vi.fn(),
  runTawany: vi.fn().mockResolvedValue(undefined),
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
