'use client';

import { useEffect, useState, useCallback } from 'react';
import { CalendarClock, ChevronDown, Filter, RefreshCw, X } from 'lucide-react';
import { api, type PipelineLead, type Pipeline } from '@/lib/api';

const STAGES = ['NOVO', 'QUALIFICADO', 'AGENDADO', 'COMPARECEU', 'PERDIDO', 'CONVERTIDO'] as const;

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
  NOVO: 'Novo',
  QUALIFICADO: 'Qualificado',
  AGENDADO: 'Agendado',
  COMPARECEU: 'Compareceu',
  PERDIDO: 'Perdido',
  CONVERTIDO: 'Convertido',
};

const STAGE_COLORS: Record<string, string> = {
  NOVO: 'var(--info)',
  QUALIFICADO: 'var(--ai)',
  AGENDADO: 'var(--warning)',
  COMPARECEU: 'var(--ok)',
  PERDIDO: 'var(--danger)',
  CONVERTIDO: 'var(--accent)',
};

const stageLabel = (stage: string) => STAGE_LABELS[stage] ?? stage;

const scoreClass = (score: number) => (
  score >= 80 ? 'chip-danger' : score >= 55 ? 'chip-warning' : 'chip-ok'
);

const temperatureLabel = (value: string | null | undefined) => (
  value === 'HOT' ? 'Quente' : value === 'WARM' ? 'Morno' : value === 'COLD' ? 'Frio' : '—'
);

const temperatureClass = (value: string | null | undefined) => (
  value === 'HOT' ? 'temp-hot' : value === 'WARM' ? 'temp-warm' : value === 'COLD' ? 'temp-cold' : 'temp-none'
);

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

const LeadCard = ({
  lead,
  onStageChange,
  onClick,
}: {
  lead: PipelineLead;
  onStageChange: (id: string, stage: string) => void;
  onClick: (lead: PipelineLead) => void;
}) => (
  <article className="lead-card" onClick={() => onClick(lead)}>
    <div className="card-head">
      <span className="lead-name">{lead.name?.firstName || '(sem nome)'} {lead.name?.lastName || ''}</span>
      <span className={`chip ${scoreClass(lead.score)}`}>{lead.score}</span>
    </div>
    {lead.whatsapp?.primaryPhoneNumber && (
      <div className="faint">{lead.whatsapp.primaryPhoneNumber}</div>
    )}
    <div className="lead-card-meta">
      <span className={`temp ${temperatureClass(lead.temperature)}`}>{temperatureLabel(lead.temperature)}</span>
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
    {lead.tags.length > 0 ? (
      <div className="chips">
        {lead.tags.slice(0, 4).map((tag) => <TagChip key={tag} tag={tag} />)}
        {lead.tags.length > 4 && <span className="faint">+{lead.tags.length - 4}</span>}
      </div>
    ) : null}
    <select
      value={lead.stage}
      onChange={(e) => {
        e.stopPropagation();
        onStageChange(lead.id, e.target.value);
      }}
      onClick={(e) => e.stopPropagation()}
      className="select stage-select"
      aria-label="Mover para etapa"
    >
      {STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
    </select>
  </article>
);

const LeadDrawer = ({
  lead,
  onClose,
  onStageChange,
}: {
  lead: PipelineLead | null;
  onClose: () => void;
  onStageChange: (id: string, stage: string) => void;
}) => {
  if (!lead) return null;

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
            {lead.temperature && (
              <span className={`temp ${temperatureClass(lead.temperature)}`}>{temperatureLabel(lead.temperature)}</span>
            )}
            {lead.pipeline && (
              <span className="chip" style={pipelineChipStyle(lead.pipeline)}>{pipelineLabel(lead.pipeline)}</span>
            )}
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
            <select
              value={lead.stage}
              onChange={(e) => onStageChange(lead.id, e.target.value)}
              className="select"
              aria-label="Etapa do funil"
            >
              {STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
            </select>
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

export default function PipelinePage() {
  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<PipelineSlug>('all');
  const [selectedLead, setSelectedLead] = useState<PipelineLead | null>(null);
  const [loading, setLoading] = useState(false);

  const loadPipelines = useCallback(async () => {
    const data = await api.getPipelines();
    setPipelines(data);
  }, []);

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
    loadPipelines();
  }, [loadPipelines]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  const handleStageChange = async (leadId: string, stage: string) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;

    await api.moveLead(leadId, stage, lead.pipeline || undefined);
    loadLeads();
  };

  const filteredLeads = leads.filter(l => selectedPipeline === 'all' || l.pipeline === selectedPipeline);

  return (
    <main className="page page-wide page-tight">
      <div className="toolbar">
        <div>
          <h1 className="title">Pipeline Clínico</h1>
          <div className="muted">
            {loading ? 'Carregando…' : `${filteredLeads.length} leads`}
            {selectedPipeline !== 'all' && <span> · {pipelineLabel(selectedPipeline)}</span>}
          </div>
        </div>
        <div className="toolbar-right">
          <PipelineFilter
            selectedPipeline={selectedPipeline}
            onChange={setSelectedPipeline}
            pipelines={pipelines}
          />
          <button className="btn" type="button" onClick={loadLeads} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> Atualizar
          </button>
        </div>
      </div>

      <section className="kanban" aria-label="Kanban de leads">
        {STAGES.map((stage) => {
          const stageLeads = filteredLeads.filter(l => l.stage === stage);
          return (
            <div className="column" key={stage}>
              <h2 className="column-title">
                <span>
                  <span className="stage-dot" style={{ background: STAGE_COLORS[stage] }} aria-hidden="true" />
                  {stageLabel(stage)}
                </span>
                <span className="count-badge">{stageLeads.length}</span>
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

      <LeadDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} onStageChange={handleStageChange} />
    </main>
  );
}

function PipelineFilter({
  selectedPipeline,
  onChange,
  pipelines,
}: {
  selectedPipeline: PipelineSlug;
  onChange: (p: PipelineSlug) => void;
  pipelines: Pipeline[];
}) {
  const [open, setOpen] = useState(false);

  const allOptions = [
    { value: 'all', label: 'Todas as especialidades' },
    ...CLINICAL_PIPELINES.map((p) => ({
      value: p,
      label: p.charAt(0).toUpperCase() + p.slice(1).replace('-', ' '),
    })),
  ];

  return (
    <div className="menu-anchor">
      <button
        type="button"
        className="btn"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Filter size={15} />
        <span>
          {allOptions.find((o) => o.value === selectedPipeline)?.label || 'Todas'}
        </span>
        <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 150ms' }} />
      </button>

      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu" role="listbox" aria-label="Especialidades">
            {allOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`menu-item ${selectedPipeline === opt.value ? 'menu-item-active' : ''}`}
                onClick={() => { onChange(opt.value as PipelineSlug); setOpen(false); }}
                role="option"
                aria-selected={selectedPipeline === opt.value}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
