'use client';

import { useEffect, useState } from 'react';
import { Check, Search, Send, X } from 'lucide-react';
import { api, type Conversation } from '@/lib/api';

type StatusFilter = 'OPEN' | 'ALL' | 'HUMAN';

const riskClass = (risk: string | null | undefined) => (
  risk === 'high' ? 'chip-danger' : risk === 'medium' ? 'chip-warning' : 'chip-ok'
);

export default function InboxPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('OPEN');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      api.getConversations({
        search: search || undefined,
        status: status === 'ALL' || status === 'HUMAN' ? undefined : status,
        needsHuman: status === 'HUMAN' ? true : undefined,
      }).then((data) => setConversations(data.items)).finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, status]);

  const approve = async (conversationId: string, suggestionId: string, original: string) => {
    const textarea = document.getElementById(`suggestion-${suggestionId}`) as HTMLTextAreaElement | null;
    const body = textarea?.value.trim();
    await api.approveSuggestion(suggestionId, body && body !== original ? body : undefined);
    setConversations((items) => items.map((item) => (
      item.id === conversationId
        ? { ...item, aiSuggestions: item.aiSuggestions?.filter((suggestion) => suggestion.id !== suggestionId) }
        : item
    )));
  };

  const reject = async (conversationId: string, suggestionId: string) => {
    await api.rejectSuggestion(suggestionId);
    setConversations((items) => items.map((item) => (
      item.id === conversationId
        ? { ...item, aiSuggestions: item.aiSuggestions?.filter((suggestion) => suggestion.id !== suggestionId) }
        : item
    )));
  };

  return (
    <main className="page">
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

      <section className="list">
        {!loading && conversations.length === 0 ? <div className="card muted">Nenhuma conversa encontrada.</div> : null}
        {conversations.map((conversation) => (
          <article className="card" key={conversation.id}>
            <div className="card-head">
              <div>
                <div className="lead-name">{conversation.lead?.name ?? 'Lead sem nome'}</div>
                <div className="muted">{new Date(conversation.updatedAt).toLocaleString('pt-BR')}</div>
              </div>
              <div className="chips">
                <span className="chip">{conversation.status}</span>
                {conversation.needsHuman ? <span className="chip chip-danger">humano</span> : null}
              </div>
            </div>

            {conversation.messages?.map((message) => (
              <p className="message" key={`${message.sentAt}-${message.body}`}>{message.body}</p>
            ))}

            {conversation.aiSuggestions?.map((suggestion) => (
              <div className="suggestion" key={suggestion.id}>
                <div className="chips">
                  <span className={`chip ${riskClass(suggestion.riskLevel)}`}>{suggestion.riskLevel ?? 'low'}</span>
                  <span className="chip">sugestao IA</span>
                </div>
                <textarea className="textarea" id={`suggestion-${suggestion.id}`} defaultValue={suggestion.body} />
                <div className="suggestion-actions">
                  <button className="btn btn-primary" type="button" onClick={() => approve(conversation.id, suggestion.id, suggestion.body)}>
                    <Send size={16} />Enviar
                  </button>
                  <button className="btn btn-danger" type="button" onClick={() => reject(conversation.id, suggestion.id)}>
                    <X size={16} />Rejeitar
                  </button>
                </div>
              </div>
            ))}
          </article>
        ))}
      </section>
    </main>
  );
}
