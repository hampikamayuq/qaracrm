import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../lib/deps', () => ({
  prisma: {
    webhookEvent: {
      create: vi.fn().mockResolvedValue({ id: 'evt-evo-1' }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('../logic-functions/evolution-webhook', () => ({
  handleEvolutionWebhook: vi.fn().mockResolvedValue({ messages: 0, connections: 0, processedMessages: [] }),
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

describe('Evolution Webhook Routes', () => {
  beforeEach(() => {
    process.env.EVOLUTION_WEBHOOK_SECRET = 'whsec';
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.EVOLUTION_WEBHOOK_SECRET;
  });

  it('rejeita POST quando EVOLUTION_WEBHOOK_SECRET não está configurado (fail-closed)', async () => {
    delete process.env.EVOLUTION_WEBHOOK_SECRET;
    const { receiveEvolutionWebhook } = await import('./evolution-webhook-routes');
    const { prisma } = await import('../lib/deps');
    const response = res();

    await receiveEvolutionWebhook(req({ headers: {}, body: { event: 'messages.upsert' } }), response);

    expect(response.sendStatus).toHaveBeenCalledWith(401);
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
  });

  it('rejeita POST com secret ausente ou errado', async () => {
    const { receiveEvolutionWebhook } = await import('./evolution-webhook-routes');
    const response = res();

    await receiveEvolutionWebhook(req({ headers: {}, body: {} }), response);
    expect(response.sendStatus).toHaveBeenCalledWith(401);

    const response2 = res();
    await receiveEvolutionWebhook(
      req({ headers: { 'x-webhook-secret': 'errado' }, body: {} }),
      response2,
    );
    expect(response2.sendStatus).toHaveBeenCalledWith(401);
  });

  it('aceita POST com secret válido: persiste WebhookEvent, responde 200 e processa async', async () => {
    const { receiveEvolutionWebhook } = await import('./evolution-webhook-routes');
    const { prisma } = await import('../lib/deps');
    const { handleEvolutionWebhook } = await import('../logic-functions/evolution-webhook');
    const response = res();
    const body = { event: 'messages.upsert', instance: 'qara-recepcao', data: {} };

    await receiveEvolutionWebhook(
      req({ headers: { 'x-webhook-secret': 'whsec' }, body }),
      response,
    );

    expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
      data: { source: 'evolution', payload: body, processed: false },
    });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ success: true, data: { eventId: 'evt-evo-1' } });

    await flushImmediates();
    expect(handleEvolutionWebhook).toHaveBeenCalledWith(body, expect.anything(), undefined, expect.any(Function));
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-evo-1' },
      data: { processed: true, error: null },
    });
  });

  it('falha transiente no processamento inline mantém processed: false e o sweep reprocessa', async () => {
    const { receiveEvolutionWebhook, processPendingEvolutionWebhookEvents } = await import('./evolution-webhook-routes');
    const { prisma } = await import('../lib/deps');
    const { handleEvolutionWebhook } = await import('../logic-functions/evolution-webhook');
    vi.mocked(handleEvolutionWebhook).mockRejectedValueOnce(new Error('parse blew up'));
    const response = res();

    await receiveEvolutionWebhook(
      req({ headers: { 'x-webhook-secret': 'whsec' }, body: {} }),
      response,
    );
    await flushImmediates();

    // Registra o erro mas NÃO dead-lettera — o sweep só pega processed: false.
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-evo-1' },
      data: { processed: false, error: 'parse blew up' },
    });

    // Sweep pega o evento pendente e conclui (handler volta a funcionar).
    vi.mocked(prisma.webhookEvent.findMany).mockResolvedValueOnce([
      { id: 'evt-evo-1', payload: {} } as never,
    ]);
    const result = await processPendingEvolutionWebhookEvents({ now: new Date() });
    expect(result).toEqual({ scanned: 1, processed: 1, failed: 0 });
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-evo-1' },
      data: { processed: true, error: null },
    });
  });

  it('sweep dead-lettera com processed: true quando o reprocessamento também falha', async () => {
    const { processPendingEvolutionWebhookEvents } = await import('./evolution-webhook-routes');
    const { prisma } = await import('../lib/deps');
    const { handleEvolutionWebhook } = await import('../logic-functions/evolution-webhook');
    vi.mocked(prisma.webhookEvent.findMany).mockResolvedValueOnce([
      { id: 'evt-dead', payload: {} } as never,
    ]);
    vi.mocked(handleEvolutionWebhook).mockRejectedValueOnce(new Error('still down'));

    const result = await processPendingEvolutionWebhookEvents({ now: new Date() });

    expect(result).toEqual({ scanned: 1, processed: 0, failed: 1 });
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-dead' },
      data: { processed: true, error: 'still down' },
    });
  });

  it('processPendingEvolutionWebhookEvents reprocessa eventos presos', async () => {
    const { processPendingEvolutionWebhookEvents } = await import('./evolution-webhook-routes');
    const { prisma } = await import('../lib/deps');
    const { handleEvolutionWebhook } = await import('../logic-functions/evolution-webhook');
    vi.mocked(prisma.webhookEvent.findMany).mockResolvedValueOnce([
      { id: 'evt-stuck', payload: { event: 'messages.upsert' } } as never,
    ]);

    const result = await processPendingEvolutionWebhookEvents({ now: new Date() });

    expect(handleEvolutionWebhook).toHaveBeenCalledWith(
      { event: 'messages.upsert' },
      expect.anything(),
      expect.objectContaining({ check: expect.any(Function) }),
    );
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-stuck' },
      data: { processed: true, error: null },
    });
    expect(result).toEqual({ scanned: 1, processed: 1, failed: 0 });
  });

  it('despacha as mensagens processadas para a Tawany (async e sweep)', async () => {
    const { receiveEvolutionWebhook, processPendingEvolutionWebhookEvents } = await import('./evolution-webhook-routes');
    const { prisma } = await import('../lib/deps');
    const { handleEvolutionWebhook } = await import('../logic-functions/evolution-webhook');
    const { runTawanyForProcessedMessages } = await import('../lib/shadow');
    const processed = [{ conversationId: 'conv-1', messageId: 'msg-1' }];
    vi.mocked(handleEvolutionWebhook).mockResolvedValue({ messages: 1, connections: 0, processedMessages: processed });

    const response = res();
    await receiveEvolutionWebhook(
      req({ headers: { 'x-webhook-secret': 'whsec' }, body: { event: 'messages.upsert' } }),
      response,
    );
    await flushImmediates();
    expect(runTawanyForProcessedMessages).toHaveBeenCalledWith(processed, expect.anything());

    vi.mocked(runTawanyForProcessedMessages).mockClear();
    vi.mocked(prisma.webhookEvent.findMany).mockResolvedValueOnce([
      { id: 'evt-stuck', payload: {} } as never,
    ]);
    await processPendingEvolutionWebhookEvents({ now: new Date() });
    expect(runTawanyForProcessedMessages).toHaveBeenCalledWith(processed, expect.anything());
  });
});
