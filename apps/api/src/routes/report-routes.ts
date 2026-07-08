import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/deps';
import { authMiddleware } from '../middleware/auth-middleware';
import { requireReportExportRole } from '../middleware/authorization';
import {
  DAY_MS,
  buildDailySeries,
  dayKey,
  firstResponseStats,
  parsePeriodDays,
  periodWindow,
  secondsToMinutes,
  tawanyStats,
} from '../lib/dashboard/aggregate';
import {
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

// ---------------------------------------------------------------- janela

const MAX_CUSTOM_DAYS = 366;

// Janela do relatório: [start, end) em UTC + início da janela anterior de
// mesmo tamanho (comparativo = [prevStart, start)).
type ReportWindow = { start: Date; end: Date; prevStart: Date; days: number };

const parseIsoDay = (raw: unknown): Date | null => {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ?period=7d|30d|90d (ausente → 30d) OU ?from=YYYY-MM-DD&to=YYYY-MM-DD
// (ambos inclusivos, máx. 366 dias). from/to presente tem precedência.
const parseReportWindow = (query: Request['query']): ReportWindow | { error: string } => {
  if (query.from !== undefined || query.to !== undefined) {
    const from = parseIsoDay(query.from);
    const to = parseIsoDay(query.to);
    if (!from || !to) return { error: 'from e to devem ser datas YYYY-MM-DD' };
    if (from.getTime() > to.getTime()) return { error: 'from deve ser anterior ou igual a to' };
    const days = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
    if (days > MAX_CUSTOM_DAYS) return { error: `intervalo máximo é de ${MAX_CUSTOM_DAYS} dias` };
    return {
      start: from,
      end: new Date(to.getTime() + DAY_MS),
      prevStart: new Date(from.getTime() - days * DAY_MS),
      days,
    };
  }
  const days = parsePeriodDays(query.period);
  if (!days) return { error: 'period must be one of: 7d, 30d, 90d (ou use from/to)' };
  const { todayStart, start, prevStart } = periodWindow(days);
  return { start, end: new Date(todayStart.getTime() + DAY_MS), prevStart, days };
};

const pct1 = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 1000) / 10 : null;

// ------------------------------------------------------------- comercial

// Um motivo por lead (evento de perda mais recente na janela) — mesma
// semântica de /dashboard/loss-reasons; rows devem vir em ordem desc.
const lossCounts = (
  rows: Array<{ targetId: string; body: string }>,
): Array<{ reason: string; count: number }> => {
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
  return Array.from(counts, ([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
};

export const buildComercial = async (w: ReportWindow) => {
  const [leadRows, lossRows] = await Promise.all([
    prisma.lead.findMany({
      where: { createdAt: { gte: w.prevStart, lt: w.end } },
      select: { createdAt: true, tags: true },
    }),
    prisma.activity.findMany({
      where: {
        targetType: 'lead',
        type: 'STAGE_CHANGE',
        createdAt: { gte: w.prevStart, lt: w.end },
        body: { contains: '"to":"perdido"' },
      },
      orderBy: { createdAt: 'desc' },
      select: { targetId: true, body: true, createdAt: true },
    }),
  ]);

  const current = leadRows.filter((l) => l.createdAt >= w.start);
  const previous = leadRows.filter((l) => l.createdAt < w.start);

  // Conversão = % dos leads criados na janela cujo estágio atual é "atendido".
  const converted = (rows: typeof leadRows): number =>
    rows.filter((l) => stageFromTags(tagsOf(l.tags)) === 'atendido').length;

  const stageCounts = new Map<UiStage, number>(UI_STAGES.map((s) => [s, 0]));
  const bySpecialty = new Map<string, { count: number; convertidos: number }>();
  for (const lead of current) {
    const tags = tagsOf(lead.tags);
    const stage = stageFromTags(tags);
    stageCounts.set(stage, (stageCounts.get(stage) as number) + 1);
    const pipeline = valueByPrefix(tags, 'pipeline:') ?? 'sem-pipeline';
    const spec = bySpecialty.get(pipeline) ?? { count: 0, convertidos: 0 };
    spec.count += 1;
    if (stage === 'atendido') spec.convertidos += 1;
    bySpecialty.set(pipeline, spec);
  }

  const perdasAnterior = lossCounts(lossRows.filter((r) => r.createdAt < w.start));

  return {
    leadsNovos: current.length,
    porEstagio: UI_STAGES.map((stage) => ({
      stage,
      label: STAGE_LABELS[stage],
      count: stageCounts.get(stage) as number,
    })),
    conversaoPct: pct1(converted(current), current.length),
    porEspecialidade: Array.from(bySpecialty, ([pipeline, v]) => ({ pipeline, ...v }))
      .sort((a, b) => b.count - a.count),
    perdas: lossCounts(lossRows.filter((r) => r.createdAt >= w.start)),
    comparativo: {
      leadsNovos: previous.length,
      conversaoPct: pct1(converted(previous), previous.length),
      perdas: perdasAnterior.reduce((sum, p) => sum + p.count, 0),
    },
  };
};

// ----------------------------------------------------------- atendimento

export const buildAtendimento = async (w: ReportWindow) => {
  const [messages, currentFr, previousFr] = await Promise.all([
    // ponytail: puxa as mensagens das duas janelas e agrega no servidor
    // (padrão do dashboard); trocar por groupBy/count no banco se o volume
    // por janela de 90d crescer.
    prisma.chatMessage.findMany({
      where: { sentAt: { gte: w.prevStart, lt: w.end } },
      select: { sentAt: true, direction: true, agentHandled: true, conversationId: true },
    }),
    firstResponseStats(w.start, w.end),
    firstResponseStats(w.prevStart, w.start),
  ]);

  // OUT com agentHandled = Tawany; OUT sem = humano. Não há autoria por
  // usuário no ChatMessage — "por atendente" não existe no schema.
  const stats = (rows: typeof messages) => {
    const conversations = new Set<string>();
    let recebidas = 0;
    let tawany = 0;
    let humano = 0;
    for (const msg of rows) {
      conversations.add(msg.conversationId);
      if (msg.direction === 'IN') recebidas += 1;
      else if (msg.direction === 'OUT') {
        if (msg.agentHandled) tawany += 1;
        else humano += 1;
      }
    }
    return {
      conversasAtivas: conversations.size,
      mensagensRecebidas: recebidas,
      mensagensEnviadas: tawany + humano,
      tawanyVsHumano: { tawany, humano },
    };
  };

  return {
    ...stats(messages.filter((m) => m.sentAt >= w.start)),
    medianaPrimeiraRespostaMin: secondsToMinutes(currentFr.median_s),
    comparativo: {
      ...stats(messages.filter((m) => m.sentAt < w.start)),
      medianaPrimeiraRespostaMin: secondsToMinutes(previousFr.median_s),
    },
  };
};

// ---------------------------------------------------------------- tawany

export const buildTawany = async (w: ReportWindow) => {
  const runs = await prisma.aiRunLog.findMany({
    where: { layer: 'tawany', createdAt: { gte: w.prevStart, lt: w.end } },
    select: { createdAt: true, reason: true, success: true, latencyMs: true, fallbackUsed: true },
  });

  const current = tawanyStats(runs.filter((r) => r.createdAt >= w.start));
  const previous = tawanyStats(runs.filter((r) => r.createdAt < w.start));

  // ponytail: taxa de resolução simplificada para replied/(replied+handoffs).
  // "Replied sem handoff posterior na mesma conversa" exigiria correlacionar
  // runs por conversationId — refinar se a métrica virar meta contratual.
  const taxa = (s: { respostas: number; handoffs: number }): number | null =>
    pct1(s.respostas, s.respostas + s.handoffs);

  return {
    respostas: current.respostas,
    handoffs: current.handoffs,
    taxaResolucaoPct: taxa(current),
    bloqueios: current.bloqueios,
    latenciaMediaMs: current.latenciaMediaMs,
    fallbacks: current.fallbacks,
    porDia: buildDailySeries(w.start, w.days, current.replyDates),
    comparativo: {
      respostas: previous.respostas,
      handoffs: previous.handoffs,
      taxaResolucaoPct: taxa(previous),
    },
  };
};

// ---------------------------------------------------------------- rotas

const REPORT_BUILDERS = {
  comercial: buildComercial,
  atendimento: buildAtendimento,
  tawany: buildTawany,
} as const;

type ReportTipo = keyof typeof REPORT_BUILDERS;

const reportRoute = (tipo: ReportTipo) =>
  async (req: Request, res: Response): Promise<void> => {
    try {
      const w = parseReportWindow(req.query);
      if ('error' in w) {
        jsonError(res, 400, w.error);
        return;
      }
      res.json({ success: true, data: await REPORT_BUILDERS[tipo](w) });
    } catch (error) {
      jsonError(res, 500, (error as Error).message);
    }
  };

// ------------------------------------------------------------ export CSV

const csvCell = (value: string): string => `"${value.replace(/"/g, '""')}"`;

type CsvRow = [string, string | number];

const comercialCsv = (d: Awaited<ReturnType<typeof buildComercial>>): CsvRow[] => [
  ['Leads novos', d.leadsNovos],
  ['Conversão novo-lead → atendido (%)', d.conversaoPct ?? ''],
  ...d.porEstagio.map((s): CsvRow => [`Estágio · ${s.label}`, s.count]),
  ...d.porEspecialidade.flatMap((e): CsvRow[] => [
    [`Especialidade · ${e.pipeline} (leads)`, e.count],
    [`Especialidade · ${e.pipeline} (convertidos)`, e.convertidos],
  ]),
  ...d.perdas.map((p): CsvRow => [`Perda · ${p.reason}`, p.count]),
  ['Período anterior · Leads novos', d.comparativo.leadsNovos],
  ['Período anterior · Conversão (%)', d.comparativo.conversaoPct ?? ''],
  ['Período anterior · Perdas', d.comparativo.perdas],
];

const atendimentoCsv = (d: Awaited<ReturnType<typeof buildAtendimento>>): CsvRow[] => [
  ['Conversas ativas', d.conversasAtivas],
  ['Mediana da 1ª resposta (min)', d.medianaPrimeiraRespostaMin ?? ''],
  ['Mensagens recebidas', d.mensagensRecebidas],
  ['Mensagens enviadas', d.mensagensEnviadas],
  ['Enviadas pela Tawany', d.tawanyVsHumano.tawany],
  ['Enviadas por humanos', d.tawanyVsHumano.humano],
  ['Período anterior · Conversas ativas', d.comparativo.conversasAtivas],
  ['Período anterior · Mediana da 1ª resposta (min)', d.comparativo.medianaPrimeiraRespostaMin ?? ''],
  ['Período anterior · Mensagens recebidas', d.comparativo.mensagensRecebidas],
  ['Período anterior · Mensagens enviadas', d.comparativo.mensagensEnviadas],
];

const tawanyCsv = (d: Awaited<ReturnType<typeof buildTawany>>): CsvRow[] => [
  ['Respostas', d.respostas],
  ['Handoffs', d.handoffs],
  ['Taxa de resolução (%)', d.taxaResolucaoPct ?? ''],
  ['Latência média (ms)', d.latenciaMediaMs ?? ''],
  ['Fallbacks', d.fallbacks],
  ...d.bloqueios.map((b): CsvRow => [`Bloqueio · ${b.motivo}`, b.count]),
  ...d.porDia.map((p): CsvRow => [`Respostas em ${p.date}`, p.count]),
  ['Período anterior · Respostas', d.comparativo.respostas],
  ['Período anterior · Handoffs', d.comparativo.handoffs],
  ['Período anterior · Taxa de resolução (%)', d.comparativo.taxaResolucaoPct ?? ''],
];

export const exportReportCsvRoute = async (req: Request, res: Response): Promise<void> => {
  const tipo = req.params.tipo;
  if (tipo !== 'comercial' && tipo !== 'atendimento' && tipo !== 'tawany') {
    jsonError(res, 404, 'Relatório não encontrado. Tipos: comercial, atendimento, tawany');
    return;
  }
  try {
    const w = parseReportWindow(req.query);
    if ('error' in w) {
      jsonError(res, 400, w.error);
      return;
    }
    const rows = tipo === 'comercial'
      ? comercialCsv(await buildComercial(w))
      : tipo === 'atendimento'
        ? atendimentoCsv(await buildAtendimento(w))
        : tawanyCsv(await buildTawany(w));

    const lines = [
      ['indicador', 'valor'].map(csvCell).join(','),
      ...rows.map((r) => r.map((v) => csvCell(String(v))).join(',')),
    ];
    const lastDay = dayKey(new Date(w.end.getTime() - DAY_MS));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=relatorio-${tipo}-${dayKey(w.start)}-a-${lastDay}.csv`,
    );
    // BOM para o Excel abrir UTF-8 direto — mesmo padrão do export de leads.
    res.send(`﻿${lines.join('\n')}`);
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

router.get('/comercial', authMiddleware, reportRoute('comercial'));
router.get('/atendimento', authMiddleware, reportRoute('atendimento'));
router.get('/tawany', authMiddleware, reportRoute('tawany'));
router.get('/:tipo/export.csv', authMiddleware, requireReportExportRole, exportReportCsvRoute);

export default router;
