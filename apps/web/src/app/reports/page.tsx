'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRightLeft,
  Bot,
  CheckCircle2,
  Clock3,
  Download,
  Inbox,
  MessagesSquare,
  RefreshCw,
  Send,
  Target,
  Timer,
  UserPlus,
  UserX,
} from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  api,
  type DashboardPeriod,
  type ReportAtendimento,
  type ReportComercial,
  type ReportParams,
  type ReportTawany,
  type ReportTipo,
} from '@/lib/api';
import { lossLabel } from '@/lib/pipeline-meta';
import {
  AXIS_TICK,
  ChartCard,
  ChartTip,
  HorizontalBars,
  KpiCard,
  PERIOD_HINT,
  PERIODS,
  TOKEN,
  deltaPct,
  fmtDay,
  fmtLatency,
  fmtMinutes,
  fmtPct,
  nf,
} from '../dashboard-widgets';

// Variação entre dois percentuais — só quando os dois existem.
const deltaOfPcts = (atual: number | null, anterior: number | null): number | null =>
  atual !== null && anterior !== null ? deltaPct(atual, anterior) : null;

const fmtDayBr = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR');

type Reports = {
  comercial: ReportComercial;
  atendimento: ReportAtendimento;
  tawany: ReportTawany;
};

// Cabeçalho de seção: título + botão de export CSV do relatório.
const SectionHead = ({
  title,
  hint,
  onExport,
  exporting,
}: {
  title: string;
  hint: string;
  onExport: () => void;
  exporting: boolean;
}) => (
  <header className="report-head">
    <div>
      <h2 className="section-title">{title}</h2>
      <span className="faint">{hint}</span>
    </div>
    <button type="button" className="btn" onClick={onExport} disabled={exporting}>
      <Download size={14} aria-hidden="true" />
      {exporting ? 'Exportando…' : 'Exportar CSV'}
    </button>
  </header>
);

function ReportsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawPeriod = searchParams.get('period');
  const urlFrom = searchParams.get('from');
  const urlTo = searchParams.get('to');
  const isCustom = Boolean(urlFrom && urlTo);
  const period: DashboardPeriod = rawPeriod === '7d' || rawPeriod === '90d' ? rawPeriod : '30d';
  const params: ReportParams = useMemo(
    () => (isCustom ? { from: urlFrom as string, to: urlTo as string } : { period }),
    [isCustom, urlFrom, urlTo, period],
  );

  const [data, setData] = useState<Reports | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCustom, setShowCustom] = useState(isCustom);
  const [draftFrom, setDraftFrom] = useState(urlFrom ?? '');
  const [draftTo, setDraftTo] = useState(urlTo ?? '');
  const [exporting, setExporting] = useState<ReportTipo | null>(null);

  const navigate = useCallback((next: URLSearchParams) => {
    const text = next.toString();
    router.replace(`/reports${text ? `?${text}` : ''}`, { scroll: false });
  }, [router]);

  const setPeriod = useCallback((next: DashboardPeriod) => {
    setShowCustom(false);
    const nextParams = new URLSearchParams();
    if (next !== '30d') nextParams.set('period', next);
    navigate(nextParams);
  }, [navigate]);

  const applyCustom = useCallback((from: string, to: string) => {
    if (!from || !to || from > to) return;
    const nextParams = new URLSearchParams();
    nextParams.set('from', from);
    nextParams.set('to', to);
    navigate(nextParams);
  }, [navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [comercial, atendimento, tawany] = await Promise.all([
        api.getReport<ReportComercial>('comercial', params),
        api.getReport<ReportAtendimento>('atendimento', params),
        api.getReport<ReportTawany>('tawany', params),
      ]);
      setData({ comercial, atendimento, tawany });
    } catch (e) {
      setError((e as Error).message || 'Erro ao carregar os relatórios');
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = useCallback(async (tipo: ReportTipo) => {
    setExporting(tipo);
    try {
      const blob = await api.downloadReportCsv(tipo, params);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `relatorio-${tipo}${isCustom ? `-${urlFrom}-a-${urlTo}` : `-${period}`}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(null);
    }
  }, [params, isCustom, urlFrom, urlTo, period]);

  const periodHint = isCustom
    ? `${fmtDayBr(urlFrom as string)} – ${fmtDayBr(urlTo as string)}`
    : PERIOD_HINT[period];

  // ---------------- dados derivados p/ gráficos ----------------

  const estagioData = useMemo(() => (
    (data?.comercial.porEstagio ?? []).map((s) => ({
      label: s.label,
      count: s.count,
      rightLabel: nf(s.count),
    }))
  ), [data?.comercial.porEstagio]);

  const perdasData = useMemo(() => (
    (data?.comercial.perdas ?? []).map((p) => ({
      label: lossLabel(p.reason),
      count: p.count,
      rightLabel: nf(p.count),
    }))
  ), [data?.comercial.perdas]);

  const canalData = useMemo(() => {
    const t = data?.atendimento.tawanyVsHumano;
    if (!t) return [];
    return [
      { label: 'Tawany', count: t.tawany, rightLabel: nf(t.tawany) },
      { label: 'Equipe', count: t.humano, rightLabel: nf(t.humano) },
    ];
  }, [data?.atendimento.tawanyVsHumano]);

  const perdasTotal = perdasData.reduce((sum, p) => sum + p.count, 0);

  if (error && !data) {
    return (
      <main className="page page-wide">
        <div className="toolbar">
          <div>
            <h1 className="title">Relatórios</h1>
            <div className="muted">Comercial, atendimento e Tawany</div>
          </div>
        </div>
        <div className="dash-error" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>Não foi possível carregar os relatórios</strong>
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
          <h1 className="title">Relatórios</h1>
          <div className="muted">Comercial, atendimento e Tawany · {periodHint}</div>
        </div>
        <div className="toolbar-right">
          <div className="segmented" role="group" aria-label="Período">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                className={!showCustom && !isCustom && p.value === period ? 'seg-active' : ''}
                aria-pressed={!showCustom && !isCustom && p.value === period}
                onClick={() => setPeriod(p.value)}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              className={showCustom || isCustom ? 'seg-active' : ''}
              aria-pressed={showCustom || isCustom}
              onClick={() => setShowCustom(true)}
            >
              Personalizado
            </button>
          </div>
          {(showCustom || isCustom) && (
            <div className="report-range">
              <input
                type="date"
                className="input"
                aria-label="De"
                value={draftFrom}
                max={draftTo || undefined}
                onChange={(e) => {
                  setDraftFrom(e.target.value);
                  applyCustom(e.target.value, draftTo);
                }}
              />
              <span className="faint">até</span>
              <input
                type="date"
                className="input"
                aria-label="Até"
                value={draftTo}
                min={draftFrom || undefined}
                onChange={(e) => {
                  setDraftTo(e.target.value);
                  applyCustom(draftFrom, e.target.value);
                }}
              />
            </div>
          )}
        </div>
      </div>

      {loading && !data ? (
        <>
          <div className="kpi-grid" aria-hidden="true">
            {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton skeleton-kpi" />)}
          </div>
          <div className="dash-grid" aria-hidden="true">
            {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton skeleton-chart" />)}
          </div>
        </>
      ) : data && (
        <div className={loading ? 'dash-updating' : undefined}>
          {/* ---------------- Comercial ---------------- */}
          <section className="report-section" aria-label="Relatório comercial">
            <SectionHead
              title="Comercial"
              hint={`leads criados · ${periodHint}`}
              onExport={() => exportCsv('comercial')}
              exporting={exporting === 'comercial'}
            />
            <div className="kpi-grid">
              <KpiCard
                label="Leads novos"
                value={nf(data.comercial.leadsNovos)}
                icon={UserPlus}
                delta={deltaPct(data.comercial.leadsNovos, data.comercial.comparativo.leadsNovos)}
                hint={`vs ${nf(data.comercial.comparativo.leadsNovos)} no período anterior`}
              />
              <KpiCard
                label="Conversão"
                value={fmtPct(data.comercial.conversaoPct)}
                icon={Target}
                tone="accent"
                delta={deltaOfPcts(data.comercial.conversaoPct, data.comercial.comparativo.conversaoPct)}
                hint="novo-lead → atendido"
              />
              <KpiCard
                label="Perdas"
                value={nf(perdasTotal)}
                icon={UserX}
                tone={perdasTotal > 0 ? 'danger' : 'default'}
                delta={deltaPct(perdasTotal, data.comercial.comparativo.perdas)}
                invertDelta
                hint={`vs ${nf(data.comercial.comparativo.perdas)} no período anterior`}
              />
            </div>
            <div className="dash-grid">
              <ChartCard
                title="Leads por estágio"
                hint="estágio atual dos leads criados no período"
                accent={TOKEN.teal}
                empty={estagioData.every((s) => s.count === 0)}
              >
                <HorizontalBars data={estagioData} color={TOKEN.teal} height={estagioData.length * 30 + 20} />
              </ChartCard>

              <ChartCard
                title="Por especialidade"
                hint="pipeline dos leads criados no período"
                accent={TOKEN.info}
                empty={data.comercial.porEspecialidade.length === 0}
              >
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Especialidade</th>
                      <th>Leads</th>
                      <th>Convertidos</th>
                      <th>Conversão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.comercial.porEspecialidade.map((e) => (
                      <tr key={e.pipeline}>
                        <td>{e.pipeline === 'sem-pipeline' ? 'Sem especialidade' : e.pipeline.replace(/-/g, ' ')}</td>
                        <td>{nf(e.count)}</td>
                        <td>{nf(e.convertidos)}</td>
                        <td>{e.count > 0 ? `${Math.round((e.convertidos / e.count) * 100)}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ChartCard>

              <ChartCard
                title="Motivos de perda"
                hint="um motivo por lead, o mais recente"
                accent={TOKEN.danger}
                empty={perdasData.length === 0}
              >
                <HorizontalBars
                  data={perdasData}
                  color={TOKEN.danger}
                  height={Math.max(140, perdasData.length * 30 + 20)}
                />
              </ChartCard>
            </div>
          </section>

          {/* ---------------- Atendimento ---------------- */}
          <section className="report-section" aria-label="Relatório de atendimento">
            <SectionHead
              title="Atendimento"
              hint={`conversas e mensagens · ${periodHint}`}
              onExport={() => exportCsv('atendimento')}
              exporting={exporting === 'atendimento'}
            />
            <div className="kpi-grid">
              <KpiCard
                label="Conversas ativas"
                value={nf(data.atendimento.conversasAtivas)}
                icon={MessagesSquare}
                delta={deltaPct(data.atendimento.conversasAtivas, data.atendimento.comparativo.conversasAtivas)}
                hint="com mensagens no período"
              />
              <KpiCard
                label="1ª resposta (mediana)"
                value={fmtMinutes(data.atendimento.medianaPrimeiraRespostaMin)}
                icon={Clock3}
                tone="accent"
                delta={deltaOfPcts(
                  data.atendimento.medianaPrimeiraRespostaMin,
                  data.atendimento.comparativo.medianaPrimeiraRespostaMin,
                )}
                invertDelta
                hint={`antes: ${fmtMinutes(data.atendimento.comparativo.medianaPrimeiraRespostaMin)}`}
              />
              <KpiCard
                label="Recebidas"
                value={nf(data.atendimento.mensagensRecebidas)}
                icon={Inbox}
                delta={deltaPct(data.atendimento.mensagensRecebidas, data.atendimento.comparativo.mensagensRecebidas)}
                hint="mensagens dos pacientes"
              />
              <KpiCard
                label="Enviadas"
                value={nf(data.atendimento.mensagensEnviadas)}
                icon={Send}
                delta={deltaPct(data.atendimento.mensagensEnviadas, data.atendimento.comparativo.mensagensEnviadas)}
                hint="respostas da clínica"
              />
            </div>
            <div className="dash-grid">
              <ChartCard
                title="Quem respondeu"
                hint="mensagens enviadas · Tawany vs equipe"
                accent={TOKEN.ai}
                empty={data.atendimento.mensagensEnviadas === 0}
              >
                <HorizontalBars data={canalData} color={TOKEN.ai} height={100} />
                <div className="mini-stats">
                  <div className="mini-stat">
                    <span className="mini-stat-value">
                      {fmtPct(data.atendimento.mensagensEnviadas > 0
                        ? Math.round((data.atendimento.tawanyVsHumano.tawany / data.atendimento.mensagensEnviadas) * 1000) / 10
                        : null)}
                    </span>
                    <span className="mini-stat-label">Automação (Tawany)</span>
                  </div>
                  <div className="mini-stat">
                    <span className="mini-stat-value">{nf(data.atendimento.tawanyVsHumano.humano)}</span>
                    <span className="mini-stat-label">Respostas da equipe</span>
                  </div>
                </div>
              </ChartCard>
            </div>
          </section>

          {/* ---------------- Tawany ---------------- */}
          <section className="report-section" aria-label="Relatório da Tawany">
            <SectionHead
              title="Tawany"
              hint={`respostas automáticas · ${periodHint}`}
              onExport={() => exportCsv('tawany')}
              exporting={exporting === 'tawany'}
            />
            <div className="kpi-grid">
              <KpiCard
                label="Respostas"
                value={nf(data.tawany.respostas)}
                icon={Bot}
                delta={deltaPct(data.tawany.respostas, data.tawany.comparativo.respostas)}
                hint={`vs ${nf(data.tawany.comparativo.respostas)} no período anterior`}
              />
              <KpiCard
                label="Handoffs"
                value={nf(data.tawany.handoffs)}
                icon={ArrowRightLeft}
                tone={data.tawany.handoffs > 0 ? 'warning' : 'default'}
                delta={deltaPct(data.tawany.handoffs, data.tawany.comparativo.handoffs)}
                invertDelta
                hint="devolvidas para a equipe"
              />
              <KpiCard
                label="Taxa de resolução"
                value={fmtPct(data.tawany.taxaResolucaoPct)}
                icon={CheckCircle2}
                tone="accent"
                delta={deltaOfPcts(data.tawany.taxaResolucaoPct, data.tawany.comparativo.taxaResolucaoPct)}
                hint="respostas / (respostas + handoffs)"
              />
              <KpiCard
                label="Latência média"
                value={fmtLatency(data.tawany.latenciaMediaMs)}
                icon={Timer}
                hint={`${nf(data.tawany.fallbacks)} fallbacks de modelo`}
              />
            </div>
            <div className="dash-grid">
              <ChartCard
                title="Respostas por dia"
                hint={periodHint}
                accent={TOKEN.ai}
                empty={data.tawany.porDia.every((p) => p.count === 0)}
              >
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={data.tawany.porDia} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
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
              </ChartCard>

              <ChartCard
                title="Bloqueios por motivo"
                hint="guards e injeções barradas"
                accent={TOKEN.danger}
                empty={data.tawany.bloqueios.length === 0}
              >
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Motivo</th>
                      <th>Ocorrências</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tawany.bloqueios.map((b) => (
                      <tr key={b.motivo}>
                        <td>{b.motivo}</td>
                        <td>{nf(b.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ChartCard>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default function ReportsPageWrapper() {
  // useSearchParams exige Suspense no App Router (build estático).
  return (
    <Suspense fallback={null}>
      <ReportsPage />
    </Suspense>
  );
}
