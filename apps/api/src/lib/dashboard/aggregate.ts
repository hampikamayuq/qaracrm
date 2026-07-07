import { prisma } from '../deps';

// Helpers de agregação compartilhados entre dashboard-routes e report-routes:
// janelas de período, séries diárias, variação %, mediana de primeira resposta
// e estatísticas da Tawany. Extraídos de dashboard-routes para os relatórios
// reusarem sem duplicar.

export const DAY_MS = 86_400_000;

const PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

// ?period=7d|30d|90d — ausente → 30d, inválido → null (handler devolve 400).
export const parsePeriodDays = (raw: unknown): number | null => {
  if (raw === undefined) return PERIOD_DAYS['30d'];
  if (typeof raw === 'string' && PERIOD_DAYS[raw]) return PERIOD_DAYS[raw];
  return null;
};

export const utcDayStart = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

// Janela por dias de calendário (UTC): "últimos N dias" inclui hoje.
// ponytail: bucketing em UTC (clínica é GMT-3, leads de 21h-0h caem no dia
// seguinte); trocar por date_trunc AT TIME ZONE se a borda incomodar.
export const periodWindow = (days: number, now = new Date()) => {
  const todayStart = utcDayStart(now);
  const start = new Date(todayStart.getTime() - (days - 1) * DAY_MS);
  const prevStart = new Date(start.getTime() - days * DAY_MS);
  const weekEnd = new Date(todayStart.getTime() + 7 * DAY_MS);
  return { todayStart, start, prevStart, weekEnd };
};

export const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

// Série diária zero-filled: todo dia da janela aparece, mesmo sem eventos.
export const buildDailySeries = (
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
export const pctChange = (current: number, previous: number): number | null =>
  previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;

// ------------------------------------------------- primeira resposta

export type FirstResponseRow = { median_s: number | null; avg_s: number | null; n: number };

// Primeira resposta por conversa: MIN(OUT) - MIN(IN), agregado direto no
// Postgres (mediana via percentile_cont). Conversas iniciadas pela clínica
// (OUT antes de IN) e sem resposta ficam de fora (diff nulo/negativo).
export const firstResponseStats = async (from: Date, to: Date): Promise<FirstResponseRow> => {
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

export const secondsToMinutes = (s: number | null): number | null =>
  s === null ? null : Math.round((s / 60) * 10) / 10;

// ---------------------------------------------------------- Tawany

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

export const isHandoffReason = (reason: string | null): boolean =>
  reason !== null && HANDOFF_REASON_PREFIXES.some((p) => reason.startsWith(p));

export type TawanyRun = {
  createdAt: Date;
  reason: string | null;
  success: boolean;
  latencyMs: number | null;
  fallbackUsed: boolean;
};

export type TawanyStats = {
  respostas: number;
  handoffs: number;
  bloqueios: Array<{ motivo: string; count: number }>;
  latenciaMediaMs: number | null;
  fallbacks: number;
  total: number;
  replyDates: Date[];
};

// Agregado de runs da Tawany (aiRunLog layer 'tawany'): respostas, handoffs,
// bloqueios agrupados (guard_failed pelo motivo do guard + injection),
// latência média e fallbacks.
export const tawanyStats = (runs: TawanyRun[]): TawanyStats => {
  const replies = runs.filter((r) => r.success && r.reason === 'replied');
  const handoffs = runs.filter((r) => isHandoffReason(r.reason));

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

  return {
    respostas: replies.length,
    handoffs: handoffs.length,
    bloqueios: Array.from(blockCounts, ([motivo, count]) => ({ motivo, count }))
      .sort((a, b) => b.count - a.count),
    latenciaMediaMs,
    fallbacks: runs.filter((r) => r.fallbackUsed).length,
    total: runs.length,
    replyDates: replies.map((r) => r.createdAt),
  };
};
