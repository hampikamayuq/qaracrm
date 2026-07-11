'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, ExternalLink, MessageSquareText, Plus, Save, Sparkles, ThumbsDown, Trash2 } from 'lucide-react';
import { api, type AiOperationMode, type AiSettings, type ReviewQueueItem, type TawanyExample } from '@/lib/api';

const MODE_OPTIONS: Array<{ value: AiOperationMode; label: string }> = [
  { value: 'shadow', label: 'Shadow — só observa, não envia' },
  { value: 'human_approval', label: 'Aprovação humana — sugere e espera aprovação' },
  { value: 'recomendacoes', label: 'Recomendações — mesmo comportamento de aprovação humana' },
  { value: 'autopilot', label: 'Autopilot — envia sozinha' },
  { value: 'hibrido', label: 'Híbrido — autopilot só nas intents liberadas abaixo' },
];

const formatDate = (value: string | null | undefined) => (
  value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'
);

export default function AiSettingsPage() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [examples, setExamples] = useState<TawanyExample[]>([]);
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [modeDraft, setModeDraft] = useState<AiOperationMode | null>(null);
  const [intentsDraft, setIntentsDraft] = useState('');
  const [savingMode, setSavingMode] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [ai, reviewQueue, activeExamples] = await Promise.all([
        api.getAiSettings(),
        api.getReviewQueue(),
        api.getExamples(),
      ]);
      setSettings(ai);
      setModeDraft(ai?.mode ?? null);
      setIntentsDraft((ai?.autopilotIntents ?? []).join(', '));
      setQueue(reviewQueue);
      setExamples(activeExamples);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const flash = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(''), 4000);
  };

  const saveMode = async () => {
    if (!modeDraft) return;
    setSavingMode(true);
    try {
      const intents = intentsDraft.split(',').map((s) => s.trim()).filter(Boolean);
      const res = await api.updateAiSettings(modeDraft, intents);
      if (!res.success) {
        flash(res.error ?? 'Falha ao salvar modo.');
        return;
      }
      flash('Modo atualizado. Vale a partir da próxima mensagem.');
      await reload();
    } finally {
      setSavingMode(false);
    }
  };

  const toExample = (item: ReviewQueueItem) => {
    setQuestion(item.question ?? '');
    setAnswer(item.feedbackNote ?? item.body);
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  };

  const createExample = async () => {
    if (!question.trim() || !answer.trim()) {
      flash('Preencha pergunta e resposta.');
      return;
    }
    setSaving(true);
    try {
      const res = await api.createExample(question.trim(), answer.trim());
      if (!res.success) {
        flash(res.error ?? 'Falha ao criar exemplo.');
        return;
      }
      setQuestion('');
      setAnswer('');
      flash('Exemplo criado. Entra no prompt da Tawany em até 60s.');
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const removeExample = async (id: string) => {
    const res = await api.deleteExample(id);
    if (res.success) await reload();
  };

  return (
    <main className="page">
      <div className="toolbar">
        <div>
          <h1 className="title-large">Tawany — qualidade das respostas</h1>
          <div className="muted">Fila de revisão dos 👎, exemplos aprovados e modo de operação atual.</div>
        </div>
      </div>

      {feedback ? <div className="flash" role="status">{feedback}</div> : null}

      <div className="ai-mode-row">
        <div className="card ai-mode-card">
          <span className="chip chip-ai"><Bot size={13} />Modo</span>
          <select
            className="select"
            value={modeDraft ?? ''}
            onChange={(event) => setModeDraft(event.target.value as AiOperationMode)}
            aria-label="Modo de operação da Tawany"
          >
            {MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {modeDraft === 'hibrido' ? (
            <label className="field">
              <span>Intents liberadas para autopilot (separadas por vírgula)</span>
              <input
                className="input"
                value={intentsDraft}
                onChange={(event) => setIntentsDraft(event.target.value)}
                placeholder="Ex.: AGENDAMENTO, DUVIDA_HORARIO"
              />
            </label>
          ) : null}
          <div className="suggestion-actions">
            <button className="btn btn-primary" disabled={savingMode} type="button" onClick={saveMode}>
              <Save size={14} />{savingMode ? 'Salvando…' : 'Salvar modo'}
            </button>
          </div>
          <span className="faint">
            Padrão do ambiente (usado só se nunca salvo aqui): SHADOW_MODE={settings?.shadowMode ?? '?'}
          </span>
        </div>
        <div className="card ai-mode-card">
          <span className="chip"><Sparkles size={13} />Prompt</span>
          <strong>Versão {settings?.promptVersion ?? '—'}</strong>
          <span className="faint">TAWANY_PROMPT_VERSION · registrada em cada sugestão</span>
        </div>
      </div>

      <section aria-labelledby="review-queue-title">
        <h2 className="section-title" id="review-queue-title">
          <ThumbsDown size={15} /> Fila de revisão ({queue.length})
        </h2>
        {loading ? <div className="card muted">Carregando…</div> : null}
        {!loading && queue.length === 0 ? (
          <div className="card muted">Nenhuma resposta marcada com 👎. Bom sinal.</div>
        ) : null}
        {queue.map((item) => (
          <article className="card review-card" key={item.id}>
            {item.question ? (
              <div className="review-q"><MessageSquareText size={13} /> Paciente: {item.question}</div>
            ) : null}
            <div className="review-a">Tawany: {item.body}</div>
            {item.feedbackNote ? (
              <div className="review-note">Deveria ter respondido: {item.feedbackNote}</div>
            ) : null}
            <div className="suggestion-actions">
              <button className="btn btn-primary" type="button" onClick={() => toExample(item)}>
                <Plus size={14} />Transformar em exemplo
              </button>
              <a className="btn" href={`/inbox?conversationId=${item.conversationId}`}>
                <ExternalLink size={14} />Abrir conversa
              </a>
              <span className="faint">{formatDate(item.createdAt)}</span>
            </div>
          </article>
        ))}
      </section>

      <section aria-labelledby="examples-title">
        <h2 className="section-title" id="examples-title">
          <Sparkles size={15} /> Exemplos aprovados ({examples.length})
        </h2>
        <div className="muted">
          Injetados no prompt como &quot;Exemplos de boas respostas&quot; (máx. 10, mais recentes primeiro).
        </div>

        <div className="card example-form">
          <label className="field">
            <span>Pergunta do paciente</span>
            <textarea
              className="textarea"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={2}
              placeholder="Ex.: Vocês atendem convênio?"
            />
          </label>
          <label className="field">
            <span>Resposta ideal da Tawany</span>
            <textarea
              className="textarea"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              rows={3}
              placeholder="Ex.: A QARA atende só particular, mas emitimos nota fiscal para reembolso."
            />
          </label>
          <div className="suggestion-actions">
            <button className="btn btn-primary" disabled={saving} type="button" onClick={createExample}>
              <Plus size={14} />{saving ? 'Salvando…' : 'Adicionar exemplo'}
            </button>
          </div>
        </div>

        {examples.map((example) => (
          <article className="card review-card" key={example.id}>
            <div className="review-q"><MessageSquareText size={13} /> Paciente: {example.question}</div>
            <div className="review-a">Tawany: {example.answer}</div>
            <div className="suggestion-actions">
              <button
                className="btn btn-danger"
                type="button"
                aria-label={`Excluir exemplo: ${example.question}`}
                onClick={() => removeExample(example.id)}
              >
                <Trash2 size={14} />Excluir
              </button>
              <span className="faint">{formatDate(example.createdAt)}</span>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
