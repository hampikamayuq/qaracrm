'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarCheck2,
  Clock3,
  Inbox,
  Minus,
  RefreshCw,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  api,
  type DashboardFunnelStage,
  type DashboardLeadsPerDay,
  type DashboardLossReason,
  type DashboardPeriod,
  type DashboardResponseTime,
  type DashboardSource,
  type DashboardSummary,
  type DashboardTawany,
} from '@/lib/api';
import { lossLabel } from '@/lib/pipeline-meta';

// Constantes espelhando os tokens de globals.css — SVG do recharts não resolve
// var(--x) em atributos de apresentação, então os hex vivem aqui, pareados.
const TOKEN = {
  teal: '#0f766e', //   --accent  (funil)
  ai: '#6d28d9', //     --ai      (Tawany, sempre violeta)
  danger: '#d92d20', // vermelho suave p/ barras de perda (--danger clareado)
  info: '#175cd3', //   --info    (origens)
  grid: '#e4ebe9', // hairline discreto entre --border e --surface-2
  text2: '#4f625c', //  --text-2
  text3: '#7d8c86', //  --text-3
} as const;

const PERIODS: Array<{ value: DashboardPeriod; label: string }> = [
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
];

const PERIOD_HINT: Record<DashboardPeriod, string> = {
  '7d': 'últimos 7 dias',
  '30d': 'últimos 30 dias',
  '90d': 'últimos 90 dias',
};

// ---------------- formatação ----------------

const nf = (n: number): string => n.toLocaleString('pt-BR');
const fmtDay = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fmtPct = (pct: number | null): string => (pct === null ? '—' : `${pct.toLocaleString('pt-BR')}%`);

const fmtLatency = (ms: number | null): string => {
  if (ms === null) return '—';
  return ms >= 1000
    ? `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}s`
    : `${ms}ms`;
};

