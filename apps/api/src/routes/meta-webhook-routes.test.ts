import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response } from 'express';

// ponytail: mock prisma + meta-webhook handler, verify route wiring + WebhookEvent persistence
vi.mock('../lib/deps', () => ({
  prisma: {
    webhookEvent: {
      create: vi.fn().mockResolvedValue({ id: 'evt-1' }),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('../logic-functions/meta-webhook', () => ({
  handleMetaWebhook: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/meta-signature', () => ({
  verifyMetaSignature: vi.fn().mockReturnValue(true),
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

  it('deduplicates matching signatures before persisting WebhookEvent', async () => {
    const { receiveMetaWebhook } = await import('./meta-webhook-routes');
    const { prisma } = await import('../lib/deps');
    prisma.webhookEvent.findFirst.mockResolvedValueOnce({ id: 'evt-old' });
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
});
