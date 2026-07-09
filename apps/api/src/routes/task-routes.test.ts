import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ponytail: supertest com o router real + auth-middleware real (verifyToken
// mockado) — cobre o wiring das rotas E o 401 sem Authorization de verdade.
const mocks = vi.hoisted(() => ({
  prisma: {
    task: {
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    conversation: {
      findUnique: vi.fn(),
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

const makeApp = async () => {
  const { default: router } = await import('./task-routes');
  const app = express();
  app.use(express.json());
  app.use('/api/tasks', router);
  return app;
};

describe('Task routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.session.findUnique.mockResolvedValue({
      token: 'good-token',
      expiresAt: new Date(Date.now() + 3600_000),
    });
  });

  it('retorna 401 sem Authorization em todos os endpoints', async () => {
    const app = await makeApp();

    expect((await request(app).get('/api/tasks')).status).toBe(401);
    expect((await request(app).post('/api/tasks').send({ title: 'x' })).status).toBe(401);
    expect((await request(app).patch('/api/tasks/t1').send({ status: 'DONE' })).status).toBe(401);
    expect(mocks.prisma.task.findMany).not.toHaveBeenCalled();
  });

  it('POST / rejeita title acima de 200 e description acima de 2000 (ACHADO 7)', async () => {
    const app = await makeApp();

    const longTitle = await request(app).post('/api/tasks').set(AUTH).send({ title: 'a'.repeat(201) });
    expect(longTitle.status).toBe(400);

    const longDesc = await request(app).post('/api/tasks').set(AUTH).send({ title: 'ok', description: 'b'.repeat(2001) });
    expect(longDesc.status).toBe(400);

    expect(mocks.prisma.task.create).not.toHaveBeenCalled();
  });

  it('GET / lista tarefas abertas por padrão (exclui DONE/CANCELED)', async () => {
    mocks.prisma.task.findMany.mockResolvedValue([{ id: 't1', title: 'Follow-up', status: 'OPEN' }]);
    const app = await makeApp();

    const res = await request(app).get('/api/tasks').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(mocks.prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { notIn: ['DONE', 'CANCELED'] } },
    }));
  });

  it('GET / re-deriva o bucket do follow-up (category) a partir do dueAt', async () => {
    const now = Date.now();
    mocks.prisma.task.findMany.mockResolvedValue([
      { id: 't1', title: 'Atrasada', status: 'OPEN', dueAt: new Date(now - 2 * 86_400_000) },
      { id: 't2', title: 'Hoje', status: 'OPEN', dueAt: new Date(now) },
      { id: 't3', title: 'Sem data', status: 'OPEN', dueAt: null },
    ]);
    const app = await makeApp();

    const res = await request(app).get('/api/tasks').set(AUTH);

    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.data.map((t: { id: string; category: string }) => [t.id, t.category]));
    expect(byId).toEqual({ t1: 'OVERDUE', t2: 'TODAY', t3: 'NO_DATE' });
  });

  it('GET /?status=DONE filtra por status válido e ignora status inválido', async () => {
    mocks.prisma.task.findMany.mockResolvedValue([]);
    const app = await makeApp();

    await request(app).get('/api/tasks?status=DONE').set(AUTH);
    expect(mocks.prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'DONE' },
    }));

    await request(app).get('/api/tasks?status=WHATEVER').set(AUTH);
    expect(mocks.prisma.task.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { status: { notIn: ['DONE', 'CANCELED'] } },
    }));
  });

  it('POST / cria tarefa com defaults e atribui ao usuário autenticado', async () => {
    mocks.prisma.task.create.mockResolvedValue({ id: 't1', title: 'Ligar pro lead' });
    const app = await makeApp();

    const res = await request(app)
      .post('/api/tasks')
      .set(AUTH)
      .send({ title: '  Ligar pro lead  ', priority: 'INVALID', dueAt: 'not-a-date' });

    expect(res.status).toBe(201);
    expect(mocks.prisma.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'Ligar pro lead',
        priority: 'MEDIUM', // prioridade inválida cai no default
        dueAt: null, // data inválida vira null
        assignedToId: 'u1',
      }),
    });
  });

  it('POST / resolve o leadId a partir da conversa quando só conversationId é enviado', async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue({ leadId: 'l9' });
    mocks.prisma.task.create.mockResolvedValue({ id: 't2' });
    const app = await makeApp();

    const res = await request(app)
      .post('/api/tasks')
      .set(AUTH)
      .send({ title: 'Responder paciente', conversationId: 'c1' });

    expect(res.status).toBe(201);
    expect(mocks.prisma.conversation.findUnique).toHaveBeenCalledWith({
      where: { id: 'c1' },
      select: { leadId: true },
    });
    expect(mocks.prisma.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ conversationId: 'c1', leadId: 'l9' }),
    });
  });

  it('POST / rejeita payload sem title com 400', async () => {
    const app = await makeApp();

    const res = await request(app).post('/api/tasks').set(AUTH).send({ title: '   ' });

    expect(res.status).toBe(400);
    expect(mocks.prisma.task.create).not.toHaveBeenCalled();
  });

  it('PATCH /:id atualiza status válido e rejeita inválido', async () => {
    mocks.prisma.task.updateMany.mockResolvedValue({ count: 1 });
    const app = await makeApp();

    const ok = await request(app).patch('/api/tasks/t1').set(AUTH).send({ status: 'DONE' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ status: 'DONE' });
    expect(mocks.prisma.task.updateMany).toHaveBeenCalledWith({ where: { id: 't1' }, data: { status: 'DONE' } });

    const bad = await request(app).patch('/api/tasks/t1').set(AUTH).send({ status: 'FEITO' });
    expect(bad.status).toBe(400);
  });

  it('PATCH /:id retorna 404 quando a tarefa não existe', async () => {
    mocks.prisma.task.updateMany.mockResolvedValue({ count: 0 });
    const app = await makeApp();

    const res = await request(app).patch('/api/tasks/ghost').set(AUTH).send({ status: 'DONE' });

    expect(res.status).toBe(404);
  });
});
