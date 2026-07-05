import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/deps';
import { createAiClient } from '../lib/ai-client';
import { createPrismaDataApi } from '../lib/prisma-data-api';
import { authMiddleware } from '../middleware/auth-middleware';
import { runTawanyHandler } from '../logic-functions/tawany-handler';
import { sendWhatsApp } from '../lib/tools/sendWhatsApp';

const router = Router();
const data = createPrismaDataApi(prisma);

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

export const runTawanyRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const messageId = req.body?.messageId;
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
      { ai: createAiClient(), data },
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

    await sendWhatsApp.execute({ conversationId: current.conversationId, text: finalBody }, data);
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

router.post('/run', authMiddleware, runTawanyRoute);
router.get('/suggestions/:conversationId', authMiddleware, listSuggestionsRoute);
router.post('/approve', authMiddleware, approveSuggestionRoute);
router.post('/reject', authMiddleware, rejectSuggestionRoute);

export default router;
