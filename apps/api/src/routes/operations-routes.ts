import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/deps';
import { createAiClient } from '../lib/ai-client';
import { createPrismaDataApi } from '../lib/prisma-data-api';
import { authMiddleware } from '../middleware/auth-middleware';
import { runQaraClassifier } from '../logic-functions/qara-classifier';
import { sendWhatsAppTemplate } from '../lib/tools/sendWhatsAppTemplate';

const router = Router();
const data = createPrismaDataApi(prisma);

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

export const followUpRoute = async (_req: Request, res: Response): Promise<void> => {
  try {
    const cutoff = new Date(Date.now() - 24 * 3600_000);
    const conversations = await data.list('conversation', {
      filter: { status: { eq: 'OPEN' } },
      select: { id: true, updatedAt: true },
    });

    let sent = 0;
    for (const conversation of conversations) {
      const id = typeof conversation.id === 'string' ? conversation.id : '';
      if (!id) continue;
      const updatedAt = typeof conversation.updatedAt === 'string'
        ? new Date(conversation.updatedAt)
        : conversation.updatedAt instanceof Date
          ? conversation.updatedAt
          : null;
      if (updatedAt && updatedAt >= cutoff) continue;

      await sendWhatsAppTemplate.execute({
        conversationId: id,
        templateName: process.env.WHATSAPP_FOLLOWUP_TEMPLATE ?? 'qara_followup_24h',
        language: 'pt_BR',
      }, data);
      await data.update('conversation', id, { status: 'PENDING_PATIENT' });
      sent++;
    }

    res.json({ success: true, data: { conversationsChecked: conversations.length, followUpsSent: sent } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const classifyRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, leadId, conversationId } = req.body ?? {};
    if (typeof message !== 'string' || message.length === 0 || typeof leadId !== 'string' || leadId.length === 0) {
      jsonError(res, 400, 'message and leadId required');
      return;
    }
    const result = await runQaraClassifier(
      { message, leadId, conversationId: typeof conversationId === 'string' ? conversationId : undefined },
      { ai: createAiClient(), data },
    );
    res.json({ success: true, data: result });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

router.post('/follow-up', authMiddleware, followUpRoute);
router.post('/classify', authMiddleware, classifyRoute);

export default router;
