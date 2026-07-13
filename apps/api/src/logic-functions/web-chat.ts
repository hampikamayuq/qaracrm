import type { DataApi } from '../lib/data';
import { runBotsForInbound } from '../lib/bots/runner';
import { defaultDebounce, type Debouncer } from '../lib/debounce';
import { emitInboundMessage } from '../lib/events';

// Ingestão do canal WEB (chat ao vivo no site). Núcleo copiado do
// evolution-webhook, trocando a chave de identidade e removendo o que é
// específico de WhatsApp/Instagram (WAMID, instanceId, transcrição de áudio,
// echoes de Coexistence). O visitante informa nome + telefone ao abrir o
// widget, então o Lead já nasce por telefone e converge com WhatsApp/Instagram
// do mesmo paciente. A conversa é chaveada por (channel='WEB', externalId=
// webSessionId) e cada mensagem por externalId `web-<webSessionId>-<clientMsgId>`
// (dedup de reenvio do widget). Depois: debounce → bots → Tawany (reuso), e o
// evento de inbound para o inbox do CRM (emitInboundMessage).

export type WebChatInboundMessage = {
  webSessionId: string;
  name?: string;
  phone?: string;
  text: string;
  clientMsgId: string;
  sentAt?: string;
};

export type WebChatProcessedMessage = { conversationId: string; messageId: string };

export type WebChatResult = {
  processedMessages: WebChatProcessedMessage[];
  // Primeira mensagem da sessão (não havia conversa WEB): a rota exige
  // nome+telefone nesse caso. Devolvido para a rota poder responder 400.
  isNewSession: boolean;
  conversationId: string;
  messageId: string;
};

const dedupExternalId = (msg: WebChatInboundMessage): string =>
  `web-${msg.webSessionId}-${msg.clientMsgId}`;

const findOrCreateLead = async (msg: WebChatInboundMessage, data: DataApi): Promise<string> => {
  const phone = msg.phone ?? '';
  const existing = phone
    ? await data.list('lead', {
        filter: { phone: { eq: phone } },
        limit: 1,
        select: { id: true },
      })
    : [];
  if (existing[0]) return existing[0].id as string;
  const created = await data.create('lead', {
    // Nome informado no widget é melhor que o telefone como nome inicial.
    name: msg.name || phone,
    phone,
    source: 'WEB',
  });
  return created.id as string;
};

const findConversation = async (
  webSessionId: string,
  data: DataApi,
): Promise<{ id: string; leadId?: string | null; status?: string | null } | null> => {
  const existing = await data.list('conversation', {
    filter: { channel: { eq: 'WEB' }, externalId: { eq: webSessionId } },
    limit: 1,
    select: { id: true, leadId: true, status: true },
  });
  if (!existing[0]) return null;
  return {
    id: existing[0].id as string,
    leadId: existing[0].leadId as string | null | undefined,
    status: existing[0].status as string | null | undefined,
  };
};

// Retorna a conversa existente ou null se ainda não existe (primeira mensagem
// da sessão). A rota decide se cria (nome+telefone presentes) ou rejeita 400.
export const findWebConversation = findConversation;

const createConversation = async (
  msg: WebChatInboundMessage,
  sentAt: string,
  data: DataApi,
): Promise<{ id: string; leadId: string }> => {
  const leadId = await findOrCreateLead(msg, data);
  const created = await data.create('conversation', {
    leadId,
    channel: 'WEB',
    externalId: msg.webSessionId,
    status: 'OPEN',
    lastMessageAt: sentAt,
  });
  return { id: created.id as string, leadId };
};

export const handleWebChatMessage = async (
  msg: WebChatInboundMessage,
  data: DataApi,
  debounce: Debouncer = defaultDebounce,
  onProcessedMessage?: (m: WebChatProcessedMessage) => void | Promise<void>,
): Promise<WebChatResult> => {
  const sentAt = msg.sentAt ?? new Date().toISOString();
  const externalId = dedupExternalId(msg);

  const empty: WebChatResult = {
    processedMessages: [],
    isNewSession: false,
    conversationId: '',
    messageId: '',
  };

  // Dedup: reenvio do widget (mesmo clientMsgId) não duplica a mensagem.
  const dup = await data.list('chatMessage', {
    filter: { externalId: { eq: externalId } },
    limit: 1,
    select: { id: true },
  });
  if (dup.length > 0) return empty;

  const existing = await findConversation(msg.webSessionId, data);
  const isNewSession = !existing;
  const conversation = existing ?? (await createConversation(msg, sentAt, data));

  const optout = debounce.isOptOut(msg.text);
  const immediateGate = !onProcessedMessage && !optout
    ? debounce.check(conversation.id, externalId, msg.text)
    : null;

  const created = await data.create('chatMessage', {
    conversationId: conversation.id,
    direction: 'IN',
    body: msg.text,
    sentAt,
    externalId,
    messageType: 'TEXT',
    // Nasce agentHandled até o debounce liberar (processReadyMessage remarca).
    agentHandled: Boolean(onProcessedMessage) || optout || immediateGate?.status !== 'process',
  });
  const messageId = typeof created.id === 'string' ? created.id : '';

  // Notificação em tempo real (SSE) para o Inbox do CRM. Protegida internamente.
  emitInboundMessage({
    conversationId: conversation.id,
    leadName: msg.name || undefined,
    preview: msg.text,
  });

  if (optout) {
    await data.update('conversation', conversation.id, {
      lastMessageAt: sentAt,
      needsHuman: true,
      status: 'PENDING_HUMAN',
      handoffReason: 'opt_out_detected',
    });
    const leadId = 'leadId' in conversation ? conversation.leadId : undefined;
    if (typeof leadId === 'string' && leadId) {
      await data.update('lead', leadId, { optedOut: true, optedOutAt: new Date() });
    }
    console.log(JSON.stringify({ event: 'web_optout', conversationId: conversation.id }));
    return { processedMessages: [], isNewSession, conversationId: conversation.id, messageId };
  }

  await data.update('conversation', conversation.id, { lastMessageAt: sentAt });

  const processReadyMessage = async (ready: { conversationId: string; messageId: string; text: string }): Promise<void> => {
    await data.update('chatMessage', ready.messageId, { agentHandled: false });
    // Bots antes da Tawany, como nos outros canais. Falha de bot é não-fatal.
    let handled = false;
    try {
      handled = (await runBotsForInbound({ conversationId: ready.conversationId, text: ready.text }, data))?.handled ?? false;
    } catch (err) {
      console.error('[web-chat] bot runner failed (non-fatal):', (err as Error).message);
    }
    if (!handled) {
      await onProcessedMessage?.({ conversationId: ready.conversationId, messageId: ready.messageId });
    }
  };

  const gate = immediateGate ?? debounce.check(
    conversation.id,
    messageId || externalId,
    msg.text,
    processReadyMessage,
  );

  console.log(JSON.stringify({ event: 'web_inbound', conversationId: conversation.id, gate: gate.status }));

  const processedMessages: WebChatProcessedMessage[] = [];
  if (gate.status === 'process' && messageId) {
    // Caminho imediato (sem onProcessedMessage): bots antes da Tawany.
    let handled = false;
    try {
      handled = (await runBotsForInbound({ conversationId: conversation.id, text: msg.text }, data))?.handled ?? false;
    } catch (err) {
      console.error('[web-chat] bot runner failed (non-fatal):', (err as Error).message);
    }
    if (!handled) processedMessages.push({ conversationId: conversation.id, messageId });
  }

  return { processedMessages, isNewSession, conversationId: conversation.id, messageId };
};
