import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/deps';
import { authMiddleware } from '../middleware/auth-middleware';

const router = Router();

const paramStr = (value: unknown): string => (typeof value === 'string' ? value : '');

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

const PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const STATUSES = new Set(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELED']);

export const listTasksRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const status = typeof req.query.status === 'string' && STATUSES.has(req.query.status)
      ? req.query.status
      : undefined;
    const tasks = await prisma.task.findMany({
      where: status ? { status } : { status: { notIn: ['DONE', 'CANCELED'] } },
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 200,
      include: {
        lead: { select: { id: true, name: true } },
        conversation: { select: { id: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });
    res.json({ success: true, data: tasks });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const createTaskRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title) {
      jsonError(res, 400, 'title required');
      return;
    }
    const priority = typeof req.body?.priority === 'string' && PRIORITIES.has(req.body.priority)
      ? req.body.priority
      : 'MEDIUM';
    const dueAt = typeof req.body?.dueAt === 'string' && !Number.isNaN(Date.parse(req.body.dueAt))
      ? new Date(req.body.dueAt)
      : null;
    const conversationId = typeof req.body?.conversationId === 'string' ? req.body.conversationId : null;
    let leadId = typeof req.body?.leadId === 'string' ? req.body.leadId : null;

    if (conversationId && !leadId) {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { leadId: true },
      });
      leadId = conversation?.leadId ?? null;
    }

    const task = await prisma.task.create({
      data: {
        title,
        description: typeof req.body?.description === 'string' ? req.body.description : null,
        priority,
        dueAt,
        conversationId,
        leadId,
        assignedToId: req.userId ?? null,
      },
    });
    res.status(201).json({ success: true, data: task });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const updateTaskRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const status = req.body?.status;
    if (typeof status !== 'string' || !STATUSES.has(status)) {
      jsonError(res, 400, `status must be one of: ${[...STATUSES].join(', ')}`);
      return;
    }
    const result = await prisma.task.updateMany({ where: { id: paramStr(req.params.id) }, data: { status } });
    if (result.count === 0) {
      jsonError(res, 404, 'Task not found');
      return;
    }
    res.json({ success: true, data: { status } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

router.get('/', authMiddleware, listTasksRoute);
router.post('/', authMiddleware, createTaskRoute);
router.patch('/:id', authMiddleware, updateTaskRoute);

export default router;
