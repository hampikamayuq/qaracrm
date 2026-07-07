import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => ({
  prisma: {
    lead: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../lib/deps', () => ({ prisma: mocks.prisma }));
vi.mock('../middleware/auth-middleware', () => ({
  authMiddleware: vi.fn((_req, _res, next) => next()),
}));

const req = (overrides: Partial<Request>): Request => overrides as Request;

const res = () => {
  const response = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn(), send: vi.fn() };
  response.status.mockReturnValue(response);
  return response as unknown as Response & typeof response;
};

describe('Webhook CSV routes', () => {
  const OLD_ENV = process.env.LEAD_WEBHOOK_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LEAD_WEBHOOK_SECRET = 'test-secret';
  });

  afterAll(() => {
    process.env.LEAD_WEBHOOK_SECRET = OLD_ENV;
  });

  it('rejects requests without a valid webhook secret (no side effect)', async () => {
    const { receiveLeadWebhookRoute } = await import('./webhook-csv-routes');

    const missing = res();
    await receiveLeadWebhookRoute(req({ get: () => undefined, body: { nome: 'X' } } as unknown as Request), missing);
    expect(missing.status).toHaveBeenCalledWith(401);

    const wrong = res();
    await receiveLeadWebhookRoute(req({ get: () => 'wrong', body: { nome: 'X' } } as unknown as Request), wrong);
    expect(wrong.status).toHaveBeenCalledWith(401);

    expect(mocks.prisma.lead.create).not.toHaveBeenCalled();
  });

  it('creates a lead with real Lead fields (no ghost fields) and tags for status/pipeline', async () => {
    mocks.prisma.lead.create.mockResolvedValue({ id: 'new-lead' });
    const { receiveLeadWebhookRoute } = await import('./webhook-csv-routes');
    const response = res();

    await receiveLeadWebhookRoute(req({
      get: () => 'test-secret',
      body: { nome: 'Joao Souza', telefone: '+5521999999999', email: 'joao@x.com', pipeline: 'unhas' },
    } as unknown as Request), response);

    expect(mocks.prisma.lead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Joao Souza',
        phone: '+5521999999999',
        email: 'joao@x.com',
        tags: expect.arrayContaining(['pipeline:unhas', 'status:NOVO']),
      }),
    });
    expect(response.status).toHaveBeenCalledWith(201);
  });

  it('rejects an invalid pipeline slug before creating anything', async () => {
    const { receiveLeadWebhookRoute } = await import('./webhook-csv-routes');
    const response = res();

    await receiveLeadWebhookRoute(req({
      get: () => 'test-secret',
      body: { nome: 'X', pipeline: 'nao-existe' },
    } as unknown as Request), response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(mocks.prisma.lead.create).not.toHaveBeenCalled();
  });
});
