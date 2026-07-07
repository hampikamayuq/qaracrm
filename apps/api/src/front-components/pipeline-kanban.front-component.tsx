import { useEffect, useState, useCallback, useRef } from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';
import { createDataApi } from 'src/lib/data';
import { PIPELINE_KANBAN_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

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

type PipelineSlug = typeof CLINICAL_PIPELINES[number];

const STAGES = ['NOVO', 'QUALIFICADO', 'AGENDADO', 'COMPARECEU', 'PERDIDO', 'CONVERTIDO'] as const;

type LeadRow = {
  id: string;
  name: { firstName: string; lastName: string } | null;
  stage: string;
  score: number;
  whatsapp: { primaryPhoneNumber: string | null } | null;
  email: { primaryEmail: string | null } | null;
  source: string | null;
  intent: string | null;
  tags: string[];
  temperature: string | null;
  pipeline: string | null;
  notes: string | null;
  lastFollowUpAt: string | null;
  nextFollowUpAt: string | null;
  position: number;
};

const leadDisplayName = (lead: LeadRow): string =>
  lead.name ? `${lead.name.firstName} ${lead.name.lastName}`.trim() : '(sem nome)';

const scoreChipColor = (score: number): string => {
  if (score < 40) return '#c62828';
  if (score <= 65) return '#f9a825';
  return '#2e7d32';
};

const ScoreChip = ({ score }: { score: number }) => (
  <span
    style={{
      display: 'inline-block',
      background: scoreChipColor(score),
      color: '#fff',
      fontSize: '11px',
      fontWeight: 600,
      padding: '2px 6px',
      borderRadius: '4px',
    }}
  >
    {score}
  </span>
);

const CANONICAL_TAG_COLORS: Record<string, string> = {
  LEAD_QUENTE: '#ff9800',
  LEAD_FRIO: '#2196f3',
  NOVO: '#00bcd4',
  AGENDAR: '#9c27b0',
  FOLLOW_UP: '#ffeb3b',
  NO_SHOW: '#f44336',
  VIP: '#e91e63',
  HUMANO: '#4caf50',
};

const CONTEXTUAL_TAG_COLORS: Record<string, string> = {
  'alerta:urgente': '#b71c1c',
  'alerta:lgpd': '#4a148c',
  'alerta:reclamacao': '#bf360c',
  'alerta:duvida_medica': '#0d47a1',
  'pipeline:unhas': '#e91e63',
  'pipeline:cirurgia': '#f44336',
  'pipeline:tricologia': '#9c27b0',
  'pipeline:inflamatorias': '#ff9800',
  'pipeline:dermatopediatria': '#00bcd4',
  'pipeline:dermatologia-clinica': '#2196f3',
  'pipeline:podologia': '#795548',
  'pipeline:administrativo': '#607d8b',
  'pipeline:reativacao': '#4caf50',
  'origem:site': '#3f51b5',
  'origem:instagram': '#e91e63',
  'origem:indicacao': '#4caf50',
  'origem:google': '#ff9800',
  'origem:meta_ads': '#673ab7',
  'origem:outro': '#9e9e9e',
};

const TagChip = ({ tag, onRemove }: { tag: string; onRemove?: () => void }) => {
  const isCanonical = Object.keys(CANONICAL_TAG_COLORS).includes(tag);
  const bg = isCanonical ? CANONICAL_TAG_COLORS[tag] : CONTEXTUAL_TAG_COLORS[tag] || '#757575';
  return (
    <span
      key={tag}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: bg,
        color: '#fff',
        fontSize: '10px',
        fontWeight: 600,
        padding: '1px 6px',
        borderRadius: '3px',
        marginRight: '4px',
        marginBottom: '4px',
        gap: '4px',
      }}
    >
      {tag}
      {onRemove && (
        <button
          onClick={onRemove}
          style={{
            background: 'rgba(0,0,0,0.2)',
            border: 'none',
            color: '#fff',
            fontSize: '10px',
            lineHeight: 1,
            padding: '0 4px',
            borderRadius: '2px',
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      )}
    </span>
  );
};

const PipelineFilter = ({ selectedPipeline, onChange }: { selectedPipeline: PipelineSlug | 'all'; onChange: (p: PipelineSlug | 'all') => void }) => (
  <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
    <label style={{ fontSize: '12px', fontWeight: 600 }}>Especialidade:</label>
    <select
      value={selectedPipeline}
      onChange={(e) => onChange(e.target.value as PipelineSlug | 'all')}
      style={{ padding: '6px 10px', fontSize: '13px', borderRadius: '4px', border: '1px solid #ddd', minWidth: '220px' }}
    >
      <option value="all">Todas as especialidades</option>
      {CLINICAL_PIPELINES.map((p) => (
        <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1).replace('-', ' ')}</option>
      ))}
    </select>
  </div>
);

