import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mesmo padrão de budget-routes.test.ts: supertest com router real + auth-middleware
// real (verifyToken mockado), prisma inteiro mockado.
const mocks = vi.hoisted(() => ({
  prisma: {
    payment: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    budget: {
      findUnique: vi.fn(),
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
  const { default: router } = await import('./payment-routes');
  const app = express();
  app.use(express.json());
  app.use('/api/payments', router);
  return app;
};

describe('Payment routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.session.findUnique.mockResolvedValue({
      token: 'good-token',
      expiresAt: new Date(Date.now() + 3600_000),
    });
  });

  it('retorna 401 sem Authorization em todos os endpoints', async () => {
    const app = await makeApp();
    expect((await request(app).get('/api/payments')).status).toBe(401);
    expect((await request(app).post('/api/payments').send({ budgetId: 'b1', amount: 1, method: 'PIX' })).status).toBe(401);
    expect((await request(app).patch('/api/payments/p1').send({ status: 'PAID' })).status).toBe(401);
    expect(mocks.prisma.payment.findMany).not.toHaveBeenCalled();
  });

  it('GET / lista pagamentos filtrando por budgetId e status', async () => {
    mocks.prisma.payment.findMany.mockResolvedValue([{ id: 'p1', budgetId: 'b1', amount: 300, status: 'PAID', method: 'PIX' }]);
    const app = await makeApp();

    const res = await request(app).get('/api/payments?budgetId=b1&status=PAID').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(mocks.prisma.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { budgetId: 'b1', status: 'PAID' },
    }));
  });

  it('GET /?status ignora status inválido', async () => {
    mocks.prisma.payment.findMany.mockResolvedValue([]);
    const app = await makeApp();
    await request(app).get('/api/payments?status=NOPE').set(AUTH);
    expect(mocks.prisma.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('POST / rejeita payload inválido (amount <= 0, method fora do enum)', async () => {
    const app = await makeApp();
    const badAmount = await request(app).post('/api/payments').set(AUTH).send({ budgetId: 'b1', amount: 0, method: 'PIX' });
    expect(badAmount.status).toBe(400);
    const badMethod = await request(app).post('/api/payments').set(AUTH).send({ budgetId: 'b1', amount: 100, method: 'BITCOIN' });
    expect(badMethod.status).toBe(400);
  });

  it('POST / retorna 404 quando o orçamento não existe', async () => {
    mocks.prisma.budget.findUnique.mockResolvedValue(null);
    const app = await makeApp();
    const res = await request(app).post('/api/payments').set(AUTH).send({ budgetId: 'ghost', amount: 100, method: 'PIX' });
    expect(res.status).toBe(404);
    expect(mocks.prisma.payment.create).not.toHaveBeenCalled();
  });

  it('POST / rejeita com 409 quando orçamento está em DRAFT/REJECTED/EXPIRED', async () => {
    mocks.prisma.budget.findUnique.mockResolvedValue({ id: 'b1', status: 'DRAFT', amount: 1000, leadId: 'l1' });
    const app = await makeApp();
    const res = await request(app).post('/api/payments').set(AUTH).send({ budgetId: 'b1', amount: 100, method: 'PIX' });
    expect(res.status).toBe(409);
    expect(mocks.prisma.payment.create).not.toHaveBeenCalled();
  });

  it('POST / exige papel financeiro/admin/marketing (recepção recebe 403)', async () => {
    // ACHADO 1: registrar pagamento é ato financeiro. A recepção (role recepcao)
    // não passa no requireReportExportRole.
    mocks.prisma.session.findUnique.mockResolvedValue({ token: 'reception-token', expiresAt: new Date(Date.now() + 3600_000) });
    const app = await makeApp();
    const res = await request(app).post('/api/payments').set(RECEPTION_AUTH).send({ budgetId: 'b1', amount: 100, method: 'PIX' });
    expect(res.status).toBe(403);
    expect(mocks.prisma.payment.create).not.toHaveBeenCalled();
  });

  it('POST / cria pagamento PAID por padrão com paidAt e trilha PAYMENT_CREATED (sem BUDGET_PAID quando não quita)', async () => {
    mocks.prisma.budget.findUnique.mockResolvedValue({ id: 'b1', status: 'SENT', amount: 1000, leadId: 'l1', title: 'Rino' });
    mocks.prisma.payment.findMany.mockResolvedValue([]);
    mocks.prisma.payment.create.mockResolvedValue({ id: 'p1', budgetId: 'b1', amount: 300, status: 'PAID', method: 'PIX', paidAt: new Date() });
    const app = await makeApp();

    const res = await request(app).post('/api/payments').set(AUTH).send({ budgetId: 'b1', amount: 300, method: 'PIX' });

    expect(res.status).toBe(201);
    expect(mocks.prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ budgetId: 'b1', amount: 300, method: 'PIX', status: 'PAID', paidAt: expect.any(Date) }),
    }));
    // trilha: PAYMENT_CREATED sempre; 300 < 1000 não quita → sem BUDGET_PAID.
    expect(mocks.prisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ targetType: 'lead', targetId: 'l1', type: 'PAYMENT_CREATED', userId: 'u1' }),
    });
    expect(mocks.prisma.activity.create).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'BUDGET_PAID' }),
    });
  });

  it('POST / cria Activity BUDGET_PAID quando a soma dos pagos quita o orçamento', async () => {
    mocks.prisma.budget.findUnique.mockResolvedValue({ id: 'b1', status: 'SENT', amount: 1000, leadId: 'l1', title: 'Rino' });
    // status incluído: o saldo agora reusa settledAmount (filtra por status).
    mocks.prisma.payment.findMany.mockResolvedValue([{ amount: 700, status: 'PAID' }]);
    mocks.prisma.payment.create.mockResolvedValue({ id: 'p2', budgetId: 'b1', amount: 300, status: 'PAID', method: 'CASH', paidAt: new Date() });
    const app = await makeApp();

    const res = await request(app).post('/api/payments').set(AUTH).send({ budgetId: 'b1', amount: 300, method: 'CASH' });

    expect(res.status).toBe(201);
    expect(mocks.prisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ targetType: 'lead', targetId: 'l1', type: 'BUDGET_PAID' }),
    });
  });

  it('POST / rejeita 422 quando o valor excede o saldo restante (orçamento já quitado)', async () => {
    // ACHADO 1: valida amount contra o saldo restante. Orçamento 1000 já com
    // 1000 liquidados → saldo 0 → qualquer valor > 0.01 é overpayment.
    mocks.prisma.budget.findUnique.mockResolvedValue({ id: 'b1', status: 'ACCEPTED', amount: 1000, leadId: 'l1', title: 'Rino' });
    mocks.prisma.payment.findMany.mockResolvedValue([{ amount: 1000, status: 'PAID' }]);
    const app = await makeApp();

    const res = await request(app).post('/api/payments').set(AUTH).send({ budgetId: 'b1', amount: 50, method: 'CASH' });

    expect(res.status).toBe(422);
    expect(mocks.prisma.payment.create).not.toHaveBeenCalled();
    expect(mocks.prisma.activity.create).not.toHaveBeenCalled();
  });

  it('POST / aceita valor exatamente igual ao saldo restante (tolerância de centavos)', async () => {
    mocks.prisma.budget.findUnique.mockResolvedValue({ id: 'b1', status: 'ACCEPTED', amount: 1000, leadId: 'l1', title: 'Rino' });
    mocks.prisma.payment.findMany.mockResolvedValue([{ amount: 700, status: 'PAID' }]);
    mocks.prisma.payment.create.mockResolvedValue({ id: 'p9', budgetId: 'b1', amount: 300, status: 'PAID', method: 'PIX', paidAt: new Date() });
    const app = await makeApp();

    const res = await request(app).post('/api/payments').set(AUTH).send({ budgetId: 'b1', amount: 300, method: 'PIX' });

    expect(res.status).toBe(201);
  });

  it('POST / com status PENDING não define paidAt e registra apenas PAYMENT_CREATED', async () => {
    mocks.prisma.budget.findUnique.mockResolvedValue({ id: 'b1', status: 'SENT', amount: 1000, leadId: 'l1' });
    mocks.prisma.payment.findMany.mockResolvedValue([]);
    mocks.prisma.payment.create.mockResolvedValue({ id: 'p4', budgetId: 'b1', amount: 300, status: 'PENDING', method: 'CREDIT', paidAt: null });
    const app = await makeApp();

    const res = await request(app).post('/api/payments').set(AUTH).send({ budgetId: 'b1', amount: 300, method: 'CREDIT', status: 'PENDING' });

    expect(res.status).toBe(201);
    expect(mocks.prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PENDING', paidAt: null }),
    }));
    // trilha PAYMENT_CREATED presente; PENDING nunca quita → sem BUDGET_PAID.
    expect(mocks.prisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'PAYMENT_CREATED' }),
    });
    expect(mocks.prisma.activity.create).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'BUDGET_PAID' }),
    });
  });

  it('PATCH /:id exige papel financeiro/admin/marketing (recepção recebe 403)', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue({ token: 'reception-token', expiresAt: new Date(Date.now() + 3600_000) });
    const app = await makeApp();
    const res = await request(app).patch('/api/payments/p1').set(RECEPTION_AUTH).send({ status: 'PAID' });
    expect(res.status).toBe(403);
    expect(mocks.prisma.payment.update).not.toHaveBeenCalled();
  });

  it('PATCH /:id retorna 404 quando o pagamento não existe', async () => {
    mocks.prisma.payment.findUnique.mockResolvedValue(null);
    const app = await makeApp();
    const res = await request(app).patch('/api/payments/ghost').set(AUTH).send({ status: 'PAID' });
    expect(res.status).toBe(404);
  });

  it('PATCH /:id rejeita com 409 quando o pagamento já está em estado terminal', async () => {
    mocks.prisma.payment.findUnique.mockResolvedValue({ id: 'p1', status: 'CANCELED', budgetId: 'b1', amount: 100 });
    const app = await makeApp();
    const res = await request(app).patch('/api/payments/p1').set(AUTH).send({ status: 'PAID' });
    expect(res.status).toBe(409);
    expect(mocks.prisma.payment.update).not.toHaveBeenCalled();
  });

  it('PATCH /:id marca PENDING → PAID com paidAt automático', async () => {
    mocks.prisma.payment.findUnique.mockResolvedValue({ id: 'p1', status: 'PENDING', budgetId: 'b1', amount: 100, paidAt: null });
    mocks.prisma.payment.findMany.mockResolvedValue([]);
    mocks.prisma.budget.findUnique.mockResolvedValue({ id: 'b1', amount: 1000, leadId: 'l1', title: 'X' });
    mocks.prisma.payment.update.mockResolvedValue({ id: 'p1', status: 'PAID', budgetId: 'b1', amount: 100, paidAt: new Date() });
    const app = await makeApp();

    const res = await request(app).patch('/api/payments/p1').set(AUTH).send({ status: 'PAID' });

    expect(res.status).toBe(200);
    expect(mocks.prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { status: 'PAID', paidAt: expect.any(Date) },
    });
  });

  it('PATCH /:id marca PARTIALLY_PAID → PAID sem contar o próprio pagamento em dobro na soma que dispara Activity', async () => {
    // Regressão: a query de soma liquidada rodava ANTES do update, então um
    // pagamento já PARTIALLY_PAID aparecia nela e era somado de novo com
    // updated.amount — sem o filtro id!=this a soma ficava inflada e podia
    // disparar BUDGET_PAID cedo demais.
    mocks.prisma.payment.findUnique.mockResolvedValue({ id: 'p1', status: 'PARTIALLY_PAID', budgetId: 'b1', amount: 400, paidAt: new Date() });
    mocks.prisma.payment.findMany.mockResolvedValue([{ amount: 400 }]); // outro pagamento liquidado, não este
    mocks.prisma.budget.findUnique.mockResolvedValue({ id: 'b1', amount: 1000, leadId: 'l1', title: 'X' });
    mocks.prisma.payment.update.mockResolvedValue({ id: 'p1', status: 'PAID', budgetId: 'b1', amount: 400, paidAt: new Date() });
    const app = await makeApp();

    const res = await request(app).patch('/api/payments/p1').set(AUTH).send({ status: 'PAID' });

    expect(res.status).toBe(200);
    expect(mocks.prisma.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { budgetId: 'b1', id: { not: 'p1' }, status: { in: ['PAID', 'PARTIALLY_PAID'] } },
    }));
    // trilha PAYMENT_UPDATED sempre; 400 (outro) + 400 (este) = 800 < 1000:
    // ainda não quita → sem BUDGET_PAID.
    expect(mocks.prisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'PAYMENT_UPDATED', targetId: 'l1' }),
    });
    expect(mocks.prisma.activity.create).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'BUDGET_PAID' }),
    });
  });

  it('PATCH /:id marca PENDING → CANCELED sem mexer em paidAt e registra PAYMENT_UPDATED', async () => {
    mocks.prisma.payment.findUnique.mockResolvedValue({ id: 'p1', status: 'PENDING', budgetId: 'b1', amount: 100, paidAt: null });
    mocks.prisma.budget.findUnique.mockResolvedValue({ id: 'b1', amount: 1000, leadId: 'l1', title: 'X' });
    mocks.prisma.payment.update.mockResolvedValue({ id: 'p1', status: 'CANCELED', budgetId: 'b1', amount: 100, paidAt: null });
    const app = await makeApp();

    const res = await request(app).patch('/api/payments/p1').set(AUTH).send({ status: 'CANCELED' });

    expect(res.status).toBe(200);
    expect(mocks.prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { status: 'CANCELED', paidAt: null },
    });
    // trilha registra a transição PENDING→CANCELED (de→para no body); cancelar
    // nunca quita.
    expect(mocks.prisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'PAYMENT_UPDATED',
        targetId: 'l1',
        body: expect.stringContaining('CANCELED'),
      }),
    });
    expect(mocks.prisma.activity.create).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'BUDGET_PAID' }),
    });
  });
});
