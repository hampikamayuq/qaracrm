'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  CalendarCheck2,
  Clock3,
  Inbox,
  RefreshCw,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
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
// Blocos de UI compartilhados com /reports — ver dashboard-widgets.tsx.
import {
  AXIS_TICK,
  ChartCard,
  ChartTip,
  Delta,
  HorizontalBars,
  KpiCard,
  PERIOD_HINT,
  PERIODS,
  TOKEN,
  fmtDay,
  fmtLatency,
  fmtMinutes,
  fmtPct,
  nf,
} from './dashboard-widgets';

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
