import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/deps';
import { authMiddleware } from '../middleware/auth-middleware';

const router = Router();

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

const positiveInt = (value: unknown, fallback: number): number => {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const listInboxRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const status = typeof req.query.status === 'string' && req.query.status.length > 0
      ? req.query.status
      : undefined;
    const needsHuman = req.query.needsHuman === 'true'
      ? true
      : req.query.needsHuman === 'false'
        ? false
        : undefined;
    const page = positiveInt(req.query.page, 1);
    const pageSize = Math.min(100, positiveInt(req.query.pageSize, 25));
    const where: Prisma.ConversationWhereInput = {};

    if (status) where.status = status;
    if (needsHuman !== undefined) where.needsHuman = needsHuman;
    if (search) {
      // ponytail: ILIKE on lead name is enough for C1; add pg_trgm when this hurts.
      where.lead = { name: { contains: search, mode: 'insensitive' } };
    }

    const [items, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          status: true,
          needsHuman: true,
          channel: true,
          lastMessageAt: true,
          updatedAt: true,
          lead: {
            select: {
              id: true,
              name: true,
              phone: true,
              score: true,
              tags: true,
              temperature: true,
            },
          },
          messages: {
            take: 1,
            orderBy: { sentAt: 'desc' },
            select: { id: true, body: true, sentAt: true, direction: true },
          },
          aiSuggestions: {
            where: { status: 'PENDING' },
            take: 1,
            select: { id: true, body: true, riskLevel: true, status: true },
          },
        },
      }),
      prisma.conversation.count({ where }),
    ]);

    res.json({ success: true, data: { items, total, page } });
  } catch {
    jsonError(res, 500, 'Failed to load inbox');
  }
};

export const getInboxDetailRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    if (typeof id !== 'string' || id.length === 0) {
      jsonError(res, 400, 'conversation id required');
      return;
    }

    const item = await prisma.conversation.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        needsHuman: true,
        channel: true,
        lastMessageAt: true,
        updatedAt: true,
        classification: true,
        lead: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            source: true,
            intent: true,
            score: true,
            tags: true,
            temperature: true,
            nextAction: true,
            stage: { select: { id: true, name: true } },
          },
        },
        patient: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            preferredChannel: true,
            notesAdministrative: true,
          },
        },
        messages: {
          take: 100,
          orderBy: { sentAt: 'asc' },
          select: {
            id: true,
            direction: true,
            body: true,
            mediaUrl: true,
            agentHandled: true,
            sentAt: true,
          },
        },
        tasks: {
          where: { status: { not: 'DONE' } },
          orderBy: { dueAt: 'asc' },
          take: 8,
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueAt: true,
          },
        },
        aiSuggestions: {
          where: { status: 'PENDING' },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            body: true,
            riskLevel: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    if (!item) {
      jsonError(res, 404, 'Conversation not found');
      return;
    }

    res.json({ success: true, data: item });
  } catch {
    jsonError(res, 500, 'Failed to load conversation');
  }
};

router.get('/list', authMiddleware, listInboxRoute);
router.get('/:id', authMiddleware, getInboxDetailRoute);

export default router;
