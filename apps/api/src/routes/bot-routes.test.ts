import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ponytail: supertest com o router real + auth-middleware real (verifyToken
// mockado) — cobre o wiring das rotas E o 401 sem Authorization de verdade.
const mocks = vi.hoisted(() => ({
  prisma: {
    bot: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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
  verifyToken: vi.fn((token: string) => (token === 'good-token' ? { userId: 'u1', role: 'ADMIN' } : null)),
}));

const AUTH = { Authorization: 'Bearer good-token' };
const STEPS = { rules: [{ terms: ['preço'], responses: ['A consulta custa R$ 550.'] }] };

const makeApp = async () => {
  const { default: router } = await import('./bot-routes');
  const app = express();
  app.use(express.json());
  app.use('/api/bots', router);
  return app;
};

describe('Bot routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.session.findUnique.mockResolvedValue({
      token: 'good-token',
      expiresAt: new Date(Date.now() + 3600_000),
    });
  });

  it('retorna 401 sem Authorization em todos os endpoints', async () => {
    const app = await makeApp();

    expect((await request(app).get('/api/bots')).status).toBe(401);
    expect((await request(app).post('/api/bots/import').send({})).status).toBe(401);
    expect((await request(app).post('/api/bots/test').send({ text: 'oi' })).status).toBe(401);
    expect((await request(app).patch('/api/bots/b1').send({ active: false })).status).toBe(401);
    expect((await request(app).delete('/api/bots/b1')).status).toBe(401);
    expect(mocks.prisma.bot.findMany).not.toHaveBeenCalled();
  });

  it('GET / lista bots com contagem de regras derivada dos steps', async () => {
    mocks.prisma.bot.findMany.mockResolvedValue([
      { id: 'b1', name: 'FAQ', trigger: 'inbound-message', active: true, steps: STEPS, createdAt: new Date(), updatedAt: new Date() },
      { id: 'b2', name: 'Vazio', trigger: 'inbound-message', active: false, steps: {}, createdAt: new Date(), updatedAt: new Date() },
    ]);
    const app = await makeApp();

    const res = await request(app).get('/api/bots').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({ id: 'b1', name: 'FAQ', active: true, rules: 1 });
    expect(res.body.data[1]).toMatchObject({ id: 'b2', rules: 0 });
  });

  it('POST /import cria bot novo a partir de um fluxo válido', async () => {
    mocks.prisma.bot.findFirst.mockResolvedValue(null);
    mocks.prisma.bot.create.mockResolvedValue({ id: 'b1', name: 'FAQ', active: true });
    const app = await makeApp();

    const res = await request(app)
      .post('/api/bots/import')
      .set(AUTH)
      .send({ flow: { name: 'FAQ', ...STEPS }, source: 'faq.json' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 'b1', name: 'FAQ', rules: 1, replaced: false });
    expect(mocks.prisma.bot.create).toHaveBeenCalled();
  });

  it('POST /import rejeita payload sem flow com 400', async () => {
    const app = await makeApp();

    const res = await request(app).post('/api/bots/import').set(AUTH).send({ source: 'x.json' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mocks.prisma.bot.create).not.toHaveBeenCalled();
  });

  it('POST /test retorna a regra que casa com o texto', async () => {
    mocks.prisma.bot.findMany.mockResolvedValue([
      { id: 'b1', name: 'FAQ', active: true, steps: STEPS, createdAt: new Date() },
    ]);
    const app = await makeApp();

    // termo de uma palavra só casa por igualdade (fluxo stateless)
    const res = await request(app).post('/api/bots/test').set(AUTH).send({ text: 'Preço' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ matched: true, botId: 'b1', responses: ['A consulta custa R$ 550.'] });
  });

  it('POST /test rejeita payload sem text com 400', async () => {
    const app = await makeApp();

    const res = await request(app).post('/api/bots/test').set(AUTH).send({});

    expect(res.status).toBe(400);
  });

  it('PATCH /:id ativa/desativa o bot e valida payload', async () => {
    mocks.prisma.bot.updateMany.mockResolvedValue({ count: 1 });
    const app = await makeApp();

    const ok = await request(app).patch('/api/bots/b1').set(AUTH).send({ active: false });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ id: 'b1', active: false });
    expect(mocks.prisma.bot.updateMany).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { active: false } });

    const bad = await request(app).patch('/api/bots/b1').set(AUTH).send({ active: 'sim' });
    expect(bad.status).toBe(400);
  });

  it('PATCH /:id retorna 404 quando o bot não existe', async () => {
    mocks.prisma.bot.updateMany.mockResolvedValue({ count: 0 });
    const app = await makeApp();

    const res = await request(app).patch('/api/bots/ghost').set(AUTH).send({ active: true });

    expect(res.status).toBe(404);
  });

  it('DELETE /:id remove o bot (404 quando não existe)', async () => {
    mocks.prisma.bot.deleteMany.mockResolvedValueOnce({ count: 1 });
    const app = await makeApp();

    const ok = await request(app).delete('/api/bots/b1').set(AUTH);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ deleted: true });

    mocks.prisma.bot.deleteMany.mockResolvedValueOnce({ count: 0 });
    const gone = await request(app).delete('/api/bots/ghost').set(AUTH);
    expect(gone.status).toBe(404);
  });
});
