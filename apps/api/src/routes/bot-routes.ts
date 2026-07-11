import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/deps';
import { authMiddleware } from '../middleware/auth-middleware';
import { requireAdmin } from '../middleware/authorization';
import {
  botBlockedByRisk,
  parseBotFlow,
  parseBotSteps,
  findMatchingRule,
  MAX_RESPONSES_PER_RULE,
  type BotFlow,
} from '../lib/bots/engine';
import { LEADS_NOVOS_RISK_KEYWORDS } from '../lib/leads-novos/rules';
import { recordAudit } from '../lib/audit';

const router = Router();

const paramStr = (value: unknown): string => (typeof value === 'string' ? value : '');

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

// Valida o payload do editor ({ name, rules }) com erros amigáveis por regra.
// Validação manual no padrão do arquivo — zod não é o padrão das rotas.
const parseEditorPayload = (body: unknown): { name: string; flow: BotFlow } | { error: string } => {
  const rec = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const name = typeof rec.name === 'string' ? rec.name.trim() : '';
  if (!name) return { error: 'name (nome do bot) required' };
  if (!Array.isArray(rec.rules) || rec.rules.length === 0) {
    return { error: 'rules (ao menos uma regra) required' };
  }
  const rules: BotFlow['rules'] = [];
  for (const [index, raw] of rec.rules.entries()) {
    const rule = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const terms = Array.isArray(rule.terms)
      ? rule.terms.map((term) => String(term).trim()).filter(Boolean)
      : [];
    const responses = Array.isArray(rule.responses)
      ? rule.responses.map((response) => String(response).replace(/\r/g, '').trim()).filter(Boolean)
      : [];
    if (terms.length === 0) return { error: `Regra ${index + 1}: adicione ao menos um gatilho` };
    if (responses.length === 0) return { error: `Regra ${index + 1}: adicione ao menos uma resposta` };
    if (responses.length > MAX_RESPONSES_PER_RULE) {
      return { error: `Regra ${index + 1}: máximo de ${MAX_RESPONSES_PER_RULE} respostas` };
    }
    rules.push({ terms, responses });
  }
  return { name, flow: { mode: 'first-match', match: 'normalized-contains', rules } };
};

// Versionamento enxuto: reusa o modelo Activity (targetType 'bot', type
// 'BOT_VERSION'), mesmo padrão do histórico de movimentação do pipeline —
// sem tabela nova nem migration. body = snapshot JSON { name, steps }.
type BotSnapshot = { name: string; steps: unknown };

const recordBotVersion = async (
  bot: { id: string; name: string; steps: unknown },
  userId: string | undefined,
): Promise<void> => {
  await prisma.activity.create({
    data: {
      targetType: 'bot',
      targetId: bot.id,
      type: 'BOT_VERSION',
      title: `Versão de "${bot.name}"`,
      userId: userId ?? null,
      body: JSON.stringify({ name: bot.name, steps: bot.steps } satisfies BotSnapshot),
    },
  });
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
    await recordAudit(prisma, {
      userId: req.userId ?? null,
      action: 'bot.toggle',
      entity: 'bot',
      entityId: id,
      after: { active },
    });
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

    await recordAudit(prisma, {
      userId: req.userId ?? null,
      action: 'bot.import',
      entity: 'bot',
      entityId: bot.id,
      after: { name: bot.name, rules: flow.rules.length, replaced: Boolean(existing), source },
    });
    res.json({
      success: true,
      data: { id: bot.id, name: bot.name, active: bot.active, rules: flow.rules.length, replaced: Boolean(existing) },
    });
  } catch (error) {
    jsonError(res, 400, (error as Error).message);
  }
};

