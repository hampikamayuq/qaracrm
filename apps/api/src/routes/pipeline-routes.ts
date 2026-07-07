import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/deps';
import { authMiddleware } from '../middleware/auth-middleware';

const router = Router();

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

const paramStr = (value: unknown): string => (typeof value === 'string' ? value : '');

const CLINICAL_PIPELINES = [
  'dermatologia-clinica',
  'tricologia',
  'cirurgia',
  'unhas',
  'podologia',
  'inflamatorias',
  'dermatopediatria',
  'administrativo',
  'reativacao',
] as const;

// Estágios simplificados do kanban clínico. Guardados como tag `status:<estagio>`
// no Lead (mesmo prefixo já aprovado no QARA_CLASSIFICATION_PROMPT) em vez de um
// novo campo — Lead.stageId/PipelineStage segue servindo o funil original
// (Task 11 / operations-routes), que tem granularidade diferente.
const UI_STAGES = ['NOVO', 'QUALIFICADO', 'AGENDADO', 'COMPARECEU', 'PERDIDO', 'CONVERTIDO'] as const;
const DEFAULT_STAGE: (typeof UI_STAGES)[number] = 'NOVO';

const tagsOf = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : [];

const valueByPrefix = (tags: string[], prefix: string): string | null => {
  const found = tags.find((t) => t.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
};

const stageFromTags = (tags: string[]): string => {
  const value = valueByPrefix(tags, 'status:');
  return value && (UI_STAGES as readonly string[]).includes(value) ? value : DEFAULT_STAGE;
};

const setTagPrefix = (tags: string[], prefix: string, value: string | null): string[] => {
  const filtered = tags.filter((t) => !t.startsWith(prefix));
  return value ? [...filtered, `${prefix}${value}`] : filtered;
};

export const getPipelinesRoute = async (_req: Request, res: Response): Promise<void> => {
  try {
    const pipelines = CLINICAL_PIPELINES.map((slug, index) => ({
      id: slug,
      name: slug.charAt(0).toUpperCase() + slug.slice(1).replace('-', ' '),
      slug,
      order: index,
      color: '#1976d2',
    }));
    res.json({ success: true, data: pipelines });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const getPipelineStagesRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const pipeline = paramStr(req.params.pipeline) || 'default';
    const stages = UI_STAGES.map((stage, index) => ({
      id: `${pipeline}-${stage}`,
      name: stage,
      pipeline,
      order: index,
      color: '#1976d2',
    }));
    res.json({ success: true, data: stages });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const getPipelineLeadsRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const pipelineFilter = typeof req.query.pipeline === 'string' && req.query.pipeline !== 'all'
      ? req.query.pipeline
      : undefined;

    const leads = await prisma.lead.findMany({
      orderBy: { score: 'desc' },
      select: {
        id: true, name: true, phone: true, email: true, source: true, intent: true,
        score: true, tags: true, temperature: true, nextActionAt: true,
      },
    });

    const shaped = leads.map((lead) => {
      const tags = tagsOf(lead.tags);
      return {
        id: lead.id,
        name: { firstName: lead.name, lastName: '' },
        stage: stageFromTags(tags),
        score: lead.score,
        whatsapp: { primaryPhoneNumber: lead.phone },
        email: { primaryEmail: lead.email },
        source: lead.source,
        intent: lead.intent,
        tags,
        temperature: lead.temperature,
        pipeline: valueByPrefix(tags, 'pipeline:'),
        notes: null as string | null,
        lastFollowUpAt: null as string | null,
        nextFollowUpAt: lead.nextActionAt ? lead.nextActionAt.toISOString() : null,
      };
    });

    const filtered = pipelineFilter ? shaped.filter((lead) => lead.pipeline === pipelineFilter) : shaped;
    res.json({ success: true, data: filtered });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const moveLeadRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const leadId = paramStr(req.params.id);
    const stage = req.body?.stage;
    const pipeline = req.body?.pipeline;

    if (!leadId) {
      jsonError(res, 400, 'leadId required');
      return;
    }
    if (typeof stage !== 'string' || !(UI_STAGES as readonly string[]).includes(stage)) {
      jsonError(res, 400, `stage must be one of: ${UI_STAGES.join(', ')}`);
      return;
    }

    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { tags: true } });
    if (!lead) {
      jsonError(res, 404, 'Lead not found');
      return;
    }

    let tags = setTagPrefix(tagsOf(lead.tags), 'status:', stage);
    if (typeof pipeline === 'string' && (CLINICAL_PIPELINES as readonly string[]).includes(pipeline)) {
      tags = setTagPrefix(tags, 'pipeline:', pipeline);
    }

    await prisma.lead.update({ where: { id: leadId }, data: { tags } });
    res.json({ success: true, data: { stage, pipeline } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const updateLeadPipelineRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const leadId = paramStr(req.params.id);
    const pipeline = req.body?.pipeline;

    if (!leadId) {
      jsonError(res, 400, 'leadId required');
      return;
    }
    if (typeof pipeline !== 'string' || !(CLINICAL_PIPELINES as readonly string[]).includes(pipeline)) {
      jsonError(res, 400, `pipeline must be one of: ${CLINICAL_PIPELINES.join(', ')}`);
      return;
    }

    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { tags: true } });
    if (!lead) {
      jsonError(res, 404, 'Lead not found');
      return;
    }

    const tags = setTagPrefix(tagsOf(lead.tags), 'pipeline:', pipeline);
    await prisma.lead.update({ where: { id: leadId }, data: { tags } });
    res.json({ success: true, data: { pipeline } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

router.get('/pipelines', authMiddleware, getPipelinesRoute);
router.get('/pipelines/:pipeline/stages', authMiddleware, getPipelineStagesRoute);
router.get('/pipeline/leads', authMiddleware, getPipelineLeadsRoute);
router.patch('/pipeline/leads/:id/move', authMiddleware, moveLeadRoute);
router.patch('/pipeline/leads/:id/pipeline', authMiddleware, updateLeadPipelineRoute);

export default router;
