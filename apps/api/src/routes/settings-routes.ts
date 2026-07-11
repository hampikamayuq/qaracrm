import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/deps';
import { authMiddleware } from '../middleware/auth-middleware';
import { requireAdmin } from '../middleware/authorization';
import { invalidateKnowledgeCache } from '../lib/tawany/knowledge';
import { recordAudit } from '../lib/audit';
import { getShadowMode } from '../lib/shadow';
import {
  AI_SETTINGS_SLUG,
  parseAiSettings,
  parseAiSettingsContent,
  serializeAiSettings,
  type AiRuntimeSettings,
} from '../lib/ai-settings';

const router = Router();

const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 20_000;

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

export const listKnowledgeRoute = async (_req: Request, res: Response): Promise<void> => {
  try {
    const sections = await prisma.knowledgeSection.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, slug: true, title: true, content: true, updatedAt: true, updatedById: true },
    });
    const userIds = [...new Set(sections.map((s) => s.updatedById).filter((id): id is string => typeof id === 'string'))];
    const users = userIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    res.json({
      success: true,
      data: sections.map((s) => ({
        ...s,
        updatedByName: s.updatedById ? nameById.get(s.updatedById) ?? null : null,
      })),
    });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const updateKnowledgeRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const slug = typeof req.params.slug === 'string' ? req.params.slug : '';
    const content = req.body?.content;
    const title = req.body?.title;
    if (typeof content !== 'string' || content.trim().length === 0) {
      jsonError(res, 400, 'content must be a non-empty string');
      return;
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      jsonError(res, 400, `content exceeds ${MAX_CONTENT_LENGTH} characters`);
      return;
    }
    if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0 || title.length > MAX_TITLE_LENGTH)) {
      jsonError(res, 400, `title must be a non-empty string up to ${MAX_TITLE_LENGTH} characters`);
      return;
    }

    const existing = await prisma.knowledgeSection.findFirst({ where: { slug }, select: { content: true } });
    const result = await prisma.knowledgeSection.updateMany({
      where: { slug },
      data: {
        content,
        ...(typeof title === 'string' ? { title: title.trim() } : {}),
        updatedById: req.userId ?? null,
      },
    });
    if (result.count === 0) {
      jsonError(res, 404, 'Knowledge section not found');
      return;
    }
    invalidateKnowledgeCache();
    // Só os primeiros 200 chars do content para não inflar a tabela.
    await recordAudit(prisma, {
      userId: req.userId ?? null,
      action: 'knowledge.update',
      entity: 'knowledge_section',
      entityId: slug,
      before: { content: existing?.content?.slice(0, 200) ?? null },
      after: { content: content.slice(0, 200) },
    });
    res.json({ success: true, data: { slug } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

// GET informativo para /settings/ai: modo de envio atual e versão do prompt.
export const aiSettingsRoute = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.knowledgeSection.findMany({
      where: { slug: AI_SETTINGS_SLUG },
      take: 1,
      select: { content: true },
    });
    const settings = parseAiSettingsContent(rows[0]?.content);
    res.json({
      success: true,
      data: {
        mode: settings.mode,
        shadowMode: getShadowMode(),
        promptVersion: process.env.TAWANY_PROMPT_VERSION ?? 'v1',
        autopilotIntents: settings.autopilotIntents,
      },
    });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const updateAiSettingsRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = parseAiSettings(req.body);
    const requested = req.body && typeof req.body === 'object' ? req.body as Partial<AiRuntimeSettings> : {};
    if (requested.mode !== undefined && parsed.mode !== requested.mode) {
      jsonError(res, 400, 'invalid mode');
      return;
    }
    const content = serializeAiSettings(parsed);
    const rows = await prisma.knowledgeSection.findMany({
      where: { slug: AI_SETTINGS_SLUG },
      take: 1,
      select: { content: true },
    });
    const before = parseAiSettingsContent(rows[0]?.content);
    await prisma.knowledgeSection.upsert({
      where: { slug: AI_SETTINGS_SLUG },
      create: {
        slug: AI_SETTINGS_SLUG,
        title: 'AI settings',
        content,
        sortOrder: 10_000,
        updatedById: req.userId ?? null,
      },
      update: {
        content,
        updatedById: req.userId ?? null,
      },
    });
    await recordAudit(prisma, {
      userId: req.userId ?? null,
      action: 'ai_settings.update',
      entity: 'ai_settings',
      entityId: AI_SETTINGS_SLUG,
      before,
      after: parsed,
    });
    res.json({ success: true, data: parsed });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

router.get('/knowledge', authMiddleware, listKnowledgeRoute);
router.put('/knowledge/:slug', authMiddleware, requireAdmin, updateKnowledgeRoute);
router.get('/ai', authMiddleware, aiSettingsRoute);
router.put('/ai', authMiddleware, requireAdmin, updateAiSettingsRoute);

export default router;
