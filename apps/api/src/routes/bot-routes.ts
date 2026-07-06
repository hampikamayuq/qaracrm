import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/deps';
import { authMiddleware } from '../middleware/auth-middleware';
import { botBlockedByRisk, parseBotFlow, parseBotSteps, findMatchingRule } from '../lib/bots/engine';

const router = Router();

const paramStr = (value: unknown): string => (typeof value === 'string' ? value : '');

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

export const listBotsRoute = async (_req: Request, res: Response): Promise<void> => {
  try {
    const bots = await prisma.bot.findMany({ orderBy: { createdAt: 'asc' } });
    res.json({
      success: true,
      data: bots.map((bot) => ({
        id: bot.id,
        name: bot.name,
        trigger: bot.trigger,
        active: bot.active,
        rules: parseBotSteps(bot.steps)?.rules.length ?? 0,
        createdAt: bot.createdAt,
        updatedAt: bot.updatedAt,
      })),
    });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const toggleBotRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = paramStr(req.params.id);
    const active = req.body?.active;
    if (typeof active !== 'boolean') {
      jsonError(res, 400, 'active (boolean) required');
      return;
    }
    const result = await prisma.bot.updateMany({ where: { id }, data: { active } });
    if (result.count === 0) {
      jsonError(res, 404, 'Bot not found');
      return;
    }
    res.json({ success: true, data: { id, active } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const importBotRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const flowJson = req.body?.flow;
    const source = typeof req.body?.source === 'string' ? req.body.source : 'importado.json';
    if (!flowJson || typeof flowJson !== 'object') {
      jsonError(res, 400, 'flow (JSON do fluxo) required');
      return;
    }

    const { name, flow } = parseBotFlow(flowJson, source);
    const steps = flow as unknown as Prisma.InputJsonValue;
    const existing = await prisma.bot.findFirst({ where: { name }, select: { id: true } });
    const bot = existing
      ? await prisma.bot.update({ where: { id: existing.id }, data: { steps, trigger: 'inbound-message' } })
      : await prisma.bot.create({ data: { name, trigger: 'inbound-message', active: true, steps } });

    res.json({
      success: true,
      data: { id: bot.id, name: bot.name, active: bot.active, rules: flow.rules.length, replaced: Boolean(existing) },
    });
  } catch (error) {
    jsonError(res, 400, (error as Error).message);
  }
};

export const testBotRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const text = req.body?.text;
    if (typeof text !== 'string' || text.trim().length === 0) {
      jsonError(res, 400, 'text required');
      return;
    }
    if (botBlockedByRisk(text)) {
      res.json({ success: true, data: { matched: false, blockedByRisk: true, responses: [] } });
      return;
    }
    const bots = await prisma.bot.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' } });
    for (const bot of bots) {
      const flow = parseBotSteps(bot.steps);
      if (!flow) continue;
      const rule = findMatchingRule(flow.rules, text);
      if (rule) {
        res.json({
          success: true,
          data: { matched: true, botId: bot.id, botName: bot.name, responses: rule.responses },
        });
        return;
      }
    }
    res.json({ success: true, data: { matched: false, responses: [] } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const deleteBotRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await prisma.bot.deleteMany({ where: { id: paramStr(req.params.id) } });
    if (result.count === 0) {
      jsonError(res, 404, 'Bot not found');
      return;
    }
    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

router.get('/', authMiddleware, listBotsRoute);
router.post('/import', authMiddleware, importBotRoute);
router.post('/test', authMiddleware, testBotRoute);
router.patch('/:id', authMiddleware, toggleBotRoute);
router.delete('/:id', authMiddleware, deleteBotRoute);

export default router;
