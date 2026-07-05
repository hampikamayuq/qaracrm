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
          updatedAt: true,
          lead: { select: { id: true, name: true } },
          messages: {
            take: 1,
            orderBy: { sentAt: 'desc' },
            select: { body: true, sentAt: true },
          },
          aiSuggestions: {
            where: { status: 'PENDING' },
            take: 1,
            select: { id: true, body: true, riskLevel: true },
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

router.get('/list', authMiddleware, listInboxRoute);

export default router;
