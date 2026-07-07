'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpenText, Check, Clock3, Info, Save } from 'lucide-react';
import { api, type KnowledgeSection } from '@/lib/api';

const formatDate = (value: string | null | undefined) => (
  value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'
);

export default function KnowledgeSettingsPage() {
  const [sections, setSections] = useState<KnowledgeSection[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingSlug, setSavingSlug] = useState<string | null>(null);
  const [savedSlug, setSavedSlug] = useState<string | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getKnowledgeSections();
      setSections(data);
      setDrafts(Object.fromEntries(data.map((s) => [s.slug, s.content])));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = async (section: KnowledgeSection) => {
    const content = drafts[section.slug] ?? '';
    if (!content.trim()) {
      setError('O conteúdo não pode ficar vazio.');
      return;
    }
    setError('');
    setSavingSlug(section.slug);
    try {
      const res = await api.updateKnowledgeSection(section.slug, { content });
      if (!res.success) {
        setError(res.error ?? 'Falha ao salvar.');
        return;
      }
      setSavedSlug(section.slug);
      window.setTimeout(() => setSavedSlug((cur) => (cur === section.slug ? null : cur)), 4000);
      await reload();
    } finally {
      setSavingSlug(null);
    }
  };

  return (
    <main className="page">
      <div className="toolbar">
        <div>
          <h1 className="title-large">Base de conhecimento</h1>
          <div className="muted">
            O que a Tawany sabe sobre a clínica: valores, unidades, regras de atendimento. Editável, sem deploy.
          </div>
        </div>
      </div>

      <div className="test-banner" role="note">
        <Info size={15} />
        Alterações valem na próxima mensagem da Tawany (até 60s de cache).
      </div>

      {error ? <div className="flash" role="alert">{error}</div> : null}
      {loading ? <div className="card muted">Carregando seções…</div> : null}
      {!loading && sections.length === 0 ? (
        <div className="card">
          <strong>Nenhuma seção no banco.</strong>
          <div className="muted">
            A Tawany está usando o prompt embutido (fallback). Rode <code>pnpm db:seed:knowledge</code> na API
            para tornar o conhecimento editável aqui.
          </div>
        </div>
      ) : null}

      <div className="knowledge-list">
        {sections.map((section) => {
          const dirty = (drafts[section.slug] ?? '') !== section.content;
          return (
            <details className="knowledge-section" key={section.slug}>
              <summary>
                <span className="knowledge-summary-title">
                  <BookOpenText size={15} />
                  {section.title}
                </span>
                <span className="knowledge-summary-meta">
                  {dirty ? <span className="chip chip-warning">Não salvo</span> : null}
                  {savedSlug === section.slug ? <span className="chip chip-ok"><Check size={11} />Salvo</span> : null}
                  <span className="faint knowledge-updated">
                    <Clock3 size={11} /> {formatDate(section.updatedAt)}
                    {section.updatedByName ? ` · ${section.updatedByName}` : ' · seed'}
                  </span>
                </span>
              </summary>
              <div className="knowledge-editor">
                <textarea
                  className="textarea textarea-mono"
                  value={drafts[section.slug] ?? ''}
                  onChange={(event) => setDrafts((cur) => ({ ...cur, [section.slug]: event.target.value }))}
                  rows={18}
                  spellCheck={false}
                  aria-label={`Conteúdo da seção ${section.title}`}
                />
                <div className="suggestion-actions">
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={savingSlug === section.slug || !dirty}
                    onClick={() => save(section)}
                  >
                    <Save size={15} />
                    {savingSlug === section.slug ? 'Salvando…' : 'Salvar seção'}
                  </button>
                  {dirty ? (
                    <button
                      className="btn"
                      type="button"
                      onClick={() => setDrafts((cur) => ({ ...cur, [section.slug]: section.content }))}
                    >
                      Descartar mudanças
                    </button>
                  ) : null}
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </main>
  );
}
