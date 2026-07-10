'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  Inbox,
  ListTodo,
  MessagesSquare,
  Receipt,
  RefreshCw,
  Smile,
  Target,
  UserPlus,
  Wallet,
} from 'lucide-react';
import { api, type DashboardOverview, type DashboardPeriod } from '@/lib/api';
// Blocos de UI compartilhados com /reports — ver dashboard-widgets.tsx.
import {
  ChartCard,
  HorizontalBars,
  KpiCard,
  PERIODS,
  PERIOD_HINT,
  TOKEN,
  deltaPct,
  fmtMinutes,
  fmtPct,
  nf,
} from './dashboard-widgets';

// Moeda BRL — mesmo padrão de quotes/reports (valores já chegam como number).
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (value: number | null): string => (value === null ? '—' : brl.format(value));

const fmtTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

// Cabeçalho de faixa: título + atalho "ver detalhes" para a tela da área.
const SectionHead = ({ title, hint, href, cta }: { title: string; hint: string; href: string; cta: string }) => (
  <header className="report-head">
    <div>
      <h2 className="section-title">{title}</h2>
      <span className="faint">{hint}</span>
    </div>
    <Link className="btn" href={href}>
      {cta}
      <ArrowRight size={14} aria-hidden="true" />
    </Link>
  </header>
);

