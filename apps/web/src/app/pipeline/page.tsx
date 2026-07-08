'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarClock, Clock3, Flame, MessageCircle, RefreshCw, X } from 'lucide-react';
import { api, type PipelineLead, type TimelineItem } from '@/lib/api';
import { LOSS_REASONS, lossLabel } from '@/lib/pipeline-meta';
import { FilterMenu } from '../filter-menu';
import { ActivityTimeline } from '../activity-timeline';

// Estágios canônicos do funil (KB §5) — mesmo conjunto servido por
// GET /pipelines/:pipeline/stages.
const STAGES = [
  'novo-lead',
  'qualificado',
  'horario-oferecido',
  'agendado',
  'confirmado',
  'atendido',
  'reagendado',
  'perdido',
  'alta-manutencao',
] as const;

type Stage = typeof STAGES[number];

// Colunas terminais: colapsadas por padrão para não poluir o quadro.
const TERMINAL_STAGES: readonly Stage[] = ['perdido', 'alta-manutencao'];

const CLINICAL_PIPELINES = [
  'dermatologia-clinica',
  'tricologia',
  'cirurgia',
  'unhas',
  'podologia',
  'inflamatorias',
  'dermatopediatria',
  'administrativo',
  'reativacao',
] as const;

type PipelineSlug = typeof CLINICAL_PIPELINES[number] | 'all';

const STAGE_LABELS: Record<string, string> = {
  'novo-lead': 'Novo lead',
  qualificado: 'Qualificado',
  'horario-oferecido': 'Horário oferecido',
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  atendido: 'Compareceu',
  reagendado: 'Reagendado',
  perdido: 'Perdido',
  'alta-manutencao': 'Alta / manutenção',
};

const STAGE_COLORS: Record<string, string> = {
  'novo-lead': 'var(--info)',
  qualificado: 'var(--ai)',
  'horario-oferecido': 'var(--warning)',
  agendado: 'var(--accent)',
  confirmado: 'var(--ok)',
  atendido: 'var(--ok)',
  reagendado: 'var(--warning)',
  perdido: 'var(--danger)',
  'alta-manutencao': 'var(--text-3)',
};

const stageLabel = (stage: string) => STAGE_LABELS[stage] ?? stage;

const scoreClass = (score: number) => (
  score >= 80 ? 'chip-danger' : score >= 55 ? 'chip-warning' : 'chip-ok'
);

// Temperatura real dos dados: coluna Lead.temperature (HOT/WARM/COLD) quando
// preenchida, senão as tags canônicas LEAD_QUENTE/LEAD_FRIO do classifier.
type Temp = 'quente' | 'morno' | 'frio';

const leadTemp = (lead: PipelineLead): Temp | null => {
  if (lead.temperature === 'HOT' || lead.tags.includes('LEAD_QUENTE')) return 'quente';
  if (lead.temperature === 'WARM') return 'morno';
  if (lead.temperature === 'COLD' || lead.tags.includes('LEAD_FRIO')) return 'frio';
  return null;
};

const TEMP_LABELS: Record<Temp, string> = { quente: 'Quente', morno: 'Morno', frio: 'Frio' };
const TEMP_CLASSES: Record<Temp, string> = { quente: 'temp-hot', morno: 'temp-warm', frio: 'temp-cold' };

const pipelineLabel = (slug: string | null) => {
  if (!slug) return 'Sem especialidade';
  return slug.charAt(0).toUpperCase() + slug.slice(1).replace('-', ' ');
};

const pipelineChipStyle = (slug: string) => {
  let hue = 0;
  for (let i = 0; i < slug.length; i += 1) hue = (hue * 31 + slug.charCodeAt(i)) % 360;
  return {
    background: `hsl(${hue} 50% 95%)`,
    borderColor: `hsl(${hue} 42% 82%)`,
    color: `hsl(${hue} 55% 30%)`,
  };
};

const formatDate = (value: string | null | undefined) => (
  value ? new Date(value).toLocaleDateString('pt-BR') : '—'
);

