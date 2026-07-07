'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, ListChecks, Plus, RefreshCw } from 'lucide-react';
import { api, type FeedPeriod, type PipelineLead, type TaskCategory, type TaskItem, type TimelineItem } from '@/lib/api';
import { ActivityTimeline } from '../activity-timeline';

// Buckets do follow-up — mesma regra do lib/followup/categorize da API
// (a categoria vem calculada no GET /tasks).
const BUCKETS: Array<{ category: TaskCategory; label: string; tone: string }> = [
  { category: 'OVERDUE', label: 'Atrasadas', tone: 'bucket-danger' },
  { category: 'TODAY', label: 'Hoje', tone: 'bucket-warning' },
  { category: 'UPCOMING', label: 'Próximas', tone: 'bucket-info' },
  { category: 'NO_DATE', label: 'Sem data', tone: 'bucket-muted' },
];

const PRIORITY_CHIPS: Record<string, { label: string; chip: string }> = {
  URGENT: { label: 'Urgente', chip: 'chip-danger' },
  HIGH: { label: 'Alta', chip: 'chip-warning' },
};

const formatDue = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    + ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const TaskRow = ({ task, onDone }: { task: TaskItem; onDone: (id: string) => void }) => {
  const priority = PRIORITY_CHIPS[task.priority];
  return (
    <li className="task-item">
      <button
        type="button"
        className="task-check"
        aria-label={`Concluir tarefa: ${task.title}`}
        title="Concluir"
        onClick={() => onDone(task.id)}
      >
        <Check size={13} />
      </button>
      <div className="task-item-body">
        <span className="task-item-title">{task.title}</span>
        <span className="task-item-meta faint">
          {formatDue(task.dueAt) ? <span>vence {formatDue(task.dueAt)}</span> : <span>sem vencimento</span>}
          {task.assignedTo ? <span> · {task.assignedTo.name}</span> : null}
        </span>
      </div>
      <div className="chips">
        {priority ? <span className={`chip ${priority.chip}`}>{priority.label}</span> : null}
        {task.lead ? (
          <Link className="chip chip-accent" href={`/pipeline?lead=${task.lead.id}`} title="Abrir lead no pipeline">
            {task.lead.name}
          </Link>
        ) : null}
      </div>
    </li>
  );
};

const QuickTaskForm = ({ leads, onCreated }: { leads: PipelineLead[]; onCreated: () => void }) => {
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [leadId, setLeadId] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await api.createTask({
        title: trimmed,
        ...(dueAt && !Number.isNaN(Date.parse(dueAt)) ? { dueAt: new Date(dueAt).toISOString() } : {}),
        ...(leadId ? { leadId } : {}),
      });
      setTitle('');
      setDueAt('');
      setLeadId('');
      onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="quick-task">
      <input
        className="input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder="Nova tarefa… (ex.: ligar para confirmar retorno)"
        aria-label="Título da nova tarefa"
      />
      <input
        className="input quick-task-due"
        type="datetime-local"
        value={dueAt}
        onChange={(e) => setDueAt(e.target.value)}
        aria-label="Vencimento"
      />
      <select className="select quick-task-lead" value={leadId} onChange={(e) => setLeadId(e.target.value)} aria-label="Lead (opcional)">
        <option value="">Sem lead</option>
        {leads.map((l) => (
          <option key={l.id} value={l.id}>
            {`${l.name?.firstName ?? ''} ${l.name?.lastName ?? ''}`.trim() || '(sem nome)'}
          </option>
        ))}
      </select>
      <button type="button" className="btn btn-primary" disabled={saving || !title.trim()} onClick={submit}>
        <Plus size={15} /> Criar
      </button>
    </div>
  );
};

