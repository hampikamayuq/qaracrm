'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, FileText, Plus, RefreshCw, Send, X } from 'lucide-react';
import { api, type Budget, type BudgetStatus, type PipelineLead } from '@/lib/api';
import { FilterMenu } from '../filter-menu';

const STATUS_META: Record<BudgetStatus, { label: string; chip: string }> = {
  DRAFT: { label: 'Rascunho', chip: '' },
  SENT: { label: 'Enviado', chip: 'chip-info' },
  ACCEPTED: { label: 'Aceito', chip: 'chip-ok' },
  REJECTED: { label: 'Recusado', chip: 'chip-danger' },
  EXPIRED: { label: 'Expirado', chip: 'chip-warning' },
};
const STATUSES = Object.keys(STATUS_META) as BudgetStatus[];

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (value: string | number | null): string =>
  value === null ? '—' : brl.format(Number(value));

const formatDate = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.valueOf()) ? null : d.toLocaleDateString('pt-BR');
};

const leadLabel = (lead: PipelineLead): string =>
  `${lead.name?.firstName ?? ''} ${lead.name?.lastName ?? ''}`.trim() || '(sem nome)';

// ---------------- linha ----------------

const BudgetRow = ({
  budget,
  busy,
  onSend,
  onAccept,
  onReject,
  onEdit,
}: {
  budget: Budget;
  busy: boolean;
  onSend: (b: Budget) => void;
  onAccept: (b: Budget) => void;
  onReject: (b: Budget) => void;
  onEdit: (b: Budget) => void;
}) => {
  const meta = STATUS_META[budget.status];
  const expires = formatDate(budget.expiresAt);
  return (
    <div className="card">
      <div className="budget-row">
        <div className="budget-main">
          <span className="budget-title">{budget.title}</span>
          <span className="budget-meta">
            <span className={`chip ${meta.chip}`}>{meta.label}</span>
            {budget.lead ? (
              <Link className="chip chip-accent" href={`/pipeline?lead=${budget.lead.id}`} title="Abrir lead no pipeline">
                {budget.lead.name}
              </Link>
            ) : (
              <span className="faint">sem lead</span>
            )}
            <span>{budget.installments}x</span>
            {expires ? <span>vence {expires}</span> : <span className="faint">sem validade</span>}
          </span>
        </div>
        <div className="budget-amounts">
          <span className="budget-amount">{money(budget.amount)}</span>
          {budget.balance > 0 && budget.totalPaid > 0 ? (
            <span className="budget-balance">saldo {money(budget.balance)}</span>
          ) : null}
        </div>
      </div>
      <div className="budget-actions">
        {budget.status === 'DRAFT' ? (
          <>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onSend(budget)}>
              <Send size={14} /> Enviar
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => onEdit(budget)}>
              Editar
            </button>
          </>
        ) : null}
        {budget.status === 'SENT' ? (
          <>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onAccept(budget)}>
              <Check size={14} /> Aceitar
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => onReject(budget)}>
              <X size={14} /> Recusar
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
};

// ---------------- drawer criar/editar ----------------

