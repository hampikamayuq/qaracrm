import { useEffect, useMemo, useState } from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';
import { createDataApi } from 'src/lib/data';
import { FOLLOWUPS_DASHBOARD_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { daysSince } from 'src/lib/followup/categorize';
import { BUCKETS, groupTasksByCategory, type GroupableTask } from 'src/lib/followup/grouping';

type Lead = {
  id: string;
  name: { firstName: string; lastName: string } | null;
  whatsapp: { primaryPhoneNumber: string | null } | null;
  source: string | null;
  intent: string | null;
  lastFollowUpAt: string | null;
  nextFollowUpAt: string | null;
};

type TaskRow = GroupableTask & {
  title: string | null;
  dueAt: string | null;
  status: string | null;
  lead: Lead | null;
};

const leadName = (l: Lead | null): string =>
  l ? `${l.name?.firstName ?? ''} ${l.name?.lastName ?? ''}`.trim() || '(sem nome)' : '—';

const phone = (l: Lead | null): string => l?.whatsapp?.primaryPhoneNumber ?? '';

const dueLabel = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
};

const cssVars = {
  bg: '#f7f6f2',
  surface: '#ffffff',
  ink: '#1a1a1a',
  inkMuted: '#6b6b6b',
  inkSubtle: '#9a9a9a',
  border: '#ebe8e1',
  borderSoft: '#f1efe9',
  accent: '#b8651a',
  accentSoft: '#f6e8d8',
} as const;

const kpiAccents: Record<string, { bar: string; soft: string; ink: string }> = {
  OVERDUE:  { bar: '#c53030', soft: '#fdecec', ink: '#8a1a1a' },
  TODAY:    { bar: '#d97706', soft: '#fdf3e3', ink: '#8a4a05' },
  UPCOMING: { bar: '#2563eb', soft: '#eaf0fd', ink: '#1d4ed8' },
  PENDING:  { bar: cssVars.accent, soft: cssVars.accentSoft, ink: '#7a3d0d' },
};

type Kpi = { key: string; label: string; count: number; accent: keyof typeof kpiAccents };

const KpiTile = ({ kpi, onClick, active, index }: { kpi: Kpi; onClick: () => void; active: boolean; index: number }) => {
  const a = kpiAccents[kpi.accent];
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        '--i': index,
        background: a.soft,
        border: `1px solid ${active ? a.bar : cssVars.border}`,
        borderRadius: 14,
        padding: '16px 18px',
        textAlign: 'left',
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: 'inherit',
        color: cssVars.ink,
        boxShadow: active ? `0 0 0 3px ${a.bar}22` : '0 1px 0 rgba(0,0,0,0.02)',
        transition: 'transform 180ms ease-out, box-shadow 180ms ease-out, border-color 180ms ease-out',
        animation: 'kpiIn 420ms cubic-bezier(0.16, 1, 0.3, 1) both',
        animationDelay: `calc(var(--i) * 60ms)`,
      } as React.CSSProperties}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: a.bar }} />
      <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: a.ink, fontWeight: 600 }}>{kpi.label}</div>
      <div key={kpi.count} style={{ fontSize: 36, fontWeight: 700, marginTop: 6, color: cssVars.ink, fontVariantNumeric: 'tabular-nums', animation: 'countPulse 360ms ease-out' }}>
        {kpi.count}
      </div>
    </button>
  );
};

const Chip = ({ children, color }: { children: React.ReactNode; color: string }) => (
  <span style={{
    fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
    padding: '2px 8px', borderRadius: 999, background: `${color}1a`, color,
  }}>
    {children}
  </span>
);

type CardProps = { task: TaskRow; onDone: (id: string) => void; onSnooze: (id: string, dueAt: string) => void; index: number };

