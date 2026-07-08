import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => {
  const data = {
    get: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  return {
    data,
    ai: { chat: vi.fn() },
    prisma: {},
  };
});

vi.mock('../lib/deps', () => ({ prisma: mocks.prisma }));
vi.mock('../lib/prisma-data-api', () => ({
  createPrismaDataApi: vi.fn(() => mocks.data),
}));
vi.mock('../lib/ai-client', () => ({
  createAiClient: vi.fn(() => mocks.ai),
}));
vi.mock('../logic-functions/qara-classifier', () => ({
  runQaraClassifier: vi.fn(),
}));
vi.mock('../lib/tools/sendWhatsAppTemplate', () => ({
  sendWhatsAppTemplate: { execute: vi.fn() },
}));
vi.mock('../lib/tawany/golden-set', () => ({
  loadGoldenCases: vi.fn(),
  runGoldenSet: vi.fn(),
  formatGoldenSetReport: vi.fn(),
  assertGoldenSetPassed: vi.fn(),
}));
vi.mock('../middleware/auth-middleware', () => ({
  authMiddleware: vi.fn((_req, _res, next) => next()),
}));

const req = (overrides: Partial<Request>): Request => overrides as Request;

const res = () => {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response as unknown as Response & typeof response;
};

describe('Operations routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends follow-up template only for stale open conversations', async () => {
    const { sendWhatsAppTemplate } = await import('../lib/tools/sendWhatsAppTemplate');
    const now = Date.now();
    mocks.data.list.mockResolvedValue([
      { id: 'c-old', updatedAt: new Date(now - 48 * 3600_000).toISOString() },
      { id: 'c-new', updatedAt: new Date(now - 1 * 3600_000).toISOString() },
    ]);
    vi.mocked(sendWhatsAppTemplate.execute).mockResolvedValue(JSON.stringify({ ok: true, sent: true }));
    const { followUpRoute } = await import('./operations-routes');
    const response = res();

    await followUpRoute(req({}), response);

    expect(sendWhatsAppTemplate.execute).toHaveBeenCalledOnce();
    expect(sendWhatsAppTemplate.execute).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'c-old', templateName: 'qara_followup_24h' }),
      mocks.data,
    );
    expect(mocks.data.update).toHaveBeenCalledWith('conversation', 'c-old', { status: 'PENDING_PATIENT' });
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: { conversationsChecked: 2, followUpsSent: 1 },
    });
  });

  it('classifies a message manually', async () => {
    const { runQaraClassifier } = await import('../logic-functions/qara-classifier');
    vi.mocked(runQaraClassifier).mockResolvedValue({
      path: 'llm',
      tagsWritten: 1,
      result: {
        intencao_principal: 'agendar',
        temperatura: 'HOT',
        prioridade: 'P1',
        pipeline_funil: 'dermatologia-clinica',
        medico_indicado: null,
        unidade: null,
        confianca: 0.9,
        tags_sugeridas: ['LEAD_QUENTE'],
        proxima_acao: 'handoff',
        razoes: ['teste'],
      },
    });
    const { classifyRoute } = await import('./operations-routes');
    const response = res();

    await classifyRoute(req({ body: { message: 'quero consulta', leadId: 'l1', conversationId: 'c1' } }), response);

    expect(runQaraClassifier).toHaveBeenCalledWith(
      { message: 'quero consulta', leadId: 'l1', conversationId: 'c1' },
      { ai: mocks.ai, data: mocks.data },
    );
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ path: 'llm', tagsWritten: 1 }),
    });
  });

  it('lists pipeline stages with their leads', async () => {
    mocks.data.list
      .mockResolvedValueOnce([{ id: 'stage-1', name: 'Novo' }])
      .mockResolvedValueOnce([{ id: 'lead-1', name: 'Maria', score: 80, tags: ['temp:quente'] }]);
    const { pipelineRoute } = await import('./operations-routes');
    const response = res();

    await pipelineRoute(req({}), response);

    expect(mocks.data.list).toHaveBeenNthCalledWith(1, 'pipelineStage', {
      orderBy: { order: 'ASC' },
      select: { id: true, name: true },
    });
    expect(mocks.data.list).toHaveBeenNthCalledWith(2, 'lead', {
      filter: { stageId: { eq: 'stage-1' } },
      select: { id: true, name: true, score: true, tags: true },
    });
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: [{ id: 'stage-1', name: 'Novo', leads: [{ id: 'lead-1', name: 'Maria', score: 80, tags: ['temp:quente'] }] }],
    });
  });

  it('runs the Tawany golden set with the deployed environment ai client', async () => {
    const golden = await import('../lib/tawany/golden-set');
    vi.mocked(golden.loadGoldenCases).mockResolvedValue([
      { id: 'address-basic', user: 'Onde fica?', expectedGuardOk: true },
    ]);
    vi.mocked(golden.runGoldenSet).mockResolvedValue({
      total: 1,
      passed: 1,
      failed: 0,
      results: [{
        id: 'address-basic',
        ok: true,
        guardOk: true,
        reply: 'Estamos em Copacabana.',
        contentFailures: [],
      }],
    });
    vi.mocked(golden.formatGoldenSetReport).mockReturnValue('# Tawany Golden Set PASSED\n- PASS address-basic');
    const { goldenSetRoute } = await import('./operations-routes');
    const response = res();

    await goldenSetRoute(req({}), response);

    expect(golden.runGoldenSet).toHaveBeenCalledWith({
      ai: mocks.ai,
      cases: [{ id: 'address-basic', user: 'Onde fica?', expectedGuardOk: true }],
    });
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: {
        total: 1,
        passed: 1,
        failed: 0,
        report: '# Tawany Golden Set PASSED\n- PASS address-basic',
      },
    });
  });

  it('exports an express router', async () => {
    const mod = await import('./operations-routes');
    expect(mod.default).toBeDefined();
  });
});
