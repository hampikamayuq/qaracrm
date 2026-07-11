import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/deps';
import { authMiddleware } from '../middleware/auth-middleware';
import { requireAdmin } from '../middleware/authorization';

const router = Router();

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

const positiveInt = (value: unknown, fallback: number): number => {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const queryStr = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const queryDate = (value: unknown): Date | undefined => {
  const text = queryStr(value);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export const listAuditRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = positiveInt(req.query.page, 1);
    const pageSize = Math.min(100, positiveInt(req.query.pageSize, 25));
    const entity = queryStr(req.query.entity);
    const userId = queryStr(req.query.userId);
    const action = queryStr(req.query.action);
    const from = queryDate(req.query.from);
    const to = queryDate(req.query.to);

    const where: Prisma.AuditLogWhereInput = {};
    if (entity) where.entity = entity;
    if (userId) where.userId = userId;
    if (action) where.action = { contains: action, mode: 'insensitive' };
    if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

    const [rows, total, distinctEntities] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditLog.count({ where }),
      // Para o filtro de entidade da UI (select das entidades conhecidas).
      prisma.auditLog.findMany({ distinct: ['entity'], select: { entity: true }, orderBy: { entity: 'asc' } }),
    ]);

    // userId sem FK de propósito: usuário deletado → userName null e a UI
    // mostra "usuário removido".
    const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is string => typeof id === 'string'))];
    const users = userIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    res.json({
      success: true,
      data: {
        items: rows.map((row) => ({
          id: row.id,
          userId: row.userId,
          userName: row.userId ? nameById.get(row.userId) ?? null : null,
          action: row.action,
          entity: row.entity,
          entityId: row.entityId,
          before: row.before,
          after: row.after,
          createdAt: row.createdAt,
        })),
        total,
        page,
        pageSize,
        entities: distinctEntities.map((e) => e.entity),
      },
    });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

router.get('/', authMiddleware, requireAdmin, (req, res) => void listAuditRoute(req, res));

export default router;
