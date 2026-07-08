import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/deps';
import { createAiClient } from '../lib/ai-client';
import { createPrismaDataApi } from '../lib/prisma-data-api';
import { authMiddleware } from '../middleware/auth-middleware';
import { runTawanyHandler } from '../logic-functions/tawany-handler';
import { sendWhatsApp } from '../lib/tools/sendWhatsApp';
import { invalidateKnowledgeCache } from '../lib/tawany/knowledge';

const router = Router();
const data = createPrismaDataApi(prisma);

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

export const runTawanyRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const messageId = req.body?.messageId;
    const testMode = req.body?.testMode === true;
    if (typeof messageId !== 'string' || messageId.length === 0) {
      jsonError(res, 400, 'messageId required');
      return;
    }

    const message = await data.get('chatMessage', messageId);
    if (!message) {
      jsonError(res, 404, 'Message not found');
      return;
    }

    const result = await runTawanyHandler(
      message as { id: string; conversationId: string; direction: 'IN' | 'OUT'; body: string; agentHandled?: boolean },
      { ai: createAiClient(), data, testMode },
    );
    res.json({ success: true, data: result });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const listSuggestionsRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const conversationId = req.params.conversationId;
    if (typeof conversationId !== 'string' || conversationId.length === 0) {
      jsonError(res, 400, 'conversationId required');
      return;
    }
    const suggestions = await data.list('aiSuggestion', {
      filter: {
        conversationId: { eq: conversationId },
        status: { eq: 'PENDING' },
      },
      orderBy: { createdAt: 'DESC' },
    });
    res.json({ success: true, data: suggestions });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const approveSuggestionRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const suggestionId = req.body?.suggestionId;
    const editedBody = req.body?.body;
    if (typeof suggestionId !== 'string' || suggestionId.length === 0) {
      jsonError(res, 400, 'suggestionId required');
      return;
    }
    if (editedBody !== undefined && (typeof editedBody !== 'string' || editedBody.trim().length === 0)) {
      jsonError(res, 400, 'body must be a non-empty string when provided');
      return;
    }

    const current = await prisma.aiSuggestion.findUnique({
      where: { id: suggestionId },
      select: { body: true, status: true, conversationId: true },
    });
    if (!current || current.status !== 'PENDING') {
      jsonError(res, 409, 'Suggestion not found or already processed');
      return;
    }

    const finalBody = typeof editedBody === 'string' ? editedBody : current.body;
    const humanEdited = finalBody !== current.body;
    const result = await prisma.aiSuggestion.updateMany({
      where: { id: suggestionId, status: 'PENDING' },
      data: {
        status: 'APPROVED',
        approvedById: req.userId,
        decidedAt: new Date(),
        humanEdited,
        ...(humanEdited ? { originalBody: current.body, body: finalBody } : {}),
      },
    });
    if (result.count === 0) {
      jsonError(res, 409, 'Suggestion not found or already processed');
      return;
    }

    try {
      await sendWhatsApp.execute({ conversationId: current.conversationId, text: finalBody }, data);
    } catch (error) {
      await prisma.aiSuggestion.update({
        where: { id: suggestionId },
        data: {
          status: 'PENDING',
          approvedById: null,
          decidedAt: null,
          humanEdited,
          ...(humanEdited ? { originalBody: current.body, body: finalBody } : {}),
        },
      });
      console.error('[tawany] approved suggestion send failed:', (error as Error).message);
      jsonError(res, 502, 'Failed to send approved suggestion');
      return;
    }
    await prisma.aiSuggestion.update({
      where: { id: suggestionId },
      data: { status: 'SENT' },
    });
    res.json({ success: true, data: { sent: true, humanEdited } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const rejectSuggestionRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const suggestionId = req.body?.suggestionId;
    if (typeof suggestionId !== 'string' || suggestionId.length === 0) {
      jsonError(res, 400, 'suggestionId required');
      return;
    }

    const result = await prisma.aiSuggestion.updateMany({
      where: { id: suggestionId, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        approvedById: req.userId,
        decidedAt: new Date(),
      },
    });
    if (result.count === 0) {
      jsonError(res, 409, 'Suggestion not found or already processed');
      return;
    }
    res.json({ success: true, data: { rejected: true } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

// ---------------- feedback 👍/👎 e exemplos few-shot ----------------

const MAX_FEEDBACK_NOTE_LENGTH = 2_000;
const MAX_EXAMPLE_LENGTH = 2_000;

export const suggestionFeedbackRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const feedback = req.body?.feedback;
    const note = req.body?.note;
    if (feedback !== 'UP' && feedback !== 'DOWN') {
      jsonError(res, 400, "feedback must be 'UP' or 'DOWN'");
      return;
    }
    if (note !== undefined && (typeof note !== 'string' || note.length > MAX_FEEDBACK_NOTE_LENGTH)) {
      jsonError(res, 400, `note must be a string up to ${MAX_FEEDBACK_NOTE_LENGTH} characters`);
      return;
    }

    const result = await prisma.aiSuggestion.updateMany({
      where: { id },
      data: {
        feedback,
        feedbackNote: typeof note === 'string' && note.trim().length > 0 ? note.trim() : null,
        feedbackById: req.userId ?? null,
      },
    });
    if (result.count === 0) {
      jsonError(res, 404, 'Suggestion not found');
      return;
    }
    res.json({ success: true, data: { feedback } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

// Fila de revisão: sugestões com 👎, com a pergunta do paciente (messageId da
// mensagem IN que disparou o run) para pré-preencher "Transformar em exemplo".
export const reviewQueueRoute = async (_req: Request, res: Response): Promise<void> => {
  try {
    const items = await prisma.aiSuggestion.findMany({
      where: { feedback: 'DOWN' },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        body: true,
        feedbackNote: true,
        conversationId: true,
        messageId: true,
        status: true,
        createdAt: true,
      },
    });
    const messageIds = [...new Set(items.map((i) => i.messageId).filter((v): v is string => typeof v === 'string'))];
    const messages = messageIds.length > 0
      ? await prisma.chatMessage.findMany({ where: { id: { in: messageIds } }, select: { id: true, body: true } })
      : [];
    const bodyById = new Map(messages.map((m) => [m.id, m.body]));
    res.json({
      success: true,
      data: items.map((i) => ({
        ...i,
        question: i.messageId ? bodyById.get(i.messageId) ?? null : null,
      })),
    });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const createExampleRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const question = req.body?.question;
    const answer = req.body?.answer;
    const valid = (v: unknown): v is string =>
      typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_EXAMPLE_LENGTH;
    if (!valid(question) || !valid(answer)) {
      jsonError(res, 400, `question and answer must be non-empty strings up to ${MAX_EXAMPLE_LENGTH} characters`);
      return;
    }
    const example = await prisma.tawanyExample.create({
      data: { question: question.trim(), answer: answer.trim(), createdById: req.userId ?? null },
    });
    invalidateKnowledgeCache();
    res.json({ success: true, data: example });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const listExamplesRoute = async (_req: Request, res: Response): Promise<void> => {
  try {
    const examples = await prisma.tawanyExample.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ success: true, data: examples });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const deleteExampleRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const result = await prisma.tawanyExample.deleteMany({ where: { id } });
    if (result.count === 0) {
      jsonError(res, 404, 'Example not found');
      return;
    }
    invalidateKnowledgeCache();
    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

router.post('/run', authMiddleware, runTawanyRoute);
router.get('/suggestions/:conversationId', authMiddleware, listSuggestionsRoute);
router.post('/approve', authMiddleware, approveSuggestionRoute);
router.post('/reject', authMiddleware, rejectSuggestionRoute);
router.post('/suggestions/:id/feedback', authMiddleware, suggestionFeedbackRoute);
router.get('/review-queue', authMiddleware, reviewQueueRoute);
router.post('/examples', authMiddleware, createExampleRoute);
router.get('/examples', authMiddleware, listExamplesRoute);
router.delete('/examples/:id', authMiddleware, deleteExampleRoute);

export default router;
