import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// supertest com router real + auth-middleware real (verifyToken mockado) —
// cobre wiring, 401 sem Authorization e 403 não-admin (padrão settings-routes).
const mocks = vi.hoisted(() => ({
  prisma: {
    auditLog: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    session: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../lib/deps', () => ({ prisma: mocks.prisma }));
vi.mock('../lib/auth', () => ({
  verifyToken: vi.fn((token: string) => {
    if (token === 'good-token') return { userId: 'u1', role: 'ADMIN' };
    if (token === 'reception-token') return { userId: 'u2', role: 'recepcao' };
    return null;
  }),
}));

const AUTH = { Authorization: 'Bearer good-token' };
const RECEPTION_AUTH = { Authorization: 'Bearer reception-token' };

const makeApp = async () => {
  const { default: router } = await import('./audit-routes');
  const app = express();
  app.use(express.json());
  app.use('/api/audit', router);
  return app;
};

const row = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  userId: 'u9',
  action: 'bot.update',
  entity: 'bot',
  entityId: 'b1',
  before: { name: 'Antigo' },
  after: { name: 'Novo' },
  createdAt: new Date('2026-07-01T10:00:00Z'),
  ...over,
});

describe('Audit routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.session.findUnique.mockResolvedValue({
      token: 'good-token',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    // findMany atende a listagem e o distinct de entidades no mesmo mock.
    mocks.prisma.auditLog.findMany.mockImplementation((args: { distinct?: string[] }) =>
      Promise.resolve(args?.distinct ? [{ entity: 'bot' }] : []),
    );
    mocks.prisma.auditLog.count.mockResolvedValue(0);
    mocks.prisma.user.findMany.mockResolvedValue([]);
  });

  it('retorna 401 sem Authorization', async () => {
    // Arrange
    const app = await makeApp();

    // Act
    const res = await request(app).get('/api/audit');

    // Assert
    expect(res.status).toBe(401);
    expect(mocks.prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('retorna 403 para usuário não-admin', async () => {
    // Arrange
    const app = await makeApp();

    // Act
    const res = await request(app).get('/api/audit').set(RECEPTION_AUTH);

    // Assert
    expect(res.status).toBe(403);
    expect(mocks.prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('aplica filtros de entity, userId, action (contains) e período', async () => {
    // Arrange
    const app = await makeApp();

    // Act
    const res = await request(app)
      .get('/api/audit?entity=bot&userId=u9&action=update&from=2026-07-01&to=2026-07-02&page=2&pageSize=10')
      .set(AUTH);

    // Assert
    expect(res.status).toBe(200);
    const listCall = mocks.prisma.auditLog.findMany.mock.calls.find(([args]) => !args?.distinct)?.[0];
    expect(listCall).toEqual({
      where: {
        entity: 'bot',
        userId: 'u9',
        action: { contains: 'update', mode: 'insensitive' },
        createdAt: { gte: new Date('2026-07-01'), lte: new Date('2026-07-02') },
      },
      orderBy: { createdAt: 'desc' },
      skip: 10,
      take: 10,
    });
  });

  it('limita pageSize a 100', async () => {
    // Arrange
    const app = await makeApp();

    // Act
    await request(app).get('/api/audit?pageSize=999').set(AUTH);

    // Assert
    const listCall = mocks.prisma.auditLog.findMany.mock.calls.find(([args]) => !args?.distinct)?.[0];
    expect(listCall.take).toBe(100);
  });

  it('enriquece com nome do usuário e devolve null para usuário deletado', async () => {
    // Arrange
    mocks.prisma.auditLog.findMany.mockImplementation((args: { distinct?: string[] }) =>
      Promise.resolve(
        args?.distinct
          ? [{ entity: 'bot' }, { entity: 'lead' }]
          : [row(), row({ id: 'a2', userId: 'u-deletado' }), row({ id: 'a3', userId: null })],
      ),
    );
    mocks.prisma.auditLog.count.mockResolvedValue(3);
    mocks.prisma.user.findMany.mockResolvedValue([{ id: 'u9', name: 'Ana' }]);
    const app = await makeApp();

    // Act
    const res = await request(app).get('/api/audit').set(AUTH);

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.entities).toEqual(['bot', 'lead']);
    expect(res.body.data.items.map((i: { userName: string | null }) => i.userName)).toEqual(['Ana', null, null]);
    expect(mocks.prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['u9', 'u-deletado'] } },
      select: { id: true, name: true },
    });
  });
});
