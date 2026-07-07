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
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    activity: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
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
    expect((await request(app).get('/api/bots/risk-terms')).status).toBe(401);
    expect((await request(app).get('/api/bots/b1')).status).toBe(401);
    expect((await request(app).get('/api/bots/b1/versions')).status).toBe(401);
    expect((await request(app).post('/api/bots').send({})).status).toBe(401);
    expect((await request(app).post('/api/bots/import').send({})).status).toBe(401);
    expect((await request(app).post('/api/bots/test').send({ text: 'oi' })).status).toBe(401);
    expect((await request(app).post('/api/bots/b1/duplicate')).status).toBe(401);
    expect((await request(app).post('/api/bots/b1/revert').send({})).status).toBe(401);
    expect((await request(app).put('/api/bots/b1').send({})).status).toBe(401);
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

  it('POST / cria bot do zero a partir do payload do editor (pausado por default)', async () => {
    mocks.prisma.bot.create.mockResolvedValue({ id: 'b9', name: 'Novo', active: false });
    const app = await makeApp();

    const res = await request(app)
      .post('/api/bots')
      .set(AUTH)
      .send({ name: 'Novo', rules: [{ terms: ['preço'], responses: ['R$ 550.'] }] });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 'b9', name: 'Novo', active: false, rules: 1 });
    expect(mocks.prisma.bot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Novo',
        trigger: 'inbound-message',
        active: false,
        steps: expect.objectContaining({ mode: 'first-match', rules: [{ terms: ['preço'], responses: ['R$ 550.'] }] }),
      }),
    });
  });

  it('POST / rejeita payload inválido com erro amigável por regra', async () => {
    const app = await makeApp();

    const semNome = await request(app).post('/api/bots').set(AUTH).send({ rules: [{ terms: ['a'], responses: ['b'] }] });
    expect(semNome.status).toBe(400);

    const semGatilho = await request(app)
      .post('/api/bots')
      .set(AUTH)
      .send({ name: 'X', rules: [{ terms: [], responses: ['b'] }] });
    expect(semGatilho.status).toBe(400);
    expect(semGatilho.body.error).toContain('Regra 1');

    const semResposta = await request(app)
      .post('/api/bots')
      .set(AUTH)
      .send({ name: 'X', rules: [{ terms: ['a'], responses: [] }] });
    expect(semResposta.status).toBe(400);
    expect(semResposta.body.error).toContain('resposta');
    expect(mocks.prisma.bot.create).not.toHaveBeenCalled();
  });

  it('GET /:id retorna o fluxo completo para o editor', async () => {
    mocks.prisma.bot.findUnique.mockResolvedValue({
      id: 'b1', name: 'FAQ', trigger: 'inbound-message', active: true, steps: STEPS,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const app = await makeApp();

    const res = await request(app).get('/api/bots/b1').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: 'b1',
      name: 'FAQ',
      rules: [{ terms: ['preço'], responses: ['A consulta custa R$ 550.'] }],
    });

    mocks.prisma.bot.findUnique.mockResolvedValue(null);
    expect((await request(app).get('/api/bots/ghost').set(AUTH)).status).toBe(404);
  });

  it('PUT /:id guarda a versão anterior antes de sobrescrever o fluxo', async () => {
    mocks.prisma.bot.findUnique.mockResolvedValue({ id: 'b1', name: 'FAQ', steps: STEPS });
    mocks.prisma.bot.update.mockResolvedValue({ id: 'b1' });
    const app = await makeApp();

    const res = await request(app)
      .put('/api/bots/b1')
      .set(AUTH)
      .send({ name: 'FAQ v2', rules: [{ terms: ['endereço'], responses: ['Copacabana.'] }] });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 'b1', name: 'FAQ v2', rules: 1 });
    // versão anterior registrada como Activity BOT_VERSION com o autor
    expect(mocks.prisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetType: 'bot',
        targetId: 'b1',
        type: 'BOT_VERSION',
        userId: 'u1',
        body: JSON.stringify({ name: 'FAQ', steps: STEPS }),
      }),
    });
    expect(mocks.prisma.bot.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: expect.objectContaining({ name: 'FAQ v2' }),
    });
  });

  it('PUT /:id retorna 404 para bot inexistente e 400 para payload inválido', async () => {
    mocks.prisma.bot.findUnique.mockResolvedValue(null);
    const app = await makeApp();

    const ghost = await request(app)
      .put('/api/bots/ghost')
      .set(AUTH)
      .send({ name: 'X', rules: [{ terms: ['a'], responses: ['b'] }] });
    expect(ghost.status).toBe(404);

    const invalid = await request(app).put('/api/bots/b1').set(AUTH).send({ name: 'X', rules: [] });
    expect(invalid.status).toBe(400);
    expect(mocks.prisma.bot.update).not.toHaveBeenCalled();
  });

  it('POST /:id/duplicate copia o bot inativo com sufixo (cópia)', async () => {
    mocks.prisma.bot.findUnique.mockResolvedValue({ id: 'b1', name: 'FAQ', trigger: 'inbound-message', steps: STEPS });
    mocks.prisma.bot.create.mockResolvedValue({ id: 'b2', name: 'FAQ (cópia)', active: false });
    const app = await makeApp();

    const res = await request(app).post('/api/bots/b1/duplicate').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 'b2', name: 'FAQ (cópia)', active: false });
    expect(mocks.prisma.bot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'FAQ (cópia)', active: false, steps: STEPS }),
    });

    mocks.prisma.bot.findUnique.mockResolvedValue(null);
    expect((await request(app).post('/api/bots/ghost/duplicate').set(AUTH)).status).toBe(404);
  });

  it('GET /:id/versions lista versões com quando e quem', async () => {
    const at = new Date('2026-07-07T12:00:00Z');
    mocks.prisma.activity.findMany.mockResolvedValue([
      { id: 'v1', userId: 'u1', user: { name: 'Diego' }, createdAt: at, body: JSON.stringify({ name: 'FAQ', steps: STEPS }) },
      { id: 'v0', userId: null, user: null, createdAt: at, body: 'não-json legado' },
    ]);
    const app = await makeApp();

    const res = await request(app).get('/api/bots/b1/versions').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({ id: 'v1', name: 'FAQ', rules: 1, byName: 'Diego', at: at.toISOString() });
    expect(res.body.data[1]).toMatchObject({ id: 'v0', name: null, rules: 0, byName: null });
    expect(mocks.prisma.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { targetType: 'bot', targetId: 'b1', type: 'BOT_VERSION' } }),
    );
  });

  it('POST /:id/revert volta à versão escolhida e transforma a atual em versão', async () => {
    const stepsAntigos = { rules: [{ terms: ['endereço'], responses: ['Copacabana.'] }] };
    mocks.prisma.bot.findUnique.mockResolvedValue({ id: 'b1', name: 'FAQ v2', steps: STEPS });
    mocks.prisma.activity.findFirst.mockResolvedValue({
      id: 'v1',
      body: JSON.stringify({ name: 'FAQ', steps: stepsAntigos }),
    });
    mocks.prisma.bot.update.mockResolvedValue({ id: 'b1' });
    const app = await makeApp();

    const res = await request(app).post('/api/bots/b1/revert').set(AUTH).send({ versionId: 'v1' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 'b1', name: 'FAQ', rules: 1 });
    // a versão atual foi arquivada antes do revert
    expect(mocks.prisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetType: 'bot',
        targetId: 'b1',
        type: 'BOT_VERSION',
        body: JSON.stringify({ name: 'FAQ v2', steps: STEPS }),
      }),
    });
    expect(mocks.prisma.bot.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: expect.objectContaining({ name: 'FAQ' }),
    });
  });

  it('POST /:id/revert sem versão anterior retorna 404', async () => {
    mocks.prisma.bot.findUnique.mockResolvedValue({ id: 'b1', name: 'FAQ', steps: STEPS });
    mocks.prisma.activity.findFirst.mockResolvedValue(null);
    const app = await makeApp();

    const res = await request(app).post('/api/bots/b1/revert').set(AUTH).send({});

    expect(res.status).toBe(404);
    expect(mocks.prisma.bot.update).not.toHaveBeenCalled();
    expect(mocks.prisma.activity.create).not.toHaveBeenCalled();
  });

  it('GET /risk-terms expõe a lista de termos de risco (read-only)', async () => {
    const app = await makeApp();

    const res = await request(app).get('/api/bots/risk-terms').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toContain('melanoma');
    expect(res.body.data.length).toBeGreaterThan(5);
  });

  it('POST /test aceita fluxo inline do editor sem salvar', async () => {
    const app = await makeApp();

    const res = await request(app)
      .post('/api/bots/test')
      .set(AUTH)
      .send({ text: 'endereço', flow: { rules: [{ terms: ['endereço'], responses: ['Copacabana.'] }] } });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ matched: true, ruleIndex: 0, terms: ['endereço'], responses: ['Copacabana.'] });
    // fluxo inline não consulta o banco
    expect(mocks.prisma.bot.findMany).not.toHaveBeenCalled();

    const invalid = await request(app).post('/api/bots/test').set(AUTH).send({ text: 'oi', flow: { rules: [] } });
    expect(invalid.status).toBe(400);
  });

  it('risk blocking é imutável: fluxo inline com termo de risco nunca responde', async () => {
    const app = await makeApp();

    // O fluxo tenta capturar "melanoma" — o bloqueio de risco vence sempre.
    const res = await request(app)
      .post('/api/bots/test')
      .set(AUTH)
      .send({ text: 'melanoma', flow: { rules: [{ terms: ['melanoma'], responses: ['Resposta indevida'] }] } });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ matched: false, blockedByRisk: true, responses: [] });
  });
});
