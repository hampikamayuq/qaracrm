'use client';

// Editor de fluxo de bot — form estruturado (sem canvas de nós).
// Schema real do engine: { rules: [{ terms: string[], responses: string[] }] },
// first-match com normalized-contains. O engine NÃO suporta condições, variáveis
// nem ação por regra (regra que casa = responde e encerra; sem match = Tawany;
// termo de risco = humano, sempre) — por isso nada disso aparece aqui.

import { useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, FlaskConical, Plus, Trash2, X } from 'lucide-react';
import { api, type BotRuleInput, type BotTestResult } from '@/lib/api';

const MAX_RESPONSES = 4;

type EditorRule = { terms: string[]; responses: string[]; termDraft: string };

export type EditorBot = { id: string | null; name: string; rules: BotRuleInput[] };

type Props = {
  bot: EditorBot;
  riskTerms: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
};

const toEditorRules = (rules: BotRuleInput[]): EditorRule[] => {
  const shaped = rules.map((rule) => ({
    terms: [...rule.terms],
    responses: rule.responses.length > 0 ? [...rule.responses] : [''],
    termDraft: '',
  }));
  return shaped.length > 0 ? shaped : [{ terms: [], responses: [''], termDraft: '' }];
};

// Regras completas prontas para a API (respostas vazias descartadas).
const cleanRules = (rules: EditorRule[]): BotRuleInput[] =>
  rules
    .map((rule) => ({
      terms: rule.terms,
      responses: rule.responses.map((text) => text.trim()).filter(Boolean),
    }))
    .filter((rule) => rule.terms.length > 0 && rule.responses.length > 0);

const ruleError = (rule: EditorRule): string | null => {
  if (rule.terms.length === 0) return 'Adicione ao menos um gatilho (palavra-chave).';
  if (rule.responses.every((text) => !text.trim())) return 'Escreva ao menos uma resposta.';
  return null;
};

