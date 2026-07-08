'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bot, Check, CheckCheck, FlaskConical, MessageSquareText, Plus, Search, Send, Sparkles, ThumbsDown, ThumbsUp, Undo2, X } from 'lucide-react';
import { api, type AgentState, type Conversation, type ConversationDetail } from '@/lib/api';

type StatusFilter = 'OPEN' | 'ALL' | 'HUMAN';

const riskClass = (risk: string | null | undefined) => (
  risk === 'high' ? 'chip-danger' : risk === 'medium' ? 'chip-warning' : 'chip-ok'
);

const riskLabel = (risk: string | null | undefined) => (
  risk === 'high' ? 'Risco alto' : risk === 'medium' ? 'Risco médio' : 'Risco baixo'
);

const statusLabel = (status: string) => (
  status === 'OPEN' ? 'Aberta'
    : status === 'RESOLVED' ? 'Resolvida'
    : status === 'PENDING' ? 'Pendente'
    : status === 'CLOSED' ? 'Fechada'
    : status === 'NEEDS_HUMAN' ? 'Precisa de humano'
    : status === 'PENDING_HUMAN' ? 'Aguardando humano'
    : status === 'PENDING_PATIENT' ? 'Aguardando paciente'
    : status
);

const temperatureLabel = (value: string | null | undefined) => (
  value === 'HOT' ? 'Quente' : value === 'WARM' ? 'Morno' : value === 'COLD' ? 'Frio' : 'Sem temp.'
);

const temperatureClass = (value: string | null | undefined) => (
  value === 'HOT' ? 'temp-hot' : value === 'WARM' ? 'temp-warm' : value === 'COLD' ? 'temp-cold' : 'temp-none'
);

const formatDate = (value: string | null | undefined) => (
  value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Sem data'
);

