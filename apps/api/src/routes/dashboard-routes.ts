import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/deps';
import { authMiddleware } from '../middleware/auth-middleware';
// Helpers de janela/série/variação/mediana/Tawany compartilhados com
// report-routes — extraídos daqui para lib/dashboard/aggregate.
import {
  DAY_MS,
  buildDailySeries,
  firstResponseStats,
  parsePeriodDays,
  pctChange,
  periodWindow,
  secondsToMinutes,
  tawanyStats,
} from '../lib/dashboard/aggregate';
import {
  CLINICAL_PIPELINES,
  STAGE_LABELS,
  UI_STAGES,
  stageFromTags,
  tagsOf,
  valueByPrefix,
  type UiStage,
} from './pipeline-routes';
// Painel consolidado: reusa as MESMAS agregações dos relatórios (comercial +
// financeiro/NPS) em vez de recalcular — importadas de report-routes e do
// módulo financeiro compartilhado.
import { buildComercial } from './report-routes';
import { buildFinanceiro } from '../lib/reports/financeiro';

const router = Router();

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

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
          where: { status: { in: ['TODO', 'pending', 'OPEN'] }, dueAt: { lt: todayStart } },
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
      select: {
        createdAt: true,
        reason: true,
        success: true,
        latencyMs: true,
        fallbackUsed: true,
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        estimatedCostCents: true,
      },
    });

    const stats = tawanyStats(runs);
    const decided = stats.respostas + stats.handoffs;
    const tokens = runs.reduce((sum, run) => sum + (run.totalTokens ?? 0), 0);
    const estimatedCostCents = runs.reduce((sum, run) => sum + (run.estimatedCostCents ?? 0), 0);

    res.json({
      success: true,
      data: {
        perDay: buildDailySeries(start, days, stats.replyDates),
        respostas: stats.respostas,
        handoffs: stats.handoffs,
        taxaHandoffPct: decided > 0 ? Math.round((stats.handoffs / decided) * 1000) / 10 : null,
        bloqueios: stats.bloqueios,
        latenciaMediaMs: stats.latenciaMediaMs,
        fallbacks: stats.fallbacks,
        total: stats.total,
        tokens,
        estimatedCostCents,
      },
    });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

// --------------------------------------------------------- /response-time

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

// --------------------------------------------------------------- /overview

// Consultas de hoje: quantas mostrar na fila "próximas".
const OVERVIEW_UPCOMING = 5;

// Painel de comando: um agregado enxuto juntando todas as áreas do CRM.
// Reusa buildComercial/buildFinanceiro (mesmos números dos relatórios) e os
// helpers de janela/primeira-resposta; só monta blocos e arredonda no servidor.
export const getOverviewRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const days = parsePeriodDays(req.query.period);
    if (!days) {
      jsonError(res, 400, 'period must be one of: 7d, 30d, 90d');
      return;
    }
    const { todayStart, start, prevStart } = periodWindow(days);
    const end = new Date(todayStart.getTime() + DAY_MS);
    const window = { start, end, prevStart, days };
    const now = new Date();

    const [
      comercial,
      financeiro,
      conversasAbertas,
      aguardandoHumano,
      sugestoesPendentes,
      responseTime,
      tarefasAbertas,
      tarefasAtrasadas,
      consultasHoje,
    ] = await Promise.all([
      buildComercial(window),
      buildFinanceiro(window),
      prisma.conversation.count({ where: { status: 'OPEN' } }),
      prisma.conversation.count({ where: { needsHuman: true } }),
      // Fila de revisão da Tawany = sugestões aguardando aprovação humana.
      prisma.aiSuggestion.count({ where: { status: 'PENDING' } }),
      firstResponseStats(start, end),
      prisma.task.count({ where: { status: { notIn: ['DONE', 'CANCELED'] } } }),
      // Atrasadas: não concluídas com vencimento antes de agora.
      prisma.task.count({ where: { status: { notIn: ['DONE', 'CANCELED'] }, dueAt: { lt: now } } }),
      prisma.appointment.findMany({
        where: { scheduledAt: { gte: todayStart, lt: end }, status: { not: 'CANCELLED' } },
        orderBy: { scheduledAt: 'asc' },
        select: {
          id: true,
          scheduledAt: true,
          status: true,
          patient: { select: { name: true } },
          lead: { select: { name: true } },
          professional: { select: { name: true, specialty: true } },
        },
      }),
    ]);

    const confirmadas = consultasHoje.filter((a) => a.status === 'CONFIRMED').length;
    const pendentes = consultasHoje.filter((a) => a.status === 'SCHEDULED').length;
    const proximas = consultasHoje
      .filter((a) => a.scheduledAt >= now)
      .slice(0, OVERVIEW_UPCOMING)
      .map((a) => ({
        id: a.id,
        scheduledAt: a.scheduledAt,
        status: a.status,
        paciente: a.patient?.name ?? a.lead?.name ?? null,
        profissional: a.professional?.name ?? null,
        especialidade: a.professional?.specialty ?? null,
      }));

    res.json({
      success: true,
      data: {
        comercial: {
          novosLeads: comercial.leadsNovos,
          novosLeadsAnterior: comercial.comparativo.leadsNovos,
          novosLeadsVariacaoPct: pctChange(comercial.leadsNovos, comercial.comparativo.leadsNovos),
          porEstagio: comercial.porEstagio,
          conversaoPct: comercial.conversaoPct,
        },
        atendimento: {
          conversasAbertas,
          aguardandoHumano,
          sugestoesPendentes,
          medianaRespostaMin: secondsToMinutes(responseTime.median_s),
          conversasComResposta: responseTime.n,
        },
        financeiro: {
          recebido: financeiro.pagamentos.totalRecebido,
          recebidoAnterior: financeiro.pagamentos.comparativo.totalRecebido,
          aReceber: financeiro.pagamentos.pendente,
          taxaAceitacaoPct: financeiro.orcamentos.taxaAceitacaoPct,
        },
        nps: {
          notaMedia: financeiro.nps.notaMedia,
          npsClassico: financeiro.nps.npsClassico,
          respondidos: financeiro.nps.respondidos,
          enviados: financeiro.nps.enviados,
        },
        agenda: {
          totalHoje: consultasHoje.length,
          confirmadas,
          pendentes,
          proximas,
        },
        tarefas: {
          abertas: tarefasAbertas,
          atrasadas: tarefasAtrasadas,
        },
      },
    });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

router.get('/overview', authMiddleware, getOverviewRoute);
router.get('/summary', authMiddleware, getSummaryRoute);
router.get('/funnel', authMiddleware, getFunnelRoute);
router.get('/leads-per-day', authMiddleware, getLeadsPerDayRoute);
router.get('/sources', authMiddleware, getSourcesRoute);
router.get('/loss-reasons', authMiddleware, getLossReasonsRoute);
router.get('/tawany', authMiddleware, getTawanyRoute);
router.get('/response-time', authMiddleware, getResponseTimeRoute);

export default router;
