'use client';

import { useEffect, useRef, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const RECONNECT_MS = 5_000;

export type InboundMessageEvent = {
  conversationId: string;
  leadName?: string;
  preview: string;
};

// SSE de notificações em tempo real (GET /events/stream). EventSource não
// envia headers, então o token (mesmo storage do api.ts) vai na query string.
// Reconexão: o EventSource reconecta sozinho em quedas transitórias; quando
// fecha de vez (readyState CLOSED, ex.: 401), recriamos com backoff fixo de 5s.
// Retorna `true` enquanto o stream está conectado — quem consome pode alargar
// o polling de fallback.
export const useLiveEvents = (
  onInboundMessage: (event: InboundMessageEvent) => void,
  enabled = true,
): boolean => {
  const [connected, setConnected] = useState(false);
  // Ref evita reconectar quando o callback muda entre renders.
  const handlerRef = useRef(onInboundMessage);
  handlerRef.current = onInboundMessage;

  useEffect(() => {
    if (!enabled) return;
    const token = sessionStorage.getItem('auth_token') ?? localStorage.getItem('auth_token');
    if (!token) return;

    let source: EventSource | null = null;
    let retry: number | undefined;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      source = new EventSource(`${API_BASE}/events/stream?token=${encodeURIComponent(token)}`);
      source.onopen = () => setConnected(true);
      source.addEventListener('inbound-message', (event) => {
        try {
          handlerRef.current(JSON.parse((event as MessageEvent<string>).data) as InboundMessageEvent);
        } catch {
          // payload inesperado — ignora
        }
      });
      source.onerror = () => {
        if (source?.readyState === EventSource.CLOSED) {
          setConnected(false);
          source.close();
          retry = window.setTimeout(connect, RECONNECT_MS);
        }
      };
    };
    connect();

    return () => {
      cancelled = true;
      window.clearTimeout(retry);
      source?.close();
      setConnected(false);
    };
  }, [enabled]);

  return connected;
};
