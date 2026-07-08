import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mesmo padrão de dashboard-routes.test.ts: supertest com router real +
// auth-middleware real (verifyToken mockado), prisma inteiro mockado.
const mocks = vi.hoisted(() => ({
  prisma: {
    lead: {
      findMany: vi.fn(),
    },
    activity: {
      findMany: vi.fn(),
    },
    chatMessage: {
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
  verifyToken: vi.fn((token: string) => {
    if (token === 'good-token') return { userId: 'u1', role: 'ADMIN' };
    if (token === 'reception-token') return { userId: 'u2', role: 'recepcao' };
    return null;
  }),
}));

const AUTH = { Authorization: 'Bearer good-token' };
const RECEPTION_AUTH = { Authorization: 'Bearer reception-token' };

// Data fixa para janelas de período determinísticas (só o relógio de Date,
// timers reais para o supertest não travar).
const NOW = new Date('2026-07-07T15:00:00Z');

const makeApp = async () => {
  const { default: router } = await import('./report-routes');
  const app = express();
  app.use(express.json());
  app.use('/api/reports', router);
  return app;
};

const at = (iso: string): Date => new Date(iso);

describe('Report routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    mocks.prisma.session.findUnique.mockResolvedValue({
      token: 'good-token',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    mocks.prisma.lead.findMany.mockResolvedValue([]);
    mocks.prisma.activity.findMany.mockResolvedValue([]);
    mocks.prisma.chatMessage.findMany.mockResolvedValue([]);
    mocks.prisma.aiRunLog.findMany.mockResolvedValue([]);
    mocks.prisma.$queryRaw.mockResolvedValue([]);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('retorna 401 sem Authorization em todos os endpoints', async () => {
    const app = await makeApp();

    for (const path of ['/comercial', '/atendimento', '/tawany', '/comercial/export.csv']) {
      expect((await request(app).get(`/api/reports${path}`)).status).toBe(401);
    }
    expect(mocks.prisma.lead.findMany).not.toHaveBeenCalled();
  });

  it('retorna 400 para period inválido', async () => {
    const app = await makeApp();

    for (const path of ['/comercial', '/atendimento', '/tawany', '/tawany/export.csv']) {
      const res = await request(app).get(`/api/reports${path}?period=1y`).set(AUTH);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    }
  });

  it('bloqueia export CSV para usuário sem papel financeiro/admin/marketing', async () => {
    const app = await makeApp();

    const res = await request(app).get('/api/reports/comercial/export.csv').set(RECEPTION_AUTH);

    expect(res.status).toBe(403);
    expect(mocks.prisma.lead.findMany).not.toHaveBeenCalled();
  });

  it('retorna 400 para custom com from > to', async () => {
    const app = await makeApp();

    const res = await request(app)
      .get('/api/reports/comercial?from=2026-07-01&to=2026-06-01')
      .set(AUTH);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/anterior ou igual/);
  });

  it('retorna 400 para custom acima de 366 dias ou data malformada', async () => {
    const app = await makeApp();

    const tooLong = await request(app)
      .get('/api/reports/comercial?from=2025-01-01&to=2026-07-07')
      .set(AUTH);
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toMatch(/366/);

    const malformed = await request(app)
      .get('/api/reports/comercial?from=01/07/2026&to=2026-07-07')
      .set(AUTH);
    expect(malformed.status).toBe(400);
  });

  it('GET /comercial agrega leads, estágios, especialidades, perdas e comparativo', async () => {
    // period=7d com NOW 2026-07-07 → janela 01–07/jul, anterior 24–30/jun
    mocks.prisma.lead.findMany.mockResolvedValue([
      { createdAt: at('2026-07-06T10:00:00Z'), tags: ['status:novo-lead', 'pipeline:cirurgia'] },
      { createdAt: at('2026-07-05T10:00:00Z'), tags: ['status:atendido', 'pipeline:cirurgia'] },
      { createdAt: at('2026-07-03T10:00:00Z'), tags: ['status:perdido-preco'] },
      { createdAt: at('2026-06-25T10:00:00Z'), tags: ['status:novo-lead'] }, // anterior
      { createdAt: at('2026-06-26T10:00:00Z'), tags: ['status:atendido'] }, // anterior
    ]);
    mocks.prisma.activity.findMany.mockResolvedValue([
      {
        targetId: 'l1',
        body: JSON.stringify({ type: 'stage_change', to: 'perdido', lostReason: 'preco' }),
        createdAt: at('2026-07-03T10:00:00Z'),
      },
      {
        targetId: 'l2',
        body: JSON.stringify({ type: 'stage_change', to: 'perdido', lostReason: 'horario' }),
        createdAt: at('2026-06-25T12:00:00Z'), // anterior
      },
    ]);
    const app = await makeApp();

    const res = await request(app).get('/api/reports/comercial?period=7d').set(AUTH);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.leadsNovos).toBe(3);
    expect(data.conversaoPct).toBe(33.3);
    expect(data.porEstagio.find((s: { stage: string }) => s.stage === 'novo-lead').count).toBe(1);
    expect(data.porEstagio.find((s: { stage: string }) => s.stage === 'atendido').count).toBe(1);
    expect(data.porEstagio.find((s: { stage: string }) => s.stage === 'perdido').count).toBe(1);
    expect(data.porEspecialidade).toEqual([
      { pipeline: 'cirurgia', count: 2, convertidos: 1 },
      { pipeline: 'sem-pipeline', count: 1, convertidos: 0 },
    ]);
    expect(data.perdas).toEqual([{ reason: 'preco', count: 1 }]);
    expect(data.comparativo).toEqual({ leadsNovos: 2, conversaoPct: 50, perdas: 1 });
    // Uma query cobre as duas janelas: [prevStart, end)
    expect(mocks.prisma.lead.findMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: at('2026-06-24T00:00:00Z'), lt: at('2026-07-08T00:00:00Z') } },
      select: { createdAt: true, tags: true },
    });
  });

  it('GET /comercial aceita janela custom from/to e filtra pelas datas', async () => {
    const app = await makeApp();

    const res = await request(app)
      .get('/api/reports/comercial?from=2026-06-01&to=2026-06-30')
      .set(AUTH);

    expect(res.status).toBe(200);
    // 30 dias: janela 01–30/jun, anterior 02–31/mai
    expect(mocks.prisma.lead.findMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: at('2026-05-02T00:00:00Z'), lt: at('2026-07-01T00:00:00Z') } },
      select: { createdAt: true, tags: true },
    });
  });

  it('GET /atendimento separa Tawany vs humano e traz mediana + comparativo', async () => {
    mocks.prisma.chatMessage.findMany.mockResolvedValue([
      { sentAt: at('2026-07-06T10:00:00Z'), direction: 'IN', agentHandled: false, conversationId: 'a' },
      { sentAt: at('2026-07-06T10:05:00Z'), direction: 'OUT', agentHandled: true, conversationId: 'a' },
      { sentAt: at('2026-07-07T09:00:00Z'), direction: 'IN', agentHandled: false, conversationId: 'b' },
      { sentAt: at('2026-06-25T10:00:00Z'), direction: 'IN', agentHandled: false, conversationId: 'c' }, // anterior
      { sentAt: at('2026-06-25T10:20:00Z'), direction: 'OUT', agentHandled: false, conversationId: 'c' }, // anterior
    ]);
    mocks.prisma.$queryRaw
      .mockResolvedValueOnce([{ median_s: 120, avg_s: 300, n: 2 }])
      .mockResolvedValueOnce([{ median_s: 240, avg_s: 280, n: 1 }]);
    const app = await makeApp();

    const res = await request(app).get('/api/reports/atendimento?period=7d').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      conversasAtivas: 2,
      mensagensRecebidas: 2,
      mensagensEnviadas: 1,
      tawanyVsHumano: { tawany: 1, humano: 0 },
      medianaPrimeiraRespostaMin: 2,
      comparativo: {
        conversasAtivas: 1,
        mensagensRecebidas: 1,
        mensagensEnviadas: 1,
        tawanyVsHumano: { tawany: 0, humano: 1 },
        medianaPrimeiraRespostaMin: 4,
      },
    });
  });

  it('GET /tawany agrega respostas, handoffs, taxa, bloqueios e comparativo', async () => {
    const run = (over: Record<string, unknown>) => ({
      createdAt: at('2026-07-06T12:00:00Z'),
      reason: 'replied',
      success: true,
      latencyMs: null,
      fallbackUsed: false,
      ...over,
    });
    mocks.prisma.aiRunLog.findMany.mockResolvedValue([
      run({ createdAt: at('2026-07-07T09:00:00Z'), latencyMs: 1000 }),
      run({ latencyMs: 2000 }),
      run({ success: false, reason: 'guard_failed: price_not_in_kb: 500' }),
      run({ success: false, reason: 'injection_blocked', fallbackUsed: true }),
      run({ success: false, reason: 'conversation_closed' }), // skip: fora da taxa
      run({ createdAt: at('2026-06-25T12:00:00Z') }), // anterior
      run({ createdAt: at('2026-06-26T12:00:00Z'), success: false, reason: 'max_iterations' }), // anterior
    ]);
    const app = await makeApp();

    const res = await request(app).get('/api/reports/tawany?period=7d').set(AUTH);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.respostas).toBe(2);
    expect(data.handoffs).toBe(2);
    expect(data.taxaResolucaoPct).toBe(50);
    expect(data.bloqueios).toEqual([
      { motivo: 'price_not_in_kb: 500', count: 1 },
      { motivo: 'injection_blocked', count: 1 },
    ]);
    expect(data.latenciaMediaMs).toBe(1500);
    expect(data.fallbacks).toBe(1);
    expect(data.porDia).toHaveLength(7);
    expect(data.porDia[6]).toEqual({ date: '2026-07-07', count: 1 });
    expect(data.porDia[5]).toEqual({ date: '2026-07-06', count: 1 });
    expect(data.comparativo).toEqual({ respostas: 1, handoffs: 1, taxaResolucaoPct: 50 });
  });

  it('GET /:tipo/export.csv devolve CSV com attachment e cabeçalho pt-BR', async () => {
    mocks.prisma.lead.findMany.mockResolvedValue([
      { createdAt: at('2026-07-06T10:00:00Z'), tags: ['status:novo-lead'] },
    ]);
    const app = await makeApp();

    const res = await request(app).get('/api/reports/comercial/export.csv?period=7d').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename=relatorio-comercial-2026-07-01-a-2026-07-07.csv',
    );
    expect(res.text).toContain('"indicador","valor"');
    expect(res.text).toContain('"Leads novos","1"');
  });

  it('GET /:tipo/export.csv devolve 404 para tipo desconhecido', async () => {
    const app = await makeApp();

    const res = await request(app).get('/api/reports/financeiro/export.csv').set(AUTH);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
