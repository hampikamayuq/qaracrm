import { type DataApi } from '../lib/data';
import { runBotsForInbound } from '../lib/bots/runner';
import { defaultDebounce, type Debouncer } from '../lib/debounce';
import { parseMetaEvent, type MetaInboundMessage, type MetaStatusUpdate } from '../lib/meta-parse';
import { sendWhatsApp } from '../lib/tools/sendWhatsApp';
import { runAppointmentConfirmationForInbound } from './appointment-confirmation';

const OPT_OUT_CONFIRMATION =
  'Você foi removido da nossa lista de contatos. Se mudar de ideia, é só enviar uma mensagem.';

export type MetaWebhookProcessingResult = {
  processedMessages: Array<{ conversationId: string; messageId: string }>;
};

export type ProcessedMessageHandler = (message: { conversationId: string; messageId: string }) => void | Promise<void>;

const applyStatus = async (status: MetaStatusUpdate, data: DataApi): Promise<void> => {
  const found = await data.list('chatMessage', {
    filter: { externalId: { eq: status.externalId } },
    limit: 1,
    select: { id: true },
  });
  if (found[0]) {
    await data.update('chatMessage', found[0].id as string, { deliveryStatus: status.status });
  }
};

// Conversation.leadId é obrigatório no schema — todo primeiro contato precisa
// de um Lead antes da conversa poder existir.
const findOrCreateLead = async (msg: MetaInboundMessage, data: DataApi): Promise<string> => {
  const existing = await data.list('lead', {
    filter: { phone: { eq: msg.from } },
    limit: 1,
    select: { id: true },
  });
  if (existing[0]) return existing[0].id as string;
  const created = await data.create('lead', {
    name: msg.from,
    phone: msg.from,
    source: msg.channel,
  });
  return created.id as string;
};

const findOrCreateConversation = async (
  msg: MetaInboundMessage,
  data: DataApi,
): Promise<{ id: string; leadId?: string | null }> => {
  const existing = await data.list('conversation', {
    filter: { channel: { eq: msg.channel }, externalId: { eq: msg.from } },
    limit: 1,
    select: { id: true, leadId: true },
  });
  if (existing[0]) return { id: existing[0].id as string, leadId: existing[0].leadId as string | null | undefined };

  const leadId = await findOrCreateLead(msg, data);
  const created = await data.create('conversation', {
    leadId,
    channel: msg.channel,
    externalId: msg.from,
    status: 'OPEN',
    lastMessageAt: msg.sentAt,
  });
  return { id: created.id as string, leadId };
};

