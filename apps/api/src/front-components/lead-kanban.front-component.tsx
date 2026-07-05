import { useEffect, useState } from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';
import { createDataApi } from 'src/lib/data';
import { LEAD_KANBAN_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

// Must mirror the lead object's stage SELECT option values exactly (src/objects/lead.object.ts)
const STAGES = ['NOVO', 'QUALIFICADO', 'AGENDADO', 'COMPARECEU', 'PERDIDO', 'CONVERTIDO'] as const;

type LeadRow = {
  id: string;
  name: { firstName: string; lastName: string } | null;
  stage: string;
  score: number;
  whatsapp: { primaryPhoneNumber: string | null } | null;
};

const leadDisplayName = (lead: LeadRow): string =>
  lead.name ? `${lead.name.firstName} ${lead.name.lastName}`.trim() : '(sem nome)';

// ponytail: thresholds casam com a faixa ambígua do scorer (45-65). <40 cold,
// 40-65 warm, >65 hot. Mantém o chip legível em qualquer tema.
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

const LeadCard = ({ lead, onStageChange }: { lead: LeadRow; onStageChange: (id: string, stage: string) => void }) => (
  <div
    style={{
      background: '#fff', border: '1px solid #e0e0e0', borderRadius: '6px',
      padding: '10px', marginBottom: '8px', fontSize: '13px',
    }}
  >
    <strong>{leadDisplayName(lead)}</strong>
    <div style={{ fontSize: '12px', color: '#777' }}>{lead.whatsapp?.primaryPhoneNumber ?? ''}</div>
    <div style={{ fontSize: '12px', marginTop: '2px' }}><ScoreChip score={lead.score} /></div>
    <select
      value={lead.stage}
      onChange={(e) => onStageChange(lead.id, e.target.value)}
      style={{ marginTop: '6px', width: '100%' }}
    >
      {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  </div>
);

const KanbanColumn = ({
  stage, leads, onStageChange,
}: { stage: string; leads: LeadRow[]; onStageChange: (id: string, stage: string) => void }) => (
  <div style={{ background: '#f5f5f5', borderRadius: '8px', padding: '10px', overflowY: 'auto' }}>
    <h2 style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#777', margin: '0 0 8px' }}>
      {stage}
    </h2>
    {leads.filter((l) => l.stage === stage).map((l) => (
      <LeadCard key={l.id} lead={l} onStageChange={onStageChange} />
    ))}
  </div>
);

export const LeadKanban = () => {
  const [leads, setLeads] = useState<LeadRow[]>([]);

  const load = async (): Promise<void> => {
    try {
      const l = (await createDataApi().list('lead', {
        orderBy: { score: 'DESC' },
        select: { id: true, name: { firstName: true, lastName: true }, stage: true, score: true, whatsapp: { primaryPhoneNumber: true } },
      })) as LeadRow[];
      setLeads(l);
    } catch (err) {
      console.error('LeadKanban: failed to load leads', err);
    }
  };

  useEffect(() => { void load(); }, []);

  const changeStage = async (id: string, stage: string): Promise<void> => {
    await createDataApi().update('lead', id, { stage });
    await load();
  };

  return (
    <div style={{ fontFamily: 'sans-serif', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <h1 style={{ fontSize: '18px', margin: '8px 12px' }}>Funil de leads</h1>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGES.length}, 1fr)`, gap: '12px', padding: '0 12px 12px', flex: 1, minHeight: 0 }}>
        {STAGES.map((stage) => (
          <KanbanColumn key={stage} stage={stage} leads={leads} onStageChange={(id, s) => void changeStage(id, s)} />
        ))}
      </div>
    </div>
  );
};

export default defineFrontComponent({
  universalIdentifier: LEAD_KANBAN_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'lead-kanban',
  description: 'Funil de leads por etapa com mudança de stage via dropdown',
  component: LeadKanban,
});
