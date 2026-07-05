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
    prisma: {
      aiSuggestion: {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

vi.mock('../lib/deps', () => ({ prisma: mocks.prisma }));
vi.mock('../lib/prisma-data-api', () => ({
  createPrismaDataApi: vi.fn(() => mocks.data),
}));
vi.mock('../lib/ai-client', () => ({
  createAiClient: vi.fn(() => mocks.ai),
}));
vi.mock('../logic-functions/tawany-handler', () => ({
  runTawanyHandler: vi.fn(),
}));
vi.mock('../lib/tools/sendWhatsApp', () => ({
  sendWhatsApp: { execute: vi.fn() },
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

describe('Tawany routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs Tawany for a message', async () => {
    const { runTawanyHandler } = await import('../logic-functions/tawany-handler');
    vi.mocked(runTawanyHandler).mockResolvedValue({ status: 'replied', toolCalls: 0 });
    mocks.data.get.mockResolvedValue({ id: 'm1', conversationId: 'c1', direction: 'IN', body: 'oi' });
    const { runTawanyRoute } = await import('./tawany-routes');
    const response = res();

    await runTawanyRoute(req({ body: { messageId: 'm1' } }), response);

    expect(mocks.data.get).toHaveBeenCalledWith('chatMessage', 'm1');
    expect(runTawanyHandler).toHaveBeenCalledWith(
      { id: 'm1', conversationId: 'c1', direction: 'IN', body: 'oi' },
      expect.objectContaining({ ai: mocks.ai, data: mocks.data }),
    );
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: { status: 'replied', toolCalls: 0 },
    });
  });

  it('lists pending suggestions for a conversation', async () => {
    mocks.data.list.mockResolvedValue([{ id: 's1' }]);
    const { listSuggestionsRoute } = await import('./tawany-routes');
    const response = res();

    await listSuggestionsRoute(req({ params: { conversationId: 'c1' } }), response);

    expect(mocks.data.list).toHaveBeenCalledWith('aiSuggestion', {
      filter: { conversationId: { eq: 'c1' }, status: { eq: 'PENDING' } },
      orderBy: { createdAt: 'DESC' },
    });
    expect(response.json).toHaveBeenCalledWith({ success: true, data: [{ id: 's1' }] });
  });

  it('approves, captures human edit, sends final body, and marks SENT atomically', async () => {
    const { sendWhatsApp } = await import('../lib/tools/sendWhatsApp');
    mocks.prisma.aiSuggestion.findUnique.mockResolvedValue({
      body: 'original',
      status: 'PENDING',
      conversationId: 'c1',
    });
    mocks.prisma.aiSuggestion.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.aiSuggestion.update.mockResolvedValue({ id: 's1', status: 'SENT' });
    vi.mocked(sendWhatsApp.execute).mockResolvedValue(JSON.stringify({ ok: true, sent: true }));
    const { approveSuggestionRoute } = await import('./tawany-routes');
    const response = res();

    await approveSuggestionRoute(req({ body: { suggestionId: 's1', body: 'edited' }, userId: 'u1' }), response);

    expect(mocks.prisma.aiSuggestion.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', status: 'PENDING' },
      data: expect.objectContaining({
        status: 'APPROVED',
        approvedById: 'u1',
        humanEdited: true,
        originalBody: 'original',
        body: 'edited',
      }),
    });
    expect(sendWhatsApp.execute).toHaveBeenCalledWith({ conversationId: 'c1', text: 'edited' }, mocks.data);
    expect(mocks.prisma.aiSuggestion.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'SENT' },
    });
    expect(response.json).toHaveBeenCalledWith({ success: true, data: { sent: true, humanEdited: true } });
  });

  it('returns 409 when approve loses the optimistic lock', async () => {
    mocks.prisma.aiSuggestion.findUnique.mockResolvedValue({
      body: 'original',
      status: 'PENDING',
      conversationId: 'c1',
    });
    mocks.prisma.aiSuggestion.updateMany.mockResolvedValue({ count: 0 });
    const { approveSuggestionRoute } = await import('./tawany-routes');
    const response = res();

    await approveSuggestionRoute(req({ body: { suggestionId: 's1' }, userId: 'u1' }), response);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: 'Suggestion not found or already processed',
    });
  });

  it('rejects a pending suggestion atomically', async () => {
    mocks.prisma.aiSuggestion.updateMany.mockResolvedValue({ count: 1 });
    const { rejectSuggestionRoute } = await import('./tawany-routes');
    const response = res();

    await rejectSuggestionRoute(req({ body: { suggestionId: 's1' }, userId: 'u1' }), response);

    expect(mocks.prisma.aiSuggestion.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'REJECTED', approvedById: 'u1' }),
    });
    expect(response.json).toHaveBeenCalledWith({ success: true, data: { rejected: true } });
  });

  it('exports an express router', async () => {
    const mod = await import('./tawany-routes');
    expect(mod.default).toBeDefined();
  });
});
