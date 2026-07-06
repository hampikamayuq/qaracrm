'use client';

import { useEffect, useRef, useState } from 'react';
import { FlaskConical, Pause, Play, Trash2, Upload } from 'lucide-react';
import { api, type BotSummary } from '@/lib/api';

export default function BotsPage() {
  const [bots, setBots] = useState<BotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [testText, setTestText] = useState('');
  const [testResult, setTestResult] = useState<{ matched: boolean; botName?: string; responses: string[] } | null>(null);
  const [testing, setTesting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = async () => {
    setLoading(true);
    try {
      setBots(await api.getBots());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); }, []);

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
      flash('Arquivo invalido: esperado JSON exportado do construtor de fluxo.');
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

  return (
    <main className="page">
      <div className="toolbar">
        <div>
          <h1 className="title">Bots</h1>
          <div className="muted">Fluxos automaticos deterministas — respondem antes da Tawany.</div>
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
          <button className="btn btn-primary" type="button" onClick={() => fileInput.current?.click()}>
            <Upload size={16} />Importar JSON
          </button>
        </div>
      </div>

      {feedback ? <div className="card muted">{feedback}</div> : null}

      <section className="list">
        {loading ? <div className="card muted">Carregando...</div> : null}
        {!loading && bots.length === 0 ? <div className="card muted">Nenhum fluxo importado ainda.</div> : null}
        {bots.map((bot) => (
          <article className="card" key={bot.id}>
            <div className="card-head">
              <div>
                <div className="lead-name">{bot.name}</div>
                <div className="muted">{bot.rules} regras · gatilho: {bot.trigger} · atualizado {new Date(bot.updatedAt).toLocaleString('pt-BR')}</div>
              </div>
              <div className="chips">
                <span className={`chip ${bot.active ? 'chip-ok' : 'chip-warning'}`}>{bot.active ? 'ativo' : 'pausado'}</span>
              </div>
            </div>
            <div className="suggestion-actions">
              <button className="btn" type="button" onClick={() => toggle(bot)}>
                {bot.active ? <><Pause size={15} />Pausar</> : <><Play size={15} />Ativar</>}
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
          </article>
        ))}
      </section>

      <section className="card">
        <h2 className="title"><FlaskConical size={18} /> Testar mensagem</h2>
        <p className="muted">Simule uma mensagem recebida e veja qual fluxo responderia (nada e enviado).</p>
        <div className="inline-form">
          <input
            className="input"
            placeholder="Ex.: Olá, gostaria de agendar uma consulta com o Dr. Diego Galvez"
            value={testText}
            onChange={(event) => setTestText(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && runTest()}
          />
          <button className="btn btn-primary" disabled={testing} type="button" onClick={runTest}>
            {testing ? 'Testando...' : 'Testar'}
          </button>
        </div>
        {testResult ? (
          testResult.matched ? (
            <div className="panel-block">
              <div className="chips"><span className="chip chip-ok">match: {testResult.botName}</span></div>
              {testResult.responses.map((response, index) => (
                <article className="message-bubble message-out" key={index}>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{response}</div>
                </article>
              ))}
            </div>
          ) : (
            <div className="muted">Nenhum fluxo casou — a mensagem seguiria para a Tawany.</div>
          )
        ) : null}
      </section>
    </main>
  );
}