export function BotEditor({ bot, riskTerms, onClose, onSaved }: Props) {
  const [name, setName] = useState(bot.name);
  const [rules, setRules] = useState<EditorRule[]>(() => toEditorRules(bot.rules));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const [testText, setTestText] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<BotTestResult | null>(null);

  const patchRule = (index: number, patch: Partial<EditorRule>) => {
    setRules((current) => current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  };

  const addTerm = (index: number) => {
    const rule = rules[index];
    const term = rule.termDraft.trim();
    if (!term || rule.terms.includes(term)) {
      patchRule(index, { termDraft: '' });
      return;
    }
    patchRule(index, { terms: [...rule.terms, term], termDraft: '' });
  };

  const moveRule = (index: number, delta: -1 | 1) => {
    setRules((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const save = async () => {
    setSubmitted(true);
    setServerError('');
    const invalid = !name.trim() || rules.length === 0 || rules.some((rule) => ruleError(rule));
    if (invalid) return;
    setSaving(true);
    try {
      const payload = { name: name.trim(), rules: cleanRules(rules) };
      const res = bot.id ? await api.updateBot(bot.id, payload) : await api.createBot(payload);
      if (res.success) {
        onSaved(bot.id ? `Fluxo "${payload.name}" atualizado (versão anterior guardada).` : `Fluxo "${payload.name}" criado — ative quando estiver pronto.`);
      } else {
        setServerError(res.error ?? 'Falha ao salvar o fluxo.');
      }
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    const text = testText.trim();
    const flow = cleanRules(rules);
    if (!text || flow.length === 0) return;
    setTesting(true);
    try {
      const res = await api.testBot(text, { rules: flow });
      setTestResult(res.data ?? { matched: false, responses: [] });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="drawer-root" role="dialog" aria-modal="true" aria-labelledby="bot-editor-title">
      <div className="drawer-backdrop" />
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2 id="bot-editor-title">{bot.id ? 'Editar fluxo' : 'Novo bot'}</h2>
          <button onClick={onClose} className="icon-btn" type="button" aria-label="Fechar editor">
            <X size={17} />
          </button>
        </header>

        <div className="drawer-body">
          <section className="drawer-section">
            <label className="field">
              <span className="muted">Nome do bot</span>
              <input
                className="input"
                placeholder="Ex.: FAQ preços e endereços"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {submitted && !name.trim() ? <p className="error">Dê um nome ao bot.</p> : null}
          </section>

          <section className="drawer-section">
            <h3><AlertTriangle size={13} style={{ verticalAlign: '-2px', marginRight: '4px' }} />Termos de risco</h3>
            <p className="muted" style={{ margin: '4px 0 8px' }}>
              Termos de risco sempre vão para atendimento humano (não editável). Nenhuma regra abaixo responde mensagens com estes termos:
            </p>
            <div className="chips">
              {riskTerms.map((term) => (
                <span className="chip chip-danger" key={term}>{term}</span>
              ))}
            </div>
          </section>

          <section className="drawer-section">
            <h3>Regras</h3>
            <p className="muted" style={{ margin: '4px 0 8px' }}>
              Primeira regra que casar responde e encerra. Sem match, a mensagem segue para a Tawany.
            </p>
            {submitted && rules.length === 0 ? <p className="error">Adicione ao menos uma regra.</p> : null}

            <div style={{ display: 'grid', gap: '10px' }}>
              {rules.map((rule, index) => {
                const error = submitted ? ruleError(rule) : null;
                return (
                  <article className="panel-block" key={index} style={{ display: 'grid', gap: '8px' }}>
                    <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
                      <strong style={{ fontSize: '12.5px' }}>Regra {index + 1}</strong>
                      <span style={{ display: 'inline-flex', gap: '4px' }}>
                        <button
                          className="icon-btn"
                          type="button"
                          aria-label={`Subir regra ${index + 1}`}
                          disabled={index === 0}
                          onClick={() => moveRule(index, -1)}
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          className="icon-btn"
                          type="button"
                          aria-label={`Descer regra ${index + 1}`}
                          disabled={index === rules.length - 1}
                          onClick={() => moveRule(index, 1)}
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          className="icon-btn"
                          type="button"
                          aria-label={`Remover regra ${index + 1}`}
                          onClick={() => setRules((current) => current.filter((_, i) => i !== index))}
                        >
                          <Trash2 size={14} />
                        </button>
                      </span>
                    </div>

                    <div>
                      <span className="muted" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>
                        Gatilhos (palavras-chave)
                      </span>
                      <div className="chips" style={{ marginBottom: rule.terms.length > 0 ? '6px' : 0 }}>
                        {rule.terms.map((term) => (
                          <span className="chip chip-removable" key={term}>
                            {term}
                            <button
                              aria-label={`Remover gatilho ${term}`}
                              type="button"
                              onClick={() => patchRule(index, { terms: rule.terms.filter((t) => t !== term) })}
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="inline-form">
                        <input
                          className="input"
                          placeholder="Ex.: quanto custa"
                          value={rule.termDraft}
                          onChange={(e) => patchRule(index, { termDraft: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              addTerm(index);
                            }
                          }}
                        />
                        <button className="btn" type="button" onClick={() => addTerm(index)}>
                          <Plus size={14} />Adicionar
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: '6px' }}>
                      <span className="muted" style={{ fontSize: '12px' }}>Respostas (enviadas em sequência)</span>
                      {rule.responses.map((response, rIndex) => (
                        <div key={rIndex} style={{ alignItems: 'flex-start', display: 'flex', gap: '6px' }}>
                          <textarea
                            className="textarea"
                            rows={2}
                            style={{ flex: 1 }}
                            placeholder="Texto enviado ao paciente"
                            value={response}
                            onChange={(e) =>
                              patchRule(index, {
                                responses: rule.responses.map((r, i) => (i === rIndex ? e.target.value : r)),
                              })
                            }
                          />
                          {rule.responses.length > 1 ? (
                            <button
                              className="icon-btn"
                              type="button"
                              aria-label={`Remover resposta ${rIndex + 1}`}
                              onClick={() =>
                                patchRule(index, { responses: rule.responses.filter((_, i) => i !== rIndex) })
                              }
                            >
                              <X size={14} />
                            </button>
                          ) : null}
                        </div>
                      ))}
                      {rule.responses.length < MAX_RESPONSES ? (
                        <button
                          className="btn"
                          type="button"
                          style={{ justifySelf: 'start' }}
                          onClick={() => patchRule(index, { responses: [...rule.responses, ''] })}
                        >
                          <Plus size={14} />Adicionar resposta
                        </button>
                      ) : (
                        <span className="faint" style={{ fontSize: '11.5px' }}>Máximo de {MAX_RESPONSES} respostas por regra.</span>
                      )}
                    </div>

                    <span className="faint" style={{ fontSize: '11.5px' }}>
                      Ação: responder e encerrar (única ação suportada pelo motor).
                    </span>
                    {error ? <p className="error">{error}</p> : null}
                  </article>
                );
              })}
            </div>

            <button
              className="btn"
              type="button"
              style={{ marginTop: '10px' }}
              onClick={() => setRules((current) => [...current, { terms: [], responses: [''], termDraft: '' }])}
            >
              <Plus size={14} />Nova regra
            </button>
          </section>

          <section className="drawer-section">
            <h3><FlaskConical size={13} style={{ verticalAlign: '-2px', marginRight: '4px' }} />Testar este fluxo</h3>
            <p className="muted" style={{ margin: '4px 0 8px' }}>
              Simula uma mensagem contra o fluxo do editor (sem salvar). Nada é enviado ao WhatsApp.
            </p>
            <div className="inline-form">
              <input
                className="input"
                placeholder="Ex.: quanto custa a consulta?"
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runTest()}
              />
              <button
                className="btn btn-primary"
                type="button"
                disabled={testing || !testText.trim() || cleanRules(rules).length === 0}
                onClick={runTest}
              >
                {testing ? 'Testando…' : 'Testar'}
              </button>
            </div>
            {cleanRules(rules).length === 0 ? (
              <p className="faint" style={{ margin: '6px 0 0', fontSize: '11.5px' }}>Complete ao menos uma regra (gatilho + resposta) para testar.</p>
            ) : null}
            {testResult ? (
              <div className="panel-block" style={{ marginTop: '8px', display: 'grid', gap: '6px' }}>
                {testResult.blockedByRisk ? (
                  <div className="chips">
                    <span className="chip chip-danger">bloqueada por risco → atendimento humano</span>
                  </div>
                ) : testResult.matched ? (
                  <>
                    <div className="chips">
                      <span className="chip chip-ok">casou: Regra {(testResult.ruleIndex ?? 0) + 1}</span>
                      {(testResult.terms ?? []).map((term) => (
                        <span className="chip" key={term}>{term}</span>
                      ))}
                    </div>
                    {testResult.responses.map((response, i) => (
                      <article className="message-bubble message-out" key={i} style={{ alignSelf: 'flex-start' }}>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{response}</div>
                      </article>
                    ))}
                  </>
                ) : (
                  <span className="muted">Nenhuma regra casou — a mensagem seguiria para a Tawany.</span>
                )}
              </div>
            ) : null}
          </section>

          <section className="drawer-section">
            {serverError ? <p className="error" style={{ marginBottom: '8px' }}>{serverError}</p> : null}
            <div className="modal-actions">
              <button className="btn" type="button" onClick={onClose}>Cancelar</button>
              <button className="btn btn-primary" type="button" disabled={saving} onClick={save}>
                {saving ? 'Salvando…' : bot.id ? 'Salvar alterações' : 'Criar bot'}
              </button>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