export const createBotRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = parseEditorPayload(req.body);
    if ('error' in parsed) {
      jsonError(res, 400, parsed.error);
      return;
    }
    const bot = await prisma.bot.create({
      data: {
        name: parsed.name,
        trigger: 'inbound-message',
        // Bot criado do zero nasce pausado — a equipe ativa quando revisar.
        active: req.body?.active === true,
        steps: parsed.flow as unknown as Prisma.InputJsonValue,
      },
    });
    await recordAudit(prisma, {
      userId: req.userId ?? null,
      action: 'bot.create',
      entity: 'bot',
      entityId: bot.id,
      after: { name: bot.name, active: bot.active, rules: parsed.flow.rules.length },
    });
    res.json({
      success: true,
      data: { id: bot.id, name: bot.name, active: bot.active, rules: parsed.flow.rules.length },
    });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const getBotRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const bot = await prisma.bot.findUnique({ where: { id: paramStr(req.params.id) } });
    if (!bot) {
      jsonError(res, 404, 'Bot not found');
      return;
    }
    const flow = parseBotSteps(bot.steps);
    res.json({
      success: true,
      data: {
        id: bot.id,
        name: bot.name,
        trigger: bot.trigger,
        active: bot.active,
        rules: flow?.rules ?? [],
        createdAt: bot.createdAt,
        updatedAt: bot.updatedAt,
      },
    });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const updateBotRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = paramStr(req.params.id);
    const parsed = parseEditorPayload(req.body);
    if ('error' in parsed) {
      jsonError(res, 400, parsed.error);
      return;
    }
    const bot = await prisma.bot.findUnique({ where: { id } });
    if (!bot) {
      jsonError(res, 404, 'Bot not found');
      return;
    }
    // Guarda a versão anterior antes de sobrescrever.
    await recordBotVersion(bot, req.userId);
    await prisma.bot.update({
      where: { id },
      data: { name: parsed.name, steps: parsed.flow as unknown as Prisma.InputJsonValue },
    });
    await recordAudit(prisma, {
      userId: req.userId ?? null,
      action: 'bot.update',
      entity: 'bot',
      entityId: id,
      // Snapshot completo já vai para o versionamento (BOT_VERSION); aqui só o resumo.
      before: { name: bot.name, rules: parseBotSteps(bot.steps)?.rules.length ?? 0 },
      after: { name: parsed.name, rules: parsed.flow.rules.length },
    });
    res.json({ success: true, data: { id, name: parsed.name, rules: parsed.flow.rules.length } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const duplicateBotRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const bot = await prisma.bot.findUnique({ where: { id: paramStr(req.params.id) } });
    if (!bot) {
      jsonError(res, 404, 'Bot not found');
      return;
    }
    const copy = await prisma.bot.create({
      data: {
        name: `${bot.name} (cópia)`,
        trigger: bot.trigger,
        active: false,
        steps: (bot.steps ?? {}) as Prisma.InputJsonValue,
      },
    });
    res.json({ success: true, data: { id: copy.id, name: copy.name, active: copy.active } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const listBotVersionsRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = paramStr(req.params.id);
    const rows = await prisma.activity.findMany({
      where: { targetType: 'bot', targetId: id, type: 'BOT_VERSION' },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true } } },
    });
    const data = rows.map((row) => {
      let snapshot: Partial<BotSnapshot> = {};
      try {
        snapshot = JSON.parse(row.body) as Partial<BotSnapshot>;
      } catch {
        // body corrompido: devolve o registro sem quebrar a lista
      }
      return {
        id: row.id,
        name: typeof snapshot.name === 'string' ? snapshot.name : null,
        rules: parseBotSteps(snapshot.steps)?.rules.length ?? 0,
        byUserId: row.userId,
        byName: row.user?.name ?? null,
        at: row.createdAt.toISOString(),
      };
    });
    res.json({ success: true, data });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const revertBotRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = paramStr(req.params.id);
    const bot = await prisma.bot.findUnique({ where: { id } });
    if (!bot) {
      jsonError(res, 404, 'Bot not found');
      return;
    }
    const versionId = typeof req.body?.versionId === 'string' ? req.body.versionId : undefined;
    const version = await prisma.activity.findFirst({
      where: {
        targetType: 'bot',
        targetId: id,
        type: 'BOT_VERSION',
        ...(versionId ? { id: versionId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!version) {
      jsonError(res, 404, 'Nenhuma versão anterior para reverter');
      return;
    }
    let snapshot: Partial<BotSnapshot> = {};
    try {
      snapshot = JSON.parse(version.body) as Partial<BotSnapshot>;
    } catch {
      // segue com snapshot vazio → 400 abaixo
    }
    const flow = parseBotSteps(snapshot.steps);
    if (!flow || typeof snapshot.name !== 'string' || !snapshot.name) {
      jsonError(res, 400, 'Versão corrompida — não é possível reverter');
      return;
    }
    // A versão atual vira versão também antes de voltar no tempo.
    await recordBotVersion(bot, req.userId);
    await prisma.bot.update({
      where: { id },
      data: { name: snapshot.name, steps: flow as unknown as Prisma.InputJsonValue },
    });
    res.json({ success: true, data: { id, name: snapshot.name, rules: flow.rules.length } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

// Termos de risco vêm de constante do engine (LEADS_NOVOS_RISK_KEYWORDS),
// aplicados SEMPRE antes de qualquer fluxo — não são editáveis por API/UI.
export const riskTermsRoute = (_req: Request, res: Response): void => {
  res.json({ success: true, data: LEADS_NOVOS_RISK_KEYWORDS });
};

export const testBotRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const text = req.body?.text;
    if (typeof text !== 'string' || text.trim().length === 0) {
      jsonError(res, 400, 'text required');
      return;
    }
    // Risco bloqueia ANTES de qualquer matching — inclusive de fluxos inline
    // vindos do editor: nenhum fluxo consegue responder a mensagem de risco.
    if (botBlockedByRisk(text)) {
      res.json({ success: true, data: { matched: false, blockedByRisk: true, responses: [] } });
      return;
    }
    // Fluxo inline (editor testa sem salvar). Mantém compat: sem flow no
    // body, testa contra os bots salvos e ativos como antes.
    if (req.body?.flow !== undefined) {
      const flow = parseBotSteps(req.body.flow);
      if (!flow) {
        jsonError(res, 400, 'flow inválido: precisa de rules com terms e responses');
        return;
      }
      const rule = findMatchingRule(flow.rules, text);
      res.json({
        success: true,
        data: rule
          ? { matched: true, ruleIndex: flow.rules.indexOf(rule), terms: rule.terms, responses: rule.responses }
          : { matched: false, responses: [] },
      });
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
    const id = paramStr(req.params.id);
    const result = await prisma.bot.deleteMany({ where: { id } });
    if (result.count === 0) {
      jsonError(res, 404, 'Bot not found');
      return;
    }
    await recordAudit(prisma, {
      userId: req.userId ?? null,
      action: 'bot.delete',
      entity: 'bot',
      entityId: id,
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

router.get('/', authMiddleware, listBotsRoute);
// /risk-terms antes de /:id para o param não capturar a rota fixa.
router.get('/risk-terms', authMiddleware, riskTermsRoute);
router.get('/:id/versions', authMiddleware, listBotVersionsRoute);
router.get('/:id', authMiddleware, getBotRoute);
router.post('/', authMiddleware, requireAdmin, createBotRoute);
router.post('/import', authMiddleware, requireAdmin, importBotRoute);
router.post('/test', authMiddleware, testBotRoute);
router.post('/:id/duplicate', authMiddleware, requireAdmin, duplicateBotRoute);
router.post('/:id/revert', authMiddleware, requireAdmin, revertBotRoute);
router.put('/:id', authMiddleware, requireAdmin, updateBotRoute);
router.patch('/:id', authMiddleware, requireAdmin, toggleBotRoute);
router.delete('/:id', authMiddleware, requireAdmin, deleteBotRoute);

export default router;