const LeadCard = ({
  lead,
  onStageChange,
  onClick,
  isDragging,
}: {
  lead: LeadRow;
  onStageChange: (id: string, stage: string) => void;
  onClick: (lead: LeadRow) => void;
  isDragging: boolean;
}) => (
  <div
    draggable={true}
    onClick={() => onClick(lead)}
    onDragStart={(e) => {
      e.dataTransfer.setData('text/plain', lead.id);
      e.dataTransfer.effectAllowed = 'move';
    }}
    onDragEnd={() => {}}
    style={{
      background: '#fff',
      border: isDragging ? '#1976d2' : '#e0e0e0',
      borderWidth: isDragging ? '2px' : '1px',
      borderRadius: '6px',
      padding: '10px',
      marginBottom: '8px',
      fontSize: '13px',
      cursor: 'grab',
      opacity: isDragging ? 0.5 : 1,
      transition: 'all 0.2s',
    }}
  >
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <strong style={{ flex: 1 }}>{leadDisplayName(lead)}</strong>
      <ScoreChip score={lead.score} />
    </div>
    <div style={{ fontSize: '11px', color: '#777', marginTop: '2px' }}>📱 {lead.whatsapp?.primaryPhoneNumber ?? ''}</div>
    <div style={{ fontSize: '11px', color: '#777' }}>✉️ {lead.email?.primaryEmail ?? ''}</div>
    <div style={{ fontSize: '11px', marginTop: '4px' }}>
      {lead.tags.slice(0, 3).map((tag) => <TagChip key={tag} tag={tag} />)}
      {lead.tags.length > 3 && <span style={{ fontSize: '10px', color: '#999' }}>+{lead.tags.length - 3}</span>}
    </div>
    <select
      value={lead.stage}
      onChange={(e) => {
        e.stopPropagation();
        onStageChange(lead.id, e.target.value);
      }}
      style={{ marginTop: '6px', width: '100%', fontSize: '12px', padding: '4px' }}
    >
      {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  </div>
);

const KanbanColumn = ({
  stage,
  leads,
  onStageChange,
  onLeadClick,
  draggedLeadId,
  onReorder,
}: {
  stage: string;
  leads: LeadRow[];
  onStageChange: (id: string, stage: string) => void;
  onLeadClick: (lead: LeadRow) => void;
  draggedLeadId: string | null;
  onReorder: (leadId: string, newPosition: number) => void;
}) => {
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('text/plain');
    if (!leadId || leadId === draggedLeadId) return;

    const targetLead = leads.find((l) => l.id === leadId);
    const draggedLead = leads.find((l) => l.id === draggedLeadId);

    if (targetLead && draggedLead) {
      if (targetLead.id === draggedLeadId) return;
      
      const targetIndex = leads.indexOf(targetLead);
      const draggedIndex = leads.indexOf(draggedLead);
      
      if (targetIndex !== draggedIndex) {
        onReorder(draggedLeadId, targetIndex);
      }
    } else if (!targetLead && draggedLead && draggedLead.stage !== stage) {
      onStageChange(draggedLeadId, stage);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{ background: '#f5f5f5', borderRadius: '8px', padding: '10px', minHeight: '200px', overflowY: 'auto' }}
    >
      <h2 style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#777', margin: '0 0 8px', display: 'flex', justifyContent: 'space-between' }}>
        <span>{stage}</span>
        <span style={{ background: '#fff', padding: '2px 8px', borderRadius: '10px', fontSize: '11px' }}>{leads.length}</span>
      </h2>
      {leads.map((lead) => (
        <LeadCard
          key={lead.id}
          lead={lead}
          onStageChange={onStageChange}
          onClick={onLeadClick}
          isDragging={lead.id === draggedLeadId}
        />
      ))}
      {leads.length === 0 && <div style={{ textAlign: 'center', color: '#999', padding: '20px', fontSize: '12px' }}>Arraste leads aqui</div>}
    </div>
  );
};

