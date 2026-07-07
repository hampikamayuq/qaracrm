import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/deps';
import { authMiddleware } from '../middleware/auth-middleware';
import {
  CLINICAL_PIPELINES,
  STAGE_LABELS,
  UI_STAGES,
  stageFromTags,
  tagsOf,
  valueByPrefix,
  type UiStage,
} from './pipeline-routes';

const router = Router();

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

// ---------------------------------------------------------------- período

const DAY_MS = 86_400_000;
const PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

// ?period=7d|30d|90d — ausente → 30d, inválido → null (handler devolve 400).
const parsePeriodDays = (raw: unknown): number | null => {
  if (raw === undefined) return PERIOD_DAYS['30d'];
  if (typeof raw === 'string' && PERIOD_DAYS[raw]) return PERIOD_DAYS[raw];
  return null;
};

const utcDayStart = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

// Janela por dias de calendário (UTC): "últimos N dias" inclui hoje.
// ponytail: bucketing em UTC (clínica é GMT-3, leads de 21h-0h caem no dia
// seguinte); trocar por date_trunc AT TIME ZONE se a borda incomodar.
const periodWindow = (days: number, now = new Date()) => {
  const todayStart = utcDayStart(now);
  const start = new Date(todayStart.getTime() - (days - 1) * DAY_MS);
  const prevStart = new Date(start.getTime() - days * DAY_MS);
  const weekEnd = new Date(todayStart.getTime() + 7 * DAY_MS);
  return { todayStart, start, prevStart, weekEnd };
};

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

// Série diária zero-filled: todo dia da janela aparece, mesmo sem eventos.
const buildDailySeries = (
  start: Date,
  days: number,
  dates: Date[],
): Array<{ date: string; count: number }> => {
  const counts = new Map<string, number>();
  for (let i = 0; i < days; i += 1) {
    counts.set(dayKey(new Date(start.getTime() + i * DAY_MS)), 0);
  }
  for (const d of dates) {
    const key = dayKey(d);
    if (counts.has(key)) counts.set(key, (counts.get(key) as number) + 1);
  }
  return Array.from(counts, ([date, count]) => ({ date, count }));
};

// Variação % vs período anterior — null quando não há base de comparação.
const pctChange = (current: number, previous: number): number | null =>
  previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;

// --------------------------------------------------------------- /summary

export const getSummaryRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const days = parsePeriodDays(req.query.period);
    if (!days) {
      jsonError(res, 400, 'period must be one of: 7d, 30d, 90d');
      return;
    }
    const { todayStart, start, prevStart, weekEnd } = periodWindow(days);

    const [leads, waitingConversations, agendamentosSemana, followupsAtrasados, novos, novosAnterior] =
      await Promise.all([
        // Estágio vive nas tags (JSON) — deriva no servidor, só as tags trafegam.
        prisma.lead.findMany({ select: { tags: true } }),
        prisma.conversation.findMany({
          where: { OR: [{ needsHuman: true }, { status: 'OPEN' }] },
          select: {
            needsHuman: true,
            messages: { orderBy: { sentAt: 'desc' }, take: 1, select: { direction: true } },
          },
        }),
        prisma.appointment.count({
          where: { scheduledAt: { gte: todayStart, lt: weekEnd }, status: { not: 'CANCELLED' } },
        }),
        // Mesma semântica do bucket OVERDUE de lib/followup/categorize:
        // task pendente com dueAt antes de hoje.
        prisma.task.count({
          where: { status: { in: ['TODO', 'pending'] }, dueAt: { lt: todayStart } },
        }),
        prisma.lead.count({ where: { createdAt: { gte: start } } }),
        prisma.lead.count({ where: { createdAt: { gte: prevStart, lt: start } } }),
      ]);

    const leadsAtivos = leads.filter((lead) => {
      const stage = stageFromTags(tagsOf(lead.tags));
      return stage !== 'perdido' && stage !== 'alta-manutencao';
    }).length;

    const aguardandoResposta = waitingConversations.filter(
      (c) => c.needsHuman || c.messages[0]?.direction === 'IN',
    ).length;

    res.json({
      success: true,
      data: {
        leadsAtivos,
        aguardandoResposta,
        agendamentosSemana,
        followupsAtrasados,
        novosNoPeriodo: {
          atual: novos,
          anterior: novosAnterior,
          variacaoPct: pctChange(novos, novosAnterior),
        },
      },
    });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

// ---------------------------------------------------------------- /funnel

// Só os estágios do funil descendente — reagendado/perdido/alta são laterais
// (perdas têm gráfico próprio em /loss-reasons).
const FUNNEL_STAGES = UI_STAGES.slice(0, 6) as UiStage[];

