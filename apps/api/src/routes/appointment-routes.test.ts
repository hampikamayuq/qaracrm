import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ponytail: supertest com o router real + auth-middleware real (verifyToken
// mockado) — mesmo padrão de task-routes.test.ts.
const mocks = vi.hoisted(() => ({
  prisma: {
    appointment: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    professional: {
      findMany: vi.fn(),
    },
    clinicUnit: {
      findMany: vi.fn(),
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
  const { default: router } = await import('./appointment-routes');
  const app = express();
  app.use(express.json());
  app.use('/api/appointments', router);
  return app;
};

describe('Appointment routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.session.findUnique.mockResolvedValue({
      token: 'good-token',
      expiresAt: new Date(Date.now() + 3600_000),
    });
  });

  it('retorna 401 sem Authorization em todos os endpoints', async () => {
    const app = await makeApp();

    expect((await request(app).get('/api/appointments')).status).toBe(401);
    expect((await request(app).get('/api/appointments/professionals')).status).toBe(401);
    expect((await request(app).get('/api/appointments/units')).status).toBe(401);
    expect((await request(app).get('/api/appointments/export.ics')).status).toBe(401);
    expect((await request(app).post('/api/appointments').send({ scheduledAt: '2026-07-10T14:00:00Z' })).status).toBe(401);
    expect((await request(app).patch('/api/appointments/a1').send({ status: 'CONFIRMED' })).status).toBe(401);
    expect(mocks.prisma.appointment.findMany).not.toHaveBeenCalled();
  });

  it('GET / filtra por intervalo de datas, profissional e status', async () => {
    mocks.prisma.appointment.findMany.mockResolvedValue([{ id: 'a1' }]);
    const app = await makeApp();

    const res = await request(app)
      .get('/api/appointments?from=2026-07-01T00:00:00Z&to=2026-07-31T23:59:59Z&professionalId=p1&status=CONFIRMED')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 'a1' }]);
    expect(mocks.prisma.appointment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        scheduledAt: {
          gte: new Date('2026-07-01T00:00:00Z'),
          lte: new Date('2026-07-31T23:59:59Z'),
        },
        professionalId: 'p1',
        status: 'CONFIRMED',
      },
      orderBy: { scheduledAt: 'asc' },
    }));
  });

  it('GET / rejeita datas inválidas e status desconhecido com 400', async () => {
    const app = await makeApp();

    expect((await request(app).get('/api/appointments?from=not-a-date').set(AUTH)).status).toBe(400);
    expect((await request(app).get('/api/appointments?status=REMARCADO').set(AUTH)).status).toBe(400);
    expect(mocks.prisma.appointment.findMany).not.toHaveBeenCalled();
  });

  it('POST / cria agendamento com unitId/endAt e converte datas', async () => {
    mocks.prisma.appointment.create.mockResolvedValue({ id: 'a1' });
    const app = await makeApp();

    const res = await request(app)
      .post('/api/appointments')
      .set(AUTH)
      .send({
        scheduledAt: '2026-07-10T14:00:00.000Z',
        endAt: '2026-07-10T14:30:00.000Z',
        leadId: 'l1',
        professionalId: 'p1',
        unitId: 'u1',
        notes: 'primeira consulta',
        ignored: 'x',
      });

    expect(res.status).toBe(201);
    expect(mocks.prisma.appointment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        scheduledAt: new Date('2026-07-10T14:00:00.000Z'),
        endAt: new Date('2026-07-10T14:30:00.000Z'),
        leadId: 'l1',
        professionalId: 'p1',
        unitId: 'u1',
        notes: 'primeira consulta',
      },
    }));
  });

  it('POST / rejeita scheduledAt ausente ou inválido', async () => {
    const app = await makeApp();

    expect((await request(app).post('/api/appointments').set(AUTH).send({ leadId: 'l1' })).status).toBe(400);
    expect((await request(app).post('/api/appointments').set(AUTH).send({ scheduledAt: 'nope' })).status).toBe(400);
    expect(mocks.prisma.appointment.create).not.toHaveBeenCalled();
  });

  it('PATCH /:id muda status válido, rejeita inventado e retorna 404 quando não existe', async () => {
    mocks.prisma.appointment.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.appointment.findUnique.mockResolvedValue({ id: 'a1', status: 'NO_SHOW' });
    const app = await makeApp();

    const ok = await request(app).patch('/api/appointments/a1').set(AUTH).send({ status: 'NO_SHOW' });
    expect(ok.status).toBe(200);
    expect(mocks.prisma.appointment.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { status: 'NO_SHOW' },
    });

    const bad = await request(app).patch('/api/appointments/a1').set(AUTH).send({ status: 'REMARCADO' });
    expect(bad.status).toBe(400);

    mocks.prisma.appointment.updateMany.mockResolvedValue({ count: 0 });
    const ghost = await request(app).patch('/api/appointments/ghost').set(AUTH).send({ status: 'CONFIRMED' });
    expect(ghost.status).toBe(404);
  });

  it('GET /professionals lista profissionais ativos para o filtro', async () => {
    mocks.prisma.professional.findMany.mockResolvedValue([
      { id: 'p1', name: 'Dra. Ana', specialty: 'TRICOLOGIA' },
    ]);
    const app = await makeApp();

    const res = await request(app).get('/api/appointments/professionals').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(mocks.prisma.professional.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { active: true },
    }));
  });

  it('GET /units lista unidades ativas', async () => {
    mocks.prisma.clinicUnit.findMany.mockResolvedValue([{ id: 'un1', name: 'Rio de Janeiro', city: 'RJ' }]);
    const app = await makeApp();

    const res = await request(app).get('/api/appointments/units').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data[0].name).toBe('Rio de Janeiro');
  });

  it('GET /export.ics gera iCalendar válido com UID/DTSTART/DTEND/SUMMARY escapado', async () => {
    mocks.prisma.appointment.findMany.mockResolvedValue([
      {
        id: 'a1',
        scheduledAt: new Date('2026-07-10T14:00:00.000Z'),
        endAt: null,
        status: 'CONFIRMED',
        lead: { name: 'Maria; Silva, Ltda' },
        patient: null,
        professional: { name: 'Dra. Ana' },
      },
    ]);
    const app = await makeApp();

    const res = await request(app)
      .get('/api/appointments/export.ics?from=2026-07-01T00:00:00Z&to=2026-07-31T00:00:00Z')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.text).toContain('BEGIN:VCALENDAR');
    expect(res.text).toContain('UID:a1@qara-clinic');
    expect(res.text).toContain('DTSTART:20260710T140000Z');
    // endAt nulo → 30 min de duração default
    expect(res.text).toContain('DTEND:20260710T143000Z');
    expect(res.text).toContain('SUMMARY:Consulta: Maria\\; Silva\\, Ltda — Dra. Ana — Confirmado');
    expect(res.text).toContain('END:VCALENDAR');
    // filtro de datas passa pelo mesmo builder do GET /
    expect(mocks.prisma.appointment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { scheduledAt: { gte: new Date('2026-07-01T00:00:00Z'), lte: new Date('2026-07-31T00:00:00Z') } },
    }));
  });
});