const ALL_CANONICAL_TAGS = [
  { value: 'LEAD_QUENTE', label: 'Lead Quente', color: 'orange', category: 'temperature' },
  { value: 'LEAD_FRIO', label: 'Lead Frio', color: 'blue', category: 'temperature' },
  { value: 'NOVO', label: 'Novo', color: 'turquoise', category: 'status' },
  { value: 'AGENDAR', label: 'Agendar', color: 'purple', category: 'action' },
  { value: 'FOLLOW_UP', label: 'Follow-up', color: 'yellow', category: 'action' },
  { value: 'NO_SHOW', label: 'No-show', color: 'red', category: 'outcome' },
  { value: 'VIP', label: 'VIP', color: 'pink', category: 'priority' },
  { value: 'HUMANO', label: 'Humano', color: 'green', category: 'routing' },
];

const CONTEXTUAL_TAG_CATEGORIES = {
  alerta: ['alerta:urgente', 'alerta:lgpd', 'alerta:reclamacao', 'alerta:duvida_medica'],
  pipeline: ['pipeline:unhas', 'pipeline:cirurgia', 'pipeline:tricologia', 'pipeline:inflamatorias', 'pipeline:dermatopediatria', 'pipeline:dermatologia-clinica', 'pipeline:podologia', 'pipeline:administrativo', 'pipeline:reativacao'],
  origem: ['origem:site', 'origem:instagram', 'origem:indicacao', 'origem:google', 'origem:meta_ads', 'origem:outro'],
} as const;

