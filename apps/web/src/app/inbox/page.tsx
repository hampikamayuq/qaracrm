'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bot, Check, CheckCheck, MessageSquareText, Plus, Search, Send, UserRound, X } from 'lucide-react';
import { api, type Conversation, type ConversationDetail } from '@/lib/api';

type StatusFilter = 'OPEN' | 'ALL' | 'HUMAN';

const riskClass = (risk: string | null | undefined) => (
  risk === 'high' ? 'chip-danger' : risk === 'medium' ? 'chip-warning' : 'chip-ok'
);

const temperatureLabel = (value: string | null | undefined) => (
  value === 'HOT' ? 'Quente' : value === 'WARM' ? 'Morno' : value === 'COLD' ? 'Frio' : 'Sem temp.'
);

const formatDate = (value: string | null | undefined) => (
  value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Sem data'
);

const firstMessage = (conversation: Conversation) => conversation.messages?.[0]?.body ?? 'Sem mensagens';

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
      const res = await api.runTawany(lastInbound.id);
      if (!res.success) {
        flash(res.error ?? 'Tawany indisponível');
        return;
      }
      await reloadDetail(selected.id);
      flash('Sugestão gerada.');
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
          <div className="muted">{loading ? 'Carregando' : `${conversations.length} conversas`}</div>
        </div>
        <div className="toolbar-right">
          <div className="toolbar-left">
            <Search size={17} />
            <input
              className="input"
              placeholder="Buscar por nome"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {(['OPEN', 'HUMAN', 'ALL'] as StatusFilter[]).map((filter) => (
            <button
              className={`btn ${status === filter ? 'btn-active' : ''}`}
              key={filter}
              type="button"
              onClick={() => setStatus(filter)}
            >
              {filter === 'OPEN' ? 'Abertas' : filter === 'HUMAN' ? 'Humano' : 'Todas'}
            </button>
          ))}
        </div>
      </div>

      <section className="inbox-grid">
        <aside className="inbox-list" aria-label="Conversas">
          {!loading && conversations.length === 0 ? <div className="card muted">Nenhuma conversa encontrada.</div> : null}
          {conversations.map((conversation) => (
            <button
              className={`conversation-card ${selectedId === conversation.id ? 'conversation-card-active' : ''}`}
              key={conversation.id}
              type="button"
              onClick={() => setSelectedId(conversation.id)}
            >
              <span className="conversation-card-head">
                <strong>{conversation.lead?.name ?? 'Lead sem nome'}</strong>
                <small>{formatDate(conversation.lastMessageAt ?? conversation.updatedAt)}</small>
              </span>
              <span className="muted">{conversation.lead?.phone ?? conversation.channel ?? 'Sem telefone'}</span>
              <span className="conversation-preview">{firstMessage(conversation)}</span>
              <span className="chips">
                <span className="chip">{conversation.channel ?? 'Canal'}</span>
                <span className="chip">{conversation.status}</span>
                <span className={`chip ${riskClass(conversation.aiSuggestions?.[0]?.riskLevel)}`}>
                  {conversation.aiSuggestions?.[0]?.riskLevel ?? 'low'}
                </span>
                <span className="chip">{conversation.lead?.score ?? 0}</span>
                <span className="chip">{temperatureLabel(conversation.lead?.temperature)}</span>
                {conversation.needsHuman ? <span className="chip chip-danger">humano</span> : null}
              </span>
            </button>
          ))}
        </aside>

        <section className="thread-panel" aria-label="Thread da conversa">
          {!selectedId ? (
            <div className="empty-thread">
              <MessageSquareText size={28} />
              <strong>Selecione uma conversa</strong>
              <span className="muted">A thread, sugestoes e dados do contato aparecem aqui.</span>
            </div>
          ) : detailLoading || !selected ? (
            <div className="card muted">Carregando conversa...</div>
          ) : (
            <>
              <header className="thread-head">
                <div>
                  <h2 className="title">{selected.lead.name}</h2>
                  <div className="muted">{selected.channel ?? 'Canal nao informado'} · {selected.status}</div>
                </div>
                {selected.needsHuman ? <span className="chip chip-danger"><AlertTriangle size={14} />Precisa humano</span> : null}
              </header>

              <div className="message-thread">
                {selected.messages.length === 0 ? <div className="card muted">Nenhuma mensagem registrada.</div> : null}
                {selected.messages.map((message) => (
                  <article className={`message-bubble ${message.direction === 'OUT' ? 'message-out' : 'message-in'}`} key={message.id}>
                    <div>{message.body}</div>
                    <small>{message.direction === 'OUT' ? (message.agentHandled ? 'Clinica (auto)' : 'Clinica') : 'Paciente'} · {formatDate(message.sentAt)}</small>
                  </article>
                ))}
              </div>

              {feedback ? <div className="card muted">{feedback}</div> : null}

              <div className="composer">
                <textarea
                  className="textarea"
                  placeholder="Escreva uma resposta manual..."
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                />
                <div className="suggestion-actions">
                  <button className="btn btn-primary" disabled={sending || !reply.trim()} type="button" onClick={sendManualReply}>
                    <Send size={16} />{sending ? 'Enviando...' : 'Enviar WhatsApp'}
                  </button>
                  <button className="btn" disabled={suggesting} type="button" onClick={generateSuggestion}>
                    <Bot size={16} />{suggesting ? 'Gerando...' : 'Gerar sugestao Tawany'}
                  </button>
                </div>
              </div>

              {selected.aiSuggestions.map((suggestion) => (
                <div className="suggestion" key={suggestion.id}>
                  <div className="chips">
                    <span className={`chip ${riskClass(suggestion.riskLevel)}`}>{suggestion.riskLevel ?? 'low'}</span>
                    <span className="chip">sugestao IA</span>
                  </div>
                  <textarea className="textarea" id={`suggestion-${suggestion.id}`} defaultValue={suggestion.body} />
                  <div className="suggestion-actions">
                    <button className="btn btn-primary" type="button" onClick={() => approve(selected.id, suggestion.id, suggestion.body)}>
                      <Check size={16} />Aprovar e enviar
                    </button>
                    <button className="btn btn-danger" type="button" onClick={() => reject(selected.id, suggestion.id)}>
                      <X size={16} />Descartar
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </section>

        <aside className="contact-panel" aria-label="Dados do contato">
          {!selected ? (
            <div className="card muted">Sem contato selecionado.</div>
          ) : (
            <>
              <div className="contact-card">
                <UserRound size={22} />
                <div>
                  <strong>{selected.lead.name}</strong>
                  <div className="muted">{selected.lead.phone ?? selected.patient?.phone ?? 'Telefone nao informado'}</div>
                </div>
              </div>
              <dl className="detail-list">
                <div><dt>E-mail</dt><dd>{selected.lead.email ?? selected.patient?.email ?? 'Nao informado'}</dd></div>
                <div><dt>Origem</dt><dd>{selected.lead.source ?? 'Nao informada'}</dd></div>
                <div><dt>Intencao</dt><dd>{selected.lead.intent ?? 'Nao informada'}</dd></div>
                <div><dt>Score</dt><dd>{selected.lead.score ?? 0}</dd></div>
                <div><dt>Temperatura</dt><dd>{temperatureLabel(selected.lead.temperature)}</dd></div>
                <div><dt>Estagio</dt><dd>{selected.lead.stage?.name ?? 'Sem estagio'}</dd></div>
                <div><dt>Proxima acao</dt><dd>{selected.lead.nextAction ?? 'Sem acao definida'}</dd></div>
              </dl>
              <div className="panel-block">
                <h3>Tags</h3>
                <div className="chips">
                  {(selected.lead.tags ?? []).length === 0 ? <span className="muted">Sem tags</span> : null}
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
                  <button className="btn" type="button" onClick={addTag}><Plus size={14} /></button>
                </div>
              </div>
              <div className="panel-block">
                <h3>Tarefas</h3>
                {selected.tasks.length === 0 ? <div className="muted">Sem tarefas abertas</div> : null}
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
                  <button className="btn" type="button" onClick={createTask}><Plus size={14} /></button>
                </div>
              </div>
              <div className="suggestion-actions">
                <button className="btn" type="button" onClick={markHuman}><AlertTriangle size={15} />Marcar humano</button>
                <button className="btn" type="button" onClick={resolve}><CheckCheck size={15} />Resolver</button>
              </div>
            </>
          )}
        </aside>
      </section>
    </main>
  );
}
