import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response } from 'express';

// ponytail: mock prisma + meta-webhook handler, verify route wiring + WebhookEvent persistence
vi.mock('../lib/deps', () => ({
  prisma: {
    webhookEvent: {
      create: vi.fn().mockResolvedValue({ id: 'evt-1' }),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('../logic-functions/meta-webhook', () => ({
  handleMetaWebhook: vi.fn().mockResolvedValue({ processedMessages: [] }),
}));

vi.mock('../lib/meta-signature', () => ({
  verifyMetaSignature: vi.fn().mockReturnValue(true),
}));

vi.mock('../lib/shadow', () => ({
  forwardWebhookToTwenty: vi.fn().mockResolvedValue(false),
  runTawanyForProcessedMessages: vi.fn().mockResolvedValue(undefined),
}));

const req = (overrides: Partial<Request>): Request => overrides as Request;

const res = () => {
  const response = {
    status: vi.fn(),
    send: vi.fn(),
    sendStatus: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response as unknown as Response & typeof response;
};

describe('Meta Webhook Routes', () => {
  beforeEach(() => {
    process.env.META_VERIFY_TOKEN = 'test-verify-token';
    delete process.env.META_APP_SECRET;
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.META_VERIFY_TOKEN;
    delete process.env.META_APP_SECRET;
  });

  it('verifies webhook with correct token', async () => {
    const { verifyMetaWebhook } = await import('./meta-webhook-routes');
    const response = res();

    verifyMetaWebhook(
      req({
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'test-verify-token',
          'hub.challenge': 'challenge123',
        },
      }),
      response,
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.send).toHaveBeenCalledWith('challenge123');
  });

  it('rejects verification with wrong token', async () => {
    const { verifyMetaWebhook } = await import('./meta-webhook-routes');
    const response = res();

    verifyMetaWebhook(
      req({
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong',
          'hub.challenge': 'challenge123',
        },
      }),
      response,
    );

    expect(response.sendStatus).toHaveBeenCalledWith(403);
  });

  it('accepts POST with empty body, persists WebhookEvent, returns 200', async () => {
    const { receiveMetaWebhook } = await import('./meta-webhook-routes');
    const { prisma } = await import('../lib/deps');
    const response = res();

    await receiveMetaWebhook(
      req({
        headers: {},
        body: { object: 'whatsapp_business_account', entry: [] },
      }),
      response,
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ success: true, data: { eventId: 'evt-1' } });
    expect(prisma.webhookEvent.create).toHaveBeenCalled();
  });

  it('dispara a Tawany para as mensagens processadas (todos os modos)', async () => {
    const { receiveMetaWebhook } = await import('./meta-webhook-routes');
    const { handleMetaWebhook } = await import('../logic-functions/meta-webhook');
    const { runTawanyForProcessedMessages } = await import('../lib/shadow');
    vi.mocked(handleMetaWebhook).mockResolvedValueOnce({
      processedMessages: [{ conversationId: 'conv-1', messageId: 'msg-1' }],
    });
    const response = res();

    await receiveMetaWebhook(
      req({
        headers: {},
        body: { object: 'whatsapp_business_account', entry: [] },
      }),
      response,
    );
    // processamento roda em setImmediate — espera o event loop drenar
    await new Promise((resolve) => setImmediate(resolve));

    expect(runTawanyForProcessedMessages).toHaveBeenCalledWith(
      [{ conversationId: 'conv-1', messageId: 'msg-1' }],
      expect.objectContaining({ data: expect.anything() }),
    );
  });

  it('forwards raw webhook bytes to Twenty after persistence', async () => {
    const { receiveMetaWebhook } = await import('./meta-webhook-routes');
    const { forwardWebhookToTwenty } = await import('../lib/shadow');
    const response = res();
    const rawBody = Buffer.from('{"entry":[]}');

    await receiveMetaWebhook(
      req({
        headers: { 'x-hub-signature-256': 'sha256=abc' },
        body: { object: 'whatsapp_business_account', entry: [] },
        rawBody,
      } as Partial<Request> & { rawBody: Buffer }),
      response,
    );

    expect(forwardWebhookToTwenty).toHaveBeenCalledWith({
      rawBody,
      signature: 'sha256=abc',
    });
  });

  it('deduplicates matching signatures before persisting WebhookEvent', async () => {
    const { receiveMetaWebhook } = await import('./meta-webhook-routes');
    const { prisma } = await import('../lib/deps');
    vi.mocked(prisma.webhookEvent.findFirst).mockResolvedValueOnce({
      id: 'evt-old',
      source: 'meta',
      payload: {},
      signature: 'sha256=abc',
      processed: true,
      error: null,
      createdAt: new Date('2026-07-08T00:00:00.000Z'),
    });
    const response = res();

    await receiveMetaWebhook(
      req({
        headers: { 'x-hub-signature-256': 'sha256=abc' },
        body: { object: 'whatsapp_business_account', entry: [] },
      }),
      response,
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: { deduplicated: true },
    });
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
  });

  it('rejects missing signature when Meta app secret is configured', async () => {
    process.env.META_APP_SECRET = 'secret';
    const { receiveMetaWebhook } = await import('./meta-webhook-routes');
    const { prisma } = await import('../lib/deps');
    const response = res();

    await receiveMetaWebhook(
      req({
        headers: {},
        body: { object: 'whatsapp_business_account', entry: [] },
      }),
      response,
    );

    expect(response.sendStatus).toHaveBeenCalledWith(403);
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
  });

  it('rejects invalid signature when Meta app secret is configured', async () => {
    process.env.META_APP_SECRET = 'secret';
    const { verifyMetaSignature } = await import('../lib/meta-signature');
    vi.mocked(verifyMetaSignature).mockReturnValueOnce(false);
    const { receiveMetaWebhook } = await import('./meta-webhook-routes');
    const response = res();

    await receiveMetaWebhook(
      req({
        headers: { 'x-hub-signature-256': 'sha256=bad' },
        body: { object: 'whatsapp_business_account', entry: [] },
      }),
      response,
    );

    expect(response.sendStatus).toHaveBeenCalledWith(403);
  });

  it('sweeps pending webhook events and dispatches Tawany for processed messages', async () => {
    const { processPendingMetaWebhookEvents } = await import('./meta-webhook-routes');
    const { prisma } = await import('../lib/deps');
    const { handleMetaWebhook } = await import('../logic-functions/meta-webhook');
    const { runTawanyForProcessedMessages } = await import('../lib/shadow');
    vi.mocked(prisma.webhookEvent.findMany).mockResolvedValueOnce([
      {
        id: 'evt-pending',
        source: 'meta',
        payload: { object: 'whatsapp_business_account', entry: [] },
        signature: null,
        processed: false,
        error: null,
        createdAt: new Date('2026-07-08T00:00:00.000Z'),
      },
    ]);
    vi.mocked(handleMetaWebhook).mockResolvedValueOnce({
      processedMessages: [{ conversationId: 'conv-1', messageId: 'msg-1' }],
    });

    const result = await processPendingMetaWebhookEvents({ now: new Date('2026-07-08T00:05:00.000Z') });

    expect(result).toEqual({ scanned: 1, processed: 1, failed: 0 });
    expect(prisma.webhookEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ processed: false }),
    }));
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-pending' },
      data: { processed: true, error: null },
    });
    expect(runTawanyForProcessedMessages).toHaveBeenCalledWith(
      [{ conversationId: 'conv-1', messageId: 'msg-1' }],
      expect.objectContaining({ data: expect.anything() }),
    );
  });
});
