import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  prisma: {
    activity: { findMany: vi.fn() },
    aiSuggestion: { findMany: vi.fn() },
    appointment: { findMany: vi.fn() },
    lead: { findMany: vi.fn() },
    session: { findUnique: vi.fn() },
  },
}));

vi.mock('../lib/deps', () => ({ prisma: mocks.prisma }));
vi.mock('../lib/auth', () => ({
  verifyToken: vi.fn((token: string) => (token === 'good-token' ? { userId: 'u1', role: 'ADMIN' } : null)),
}));

const AUTH = { Authorization: 'Bearer good-token' };

const makeApp = async () => {
  const { default: router } = await import('./activity-routes');
  const app = express();
  app.use(express.json());
  app.use('/api/activities', router);
  return app;
};

describe('Activity feed route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.session.findUnique.mockResolvedValue({
      token: 'good-token',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    mocks.prisma.activity.findMany.mockResolvedValue([]);
    mocks.prisma.aiSuggestion.findMany.mockResolvedValue([]);
    mocks.prisma.appointment.findMany.mockResolvedValue([]);
    mocks.prisma.lead.findMany.mockResolvedValue([]);
  });

  it('retorna 401 sem Authorization', async () => {
    const app = await makeApp();
    expect((await request(app).get('/api/activities/feed')).status).toBe(401);
    expect(mocks.prisma.activity.findMany).not.toHaveBeenCalled();
  });

  it('agrega movimentos, notas, bots, sugestões aprovadas e agendamentos, ordenado desc', async () => {
    mocks.prisma.activity.findMany.mockResolvedValue([
      {
        id: 'a1', type: 'STAGE_CHANGE', targetType: 'lead', targetId: 'l1', title: null,
        userId: 'u1', user: { name: 'Diego' }, createdAt: new Date('2026-07-07T10:00:00.000Z'),
        body: JSON.stringify({ type: 'stage_change', from: 'novo-lead', to: 'agendado' }),
      },
      {
        id: 'a2', type: 'BOT_VERSION', targetType: 'bot', targetId: 'b1', title: 'Versão de "FAQ"',
        userId: 'u1', user: { name: 'Diego' }, createdAt: new Date('2026-07-07T09:00:00.000Z'),
        body: '{}',
      },
      {
        id: 'a3', type: 'NOTE', targetType: 'lead', targetId: 'l1', title: null,
        userId: null, user: null, createdAt: new Date('2026-07-07T08:00:00.000Z'),
        body: 'Paciente confirmou por telefone',
      },
    ]);
    mocks.prisma.lead.findMany.mockResolvedValue([{ id: 'l1', name: 'Maria' }]);
    mocks.prisma.aiSuggestion.findMany.mockResolvedValue([
      {
        id: 's1', status: 'APPROVED', body: 'Podemos agendar quinta?',
        decidedAt: new Date('2026-07-07T11:00:00.000Z'), createdAt: new Date('2026-07-07T10:30:00.000Z'),
        approvedBy: { name: 'Recepção' }, conversation: { lead: { name: 'Maria' } },
      },
    ]);
    mocks.prisma.appointment.findMany.mockResolvedValue([
      {
        id: 'ap1', createdAt: new Date('2026-07-07T07:00:00.000Z'), scheduledAt: new Date('2026-07-10T14:00:00.000Z'),
        lead: { name: 'Maria' }, patient: null, professional: { name: 'Dra. Ana' },
      },
    ]);
    const app = await makeApp();

    const res = await request(app).get('/api/activities/feed?period=7d').set(AUTH);

    expect(res.status).toBe(200);
    const data = res.body.data as Array<{ type: string; at: string; title: string; byName?: string | null }>;

    // desc por data
    const dates = data.map((i) => i.at);
    expect([...dates].sort().reverse()).toEqual(dates);

    const byType = Object.fromEntries(data.map((i) => [i.type, i]));
    expect(byType.stage_change.title).toBe('Maria: Novo lead → Agendado');
    expect(byType.bot.title).toBe('Versão de "FAQ"');
    expect(byType.note).toMatchObject({ title: 'Nota em Maria', byName: 'Tawany' });
    expect(byType.suggestion).toMatchObject({ title: 'Sugestão da Tawany aprovada — Maria', byName: 'Recepção' });
    expect(byType.appointment.title).toContain('Agendamento criado: Maria');

    // período 7d aplicado no where das três fontes
    const activityWhere = mocks.prisma.activity.findMany.mock.calls[0][0].where;
    const sinceMs = Date.now() - activityWhere.createdAt.gte.getTime();
    expect(sinceMs).toBeGreaterThan(6.9 * 24 * 3600_000);
    expect(sinceMs).toBeLessThan(7.1 * 24 * 3600_000);
  });

  it('usa 24h como período default e ignora period inválido', async () => {
    const app = await makeApp();

    await request(app).get('/api/activities/feed?period=1y').set(AUTH);

    const activityWhere = mocks.prisma.activity.findMany.mock.calls[0][0].where;
    const sinceMs = Date.now() - activityWhere.createdAt.gte.getTime();
    expect(sinceMs).toBeGreaterThan(23 * 3600_000);
    expect(sinceMs).toBeLessThan(25 * 3600_000);
  });
});