export const getFunnelRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const pipeline = req.query.pipeline;
    if (pipeline !== undefined
      && (typeof pipeline !== 'string' || !(CLINICAL_PIPELINES as readonly string[]).includes(pipeline))) {
      jsonError(res, 400, `pipeline must be one of: ${CLINICAL_PIPELINES.join(', ')}`);
      return;
    }

    const leads = await prisma.lead.findMany({ select: { tags: true } });
    const counts = new Map<UiStage, number>(FUNNEL_STAGES.map((s) => [s, 0]));
    for (const lead of leads) {
      const tags = tagsOf(lead.tags);
      if (pipeline && valueByPrefix(tags, 'pipeline:') !== pipeline) continue;
      const stage = stageFromTags(tags);
      if (counts.has(stage)) counts.set(stage, (counts.get(stage) as number) + 1);
    }

    res.json({
      success: true,
      data: FUNNEL_STAGES.map((stage) => ({
        stage,
        label: STAGE_LABELS[stage],
        count: counts.get(stage) as number,
      })),
    });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

// --------------------------------------------------------- /leads-per-day

export const getLeadsPerDayRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const days = parsePeriodDays(req.query.period);
    if (!days) {
      jsonError(res, 400, 'period must be one of: 7d, 30d, 90d');
      return;
    }
    const { start, prevStart } = periodWindow(days);

    // ponytail: puxa só createdAt e agrupa no servidor; trocar por
    // $queryRaw + date_trunc se o volume de leads/período crescer.
    const rows = await prisma.lead.findMany({
      where: { createdAt: { gte: prevStart } },
      select: { createdAt: true },
    });

    const current = rows.filter((r) => r.createdAt >= start).map((r) => r.createdAt);
    const previous = rows.filter((r) => r.createdAt < start).map((r) => r.createdAt);

    res.json({
      success: true,
      data: {
        series: buildDailySeries(start, days, current),
        previous: buildDailySeries(prevStart, days, previous),
      },
    });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

// --------------------------------------------------------------- /sources

export const getSourcesRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const days = parsePeriodDays(req.query.period);
    if (!days) {
      jsonError(res, 400, 'period must be one of: 7d, 30d, 90d');
      return;
    }
    const { start } = periodWindow(days);

    const grouped = await prisma.lead.groupBy({
      by: ['source'],
      where: { createdAt: { gte: start } },
      _count: { _all: true },
    });

    const data = grouped
      .map((row) => ({ source: row.source ?? 'desconhecido', count: row._count._all }))
      .sort((a, b) => b.count - a.count);

    res.json({ success: true, data });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

// ---------------------------------------------------------- /loss-reasons