const fmtMinutes = (min: number | null): string => {
  if (min === null) return '—';
  if (min < 1) return '<1 min';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h${String(m).padStart(2, '0')}`;
};

// ---------------- blocos de UI ----------------

// Variação: seta + sinal explícito, cor semântica. invert = queda é boa
// (ex.: tempo de resposta).
const Delta = ({ pct, invert = false }: { pct: number | null; invert?: boolean }) => {
  if (pct === null) return null;
  if (pct === 0) {
    return (
      <span className="delta delta-flat">
        <Minus size={12} aria-hidden="true" /> 0%
      </span>
    );
  }
  const up = pct > 0;
  const good = invert ? !up : up;
  return (
    <span className={`delta ${good ? 'delta-good' : 'delta-bad'}`}>
      {up ? <ArrowUpRight size={13} aria-hidden="true" /> : <ArrowDownRight size={13} aria-hidden="true" />}
      {up ? '+' : '−'}{Math.abs(pct).toLocaleString('pt-BR')}%
    </span>
  );
};

const KpiCard = ({
  label,
  value,
  icon: Icon,
  tone = 'default',
  delta,
  hint,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: 'default' | 'warning' | 'danger' | 'accent';
  delta?: number | null;
  hint?: string;
}) => (
  <article className={`kpi-card kpi-${tone}`}>
    <div className="kpi-top">
      <span className="kpi-icon" aria-hidden="true"><Icon size={15} /></span>
      {delta !== undefined && <Delta pct={delta} />}
    </div>
    <span className="kpi-value">{value}</span>
    <span className="kpi-label">{label}</span>
    {hint && <span className="kpi-hint">{hint}</span>}
  </article>
);

const ChartCard = ({
  title,
  hint,
  accent,
  empty,
  children,
}: {
  title: string;
  hint?: string;
  accent?: string;
  empty?: boolean;
  children: React.ReactNode;
}) => (
  <section className="chart-card" aria-label={title}>
    <header className="chart-card-head">
      <h2>
        {accent && <span className="chart-accent" style={{ background: accent }} aria-hidden="true" />}
        {title}
      </h2>
      {hint && <span className="faint">{hint}</span>}
    </header>
    {empty ? <div className="chart-empty">Sem dados no período</div> : children}
  </section>
);

// Tooltip no padrão do design system (surface + hairline + shadow-md).
type TipProps = {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ name?: string | number; value?: number | string; color?: string; stroke?: string; fill?: string }>;
  isDate?: boolean;
};

const ChartTip = ({ active, label, payload, isDate }: TipProps) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{isDate ? fmtDay(String(label)) : String(label)}</div>
      {payload.map((p) => (
        <div key={String(p.name)} className="chart-tooltip-row">
          <span className="chart-tooltip-dot" style={{ background: p.stroke ?? p.fill ?? p.color }} aria-hidden="true" />
          <span>{p.name}</span>
          <strong>{typeof p.value === 'number' ? nf(p.value) : String(p.value)}</strong>
        </div>
      ))}
    </div>
  );
};

const AXIS_TICK = { fontSize: 11, fill: TOKEN.text3 };
const CAT_TICK = { fontSize: 12, fill: TOKEN.text2 };

// Barras horizontais compartilhadas por funil / origem / perdas.
const HorizontalBars = ({
  data,
  color,
  height,
}: {
  data: Array<{ label: string; count: number; rightLabel: string }>;
  color: string;
  height: number;
}) => (
  <ResponsiveContainer width="100%" height={height}>
    <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, bottom: 0, left: 0 }}>
      <XAxis type="number" hide />
      <YAxis
        type="category"
        dataKey="label"
        width={132}
        tick={CAT_TICK}
        axisLine={false}
        tickLine={false}
      />
      <Bar dataKey="count" fill={color} barSize={16} radius={[0, 4, 4, 0]} isAnimationActive={false}>
        <LabelList dataKey="rightLabel" position="right" style={{ fontSize: 11.5, fill: TOKEN.text2 }} />
      </Bar>
    </BarChart>
  </ResponsiveContainer>
);

// ---------------- página ----------------

type DashData = {
  summary: DashboardSummary;
  funnel: DashboardFunnelStage[];
  leadsPerDay: DashboardLeadsPerDay;
  sources: DashboardSource[];
  lossReasons: DashboardLossReason[];
  tawany: DashboardTawany;
  responseTime: DashboardResponseTime;
};

function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawPeriod = searchParams.get('period');
  const period: DashboardPeriod = rawPeriod === '7d' || rawPeriod === '90d' ? rawPeriod : '30d';

  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setPeriod = useCallback((next: DashboardPeriod) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === '30d') params.delete('period');
    else params.set('period', next);
    const text = params.toString();
    router.replace(`/${text ? `?${text}` : ''}`, { scroll: false });
  }, [router, searchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summary, funnel, leadsPerDay, sources, lossReasons, tawany, responseTime] = await Promise.all([
        api.getDashboard<DashboardSummary>('summary', period),
        api.getDashboard<DashboardFunnelStage[]>('funnel', period),
        api.getDashboard<DashboardLeadsPerDay>('leads-per-day', period),
        api.getDashboard<DashboardSource[]>('sources', period),
        api.getDashboard<DashboardLossReason[]>('loss-reasons', period),
        api.getDashboard<DashboardTawany>('tawany', period),
        api.getDashboard<DashboardResponseTime>('response-time', period),
      ]);
      setData({ summary, funnel, leadsPerDay, sources, lossReasons, tawany, responseTime });
    } catch (e) {
      setError((e as Error).message || 'Erro ao carregar o dashboard');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  // Funil: % de conversão entre etapas adjacentes, direto no rótulo da barra.
  const funnelData = useMemo(() => {
    const funnel = data?.funnel ?? [];
    return funnel.map((stage, i) => {
      const prev = i > 0 ? funnel[i - 1].count : null;
      const conv = prev !== null && prev > 0 ? Math.round((stage.count / prev) * 100) : null;
      return {
        label: stage.label,
        count: stage.count,
        rightLabel: conv === null ? nf(stage.count) : `${nf(stage.count)} · ${conv}%`,
      };
    });
  }, [data?.funnel]);

  const leadsSeries = useMemo(() => {
    const series = data?.leadsPerDay.series ?? [];
    const previous = data?.leadsPerDay.previous ?? [];
    return series.map((pt, i) => ({ date: pt.date, atual: pt.count, anterior: previous[i]?.count ?? 0 }));
  }, [data?.leadsPerDay]);

  const sourcesData = useMemo(() => (
    (data?.sources ?? []).slice(0, 8).map((s) => ({
      label: s.source,
      count: s.count,
      rightLabel: nf(s.count),
    }))
  ), [data?.sources]);

  const lossData = useMemo(() => (
    (data?.lossReasons ?? []).map((r) => ({
      label: lossLabel(r.reason),
      count: r.count,
      rightLabel: nf(r.count),
    }))
  ), [data?.lossReasons]);

  if (error && !data) {
    return (
      <main className="page page-wide">
        <div className="toolbar">
          <div>
            <h1 className="title">Dashboard</h1>
            <div className="muted">Visão operacional da clínica</div>
          </div>
        </div>
        <div className="dash-error" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>Não foi possível carregar o dashboard</strong>
            <p className="muted">{error}</p>
          </div>
          <button type="button" className="btn btn-primary" onClick={load}>
            <RefreshCw size={15} /> Tentar novamente
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="page page-wide">
      <div className="toolbar">
        <div>
          <h1 className="title">Dashboard</h1>
          <div className="muted">Visão operacional · {PERIOD_HINT[period]}</div>
        </div>
        <div className="toolbar-right">
          <div className="segmented" role="group" aria-label="Período">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                className={p.value === period ? 'seg-active' : ''}
                aria-pressed={p.value === period}
                onClick={() => setPeriod(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && !data ? (
        <>
          <div className="kpi-grid" aria-hidden="true">
            {Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton skeleton-kpi" />)}
          </div>
          <div className="dash-grid" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton skeleton-chart" />)}
          </div>
        </>
      ) : data && (
        <div className={loading ? 'dash-updating' : undefined}>
          <div className="kpi-grid">
            <KpiCard
              label="Leads ativos"
              value={nf(data.summary.leadsAtivos)}
              icon={Users}
              hint="fora perdidos e alta"
            />
            <KpiCard
              label="Aguardando resposta"
              value={nf(data.summary.aguardandoResposta)}
              icon={Inbox}
              tone={data.summary.aguardandoResposta > 0 ? 'warning' : 'default'}
              hint="conversas esperando a clínica"
            />
            <KpiCard
              label="Agendamentos"
              value={nf(data.summary.agendamentosSemana)}
              icon={CalendarCheck2}
              tone="accent"
              hint="próximos 7 dias"
            />
            <KpiCard
              label="Follow-ups atrasados"
              value={nf(data.summary.followupsAtrasados)}
              icon={Clock3}
              tone={data.summary.followupsAtrasados > 0 ? 'danger' : 'default'}
              hint="tarefas vencidas"
            />
            <KpiCard
              label="Novos leads"
              value={nf(data.summary.novosNoPeriodo.atual)}
              icon={UserPlus}
              delta={data.summary.novosNoPeriodo.variacaoPct}
              hint={`vs ${nf(data.summary.novosNoPeriodo.anterior)} no período anterior`}
            />
          </div>

          <div className="dash-grid">
            <ChartCard
              title="Funil de conversão"
              hint="estado atual · % vs etapa anterior"
              accent={TOKEN.teal}
              empty={funnelData.every((s) => s.count === 0)}
            >
              <HorizontalBars data={funnelData} color={TOKEN.teal} height={236} />
            </ChartCard>

            <ChartCard
              title="Leads por dia"
              hint="tracejado = período anterior"
              accent={TOKEN.teal}
              empty={leadsSeries.every((p) => p.atual === 0 && p.anterior === 0)}
            >
              <ResponsiveContainer width="100%" height={236}>
                <ComposedChart data={leadsSeries} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="leadsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={TOKEN.teal} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={TOKEN.teal} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={TOKEN.grid} vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={AXIS_TICK}
                    tickFormatter={fmtDay}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={28}
                  />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTip isDate />} cursor={{ stroke: TOKEN.grid }} />
                  <Line
                    dataKey="anterior"
                    name="Período anterior"
                    stroke={TOKEN.text3}
                    strokeWidth={1.4}
                    strokeDasharray="4 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Area
                    dataKey="atual"
                    name="Período atual"
                    stroke={TOKEN.teal}
                    strokeWidth={2}
                    fill="url(#leadsFill)"
                    dot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Origem dos leads"
              hint={PERIOD_HINT[period]}
              accent={TOKEN.info}
              empty={sourcesData.length === 0}
            >
              <HorizontalBars
                data={sourcesData}
                color={TOKEN.info}
                height={Math.max(140, sourcesData.length * 30 + 20)}
              />
            </ChartCard>

            <ChartCard
              title="Motivos de perda"
              hint="um motivo por lead, o mais recente"
              accent={TOKEN.danger}
              empty={lossData.length === 0}
            >
              <HorizontalBars
                data={lossData}
                color={TOKEN.danger}
                height={Math.max(140, lossData.length * 30 + 20)}
              />
            </ChartCard>

            <ChartCard
              title="Atividade da Tawany"
              hint="respostas enviadas por dia"
              accent={TOKEN.ai}
              empty={data.tawany.total === 0}
            >
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={data.tawany.perDay} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke={TOKEN.grid} vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={AXIS_TICK}
                    tickFormatter={fmtDay}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={28}
                  />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTip isDate />} cursor={{ stroke: TOKEN.grid }} />
                  <Line
                    dataKey="count"
                    name="Respostas"
                    stroke={TOKEN.ai}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
              <div className="mini-stats">
                <div className="mini-stat">
                  <span className="mini-stat-value">{fmtPct(data.tawany.taxaHandoffPct)}</span>
                  <span className="mini-stat-label">Taxa de handoff</span>
                </div>
                <div className="mini-stat">
                  <span className="mini-stat-value">{fmtLatency(data.tawany.latenciaMediaMs)}</span>
                  <span className="mini-stat-label">Latência média</span>
                </div>
                <div className="mini-stat">
                  <span className="mini-stat-value">{nf(data.tawany.fallbacks)}</span>
                  <span className="mini-stat-label">Fallbacks</span>
                </div>
              </div>
              {data.tawany.bloqueios.length > 0 && (
                <div className="block-list" aria-label="Bloqueios por motivo">
                  {data.tawany.bloqueios.slice(0, 4).map((b) => (
                    <div key={b.motivo} className="block-row">
                      <span className="block-motivo">{b.motivo}</span>
                      <span className="count-badge">{b.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </ChartCard>

            <ChartCard
              title="Tempo de primeira resposta"
              hint={PERIOD_HINT[period]}
              accent={TOKEN.teal}
            >
              {data.responseTime.conversas === 0 ? (
                <div className="chart-empty">Sem dados no período</div>
              ) : (
                <div className="response-block">
                  <div className="response-hero">
                    <span className="response-value">{fmtMinutes(data.responseTime.medianaMin)}</span>
                    <Delta pct={data.responseTime.variacaoPct} invert />
                  </div>
                  <p className="muted">
                    Mediana entre a primeira mensagem do lead e a primeira resposta
                    ({nf(data.responseTime.conversas)} conversas)
                  </p>
                  <dl className="kv">
                    <div>
                      <dt>Média</dt>
                      <dd>{fmtMinutes(data.responseTime.mediaMin)}</dd>
                    </div>
                    <div>
                      <dt>Período anterior</dt>
                      <dd>{fmtMinutes(data.responseTime.medianaAnteriorMin)}</dd>
                    </div>
                  </dl>
                </div>
              )}
            </ChartCard>
          </div>
        </div>
      )}
    </main>
  );
}

export default function DashboardPage() {
  // useSearchParams exige Suspense no App Router (build estático).
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}
