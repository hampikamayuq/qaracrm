import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { DataApi } from '../lib/data';

vi.mock('../middleware/auth-middleware', () => ({
  authMiddleware: vi.fn((_req, _res, next) => next()),
}));

// Evita PrismaClient real no teste — as rotas gravam auditoria via prisma.
vi.mock('../lib/deps', () => ({
  prisma: { auditLog: { create: vi.fn().mockResolvedValue({}) } },
}));

const req = (overrides: Partial<Request>): Request => overrides as Request;

const res = () => {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response as unknown as Response & typeof response;
};

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
  ...over,
});

describe('LGPD routes', () => {
  it('rejects non-admin users', async () => {
    const { requireAdmin } = await import('./lgpd-routes');
    const response = res();
    const next = vi.fn();

    requireAdmin(req({ userRole: 'recepcao' }), response, next);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('exports lead data for admin users', async () => {
    const get = vi.fn().mockResolvedValue({ id: 'L1' });
    const list = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'C1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const { exportLeadRoute } = await import('./lgpd-routes');
    const response = res();

    await exportLeadRoute(req({ query: { leadId: 'L1' }, userRole: 'admin' }), response, api({ get, list }));

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ lead: { id: 'L1' } }),
    }));
  });

  it('requires leadId to anonymize', async () => {
    const { anonymizeLeadRoute } = await import('./lgpd-routes');
    const response = res();

    await anonymizeLeadRoute(req({ body: {}, userRole: 'admin' }), response, api());

    expect(response.status).toHaveBeenCalledWith(400);
  });

  it('requires explicit confirmation before anonymizing', async () => {
    const get = vi.fn().mockResolvedValue({ id: 'L1' });
    const update = vi.fn();
    const { anonymizeLeadRoute } = await import('./lgpd-routes');
    const response = res();

    await anonymizeLeadRoute(req({ body: { leadId: 'L1' }, userRole: 'admin' }), response, api({ get, update }));

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ success: false, error: 'confirmAnonymize=true required' });
    expect(update).not.toHaveBeenCalled();
  });

  it('anonymizes only when explicitly confirmed', async () => {
    const get = vi.fn().mockResolvedValue({ id: 'L1' });
    const list = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const update = vi.fn().mockResolvedValue({});
    const { anonymizeLeadRoute } = await import('./lgpd-routes');
    const response = res();

    await anonymizeLeadRoute(
      req({ body: { leadId: 'L1', confirmAnonymize: true }, userRole: 'admin' }),
      response,
      api({ get, list, update }),
    );

    expect(update).toHaveBeenCalledWith('lead', 'L1', expect.objectContaining({ phone: null, email: null }));
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
