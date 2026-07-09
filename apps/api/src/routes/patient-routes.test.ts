import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mesmo padrão de budget-routes.test.ts: supertest com router real + auth-middleware
// real (verifyToken mockado), prisma inteiro mockado.
const mocks = vi.hoisted(() => ({
  prisma: {
    patient: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    lead: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    conversation: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    appointment: { findMany: vi.fn() },
    budget: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    chatMessage: { findMany: vi.fn() },
    activity: { findMany: vi.fn(), create: vi.fn() },
    session: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../lib/deps', () => ({ prisma: mocks.prisma }));
vi.mock('../lib/auth', () => ({
  verifyToken: vi.fn((token: string) => (token === 'good-token' ? { userId: 'u1', role: 'admin' } : null)),
}));

const AUTH = { Authorization: 'Bearer good-token' };

const makeApp = async () => {
  const { default: router } = await import('./patient-routes');
  const app = express();
  app.use(express.json());
  app.use('/api/patients', router);
  return app;
};

describe('Patient routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.session.findUnique.mockResolvedValue({
      token: 'good-token',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    // Defaults para timeline vazia.
    mocks.prisma.conversation.findMany.mockResolvedValue([]);
    mocks.prisma.appointment.findMany.mockResolvedValue([]);
    mocks.prisma.budget.findMany.mockResolvedValue([]);
    mocks.prisma.task.findMany.mockResolvedValue([]);
    mocks.prisma.chatMessage.findMany.mockResolvedValue([]);
    mocks.prisma.activity.findMany.mockResolvedValue([]);
    // $transaction executa a callback com o próprio prisma mockado.
    mocks.prisma.$transaction.mockImplementation((fn: (tx: typeof mocks.prisma) => unknown) => fn(mocks.prisma));
  });

  it('retorna 401 sem Authorization em todos os endpoints', async () => {
    const app = await makeApp();
    expect((await request(app).get('/api/patients')).status).toBe(401);
    expect((await request(app).get('/api/patients/p1')).status).toBe(401);
    expect((await request(app).post('/api/patients').send({ name: 'x' })).status).toBe(401);
    expect((await request(app).post('/api/patients/convert-from-lead/l1')).status).toBe(401);
    expect(mocks.prisma.patient.findMany).not.toHaveBeenCalled();
  });

  it('GET / lista com paginação e envelope { items, total, page }', async () => {
    mocks.prisma.patient.findMany.mockResolvedValue([{ id: 'p1', name: 'Maria' }]);
    mocks.prisma.patient.count.mockResolvedValue(1);
    const app = await makeApp();

    const res = await request(app).get('/api/patients?page=2&pageSize=10').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 1, page: 2 });
    expect(res.body.data.items[0].id).toBe('p1');
    expect(mocks.prisma.patient.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
  });

  it('GET /?search filtra por nome (ILIKE) e telefone', async () => {
    mocks.prisma.patient.findMany.mockResolvedValue([]);
    mocks.prisma.patient.count.mockResolvedValue(0);
    const app = await makeApp();

    await request(app).get('/api/patients?search=Ana').set(AUTH);

    expect(mocks.prisma.patient.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          { name: { contains: 'Ana', mode: 'insensitive' } },
          { phone: { contains: 'Ana' } },
        ],
      },
    }));
  });

  it('GET /:id retorna 404 quando não existe', async () => {
    mocks.prisma.patient.findUnique.mockResolvedValue(null);
    const app = await makeApp();
    const res = await request(app).get('/api/patients/ghost').set(AUTH);
    expect(res.status).toBe(404);
  });

  it('GET /:id devolve paciente com timeline montada de consultas e orçamentos', async () => {
    mocks.prisma.patient.findUnique.mockResolvedValue({
      id: 'p1', name: 'Maria', leadId: 'l1', lead: { id: 'l1', name: 'Maria', tags: ['status:atendido'] },
    });
    mocks.prisma.appointment.findMany.mockResolvedValue([
      { id: 'a1', scheduledAt: new Date('2026-07-01T14:00:00Z'), status: 'CONFIRMED', value: null, createdAt: new Date('2026-06-20T10:00:00Z'), professional: { name: 'Dra. X' }, service: { name: 'Botox' } },
    ]);
    mocks.prisma.budget.findMany.mockResolvedValue([
      { id: 'b1', title: 'Rinoplastia', amount: 1000, status: 'ACCEPTED', sentAt: new Date('2026-06-22T10:00:00Z'), respondedAt: new Date('2026-06-23T10:00:00Z'), createdAt: new Date('2026-06-21T10:00:00Z') },
    ]);
    const app = await makeApp();

    const res = await request(app).get('/api/patients/p1').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.lead).toMatchObject({ id: 'l1', stage: 'atendido' });
    const types = res.body.data.timeline.map((t: { type: string }) => t.type);
    expect(types).toContain('appointment');
    expect(types).toContain('budget');
    // ordenada desc: item mais recente primeiro
    const ats = res.body.data.timeline.map((t: { at: string }) => t.at);
    expect([...ats].sort((a, b) => b.localeCompare(a))).toEqual(ats);
  });

  it('POST / cria paciente e rejeita payload sem name', async () => {
    mocks.prisma.patient.create.mockResolvedValue({ id: 'p1', name: 'Maria' });
    const app = await makeApp();

    const ok = await request(app).post('/api/patients').set(AUTH).send({ name: '  Maria ', phone: '5599' });
    expect(ok.status).toBe(201);
    expect(mocks.prisma.patient.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: 'Maria', phone: '5599', lgpdConsent: false }),
    }));

    const bad = await request(app).post('/api/patients').set(AUTH).send({ phone: '5599' });
    expect(bad.status).toBe(400);
    expect(mocks.prisma.patient.create).toHaveBeenCalledTimes(1);
  });

  it('PATCH /:id atualiza campos e 404 quando não existe', async () => {
    mocks.prisma.patient.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.patient.findUnique.mockResolvedValue({ id: 'p1', name: 'Maria Silva' });
    const app = await makeApp();

    const ok = await request(app).patch('/api/patients/p1').set(AUTH).send({ name: 'Maria Silva', notesAdministrative: null });
    expect(ok.status).toBe(200);
    expect(mocks.prisma.patient.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'p1' },
      data: expect.objectContaining({ name: 'Maria Silva', notesAdministrative: null }),
    }));

    mocks.prisma.patient.updateMany.mockResolvedValue({ count: 0 });
    const missing = await request(app).patch('/api/patients/ghost').set(AUTH).send({ name: 'X' });
    expect(missing.status).toBe(404);
  });

  it('PATCH /:id rejeita payload vazio', async () => {
    const app = await makeApp();
    const res = await request(app).patch('/api/patients/p1').set(AUTH).send({});
    expect(res.status).toBe(400);
    expect(mocks.prisma.patient.updateMany).not.toHaveBeenCalled();
  });

  it('POST /convert-from-lead/:leadId cria paciente, vincula conversas, move estágio e grava LEAD_CONVERTED', async () => {
    mocks.prisma.lead.findUnique.mockResolvedValue({ id: 'l1', name: 'Maria', phone: '5599', email: null, tags: ['status:qualificado', 'pipeline:cirurgia'] });
    mocks.prisma.patient.findFirst.mockResolvedValue(null);
    mocks.prisma.patient.create.mockResolvedValue({ id: 'p1', name: 'Maria', leadId: 'l1' });
    mocks.prisma.conversation.updateMany.mockResolvedValue({ count: 2 });
    mocks.prisma.lead.update.mockResolvedValue({ id: 'l1' });
    const app = await makeApp();

    const res = await request(app).post('/api/patients/convert-from-lead/l1').set(AUTH);

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe('p1');
    expect(mocks.prisma.patient.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: 'Maria', phone: '5599', leadId: 'l1' }),
    }));
    expect(mocks.prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { leadId: 'l1', patientId: null },
      data: { patientId: 'p1' },
    });
    // tag de estágio movida para atendido, preservando a pipeline
    expect(mocks.prisma.lead.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'l1' },
      data: { tags: expect.arrayContaining(['pipeline:cirurgia', 'status:atendido']) },
    }));
    const types = mocks.prisma.activity.create.mock.calls.map((c) => c[0].data.type);
    expect(types).toContain('STAGE_CHANGE');
    expect(types).toContain('LEAD_CONVERTED');
  });

  it('POST /convert-from-lead/:leadId é idempotente: devolve paciente existente sem recriar', async () => {
    mocks.prisma.lead.findUnique.mockResolvedValue({ id: 'l1', name: 'Maria', phone: null, email: null, tags: [] });
    mocks.prisma.patient.findFirst.mockResolvedValue({ id: 'p9', name: 'Maria', leadId: 'l1' });
    const app = await makeApp();

    const res = await request(app).post('/api/patients/convert-from-lead/l1').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 'p9', alreadyConverted: true });
    expect(mocks.prisma.patient.create).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('POST /convert-from-lead/:leadId retorna 404 quando lead não existe', async () => {
    mocks.prisma.lead.findUnique.mockResolvedValue(null);
    const app = await makeApp();
    const res = await request(app).post('/api/patients/convert-from-lead/ghost').set(AUTH);
    expect(res.status).toBe(404);
  });
});