const TaskCard = ({ task, onDone, onSnooze, index }: CardProps) => {
  const [hover, setHover] = useState(false);
  return (
    <article
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        '--i': index,
        background: cssVars.surface,
        border: `1px solid ${hover ? '#d8d4c8' : cssVars.border}`,
        borderRadius: 12,
        padding: '12px 14px',
        marginBottom: 8,
        fontSize: 13,
        lineHeight: 1.4,
        boxShadow: hover ? '0 6px 18px -8px rgba(40,30,10,0.18), 0 1px 0 rgba(0,0,0,0.02)' : '0 1px 0 rgba(0,0,0,0.02)',
        transform: hover ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'transform 180ms ease-out, box-shadow 180ms ease-out, border-color 180ms ease-out',
        animation: 'cardIn 360ms cubic-bezier(0.16, 1, 0.3, 1) both',
        animationDelay: `calc(var(--i) * 24ms)`,
      } as React.CSSProperties}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontWeight: 600, color: cssVars.ink, fontSize: 14, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {leadName(task.lead)}
        </div>
        <div style={{ fontSize: 11, color: cssVars.inkMuted, fontVariantNumeric: 'tabular-nums' }}>{dueLabel(task.dueAt)}</div>
      </div>
      {task.title && <div style={{ fontSize: 12, color: cssVars.inkMuted, marginTop: 2 }}>{task.title}</div>}
      <div style={{ fontSize: 11, color: cssVars.inkSubtle, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{phone(task.lead)}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {task.lead?.intent && <Chip color="#7a3d0d">{task.lead.intent}</Chip>}
        {task.lead?.source && <Chip color="#1d4ed8">{task.lead.source}</Chip>}
        {task.lead?.lastFollowUpAt && (
          <span style={{ fontSize: 10, color: cssVars.inkSubtle, alignSelf: 'center' }}>
            último contato {daysSince(task.lead.lastFollowUpAt, new Date())}d atrás
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10, opacity: hover ? 1 : 0, transition: 'opacity 160ms ease-out' }}>
        <button
          type="button"
          onClick={() => onDone(task.id)}
          style={{
            fontSize: 11, padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
            background: cssVars.surface, border: `1px solid ${cssVars.border}`,
            color: cssVars.ink, fontFamily: 'inherit',
          }}
        >
          Marcar como feita
        </button>
        <button
          type="button"
          onClick={() => onSnooze(task.id, new Date(Date.now() + 86_400_000).toISOString())}
          style={{
            fontSize: 11, padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
            background: cssVars.surface, border: `1px solid ${cssVars.border}`,
            color: cssVars.ink, fontFamily: 'inherit',
          }}
        >
          Adiar 1d
        </button>
      </div>
    </article>
  );
};

const Skeleton = () => (
  <div style={{ height: 84, borderRadius: 12, background: `linear-gradient(90deg, ${cssVars.borderSoft} 0%, #fafaf6 50%, ${cssVars.borderSoft} 100%)`, backgroundSize: '200% 100%', animation: 'shimmer 1.4s ease-in-out infinite', marginBottom: 8 }} />
);

const styles = `
  @keyframes kpiIn {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes cardIn {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes countPulse {
    0%   { transform: scale(1); }
    40%  { transform: scale(1.08); }
    100% { transform: scale(1); }
  }
  @keyframes shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; transition: none !important; }
  }
`;

