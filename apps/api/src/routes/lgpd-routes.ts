import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/deps';
import type { DataApi } from '../lib/data';
import { createPrismaDataApi } from '../lib/prisma-data-api';
import { anonymizeLead, exportLeadData } from '../lib/lgpd';
import { recordAudit } from '../lib/audit';
import { logger } from '../lib/logger';
import { authMiddleware } from '../middleware/auth-middleware';

const data = createPrismaDataApi(prisma);
const router = Router();

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (req.userRole?.toLowerCase() !== 'admin') {
    jsonError(res, 403, 'forbidden');
    return;
  }
  next();
};

export const exportLeadRoute = async (
  req: Request,
  res: Response,
  api: DataApi = data,
): Promise<void> => {
  const leadId = String(req.query.leadId ?? '');
  if (!leadId) {
    jsonError(res, 400, 'leadId required');
    return;
  }

  try {
    const exported = await exportLeadData(leadId, api);
    logger.info({ action: 'lgpd.export', leadId, actorId: req.userId }, 'LGPD export');
    // Sem before/after: o dado exportado não deve ser duplicado na auditoria.
    await recordAudit(prisma, { userId: req.userId ?? null, action: 'lgpd.export', entity: 'lead', entityId: leadId });
    res.json({ success: true, data: exported });
  } catch (error) {
    const message = (error as Error).message;
    jsonError(res, message === 'Lead not found' ? 404 : 500, message);
  }
};

export const anonymizeLeadRoute = async (
  req: Request,
  res: Response,
  api: DataApi = data,
): Promise<void> => {
  const leadId = String(req.body?.leadId ?? '');
  if (!leadId) {
    jsonError(res, 400, 'leadId required');
    return;
  }
  if (req.body?.confirmAnonymize !== true) {
    jsonError(res, 400, 'confirmAnonymize=true required');
    return;
  }

  try {
    const result = await anonymizeLead(leadId, api);
    logger.warn({ action: 'lgpd.anonymize', leadId, actorId: req.userId, ...result }, 'LGPD anonymize');
    await recordAudit(prisma, { userId: req.userId ?? null, action: 'lgpd.anonymize', entity: 'lead', entityId: leadId, after: result });
    res.json({ success: true, data: result });
  } catch (error) {
    const message = (error as Error).message;
    jsonError(res, message === 'Lead not found' ? 404 : 500, message);
  }
};

router.get('/export', authMiddleware, requireAdmin, (req, res) => void exportLeadRoute(req, res));
router.post('/anonymize', authMiddleware, requireAdmin, (req, res) => void anonymizeLeadRoute(req, res));

export default router;
