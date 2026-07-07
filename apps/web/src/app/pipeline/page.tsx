'use client';

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Filter, ChevronDown } from 'lucide-react';
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

const scoreClass = (score: number) => (
  score >= 80 ? 'chip-danger' : score >= 55 ? 'chip-warning' : 'chip-ok'
);

const temperatureLabel = (value: string | null | undefined) => (
  value === 'HOT' ? 'Quente' : value === 'WARM' ? 'Morno' : value === 'COLD' ? 'Frio' : '—'
);

const pipelineLabel = (slug: string | null) => {
  if (!slug) return 'Sem especialidade';
  return slug.charAt(0).toUpperCase() + slug.slice(1).replace('-', ' ');
};

const formatDate = (value: string | null | undefined) => (
  value ? new Date(value).toLocaleDateString('pt-BR') : '—'
);

const tagColors: Record<string, string> = {
  LEAD_QUENTE: 'bg-orange-500',
  LEAD_FRIO: 'bg-blue-500',
  NOVO: 'bg-cyan-500',
  AGENDAR: 'bg-purple-500',
  FOLLOW_UP: 'bg-yellow-500',
  NO_SHOW: 'bg-red-500',
  VIP: 'bg-pink-500',
  HUMANO: 'bg-green-500',
};

const TagChip = ({ tag }: { tag: string }) => (
  <span key={tag} className={`chip text-xs ${tagColors[tag] || 'bg-gray-500'}`}>
    {tag}
  </span>
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
  <article
    className="lead-card cursor-pointer hover:shadow-md transition-shadow"
    onClick={() => onClick(lead)}
  >
    <div className="card-head">
      <span className="lead-name">{lead.name?.firstName || '(sem nome)'} {lead.name?.lastName || ''}</span>
      <span className={`chip ${scoreClass(lead.score)}`}>{lead.score}</span>
    </div>
    {lead.whatsapp?.primaryPhoneNumber && (
      <div className="muted text-xs">{lead.whatsapp.primaryPhoneNumber}</div>
    )}
    <div className="chips text-xs" style={{ marginTop: '4px' }}>
      {lead.tags.slice(0, 4).map((tag) => <TagChip key={tag} tag={tag} />)}
      {lead.tags.length > 4 && <span className="muted">+{lead.tags.length - 4}</span>}
    </div>
    <select
      value={lead.stage}
      onChange={(e) => {
        e.stopPropagation();
        onStageChange(lead.id, e.target.value);
      }}
      className="stage-select"
      style={{ marginTop: '8px', width: '100%', padding: '4px', fontSize: '12px' }}
    >
      {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
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
      className="fixed inset-0 z-50 flex"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
    >
      <div className="absolute inset-0 bg-black/30" />
      <aside className="relative w-full max-w-md bg-white h-full flex flex-col shadow-xl overflow-hidden">
        <header className="p-4 border-b flex justify-between items-center">
          <h2 id="drawer-title" className="text-lg font-semibold">
            {lead.name?.firstName || '(sem nome)'} {lead.name?.lastName || ''}
          </h2>
          <button onClick={onClose} className="text-2xl leading-none hover:text-gray-600" aria-label="Fechar">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <div className="flex flex-wrap gap-2">
            <span className={`chip ${scoreClass(lead.score)}`}>{lead.score}</span>
            {lead.temperature && (
              <span className={`chip ${lead.temperature === 'HOT' ? 'chip-danger' : lead.temperature === 'WARM' ? 'chip-warning' : 'chip-ok'}`}>
                {temperatureLabel(lead.temperature)}
              </span>
            )}
            {lead.pipeline && (
              <span className="chip bg-blue-500">{pipelineLabel(lead.pipeline)}</span>
            )}
          </div>

          <section>
            <h3 className="font-medium text-sm mb-2">Contato</h3>
            <dl className="space-y-1 text-sm text-gray-600">
              <div className="flex justify-between">
                <dt>WhatsApp</dt>
                <dd className="font-medium">{lead.whatsapp?.primaryPhoneNumber || '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt>E-mail</dt>
                <dd className="font-medium">{lead.email?.primaryEmail || '—'}</dd>
              </div>
            </dl>
          </section>

          <section>
            <h3 className="font-medium text-sm mb-2">Origem e Intenção</h3>
            <dl className="space-y-1 text-sm text-gray-600">
              <div className="flex justify-between">
                <dt>Origem</dt>
                <dd className="font-medium">{lead.source || '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Intenção</dt>
                <dd className="font-medium">{lead.intent || '—'}</dd>
              </div>
            </dl>
          </section>

          <section>
            <h3 className="font-medium text-sm mb-2">Etapa do Funil</h3>
            <select
              value={lead.stage}
              onChange={(e) => onStageChange(lead.id, e.target.value)}
              className="w-full p-2 border rounded text-sm"
            >
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </section>

          <section>
            <h3 className="font-medium text-sm mb-2">Tags</h3>
            <div className="flex flex-wrap gap-2">
              {lead.tags.length === 0 ? (
                <span className="muted text-sm">Sem tags</span>
              ) : (
                lead.tags.map((tag) => <TagChip key={tag} tag={tag} />)
              )}
            </div>
          </section>

          {lead.notes && (
            <section>
              <h3 className="font-medium text-sm mb-2">Observações</h3>
              <div className="p-3 bg-gray-50 rounded text-sm text-gray-700 whitespace-pre-wrap">
                {lead.notes}
              </div>
            </section>
          )}

          <section>
            <h3 className="font-medium text-sm mb-2">Follow-ups</h3>
            <dl className="space-y-1 text-sm text-gray-600">
              <div className="flex justify-between">
                <dt>Último</dt>
                <dd className="font-medium">{formatDate(lead.lastFollowUpAt)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Próximo</dt>
                <dd className="font-medium">{formatDate(lead.nextFollowUpAt)}</dd>
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
    <main className="page page-wide">
      <div className="toolbar">
        <div>
          <h1 className="title">Pipeline Clínico</h1>
          <div className="muted">
            {loading ? 'Carregando...' : `${filteredLeads.length} leads`}
            {selectedPipeline !== 'all' && <span> | {pipelineLabel(selectedPipeline)}</span>}
          </div>
        </div>
        <div className="toolbar-right">
          <PipelineFilter
            selectedPipeline={selectedPipeline}
            onChange={setSelectedPipeline}
            pipelines={pipelines}
          />
          <button className="btn" type="button" onClick={loadLeads} disabled={loading}>
            <RefreshCw size={17} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>
      </div>

      <section className="kanban" style={{ minHeight: 'calc(100vh - 200px)' }}>
        {STAGES.map((stage) => (
          <div className="column" key={stage}>
            <h2 className="column-title">
              <span>{stage}</span>
              <span>{filteredLeads.filter(l => l.stage === stage).length}</span>
            </h2>
            {filteredLeads.filter(l => l.stage === stage).map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                onStageChange={handleStageChange}
                onClick={setSelectedLead}
              />
            ))}
          </div>
        ))}
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
    <div className="relative" style={{ minWidth: '200px' }}>
      <button
        type="button"
        className="btn flex items-center gap-2"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Filter size={16} />
        <span>
          {allOptions.find((o) => o.value === selectedPipeline)?.label || 'Todas'}
        </span>
        <ChevronDown size={14} className={open ? 'rotate-180' : ''} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 bg-white border rounded shadow-lg min-w-[220px] max-h-60 overflow-auto">
            {allOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`w-full px-4 py-2 text-left ${selectedPipeline === opt.value ? 'bg-blue-50 text-blue-700' : ''}`}
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