function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawPeriod = searchParams.get('period');
  const period: DashboardPeriod = rawPeriod === '7d' || rawPeriod === '90d' ? rawPeriod : '30d';

  const [data, setData] = useState<DashboardOverview | null>(null);
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
      const overview = await api.getDashboard<DashboardOverview>('overview', period);
      setData(overview);
    } catch (e) {
      setError((e as Error).message || 'Erro ao carregar o painel');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  const estagioData = useMemo(() => (
    (data?.comercial.porEstagio ?? []).map((s) => ({
      label: s.label,
      count: s.count,
      rightLabel: nf(s.count),
    }))
  ), [data?.comercial.porEstagio]);

  if (error && !data) {
    return (
      <main className="page page-wide">
        <div className="toolbar">
          <div>
            <h1 className="title">Painel</h1>
            <div className="muted">Visão consolidada da clínica</div>
          </div>
        </div>
        <div className="dash-error" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>Não foi possível carregar o painel</strong>
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
          <h1 className="title">Painel</h1>
          <div className="muted">Visão consolidada · {PERIOD_HINT[period]}</div>
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
            {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton skeleton-kpi" />)}
          </div>
          <div className="dash-grid" aria-hidden="true">
            {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton skeleton-chart" />)}
          </div>
        </>
      ) : data && (
        <div className={loading ? 'dash-updating' : undefined}>
          {/* ---------------- Comercial ---------------- */}
          <section className="report-section" aria-label="Comercial">
            <SectionHead title="Comercial" hint={`leads e conversão · ${PERIOD_HINT[period]}`} href="/reports" cta="Ver relatórios" />
            <div className="kpi-grid">
              <KpiCard
                label="Novos leads"
                value={nf(data.comercial.novosLeads)}
                icon={UserPlus}
                delta={data.comercial.novosLeadsVariacaoPct}
                hint={`vs ${nf(data.comercial.novosLeadsAnterior)} no período anterior`}
              />
              <KpiCard
                label="Conversão"
                value={fmtPct(data.comercial.conversaoPct)}
                icon={Target}
                tone="accent"
                hint="novo-lead → atendido"
              />
            </div>
            <div className="dash-grid">
              <ChartCard
                title="Leads por estágio"
                hint="estágio atual dos leads criados no período"
                accent={TOKEN.teal}
                empty={estagioData.every((s) => s.count === 0)}
              >
                <HorizontalBars data={estagioData} color={TOKEN.teal} height={Math.max(140, estagioData.length * 30 + 20)} />
              </ChartCard>
            </div>
          </section>

          {/* ---------------- Atendimento ---------------- */}
          <section className="report-section" aria-label="Atendimento">
            <SectionHead title="Atendimento" hint="conversas, fila e resposta" href="/inbox" cta="Abrir inbox" />
            <div className="kpi-grid">
              <KpiCard
                label="Conversas abertas"
                value={nf(data.atendimento.conversasAbertas)}
                icon={MessagesSquare}
                hint="em andamento no inbox"
              />
              <KpiCard
                label="Aguardando humano"
                value={nf(data.atendimento.aguardandoHumano)}
                icon={Inbox}
                tone={data.atendimento.aguardandoHumano > 0 ? 'warning' : 'default'}
                hint="conversas que pediram atendente"
              />
              <KpiCard
                label="Revisão da Tawany"
                value={nf(data.atendimento.sugestoesPendentes)}
                icon={Bot}
                tone={data.atendimento.sugestoesPendentes > 0 ? 'warning' : 'default'}
                hint="sugestões aguardando aprovação"
              />
              <KpiCard
                label="1ª resposta (mediana)"
                value={fmtMinutes(data.atendimento.medianaRespostaMin)}
                icon={Clock3}
                tone="accent"
                hint={`${nf(data.atendimento.conversasComResposta)} conversas no período`}
              />
            </div>
          </section>

          {/* ---------------- Financeiro & NPS ---------------- */}
          <section className="report-section" aria-label="Financeiro">
            <SectionHead title="Financeiro" hint={`recebido, a receber e satisfação · ${PERIOD_HINT[period]}`} href="/reports" cta="Ver relatórios" />
            <div className="kpi-grid">
              <KpiCard
                label="Recebido no período"
                value={money(data.financeiro.recebido)}
                icon={Wallet}
                delta={deltaPct(data.financeiro.recebido, data.financeiro.recebidoAnterior)}
                hint={`vs ${money(data.financeiro.recebidoAnterior)} no período anterior`}
              />
              <KpiCard
                label="A receber"
                value={money(data.financeiro.aReceber)}
                icon={Receipt}
                tone={data.financeiro.aReceber > 0 ? 'warning' : 'default'}
                hint="orçamentos aceitos com saldo em aberto"
              />
              <KpiCard
                label="Taxa de aceitação"
                value={fmtPct(data.financeiro.taxaAceitacaoPct)}
                icon={Target}
                tone="accent"
                hint="aceitos / resolvidos"
              />
              <KpiCard
                label="NPS"
                value={data.nps.npsClassico === null ? '—' : nf(Math.round(data.nps.npsClassico))}
                icon={Smile}
                tone="accent"
                hint={data.nps.notaMedia === null
                  ? `${nf(data.nps.respondidos)} respostas`
                  : `nota ${data.nps.notaMedia.toLocaleString('pt-BR')} · ${nf(data.nps.respondidos)} respostas`}
              />
            </div>
          </section>

          {/* ---------------- Agenda do dia ---------------- */}
          <section className="report-section" aria-label="Agenda do dia">
            <SectionHead title="Agenda do dia" hint="consultas de hoje" href="/calendar" cta="Abrir agenda" />
            <div className="kpi-grid">
              <KpiCard
                label="Consultas hoje"
                value={nf(data.agenda.totalHoje)}
                icon={CalendarCheck2}
                tone="accent"
                hint="fora canceladas"
              />
              <KpiCard
                label="Confirmadas"
                value={nf(data.agenda.confirmadas)}
                icon={CheckCircle2}
                hint="pacientes confirmados"
              />
              <KpiCard
                label="Pendentes"
                value={nf(data.agenda.pendentes)}
                icon={Clock3}
                tone={data.agenda.pendentes > 0 ? 'warning' : 'default'}
                hint="aguardando confirmação"
              />
            </div>
            <div className="dash-grid">
              <ChartCard
                title="Próximas consultas"
                hint="hoje, a partir de agora"
                accent={TOKEN.info}
                empty={data.agenda.proximas.length === 0}
              >
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Hora</th>
                      <th>Paciente</th>
                      <th>Profissional</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.agenda.proximas.map((a) => (
                      <tr key={a.id}>
                        <td>{fmtTime(a.scheduledAt)}</td>
                        <td>{a.paciente ?? '—'}</td>
                        <td>{a.profissional ?? '—'}{a.especialidade ? ` · ${a.especialidade}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ChartCard>
            </div>
          </section>

          {/* ---------------- Tarefas ---------------- */}
          <section className="report-section" aria-label="Tarefas">
            <SectionHead title="Tarefas" hint="follow-ups e pendências" href="/tasks" cta="Abrir tarefas" />
            <div className="kpi-grid">
              <KpiCard
                label="Abertas"
                value={nf(data.tarefas.abertas)}
                icon={ListTodo}
                hint="não concluídas"
              />
              <KpiCard
                label="Atrasadas"
                value={nf(data.tarefas.atrasadas)}
                icon={AlertTriangle}
                tone={data.tarefas.atrasadas > 0 ? 'danger' : 'default'}
                hint="vencidas e não concluídas"
              />
            </div>
          </section>
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
