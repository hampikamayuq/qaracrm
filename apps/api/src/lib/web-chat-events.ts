import type { Response } from 'express';

// ponytail: emitter em memória por sessão, single-instance (Render roda 1
// instância); se escalar horizontal, trocar por Redis pub/sub.

// SSE do widget WEB: cada visitante tem um webSessionId (UUID opaco) e uma ou
// mais abas conectadas. Diferente do events.ts do CRM (broadcast global para
// atendentes autenticados), aqui o push é endereçado à sessão do visitante.

export type WebChatOutEvent = {
  type: 'message';
  direction: 'OUT';
  text: string;
  at: string;
  messageId: string;
};

// Teto de conexões simultâneas por sessão: evita que um cliente hostil abra
// milhares de EventSource para a mesma sessão e segure memória/sockets.
const MAX_CONNECTIONS_PER_SESSION = 5;

const sessions = new Map<string, Set<Response>>();

// Registra uma conexão SSE para a sessão. Retorna false (recusa) quando a
// sessão já atingiu o teto de conexões — a rota responde 429.
export const addWebChatListener = (webSessionId: string, res: Response): boolean => {
  const set = sessions.get(webSessionId) ?? new Set<Response>();
  if (set.size >= MAX_CONNECTIONS_PER_SESSION) return false;
  set.add(res);
  sessions.set(webSessionId, set);
  return true;
};

export const removeWebChatListener = (webSessionId: string, res: Response): void => {
  const set = sessions.get(webSessionId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) sessions.delete(webSessionId);
};

export const webChatListenerCount = (webSessionId: string): number =>
  sessions.get(webSessionId)?.size ?? 0;

// Push protegido: um res.write que lança (conexão morta) nunca quebra o envio
// que emitiu — só loga. Retorna quantas conexões receberam o evento.
export const pushWebChatEvent = (webSessionId: string, event: WebChatOutEvent): number => {
  const set = sessions.get(webSessionId);
  if (!set || set.size === 0) return 0;
  const payload = `event: message\ndata: ${JSON.stringify(event)}\n\n`;
  let delivered = 0;
  for (const res of set) {
    try {
      res.write(payload);
      delivered++;
    } catch (err) {
      console.error('[web-chat-events] push failed (non-fatal):', (err as Error).message);
    }
  }
  return delivered;
};
