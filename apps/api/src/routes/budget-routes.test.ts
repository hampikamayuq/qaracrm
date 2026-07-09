import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mesmo padrão de task-routes.test.ts: supertest com router real + auth-middleware
// real (verifyToken mockado), prisma inteiro mockado.
const mocks = vi.hoisted(() => ({
  prisma: {
    budget: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    activity: {
      create: vi.fn(),
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
  const { default: router } = await import('./budget-routes');
  const app = express();
  app.use(express.json());
  app.use('/api/budgets', router);
  return app;
};

describe('Budget routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.session.findUnique.mockResolvedValue({
      token: 'good-token',
      expiresAt: new Date(Date.now() + 3600_000),
    });
  });

  it('retorna 401 sem Authorization em todos os endpoints', async () => {
    const app = await makeApp();
    expect((await request(app).get('/api/budgets')).status).toBe(401);
    expect((await request(app).post('/api/budgets').send({ title: 'x', amount: 1 })).status).toBe(401);
    expect((await request(app).post('/api/budgets/b1/send')).status).toBe(401);
    expect(mocks.prisma.budget.findMany).not.toHaveBeenCalled();
  });

  it('GET / lista e calcula saldo a partir dos pagamentos liquidados', async () => {
    mocks.prisma.budget.findMany.mockResolvedValue([
      {
        id: 'b1', title: 'Rinoplastia', amount: 1000, status: 'SENT',
        payments: [{ amount: 300, status: 'PAID' }, { amount: 100, status: 'PENDING' }],
      },
    ]);
    const app = await makeApp();

    const res = await request(app).get('/api/budgets').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ id: 'b1', totalPaid: 300, balance: 700 });
    expect(res.body.data[0].payments).toBeUndefined();
  });

  it('GET /?status filtra por status válido e ignora inválido', async () => {
    mocks.prisma.budget.findMany.mockResolvedValue([]);
    const app = await makeApp();

    await request(app).get('/api/budgets?status=SENT&leadId=l1').set(AUTH);
    expect(mocks.prisma.budget.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'SENT', leadId: 'l1' },
    }));

    await request(app).get('/api/budgets?status=NOPE').set(AUTH);
    expect(mocks.prisma.budget.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: {} }));
  });

  it('GET /:id retorna 404 quando não existe', async () => {
    mocks.prisma.budget.findUnique.mockResolvedValue(null);
    const app = await makeApp();
    const res = await request(app).get('/api/budgets/ghost').set(AUTH);
    expect(res.status).toBe(404);
  });

  it('POST / cria com defaults e rejeita payload inválido', async () => {
    mocks.prisma.budget.create.mockResolvedValue({ id: 'b1', title: 'Botox', amount: 800, payments: [] });
    const app = await makeApp();

    const ok = await request(app).post('/api/budgets').set(AUTH).send({ title: '  Botox ', amount: 800 });
    expect(ok.status).toBe(201);
    expect(mocks.prisma.budget.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ title: 'Botox', amount: 800, installments: 1 }),
    }));

    const bad = await request(app).post('/api/budgets').set(AUTH).send({ amount: 800 });
    expect(bad.status).toBe(400);
  });

  it('POST /:id/send transiciona DRAFT→SENT, grava sentAt e cria Activity BUDGET_SENT', async () => {
    mocks.prisma.budget.findUnique.mockResolvedValue({ id: 'b1', status: 'DRAFT', leadId: 'l1', title: 'Botox', amount: 800 });
    mocks.prisma.budget.update.mockResolvedValue({ id: 'b1', status: 'SENT', leadId: 'l1', title: 'Botox', amount: 800, payments: [] });
    const app = await makeApp();

    const res = await request(app).post('/api/budgets/b1/send').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SENT');
    expect(mocks.prisma.budget.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'b1' },
      data: expect.objectContaining({ status: 'SENT', sentAt: expect.any(Date) }),
    }));
    expect(mocks.prisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetType: 'lead', targetId: 'l1', type: 'BUDGET_SENT', userId: 'u1',
      }),
    });
  });

  it('POST /:id/send rejeita com 409 quando não está em DRAFT', async () => {
    mocks.prisma.budget.findUnique.mockResolvedValue({ id: 'b1', status: 'SENT', leadId: 'l1' });
    const app = await makeApp();

    const res = await request(app).post('/api/budgets/b1/send').set(AUTH);

    expect(res.status).toBe(409);
    expect(mocks.prisma.budget.update).not.toHaveBeenCalled();
  });

  it('POST /:id/accept transiciona SENT→ACCEPTED e grava respondedAt', async () => {
    mocks.prisma.budget.findUnique.mockResolvedValue({ id: 'b1', status: 'SENT', leadId: 'l1', title: 'X', amount: 100 });
    mocks.prisma.budget.update.mockResolvedValue({ id: 'b1', status: 'ACCEPTED', leadId: 'l1', title: 'X', amount: 100, payments: [] });
    const app = await makeApp();

    const res = await request(app).post('/api/budgets/b1/accept').set(AUTH);

    expect(res.status).toBe(200);
    expect(mocks.prisma.budget.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'ACCEPTED', respondedAt: expect.any(Date) }),
    }));
    expect(mocks.prisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'BUDGET_ACCEPTED' }),
    });
  });

  it('POST /:id/reject transiciona SENT→REJECTED sem gravar Activity', async () => {
    mocks.prisma.budget.findUnique.mockResolvedValue({ id: 'b1', status: 'SENT', leadId: 'l1', title: 'X', amount: 100 });
    mocks.prisma.budget.update.mockResolvedValue({ id: 'b1', status: 'REJECTED', leadId: 'l1', payments: [] });
    const app = await makeApp();

    const res = await request(app).post('/api/budgets/b1/reject').set(AUTH);

    expect(res.status).toBe(200);
    expect(mocks.prisma.budget.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REJECTED', respondedAt: expect.any(Date) }),
    }));
    expect(mocks.prisma.activity.create).not.toHaveBeenCalled();
  });

  it('PATCH /:id 404 quando o orçamento não existe', async () => {
    mocks.prisma.budget.findUnique.mockResolvedValue(null);
    const app = await makeApp();
    const res = await request(app).patch('/api/budgets/ghost').set(AUTH).send({ title: 'X' });
    expect(res.status).toBe(404);
    expect(mocks.prisma.budget.update).not.toHaveBeenCalled();
  });

  it('PATCH /:id a recepção PODE editar um rascunho (DRAFT)', async () => {
    // ACHADO 1: rascunho ainda não é ato financeiro — recepção pode mexer.
    mocks.prisma.session.findUnique.mockResolvedValue({ token: 'reception-token', expiresAt: new Date(Date.now() + 3600_000) });
    mocks.prisma.budget.findUnique.mockResolvedValue({ id: 'b1', status: 'DRAFT', leadId: 'l1', amount: 800, entryAmount: null });
    mocks.prisma.budget.update.mockResolvedValue({ id: 'b1', status: 'DRAFT', leadId: 'l1', amount: 900, title: 'X', payments: [] });
    const app = await makeApp();

    const res = await request(app).patch('/api/budgets/b1').set(RECEPTION_AUTH).send({ amount: 900 });

    expect(res.status).toBe(200);
    expect(mocks.prisma.budget.update).toHaveBeenCalled();
    // valor mudou → trilha BUDGET_UPDATED com de→para no body.
    expect(mocks.prisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'BUDGET_UPDATED', targetId: 'l1', body: expect.stringContaining('amount') }),
    });
  });

  it('PATCH /:id a recepção NÃO pode alterar um orçamento fora de DRAFT (403)', async () => {
    // ACHADO 1: mexer em valor de orçamento SENT/ACCEPTED é ato financeiro.
    mocks.prisma.session.findUnique.mockResolvedValue({ token: 'reception-token', expiresAt: new Date(Date.now() + 3600_000) });
    mocks.prisma.budget.findUnique.mockResolvedValue({ id: 'b1', status: 'SENT', leadId: 'l1', amount: 800, entryAmount: null });
    const app = await makeApp();

    const res = await request(app).patch('/api/budgets/b1').set(RECEPTION_AUTH).send({ amount: 900 });

    expect(res.status).toBe(403);
    expect(mocks.prisma.budget.update).not.toHaveBeenCalled();
    expect(mocks.prisma.activity.create).not.toHaveBeenCalled();
  });

  it('PATCH /:id admin altera valor de orçamento SENT e grava BUDGET_UPDATED (de→para)', async () => {
    mocks.prisma.budget.findUnique.mockResolvedValue({ id: 'b1', status: 'SENT', leadId: 'l1', amount: 800, entryAmount: null });
    mocks.prisma.budget.update.mockResolvedValue({ id: 'b1', status: 'SENT', leadId: 'l1', amount: 1200, title: 'X', payments: [] });
    const app = await makeApp();

    const res = await request(app).patch('/api/budgets/b1').set(AUTH).send({ amount: 1200 });

    expect(res.status).toBe(200);
    expect(mocks.prisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'BUDGET_UPDATED',
        targetId: 'l1',
        userId: 'u1',
        body: expect.stringContaining('800'),
      }),
    });
  });

  it('PATCH /:id sem mudança financeira (só notes) não grava BUDGET_UPDATED', async () => {
    mocks.prisma.budget.findUnique.mockResolvedValue({ id: 'b1', status: 'SENT', leadId: 'l1', amount: 800, entryAmount: null });
    mocks.prisma.budget.update.mockResolvedValue({ id: 'b1', status: 'SENT', leadId: 'l1', amount: 800, notes: 'oi', payments: [] });
    const app = await makeApp();

    const res = await request(app).patch('/api/budgets/b1').set(AUTH).send({ notes: 'oi' });

    expect(res.status).toBe(200);
    expect(mocks.prisma.activity.create).not.toHaveBeenCalled();
  });

  it('GET / não expõe telefone do lead na listagem (só id e name)', async () => {
    mocks.prisma.budget.findMany.mockResolvedValue([]);
    const app = await makeApp();
    await request(app).get('/api/budgets').set(AUTH);
    const call = mocks.prisma.budget.findMany.mock.calls[0][0];
    expect(call.include.lead).toEqual({ select: { id: true, name: true } });
  });

  it('GET /export.csv exige papel de exportação e devolve CSV', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue({ token: 'reception-token', expiresAt: new Date(Date.now() + 3600_000) });
    const app = await makeApp();
    const forbidden = await request(app).get('/api/budgets/export.csv').set(RECEPTION_AUTH);
    expect(forbidden.status).toBe(403);

    mocks.prisma.session.findUnique.mockResolvedValue({ token: 'good-token', expiresAt: new Date(Date.now() + 3600_000) });
    mocks.prisma.budget.findMany.mockResolvedValue([
      { id: 'b1', title: 'Botox', amount: 800, entryAmount: null, installments: 3, status: 'SENT', expiresAt: null, createdAt: new Date('2026-07-01'), lead: { name: 'Maria' }, payments: [{ amount: 200, status: 'PAID' }] },
    ]);
    const ok = await request(app).get('/api/budgets/export.csv').set(AUTH);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toContain('text/csv');
    expect(ok.text).toContain('Botox');
    expect(ok.text).toContain('Maria');
  });
});