const ingestMessage = async (
  msg: MetaInboundMessage,
  data: DataApi,
  debounce: Debouncer,
  onProcessedMessage?: ProcessedMessageHandler,
): Promise<{ conversationId: string; messageId: string } | null> => {
  const dup = await data.list('chatMessage', {
    filter: { externalId: { eq: msg.externalId } },
    limit: 1,
    select: { id: true },
  });
  if (dup.length > 0) return null; // Meta retry — já processada

  const conversation = await findOrCreateConversation(msg, data);
  const optout = debounce.isOptOut(msg.text);
  const immediateGate = !onProcessedMessage && !optout
    ? debounce.check(conversation.id, msg.externalId, msg.text)
    : null;
  const created = await data.create('chatMessage', {
    conversationId: conversation.id,
    direction: 'IN',
    body: msg.text,
    sentAt: msg.sentAt,
    externalId: msg.externalId,
    messageType: msg.messageType,
    agentHandled: Boolean(onProcessedMessage) || optout || immediateGate?.status !== 'process',
  });
  const messageId = typeof created.id === 'string' ? created.id : '';

  if (optout) {
    debounce.check(conversation.id, messageId || msg.externalId, msg.text);
    if (conversation.leadId) {
      await data.update('lead', conversation.leadId, { optedOut: true, optedOutAt: new Date() });
    }
    await data.update('conversation', conversation.id, {
      lastMessageAt: msg.sentAt,
      needsHuman: true,
      status: 'PENDING_HUMAN',
      handoffReason: 'opt_out_detected',
    });
    await sendWhatsApp.execute({ conversationId: conversation.id, text: OPT_OUT_CONFIRMATION }, data);
    console.log(JSON.stringify({ event: 'meta_optout', conversationId: conversation.id, messageId: msg.externalId }));
    return null;
  }

  await data.update('conversation', conversation.id, { lastMessageAt: msg.sentAt });

  const processReadyMessage = async (ready: { conversationId: string; messageId: string; text: string }): Promise<void> => {
    await data.update('chatMessage', ready.messageId, { agentHandled: false });
    // Confirmação de agendamento (botão do lembrete D-1) tem precedência sobre
    // bots e a Tawany: se casar, ela responde e a mensagem não segue adiante.
    let handled = false;
    try {
      handled = (await runAppointmentConfirmationForInbound({
        conversationId: ready.conversationId,
        messageType: msg.messageType,
        buttonPayload: msg.buttonPayload,
      }, data)).handled;
    } catch (err) {
      console.error('[meta-webhook] appointment confirmation failed (non-fatal):', (err as Error).message);
    }
    if (!handled) {
      try {
        handled = (await runBotsForInbound({ conversationId: ready.conversationId, text: ready.text }, data)) !== null;
      } catch (err) {
        console.error('[meta-webhook] bot runner failed (non-fatal):', (err as Error).message);
      }
    }
    if (!handled) {
      await onProcessedMessage?.({ conversationId: ready.conversationId, messageId: ready.messageId });
    }
  };

  const gate = immediateGate ?? debounce.check(
    conversation.id,
    messageId || msg.externalId,
    msg.text,
    processReadyMessage,
  );

  if (gate.status === 'defer') {
    return null;
  }
  if (gate.status === 'skip') {
    console.log(JSON.stringify({ event: 'meta_debounce_skip', conversationId: conversation.id, messageId: msg.externalId }));
    return null;
  }
  return messageId ? { conversationId: conversation.id, messageId } : null;
};

export const handleMetaWebhook = async (
  body: unknown,
  data: DataApi,
  debounce: Debouncer = defaultDebounce,
  onProcessedMessage?: ProcessedMessageHandler,
): Promise<MetaWebhookProcessingResult> => {
  const { messages, statuses } = parseMetaEvent(body);
  const processedMessages: MetaWebhookProcessingResult['processedMessages'] = [];
  for (const status of statuses) await applyStatus(status, data);
  for (const msg of messages) {
    const processed = await ingestMessage(msg, data, debounce, onProcessedMessage);
    if (!processed) continue;
    // Confirmação de agendamento (botão do lembrete D-1) tem precedência sobre
    // bots e a Tawany: se casar, ela responde e a mensagem não segue adiante.
    let handled = false;
    try {
      handled = (await runAppointmentConfirmationForInbound({
        conversationId: processed.conversationId,
        messageType: msg.messageType,
        buttonPayload: msg.buttonPayload,
      }, data)).handled;
    } catch (err) {
      console.error('[meta-webhook] appointment confirmation failed (non-fatal):', (err as Error).message);
    }
    // Bots determinísticos têm precedência sobre a Tawany: se um fluxo
    // importado casa, ele responde e a mensagem não segue para a IA.
    if (!handled) {
      try {
        handled = (await runBotsForInbound({ conversationId: processed.conversationId, text: msg.text }, data)) !== null;
      } catch (err) {
        console.error('[meta-webhook] bot runner failed (non-fatal):', (err as Error).message);
      }
    }
    if (!handled) processedMessages.push(processed);
  }

  console.log(
    JSON.stringify({ event: 'meta_webhook', messages: messages.length, statuses: statuses.length }),
  );
  return { processedMessages };
};
