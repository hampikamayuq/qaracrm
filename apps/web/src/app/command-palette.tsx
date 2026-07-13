'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CornerDownLeft, MessageSquareText, Search } from 'lucide-react';
import { api } from '@/lib/api';

type PageResult = { kind: 'page'; href: string; label: string };
type ConversationResult = { kind: 'conversation'; href: string; label: string; detail: string };
type Result = PageResult | ConversationResult;

const PAGES: Array<{ href: string; label: string; keywords: string }> = [
  { href: '/', label: 'Dashboard', keywords: 'inicio home painel' },
  { href: '/inbox', label: 'Inbox', keywords: 'conversas mensagens whatsapp chat' },
  { href: '/pipeline', label: 'Pipeline', keywords: 'kanban funil leads etapas' },
  { href: '/contacts', label: 'Contatos', keywords: 'pacientes cadastro' },
  { href: '/calendar', label: 'Agenda', keywords: 'calendario consultas horarios' },
  { href: '/quotes', label: 'Orçamentos', keywords: 'pagamentos valores orcamento' },
  { href: '/tasks', label: 'Tarefas', keywords: 'atividades pendencias todo' },
  { href: '/bots', label: 'Bots', keywords: 'respostas automaticas fluxos' },
  { href: '/reports', label: 'Relatórios', keywords: 'export csv metricas' },
  { href: '/settings', label: 'Configurações', keywords: 'ajustes settings' },
  { href: '/settings/channels', label: 'Canais', keywords: 'whatsapp qr numeros instancia' },
  { href: '/settings/knowledge', label: 'Conhecimento', keywords: 'knowledge base tawany sabe' },
  { href: '/settings/ai', label: 'IA', keywords: 'tawany modo autopilot shadow exemplos' },
];

const normalize = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const SEARCH_DEBOUNCE_MS = 250;

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [conversations, setConversations] = useState<ConversationResult[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number>(0);

  // Ctrl+K / Cmd+K abre; Esc fecha.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((cur) => !cur);
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setConversations([]);
      setHighlighted(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Busca de conversas por nome do lead (debounce; reusa GET /inbox/list?search=).
  useEffect(() => {
    window.clearTimeout(debounceRef.current);
    if (!open || query.trim().length < 2) {
      setConversations([]);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      void api.getConversations({ search: query.trim(), pageSize: 6 }).then((res) => {
        setConversations(res.items.map((c) => ({
          kind: 'conversation' as const,
          href: `/inbox?conversationId=${c.id}`,
          label: c.lead?.name ?? 'Sem nome',
          detail: c.channel === 'INSTAGRAM' ? 'Instagram' : c.channel === 'WEB' ? 'Chat do site' : 'WhatsApp',
        })));
      }).catch(() => setConversations([]));
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(debounceRef.current);
  }, [open, query]);

  const q = normalize(query.trim());
  const pages: Result[] = (q
    ? PAGES.filter((p) => normalize(`${p.label} ${p.keywords}`).includes(q))
    : PAGES
  ).map((p) => ({ kind: 'page' as const, href: p.href, label: p.label }));
  const results: Result[] = [...pages, ...conversations];

  const go = useCallback((href: string) => {
    setOpen(false);
    router.push(href);
  }, [router]);

  const onInputKey = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((cur) => Math.min(cur + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((cur) => Math.max(cur - 1, 0));
    } else if (event.key === 'Enter' && results[highlighted]) {
      event.preventDefault();
      go(results[highlighted].href);
    }
  };

  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  if (!open) {
    return (
      <button className="cmdk-trigger" type="button" onClick={() => setOpen(true)} aria-label="Buscar (Ctrl+K)">
        <Search size={14} />
        Buscar
        <kbd>Ctrl K</kbd>
      </button>
    );
  }

  return (
    <>
      <button className="cmdk-trigger" type="button" onClick={() => setOpen(true)} aria-label="Buscar (Ctrl+K)">
        <Search size={14} />
        Buscar
        <kbd>Ctrl K</kbd>
      </button>
      <div className="cmdk-overlay" role="presentation" onClick={() => setOpen(false)}>
        <div
          className="cmdk-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Busca rápida"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="cmdk-input-row">
            <Search size={16} aria-hidden="true" />
            <input
              className="cmdk-input"
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKey}
              placeholder="Ir para página ou buscar paciente…"
              aria-label="Busca rápida"
            />
          </div>
          <ul className="cmdk-list" role="listbox">
            {results.length === 0 ? (
              <li className="cmdk-empty">Nada encontrado{query.trim().length < 2 ? ' — digite 2+ letras para buscar pacientes' : ''}.</li>
            ) : null}
            {results.map((item, index) => (
              <li key={`${item.kind}-${item.href}`}>
                <button
                  className={`cmdk-item ${index === highlighted ? 'cmdk-item-active' : ''}`}
                  type="button"
                  role="option"
                  aria-selected={index === highlighted}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => go(item.href)}
                >
                  {item.kind === 'conversation' ? <MessageSquareText size={14} /> : <CornerDownLeft size={14} />}
                  <span>{item.label}</span>
                  <span className="cmdk-detail">{item.kind === 'conversation' ? item.detail : 'Página'}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
