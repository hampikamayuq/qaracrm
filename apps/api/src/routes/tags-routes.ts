import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/deps';
import { createPrismaDataApi } from '../lib/prisma-data-api';
import { authMiddleware } from '../middleware/auth-middleware';

const router = Router();
const data = createPrismaDataApi(prisma);

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

const CANONICAL_TAGS = [
  { value: 'LEAD_QUENTE', label: 'Lead Quente', color: 'orange', category: 'temperature' },
  { value: 'LEAD_FRIO', label: 'Lead Frio', color: 'blue', category: 'temperature' },
  { value: 'NOVO', label: 'Novo', color: 'turquoise', category: 'status' },
  { value: 'AGENDAR', label: 'Agendar', color: 'purple', category: 'action' },
  { value: 'FOLLOW_UP', label: 'Follow-up', color: 'yellow', category: 'action' },
  { value: 'NO_SHOW', label: 'No-show', color: 'red', category: 'outcome' },
  { value: 'VIP', label: 'VIP', color: 'pink', category: 'priority' },
  { value: 'HUMANO', label: 'Humano', color: 'green', category: 'routing' },
] as const;

const CONTEXTUAL_TAG_CATEGORIES = {
  alerta: ['alerta:urgente', 'alerta:lgpd', 'alerta:reclamacao', 'alerta:duvida_medica'],
  pipeline: ['pipeline:unhas', 'pipeline:cirurgia', 'pipeline:tricologia', 'pipeline:inflamatorias', 'pipeline:dermatopediatria', 'pipeline:dermatologia-clinica', 'pipeline:podologia', 'pipeline:administrativo', 'pipeline:reativacao'],
  origem: ['origem:site', 'origem:instagram', 'origem:indicacao', 'origem:google', 'origem:meta_ads', 'origem:outro'],
} as const;

export const getCanonicalTagsRoute = async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json({ success: true, data: CANONICAL_TAGS });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const getContextualTagsRoute = async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json({ success: true, data: CONTEXTUAL_TAG_CATEGORIES });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const addTagRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const leadId = Array.isArray(req.params.leadId) ? req.params.leadId[0] : req.params.leadId;
    const tag = typeof req.body?.tag === 'string' ? req.body.tag.trim() : '';

    if (!leadId) {
      jsonError(res, 400, 'leadId required');
      return;
    }
    if (!tag) {
      jsonError(res, 400, 'tag required');
      return;
    }

    const lead = await data.get('lead', leadId, { tags: true });
    if (!lead) {
      jsonError(res, 404, 'Lead not found');
      return;
    }

    const currentTags = Array.isArray(lead.tags) ? lead.tags.filter((t): t is string => typeof t === 'string') : [];
    if (currentTags.includes(tag)) {
      res.json({ success: true, data: { tags: currentTags, added: false } });
      return;
    }

    const updatedTags = [...currentTags, tag];
    await data.update('lead', leadId, { tags: updatedTags });
    res.json({ success: true, data: { tags: updatedTags, added: true } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const removeTagRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const leadId = Array.isArray(req.params.leadId) ? req.params.leadId[0] : req.params.leadId;
    const tag = Array.isArray(req.params.tag) ? req.params.tag[0] : req.params.tag;
    const decodedTag = decodeURIComponent(tag);

    if (!leadId) {
      jsonError(res, 400, 'leadId required');
      return;
    }

    const lead = await data.get('lead', leadId, { tags: true });
    if (!lead) {
      jsonError(res, 404, 'Lead not found');
      return;
    }

    const currentTags = Array.isArray(lead.tags) ? lead.tags.filter((t): t is string => typeof t === 'string') : [];
    const updatedTags = currentTags.filter((t) => t !== decodedTag);
    await data.update('lead', leadId, { tags: updatedTags });
    res.json({ success: true, data: { tags: updatedTags, removed: true } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const replaceTagsRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const leadId = Array.isArray(req.params.leadId) ? req.params.leadId[0] : req.params.leadId;
    const bodyTags = req.body?.tags;
    const tags = Array.isArray(bodyTags) ? bodyTags.filter((t): t is string => typeof t === 'string') : [];

    if (!leadId) {
      jsonError(res, 400, 'leadId required');
      return;
    }

    const lead = await data.get('lead', leadId, { tags: true });
    if (!lead) {
      jsonError(res, 404, 'Lead not found');
      return;
    }

    await data.update('lead', leadId, { tags });
    res.json({ success: true, data: { tags } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

router.get('/canonical', authMiddleware, getCanonicalTagsRoute);
router.get('/contextual', authMiddleware, getContextualTagsRoute);
router.post('/leads/:leadId/tags', authMiddleware, addTagRoute);
router.delete('/leads/:leadId/tags/:tag', authMiddleware, removeTagRoute);
router.put('/leads/:leadId/tags', authMiddleware, replaceTagsRoute);

export default router;