const relativeTime = (value: string | null | undefined) => {
  if (!value) return '—';
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `há ${days} d`;
  return new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const initials = (name: string | null | undefined) => {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
};

const avatarStyle = (name: string | null | undefined) => {
  const seed = name ?? '?';
  let hue = 0;
  for (let i = 0; i < seed.length; i += 1) hue = (hue * 31 + seed.charCodeAt(i)) % 360;
  return { background: `hsl(${hue} 42% 93%)`, color: `hsl(${hue} 48% 30%)` };
};

const firstMessage = (conversation: Conversation) => conversation.messages?.[0]?.body ?? 'Sem mensagens';

// Fallback local caso a API ainda não devolva agentState
const agentStateOf = (conversation: { status: string; needsHuman: boolean; agentState?: AgentState }): AgentState =>
  conversation.agentState
    ?? (conversation.needsHuman ? 'aguardando_humano' : conversation.status === 'OPEN' ? 'tawany_ativa' : 'humano_assumiu');

// Motivos técnicos do handoff traduzidos para a equipe
const handoffReasonLabel = (reason: string | null | undefined): string => {
  if (!reason) return 'motivo não registrado';
  if (reason.startsWith('guard_failed')) {
    if (reason.includes('price_not_in_kb')) return 'bloqueado: preço fora da tabela';
    if (reason.includes('sensitive_topic')) return 'bloqueado: tema sensível';
    if (reason.includes('length_exceeds')) return 'bloqueado: resposta longa demais';
    if (reason.includes('schedule_promise')) return 'bloqueado: prometeu horário sem agenda';
    if (reason.includes('outcome_promise')) return 'bloqueado: prometeu resultado';
    if (reason.includes('mohs') || reason.includes('skin_cancer')) return 'bloqueado: afirmação clínica sensível';
    return 'bloqueado pelo validador';
  }
  if (reason === 'opt_out_detected') return 'paciente pediu para parar';
  if (reason.includes('injection')) return 'mensagem suspeita';
  if (reason === 'manual_handoff') return 'marcado manualmente';
  if (reason === 'max_iterations') return 'Tawany não conseguiu concluir';
  if (reason.startsWith('tool_error')) return 'erro em ferramenta interna';
  if (reason.startsWith('config')) return 'configuração de IA ausente';
  if (reason.startsWith('tawany_error')) return 'erro interno da Tawany';
  return reason;
};

export default function InboxPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState<ConversationDetail | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('OPEN');
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [newTask, setNewTask] = useState('');
  const [feedback, setFeedback] = useState('');
  const [testMode, setTestMode] = useState(false);
  const [downvoteId, setDownvoteId] = useState<string | null>(null);
  const [downvoteNote, setDownvoteNote] = useState('');
  // deep link /inbox?lead=<id> (vindo do card do pipeline): seleciona a
  // conversa do lead assim que a lista carregar, em qualquer status.
  const pendingLeadRef = useRef<string | null>(null);

  useEffect(() => {
    const leadParam = new URLSearchParams(window.location.search).get('lead');
    if (leadParam) {
      pendingLeadRef.current = leadParam;
      setStatus('ALL');
    }
  }, []);

  const reloadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      setSelected(await api.getConversation(id));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      api.getConversations({
        search: search || undefined,
        status: status === 'ALL' || status === 'HUMAN' ? undefined : status,
        needsHuman: status === 'HUMAN' ? true : undefined,
      }).then((data) => {
        setConversations(data.items);
        setSelectedId((current) => {
          if (pendingLeadRef.current) {
            const byLead = data.items.find((item) => item.lead?.id === pendingLeadRef.current)?.id;
            if (byLead) {
              pendingLeadRef.current = null;
              return byLead;
            }
          }
          const fromUrl = new URLSearchParams(window.location.search).get('conversationId') ?? '';
          const candidate = current || fromUrl;
          if (candidate && data.items.some((item) => item.id === candidate)) return candidate;
          return data.items[0]?.id ?? '';
        });
      }).finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, status]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    window.history.replaceState(null, '', `/inbox?conversationId=${selectedId}`);
    setReply('');
    setFeedback('');
    void reloadDetail(selectedId);
  }, [selectedId, reloadDetail]);

  const flash = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(''), 4000);
  };

  const sendManualReply = async () => {
    if (!selected || !reply.trim()) return;
    setSending(true);
    try {
      const res = await api.sendReply(selected.id, reply.trim());
      if (!res.success) {
        flash(res.error ?? 'Falha ao enviar');
        return;
      }
      setReply('');
      await reloadDetail(selected.id);
    } finally {
      setSending(false);
    }
  };

  const generateSuggestion = async () => {
    if (!selected) return;
    const lastInbound = [...selected.messages].reverse().find((message) => message.direction === 'IN');
    if (!lastInbound) {
      flash('Sem mensagem do paciente para responder.');
      return;
    }
    setSuggesting(true);
    try {
      const res = await api.runTawany(lastInbound.id, testMode);
      if (!res.success) {
        flash(res.error ?? 'Tawany indisponível');
        return;
      }
      await reloadDetail(selected.id);
      flash(testMode ? 'Sugestão gerada (modo teste - não enviado)' : 'Sugestão gerada.');
    } finally {
      setSuggesting(false);
    }
  };

  const approve = async (conversationId: string, suggestionId: string, original: string) => {
    const textarea = document.getElementById(`suggestion-${suggestionId}`) as HTMLTextAreaElement | null;
    const body = textarea?.value.trim();
    const res = await api.approveSuggestion(suggestionId, body && body !== original ? body : undefined);
    if (!res.success) {
      flash(res.error ?? 'Falha ao aprovar');
      return;
    }
    await reloadDetail(conversationId);
  };

  const reject = async (conversationId: string, suggestionId: string) => {
    const res = await api.rejectSuggestion(suggestionId);
    if (!res.success) {
      flash(res.error ?? 'Falha ao descartar');
      return;
    }
    await reloadDetail(conversationId);
  };

  const markHuman = async () => {
    if (!selected) return;
    await api.handoff(selected.id);
    await reloadDetail(selected.id);
    flash('Conversa marcada para atendimento humano.');
  };

  const devolverTawany = async () => {
    if (!selected) return;
    const res = await api.devolverTawany(selected.id);
    if (!res.success) {
      flash(res.error ?? 'Falha ao devolver para a Tawany.');
      return;
    }
    await reloadDetail(selected.id);
    flash('Conversa devolvida para a Tawany.');
  };

  const sendBubbleFeedback = async (suggestionId: string, value: 'UP' | 'DOWN', note?: string) => {
    if (!selected) return;
    const res = await api.sendSuggestionFeedback(suggestionId, value, note);
    if (!res.success) {
      flash(res.error ?? 'Falha ao registrar feedback.');
      return;
    }
    setDownvoteId(null);
    setDownvoteNote('');
    await reloadDetail(selected.id);
    flash(value === 'UP' ? 'Feedback registrado. 👍' : 'Feedback registrado — resposta entrou na fila de revisão.');
  };

  const resolve = async () => {
    if (!selected) return;
    await api.setConversationStatus(selected.id, 'RESOLVED');
    await reloadDetail(selected.id);
    flash('Conversa resolvida.');
  };

  const addTag = async () => {
    if (!selected || !newTag.trim()) return;
    const res = await api.addTag(selected.id, newTag.trim());
    if (res.success) {
      setNewTag('');
      await reloadDetail(selected.id);
    }
  };

  const removeTag = async (tag: string) => {
    if (!selected) return;
    await api.removeTag(selected.id, tag);
    await reloadDetail(selected.id);
  };

  const createTask = async () => {
    if (!selected || !newTask.trim()) return;
    const res = await api.createTask({ title: newTask.trim(), conversationId: selected.id });
    if (res.success) {
      setNewTask('');
      await reloadDetail(selected.id);
      flash('Tarefa criada.');
    }
  };

  return (
    <main className="page page-tight">
      <div className="toolbar">
        <div>
          <h1 className="title">Inbox</h1>
          <div className="muted">{loading ? 'Carregando…' : `${conversations.length} conversas`}</div>
        </div>
        <div className="toolbar-right">
          <div className="search-field">
            <Search size={15} />
            <input
              className="input"
              placeholder="Buscar por nome"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="segmented" role="group" aria-label="Filtrar conversas">
            {(['OPEN', 'HUMAN', 'ALL'] as StatusFilter[]).map((filter) => (
              <button
                className={status === filter ? 'seg-active' : ''}
                key={filter}
                type="button"
                aria-pressed={status === filter}
                onClick={() => setStatus(filter)}
              >
                {filter === 'OPEN' ? 'Abertas' : filter === 'HUMAN' ? 'Humano' : 'Todas'}
              </button>
            ))}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={testMode}
            className="switch-row"
            onClick={() => setTestMode(!testMode)}
            title={testMode ? 'Modo teste ativo - Tawany não envia mensagens reais' : 'Ativar modo teste'}
          >
            <span className="switch" aria-hidden="true"><span className="switch-thumb" /></span>
            <FlaskConical size={15} />
            Modo teste
          </button>
        </div>
      </div>

      {testMode ? (
        <div className="test-banner" role="status">
          <FlaskConical size={15} />
          Modo teste ativo — as sugestões da Tawany não são enviadas ao paciente.
        </div>
      ) : null}

      <section className="inbox-grid">
        <div className="inbox-col">
          <div className="panel-head">
            <span>Conversas</span>
            <span className="count-badge">{conversations.length}</span>
          </div>
          <aside className="inbox-list" aria-label="Conversas">
            {!loading && conversations.length === 0 ? <div className="card muted">Nenhuma conversa encontrada.</div> : null}
            {conversations.map((conversation) => {
              const leadName = conversation.lead?.name ?? 'Lead sem nome';
              const risk = conversation.aiSuggestions?.[0]?.riskLevel;
              return (
                <button
                  className={`conversation-card ${selectedId === conversation.id ? 'conversation-card-active' : ''}`}
                  key={conversation.id}
                  type="button"
                  onClick={() => setSelectedId(conversation.id)}
                >
                  <span className="conversation-card-head">
                    <span className="avatar" style={avatarStyle(leadName)} aria-hidden="true">{initials(leadName)}</span>
                    <span className="conversation-id">
                      <span className="conversation-name">{leadName}</span>
                      <span className="conversation-phone">{conversation.lead?.phone ?? conversation.channel ?? 'Sem telefone'}</span>
                    </span>
                    <span className="conversation-time">{relativeTime(conversation.lastMessageAt ?? conversation.updatedAt)}</span>
                  </span>
                  <span className="conversation-preview">{firstMessage(conversation)}</span>
                  <span className="chips">
                    {conversation.needsHuman ? (
                      <span className="chip chip-danger"><AlertTriangle size={11} />Humano</span>
                    ) : (
                      <span className="chip chip-ai"><Bot size={11} />Tawany</span>
                    )}
                    <span className="chip">{statusLabel(conversation.status)}</span>
                    {risk === 'high' || risk === 'medium' ? (
                      <span className={`chip ${riskClass(risk)}`}>{riskLabel(risk)}</span>
                    ) : null}
                    <span className={`temp ${temperatureClass(conversation.lead?.temperature)}`}>
                      {temperatureLabel(conversation.lead?.temperature)}
                    </span>
                    <span className="chip">Score {conversation.lead?.score ?? 0}</span>
                  </span>
                </button>
              );
            })}
          </aside>
        </div>

        <section className="thread-panel" aria-label="Thread da conversa">
          {!selectedId ? (
            <div className="empty-thread">
              <MessageSquareText size={30} />
              <strong>Selecione uma conversa</strong>
              <span className="muted">A thread, sugestões e dados do contato aparecem aqui.</span>
            </div>
          ) : detailLoading || !selected ? (
            <div className="card muted">Carregando conversa…</div>
          ) : (
            <>
              <header className="thread-head">
                <div className="thread-head-id">
                  <span className="avatar" style={avatarStyle(selected.lead.name)} aria-hidden="true">{initials(selected.lead.name)}</span>
                  <div>
                    <h2 className="title">{selected.lead.name}</h2>
                    <div className="muted">{selected.channel ?? 'Canal não informado'} · {statusLabel(selected.status)}</div>
                  </div>
                </div>
                <div className="thread-head-state">
                  {agentStateOf(selected) === 'tawany_ativa' ? (
                    <span className="chip chip-ai"><Bot size={13} />Tawany ativa</span>
                  ) : agentStateOf(selected) === 'aguardando_humano' ? (
                    <span className="chip chip-warning" title={selected.handoffReason ?? undefined}>
                      <AlertTriangle size={13} />Aguardando humano — {handoffReasonLabel(selected.handoffReason)}
                    </span>
                  ) : (
                    <span className="chip">Humano assumiu</span>
                  )}
                  {agentStateOf(selected) !== 'tawany_ativa' ? (
                    <button className="btn" type="button" onClick={devolverTawany}>
                      <Undo2 size={14} />Devolver para a Tawany
                    </button>
                  ) : null}
                </div>
              </header>

              <div className="message-thread">
                {selected.messages.length === 0 ? <div className="card muted">Nenhuma mensagem registrada.</div> : null}
                {selected.messages.map((message) => {
                  const isOut = message.direction === 'OUT';
                  const bubbleClass = isOut ? (message.agentHandled ? 'message-ai' : 'message-out') : 'message-in';
                  // ponytail: casa a bolha com a sugestão SENT pelo body; se a equipe
                  // editar antes de enviar, o feedback fica indisponível para essa msg.
                  const sug = isOut && message.agentHandled
                    ? selected.sentSuggestions?.find((s) => s.body === message.body)
                    : undefined;
                  return (
                    <article className={`message-bubble ${bubbleClass}`} key={message.id}>
                      <div>{message.body}</div>
                      <footer className="msg-meta">
                        {isOut && message.agentHandled ? <Bot size={12} /> : null}
                        {isOut ? (message.agentHandled ? 'Tawany' : 'Clínica') : 'Paciente'} · {formatDate(message.sentAt)}
                        {sug ? (
                          <span className="msg-feedback">
                            <button
                              type="button"
                              className={sug.feedback === 'UP' ? 'fb-btn fb-active' : 'fb-btn'}
                              title="Boa resposta"
                              aria-label="Marcar como boa resposta"
                              onClick={() => sendBubbleFeedback(sug.id, 'UP')}
                            >
                              <ThumbsUp size={12} />
                            </button>
                            <button
                              type="button"
                              className={sug.feedback === 'DOWN' ? 'fb-btn fb-active' : 'fb-btn'}
                              title="Resposta ruim"
                              aria-label="Marcar como resposta ruim"
                              onClick={() => { setDownvoteId(sug.id); setDownvoteNote(''); }}
                            >
                              <ThumbsDown size={12} />
                            </button>
                          </span>
                        ) : null}
                      </footer>
                      {sug && downvoteId === sug.id ? (
                        <div className="fb-form">
                          <textarea
                            className="textarea"
                            placeholder="O que a Tawany deveria ter respondido? (opcional)"
                            value={downvoteNote}
                            onChange={(event) => setDownvoteNote(event.target.value)}
                            rows={2}
                          />
                          <div className="suggestion-actions">
                            <button
                              className="btn btn-danger"
                              type="button"
                              onClick={() => sendBubbleFeedback(sug.id, 'DOWN', downvoteNote.trim() || undefined)}
                            >
                              <ThumbsDown size={13} />Enviar feedback
                            </button>
                            <button className="btn" type="button" onClick={() => setDownvoteId(null)}>Cancelar</button>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>

              {feedback ? <div className="flash" role="status">{feedback}</div> : null}

              {selected.aiSuggestions.map((suggestion) => (
                <div className="suggestion" key={suggestion.id}>
                  <div className="suggestion-head">
                    <span><Bot size={15} />Sugestão da Tawany</span>
                    <span className={`chip ${riskClass(suggestion.riskLevel)}`}>{riskLabel(suggestion.riskLevel)}</span>
                  </div>
                  <textarea className="textarea" id={`suggestion-${suggestion.id}`} defaultValue={suggestion.body} />
                  <div className="suggestion-actions">
                    <button className="btn btn-primary" type="button" onClick={() => approve(selected.id, suggestion.id, suggestion.body)}>
                      <Check size={15} />Aprovar e enviar
                    </button>
                    <button className="btn btn-danger" type="button" onClick={() => reject(selected.id, suggestion.id)}>
                      <X size={15} />Descartar
                    </button>
                  </div>
                </div>
              ))}

              <div className="composer">
                <textarea
                  className="textarea"
                  placeholder="Escreva uma resposta manual…"
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                />
                <div className="composer-actions">
                  <button className="btn btn-ai" disabled={suggesting} type="button" onClick={generateSuggestion}>
                    <Sparkles size={15} />{suggesting ? 'Gerando…' : 'Sugestão Tawany'}
                  </button>
                  <button className="btn btn-primary" disabled={sending || !reply.trim()} type="button" onClick={sendManualReply}>
                    <Send size={15} />{sending ? 'Enviando…' : 'Enviar WhatsApp'}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        <div className="inbox-col">
          <div className="panel-head"><span>Contato</span></div>
          <aside className="contact-panel" aria-label="Dados do contato">
            {!selected ? (
              <div className="muted">Sem contato selecionado.</div>
            ) : (
              <>
                <div className="contact-card">
                  <span className="avatar avatar-lg" style={avatarStyle(selected.lead.name)} aria-hidden="true">{initials(selected.lead.name)}</span>
                  <div>
                    <strong>{selected.lead.name}</strong>
                    <div className="muted">{selected.lead.phone ?? selected.patient?.phone ?? 'Telefone não informado'}</div>
                  </div>
                </div>
                <dl className="detail-list">
                  <div><dt>E-mail</dt><dd>{selected.lead.email ?? selected.patient?.email ?? 'Não informado'}</dd></div>
                  <div><dt>Origem</dt><dd>{selected.lead.source ?? 'Não informada'}</dd></div>
                  <div><dt>Intenção</dt><dd>{selected.lead.intent ?? 'Não informada'}</dd></div>
                  <div><dt>Score</dt><dd>{selected.lead.score ?? 0}</dd></div>
                  <div>
                    <dt>Temperatura</dt>
                    <dd><span className={`temp ${temperatureClass(selected.lead.temperature)}`}>{temperatureLabel(selected.lead.temperature)}</span></dd>
                  </div>
                  <div><dt>Estágio</dt><dd>{selected.lead.stage?.name ?? 'Sem estágio'}</dd></div>
                  <div><dt>Próxima ação</dt><dd>{selected.lead.nextAction ?? 'Sem ação definida'}</dd></div>
                </dl>
                <div className="panel-block">
                  <h3>Tags</h3>
                  <div className="chips">
                    {(selected.lead.tags ?? []).length === 0 ? <span className="faint">Sem tags</span> : null}
                    {(selected.lead.tags ?? []).map((tag) => (
                      <span className="chip chip-removable" key={tag}>
                        {tag}
                        <button aria-label={`Remover tag ${tag}`} type="button" onClick={() => removeTag(tag)}><X size={12} /></button>
                      </span>
                    ))}
                  </div>
                  <div className="inline-form">
                    <input
                      className="input"
                      placeholder="Nova tag"
                      value={newTag}
                      onChange={(event) => setNewTag(event.target.value)}
                      onKeyDown={(event) => event.key === 'Enter' && addTag()}
                    />
                    <button className="btn" type="button" aria-label="Adicionar tag" onClick={addTag}><Plus size={14} /></button>
                  </div>
                </div>
                <div className="panel-block">
                  <h3>Tarefas</h3>
                  {selected.tasks.length === 0 ? <div className="faint">Sem tarefas abertas</div> : null}
                  {selected.tasks.map((task) => (
                    <div className="task-row" key={task.id}>
                      <strong>{task.title}</strong>
                      <span>{task.priority} · {task.dueAt ? formatDate(task.dueAt) : 'Sem prazo'}</span>
                    </div>
                  ))}
                  <div className="inline-form">
                    <input
                      className="input"
                      placeholder="Nova tarefa"
                      value={newTask}
                      onChange={(event) => setNewTask(event.target.value)}
                      onKeyDown={(event) => event.key === 'Enter' && createTask()}
                    />
                    <button className="btn" type="button" aria-label="Adicionar tarefa" onClick={createTask}><Plus size={14} /></button>
                  </div>
                </div>
                <div className="suggestion-actions">
                  <button className="btn" type="button" onClick={markHuman}><AlertTriangle size={15} />Marcar humano</button>
                  <button className="btn" type="button" onClick={resolve}><CheckCheck size={15} />Resolver</button>
                </div>
              </>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}
