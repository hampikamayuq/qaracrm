'use client';

import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarPlus, ChevronLeft, ChevronRight, Download, ExternalLink, RefreshCw, X } from 'lucide-react';
import {
  api,
  type Appointment,
  type AppointmentStatus,
  type ClinicUnit,
  type PipelineLead,
  type Professional,
} from '@/lib/api';
import { FilterMenu } from '../filter-menu';

// Status reais do schema Appointment — nada inventado.
const STATUS_META: Record<string, { label: string; chip: string }> = {
  SCHEDULED: { label: 'Agendado', chip: 'chip-info' },
  CONFIRMED: { label: 'Confirmado', chip: 'chip-ok' },
  DONE: { label: 'Realizado', chip: 'chip-accent' },
  NO_SHOW: { label: 'Faltou', chip: 'chip-danger' },
  CANCELLED: { label: 'Cancelado', chip: '' },
};
const STATUSES = Object.keys(STATUS_META) as AppointmentStatus[];

const VIEWS = ['month', 'week', 'day'] as const;
type CalView = (typeof VIEWS)[number];
const VIEW_LABELS: Record<CalView, string> = { month: 'Mês', week: 'Semana', day: 'Dia' };

const DOW_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 7h–20h

// ---------------- datas (sem lib) ----------------

