'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, BarChart3, Bot, Copy, FlaskConical, History, Pencil, Plus, Trash2, Upload, X, Zap } from 'lucide-react';
import { api, type BotAction, type BotMetrics, type BotSummary, type BotVersion } from '@/lib/api';
import { BotEditor, type EditorBot } from './bot-editor';

// Modal de histórico de versões: quando, quem e "Reverter para esta".
function HistoryModal({ bot, onClose, onReverted }: {
  bot: BotSummary;
  onClose: () => void;
  onReverted: (message: string) => void;
}) {
  const [versions, setVersions] = useState<BotVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [reverting, setReverting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api.getBotVersions(bot.id)
      .then((rows) => { if (alive) setVersions(rows); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [bot.id]);

  const revert = async (version: BotVersion) => {
    const label = version.name ?? bot.name;
    if (!window.confirm(`Reverter "${bot.name}" para a versão "${label}" de ${new Date(version.at).toLocaleString('pt-BR')}? A versão atual será guardada no histórico.`)) {
      return;
    }
    setReverting(true);
    setError('');
    try {
      const res = await api.revertBot(bot.id, version.id);
      if (res.success) {
        onReverted(`Fluxo "${bot.name}" revertido para a versão de ${new Date(version.at).toLocaleString('pt-BR')}.`);
      } else {
        setError(res.error ?? 'Falha ao reverter.');
      }
    } finally {
      setReverting(false);
    }
  };

  return (
    <div className="modal-root" role="dialog" aria-modal="true" aria-labelledby="bot-history-title" onClick={onClose}>
      <div className="modal-backdrop" />
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2 id="bot-history-title">Histórico de versões</h2>
          <span className="muted">{bot.name} — cada salvamento guarda a versão anterior</span>
        </header>

        {error ? <p className="error">{error}</p> : null}
        {loading ? <div className="muted">Carregando…</div> : null}
        {!loading && versions.length === 0 ? (
          <div className="muted">Nenhuma versão anterior ainda. Edite e salve o fluxo para criar a primeira.</div>
        ) : null}
        {!loading && versions.length > 0 ? (
          <ul className="history-list">
            {versions.map((version) => (
              <li key={version.id} className="history-item">
                <span className="history-move">
                  {version.name ?? '(sem nome)'} · {version.rules} regra{version.rules === 1 ? '' : 's'}
                </span>
                <span className="muted">
                  {new Date(version.at).toLocaleString('pt-BR')}{version.byName ? ` — por ${version.byName}` : ''}
                </span>
                <button
                  className="btn"
                  type="button"
                  disabled={reverting}
                  style={{ justifySelf: 'start', marginTop: '4px' }}
                  onClick={() => revert(version)}
                >
                  <History size={13} />Reverter para esta
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose}><X size={14} />Fechar</button>
        </div>
      </div>
    </div>
  );
}

const ACTION_LABEL: Record<BotAction, string> = {
  reply: 'respondeu',
  handoff: 'encaminhou p/ humano',
  tawany: 'deixou com a Tawany',
};

export default function BotsPage() {
  const [bots, setBots] = useState<BotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [testText, setTestText] = useState('');
  const [testResult, setTestResult] = useState<{ matched: boolean; botName?: string; responses: string[] } | null>(null);
  const [testing, setTesting] = useState(false);
  const [editor, setEditor] = useState<EditorBot | null>(null);
  const [riskTerms, setRiskTerms] = useState<string[]>([]);
  const [historyBot, setHistoryBot] = useState<BotSummary | null>(null);
  const [metrics, setMetrics] = useState<BotMetrics | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const [list, usage] = await Promise.all([api.getBots(), api.getBotMetrics()]);
      setBots(list);
      setMetrics(usage);
    } finally {
      setLoading(false);
    }
  };

  // Reordena a disputa first-match: troca com o vizinho e persiste a ordem
  // completa (idempotente — cada clique envia a lista inteira).
  const move = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= bots.length) return;
    const next = [...bots];
    [next[index], next[target]] = [next[target], next[index]];
    setBots(next);
    const res = await api.reorderBots(next.map((b) => b.id));
    if (!res.success) {
      flash(res.error ?? 'Falha ao reordenar.');
      await reload();
    }
  };

  useEffect(() => {
    void reload();
    void api.getBotRiskTerms().then(setRiskTerms);
  }, []);

  const flash = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(''), 5000);
  };

  const toggle = async (bot: BotSummary) => {
    await api.toggleBot(bot.id, !bot.active);
    await reload();
  };

  const importFile = async (file: File) => {
    try {
      const flow = JSON.parse(await file.text());
      const res = await api.importBot(flow, file.name);
      if (res.success && res.data) {
        flash(`Fluxo "${res.data.name}" ${res.data.replaced ? 'atualizado' : 'importado'} com ${res.data.rules} regras.`);
        await reload();
      } else {
        flash(res.error ?? 'Falha ao importar');
      }
    } catch {
      flash('Arquivo inválido: esperado JSON exportado do construtor de fluxo.');
    }
  };

  const runTest = async () => {
    if (!testText.trim()) return;
    setTesting(true);
    try {
      const res = await api.testBot(testText.trim());
      setTestResult(res.data ?? { matched: false, responses: [] });
    } finally {
      setTesting(false);
    }
  };

  const openEdit = async (bot: BotSummary) => {
    const detail = await api.getBot(bot.id);
    if (!detail) {
      flash('Não foi possível carregar o fluxo para edição.');
      return;
    }
    setEditor({ id: detail.id, name: detail.name, rules: detail.rules });
  };

  const duplicate = async (bot: BotSummary) => {
    const res = await api.duplicateBot(bot.id);
    if (res.success && res.data) {
      flash(`Fluxo duplicado como "${res.data.name}" (pausado).`);
      await reload();
    } else {
      flash(res.error ?? 'Falha ao duplicar.');
    }
  };

  return (
    <main className="page">
      <div className="toolbar">
        <div>
          <h1 className="title">Bots</h1>
          <div className="muted">Fluxos automáticos deterministas — respondem antes da Tawany.</div>
        </div>
        <div className="toolbar-right">
          <input
            accept="application/json"
            hidden
            ref={fileInput}
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
              event.target.value = '';
            }}
          />
          <button className="btn" type="button" onClick={() => fileInput.current?.click()}>
            <Upload size={15} />Importar JSON
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => setEditor({ id: null, name: '', rules: [] })}
          >
            <Plus size={15} />Novo bot
          </button>
        </div>
      </div>

      {feedback ? <div className="flash" role="status" style={{ marginBottom: '12px' }}>{feedback}</div> : null}

      <section className="list">
        {loading ? <div className="card muted">Carregando…</div> : null}
        {!loading && bots.length === 0 ? (
          <div className="card muted">Nenhum fluxo importado ainda. Importe um JSON do construtor de fluxo para começar.</div>
        ) : null}
        {bots.map((bot) => (
          <article className="card" key={bot.id}>
            <div className="bot-card-head">
              <div className="bot-id">
                <span className="bot-mark" aria-hidden="true"><Bot size={18} /></span>
                <div>
                  <div className="lead-name">{bot.name}</div>
                  <div className="muted">Atualizado {new Date(bot.updatedAt).toLocaleString('pt-BR')}</div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={bot.active}
                aria-label={bot.active ? `Pausar fluxo ${bot.name}` : `Ativar fluxo ${bot.name}`}
                className="switch-row"
                onClick={() => toggle(bot)}
              >
                <span className="switch" aria-hidden="true"><span className="switch-thumb" /></span>
                {bot.active ? 'Ativo' : 'Pausado'}
              </button>
            </div>
            <div className="bot-foot">
              <div className="chips">
                <span className="chip chip-info"><Zap size={11} />gatilho: {bot.trigger}</span>
                <span className="chip">{bot.rules} regras</span>
                <span className={`chip ${bot.active ? 'chip-ok' : 'chip-warning'}`}>{bot.active ? 'ativo' : 'pausado'}</span>
                {(() => {
                  const usage = metrics?.counts.find((c) => c.botId === bot.id);
                  return usage ? (
                    <span className="chip chip-ai" title="Disparos nos últimos 7 / 30 dias">
                      <BarChart3 size={11} />{usage.d7} (7d) · {usage.d30} (30d)
                    </span>
                  ) : null;
                })()}
              </div>
              <div className="toolbar-right">
                <button
                  className="btn"
                  type="button"
                  aria-label={`Subir prioridade de ${bot.name}`}
                  title="Disputa first-match: mais acima responde primeiro"
                  disabled={bots.indexOf(bot) === 0}
                  onClick={() => move(bots.indexOf(bot), -1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  className="btn"
                  type="button"
                  aria-label={`Descer prioridade de ${bot.name}`}
                  disabled={bots.indexOf(bot) === bots.length - 1}
                  onClick={() => move(bots.indexOf(bot), 1)}
                >
                  <ArrowDown size={14} />
                </button>
                <button className="btn" type="button" onClick={() => openEdit(bot)}>
                  <Pencil size={14} />Editar
                </button>
                <button className="btn" type="button" onClick={() => duplicate(bot)}>
                  <Copy size={14} />Duplicar
                </button>
                <button className="btn" type="button" onClick={() => setHistoryBot(bot)}>
                  <History size={14} />Histórico
                </button>
                <button
                  className="btn btn-danger"
                  type="button"
                  onClick={async () => {
                    if (window.confirm(`Excluir o fluxo "${bot.name}"?`)) {
                      await api.fetch(`/bots/${bot.id}`, { method: 'DELETE' });
                      await reload();
                    }
                  }}
                >
                  <Trash2 size={15} />Excluir
                </button>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className="card" style={{ marginTop: '16px', display: 'grid', gap: '8px' }}>
        <h2 className="section-title"><FlaskConical size={16} />Testar mensagem</h2>
        <p className="muted" style={{ margin: 0 }}>Simule uma mensagem recebida e veja qual fluxo responderia (nada é enviado).</p>
        <div className="inline-form" style={{ marginTop: '2px' }}>
          <input
            className="input"
            placeholder="Ex.: Olá, gostaria de agendar uma consulta com o Dr. Diego Galvez"
            value={testText}
            onChange={(event) => setTestText(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && runTest()}
          />
          <button className="btn btn-primary" disabled={testing} type="button" onClick={runTest}>
            {testing ? 'Testando…' : 'Testar'}
          </button>
        </div>
        {testResult ? (
          testResult.matched ? (
            <div className="panel-block" style={{ marginTop: '6px' }}>
              <div className="chips"><span className="chip chip-ok">match: {testResult.botName}</span></div>
              {testResult.responses.map((response, index) => (
                <article className="message-bubble message-out" key={index} style={{ alignSelf: 'flex-start' }}>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{response}</div>
                </article>
              ))}
            </div>
          ) : (
            <div className="muted">Nenhum fluxo casou — a mensagem seguiria para a Tawany.</div>
          )
        ) : null}
      </section>

      {metrics && metrics.recent.length > 0 ? (
        <section className="card" style={{ marginTop: '16px', display: 'grid', gap: '8px' }}>
          <h2 className="section-title"><BarChart3 size={16} />Últimos disparos</h2>
          <ul className="history-list">
            {metrics.recent.map((entry, index) => (
              <li className="history-item" key={`${entry.conversationId}-${entry.createdAt}-${index}`}>
                <span className="history-move">
                  {entry.botName} — {ACTION_LABEL[entry.action] ?? entry.action} (regra {entry.ruleIndex + 1})
                </span>
                <span className="muted">
                  {new Date(entry.createdAt).toLocaleString('pt-BR')} ·{' '}
                  <a href={`/inbox?conversationId=${entry.conversationId}`}>abrir conversa</a>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {editor ? (
        <BotEditor
          bot={editor}
          riskTerms={riskTerms}
          onClose={() => setEditor(null)}
          onSaved={async (message) => {
            setEditor(null);
            flash(message);
            await reload();
          }}
        />
      ) : null}

      {historyBot ? (
        <HistoryModal
          bot={historyBot}
          onClose={() => setHistoryBot(null)}
          onReverted={async (message) => {
            setHistoryBot(null);
            flash(message);
            await reload();
          }}
        />
      ) : null}
    </main>
  );
}
