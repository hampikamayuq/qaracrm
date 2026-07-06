'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Bot, Check, MessageSquareText, Search, Send, UserRound, X } from 'lucide-react';
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
    setDetailLoading(true);
    api.getConversation(selectedId).then(setSelected).finally(() => setDetailLoading(false));
  }, [selectedId]);

  const approve = async (conversationId: string, suggestionId: string, original: string) => {
    const textarea = document.getElementById(`suggestion-${suggestionId}`) as HTMLTextAreaElement | null;
    const body = textarea?.value.trim();
    await api.approveSuggestion(suggestionId, body && body !== original ? body : undefined);
    setConversations((items) => items.map((item) => (
      item.id === conversationId
        ? { ...item, aiSuggestions: item.aiSuggestions?.filter((suggestion) => suggestion.id !== suggestionId) }
        : item
    )));
    setSelected((item) => item?.id === conversationId
      ? { ...item, aiSuggestions: item.aiSuggestions.filter((suggestion) => suggestion.id !== suggestionId) }
      : item);
  };

  const reject = async (conversationId: string, suggestionId: string) => {
    await api.rejectSuggestion(suggestionId);
    setConversations((items) => items.map((item) => (
      item.id === conversationId
        ? { ...item, aiSuggestions: item.aiSuggestions?.filter((suggestion) => suggestion.id !== suggestionId) }
        : item
    )));
    setSelected((item) => item?.id === conversationId
      ? { ...item, aiSuggestions: item.aiSuggestions.filter((suggestion) => suggestion.id !== suggestionId) }
      : item);
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
                    <small>{message.direction === 'OUT' ? 'Clinica' : 'Paciente'} · {formatDate(message.sentAt)}</small>
                  </article>
                ))}
              </div>

              <div className="composer">
                <textarea className="textarea" disabled placeholder="Resposta manual entra na Fase 3" title="Endpoint de envio manual sera criado na Fase 3" />
                <div className="suggestion-actions">
                  <button className="btn" disabled title="Endpoint de envio manual sera criado na Fase 3" type="button">
                    <Send size={16} />Enviar WhatsApp
                  </button>
                  <button className="btn" disabled title="Endpoint de sugestao manual sera criado na Fase 3" type="button">
                    <Bot size={16} />Gerar sugestao Tawany
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
                  {(selected.lead.tags ?? []).map((tag) => <span className="chip" key={tag}>{tag}</span>)}
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
              </div>
              <div className="suggestion-actions">
                <button className="btn" disabled title="Endpoint de handoff sera criado na Fase 3" type="button">Marcar humano</button>
                <button className="btn" disabled title="Endpoint de status sera criado na Fase 3" type="button">Resolver</button>
              </div>
            </>
          )}
        </aside>
      </section>
    </main>
  );
}
