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
        findMany: vi.fn(),
      },
      chatMessage: {
        findMany: vi.fn(),
      },
      tawanyExample: {
        create: vi.fn(),
        findMany: vi.fn(),
        deleteMany: vi.fn(),
      },
    },
    invalidateKnowledgeCache: vi.fn(),
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
vi.mock('../lib/tawany/knowledge', () => ({
  invalidateKnowledgeCache: mocks.invalidateKnowledgeCache,
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

describe('Tawany feedback e exemplos few-shot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('feedback valida o payload (UP|DOWN, note string curta)', async () => {
    const { suggestionFeedbackRoute } = await import('./tawany-routes');

    const badValue = res();
    await suggestionFeedbackRoute(req({ params: { id: 's1' }, body: { feedback: 'MAYBE' } }), badValue);
    expect(badValue.status).toHaveBeenCalledWith(400);

    const badNote = res();
    await suggestionFeedbackRoute(
      req({ params: { id: 's1' }, body: { feedback: 'DOWN', note: 'x'.repeat(2_001) } }),
      badNote,
    );
    expect(badNote.status).toHaveBeenCalledWith(400);
    expect(mocks.prisma.aiSuggestion.updateMany).not.toHaveBeenCalled();
  });

  it('feedback grava UP/DOWN com nota e autor', async () => {
    mocks.prisma.aiSuggestion.updateMany.mockResolvedValue({ count: 1 });
    const { suggestionFeedbackRoute } = await import('./tawany-routes');
    const response = res();

    await suggestionFeedbackRoute(
      req({ params: { id: 's1' }, body: { feedback: 'DOWN', note: ' deveria oferecer horários ' }, userId: 'u1' }),
      response,
    );

    expect(mocks.prisma.aiSuggestion.updateMany).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { feedback: 'DOWN', feedbackNote: 'deveria oferecer horários', feedbackById: 'u1' },
    });
    expect(response.json).toHaveBeenCalledWith({ success: true, data: { feedback: 'DOWN' } });
  });

  it('feedback retorna 404 para sugestão inexistente', async () => {
    mocks.prisma.aiSuggestion.updateMany.mockResolvedValue({ count: 0 });
    const { suggestionFeedbackRoute } = await import('./tawany-routes');
    const response = res();

    await suggestionFeedbackRoute(req({ params: { id: 'ghost' }, body: { feedback: 'UP' } }), response);

    expect(response.status).toHaveBeenCalledWith(404);
  });

  it('review-queue lista os 👎 com a pergunta do paciente resolvida via messageId', async () => {
    mocks.prisma.aiSuggestion.findMany.mockResolvedValue([
      { id: 's1', body: 'resposta ruim', feedbackNote: 'nota', conversationId: 'c1', messageId: 'm1', status: 'SENT', createdAt: new Date() },
      { id: 's2', body: 'outra', feedbackNote: null, conversationId: 'c2', messageId: null, status: 'SENT', createdAt: new Date() },
    ]);
    mocks.prisma.chatMessage.findMany.mockResolvedValue([{ id: 'm1', body: 'Qual o valor da consulta?' }]);
    const { reviewQueueRoute } = await import('./tawany-routes');
    const response = res();

    await reviewQueueRoute(req({}), response);

    expect(mocks.prisma.aiSuggestion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { feedback: 'DOWN' },
    }));
    const payload = response.json.mock.calls[0][0].data;
    expect(payload[0].question).toBe('Qual o valor da consulta?');
    expect(payload[1].question).toBeNull();
  });

  it('cria exemplo few-shot validado e invalida o cache do prompt', async () => {
    mocks.prisma.tawanyExample.create.mockResolvedValue({ id: 'e1', question: 'q', answer: 'a' });
    const { createExampleRoute } = await import('./tawany-routes');

    const bad = res();
    await createExampleRoute(req({ body: { question: ' ', answer: 'a' } }), bad);
    expect(bad.status).toHaveBeenCalledWith(400);

    const ok = res();
    await createExampleRoute(req({ body: { question: ' Qual o valor? ', answer: ' R$ 450. ' }, userId: 'u1' }), ok);
    expect(mocks.prisma.tawanyExample.create).toHaveBeenCalledWith({
      data: { question: 'Qual o valor?', answer: 'R$ 450.', createdById: 'u1' },
    });
    expect(mocks.invalidateKnowledgeCache).toHaveBeenCalledTimes(1);
    expect(ok.json).toHaveBeenCalledWith({ success: true, data: { id: 'e1', question: 'q', answer: 'a' } });
  });

  it('lista e exclui exemplos (404 para id inexistente)', async () => {
    mocks.prisma.tawanyExample.findMany.mockResolvedValue([{ id: 'e1' }]);
    mocks.prisma.tawanyExample.deleteMany.mockResolvedValue({ count: 1 });
    const { listExamplesRoute, deleteExampleRoute } = await import('./tawany-routes');

    const list = res();
    await listExamplesRoute(req({}), list);
    expect(list.json).toHaveBeenCalledWith({ success: true, data: [{ id: 'e1' }] });

    const del = res();
    await deleteExampleRoute(req({ params: { id: 'e1' } }), del);
    expect(mocks.prisma.tawanyExample.deleteMany).toHaveBeenCalledWith({ where: { id: 'e1' } });
    expect(del.json).toHaveBeenCalledWith({ success: true, data: { deleted: true } });

    mocks.prisma.tawanyExample.deleteMany.mockResolvedValue({ count: 0 });
    const notFound = res();
    await deleteExampleRoute(req({ params: { id: 'ghost' } }), notFound);
    expect(notFound.status).toHaveBeenCalledWith(404);
  });
});