const LeadDrawer = ({
  lead,
  onClose,
  onStageChange,
  onAddTag,
  onRemoveTag,
}: {
  lead: LeadRow | null;
  onClose: () => void;
  onStageChange: (id: string, stage: string) => void;
  onAddTag: (leadId: string, tag: string) => void;
  onRemoveTag: (leadId: string, tag: string) => void;
}) => {
  if (!lead) return null;

  const formatDate = (date: string | null) => (date ? new Date(date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const [selectedCategory, setSelectedCategory] = useState<'canonical' | 'alerta' | 'pipeline' | 'origem'>('canonical');
  const [newTagInput, setNewTagInput] = useState('');

  const getTagsByCategory = (category: string) => {
    if (category === 'canonical') return ALL_CANONICAL_TAGS.map((t) => t.value);
    return CONTEXTUAL_TAG_CATEGORIES[category as keyof typeof CONTEXTUAL_TAG_CATEGORIES] || [];
  };

  const availableTags = getTagsByCategory(selectedCategory).filter((t) => !lead.tags.includes(t));

  const handleAddCanonicalTag = (tag: string) => {
    onAddTag(lead.id, tag);
  };

  const handleRemoveTag = (tag: string) => {
    onRemoveTag(lead.id, tag);
  };

  const handleAddCustomTag = async (e: React.FormEvent) => {
    e.preventDefault();
    const tag = newTagInput.trim().toUpperCase().replace(/\s+/g, '_');
    if (tag) {
      onAddTag(lead.id, tag);
      setNewTagInput('');
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: '420px',
        height: '100vh',
        background: '#fff',
        boxShadow: '-4px 0 20px rgba(0,0,0,0.15)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      <div style={{ padding: '16px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '18px' }}>{leadDisplayName(lead)}</h2>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', lineHeight: 1 }}>✕</button>
      </div>

      <div style={{ padding: '16px', flex: 1 }}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <ScoreChip score={lead.score} />
          {lead.temperature && (
            <span style={{ background: lead.temperature === 'HOT' ? '#c62828' : lead.temperature === 'WARM' ? '#f9a825' : '#2e7d32', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
              {lead.temperature}
            </span>
          )}
          {lead.pipeline && (
            <span style={{ background: '#1976d2', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
              {lead.pipeline.charAt(0).toUpperCase() + lead.pipeline.slice(1).replace('-', ' ')}
            </span>
          )}
        </div>

        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 8px', color: '#333' }}>Contato</h3>
          <div style={{ fontSize: '13px', color: '#555', lineHeight: '1.8' }}>
            <div>📱 {lead.whatsapp?.primaryPhoneNumber ?? '—'}</div>
            <div>✉️ {lead.email?.primaryEmail ?? '—'}</div>
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 8px', color: '#333' }}>Detalhes</h3>
          <dl style={{ margin: 0, fontSize: '13px', lineHeight: '2' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><dt style={{ color: '#777' }}>Origem</dt><dd style={{ margin: 0, textAlign: 'right' }}>{lead.source ?? '—'}</dd></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><dt style={{ color: '#777' }}>Intenção</dt><dd style={{ margin: 0, textAlign: 'right' }}>{lead.intent ?? '—'}</dd></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><dt style={{ color: '#777' }}>Etapa</dt><dd style={{ margin: 0, textAlign: 'right' }}>{lead.stage}</dd></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><dt style={{ color: '#777' }}>Último follow-up</dt><dd style={{ margin: 0, textAlign: 'right' }}>{formatDate(lead.lastFollowUpAt)}</dd></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><dt style={{ color: '#777' }}>Próximo follow-up</dt><dd style={{ margin: 0, textAlign: 'right' }}>{formatDate(lead.nextFollowUpAt)}</dd></div>
          </dl>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 8px', color: '#333' }}>Tags</h3>
          
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', flexWrap: 'wrap' }}>
              {['canonical', 'alerta', 'pipeline', 'origem'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat as 'canonical' | 'alerta' | 'pipeline' | 'origem')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    borderRadius: '4px',
                    border: '1px solid',
                    background: selectedCategory === cat ? '#1976d2' : '#fff',
                    color: selectedCategory === cat ? '#fff' : '#333',
                    borderColor: selectedCategory === cat ? '#1976d2' : '#ddd',
                    cursor: 'pointer',
                  }}
                >
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxHeight: '120px', overflowY: 'auto', padding: '8px', background: '#fafafa', borderRadius: '4px', border: '1px solid #eee' }}>
              {availableTags.map((tag) => (
                <TagChip key={tag} tag={tag} onRemove={() => handleAddCanonicalTag(tag)} />
              ))}
              {availableTags.length === 0 && <span style={{ color: '#999', fontSize: '12px' }}>Todas as tags desta categoria já estão aplicadas</span>}
            </div>
          </div>

          <div style={{ marginTop: '12px' }}>
            <h4 style={{ fontSize: '12px', fontWeight: 600, margin: '0 0 8px', color: '#333' }}>Tags atuais</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {lead.tags.length === 0 ? <span style={{ color: '#999', fontSize: '12px' }}>Sem tags</span> : lead.tags.map((tag) => (
                <TagChip key={tag} tag={tag} onRemove={() => handleRemoveTag(tag)} />
              ))}
            </div>
          </div>

          <form onSubmit={handleAddCustomTag} style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={newTagInput}
              onChange={(e) => setNewTagInput(e.target.value)}
              placeholder="Nova tag (ex: URGENTE, PROMOCAO...)"
              style={{ flex: 1, padding: '8px', fontSize: '12px', borderRadius: '4px', border: '1px solid #ddd' }}
            />
            <button type="submit" style={{ padding: '8px 12px', fontSize: '12px', borderRadius: '4px', border: 'none', background: '#1976d2', color: '#fff', cursor: 'pointer' }}>
              Adicionar
            </button>
          </form>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 8px', color: '#333' }}>Observações</h3>
          <div style={{ fontSize: '13px', color: '#555', whiteSpace: 'pre-wrap', minHeight: '60px', background: '#fafafa', padding: '12px', borderRadius: '4px' }}>
            {lead.notes ?? '—'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', paddingTop: '16px', borderTop: '1px solid #eee' }}>
          <select
            value={lead.stage}
            onChange={(e) => onStageChange(lead.id, e.target.value)}
            style={{ flex: 1, padding: '8px', fontSize: '13px', borderRadius: '4px', border: '1px solid #ddd' }}
          >
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button
            style={{
              padding: '8px 16px',
              fontSize: '13px',
              borderRadius: '4px',
              border: 'none',
              background: '#4caf50',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
};

export const PipelineKanban = () => {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<PipelineSlug | 'all'>('all');
  const [selectedLead, setSelectedLead] = useState<LeadRow | null>(null);
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const api = createDataApi();
      const filter: Record<string, unknown> = {};
      if (selectedPipeline !== 'all') {
        filter.pipeline = { eq: selectedPipeline };
      }
      const l = (await api.list('lead', {
        filter,
        orderBy: { stage: 'ASC', position: 'ASC', score: 'DESC' },
        select: {
          id: true,
          name: { firstName: true, lastName: true },
          stage: true,
          score: true,
          whatsapp: { primaryPhoneNumber: true },
          email: { primaryEmail: true },
          source: true,
          intent: true,
          tags: true,
          temperature: true,
          pipeline: true,
          notes: true,
          lastFollowUpAt: true,
          nextFollowUpAt: true,
          position: true,
        },
      })) as LeadRow[];
      setLeads(l);
    } catch (err) {
      console.error('PipelineKanban: failed to load leads', err);
    } finally {
      setLoading(false);
    }
  }, [selectedPipeline]);

  useEffect(() => { void load(); }, [load]);

  const changeStage = async (id: string, stage: string) => {
    await createDataApi().update('lead', id, { stage });
    await load();
  };

  const reorderLead = async (leadId: string, newPosition: number) => {
    const allLeadsInStage = leads.filter((l) => l.stage === leads.find((l) => l.id === leadId)?.stage);
    const updates = allLeadsInStage.map((l, index) => ({
      id: l.id,
      position: l.id === leadId ? newPosition : index,
    }));
    for (const update of updates) {
      await createDataApi().update('lead', update.id, { position: update.position });
    }
    await load();
  };

  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    setDraggedLeadId(leadId);
    e.dataTransfer.setData('text/plain', leadId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedLeadId(null);
  };

  const handleAddTag = async (leadId: string, tag: string) => {
    const api = createDataApi();
    const lead = await api.get('lead', leadId, { tags: true });
    if (!lead) return;
    const currentTags = Array.isArray(lead.tags) ? lead.tags.filter((t): t is string => typeof t === 'string') : [];
    if (!currentTags.includes(tag)) {
      await api.update('lead', leadId, { tags: [...currentTags, tag] });
      await load();
    }
  };

  const handleRemoveTag = async (leadId: string, tag: string) => {
    const api = createDataApi();
    const lead = await api.get('lead', leadId, { tags: true });
    if (!lead) return;
    const currentTags = Array.isArray(lead.tags) ? lead.tags.filter((t): t is string => typeof t === 'string') : [];
    const updatedTags = currentTags.filter((t) => t !== tag);
    await api.update('lead', leadId, { tags: updatedTags });
    await load();
  };

  const filteredLeads = leads.filter((l) => selectedPipeline === 'all' || l.pipeline === selectedPipeline);

  const leadsByStage = STAGES.reduce((acc, stage) => {
    acc[stage] = filteredLeads.filter((l) => l.stage === stage).sort((a, b) => a.position - b.position);
    return acc;
  }, {} as Record<string, LeadRow[]>);

  return (
    <div style={{ fontFamily: 'sans-serif', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '18px', margin: 0 }}>Pipeline Clínico</h1>
        <PipelineFilter selectedPipeline={selectedPipeline} onChange={setSelectedPipeline} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGES.length}, 1fr)`, gap: '12px', padding: '0 12px 12px', flex: 1, minHeight: 0 }}>
        {STAGES.map((stage) => (
          <KanbanColumn
            key={stage}
            stage={stage}
            leads={leadsByStage[stage] || []}
            onStageChange={changeStage}
            onLeadClick={setSelectedLead}
            draggedLeadId={draggedLeadId}
            onReorder={reorderLead}
          />
        ))}
      </div>

      {selectedLead && (
        <LeadDrawer
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onStageChange={changeStage}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
        />
      )}

      <div
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          background: loading ? '#1976d2' : '#4caf50',
          color: '#fff',
          padding: '10px 16px',
          borderRadius: '20px',
          fontSize: '13px',
          fontWeight: 500,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 100,
        }}
      >
        {loading ? '⟳ Carregando...' : `${leads.length} leads`}
      </div>
    </div>
  );
};

export default defineFrontComponent({
  universalIdentifier: PIPELINE_KANBAN_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'pipeline-kanban',
  description: 'Pipeline clínico dermatológico com 9 especialidades, drag-and-drop persistente, drawer rico e sistema de tags padrão',
  component: PipelineKanban,
});