export const getLossReasonsRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const days = parsePeriodDays(req.query.period);
    if (!days) {
      jsonError(res, 400, 'period must be one of: 7d, 30d, 90d');
      return;
    }
    const { start } = periodWindow(days);

    // body é JSON.stringify de StageChangeEvent (pipeline-routes) — o contains
    // filtra no banco; o parse confirma e extrai o motivo.
    const rows = await prisma.activity.findMany({
      where: {
        targetType: 'lead',
        type: 'STAGE_CHANGE',
        createdAt: { gte: start },
        body: { contains: '"to":"perdido"' },
      },
      orderBy: { createdAt: 'desc' },
      select: { targetId: true, body: true },
    });

    // Um motivo por lead: rows vêm em ordem desc, o primeiro evento de perda
    // de cada lead é o mais recente — os demais são descartados.
    const seen = new Set<string>();
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (seen.has(row.targetId)) continue;
      let parsed: { to?: string; lostReason?: string } = {};
      try {
        parsed = JSON.parse(row.body) as { to?: string; lostReason?: string };
      } catch {
        continue; // body legado não-JSON: ignora sem quebrar o agregado
      }
      if (parsed.to !== 'perdido') continue;
      seen.add(row.targetId);
      const reason = parsed.lostReason ?? 'outro';
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }

    const data = Array.from(counts, ([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    res.json({ success: true, data });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

// ---------------------------------------------------------------- /tawany

// Motivos que significam "a Tawany devolveu pro humano" (vs 'replied').
// Skips operacionais (conversation_closed, not_inbound…) ficam de fora da taxa.
const HANDOFF_REASON_PREFIXES = [
  'guard_failed',
  'injection_blocked',
  'max_iterations',
  'tawany_error',
  'config',
  'opt_out_detected',
] as const;

const isHandoffReason = (reason: string | null): boolean =>
  reason !== null && HANDOFF_REASON_PREFIXES.some((p) => reason.startsWith(p));

export const getTawanyRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const days = parsePeriodDays(req.query.period);
    if (!days) {
      jsonError(res, 400, 'period must be one of: 7d, 30d, 90d');
      return;
    }
    const { start } = periodWindow(days);

    const runs = await prisma.aiRunLog.findMany({
      where: { layer: 'tawany', createdAt: { gte: start } },
      select: { createdAt: true, reason: true, success: true, latencyMs: true, fallbackUsed: true },
    });

    const replies = runs.filter((r) => r.success && r.reason === 'replied');
    const handoffs = runs.filter((r) => isHandoffReason(r.reason));

    // Bloqueios agrupados: guard_failed pelo motivo do guard + injection.
    const blockCounts = new Map<string, number>();
    for (const run of runs) {
      if (!run.reason) continue;
      let motivo: string | null = null;
      if (run.reason.startsWith('guard_failed')) {
        motivo = run.reason.replace(/^guard_failed:?\s*/, '') || 'guard_failed';
      } else if (run.reason === 'injection_blocked') {
        motivo = 'injection_blocked';
      }
      if (motivo) blockCounts.set(motivo, (blockCounts.get(motivo) ?? 0) + 1);
    }

    const withLatency = runs.filter((r) => typeof r.latencyMs === 'number');
    const latenciaMediaMs = withLatency.length > 0
      ? Math.round(withLatency.reduce((sum, r) => sum + (r.latencyMs as number), 0) / withLatency.length)
      : null;

    const decided = replies.length + handoffs.length;
    const fallbacks = runs.filter((r) => r.fallbackUsed).length;

    res.json({
      success: true,
      data: {
        perDay: buildDailySeries(start, days, replies.map((r) => r.createdAt)),
        respostas: replies.length,
        handoffs: handoffs.length,
        taxaHandoffPct: decided > 0 ? Math.round((handoffs.length / decided) * 1000) / 10 : null,
        bloqueios: Array.from(blockCounts, ([motivo, count]) => ({ motivo, count }))
          .sort((a, b) => b.count - a.count),
        latenciaMediaMs,
        fallbacks,
        total: runs.length,
      },
    });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

// --------------------------------------------------------- /response-time

type FirstResponseRow = { median_s: number | null; avg_s: number | null; n: number };

// Primeira resposta por conversa: MIN(OUT) - MIN(IN), agregado direto no
// Postgres (mediana via percentile_cont). Conversas iniciadas pela clínica
// (OUT antes de IN) e sem resposta ficam de fora (diff nulo/negativo).
const firstResponseStats = async (from: Date, to: Date): Promise<FirstResponseRow> => {
  const rows = await prisma.$queryRaw<FirstResponseRow[]>`
    SELECT
      percentile_cont(0.5) WITHIN GROUP (ORDER BY diff_s) AS median_s,
      AVG(diff_s)::float AS avg_s,
      COUNT(*)::int AS n
    FROM (
      SELECT EXTRACT(EPOCH FROM (
        MIN(CASE WHEN direction = 'OUT' THEN "sentAt" END)
        - MIN(CASE WHEN direction = 'IN' THEN "sentAt" END)
      )) AS diff_s
      FROM "ChatMessage"
      GROUP BY "conversationId"
      HAVING MIN(CASE WHEN direction = 'IN' THEN "sentAt" END) >= ${from}
         AND MIN(CASE WHEN direction = 'IN' THEN "sentAt" END) < ${to}
    ) t
    WHERE diff_s IS NOT NULL AND diff_s >= 0
  `;
  return rows[0] ?? { median_s: null, avg_s: null, n: 0 };
};

const secondsToMinutes = (s: number | null): number | null =>
  s === null ? null : Math.round((s / 60) * 10) / 10;

export const getResponseTimeRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const days = parsePeriodDays(req.query.period);
    if (!days) {
      jsonError(res, 400, 'period must be one of: 7d, 30d, 90d');
      return;
    }
    const { todayStart, start, prevStart } = periodWindow(days);
    const end = new Date(todayStart.getTime() + DAY_MS);

    const [current, previous] = await Promise.all([
      firstResponseStats(start, end),
      firstResponseStats(prevStart, start),
    ]);

    // Mediana como métrica principal: robusta a outliers (mensagem que chegou
    // de madrugada e só foi respondida de manhã distorceria a média).
    const medianaMin = secondsToMinutes(current.median_s);
    const medianaAnteriorMin = secondsToMinutes(previous.median_s);

    res.json({
      success: true,
      data: {
        medianaMin,
        mediaMin: secondsToMinutes(current.avg_s),
        conversas: current.n,
        medianaAnteriorMin,
        variacaoPct: medianaMin !== null && medianaAnteriorMin !== null && medianaAnteriorMin > 0
          ? Math.round(((medianaMin - medianaAnteriorMin) / medianaAnteriorMin) * 1000) / 10
          : null,
      },
    });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

router.get('/summary', authMiddleware, getSummaryRoute);
router.get('/funnel', authMiddleware, getFunnelRoute);
router.get('/leads-per-day', authMiddleware, getLeadsPerDayRoute);
router.get('/sources', authMiddleware, getSourcesRoute);
router.get('/loss-reasons', authMiddleware, getLossReasonsRoute);
router.get('/tawany', authMiddleware, getTawanyRoute);
router.get('/response-time', authMiddleware, getResponseTimeRoute);

export default router;