const FollowupsDashboard = () => {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const load = async (): Promise<void> => {
    try {
      const raw = (await createDataApi().list('task', {
        filter: { status: { eq: 'TODO' } },
        orderBy: { dueAt: 'ASC' },
        limit: 500,
        select: {
          id: true, title: true, status: true, dueAt: true, category: true,
          lead: { id: true, name: { firstName: true, lastName: true }, whatsapp: { primaryPhoneNumber: true }, source: true, intent: true, lastFollowUpAt: true, nextFollowUpAt: true },
        },
      })) as TaskRow[];
      setTasks(raw);
      setError(null);
      setLastUpdate(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar tarefas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const t = setInterval(() => { void load(); }, 30_000);
    return () => clearInterval(t);
  }, []);

  const buckets = useMemo(() => groupTasksByCategory(tasks, new Date()), [tasks]);
  const totalPending = tasks.length;
  const filteredTasks = useMemo(() => {
    if (!filter) return null;
    return buckets[filter as keyof typeof buckets] as TaskRow[] ?? [];
  }, [filter, buckets]);

  const kpis: Kpi[] = [
    { key: 'OVERDUE',  label: 'Em atraso',  count: buckets.OVERDUE.length,  accent: 'OVERDUE' },
    { key: 'TODAY',    label: 'Hoje',       count: buckets.TODAY.length,    accent: 'TODAY' },
    { key: 'UPCOMING', label: 'Próximos',   count: buckets.UPCOMING.length, accent: 'UPCOMING' },
    { key: 'PENDING',  label: 'Pendentes',  count: totalPending,            accent: 'PENDING' },
  ];

  const onDone = async (id: string): Promise<void> => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    try { await createDataApi().update('task', id, { status: 'DONE' }); }
    catch { void load(); }
  };

  const onSnooze = async (id: string, dueAt: string): Promise<void> => {
    try { await createDataApi().update('task', id, { dueAt }); }
    finally { void load(); }
  };

  return (
    <div style={{ fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: cssVars.bg, height: '100%', display: 'flex', flexDirection: 'column', color: cssVars.ink }}>
      <style>{styles}</style>
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '20px 24px 14px', borderBottom: `1px solid ${cssVars.border}` }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>Follow-ups</h1>
          <div style={{ fontSize: 12, color: cssVars.inkMuted, marginTop: 2 }}>
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: cssVars.inkSubtle, padding: '4px 10px', borderRadius: 999, background: cssVars.surface, border: `1px solid ${cssVars.border}` }}>
            atualizado há {Math.max(0, Math.floor((Date.now() - lastUpdate.getTime()) / 1000))}s
          </span>
          {filter && (
            <button
              type="button"
              onClick={() => setFilter(null)}
              style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, background: cssVars.accentSoft, border: `1px solid ${cssVars.accent}33`, color: '#7a3d0d', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Limpando filtro
            </button>
          )}
        </div>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: '16px 24px', background: cssVars.bg }}>
        {kpis.map((k, i) => <KpiTile key={k.key} kpi={k} index={i} onClick={() => setFilter(filter === k.key ? null : k.key)} active={filter === k.key} />)}
      </section>

      {error && (
        <div style={{ margin: '0 24px 12px', padding: '10px 14px', background: '#fdecec', border: '1px solid #f5b5b5', borderRadius: 10, color: '#8a1a1a', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Erro: {error}</span>
          <button type="button" onClick={() => void load()} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, background: '#fff', border: '1px solid #f5b5b5', cursor: 'pointer', fontFamily: 'inherit' }}>Tentar de novo</button>
        </div>
      )}

      <main style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: filter ? '1fr' : 'repeat(4, 1fr)', gap: 12, padding: '0 24px 24px', overflow: 'hidden' }}>
        {filter ? (
          <FilteredColumn
            label={BUCKETS.find((b) => b.category === filter)?.label ?? filter}
            accent={BUCKETS.find((b) => b.category === filter)?.accent ?? cssVars.accent}
            softBg={BUCKETS.find((b) => b.category === filter)?.softBg ?? cssVars.accentSoft}
            tasks={filteredTasks ?? []}
            loading={loading}
            onDone={onDone}
            onSnooze={onSnooze}
          />
        ) : (
          BUCKETS.map((b) => (
            <Column key={b.category} bucket={b} tasks={buckets[b.category] as TaskRow[]} loading={loading} onDone={onDone} onSnooze={onSnooze} />
          ))
        )}
      </main>
    </div>
  );
};

const Column = ({ bucket, tasks, loading, onDone, onSnooze }: { bucket: typeof BUCKETS[number]; tasks: TaskRow[]; loading: boolean; onDone: (id: string) => void; onSnooze: (id: string, dueAt: string) => void }) => {
  return (
    <section style={{ background: bucket.softBg, borderRadius: 14, border: `1px solid ${cssVars.border}`, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderBottom: `1px solid ${bucket.accent}22` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: bucket.accent }} />
          <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: bucket.accent, margin: 0 }}>{bucket.label}</h2>
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: bucket.accent, fontVariantNumeric: 'tabular-nums' }}>{tasks.length}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 10px 4px' }}>
        {loading
          ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} />)
          : tasks.length === 0
            ? <EmptyState />
            : tasks.map((t, i) => <TaskCard key={t.id} task={t} index={i} onDone={onDone} onSnooze={onSnooze} />)}
      </div>
    </section>
  );
};

const FilteredColumn = ({ label, accent, softBg, tasks, loading, onDone, onSnooze }: { label: string; accent: string; softBg: string; tasks: TaskRow[]; loading: boolean; onDone: (id: string) => void; onSnooze: (id: string, dueAt: string) => void }) => (
  <section style={{ background: softBg, borderRadius: 14, border: `1px solid ${cssVars.border}`, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderBottom: `1px solid ${accent}22` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: accent }} />
        <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: accent, margin: 0 }}>{label}</h2>
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: accent, fontVariantNumeric: 'tabular-nums' }}>{tasks.length}</span>
    </div>
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 10px 4px' }}>
      {loading
        ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} />)
        : tasks.length === 0
          ? <EmptyState />
          : tasks.map((t, i) => <TaskCard key={t.id} task={t} index={i} onDone={onDone} onSnooze={onSnooze} />)}
    </div>
  </section>
);

const EmptyState = () => (
  <div style={{ textAlign: 'center', padding: '24px 12px', color: cssVars.inkSubtle, fontSize: 12 }}>
    <div style={{ fontSize: 28, marginBottom: 6 }}>·</div>
    Nada por aqui.
  </div>
);

export default defineFrontComponent({
  universalIdentifier: FOLLOWUPS_DASHBOARD_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'followups-dashboard',
  description: 'Dashboard Follow-ups com KPIs, board categorizado e ações rápidas',
  component: FollowupsDashboard,
});
