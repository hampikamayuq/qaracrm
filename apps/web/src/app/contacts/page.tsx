'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { MessageSquareText, Pencil, Plus, RefreshCw, Search, UserRound, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api, type Patient, type PatientDetail, type PatientInput } from '@/lib/api';
import { ActivityTimeline } from '../activity-timeline';

const formatDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.valueOf()) ? '—' : d.toLocaleDateString('pt-BR');
};

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (value: string | null): string => (value === null ? '—' : brl.format(Number(value)));

const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'Agendado',
  CONFIRMED: 'Confirmado',
  DONE: 'Realizado',
  NO_SHOW: 'Faltou',
  CANCELLED: 'Cancelado',
};

const BUDGET_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  SENT: 'Enviado',
  ACCEPTED: 'Aceito',
  REJECTED: 'Recusado',
  EXPIRED: 'Expirado',
};

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.valueOf())
    ? '—'
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

// ---------------- drawer criar/editar ----------------

const emptyForm: PatientInput = {
  name: '',
  phone: '',
  email: '',
  cpf: '',
  birthDate: '',
  preferredChannel: '',
  lgpdConsent: false,
  notesAdministrative: '',
};

const PatientDrawer = ({
  open,
  patient,
  onClose,
  onSaved,
}: {
  open: boolean;
  patient: Patient | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) => {
  const [form, setForm] = useState<PatientInput>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      patient
        ? {
            name: patient.name,
            phone: patient.phone ?? '',
            email: patient.email ?? '',
            cpf: patient.cpf ?? '',
            birthDate: patient.birthDate ? patient.birthDate.slice(0, 10) : '',
            preferredChannel: patient.preferredChannel ?? '',
            lgpdConsent: patient.lgpdConsent,
            notesAdministrative: patient.notesAdministrative ?? '',
          }
        : emptyForm,
    );
  }, [open, patient]);

  if (!open) return null;

  const set = <K extends keyof PatientInput>(key: K, value: PatientInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    const name = (form.name ?? '').trim();
    if (!name) {
      setError('Informe o nome do paciente');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: PatientInput = {
        name,
        phone: (form.phone ?? '').trim() || null,
        email: (form.email ?? '').trim() || null,
        cpf: (form.cpf ?? '').trim() || null,
        birthDate: form.birthDate ? new Date(`${form.birthDate}T12:00:00`).toISOString() : null,
        preferredChannel: (form.preferredChannel ?? '').trim() || null,
        lgpdConsent: form.lgpdConsent ?? false,
        notesAdministrative: (form.notesAdministrative ?? '').trim() || null,
      };
      const res = patient ? await api.updatePatient(patient.id, payload) : await api.createPatient(payload);
      if (!res.success || !res.data) {
        setError(res.error ?? 'Falha ao salvar o paciente');
        return;
      }
      onSaved(res.data.id);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="drawer-root" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="patient-drawer-title">
      <div className="drawer-backdrop" />
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2 id="patient-drawer-title">{patient ? 'Editar paciente' : 'Novo paciente'}</h2>
          <button onClick={onClose} className="icon-btn" type="button" aria-label="Fechar">
            <X size={17} />
          </button>
        </header>
        <div className="drawer-body">
          <label className="field">
            <span className="muted">Nome</span>
            <input className="input" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="Nome completo" />
          </label>

          <label className="field">
            <span className="muted">Telefone</span>
            <input className="input" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="55 99 99999-9999" />
          </label>

          <label className="field">
            <span className="muted">E-mail</span>
            <input className="input" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} placeholder="paciente@email.com" />
          </label>

          <label className="field">
            <span className="muted">CPF</span>
            <input className="input" value={form.cpf ?? ''} onChange={(e) => set('cpf', e.target.value)} placeholder="000.000.000-00" />
          </label>

          <label className="field">
            <span className="muted">Data de nascimento</span>
            <input className="input" type="date" value={form.birthDate ?? ''} onChange={(e) => set('birthDate', e.target.value)} />
          </label>

          <label className="field">
            <span className="muted">Canal preferido</span>
            <select className="select" value={form.preferredChannel ?? ''} onChange={(e) => set('preferredChannel', e.target.value)}>
              <option value="">Não informado</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="ligacao">Ligação</option>
              <option value="email">E-mail</option>
              <option value="presencial">Presencial</option>
            </select>
          </label>

          <label className="field field-check">
            <input type="checkbox" checked={form.lgpdConsent ?? false} onChange={(e) => set('lgpdConsent', e.target.checked)} />
            <span className="muted">Consentimento LGPD registrado</span>
          </label>

          <label className="field">
            <span className="muted">Observações administrativas</span>
            <textarea
              className="textarea"
              rows={3}
              value={form.notesAdministrative ?? ''}
              onChange={(e) => set('notesAdministrative', e.target.value)}
              placeholder="Ex.: convênio, restrições, preferências de atendimento"
            />
          </label>

          {error ? <div className="error">{error}</div> : null}

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={submit}>
              {saving ? 'Salvando…' : patient ? 'Salvar' : 'Criar paciente'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
};

// ---------------- detalhe ----------------

const PatientDetailPanel = ({
  detail,
  loading,
  onEdit,
}: {
  detail: PatientDetail | null;
  loading: boolean;
  onEdit: () => void;
}) => {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');

  const startConversation = async () => {
    if (!detail) return;
    setStarting(true);
    setStartError('');
    try {
      const res = await api.startConversation({ patientId: detail.id });
      if (res.success && res.data) {
        router.push(`/inbox?conversationId=${res.data.conversationId}`);
      } else {
        setStartError(res.error ?? 'Falha ao iniciar a conversa.');
      }
    } finally {
      setStarting(false);
    }
  };

  if (loading && !detail) {
    return <div className="contact-panel"><div className="muted">Carregando paciente…</div></div>;
  }
  if (!detail) {
    return (
      <div className="contact-panel">
        <div className="tl-empty">Selecione um paciente para ver os detalhes e o histórico.</div>
      </div>
    );
  }
  return (
    <div className="contact-panel">
      <div className="contact-card">
        <span className="tl-icon tl-accent" aria-hidden="true"><UserRound size={16} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="conversation-name" style={{ fontSize: '15px' }}>{detail.name}</div>
          {detail.lead ? (
            <Link className="chip chip-accent" href={`/pipeline?lead=${detail.lead.id}`} title="Abrir lead de origem no pipeline">
              origem: {detail.lead.name}
            </Link>
          ) : (
            <span className="faint">cadastro direto</span>
          )}
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={starting}
          title={detail.phone ? 'Abrir (ou iniciar) a conversa no Inbox' : 'Cadastre o telefone antes de conversar'}
          onClick={startConversation}
        >
          <MessageSquareText size={14} /> {starting ? 'Abrindo…' : 'Conversar'}
        </button>
        <button type="button" className="btn" onClick={onEdit}><Pencil size={14} /> Editar</button>
      </div>
      {startError ? <p className="error" style={{ margin: '6px 0 0' }}>{startError}</p> : null}

      <div className="panel-block">
        <h3>Dados</h3>
        <dl className="detail-list">
          <div><dt>Telefone</dt><dd>{detail.phone ?? '—'}</dd></div>
          <div><dt>E-mail</dt><dd>{detail.email ?? '—'}</dd></div>
          <div><dt>CPF</dt><dd>{detail.cpf ?? '—'}</dd></div>
          <div><dt>Nascimento</dt><dd>{formatDate(detail.birthDate)}</dd></div>
          <div><dt>Canal preferido</dt><dd>{detail.preferredChannel ?? '—'}</dd></div>
          <div><dt>LGPD</dt><dd>{detail.lgpdConsent ? 'Consentido' : 'Pendente'}</dd></div>
        </dl>
        {detail.notesAdministrative ? <div className="tl-detail">{detail.notesAdministrative}</div> : null}
      </div>

      {detail.appointments.length > 0 ? (
        <div className="panel-block">
          <h3>Consultas</h3>
          {detail.appointments.map((a) => (
            <div className="task-row" key={a.id}>
              <strong>{formatDateTime(a.scheduledAt)}</strong>
              <span>
                {[APPOINTMENT_STATUS_LABELS[a.status] ?? a.status, a.service?.name, a.professional?.name].filter(Boolean).join(' · ')}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {detail.budgets.length > 0 ? (
        <div className="panel-block">
          <h3>Orçamentos</h3>
          {detail.budgets.map((b) => (
            <div className="task-row" key={b.id}>
              <strong>{b.title}</strong>
              <span>{money(b.amount)} · {BUDGET_STATUS_LABELS[b.status] ?? b.status}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="panel-block">
        <h3>Histórico</h3>
        <ActivityTimeline items={detail.timeline} emptyText="Sem atividades registradas ainda." />
      </div>
    </div>
  );
};

// ---------------- página ----------------

export default function ContactsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Patient | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getPatients(search ? { search } : {});
      setPatients(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [search]);

  // Debounce da busca — mesma lógica leve das outras telas.
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await api.getPatient(id));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  const openCreate = () => { setEditing(null); setDrawerOpen(true); };
  const openEdit = () => {
    if (detail) {
      setEditing(detail);
      setDrawerOpen(true);
    }
  };

  const onSaved = async (id: string) => {
    setDrawerOpen(false);
    await load();
    setSelectedId(id);
    await loadDetail(id);
  };

  const countLabel = useMemo(
    () => (loading ? 'Carregando…' : `${total} ${total === 1 ? 'paciente' : 'pacientes'}`),
    [loading, total],
  );

  return (
    <main className="page page-tight">
      <div className="toolbar">
        <div>
          <h1 className="title">Pacientes</h1>
          <div className="muted">{countLabel}</div>
        </div>
        <div className="toolbar-right">
          <div className="search-field">
            <Search size={15} aria-hidden="true" />
            <input
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou telefone"
              aria-label="Buscar pacientes"
            />
          </div>
          <button type="button" className="btn" onClick={load} disabled={loading} aria-label="Atualizar">
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
          </button>
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <Plus size={15} /> Novo paciente
          </button>
        </div>
      </div>

      <div className="patients-grid">
        <div className="inbox-col">
          <div className="panel-head"><span>Pacientes</span></div>
          {!loading && patients.length === 0 ? (
            <div className="task-empty">
              <UserRound size={28} aria-hidden="true" />
              <strong>Nenhum paciente</strong>
              <span className="muted">
                {search ? 'Nenhum paciente encontrado para essa busca.' : 'Converta um lead do pipeline ou cadastre um paciente.'}
              </span>
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                <Plus size={15} /> Novo paciente
              </button>
            </div>
          ) : (
            <div className="inbox-list">
              {patients.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className={`conversation-card${p.id === selectedId ? ' conversation-card-active' : ''}`}
                  onClick={() => setSelectedId(p.id)}
                >
                  <div className="conversation-card-head">
                    <div className="conversation-id">
                      <span className="conversation-name">{p.name}</span>
                      <span className="conversation-phone">{p.phone ?? 'sem telefone'}</span>
                    </div>
                    {p.leadId ? <span className="chip chip-accent">convertido</span> : null}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="inbox-col">
          <PatientDetailPanel detail={detail} loading={detailLoading} onEdit={openEdit} />
        </div>
      </div>

      <PatientDrawer
        open={drawerOpen}
        patient={editing}
        onClose={() => setDrawerOpen(false)}
        onSaved={onSaved}
      />
    </main>
  );
}
