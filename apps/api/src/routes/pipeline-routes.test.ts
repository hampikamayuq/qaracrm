import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => ({
  prisma: {
    lead: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    activity: {
      create: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

vi.mock('../lib/deps', () => ({ prisma: mocks.prisma }));
vi.mock('../middleware/auth-middleware', () => ({
  authMiddleware: vi.fn((_req, _res, next) => next()),
}));

const req = (overrides: Partial<Request>): Request => overrides as Request;

const res = () => {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  return response as unknown as Response & typeof response;
};

const baseLead = {
  phone: null, email: null, source: null, intent: null, score: 0, temperature: null,
  nextActionAt: null, createdAt: new Date('2026-07-01T00:00:00.000Z'), updatedAt: new Date('2026-07-01T00:00:00.000Z'),
};

describe('Pipeline routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.activity.groupBy.mockResolvedValue([]);
    mocks.prisma.activity.create.mockResolvedValue({ id: 'a1' });
  });

  it('shapes real Lead rows into the PipelineLead view, deriving stage/pipeline from tags (with legacy status: mapping)', async () => {
    mocks.prisma.lead.findMany.mockResolvedValue([
      {
        ...baseLead,
        id: 'l1', name: 'Maria Silva', phone: '+5521999999999', email: 'maria@x.com',
        source: 'instagram', intent: 'agendar', score: 80, temperature: 'HOT',
        tags: ['status:AGENDADO', 'pipeline:cirurgia', 'VIP'],
        nextActionAt: new Date('2026-07-10T12:00:00.000Z'),
      },
      { ...baseLead, id: 'l2', name: 'Sem tag', score: 10, tags: [] },
      { ...baseLead, id: 'l3', name: 'Perdida', score: 5, tags: ['status:perdido-preco'] },
    ]);
    const { getPipelineLeadsRoute } = await import('./pipeline-routes');
    const response = res();

    await getPipelineLeadsRoute(req({ query: {} }), response);

    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: [
        expect.objectContaining({
          id: 'l1',
          name: { firstName: 'Maria Silva', lastName: '' },
          stage: 'agendado',
          pipeline: 'cirurgia',
          whatsapp: { primaryPhoneNumber: '+5521999999999' },
          email: { primaryEmail: 'maria@x.com' },
          nextFollowUpAt: '2026-07-10T12:00:00.000Z',
        }),
        expect.objectContaining({ id: 'l2', stage: 'novo-lead', pipeline: null }),
        expect.objectContaining({ id: 'l3', stage: 'perdido', lostReason: 'preco' }),
      ],
    });
  });

  it('returns daysInStage/stageEnteredAt from the last STAGE_CHANGE activity and flags stalled leads', async () => {
    const now = Date.now();
    const fiveDaysAgo = new Date(now - 5 * 86_400_000);
    mocks.prisma.lead.findMany.mockResolvedValue([
      { ...baseLead, id: 'l1', name: 'Ativa', tags: ['status:qualificado'] },
      { ...baseLead, id: 'l2', name: 'Perdida', tags: ['status:perdido-preco'] },
      { ...baseLead, id: 'l3', name: 'Recente', tags: ['status:qualificado'], createdAt: new Date(now), updatedAt: new Date(now) },
    ]);
    mocks.prisma.activity.groupBy.mockResolvedValue([
      { targetId: 'l1', _max: { createdAt: fiveDaysAgo } },
      { targetId: 'l2', _max: { createdAt: fiveDaysAgo } },
    ]);
    const { getPipelineLeadsRoute } = await import('./pipeline-routes');
    const response = res();

    await getPipelineLeadsRoute(req({ query: {} }), response);

    const data = (response.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    const byId = Object.fromEntries(data.map((l: { id: string }) => [l.id, l]));
    // 5 dias parado em estágio ativo → destacado
    expect(byId.l1.daysInStage).toBe(5);
    expect(byId.l1.stageEnteredAt).toBe(fiveDaysAgo.toISOString());
    expect(byId.l1.isStalled).toBe(true);
    // Estágio terminal nunca conta como parado
    expect(byId.l2.isStalled).toBe(false);
    // Sem activity → fallback no updatedAt do lead (0 dias, não parado)
    expect(byId.l3.daysInStage).toBe(0);
    expect(byId.l3.isStalled).toBe(false);
  });

  it('filters leads by pipeline query param after deriving from tags', async () => {
    mocks.prisma.lead.findMany.mockResolvedValue([
      { ...baseLead, id: 'l1', name: 'A', tags: ['pipeline:unhas'] },
      { ...baseLead, id: 'l2', name: 'B', tags: ['pipeline:cirurgia'] },
    ]);
    const { getPipelineLeadsRoute } = await import('./pipeline-routes');
    const response = res();

    await getPipelineLeadsRoute(req({ query: { pipeline: 'unhas' } }), response);

    const data = (response.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('l1');
  });

  it('moveLeadRoute rejects unknown stages and sets status:/pipeline: tags + records activity on success', async () => {
    const { moveLeadRoute } = await import('./pipeline-routes');

    const bad = res();
    await moveLeadRoute(req({ params: { id: 'l1' }, body: { stage: 'INVALID' } }), bad);
    expect(bad.status).toHaveBeenCalledWith(400);

    mocks.prisma.lead.findUnique.mockResolvedValue({ tags: ['status:novo-lead', 'VIP'] });
    mocks.prisma.lead.update.mockResolvedValue({});
    const ok = res();
    await moveLeadRoute(req({ params: { id: 'l1' }, body: { stage: 'agendado', pipeline: 'unhas' }, userId: 'u1' } as Partial<Request>), ok);

    expect(mocks.prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { tags: ['VIP', 'status:agendado', 'pipeline:unhas'] },
    });
    expect(mocks.prisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetType: 'lead',
        targetId: 'l1',
        type: 'STAGE_CHANGE',
        userId: 'u1',
        body: expect.stringContaining('"from":"novo-lead"'),
      }),
    });
    const body = JSON.parse(mocks.prisma.activity.create.mock.calls[0][0].data.body);
    expect(body).toMatchObject({ type: 'stage_change', from: 'novo-lead', to: 'agendado', byUserId: 'u1' });
    expect(ok.json).toHaveBeenCalledWith({ success: true, data: { stage: 'agendado', pipeline: 'unhas' } });
  });

  it('moveLeadRoute requires a canonical lostReason when moving to perdido', async () => {
    const { moveLeadRoute } = await import('./pipeline-routes');

    const missing = res();
    await moveLeadRoute(req({ params: { id: 'l1' }, body: { stage: 'perdido' } }), missing);
    expect(missing.status).toHaveBeenCalledWith(400);
    expect(missing.json).toHaveBeenCalledWith({
      success: false,
      error: expect.stringContaining('lostReason'),
    });

    const invalid = res();
    await moveLeadRoute(req({ params: { id: 'l1' }, body: { stage: 'perdido', lostReason: 'mudou-de-ideia' } }), invalid);
    expect(invalid.status).toHaveBeenCalledWith(400);

    expect(mocks.prisma.lead.update).not.toHaveBeenCalled();
    expect(mocks.prisma.activity.create).not.toHaveBeenCalled();
  });

  it('moveLeadRoute with lostReason writes status:perdido-<motivo> (replacing older perdido-*) and records it in the activity', async () => {
    mocks.prisma.lead.findUnique.mockResolvedValue({ tags: ['status:perdido-horario', 'VIP'] });
    mocks.prisma.lead.update.mockResolvedValue({});
    const { moveLeadRoute } = await import('./pipeline-routes');
    const ok = res();

    await moveLeadRoute(
      req({ params: { id: 'l1' }, body: { stage: 'perdido', lostReason: 'preco', note: 'achou caro' }, userId: 'u1' } as Partial<Request>),
      ok,
    );

    expect(mocks.prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { tags: ['VIP', 'status:perdido-preco'] },
    });
    const body = JSON.parse(mocks.prisma.activity.create.mock.calls[0][0].data.body);
    expect(body).toMatchObject({
      type: 'stage_change',
      from: 'perdido',
      to: 'perdido',
      lostReason: 'preco',
      note: 'achou caro',
    });
    expect(ok.json).toHaveBeenCalledWith({
      success: true,
      data: { stage: 'perdido', pipeline: undefined, lostReason: 'preco' },
    });
  });

  it('moveLeadRoute skips the activity when the stage did not change (non-perdido)', async () => {
    mocks.prisma.lead.findUnique.mockResolvedValue({ tags: ['status:agendado'] });
    mocks.prisma.lead.update.mockResolvedValue({});
    const { moveLeadRoute } = await import('./pipeline-routes');
    const ok = res();

    await moveLeadRoute(req({ params: { id: 'l1' }, body: { stage: 'agendado' } }), ok);

    expect(mocks.prisma.activity.create).not.toHaveBeenCalled();
    expect(ok.json).toHaveBeenCalledWith({ success: true, data: { stage: 'agendado', pipeline: undefined } });
  });

  it('updateLeadPipelineRoute rejects unknown pipeline slugs and records pipeline_change on success', async () => {
    const { updateLeadPipelineRoute } = await import('./pipeline-routes');
    const badRes = res();
    await updateLeadPipelineRoute(req({ params: { id: 'l1' }, body: { pipeline: 'nao-existe' } }), badRes);
    expect(badRes.status).toHaveBeenCalledWith(400);

    mocks.prisma.lead.findUnique.mockResolvedValue({ tags: ['pipeline:unhas'] });
    mocks.prisma.lead.update.mockResolvedValue({});
    const ok = res();
    await updateLeadPipelineRoute(req({ params: { id: 'l1' }, body: { pipeline: 'cirurgia' }, userId: 'u1' } as Partial<Request>), ok);

    const body = JSON.parse(mocks.prisma.activity.create.mock.calls[0][0].data.body);
    expect(body).toMatchObject({ type: 'pipeline_change', from: 'unhas', to: 'cirurgia' });
    expect(mocks.prisma.activity.create.mock.calls[0][0].data.type).toBe('PIPELINE_CHANGE');
  });

  it('getPipelineStagesRoute returns the canonical KB §5 stage set, ordered, with pt-BR labels and terminal flags', async () => {
    const { getPipelineStagesRoute } = await import('./pipeline-routes');
    const response = res();

    await getPipelineStagesRoute(req({ params: { pipeline: 'unhas' } }), response);

    const data = (response.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(data.map((s: { slug: string }) => s.slug)).toEqual([
      'novo-lead', 'qualificado', 'horario-oferecido', 'agendado', 'confirmado',
      'atendido', 'reagendado', 'perdido', 'alta-manutencao',
    ]);
    expect(data[0]).toMatchObject({ name: 'Novo lead', order: 0, terminal: false });
    expect(data.find((s: { slug: string }) => s.slug === 'perdido')).toMatchObject({ name: 'Perdido', terminal: true });
    expect(data.find((s: { slug: string }) => s.slug === 'atendido')).toMatchObject({ name: 'Compareceu' });
  });

  it('getLeadHistoryRoute returns the parsed movement list ordered by most recent first', async () => {
    mocks.prisma.activity.findMany.mockResolvedValue([
      {
        id: 'a2', userId: 'u1', user: { name: 'Tawany' }, createdAt: new Date('2026-07-06T10:00:00.000Z'),
        body: JSON.stringify({ type: 'stage_change', from: 'agendado', to: 'perdido', lostReason: 'preco', note: 'achou caro', at: '2026-07-06T10:00:00.000Z' }),
      },
      {
        id: 'a1', userId: null, user: null, createdAt: new Date('2026-07-05T10:00:00.000Z'),
        body: 'nota antiga sem json',
      },
    ]);
    const { getLeadHistoryRoute } = await import('./pipeline-routes');
    const response = res();

    await getLeadHistoryRoute(req({ params: { id: 'l1' } }), response);

    expect(mocks.prisma.activity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { targetType: 'lead', targetId: 'l1', type: { in: ['STAGE_CHANGE', 'PIPELINE_CHANGE'] } },
      orderBy: { createdAt: 'desc' },
    }));
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: [
        {
          id: 'a2', type: 'stage_change', from: 'agendado', to: 'perdido',
          lostReason: 'preco', note: 'achou caro', byUserId: 'u1', byName: 'Tawany',
          at: '2026-07-06T10:00:00.000Z',
        },
        expect.objectContaining({ id: 'a1', from: null, to: null, byName: null }),
      ],
    });
  });
});
