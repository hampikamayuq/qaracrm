'use client';

import { useEffect, useState } from 'react';
import { Search, Zap } from 'lucide-react';
import { api, type QuickReply } from '@/lib/api';

// Picker de respostas rápidas do composer do inbox — abre um menu com busca
// por título/atalho/conteúdo (mesmo padrão visual de FilterMenu, com um
// campo de busca a mais). onSelect recebe o content bruto (com {{nome}}/
// {{primeiro_nome}}/{{unidade}}); quem chama decide como substituir.
export function QuickReplyPicker({ onSelect }: { onSelect: (content: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const timer = window.setTimeout(() => {
      api.getQuickReplies(search || undefined)
        .then(setItems)
        .finally(() => setLoading(false));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [open, search]);

  return (
    <div className="menu-anchor quick-reply-anchor">
      <button
        type="button"
        className="btn"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Inserir resposta rápida"
      >
        <Zap size={15} />Respostas rápidas
      </button>

      {open ? (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu quick-reply-menu" role="listbox" aria-label="Respostas rápidas">
            <div className="search-field quick-reply-search">
              <Search size={14} />
              <input
                className="input"
                autoFocus
                placeholder="Buscar por título…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            {loading ? <div className="quick-reply-empty muted">Carregando…</div> : null}
            {!loading && items.length === 0 ? (
              <div className="quick-reply-empty muted">Nenhuma resposta rápida encontrada.</div>
            ) : null}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="menu-item quick-reply-item"
                role="option"
                onClick={() => {
                  onSelect(item.content);
                  setOpen(false);
                  setSearch('');
                }}
              >
                <span className="quick-reply-item-title">{item.title}</span>
                <span className="quick-reply-item-preview">{item.content}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