const TAG_CLASSES: Record<string, string> = {
  LEAD_QUENTE: 'chip-danger',
  LEAD_FRIO: 'chip-info',
  NOVO: '',
  AGENDAR: 'chip-info',
  FOLLOW_UP: 'chip-warning',
  NO_SHOW: 'chip-danger',
  VIP: 'chip-ai',
  HUMANO: 'chip-ok',
};

const TagChip = ({ tag }: { tag: string }) => (
  <span className={`chip ${TAG_CLASSES[tag] ?? ''}`}>{tag}</span>
);

const StalledBadge = ({ days }: { days: number }) => (
  <span className="chip chip-warning stalled-badge" title="Sem movimentação de estágio">
    <Clock3 size={11} aria-hidden="true" /> Parado há {days}d
  </span>
);

const StageSelect = ({
  value,
  onChange,
  className,
  label,
}: {
  value: string;
  onChange: (stage: string) => void;
  className: string;
  label: string;
}) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    onClick={(e) => e.stopPropagation()}
    className={className}
    aria-label={label}
  >
    {STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
  </select>
);

const LeadCard = ({
  lead,
  onStageChange,
  onClick,
}: {
  lead: PipelineLead;
  onStageChange: (id: string, stage: string) => void;
  onClick: (lead: PipelineLead) => void;
}) => {
  const temp = leadTemp(lead);
  // status:/pipeline: são redundantes no card (a coluna e o chip de especialidade já mostram)
  const visibleTags = lead.tags.filter((t) => !t.startsWith('status:') && !t.startsWith('pipeline:'));
  return (
    <article className={`lead-card ${lead.isStalled ? 'lead-card-stalled' : ''}`} onClick={() => onClick(lead)}>
      <div className="card-head">
        <span className="lead-name">{lead.name?.firstName || '(sem nome)'} {lead.name?.lastName || ''}</span>
        <span className="card-head-actions">
          <a
            className="icon-btn"
            href={`/inbox?lead=${lead.id}`}
            title="Abrir conversa no inbox"
            aria-label="Abrir conversa no inbox"
            onClick={(e) => e.stopPropagation()}
          >
            <MessageCircle size={14} />
          </a>
          <span className={`chip ${scoreClass(lead.score)}`}>{lead.score}</span>
        </span>
      </div>
      {lead.whatsapp?.primaryPhoneNumber && (
        <div className="faint">{lead.whatsapp.primaryPhoneNumber}</div>
      )}
      <div className="lead-card-meta">
        {temp && <span className={`temp ${TEMP_CLASSES[temp]}`}>{TEMP_LABELS[temp]}</span>}
        {lead.pipeline ? (
          <span className="chip" style={pipelineChipStyle(lead.pipeline)}>{pipelineLabel(lead.pipeline)}</span>
        ) : null}
        {lead.nextFollowUpAt ? (
          <span className="faint" title="Próximo follow-up">
            <CalendarClock size={11} style={{ verticalAlign: '-1px', marginRight: '3px' }} />
            {formatDate(lead.nextFollowUpAt)}
          </span>
        ) : null}
      </div>
      {lead.isStalled ? (
        <div className="chips"><StalledBadge days={lead.daysInStage} /></div>
      ) : null}
      {lead.stage === 'perdido' && lead.lostReason ? (
        <div className="chips"><span className="chip chip-danger">{lossLabel(lead.lostReason)}</span></div>
      ) : null}
      {visibleTags.length > 0 ? (
        <div className="chips">
          {visibleTags.slice(0, 4).map((tag) => <TagChip key={tag} tag={tag} />)}
          {visibleTags.length > 4 && <span className="faint">+{visibleTags.length - 4}</span>}
        </div>
      ) : null}
      <StageSelect
        value={lead.stage}
        onChange={(stage) => onStageChange(lead.id, stage)}
        className="select stage-select"
        label="Mover para etapa"
      />
    </article>
  );
};

