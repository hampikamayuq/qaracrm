'use client';

// Blocos de UI do dashboard compartilhados com /reports: tokens de gráfico,
// formatadores pt-BR, cards KPI, delta com seta, chart-card e barras
// horizontais. Extraídos de app/page.tsx para não duplicar.

import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from 'lucide-react';
import { Bar, BarChart, LabelList, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import type { DashboardPeriod } from '@/lib/api';

// Constantes espelhando os tokens de globals.css — SVG do recharts não resolve
// var(--x) em atributos de apresentação, então os hex vivem aqui, pareados.
export const TOKEN = {
  teal: '#0f766e', //   --accent  (funil)
  ai: '#6d28d9', //     --ai      (Tawany, sempre violeta)
  danger: '#d92d20', // vermelho suave p/ barras de perda (--danger clareado)
  info: '#175cd3', //   --info    (origens)
  grid: '#e4ebe9', // hairline discreto entre --border e --surface-2
  text2: '#4f625c', //  --text-2
  text3: '#7d8c86', //  --text-3
} as const;

export const PERIODS: Array<{ value: DashboardPeriod; label: string }> = [
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
];

export const PERIOD_HINT: Record<DashboardPeriod, string> = {
  '7d': 'últimos 7 dias',
  '30d': 'últimos 30 dias',
  '90d': 'últimos 90 dias',
};

// ---------------- formatação ----------------

export const nf = (n: number): string => n.toLocaleString('pt-BR');
export const fmtDay = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const fmtPct = (pct: number | null): string => (pct === null ? '—' : `${pct.toLocaleString('pt-BR')}%`);

export const fmtLatency = (ms: number | null): string => {
  if (ms === null) return '—';
  return ms >= 1000
    ? `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}s`
    : `${ms}ms`;
};

export const fmtMinutes = (min: number | null): string => {
  if (min === null) return '—';
  if (min < 1) return '<1 min';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h${String(m).padStart(2, '0')}`;
};

// Variação % vs período anterior — null quando não há base de comparação.
// Mesma matemática de pctChange no servidor.
export const deltaPct = (atual: number, anterior: number): number | null =>
  anterior > 0 ? Math.round(((atual - anterior) / anterior) * 1000) / 10 : null;

// ---------------- blocos de UI ----------------

// Variação: seta + sinal explícito, cor semântica. invert = queda é boa
// (ex.: tempo de resposta).
export const Delta = ({ pct, invert = false }: { pct: number | null; invert?: boolean }) => {
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

export const KpiCard = ({
  label,
  value,
  icon: Icon,
  tone = 'default',
  delta,
  invertDelta = false,
  hint,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: 'default' | 'warning' | 'danger' | 'accent';
  delta?: number | null;
  invertDelta?: boolean;
  hint?: string;
}) => (
  <article className={`kpi-card kpi-${tone}`}>
    <div className="kpi-top">
      <span className="kpi-icon" aria-hidden="true"><Icon size={15} /></span>
      {delta !== undefined && <Delta pct={delta} invert={invertDelta} />}
    </div>
    <span className="kpi-value">{value}</span>
    <span className="kpi-label">{label}</span>
    {hint && <span className="kpi-hint">{hint}</span>}
  </article>
);

export const ChartCard = ({
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

export const ChartTip = ({ active, label, payload, isDate }: TipProps) => {
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

export const AXIS_TICK = { fontSize: 11, fill: TOKEN.text3 };
export const CAT_TICK = { fontSize: 12, fill: TOKEN.text2 };

// Barras horizontais compartilhadas por funil / origem / perdas / estágios.
export const HorizontalBars = ({
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
