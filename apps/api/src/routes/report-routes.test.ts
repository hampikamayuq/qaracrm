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
    budget: {
      findMany: vi.fn(),
    },
    payment: {
      findMany: vi.fn(),
    },
    appointment: {
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
    mocks.prisma.budget.findMany.mockResolvedValue([]);
    mocks.prisma.payment.findMany.mockResolvedValue([]);
    mocks.prisma.appointment.findMany.mockResolvedValue([]);
    mocks.prisma.$queryRaw.mockResolvedValue([]);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('retorna 401 sem Authorization em todos os endpoints', async () => {
    const app = await makeApp();

    for (const path of ['/comercial', '/atendimento', '/tawany', '/financeiro', '/comercial/export.csv']) {
      expect((await request(app).get(`/api/reports${path}`)).status).toBe(401);
    }
    expect(mocks.prisma.lead.findMany).not.toHaveBeenCalled();
  });

  it('retorna 400 para period inválido', async () => {
    const app = await makeApp();

    for (const path of ['/comercial', '/atendimento', '/tawany', '/financeiro', '/tawany/export.csv']) {
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

  it('bloqueia os endpoints JSON de relatório para recepção (gate não é bypassável pelo JSON)', async () => {
    // ACHADO 2: o CSV era gated mas o JSON equivalente não — mesma exposição de
    // dados agregados. Agora ambos exigem o papel. O admin seedado passa.
    const app = await makeApp();
    for (const path of ['/comercial', '/atendimento', '/tawany', '/financeiro']) {
      const res = await request(app).get(`/api/reports${path}?period=7d`).set(RECEPTION_AUTH);
      expect(res.status).toBe(403);
    }
    expect(mocks.prisma.lead.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.budget.findMany).not.toHaveBeenCalled();
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

  describe('GET /financeiro', () => {
    // period=7d com NOW 2026-07-07 → janela 01–07/jul, anterior 24–30/jun
    // (mesma janela usada nos outros testes de report-routes).
    const budgetWindowRows = [
      { id: 'b1', amount: 1000, status: 'DRAFT', createdAt: at('2026-07-02T10:00:00Z'), sentAt: null, respondedAt: null },
      { id: 'b2', amount: 2000, status: 'SENT', createdAt: at('2026-07-03T10:00:00Z'), sentAt: at('2026-07-03T10:00:00Z'), respondedAt: null },
      {
        id: 'b3',
        amount: 3000,
        status: 'ACCEPTED',
        createdAt: at('2026-07-04T09:00:00Z'),
        sentAt: at('2026-07-04T09:00:00Z'),
        respondedAt: at('2026-07-04T15:00:00Z'), // 6h depois
      },
      {
        id: 'b4',
        amount: 1500,
        status: 'REJECTED',
        createdAt: at('2026-07-05T08:00:00Z'),
        sentAt: at('2026-07-05T08:00:00Z'),
        respondedAt: at('2026-07-06T08:00:00Z'), // 24h depois
      },
      { id: 'b5', amount: 500, status: 'EXPIRED', createdAt: at('2026-07-06T00:00:00Z'), sentAt: at('2026-07-06T00:00:00Z'), respondedAt: null },
      // anterior
      {
        id: 'p1',
        amount: 4000,
        status: 'ACCEPTED',
        createdAt: at('2026-06-25T08:00:00Z'),
        sentAt: at('2026-06-25T08:00:00Z'),
        respondedAt: at('2026-06-25T20:00:00Z'), // 12h depois
      },
      { id: 'p2', amount: 1000, status: 'REJECTED', createdAt: at('2026-06-26T10:00:00Z'), sentAt: null, respondedAt: null },
    ];

    const acceptedBudgetsSnapshot = [
      { amount: 3000, payments: [{ amount: 3000, status: 'PAID' }] }, // quitado, saldo 0
      { amount: 5000, payments: [{ amount: 2000, status: 'PAID' }] }, // saldo 3000, fora do período
    ];

    const paymentWindowRows = [
      { amount: 3000, method: 'PIX', paidAt: at('2026-07-04T16:00:00Z') },
      { amount: 500, method: 'CREDIT', paidAt: at('2026-07-05T10:00:00Z') },
      { amount: 4000, method: 'PIX', paidAt: at('2026-06-25T21:00:00Z') }, // anterior
    ];

    const apptWindowRows = [
      { npsSentAt: at('2026-07-02T00:00:00Z'), npsScore: 9, npsRespondedAt: at('2026-07-02T12:00:00Z') }, // promotor
      { npsSentAt: at('2026-07-03T00:00:00Z'), npsScore: 5, npsRespondedAt: at('2026-07-03T12:00:00Z') }, // detrator
      { npsSentAt: at('2026-07-04T00:00:00Z'), npsScore: 7, npsRespondedAt: at('2026-07-04T12:00:00Z') }, // neutro
      { npsSentAt: at('2026-07-05T00:00:00Z'), npsScore: null, npsRespondedAt: null }, // enviado, sem resposta
      { npsSentAt: at('2026-06-25T00:00:00Z'), npsScore: 10, npsRespondedAt: at('2026-06-25T10:00:00Z') }, // anterior, promotor
    ];

    const mockFinanceiroData = () => {
      mocks.prisma.budget.findMany.mockImplementation(async (args: { where?: { status?: string } } = {}) =>
        args.where?.status === 'ACCEPTED' ? acceptedBudgetsSnapshot : budgetWindowRows,
      );
      mocks.prisma.payment.findMany.mockResolvedValue(paymentWindowRows);
      mocks.prisma.appointment.findMany.mockResolvedValue(apptWindowRows);
    };

    it('agrega orçamentos por status, taxa de aceitação e tempo médio de resposta', async () => {
      mockFinanceiroData();
      const app = await makeApp();

      const res = await request(app).get('/api/reports/financeiro?period=7d').set(AUTH);

      expect(res.status).toBe(200);
      const { orcamentos } = res.body.data;
      expect(orcamentos.total).toBe(5);
      expect(orcamentos.porStatus).toEqual([
        { status: 'DRAFT', label: 'Rascunho', count: 1, valor: 1000 },
        { status: 'SENT', label: 'Enviado', count: 1, valor: 2000 },
        { status: 'ACCEPTED', label: 'Aceito', count: 1, valor: 3000 },
        { status: 'REJECTED', label: 'Recusado', count: 1, valor: 1500 },
        { status: 'EXPIRED', label: 'Expirado', count: 1, valor: 500 },
      ]);
      // resolvidos: ACCEPTED+REJECTED+EXPIRED = 3, aceitos = 1 → 33.3%
      expect(orcamentos.taxaAceitacaoPct).toBe(33.3);
      // médias de b3 (6h) e b4 (24h) — b1/b2/b5 sem os dois campos preenchidos
      expect(orcamentos.tempoMedioRespostaHoras).toBe(15);
      expect(orcamentos.valorMedio).toBe(1600);
      // anterior: p1 ACCEPTED + p2 REJECTED → resolvidos 2, aceitos 1 → 50%
      expect(orcamentos.comparativo).toEqual({ total: 2, taxaAceitacaoPct: 50, valorMedio: 2500 });
    });

    it('taxa de aceitação é null quando não há orçamentos resolvidos no período', async () => {
      mocks.prisma.budget.findMany.mockImplementation(async (args: { where?: { status?: string } } = {}) =>
        args.where?.status === 'ACCEPTED'
          ? []
          : [{ id: 'b1', amount: 1000, status: 'DRAFT', createdAt: at('2026-07-02T10:00:00Z'), sentAt: null, respondedAt: null }],
      );
      const app = await makeApp();

      const res = await request(app).get('/api/reports/financeiro?period=7d').set(AUTH);

      expect(res.status).toBe(200);
      expect(res.body.data.orcamentos.taxaAceitacaoPct).toBeNull();
      expect(res.body.data.orcamentos.tempoMedioRespostaHoras).toBeNull();
    });

    it('soma pagamentos recebidos por método (paidAt no período) e calcula o saldo a receber', async () => {
      mockFinanceiroData();
      const app = await makeApp();

      const res = await request(app).get('/api/reports/financeiro?period=7d').set(AUTH);

      expect(res.status).toBe(200);
      const { pagamentos } = res.body.data;
      expect(pagamentos.totalRecebido).toBe(3500);
      expect(pagamentos.porMetodo).toEqual([
        { method: 'PIX', valor: 3000 },
        { method: 'CREDIT', valor: 500 },
      ]);
      // orçamento aceito 1: quitado (saldo 0); orçamento aceito 2: saldo 3000 (fora do período, mesmo assim conta)
      expect(pagamentos.pendente).toBe(3000);
      expect(pagamentos.comparativo).toEqual({ totalRecebido: 4000 });
    });

    it('agrega NPS: enviados, respondidos, distribuição e o NPS clássico', async () => {
      mockFinanceiroData();
      const app = await makeApp();

      const res = await request(app).get('/api/reports/financeiro?period=7d').set(AUTH);

      expect(res.status).toBe(200);
      const { nps } = res.body.data;
      expect(nps.enviados).toBe(4);
      expect(nps.respondidos).toBe(3);
      expect(nps.taxaRespostaPct).toBe(75);
      expect(nps.notaMedia).toBe(7);
      expect(nps.distribuicao).toEqual({ detratores: 1, neutros: 1, promotores: 1 });
      expect(nps.npsClassico).toBe(0);
      expect(nps.comparativo).toEqual({
        enviados: 1,
        respondidos: 1,
        taxaRespostaPct: 100,
        notaMedia: 10,
        npsClassico: 100,
      });
    });

    it('NPS com 0 respostas: taxa, nota média e score ficam null sem dividir por zero', async () => {
      mocks.prisma.appointment.findMany.mockResolvedValue([
        { npsSentAt: at('2026-07-02T00:00:00Z'), npsScore: null, npsRespondedAt: null },
      ]);
      const app = await makeApp();

      const res = await request(app).get('/api/reports/financeiro?period=7d').set(AUTH);

      expect(res.status).toBe(200);
      const { nps } = res.body.data;
      expect(nps.enviados).toBe(1);
      expect(nps.respondidos).toBe(0);
      expect(nps.taxaRespostaPct).toBe(0);
      expect(nps.notaMedia).toBeNull();
      expect(nps.npsClassico).toBeNull();
      expect(nps.distribuicao).toEqual({ detratores: 0, neutros: 0, promotores: 0 });
    });

    it('sem nenhum envio de NPS no período, taxa de resposta fica null (0/0)', async () => {
      mocks.prisma.appointment.findMany.mockResolvedValue([]);
      const app = await makeApp();

      const res = await request(app).get('/api/reports/financeiro?period=7d').set(AUTH);

      expect(res.status).toBe(200);
      expect(res.body.data.nps).toEqual({
        enviados: 0,
        respondidos: 0,
        taxaRespostaPct: null,
        notaMedia: null,
        distribuicao: { detratores: 0, neutros: 0, promotores: 0 },
        npsClassico: null,
        comparativo: {
          enviados: 0,
          respondidos: 0,
          taxaRespostaPct: null,
          notaMedia: null,
          npsClassico: null,
        },
      });
    });

    it('respeita a janela custom from/to', async () => {
      mockFinanceiroData();
      const app = await makeApp();

      await request(app).get('/api/reports/financeiro?from=2026-06-01&to=2026-06-30').set(AUTH);

      // 30 dias: janela 01–30/jun, anterior 02–31/mai (mesmo cálculo do teste
      // equivalente em /comercial)
      const budgetCall = mocks.prisma.budget.findMany.mock.calls.find(
        (call) => (call[0] as { where?: { createdAt?: unknown } })?.where?.createdAt !== undefined,
      );
      expect(budgetCall?.[0]).toEqual({
        where: { createdAt: { gte: at('2026-05-02T00:00:00Z'), lt: at('2026-07-01T00:00:00Z') } },
        select: { amount: true, status: true, createdAt: true, sentAt: true, respondedAt: true },
      });
    });
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

  it('GET /financeiro/export.csv devolve CSV com orçamentos, pagamentos e NPS', async () => {
    mocks.prisma.budget.findMany.mockImplementation(async (args: { where?: { status?: string } } = {}) =>
      args.where?.status === 'ACCEPTED'
        ? []
        : [{ id: 'b1', amount: 1000, status: 'ACCEPTED', createdAt: at('2026-07-02T10:00:00Z'), sentAt: at('2026-07-02T10:00:00Z'), respondedAt: at('2026-07-02T12:00:00Z') }],
    );
    mocks.prisma.payment.findMany.mockResolvedValue([
      { amount: 500, method: 'PIX', paidAt: at('2026-07-03T10:00:00Z') },
    ]);
    const app = await makeApp();

    const res = await request(app).get('/api/reports/financeiro/export.csv?period=7d').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename=relatorio-financeiro-2026-07-01-a-2026-07-07.csv',
    );
    expect(res.text).toContain('"Orçamentos · Total criados","1"');
    expect(res.text).toContain('"Orçamentos · Aceito (R$)","1000.00"');
    expect(res.text).toContain('"Pagamentos · Total recebido (R$)","500.00"');
    expect(res.text).toContain('"Pagamentos · PIX (R$)","500.00"');
  });

  it('bloqueia export CSV de financeiro para usuário sem papel financeiro/admin/marketing', async () => {
    const app = await makeApp();

    const res = await request(app).get('/api/reports/financeiro/export.csv').set(RECEPTION_AUTH);

    expect(res.status).toBe(403);
    expect(mocks.prisma.budget.findMany).not.toHaveBeenCalled();
  });

  it('GET /:tipo/export.csv devolve 404 para tipo desconhecido', async () => {
    const app = await makeApp();

    const res = await request(app).get('/api/reports/inexistente/export.csv').set(AUTH);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