// Filtros da timeline: chips por grupo de tipo (toggle, 'all' default).
const TIMELINE_FILTERS: Array<{ value: string; label: string; types: TimelineItem['type'][] }> = [
  { value: 'moves', label: 'Movimentos', types: ['stage_change', 'pipeline_change'] },
  { value: 'tawany', label: 'Tawany', types: ['suggestion'] },
  { value: 'notes', label: 'Notas', types: ['note'] },
  { value: 'tasks', label: 'Tarefas', types: ['task'] },
  { value: 'appointments', label: 'Agenda', types: ['appointment'] },
  { value: 'messages', label: 'Mensagens', types: ['messages'] },
];

const LeadDrawer = ({
  lead,
  onClose,
  onStageChange,
}: {
  lead: PipelineLead | null;
  onClose: () => void;
  onStageChange: (id: string, stage: string) => void;
}) => {
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineFilter, setTimelineFilter] = useState('all');
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const leadId = lead?.id ?? null;

  const loadTimeline = useCallback(async (id: string) => {
    setTimelineLoading(true);
    try {
      setTimeline(await api.getLeadTimeline(id));
    } finally {
      setTimelineLoading(false);
    }
  }, []);

  useEffect(() => {
    setTimeline([]);
    setTimelineFilter('all');
    setNote('');
    if (!leadId) return;
    loadTimeline(leadId);
  }, [leadId, loadTimeline]);

  if (!lead) return null;
  const temp = leadTemp(lead);

  const activeFilter = TIMELINE_FILTERS.find((f) => f.value === timelineFilter);
  const visibleTimeline = activeFilter
    ? timeline.filter((item) => activeFilter.types.includes(item.type))
    : timeline;

  const submitNote = async () => {
    const body = note.trim();
    if (!body || !leadId) return;
    setSavingNote(true);
    try {
      await api.addLeadNote(leadId, body);
      setNote('');
      await loadTimeline(leadId);
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div
      className="drawer-root"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
    >
      <div className="drawer-backdrop" />
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2 id="drawer-title">
            {lead.name?.firstName || '(sem nome)'} {lead.name?.lastName || ''}
          </h2>
          <button onClick={onClose} className="icon-btn" type="button" aria-label="Fechar">
            <X size={17} />
          </button>
        </header>

        <div className="drawer-body">
          <div className="chips">
            <span className={`chip ${scoreClass(lead.score)}`}>Score {lead.score}</span>
            {temp && <span className={`temp ${TEMP_CLASSES[temp]}`}>{TEMP_LABELS[temp]}</span>}
            {lead.pipeline && (
              <span className="chip" style={pipelineChipStyle(lead.pipeline)}>{pipelineLabel(lead.pipeline)}</span>
            )}
            {lead.isStalled && <StalledBadge days={lead.daysInStage} />}
          </div>

          <section className="drawer-section">
            <h3>Contato</h3>
            <dl className="kv">
              <div>
                <dt>WhatsApp</dt>
                <dd>{lead.whatsapp?.primaryPhoneNumber || '—'}</dd>
              </div>
              <div>
                <dt>E-mail</dt>
                <dd>{lead.email?.primaryEmail || '—'}</dd>
              </div>
            </dl>
          </section>

          <section className="drawer-section">
            <h3>Origem e Intenção</h3>
            <dl className="kv">
              <div>
                <dt>Origem</dt>
                <dd>{lead.source || '—'}</dd>
              </div>
              <div>
                <dt>Intenção</dt>
                <dd>{lead.intent || '—'}</dd>
              </div>
            </dl>
          </section>

          <section className="drawer-section">
            <h3>Etapa do Funil</h3>
            <StageSelect
              value={lead.stage}
              onChange={(stage) => onStageChange(lead.id, stage)}
              className="select"
              label="Etapa do funil"
            />
            <dl className="kv">
              <div>
                <dt>No estágio há</dt>
                <dd>{lead.daysInStage} {lead.daysInStage === 1 ? 'dia' : 'dias'}</dd>
              </div>
              {lead.stage === 'perdido' && lead.lostReason ? (
                <div>
                  <dt>Motivo de perda</dt>
                  <dd>{lossLabel(lead.lostReason)}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className="drawer-section">
            <h3>Atividades</h3>
            <div className="chips tl-filter">
              <button
                type="button"
                className={`chip chip-toggle ${timelineFilter === 'all' ? 'chip-toggle-active' : ''}`}
                onClick={() => setTimelineFilter('all')}
                aria-pressed={timelineFilter === 'all'}
              >
                Tudo
              </button>
              {TIMELINE_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  className={`chip chip-toggle ${timelineFilter === f.value ? 'chip-toggle-active' : ''}`}
                  onClick={() => setTimelineFilter(timelineFilter === f.value ? 'all' : f.value)}
                  aria-pressed={timelineFilter === f.value}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="note-form">
              <textarea
                className="textarea"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Adicionar nota ao histórico…"
                aria-label="Adicionar nota"
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={savingNote || !note.trim()}
                onClick={submitNote}
              >
                {savingNote ? 'Salvando…' : 'Adicionar nota'}
              </button>
            </div>

            {timelineLoading ? (
              <span className="faint">Carregando…</span>
            ) : (
              <ActivityTimeline
                items={visibleTimeline}
                emptyText={timelineFilter === 'all' ? 'Sem atividades registradas' : 'Nada nesse filtro'}
              />
            )}
          </section>

          <section className="drawer-section">
            <h3>Tags</h3>
            <div className="chips">
              {lead.tags.length === 0 ? (
                <span className="faint">Sem tags</span>
              ) : (
                lead.tags.map((tag) => <TagChip key={tag} tag={tag} />)
              )}
            </div>
          </section>

          {lead.notes && (
            <section className="drawer-section">
              <h3>Observações</h3>
              <div className="note-box">{lead.notes}</div>
            </section>
          )}

          <section className="drawer-section">
            <h3>Follow-ups</h3>
            <dl className="kv">
              <div>
                <dt>Último</dt>
                <dd>{formatDate(lead.lastFollowUpAt)}</dd>
              </div>
              <div>
                <dt>Próximo</dt>
                <dd>{formatDate(lead.nextFollowUpAt)}</dd>
              </div>
            </dl>
          </section>
        </div>
      </aside>
    </div>
  );
};

// Modal de motivo de perda: mover para "Perdido" exige um motivo canônico;
// a observação opcional vai na activity, não vira tag.
const LossReasonModal = ({
  lead,
  onConfirm,
  onCancel,
}: {
  lead: PipelineLead;
  onConfirm: (lostReason: string, note: string) => void;
  onCancel: () => void;
}) => {
  const [reason, setReason] = useState<string>(lead.lostReason ?? '');
  const [note, setNote] = useState('');

  return (
    <div className="modal-root" role="dialog" aria-modal="true" aria-labelledby="loss-modal-title" onClick={onCancel}>
      <div className="modal-backdrop" />
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2 id="loss-modal-title">Marcar como perdido</h2>
          <span className="muted">
            {lead.name?.firstName || '(sem nome)'} — informe o motivo da perda
          </span>
        </header>

        <div className="radio-list" role="radiogroup" aria-label="Motivo de perda">
          {LOSS_REASONS.map((option) => (
            <label key={option.value} className="radio-item">
              <input
                type="radio"
                name="lostReason"
                value={option.value}
                checked={reason === option.value}
                onChange={() => setReason(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>

        <label className="field">
          <span className="muted">Observação (opcional)</span>
          <textarea
            className="textarea"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ex.: vai pensar e retorna mês que vem"
          />
        </label>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>Cancelar</button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={!reason}
            onClick={() => reason && onConfirm(reason, note.trim())}
          >
            Confirmar perda
          </button>
        </div>
      </div>
    </div>
  );
};

function PipelineBoard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [selectedLead, setSelectedLead] = useState<PipelineLead | null>(null);
  const [lossTarget, setLossTarget] = useState<PipelineLead | null>(null);
  const [expandedTerminals, setExpandedTerminals] = useState<Set<Stage>>(new Set());
  const [loading, setLoading] = useState(false);

  // Filtros vivem na URL (compartilháveis). 'all' / ausente = sem filtro.
  const rawPipeline = searchParams.get('pipeline');
  const selectedPipeline: PipelineSlug =
    rawPipeline && (CLINICAL_PIPELINES as readonly string[]).includes(rawPipeline)
      ? (rawPipeline as PipelineSlug)
      : 'all';
  const origemFilter = searchParams.get('origem') ?? 'all';
  const rawTemp = searchParams.get('temp');
  const tempFilter: Temp | 'all' =
    rawTemp === 'quente' || rawTemp === 'morno' || rawTemp === 'frio' ? rawTemp : 'all';
  const onlyStalled = searchParams.get('parados') === '1';

  const setParam = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === 'all') params.delete(key);
    else params.set(key, value);
    const text = params.toString();
    router.replace(`/pipeline${text ? `?${text}` : ''}`, { scroll: false });
  }, [router, searchParams]);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getPipelineLeads(selectedPipeline);
      setLeads(data);
    } finally {
      setLoading(false);
    }
  }, [selectedPipeline]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  // Deep link ?lead=<id> (usado pela agenda): abre o drawer do lead ao
  // carregar. O ref evita reabrir a cada reload de leads (ex.: após mover).
  const deepLinkLead = searchParams.get('lead');
  const openedLeadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!deepLinkLead || leads.length === 0 || openedLeadRef.current === deepLinkLead) return;
    const target = leads.find((l) => l.id === deepLinkLead);
    if (target) {
      openedLeadRef.current = deepLinkLead;
      setSelectedLead(target);
    }
  }, [deepLinkLead, leads]);

  const closeDrawer = useCallback(() => {
    setSelectedLead(null);
    openedLeadRef.current = null;
    if (deepLinkLead) setParam('lead', null);
  }, [deepLinkLead, setParam]);

  const doMove = useCallback(async (
    lead: PipelineLead,
    stage: string,
    extra: { lostReason?: string; note?: string } = {},
  ) => {
    await api.moveLead(lead.id, stage, { pipeline: lead.pipeline || undefined, ...extra });
    setSelectedLead(null);
    loadLeads();
  }, [loadLeads]);

  // Mover para "perdido" abre o modal de motivo; cancelar aborta (o select é
  // controlado pelo estado, então o card volta sozinho ao estágio anterior).
  const handleStageChange = useCallback((leadId: string, stage: string) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage === stage) return;
    if (stage === 'perdido') {
      setLossTarget(lead);
      return;
    }
    doMove(lead, stage);
  }, [leads, doMove]);

  const origemOptions = useMemo(() => {
    const sources = Array.from(new Set(leads.map((l) => l.source).filter((s): s is string => Boolean(s)))).sort();
    return [
      { value: 'all', label: 'Todas as origens' },
      ...sources.map((s) => ({ value: s, label: s })),
    ];
  }, [leads]);

  const filteredLeads = leads.filter((lead) => (
    (selectedPipeline === 'all' || lead.pipeline === selectedPipeline)
    && (origemFilter === 'all' || lead.source === origemFilter)
    && (tempFilter === 'all' || leadTemp(lead) === tempFilter)
    && (!onlyStalled || lead.isStalled)
  ));

  const stalledCount = filteredLeads.filter((l) => l.isStalled).length;

  const toggleTerminal = (stage: Stage) => {
    setExpandedTerminals((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  };

  return (
    <main className="page page-wide page-tight">
      <div className="toolbar">
        <div>
          <h1 className="title">Pipeline Clínico</h1>
          <div className="muted">
            {loading ? 'Carregando…' : `${filteredLeads.length} leads`}
            {selectedPipeline !== 'all' && <span> · {pipelineLabel(selectedPipeline)}</span>}
            {stalledCount > 0 && !loading && <span> · {stalledCount} parados</span>}
          </div>
        </div>
        <div className="toolbar-right">
          <FilterMenu
            label="Especialidade"
            ariaLabel="Especialidades"
            value={selectedPipeline}
            onChange={(v) => setParam('pipeline', v)}
            options={[
              { value: 'all', label: 'Todas as especialidades' },
              ...CLINICAL_PIPELINES.map((p) => ({ value: p, label: pipelineLabel(p) })),
            ]}
          />
          <FilterMenu
            label="Origem"
            ariaLabel="Origens"
            value={origemFilter}
            onChange={(v) => setParam('origem', v)}
            options={origemOptions}
          />
          <FilterMenu
            label="Temperatura"
            ariaLabel="Temperaturas"
            value={tempFilter}
            onChange={(v) => setParam('temp', v)}
            options={[
              { value: 'all', label: 'Todas as temperaturas' },
              { value: 'quente', label: 'Quente' },
              { value: 'morno', label: 'Morno' },
              { value: 'frio', label: 'Frio' },
            ]}
          />
          <button
            type="button"
            className={`btn ${onlyStalled ? 'btn-filter-active' : ''}`}
            aria-pressed={onlyStalled}
            onClick={() => setParam('parados', onlyStalled ? null : '1')}
            title="Mostrar só leads parados no estágio"
          >
            <Flame size={15} /> Só parados
          </button>
          <button className="btn" type="button" onClick={loadLeads} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> Atualizar
          </button>
        </div>
      </div>

      <section className="kanban" aria-label="Kanban de leads">
        {STAGES.map((stage) => {
          const stageLeads = filteredLeads.filter((l) => l.stage === stage);
          const isTerminal = TERMINAL_STAGES.includes(stage);
          const collapsed = isTerminal && !expandedTerminals.has(stage);

          if (collapsed) {
            return (
              <button
                key={stage}
                type="button"
                className="column column-collapsed"
                onClick={() => toggleTerminal(stage)}
                aria-expanded={false}
                title={`Expandir ${stageLabel(stage)}`}
              >
                <span className="stage-dot" style={{ background: STAGE_COLORS[stage] }} aria-hidden="true" />
                <span className="column-collapsed-label">{stageLabel(stage)}</span>
                <span className="count-badge">{stageLeads.length}</span>
              </button>
            );
          }

          return (
            <div className={`column ${isTerminal ? 'column-terminal' : ''}`} key={stage}>
              <h2 className="column-title">
                <span>
                  <span className="stage-dot" style={{ background: STAGE_COLORS[stage] }} aria-hidden="true" />
                  {stageLabel(stage)}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span className="count-badge">{stageLeads.length}</span>
                  {isTerminal && (
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm"
                      onClick={() => toggleTerminal(stage)}
                      aria-label={`Recolher ${stageLabel(stage)}`}
                    >
                      <X size={13} />
                    </button>
                  )}
                </span>
              </h2>
              <div className="column-body">
                {stageLeads.length === 0 ? <div className="column-empty">Sem leads nesta etapa</div> : null}
                {stageLeads.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    onStageChange={handleStageChange}
                    onClick={setSelectedLead}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <LeadDrawer lead={selectedLead} onClose={closeDrawer} onStageChange={handleStageChange} />

      {lossTarget && (
        <LossReasonModal
          lead={lossTarget}
          onCancel={() => setLossTarget(null)}
          onConfirm={(lostReason, note) => {
            const target = lossTarget;
            setLossTarget(null);
            doMove(target, 'perdido', { lostReason, ...(note ? { note } : {}) });
          }}
        />
      )}
    </main>
  );
}

export default function PipelinePage() {
  // useSearchParams exige Suspense no App Router (build estático).
  return (
    <Suspense fallback={null}>
      <PipelineBoard />
    </Suspense>
  );
}
