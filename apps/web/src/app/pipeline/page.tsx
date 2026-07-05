'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api, type PipelineStage } from '@/lib/api';

const scoreClass = (score: number) => (
  score >= 80 ? 'chip-danger' : score >= 55 ? 'chip-warning' : 'chip-ok'
);

export default function PipelinePage() {
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    api.getPipeline().then(setStages).finally(() => setLoading(false));
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="page page-wide">
      <div className="toolbar">
        <div>
          <h1 className="title">Pipeline</h1>
          <div className="muted">{loading ? 'Carregando' : `${stages.length} etapas`}</div>
        </div>
        <button className="btn" type="button" onClick={() => void load()}><RefreshCw size={17} />Atualizar</button>
      </div>

      <section className="kanban">
        {stages.length === 0 && !loading ? <div className="card muted">Nenhuma etapa encontrada.</div> : null}
        {stages.map((stage) => (
          <div className="column" key={stage.id}>
            <h2 className="column-title"><span>{stage.name}</span><span>{stage.leads.length}</span></h2>
            {stage.leads.map((lead) => (
              <article className="lead-card" key={lead.id}>
                <div className="card-head">
                  <span className="lead-name">{lead.name}</span>
                  <span className={`chip ${scoreClass(lead.score)}`}>{lead.score}</span>
                </div>
                <div className="chips">
                  {(lead.tags ?? []).slice(0, 4).map((tag) => <span className="chip" key={tag}>{tag}</span>)}
                </div>
              </article>
            ))}
          </div>
        ))}
      </section>
    </main>
  );
}