function TasksView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') === 'atividades' ? 'atividades' : 'tarefas';
  const period: FeedPeriod = searchParams.get('period') === '7d' ? '7d' : '24h';

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [feed, setFeed] = useState<TimelineItem[]>([]);
  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [loading, setLoading] = useState(false);

  const setParam = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (!value) params.delete(key);
    else params.set(key, value);
    const text = params.toString();
    router.replace(`/tasks${text ? `?${text}` : ''}`, { scroll: false });
  }, [router, searchParams]);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      setTasks(await api.getTasks());
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      setFeed(await api.getActivityFeed(period));
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    if (tab === 'tarefas') loadTasks();
    else loadFeed();
  }, [tab, loadTasks, loadFeed]);

  useEffect(() => {
    api.getPipelineLeads().then(setLeads);
  }, []);

  const sortedLeads = useMemo(
    () => [...leads].sort((a, b) => (a.name?.firstName ?? '').localeCompare(b.name?.firstName ?? '')),
    [leads],
  );

  const grouped = useMemo(() => {
    const groups = new Map<TaskCategory, TaskItem[]>();
    for (const task of tasks) {
      const category = task.category ?? 'NO_DATE';
      const list = groups.get(category) ?? [];
      list.push(task);
      groups.set(category, list);
    }
    return groups;
  }, [tasks]);

  const completeTask = async (id: string) => {
    // Otimista: remove da lista e desfaz se o PATCH falhar.
    const previous = tasks;
    setTasks(tasks.filter((t) => t.id !== id));
    const res = await api.setTaskStatus(id, 'DONE');
    if (!res.success) setTasks(previous);
  };

  return (
    <main className="page page-tight">
      <div className="toolbar">
        <div>
          <h1 className="title">Tarefas &amp; Atividades</h1>
          <div className="muted">
            {loading
              ? 'Carregando…'
              : tab === 'tarefas'
                ? `${tasks.length} ${tasks.length === 1 ? 'tarefa pendente' : 'tarefas pendentes'}`
                : `${feed.length} ${feed.length === 1 ? 'evento' : 'eventos'} · ${period === '24h' ? 'últimas 24h' : 'últimos 7 dias'}`}
          </div>
        </div>
        <div className="toolbar-right">
          <div className="segmented" role="tablist" aria-label="Seção">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'tarefas'}
              className={tab === 'tarefas' ? 'seg-active' : ''}
              onClick={() => setParam('tab', null)}
            >
              Tarefas
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'atividades'}
              className={tab === 'atividades' ? 'seg-active' : ''}
              onClick={() => setParam('tab', 'atividades')}
            >
              Atividades
            </button>
          </div>
          {tab === 'atividades' && (
            <div className="segmented" role="tablist" aria-label="Período">
              <button
                type="button"
                role="tab"
                aria-selected={period === '24h'}
                className={period === '24h' ? 'seg-active' : ''}
                onClick={() => setParam('period', null)}
              >
                24h
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={period === '7d'}
                className={period === '7d' ? 'seg-active' : ''}
                onClick={() => setParam('period', '7d')}
              >
                7 dias
              </button>
            </div>
          )}
          <button
            type="button"
            className="btn"
            onClick={tab === 'tarefas' ? loadTasks : loadFeed}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> Atualizar
          </button>
        </div>
      </div>

      {tab === 'tarefas' ? (
        <>
          <QuickTaskForm leads={sortedLeads} onCreated={loadTasks} />

          {!loading && tasks.length === 0 ? (
            <div className="task-empty">
              <ListChecks size={28} aria-hidden="true" />
              <strong>Nenhuma tarefa pendente</strong>
              <span className="muted">Crie uma tarefa rápida acima ou aguarde os follow-ups automáticos.</span>
            </div>
          ) : (
            BUCKETS.map(({ category, label, tone }) => {
              const list = grouped.get(category) ?? [];
              if (list.length === 0) return null;
              return (
                <section key={category} className="task-bucket">
                  <h2 className={`task-bucket-title ${tone}`}>
                    {label} <span className="count-badge">{list.length}</span>
                  </h2>
                  <ul className="task-list">
                    {list.map((task) => (
                      <TaskRow key={task.id} task={task} onDone={completeTask} />
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </>
      ) : (
        <section className="card feed-card">
          {loading ? (
            <span className="faint">Carregando…</span>
          ) : (
            <ActivityTimeline items={feed} emptyText="Sem atividades no período. A operação está quieta — ou os filtros estão apertados." />
          )}
        </section>
      )}
    </main>
  );
}

export default function TasksPage() {
  // useSearchParams exige Suspense no App Router (build estático).
  return (
    <Suspense fallback={null}>
      <TasksView />
    </Suspense>
  );
}
