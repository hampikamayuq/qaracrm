import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../lib/deps', () => ({
  prisma: {
    webhookEvent: {
      create: vi.fn().mockResolvedValue({ id: 'evt-kommo-1' }),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('../logic-functions/kommo-webhook', () => ({
  handleKommoWebhook: vi.fn().mockResolvedValue({ messages: 0, leads: 0, statusChanges: 0, processedMessages: [] }),
  handleKommoSalesbotHook: vi.fn().mockResolvedValue({ messages: 0, leads: 0, statusChanges: 0, processedMessages: [] }),
}));

vi.mock('../lib/shadow', () => ({
  runTawanyForProcessedMessages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/ai-client', () => ({
  createAiClient: vi.fn(),
}));

const req = (overrides: Partial<Request>): Request => overrides as Request;

const res = () => {
  const response = {
    status: vi.fn(),
    sendStatus: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response as unknown as Response & typeof response;
};

const flushImmediates = () => new Promise((resolve) => setImmediate(resolve));

describe('Kommo Webhook Routes', () => {
  beforeEach(() => {
    process.env.KOMMO_WEBHOOK_SECRET = 'whsec-kommo';
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.KOMMO_WEBHOOK_SECRET;
  });

  it('rejeita POST quando KOMMO_WEBHOOK_SECRET não está configurado (fail-closed)', async () => {
    delete process.env.KOMMO_WEBHOOK_SECRET;
    const { receiveKommoWebhook } = await import('./kommo-webhook-routes');
    const { prisma } = await import('../lib/deps');
    const response = res();

    await receiveKommoWebhook(req({ params: { secret: 'qualquer' }, body: {} }), response);

    expect(response.sendStatus).toHaveBeenCalledWith(401);
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
  });

  it('rejeita POST com secret errado no path', async () => {
    const { receiveKommoWebhook } = await import('./kommo-webhook-routes');
    const response = res();

    await receiveKommoWebhook(req({ params: { secret: 'errado' }, body: {} }), response);

    expect(response.sendStatus).toHaveBeenCalledWith(401);
  });

  it('aceita POST com secret válido: persiste WebhookEvent, responde 200 e processa async', async () => {
    const { receiveKommoWebhook } = await import('./kommo-webhook-routes');
    const { prisma } = await import('../lib/deps');
    const { handleKommoWebhook } = await import('../logic-functions/kommo-webhook');
    const response = res();
    const body = { leads: { add: [{ id: '123' }] } };

    await receiveKommoWebhook(req({ params: { secret: 'whsec-kommo' }, body }), response);

    expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
      data: {
        source: 'kommo',
        payload: body,
        signature: expect.any(String),
        processed: false,
      },
    });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ success: true, data: { eventId: 'evt-kommo-1' } });

    await flushImmediates();
    expect(handleKommoWebhook).toHaveBeenCalledWith(body, expect.anything(), undefined, expect.any(Function));
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-kommo-1' },
      data: { processed: true, error: null },
    });
  });

  it('retry idêntico dentro da janela de dedup responde 200 sem reprocessar', async () => {
    const { receiveKommoWebhook } = await import('./kommo-webhook-routes');
    const { prisma } = await import('../lib/deps');
    vi.mocked(prisma.webhookEvent.findFirst).mockResolvedValueOnce({ id: 'evt-antigo' } as never);
    const response = res();

    await receiveKommoWebhook(req({ params: { secret: 'whsec-kommo' }, body: { leads: {} } }), response);

    expect(response.json).toHaveBeenCalledWith({ success: true, data: { duplicate: true } });
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
  });

  it('hook do salesbot usa o handler próprio e marca o payload para o sweep', async () => {
    const { receiveKommoSalesbotHook } = await import('./kommo-webhook-routes');
    const { prisma } = await import('../lib/deps');
    const { handleKommoSalesbotHook } = await import('../logic-functions/kommo-webhook');
    const response = res();
    const body = { message_text: 'Oi', lead_id: '123' };

    await receiveKommoSalesbotHook(req({ params: { secret: 'whsec-kommo' }, body }), response);

    expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: 'kommo',
        payload: { ...body, __kommoSalesbotHook: true },
      }),
    });
    await flushImmediates();
    expect(handleKommoSalesbotHook).toHaveBeenCalledWith(body, expect.anything(), undefined, expect.any(Function));
  });

  it('falha transiente no processamento inline mantém processed: false e o sweep reprocessa', async () => {
    const { receiveKommoWebhook, processPendingKommoWebhookEvents } = await import('./kommo-webhook-routes');
    const { prisma } = await import('../lib/deps');
    const { handleKommoWebhook } = await import('../logic-functions/kommo-webhook');
    vi.mocked(handleKommoWebhook).mockRejectedValueOnce(new Error('parse blew up'));
    const response = res();

    await receiveKommoWebhook(req({ params: { secret: 'whsec-kommo' }, body: {} }), response);
    await flushImmediates();

    // Registra o erro mas NÃO dead-lettera — o sweep só pega processed: false.
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-kommo-1' },
      data: { processed: false, error: 'parse blew up' },
    });

    vi.mocked(prisma.webhookEvent.findMany).mockResolvedValueOnce([
      { id: 'evt-kommo-1', payload: {} } as never,
    ]);
    const result = await processPendingKommoWebhookEvents({ now: new Date() });
    expect(result).toEqual({ scanned: 1, processed: 1, failed: 0 });
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-kommo-1' },
      data: { processed: true, error: null },
    });
  });

  it('sweep dead-lettera com processed: true quando o reprocessamento também falha', async () => {
    const { processPendingKommoWebhookEvents } = await import('./kommo-webhook-routes');
    const { prisma } = await import('../lib/deps');
    const { handleKommoWebhook } = await import('../logic-functions/kommo-webhook');
    vi.mocked(prisma.webhookEvent.findMany).mockResolvedValueOnce([
      { id: 'evt-dead', payload: {} } as never,
    ]);
    vi.mocked(handleKommoWebhook).mockRejectedValueOnce(new Error('still down'));

    const result = await processPendingKommoWebhookEvents({ now: new Date() });

    expect(result).toEqual({ scanned: 1, processed: 0, failed: 1 });
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-dead' },
      data: { processed: true, error: 'still down' },
    });
  });

  it('sweep roteia eventos do salesbot para o handler próprio', async () => {
    const { processPendingKommoWebhookEvents } = await import('./kommo-webhook-routes');
    const { prisma } = await import('../lib/deps');
    const { handleKommoSalesbotHook, handleKommoWebhook } = await import('../logic-functions/kommo-webhook');
    vi.mocked(prisma.webhookEvent.findMany).mockResolvedValueOnce([
      { id: 'evt-sb', payload: { message_text: 'Oi', __kommoSalesbotHook: true } } as never,
    ]);

    await processPendingKommoWebhookEvents({ now: new Date() });

    expect(handleKommoSalesbotHook).toHaveBeenCalled();
    expect(handleKommoWebhook).not.toHaveBeenCalled();
  });

  it('despacha as mensagens processadas para a Tawany (async e sweep)', async () => {
    const { receiveKommoWebhook, processPendingKommoWebhookEvents } = await import('./kommo-webhook-routes');
    const { prisma } = await import('../lib/deps');
    const { handleKommoWebhook } = await import('../logic-functions/kommo-webhook');
    const { runTawanyForProcessedMessages } = await import('../lib/shadow');
    const processed = [{ conversationId: 'conv-1', messageId: 'msg-1' }];
    vi.mocked(handleKommoWebhook).mockResolvedValue({ messages: 1, leads: 0, statusChanges: 0, processedMessages: processed });

    const response = res();
    await receiveKommoWebhook(req({ params: { secret: 'whsec-kommo' }, body: { message: {} } }), response);
    await flushImmediates();
    expect(runTawanyForProcessedMessages).toHaveBeenCalledWith(processed, expect.anything());

    vi.mocked(runTawanyForProcessedMessages).mockClear();
    vi.mocked(prisma.webhookEvent.findMany).mockResolvedValueOnce([
      { id: 'evt-stuck', payload: {} } as never,
    ]);
    await processPendingKommoWebhookEvents({ now: new Date() });
    expect(runTawanyForProcessedMessages).toHaveBeenCalledWith(processed, expect.anything());
  });
});
