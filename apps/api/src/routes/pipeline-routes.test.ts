import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => ({
  prisma: {
    lead: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
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

describe('Pipeline routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shapes real Lead rows into the PipelineLead view, deriving stage/pipeline from tags', async () => {
    mocks.prisma.lead.findMany.mockResolvedValue([
      {
        id: 'l1', name: 'Maria Silva', phone: '+5521999999999', email: 'maria@x.com',
        source: 'instagram', intent: 'agendar', score: 80, temperature: 'HOT',
        tags: ['status:AGENDADO', 'pipeline:cirurgia', 'VIP'],
        nextActionAt: new Date('2026-07-10T12:00:00.000Z'),
      },
      {
        id: 'l2', name: 'Sem tag', phone: null, email: null,
        source: null, intent: null, score: 10, temperature: null,
        tags: [], nextActionAt: null,
      },
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
          stage: 'AGENDADO',
          pipeline: 'cirurgia',
          whatsapp: { primaryPhoneNumber: '+5521999999999' },
          email: { primaryEmail: 'maria@x.com' },
          nextFollowUpAt: '2026-07-10T12:00:00.000Z',
        }),
        expect.objectContaining({ id: 'l2', stage: 'NOVO', pipeline: null }),
      ],
    });
  });

  it('filters leads by pipeline query param after deriving from tags', async () => {
    mocks.prisma.lead.findMany.mockResolvedValue([
      { id: 'l1', name: 'A', phone: null, email: null, source: null, intent: null, score: 0, temperature: null, tags: ['pipeline:unhas'], nextActionAt: null },
      { id: 'l2', name: 'B', phone: null, email: null, source: null, intent: null, score: 0, temperature: null, tags: ['pipeline:cirurgia'], nextActionAt: null },
    ]);
    const { getPipelineLeadsRoute } = await import('./pipeline-routes');
    const response = res();

    await getPipelineLeadsRoute(req({ query: { pipeline: 'unhas' } }), response);

    const data = (response.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('l1');
  });

  it('moveLeadRoute rejects unknown stages and sets status:/pipeline: tags on success', async () => {
    const { moveLeadRoute } = await import('./pipeline-routes');

    const bad = res();
    await moveLeadRoute(req({ params: { id: 'l1' }, body: { stage: 'INVALID' } }), bad);
    expect(bad.status).toHaveBeenCalledWith(400);

    mocks.prisma.lead.findUnique.mockResolvedValue({ tags: ['status:NOVO', 'VIP'] });
    mocks.prisma.lead.update.mockResolvedValue({});
    const ok = res();
    await moveLeadRoute(req({ params: { id: 'l1' }, body: { stage: 'AGENDADO', pipeline: 'unhas' } }), ok);

    expect(mocks.prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { tags: ['VIP', 'status:AGENDADO', 'pipeline:unhas'] },
    });
    expect(ok.json).toHaveBeenCalledWith({ success: true, data: { stage: 'AGENDADO', pipeline: 'unhas' } });
  });

  it('updateLeadPipelineRoute rejects unknown pipeline slugs', async () => {
    const { updateLeadPipelineRoute } = await import('./pipeline-routes');
    const response = res();
    await updateLeadPipelineRoute(req({ params: { id: 'l1' }, body: { pipeline: 'nao-existe' } }), response);
    expect(response.status).toHaveBeenCalledWith(400);
  });
});
