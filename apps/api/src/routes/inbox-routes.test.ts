import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => ({
  prisma: {
    conversation: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('../lib/deps', () => ({ prisma: mocks.prisma }));
vi.mock('../middleware/auth-middleware', () => ({
  authMiddleware: vi.fn((_req, _res, next) => next()),
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

describe('Inbox routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists conversations with search, filters, pagination, and latest message only', async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([
      {
        id: 'c1',
        status: 'OPEN',
        needsHuman: true,
        updatedAt: new Date('2026-07-05T12:00:00.000Z'),
        lead: { id: 'l1', name: 'Maria Silva' },
        messages: [{ body: 'Quero consulta', sentAt: new Date('2026-07-05T11:59:00.000Z') }],
        aiSuggestions: [{ id: 's1', body: 'Posso ajudar?', riskLevel: 'low' }],
      },
    ]);
    mocks.prisma.conversation.count.mockResolvedValue(1);
    const { listInboxRoute } = await import('./inbox-routes');
    const response = res();

    await listInboxRoute(
      req({ query: { search: ' Maria ', status: 'OPEN', needsHuman: 'true', page: '2', pageSize: '10' } }),
      response,
    );

    const expectedWhere = {
      status: 'OPEN',
      needsHuman: true,
      lead: { name: { contains: 'Maria', mode: 'insensitive' } },
    };
    expect(mocks.prisma.conversation.findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      orderBy: { updatedAt: 'desc' },
      skip: 10,
      take: 10,
      select: {
        id: true,
        status: true,
        needsHuman: true,
        updatedAt: true,
        lead: { select: { id: true, name: true } },
        messages: {
          take: 1,
          orderBy: { sentAt: 'desc' },
          select: { body: true, sentAt: true },
        },
        aiSuggestions: {
          where: { status: 'PENDING' },
          take: 1,
          select: { id: true, body: true, riskLevel: true },
        },
      },
    });
    expect(mocks.prisma.conversation.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: {
        items: expect.any(Array),
        total: 1,
        page: 2,
      },
    });
  });

  it('caps pageSize and ignores invalid needsHuman values', async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([]);
    mocks.prisma.conversation.count.mockResolvedValue(0);
    const { listInboxRoute } = await import('./inbox-routes');
    const response = res();

    await listInboxRoute(req({ query: { needsHuman: 'maybe', page: '-3', pageSize: '500' } }), response);

    expect(mocks.prisma.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {},
      skip: 0,
      take: 100,
    }));
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: { items: [], total: 0, page: 1 },
    });
  });

  it('exports an express router', async () => {
    const mod = await import('./inbox-routes');
    expect(mod.default).toBeDefined();
  });
});