const BudgetDrawer = ({
  open,
  budget,
  leads,
  onClose,
  onSaved,
}: {
  open: boolean;
  budget: Budget | null;
  leads: PipelineLead[];
  onClose: () => void;
  onSaved: () => void;
}) => {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [entryAmount, setEntryAmount] = useState('');
  const [installments, setInstallments] = useState('1');
  const [expiresAt, setExpiresAt] = useState('');
  const [leadId, setLeadId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTitle(budget?.title ?? '');
    setAmount(budget ? String(Number(budget.amount)) : '');
    setEntryAmount(budget?.entryAmount ? String(Number(budget.entryAmount)) : '');
    setInstallments(budget ? String(budget.installments) : '1');
    setExpiresAt(budget?.expiresAt ? budget.expiresAt.slice(0, 10) : '');
    setLeadId(budget?.leadId ?? '');
    setNotes(budget?.notes ?? '');
  }, [open, budget]);

  if (!open) return null;

  const submit = async () => {
    const trimmed = title.trim();
    const amountNum = Number(amount);
    if (!trimmed) {
      setError('Informe um título');
      return;
    }
    if (!amount || Number.isNaN(amountNum) || amountNum < 0) {
      setError('Informe um valor válido');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: trimmed,
        amount: amountNum,
        entryAmount: entryAmount ? Number(entryAmount) : null,
        installments: Number(installments) || 1,
        expiresAt: expiresAt ? new Date(`${expiresAt}T12:00:00`).toISOString() : null,
        notes: notes.trim() || null,
        leadId: leadId || null,
      };
      const res = budget
        ? await api.updateBudget(budget.id, payload)
        : await api.createBudget(payload);
      if (!res.success) {
        setError(res.error ?? 'Falha ao salvar o orçamento');
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="drawer-root" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="budget-drawer-title">
      <div className="drawer-backdrop" />
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2 id="budget-drawer-title">{budget ? 'Editar orçamento' : 'Novo orçamento'}</h2>
          <button onClick={onClose} className="icon-btn" type="button" aria-label="Fechar">
            <X size={17} />
          </button>
        </header>
        <div className="drawer-body">
          <label className="field">
            <span className="muted">Título</span>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Rinoplastia + acompanhamento"
            />
          </label>

          <label className="field">
            <span className="muted">Valor total (R$)</span>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
            />
          </label>

          <label className="field">
            <span className="muted">Entrada (opcional)</span>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={entryAmount}
              onChange={(e) => setEntryAmount(e.target.value)}
              placeholder="0,00"
            />
          </label>

          <label className="field">
            <span className="muted">Parcelas</span>
            <input
              className="input"
              type="number"
              min="1"
              step="1"
              value={installments}
              onChange={(e) => setInstallments(e.target.value)}
            />
          </label>

          <label className="field">
            <span className="muted">Validade (opcional)</span>
            <input
              className="input"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </label>

          <label className="field">
            <span className="muted">Lead vinculado (opcional)</span>
            <select className="select" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">Sem lead</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>{leadLabel(l)}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="muted">Observação (opcional)</span>
            <textarea
              className="textarea"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: condições de pagamento, materiais inclusos"
            />
          </label>

          {error ? <div className="error">{error}</div> : null}

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={submit}>
              {saving ? 'Salvando…' : budget ? 'Salvar' : 'Criar orçamento'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
};

// ---------------- página ----------------

export default function QuotesPage() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBudgets(await api.getBudgets(statusFilter !== 'all' ? { status: statusFilter } : {}));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.getPipelineLeads().then(setLeads);
  }, []);

  const sortedLeads = useMemo(
    () => [...leads].sort((a, b) => (a.name?.firstName ?? '').localeCompare(b.name?.firstName ?? '')),
    [leads],
  );

  const runAction = async (id: string, action: () => Promise<{ success: boolean; error?: string }>) => {
    setBusyId(id);
    try {
      const res = await action();
      if (res.success) await load();
    } finally {
      setBusyId(null);
    }
  };

  const openCreate = () => { setEditing(null); setDrawerOpen(true); };
  const openEdit = (b: Budget) => { setEditing(b); setDrawerOpen(true); };

  return (
    <main className="page page-tight">
      <div className="toolbar">
        <div>
          <h1 className="title">Orçamentos</h1>
          <div className="muted">
            {loading
              ? 'Carregando…'
              : `${budgets.length} ${budgets.length === 1 ? 'orçamento' : 'orçamentos'}`}
          </div>
        </div>
        <div className="toolbar-right">
          <FilterMenu
            label="Status"
            ariaLabel="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: 'Todos os status' },
              ...STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label })),
            ]}
          />
          <button type="button" className="btn" onClick={load} disabled={loading} aria-label="Atualizar">
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
          </button>
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <Plus size={15} /> Novo orçamento
          </button>
        </div>
      </div>

      {!loading && budgets.length === 0 ? (
        <div className="task-empty">
          <FileText size={28} aria-hidden="true" />
          <strong>Nenhum orçamento</strong>
          <span className="muted">Crie uma proposta para acompanhar o aceite sem misturar com a conversa.</span>
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <Plus size={15} /> Novo orçamento
          </button>
        </div>
      ) : (
        <div className="budget-list">
          {budgets.map((budget) => (
            <BudgetRow
              key={budget.id}
              budget={budget}
              busy={busyId === budget.id}
              onSend={(b) => runAction(b.id, () => api.sendBudget(b.id))}
              onAccept={(b) => runAction(b.id, () => api.acceptBudget(b.id))}
              onReject={(b) => runAction(b.id, () => api.rejectBudget(b.id))}
              onEdit={openEdit}
            />
          ))}
        </div>
      )}

      <BudgetDrawer
        open={drawerOpen}
        budget={editing}
        leads={sortedLeads}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => { setDrawerOpen(false); load(); }}
      />
    </main>
  );
}
