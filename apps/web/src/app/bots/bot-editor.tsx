'use client';

// Editor visual de fluxo de bot — construtor vertical estilo Kommo.
// Cada regra é uma coluna de blocos encadeados: Gatilho → Respostas → Ação
// final. Honesto com o motor (first-match linear, sem ramificações): a
// primeira regra que casar executa sua ação e encerra a disputa.
// Ações do engine: reply (responde e encerra) | handoff (responde se houver
// e encaminha pro humano) | tawany (não responde; a Tawany assume).

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bot,
  FlaskConical,
  GripVertical,
  MessageSquareText,
  Plus,
  Trash2,
  UserRound,
  X,
  Zap,
} from 'lucide-react';
import { api, type BotAction, type BotRuleInput, type BotTestResult } from '@/lib/api';

const MAX_RESPONSES = 4;
const LIVE_TEST_DEBOUNCE_MS = 400;

type EditorRule = {
  terms: string[];
  responses: string[];
  action: BotAction;
  handoffReason: string;
  termDraft: string;
};

export type EditorBot = { id: string | null; name: string; rules: BotRuleInput[] };

type Props = {
  bot: EditorBot;
  riskTerms: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
};

const ACTION_META: Record<BotAction, { label: string; hint: string }> = {
  reply: { label: 'Responder e encerrar', hint: 'Envia as respostas acima e encerra — a Tawany não entra.' },
  handoff: { label: 'Encaminhar p/ humano', hint: 'Envia as respostas (se houver) e marca a conversa como aguardando humano.' },
  tawany: { label: 'Deixar com a Tawany', hint: 'Não responde nada — encerra a disputa de bots e a Tawany assume.' },
};

const toEditorRules = (rules: BotRuleInput[]): EditorRule[] => {
  const shaped = rules.map((rule) => ({
    terms: [...rule.terms],
    responses: rule.responses.length > 0 ? [...rule.responses] : [''],
    action: rule.action ?? ('reply' as BotAction),
    handoffReason: rule.handoffReason ?? '',
    termDraft: '',
  }));
  return shaped.length > 0 ? shaped : [{ terms: [], responses: [''], action: 'reply', handoffReason: '', termDraft: '' }];
};

// Regras completas prontas para a API (respostas vazias descartadas;
// tawany nunca envia respostas, então elas não vão no payload).
const cleanRules = (rules: EditorRule[]): BotRuleInput[] =>
  rules
    .map((rule) => ({
      terms: rule.terms,
      responses: rule.action === 'tawany' ? [] : rule.responses.map((text) => text.trim()).filter(Boolean),
      ...(rule.action !== 'reply' ? { action: rule.action } : {}),
      ...(rule.action === 'handoff' && rule.handoffReason.trim() ? { handoffReason: rule.handoffReason.trim() } : {}),
    }))
    .filter((rule) => rule.terms.length > 0 && (rule.responses.length > 0 || rule.action === 'handoff' || rule.action === 'tawany'));

const ruleError = (rule: EditorRule): string | null => {
  if (rule.terms.length === 0) return 'Adicione ao menos um gatilho (palavra-chave).';
  if (rule.action === 'reply' && rule.responses.every((text) => !text.trim())) {
    return 'Escreva ao menos uma resposta (ou troque a ação final).';
  }
  return null;
};

