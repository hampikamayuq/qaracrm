import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mesmo padrão de tags-routes.test.ts: supertest com router real +
// auth-middleware real (verifyToken mockado), prisma inteiro mockado.
const mocks = vi.hoisted(() => ({
  prisma: {
    lead: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    conversation: {
      findMany: vi.fn(),
    },
    appointment: {
      count: vi.fn(),
    },
    task: {
      count: vi.fn(),
    },
    activity: {
      findMany: vi.fn(),
    },
    aiRunLog: {
      findMany: vi.fn(),
    },
    session: {
      findUnique: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

vi.mock('../lib/deps', () => ({ prisma: mocks.prisma }));
vi.mock('../lib/auth', () => ({
  verifyToken: vi.fn((token: string) => (token === 'good-token' ? { userId: 'u1', role: 'ADMIN' } : null)),
}));

const AUTH = { Authorization: 'Bearer good-token' };

// Data fixa para janelas de período determinísticas (só o relógio de Date,
// timers reais para o supertest não travar).
const NOW = new Date('2026-07-07T15:00:00Z');

const makeApp = async () => {
  const { default: router } = await import('./dashboard-routes');
  const app = express();
  app.use(express.json());
  app.use('/api/dashboard', router);
  return app;
};

const at = (iso: string): Date => new Date(iso);

describe('Dashboard routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    mocks.prisma.session.findUnique.mockResolvedValue({
      token: 'good-token',
      expiresAt: new Date(Date.now() + 3600_000),
    });
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('retorna 401 sem Authorization em todos os endpoints', async () => {
    const app = await makeApp();

    for (const path of [
      '/summary', '/funnel', '/leads-per-day', '/sources', '/loss-reasons', '/tawany', '/response-time',
    ]) {
      expect((await request(app).get(`/api/dashboard${path}`)).status).toBe(401);
    }
    expect(mocks.prisma.lead.findMany).not.toHaveBeenCalled();
  });

  it('retorna 400 para period inválido', async () => {
    const app = await makeApp();

    for (const path of ['/summary', '/leads-per-day', '/sources', '/loss-reasons', '/tawany', '/response-time']) {
      const res = await request(app).get(`/api/dashboard${path}?period=1y`).set(AUTH);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    }
  });

  it('GET /summary agrega os cinco cards', async () => {
    mocks.prisma.lead.findMany.mockResolvedValue([
      { tags: ['status:novo-lead'] },
      { tags: ['status:agendado', 'pipeline:cirurgia'] },
      { tags: ['status:perdido-preco'] },
      { tags: ['status:alta-manutencao'] },
      { tags: [] }, // sem tag de status → novo-lead (ativo)
    ]);
    mocks.prisma.conversation.findMany.mockResolvedValue([
      { needsHuman: true, messages: [] },
      { needsHuman: false, messages: [{ direction: 'IN' }] },
      { needsHuman: false, messages: [{ direction: 'OUT' }] },
      { needsHuman: false, messages: [] },
    ]);
    mocks.prisma.appointment.count.mockResolvedValue(5);
    mocks.prisma.task.count.mockResolvedValue(3);
    mocks.prisma.lead.count.mockResolvedValueOnce(10).mockResolvedValueOnce(8);
    const app = await makeApp();

    const res = await request(app).get('/api/dashboard/summary').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      leadsAtivos: 3,
      aguardandoResposta: 2,
      agendamentosSemana: 5,
      followupsAtrasados: 3,
      novosNoPeriodo: { atual: 10, anterior: 8, variacaoPct: 25 },
    });
    // followups atrasados = tasks pendentes vencidas antes de hoje
    expect(mocks.prisma.task.count).toHaveBeenCalledWith({
      where: { status: { in: ['TODO', 'pending', 'OPEN'] }, dueAt: { lt: at('2026-07-07T00:00:00Z') } },
    });
  });

  it('GET /summary devolve variacaoPct null sem base de comparação', async () => {
    mocks.prisma.lead.findMany.mockResolvedValue([]);
    mocks.prisma.conversation.findMany.mockResolvedValue([]);
    mocks.prisma.appointment.count.mockResolvedValue(0);
    mocks.prisma.task.count.mockResolvedValue(0);
    mocks.prisma.lead.count.mockResolvedValueOnce(4).mockResolvedValueOnce(0);
    const app = await makeApp();

    const res = await request(app).get('/api/dashboard/summary?period=7d').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.novosNoPeriodo).toEqual({ atual: 4, anterior: 0, variacaoPct: null });
  });

  it('GET /funnel conta por estágio canônico na ordem do funil', async () => {
    mocks.prisma.lead.findMany.mockResolvedValue([
      { tags: ['status:novo-lead'] },
      { tags: ['status:novo-lead'] },
      { tags: ['status:qualificado'] },
      { tags: ['status:agendado'] },
      { tags: ['status:perdido-preco'] }, // fora do funil descendente
      { tags: ['status:NOVO'] }, // legado → novo-lead
    ]);
    const app = await makeApp();

    const res = await request(app).get('/api/dashboard/funnel').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { stage: 'novo-lead', label: 'Novo lead', count: 3 },
      { stage: 'qualificado', label: 'Qualificado', count: 1 },
      { stage: 'horario-oferecido', label: 'Horário oferecido', count: 0 },
      { stage: 'agendado', label: 'Agendado', count: 1 },
      { stage: 'confirmado', label: 'Confirmado', count: 0 },
      { stage: 'atendido', label: 'Compareceu', count: 0 },
    ]);
  });

  it('GET /funnel filtra por pipeline e valida slug', async () => {
    mocks.prisma.lead.findMany.mockResolvedValue([
      { tags: ['status:qualificado', 'pipeline:cirurgia'] },
      { tags: ['status:qualificado', 'pipeline:tricologia'] },
      { tags: ['status:qualificado'] },
    ]);
    const app = await makeApp();

    const res = await request(app).get('/api/dashboard/funnel?pipeline=cirurgia').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data.find((s: { stage: string }) => s.stage === 'qualificado').count).toBe(1);

    const bad = await request(app).get('/api/dashboard/funnel?pipeline=ortopedia').set(AUTH);
    expect(bad.status).toBe(400);
  });

  it('GET /leads-per-day devolve série zero-filled + período anterior', async () => {
    // period=7d com NOW 2026-07-07 → janela 01–07/jul, anterior 24–30/jun
    mocks.prisma.lead.findMany.mockResolvedValue([
      { createdAt: at('2026-07-07T10:00:00Z') },
      { createdAt: at('2026-07-07T13:00:00Z') },
      { createdAt: at('2026-07-05T08:00:00Z') },
      { createdAt: at('2026-06-25T09:00:00Z') }, // período anterior
    ]);
    const app = await makeApp();

    const res = await request(app).get('/api/dashboard/leads-per-day?period=7d').set(AUTH);

    expect(res.status).toBe(200);
    const { series, previous } = res.body.data;
    expect(series).toHaveLength(7);
    expect(previous).toHaveLength(7);
    expect(series[0]).toEqual({ date: '2026-07-01', count: 0 });
    expect(series[4]).toEqual({ date: '2026-07-05', count: 1 });
    expect(series[6]).toEqual({ date: '2026-07-07', count: 2 });
    expect(previous[1]).toEqual({ date: '2026-06-25', count: 1 });
    // filtro no banco cobre as duas janelas de uma vez
    expect(mocks.prisma.lead.findMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: at('2026-06-24T00:00:00Z') } },
      select: { createdAt: true },
    });
  });

  it('GET /sources agrupa no banco e nomeia origem nula', async () => {
    mocks.prisma.lead.groupBy.mockResolvedValue([
      { source: null, _count: { _all: 2 } },
      { source: 'instagram', _count: { _all: 5 } },
      { source: 'google', _count: { _all: 3 } },
    ]);
    const app = await makeApp();

    const res = await request(app).get('/api/dashboard/sources').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { source: 'instagram', count: 5 },
      { source: 'google', count: 3 },
      { source: 'desconhecido', count: 2 },
    ]);
    expect(mocks.prisma.lead.groupBy).toHaveBeenCalledWith(expect.objectContaining({ by: ['source'] }));
  });

  it('GET /loss-reasons conta um motivo por lead (o mais recente)', async () => {
    // Ordem desc por createdAt: o primeiro evento de cada lead vence.
    mocks.prisma.activity.findMany.mockResolvedValue([
      { targetId: 'lead-a', body: JSON.stringify({ type: 'stage_change', to: 'perdido', lostReason: 'preco' }) },
      { targetId: 'lead-a', body: JSON.stringify({ type: 'stage_change', to: 'perdido', lostReason: 'horario' }) },
      { targetId: 'lead-b', body: JSON.stringify({ type: 'stage_change', to: 'perdido', lostReason: 'preco' }) },
      { targetId: 'lead-c', body: JSON.stringify({ type: 'stage_change', to: 'perdido', lostReason: 'sem-resposta' }) },
      { targetId: 'lead-d', body: 'corpo legado não-JSON' },
      { targetId: 'lead-e', body: JSON.stringify({ type: 'stage_change', to: 'qualificado' }) },
    ]);
    const app = await makeApp();

    const res = await request(app).get('/api/dashboard/loss-reasons').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { reason: 'preco', count: 2 },
      { reason: 'sem-resposta', count: 1 },
    ]);
    expect(mocks.prisma.activity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { createdAt: 'desc' },
      where: expect.objectContaining({ type: 'STAGE_CHANGE', body: { contains: '"to":"perdido"' } }),
    }));
  });

  it('GET /tawany agrega respostas, handoffs, bloqueios, latência e fallback', async () => {
    const run = (over: Record<string, unknown>) => ({
      createdAt: at('2026-07-06T12:00:00Z'),
      reason: 'replied',
      success: true,
      latencyMs: null,
      fallbackUsed: false,
      totalTokens: 0,
      estimatedCostCents: 0,
      ...over,
    });
    mocks.prisma.aiRunLog.findMany.mockResolvedValue([
      run({ createdAt: at('2026-07-07T09:00:00Z'), latencyMs: 1000, totalTokens: 100, estimatedCostCents: 3 }),
      run({ createdAt: at('2026-07-07T10:00:00Z'), latencyMs: 2000, totalTokens: 200, estimatedCostCents: 4 }),
      run({}),
      run({ success: false, reason: 'guard_failed: price_not_in_kb: 500' }),
      run({ success: false, reason: 'guard_failed: price_not_in_kb: 500' }),
      run({ success: false, reason: 'injection_blocked', fallbackUsed: true }),
      run({ success: false, reason: 'max_iterations' }),
      run({ success: false, reason: 'conversation_closed' }), // skip: fora da taxa
    ]);
    const app = await makeApp();

    const res = await request(app).get('/api/dashboard/tawany?period=7d').set(AUTH);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.respostas).toBe(3);
    expect(data.handoffs).toBe(4);
    expect(data.taxaHandoffPct).toBe(57.1);
    expect(data.bloqueios).toEqual([
      { motivo: 'price_not_in_kb: 500', count: 2 },
      { motivo: 'injection_blocked', count: 1 },
    ]);
    expect(data.latenciaMediaMs).toBe(1500);
    expect(data.fallbacks).toBe(1);
    expect(data.total).toBe(8);
    expect(data.tokens).toBe(300);
    expect(data.estimatedCostCents).toBe(7);
    expect(data.perDay).toHaveLength(7);
    expect(data.perDay[6]).toEqual({ date: '2026-07-07', count: 2 });
    expect(data.perDay[5]).toEqual({ date: '2026-07-06', count: 1 });
  });

  it('GET /response-time devolve mediana, média e variação vs período anterior', async () => {
    mocks.prisma.$queryRaw
      .mockResolvedValueOnce([{ median_s: 120, avg_s: 300, n: 4 }])
      .mockResolvedValueOnce([{ median_s: 240, avg_s: 280, n: 5 }]);
    const app = await makeApp();

    const res = await request(app).get('/api/dashboard/response-time').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      medianaMin: 2,
      mediaMin: 5,
      conversas: 4,
      medianaAnteriorMin: 4,
      variacaoPct: -50,
    });
  });

  it('GET /response-time sem conversas no período devolve nulls', async () => {
    mocks.prisma.$queryRaw
      .mockResolvedValueOnce([{ median_s: null, avg_s: null, n: 0 }])
      .mockResolvedValueOnce([]);
    const app = await makeApp();

    const res = await request(app).get('/api/dashboard/response-time?period=90d').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      medianaMin: null,
      mediaMin: null,
      conversas: 0,
      medianaAnteriorMin: null,
      variacaoPct: null,
    });
  });
});
