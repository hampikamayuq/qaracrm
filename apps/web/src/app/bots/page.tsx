'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, FlaskConical, Trash2, Upload, Zap } from 'lucide-react';
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
          <button className="btn btn-primary" type="button" onClick={() => fileInput.current?.click()}>
            <Upload size={15} />Importar JSON
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
              </div>
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
    </main>
  );
}