const pad = (n: number) => String(n).padStart(2, '0');
const toDateParam = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const parseDateParam = (raw: string | null): Date => {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    const parsed = new Date(y, m - 1, d);
    if (!Number.isNaN(parsed.valueOf())) return parsed;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

const addDays = (d: Date, n: number): Date => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

// Semana começa segunda.
const startOfWeek = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const timeLabel = (iso: string): string => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const whoName = (appt: Appointment): string =>
  appt.patient?.name ?? appt.lead?.name ?? '(sem vínculo)';

// ---------------- pill ----------------

const AppointmentPill = ({ appt, onClick }: { appt: Appointment; onClick: (a: Appointment) => void }) => (
  <button
    type="button"
    className={`cal-pill cal-pill-${appt.status.toLowerCase()}`}
    onClick={() => onClick(appt)}
    title={`${timeLabel(appt.scheduledAt)} ${whoName(appt)} — ${STATUS_META[appt.status]?.label ?? appt.status}`}
  >
    <strong>{timeLabel(appt.scheduledAt)}</strong>
    <span>{whoName(appt)}</span>
  </button>
);

// ---------------- drawer de detalhes ----------------

const AppointmentDrawer = ({
  appt,
  onClose,
  onStatusChange,
}: {
  appt: Appointment | null;
  onClose: () => void;
  onStatusChange: (id: string, status: AppointmentStatus) => Promise<void>;
}) => {
  const [saving, setSaving] = useState(false);
  if (!appt) return null;
  const meta = STATUS_META[appt.status] ?? { label: appt.status, chip: '' };
  const when = new Date(appt.scheduledAt);

  const changeStatus = async (status: AppointmentStatus) => {
    if (status === appt.status) return;
    setSaving(true);
    try {
      await onStatusChange(appt.id, status);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="drawer-root" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="appt-drawer-title">
      <div className="drawer-backdrop" />
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2 id="appt-drawer-title">{whoName(appt)}</h2>
          <button onClick={onClose} className="icon-btn" type="button" aria-label="Fechar">
            <X size={17} />
          </button>
        </header>
        <div className="drawer-body">
          <div className="chips">
            <span className={`chip ${meta.chip}`}>{meta.label}</span>
          </div>

          <section className="drawer-section">
            <h3>Consulta</h3>
            <dl className="kv">
              <div>
                <dt>Data</dt>
                <dd>{when.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}</dd>
              </div>
              <div>
                <dt>Horário</dt>
                <dd>
                  {timeLabel(appt.scheduledAt)}
                  {appt.endAt ? ` – ${timeLabel(appt.endAt)}` : ''}
                </dd>
              </div>
              <div>
                <dt>Profissional</dt>
                <dd>{appt.professional?.name ?? '—'}</dd>
              </div>
              <div>
                <dt>Unidade</dt>
                <dd>{appt.unit?.name ?? '—'}</dd>
              </div>
              <div>
                <dt>Telefone</dt>
                <dd>{appt.lead?.phone ?? '—'}</dd>
              </div>
            </dl>
          </section>

          <section className="drawer-section">
            <h3>Mudar status</h3>
            <div className="chips">
              {STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  className={`chip chip-toggle ${STATUS_META[status].chip} ${appt.status === status ? 'chip-toggle-active' : ''}`}
                  disabled={saving}
                  aria-pressed={appt.status === status}
                  onClick={() => changeStatus(status)}
                >
                  {STATUS_META[status].label}
                </button>
              ))}
            </div>
          </section>

          {appt.notes ? (
            <section className="drawer-section">
              <h3>Observações</h3>
              <div className="note-box">{appt.notes}</div>
            </section>
          ) : null}

          {appt.leadId ? (
            <section className="drawer-section">
              <Link className="btn" href={`/pipeline?lead=${appt.leadId}`}>
                <ExternalLink size={14} /> Ver lead no pipeline
              </Link>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
};

// ---------------- drawer de novo agendamento ----------------

const NewAppointmentDrawer = ({
  open,
  professionals,
  units,
  defaultDate,
  onClose,
  onCreated,
}: {
  open: boolean;
  professionals: Professional[];
  units: ClinicUnit[];
  defaultDate: Date;
  onClose: () => void;
  onCreated: () => void;
}) => {
  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [leadQuery, setLeadQuery] = useState('');
  const [selectedLead, setSelectedLead] = useState<{ id: string; name: string } | null>(null);
  const [professionalId, setProfessionalId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLeadQuery('');
    setSelectedLead(null);
    setProfessionalId('');
    setUnitId('');
    setNotes('');
    setError(null);
    setScheduledAt(`${toDateParam(defaultDate)}T09:00`);
    api.getPipelineLeads().then(setLeads);
  }, [open, defaultDate]);

  const matches = useMemo(() => {
    const query = leadQuery.trim().toLowerCase();
    if (!query) return [];
    return leads
      .filter((l) => `${l.name?.firstName ?? ''} ${l.name?.lastName ?? ''}`.toLowerCase().includes(query)
        || (l.whatsapp?.primaryPhoneNumber ?? '').includes(query))
      .slice(0, 8);
  }, [leadQuery, leads]);

  if (!open) return null;

  const submit = async () => {
    if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
      setError('Informe data e hora válidas');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api.createAppointment({
        scheduledAt: new Date(scheduledAt).toISOString(),
        ...(selectedLead ? { leadId: selectedLead.id } : {}),
        ...(professionalId ? { professionalId } : {}),
        ...(unitId ? { unitId } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      if (!res.success) {
        setError(res.error ?? 'Falha ao criar agendamento');
        return;
      }
      onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="drawer-root" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="new-appt-title">
      <div className="drawer-backdrop" />
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2 id="new-appt-title">Novo agendamento</h2>
          <button onClick={onClose} className="icon-btn" type="button" aria-label="Fechar">
            <X size={17} />
          </button>
        </header>
        <div className="drawer-body">
          <label className="field">
            <span className="muted">Lead (busca por nome ou telefone)</span>
            {selectedLead ? (
              <div className="chips">
                <span className="chip chip-removable chip-accent">
                  {selectedLead.name}
                  <button type="button" aria-label="Remover lead" onClick={() => setSelectedLead(null)}>
                    <X size={11} />
                  </button>
                </span>
              </div>
            ) : (
              <>
                <input
                  className="input"
                  value={leadQuery}
                  onChange={(e) => setLeadQuery(e.target.value)}
                  placeholder="Ex.: Maria…"
                />
                {matches.length > 0 && (
                  <div className="lead-suggestions">
                    {matches.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        className="menu-item"
                        onClick={() => {
                          setSelectedLead({ id: l.id, name: `${l.name?.firstName ?? ''} ${l.name?.lastName ?? ''}`.trim() || '(sem nome)' });
                          setLeadQuery('');
                        }}
                      >
                        {l.name?.firstName || '(sem nome)'} {l.name?.lastName || ''}
                        {l.whatsapp?.primaryPhoneNumber ? <span className="faint"> · {l.whatsapp.primaryPhoneNumber}</span> : null}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </label>

          <label className="field">
            <span className="muted">Profissional</span>
            <select className="select" value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
              <option value="">Sem profissional</option>
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {p.specialty}</option>
              ))}
            </select>
          </label>

          {units.length > 0 && (
            <label className="field">
              <span className="muted">Unidade</span>
              <select className="select" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                <option value="">Sem unidade</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}{u.city ? ` — ${u.city}` : ''}</option>
                ))}
              </select>
            </label>
          )}

          <label className="field">
            <span className="muted">Data e hora</span>
            <input
              className="input"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              required
            />
          </label>

          <label className="field">
            <span className="muted">Observação (opcional)</span>
            <textarea
              className="textarea"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: primeira consulta, avaliação de tricologia"
            />
          </label>

          {error ? <div className="error">{error}</div> : null}

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={submit}>
              {saving ? 'Criando…' : 'Criar agendamento'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
};

// ---------------- visões ----------------

const MonthGrid = ({
  days,
  month,
  today,
  apptsByDay,
  onSelect,
  onOpenDay,
}: {
  days: Date[];
  month: number;
  today: Date;
  apptsByDay: Map<string, Appointment[]>;
  onSelect: (a: Appointment) => void;
  onOpenDay: (d: Date) => void;
}) => (
  <div className="cal-month" role="grid" aria-label="Calendário do mês">
    {DOW_LABELS.map((label) => (
      <div key={label} className="cal-dow">{label}</div>
    ))}
    {days.map((day) => {
      const dayAppts = apptsByDay.get(toDateParam(day)) ?? [];
      const isToday = sameDay(day, today);
      return (
        <div
          key={day.toISOString()}
          className={`cal-day ${day.getMonth() !== month ? 'cal-day-out' : ''} ${isToday ? 'cal-today' : ''}`}
        >
          <div className="cal-day-head">
            <span className="cal-day-num">{day.getDate()}</span>
            <span className="cal-day-mobile">
              {day.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}
            </span>
          </div>
          {dayAppts.slice(0, 4).map((appt) => (
            <AppointmentPill key={appt.id} appt={appt} onClick={onSelect} />
          ))}
          {dayAppts.length > 4 && (
            <button type="button" className="cal-more" onClick={() => onOpenDay(day)}>
              +{dayAppts.length - 4} mais
            </button>
          )}
        </div>
      );
    })}
  </div>
);

const WeekGrid = ({
  days,
  today,
  appointments,
  onSelect,
}: {
  days: Date[];
  today: Date;
  appointments: Appointment[];
  onSelect: (a: Appointment) => void;
}) => {
  // Consultas fora de 7h–20h entram no primeiro/último slot.
  const slotOf = (iso: string): number => Math.min(Math.max(new Date(iso).getHours(), HOURS[0]), HOURS[HOURS.length - 1]);
  return (
    <div className="cal-week" style={{ gridTemplateColumns: `52px repeat(${days.length}, 1fr)` }}>
      <div className="cal-week-corner" />
      {days.map((day) => (
        <div key={day.toISOString()} className={`cal-week-head ${sameDay(day, today) ? 'cal-week-today' : ''}`}>
          {day.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}
        </div>
      ))}
      {HOURS.map((hour) => (
        <Fragment key={hour}>
          <div className="cal-hour-label">{pad(hour)}:00</div>
          {days.map((day) => (
            <div key={`${hour}-${day.toISOString()}`} className={`cal-slot ${sameDay(day, today) ? 'cal-slot-today' : ''}`}>
              {appointments
                .filter((a) => sameDay(new Date(a.scheduledAt), day) && slotOf(a.scheduledAt) === hour)
                .map((appt) => <AppointmentPill key={appt.id} appt={appt} onClick={onSelect} />)}
            </div>
          ))}
        </Fragment>
      ))}
    </div>
  );
};

// ---------------- página ----------------

function CalendarView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawView = searchParams.get('view');
  const view: CalView = (VIEWS as readonly string[]).includes(rawView ?? '') ? (rawView as CalView) : 'month';
  // Memoizado pelo valor cru do param: um Date novo a cada render dispararia
  // o useEffect de fetch em loop.
  const dateParam = searchParams.get('date');
  const date = useMemo(() => parseDateParam(dateParam), [dateParam]);
  const profFilter = searchParams.get('prof') ?? 'all';
  const statusFilter = searchParams.get('status') ?? 'all';

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [units, setUnits] = useState<ClinicUnit[]>([]);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  const setParam = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (!value || value === 'all') params.delete(key);
      else params.set(key, value);
    });
    const text = params.toString();
    router.replace(`/calendar${text ? `?${text}` : ''}`, { scroll: false });
  }, [router, searchParams]);

  // Intervalo visível → intervalo do fetch.
  const { rangeStart, rangeEnd, monthDays, weekDays } = useMemo(() => {
    if (view === 'month') {
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const gridStart = startOfWeek(monthStart);
      const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      const offset = Math.round((monthStart.getTime() - gridStart.getTime()) / 86_400_000);
      const weeks = Math.ceil((offset + daysInMonth) / 7);
      const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));
      return { rangeStart: gridStart, rangeEnd: addDays(gridStart, weeks * 7), monthDays: days, weekDays: [] as Date[] };
    }
    if (view === 'week') {
      const weekStart = startOfWeek(date);
      const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
      return { rangeStart: weekStart, rangeEnd: addDays(weekStart, 7), monthDays: [] as Date[], weekDays: days };
    }
    return { rangeStart: date, rangeEnd: addDays(date, 1), monthDays: [] as Date[], weekDays: [date] };
  }, [view, date]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getAppointments({
        from: rangeStart.toISOString(),
        to: rangeEnd.toISOString(),
        ...(profFilter !== 'all' ? { professionalId: profFilter } : {}),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
      });
      setAppointments(data);
    } finally {
      setLoading(false);
    }
  }, [rangeStart, rangeEnd, profFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.getProfessionals().then(setProfessionals);
    api.getUnits().then(setUnits);
  }, []);

  const apptsByDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const appt of appointments) {
      const key = toDateParam(new Date(appt.scheduledAt));
      const list = map.get(key) ?? [];
      list.push(appt);
      map.set(key, list);
    }
    return map;
  }, [appointments]);

  const navigate = (direction: -1 | 0 | 1) => {
    if (direction === 0) {
      setParam({ date: toDateParam(today) });
      return;
    }
    const next = view === 'month'
      ? new Date(date.getFullYear(), date.getMonth() + direction, 1)
      : addDays(date, direction * (view === 'week' ? 7 : 1));
    setParam({ date: toDateParam(next) });
  };

  const rangeLabel = view === 'month'
    ? date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    : view === 'week'
      ? `${weekDays[0]?.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} – ${weekDays[6]?.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`
      : date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  const changeStatus = async (id: string, status: AppointmentStatus) => {
    const res = await api.updateAppointment(id, { status });
    if (res.success && res.data) setSelected(res.data);
    await load();
  };

  const exportIcs = async () => {
    const blob = await api.downloadAgendaIcs(rangeStart.toISOString(), rangeEnd.toISOString());
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agenda-qara.ics';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="page page-wide page-tight">
      <div className="toolbar">
        <div>
          <h1 className="title">Agenda</h1>
          <div className="muted">
            {loading ? 'Carregando…' : `${appointments.length} ${appointments.length === 1 ? 'agendamento' : 'agendamentos'}`}
            <span> · {rangeLabel}</span>
          </div>
        </div>
        <div className="toolbar-right">
          <div className="segmented" role="tablist" aria-label="Visão do calendário">
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                className={view === v ? 'seg-active' : ''}
                onClick={() => setParam({ view: v === 'month' ? null : v })}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>
          <div className="cal-nav">
            <button type="button" className="icon-btn" aria-label="Anterior" onClick={() => navigate(-1)}>
              <ChevronLeft size={16} />
            </button>
            <button type="button" className="btn" onClick={() => navigate(0)}>Hoje</button>
            <button type="button" className="icon-btn" aria-label="Próximo" onClick={() => navigate(1)}>
              <ChevronRight size={16} />
            </button>
          </div>
          <FilterMenu
            label="Profissional"
            ariaLabel="Profissionais"
            value={profFilter}
            onChange={(v) => setParam({ prof: v })}
            options={[
              { value: 'all', label: 'Todos os profissionais' },
              ...professionals.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <FilterMenu
            label="Status"
            ariaLabel="Status"
            value={statusFilter}
            onChange={(v) => setParam({ status: v })}
            options={[
              { value: 'all', label: 'Todos os status' },
              ...STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label })),
            ]}
          />
          <button type="button" className="btn" onClick={exportIcs} title="Exportar o período visível">
            <Download size={15} /> Exportar .ics
          </button>
          <button type="button" className="btn" onClick={load} disabled={loading} aria-label="Atualizar">
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <CalendarPlus size={15} /> Novo agendamento
          </button>
        </div>
      </div>

      {!loading && appointments.length === 0 && (
        <div className="cal-empty">
          <strong>Nenhum agendamento neste período.</strong>
          <span className="muted">Ajuste os filtros ou crie o primeiro agendamento.</span>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <CalendarPlus size={15} /> Novo agendamento
          </button>
        </div>
      )}

      {view === 'month' ? (
        <MonthGrid
          days={monthDays}
          month={date.getMonth()}
          today={today}
          apptsByDay={apptsByDay}
          onSelect={setSelected}
          onOpenDay={(d) => setParam({ view: 'day', date: toDateParam(d) })}
        />
      ) : (
        <WeekGrid days={weekDays} today={today} appointments={appointments} onSelect={setSelected} />
      )}

      <AppointmentDrawer appt={selected} onClose={() => setSelected(null)} onStatusChange={changeStatus} />
      <NewAppointmentDrawer
        open={creating}
        professionals={professionals}
        units={units}
        defaultDate={date}
        onClose={() => setCreating(false)}
        onCreated={() => { setCreating(false); load(); }}
      />
    </main>
  );
}

export default function CalendarPage() {
  // useSearchParams exige Suspense no App Router (build estático).
  return (
    <Suspense fallback={null}>
      <CalendarView />
    </Suspense>
  );
}
