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

  it('does not expose database errors to webhook clients', async () => {
    mocks.prisma.lead.create.mockRejectedValueOnce(new Error('relation Lead does not exist at db.internal'));
    const { receiveLeadWebhookRoute } = await import('./webhook-csv-routes');
    const response = res();

    await receiveLeadWebhookRoute(req({
      get: () => 'test-secret',
      body: { nome: 'Maria' },
    } as unknown as Request), response);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({ success: false, error: 'Erro interno' });
  });

  it('imports quoted CSV fields with commas and escaped quotes without corrupting columns', async () => {
    mocks.prisma.lead.create.mockResolvedValue({ id: 'new-lead' });
    const { importLeadsCsvRoute } = await import('./webhook-csv-routes');
    const response = res();

    await importLeadsCsvRoute(req({
      body: {
        csv: [
          '"nome","telefone","email","origem","score","pipeline","tags"',
          '"Silva, Maria","+5511999999999","maria@example.com","Indicação ""VIP""","0","unhas","campanha:inverno; prioridade:alta"',
        ].join('\r\n'),
      },
    }), response);

    expect(mocks.prisma.lead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Silva, Maria',
        phone: '+5511999999999',
        email: 'maria@example.com',
        source: 'Indicação "VIP"',
        score: 0,
        tags: expect.arrayContaining([
          'campanha:inverno',
          'prioridade:alta',
          'pipeline:unhas',
          'status:NOVO',
        ]),
      }),
    });
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: { created: 1, errors: [] },
    });
  });

  it('does not expose per-row database errors during CSV import', async () => {
    mocks.prisma.lead.create.mockRejectedValueOnce(new Error('connection to db.internal refused'));
    const { importLeadsCsvRoute } = await import('./webhook-csv-routes');
    const response = res();

    await importLeadsCsvRoute(req({
      body: { csv: 'nome,telefone,email\nMaria,5511999999999,maria@example.com' },
    }), response);

    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: { created: 0, errors: ['Linha 2: erro interno ao importar'] },
    });
  });

  it('exports the same number of columns in the header and each lead row', async () => {
    mocks.prisma.lead.findMany.mockResolvedValue([{
      id: 'lead-1', name: 'Maria', phone: null, email: null, source: 'SITE',
      intent: 'consulta', score: 80, temperature: 'HOT',
      tags: ['pipeline:unhas', 'status:NOVO'],
    }]);
    const { exportLeadsCsvRoute } = await import('./webhook-csv-routes');
    const response = res();

    await exportLeadsCsvRoute(req({ query: {} }), response);

    const csv = vi.mocked(response.send).mock.calls[0][0] as string;
    const [header, lead] = csv.replace(/^\uFEFF/, '').split('\n');
    const columnCount = (line: string) => line.match(/"(?:[^"]|"")*"/g)?.length ?? 0;
    expect(columnCount(header)).toBe(columnCount(lead));
  });
});
