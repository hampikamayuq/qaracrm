import { pushWebChatEvent } from './web-chat-events';

// Envio para o widget WEB: empurra a resposta (OUT) no SSE da sessão. A
// persistência do ChatMessage OUT fica no sendWhatsApp (branch WEB), que chama
// esta função com o messageId já gravado — o widget recebe o mesmo id que o
// histórico do CRM.
//
// Sem listener conectado o push só retorna 0 (o visitante fechou a aba); NÃO é
// erro — a mensagem já está persistida e o widget busca o histórico ao
// reconectar (GET /api/web-chat/history/:webSessionId).
export const sendViaWeb = (
  webSessionId: string,
  text: string,
  messageId: string,
  at: string,
): { delivered: number } => {
  const delivered = pushWebChatEvent(webSessionId, {
    type: 'message',
    direction: 'OUT',
    text,
    at,
    messageId,
  });
  return { delivered };
};