export function BotEditor({ bot, riskTerms, onClose, onSaved }: Props) {
  const [name, setName] = useState(bot.name);
  const [rules, setRules] = useState<EditorRule[]>(() => toEditorRules(bot.rules));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const [testText, setTestText] = useState('');
  const [testResult, setTestResult] = useState<BotTestResult | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const testSeq = useRef(0);

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

  const dropOn = (target: number) => {
    if (dragIndex === null || dragIndex === target) {
      setDragIndex(null);
      return;
    }
    setRules((current) => {
      const next = [...current];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(target, 0, moved);
      return next;
    });
    setDragIndex(null);
  };

  // Teste ao vivo: debounce + contador anti-stale (resposta velha não
  // sobrescreve a nova). Sem texto ou sem regra completa, limpa o resultado.
  useEffect(() => {
    const text = testText.trim();
    const flow = cleanRules(rules);
    if (!text || flow.length === 0) {
      setTestResult(null);
      return;
    }
    const seq = ++testSeq.current;
    const timer = window.setTimeout(() => {
      void api.testBot(text, { rules: flow })
        .then((res) => {
          if (seq === testSeq.current) setTestResult(res.data ?? { matched: false, responses: [] });
        })
        .catch(() => {
          if (seq === testSeq.current) setTestResult(null);
        });
    }, LIVE_TEST_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [testText, rules]);

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

  // ruleIndex do teste é sobre as regras COMPLETAS (cleanRules); mapeia de
  // volta pro índice do editor para acender o card certo.
  const hitEditorIndex = (() => {
    if (!testResult?.matched || testResult.ruleIndex === undefined) return -1;
    let complete = -1;
    for (let i = 0; i < rules.length; i++) {
      if (!ruleError(rules[i]) && rules[i].terms.length > 0) complete++;
      if (complete === testResult.ruleIndex) return i;
    }
    return -1;
  })();

  return (
    <div className="drawer-root" role="dialog" aria-modal="true" aria-labelledby="bot-editor-title">
      <div className="drawer-backdrop" />
      <aside className="drawer drawer-wide" onClick={(e) => e.stopPropagation()}>
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
            <h3>Fluxo</h3>
            <p className="muted" style={{ margin: '4px 0 10px' }}>
              A disputa é de cima pra baixo: a primeira regra que casar executa a ação final e encerra.
              Arraste pelo punho pra reordenar. Nas respostas, {'{{nome}}'} e {'{{primeiro_nome}}'} viram o nome do paciente.
            </p>
            {submitted && rules.length === 0 ? <p className="error">Adicione ao menos uma regra.</p> : null}

            <div className="flow-rules">
              {rules.map((rule, index) => {
                const error = submitted ? ruleError(rule) : null;
                const isHit = index === hitEditorIndex;
                return (
                  <article
                    className={`flow-rule ${dragIndex === index ? 'dragging' : ''} ${isHit ? 'hit' : ''}`}
                    key={index}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => dropOn(index)}
                  >
                    <div className="flow-rule-head">
                      <span
                        className="flow-grip"
                        draggable
                        role="button"
                        aria-label={`Arrastar regra ${index + 1}`}
                        title="Arrastar para reordenar"
                        onDragStart={() => setDragIndex(index)}
                        onDragEnd={() => setDragIndex(null)}
                      >
                        <GripVertical size={14} />
                      </span>
                      <strong>Regra {index + 1}</strong>
                      {isHit ? <span className="chip chip-ok">casou o teste</span> : null}
                      <span className="flow-rule-tools">
                        <button className="icon-btn" type="button" aria-label={`Subir regra ${index + 1}`} disabled={index === 0} onClick={() => moveRule(index, -1)}>
                          <ArrowUp size={14} />
                        </button>
                        <button className="icon-btn" type="button" aria-label={`Descer regra ${index + 1}`} disabled={index === rules.length - 1} onClick={() => moveRule(index, 1)}>
                          <ArrowDown size={14} />
                        </button>
                        <button className="icon-btn" type="button" aria-label={`Remover regra ${index + 1}`} onClick={() => setRules((current) => current.filter((_, i) => i !== index))}>
                          <Trash2 size={14} />
                        </button>
                      </span>
                    </div>

                    <div className="flow-block flow-block-trigger">
                      <div className="flow-block-label"><Zap size={12} />Se a mensagem contiver</div>
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

                    {rule.action !== 'tawany' ? (
                      <>
                        <div className="flow-connector" aria-hidden="true" />
                        <div className="flow-block flow-block-responses">
                          <div className="flow-block-label"><MessageSquareText size={12} />Respostas (em sequência)</div>
                          {rule.responses.map((response, rIndex) => (
                            <div key={rIndex} style={{ alignItems: 'flex-start', display: 'flex', gap: '6px' }}>
                              <textarea
                                className="textarea"
                                rows={2}
                                style={{ flex: 1 }}
                                placeholder="Texto enviado ao paciente — {{primeiro_nome}} vira o nome"
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
                                  onClick={() => patchRule(index, { responses: rule.responses.filter((_, i) => i !== rIndex) })}
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
                      </>
                    ) : null}

                    <div className="flow-connector" aria-hidden="true" />
                    <div className="flow-block flow-action">
                      <div className="flow-block-label">
                        {rule.action === 'handoff' ? <UserRound size={12} /> : <Bot size={12} />}
                        Ação final
                      </div>
                      <div className="segmented" role="tablist" aria-label={`Ação final da regra ${index + 1}`}>
                        {(Object.keys(ACTION_META) as BotAction[]).map((action) => (
                          <button
                            key={action}
                            type="button"
                            role="tab"
                            aria-selected={rule.action === action}
                            className={rule.action === action ? 'seg-active' : ''}
                            onClick={() => patchRule(index, { action })}
                          >
                            {ACTION_META[action].label}
                          </button>
                        ))}
                      </div>
                      <span className="faint" style={{ fontSize: '11.5px' }}>{ACTION_META[rule.action].hint}</span>
                      {rule.action === 'handoff' ? (
                        <input
                          className="input"
                          placeholder="Motivo do encaminhamento (opcional — aparece no Inbox)"
                          value={rule.handoffReason}
                          onChange={(e) => patchRule(index, { handoffReason: e.target.value })}
                        />
                      ) : null}
                    </div>

                    {error ? <p className="error">{error}</p> : null}
                  </article>
                );
              })}
            </div>

            <button
              className="btn"
              type="button"
              style={{ marginTop: '10px' }}
              onClick={() => setRules((current) => [...current, { terms: [], responses: [''], action: 'reply', handoffReason: '', termDraft: '' }])}
            >
              <Plus size={14} />Nova regra
            </button>
          </section>

          <section className="drawer-section flow-test-panel">
            <h3><FlaskConical size={13} style={{ verticalAlign: '-2px', marginRight: '4px' }} />Teste ao vivo</h3>
            <p className="muted" style={{ margin: '4px 0 8px' }}>
              Digite como paciente: a regra que casar acende acima. Nada é salvo nem enviado.
            </p>
            <input
              className="input"
              placeholder="Ex.: quanto custa a consulta?"
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
            />
            {testResult ? (
              <div className="panel-block" style={{ marginTop: '8px', display: 'grid', gap: '6px' }}>
                {testResult.blockedByRisk ? (
                  <div className="chips">
                    <span className="chip chip-danger">bloqueada por risco → atendimento humano</span>
                  </div>
                ) : testResult.matched ? (
                  <>
                    <div className="chips">
                      <span className="chip chip-ok">casou: Regra {hitEditorIndex + 1}</span>
                      <span className="chip chip-ai">{ACTION_META[testResult.action ?? 'reply'].label}</span>
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
