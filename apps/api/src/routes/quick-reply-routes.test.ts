import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mesmo padrão de budget-routes.test.ts: supertest com router real + auth-middleware
// real (verifyToken mockado), prisma inteiro mockado.
const mocks = vi.hoisted(() => ({
  prisma: {
    quickReply: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    session: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../lib/deps', () => ({ prisma: mocks.prisma }));
vi.mock('../lib/auth', () => ({
  verifyToken: vi.fn((token: string) => {
    if (token === 'good-token') return { userId: 'u1', role: 'admin' };
    if (token === 'reception-token') return { userId: 'u2', role: 'recepcao' };
    return null;
  }),
}));

const AUTH = { Authorization: 'Bearer good-token' };
const RECEPTION_AUTH = { Authorization: 'Bearer reception-token' };

const makeApp = async () => {
  const { default: router } = await import('./quick-reply-routes');
  const app = express();
  app.use(express.json());
  app.use('/api/quick-replies', router);
  return app;
};

describe('Quick reply routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.session.findUnique.mockResolvedValue({
      token: 'good-token',
      expiresAt: new Date(Date.now() + 3600_000),
    });
  });

  it('retorna 401 sem Authorization', async () => {
    const app = await makeApp();
    expect((await request(app).get('/api/quick-replies')).status).toBe(401);
    expect((await request(app).post('/api/quick-replies').send({ shortcut: '/a', title: 'a', content: 'b' })).status).toBe(401);
    expect(mocks.prisma.quickReply.findMany).not.toHaveBeenCalled();
  });

  it('GET / lista apenas ativas por padrão', async () => {
    mocks.prisma.quickReply.findMany.mockResolvedValue([]);
    const app = await makeApp();

    await request(app).get('/api/quick-replies').set(AUTH);
    expect(mocks.prisma.quickReply.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { active: true },
    }));
  });

  it('GET /?active=all devolve todas e ?active=false só as inativas', async () => {
    mocks.prisma.quickReply.findMany.mockResolvedValue([]);
    const app = await makeApp();

    await request(app).get('/api/quick-replies?active=all').set(AUTH);
    expect(mocks.prisma.quickReply.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: {} }));

    await request(app).get('/api/quick-replies?active=false').set(AUTH);
    expect(mocks.prisma.quickReply.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { active: false },
    }));
  });

  it('GET /?search filtra por shortcut/title/content (case-insensitive)', async () => {
    mocks.prisma.quickReply.findMany.mockResolvedValue([]);
    const app = await makeApp();

    await request(app).get('/api/quick-replies?search=preco').set(AUTH);
    expect(mocks.prisma.quickReply.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        active: true,
        OR: [
          { title: { contains: 'preco', mode: 'insensitive' } },
          { content: { contains: 'preco', mode: 'insensitive' } },
          { shortcut: { contains: 'preco', mode: 'insensitive' } },
        ],
      }),
    }));
  });

  it('POST / exige papel admin', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue({ token: 'reception-token', expiresAt: new Date(Date.now() + 3600_000) });
    const app = await makeApp();
    const res = await request(app).post('/api/quick-replies').set(RECEPTION_AUTH).send({ shortcut: '/a', title: 'a', content: 'b' });
    expect(res.status).toBe(403);
    expect(mocks.prisma.quickReply.create).not.toHaveBeenCalled();
  });

  it('POST / cria com admin e rejeita payload inválido', async () => {
    mocks.prisma.quickReply.create.mockResolvedValue({ id: 'qr1', shortcut: '/saudacao', title: 'Saudação', content: 'Olá {{primeiro_nome}}!', active: true });
    const app = await makeApp();

    const ok = await request(app).post('/api/quick-replies').set(AUTH).send({ shortcut: '/saudacao', title: 'Saudação', content: 'Olá {{primeiro_nome}}!' });
    expect(ok.status).toBe(201);
    expect(mocks.prisma.quickReply.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ shortcut: '/saudacao', title: 'Saudação', active: true }),
    }));

    const bad = await request(app).post('/api/quick-replies').set(AUTH).send({ title: 'Sem shortcut' });
    expect(bad.status).toBe(400);
  });

  it('POST / rejeita campos acima do limite (shortcut 50 / title 120 / content 2000)', async () => {
    const app = await makeApp();
    const res = await request(app).post('/api/quick-replies').set(AUTH).send({
      shortcut: '/a',
      title: 'ok',
      content: 'c'.repeat(2001),
    });
    expect(res.status).toBe(400);
    expect(mocks.prisma.quickReply.create).not.toHaveBeenCalled();
  });

  it('PATCH /:id exige admin, atualiza campos e retorna 404 quando não existe', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue({ token: 'reception-token', expiresAt: new Date(Date.now() + 3600_000) });
    const app = await makeApp();
    expect((await request(app).patch('/api/quick-replies/qr1').set(RECEPTION_AUTH).send({ title: 'X' })).status).toBe(403);

    mocks.prisma.session.findUnique.mockResolvedValue({ token: 'good-token', expiresAt: new Date(Date.now() + 3600_000) });
    mocks.prisma.quickReply.updateMany.mockResolvedValue({ count: 0 });
    const notFound = await request(app).patch('/api/quick-replies/ghost').set(AUTH).send({ title: 'X' });
    expect(notFound.status).toBe(404);

    mocks.prisma.quickReply.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.quickReply.findUnique.mockResolvedValue({ id: 'qr1', shortcut: '/a', title: 'X', content: 'c', active: true });
    const ok = await request(app).patch('/api/quick-replies/qr1').set(AUTH).send({ title: 'X' });
    expect(ok.status).toBe(200);
    expect(mocks.prisma.quickReply.updateMany).toHaveBeenCalledWith({ where: { id: 'qr1' }, data: { title: 'X' } });
  });

  it('PATCH /:id rejeita payload vazio', async () => {
    const app = await makeApp();
    const res = await request(app).patch('/api/quick-replies/qr1').set(AUTH).send({});
    expect(res.status).toBe(400);
    expect(mocks.prisma.quickReply.updateMany).not.toHaveBeenCalled();
  });

  it('DELETE /:id exige admin e retorna 404 quando não existe', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue({ token: 'reception-token', expiresAt: new Date(Date.now() + 3600_000) });
    const app = await makeApp();
    expect((await request(app).delete('/api/quick-replies/qr1').set(RECEPTION_AUTH)).status).toBe(403);

    mocks.prisma.session.findUnique.mockResolvedValue({ token: 'good-token', expiresAt: new Date(Date.now() + 3600_000) });
    mocks.prisma.quickReply.deleteMany.mockResolvedValue({ count: 0 });
    expect((await request(app).delete('/api/quick-replies/ghost').set(AUTH)).status).toBe(404);

    mocks.prisma.quickReply.deleteMany.mockResolvedValue({ count: 1 });
    const ok = await request(app).delete('/api/quick-replies/qr1').set(AUTH);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ success: true, data: { deleted: true } });
  });
});
