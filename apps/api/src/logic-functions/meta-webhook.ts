import { type DataApi } from '../lib/data';
import { defaultDebounce, type Debouncer } from '../lib/debounce';
import { parseMetaEvent, type MetaInboundMessage, type MetaStatusUpdate } from '../lib/meta-parse';
import { sendWhatsApp } from '../lib/tools/sendWhatsApp';

const OPT_OUT_CONFIRMATION =
  'Você foi removido da nossa lista de contatos. Se mudar de ideia, é só enviar uma mensagem.';

export type MetaWebhookProcessingResult = {
  processedMessages: Array<{ conversationId: string; messageId: string }>;
};

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
  const created = await data.create('conversation', {
    channel: msg.channel,
    externalId: msg.from,
    status: 'OPEN',
    lastMessageAt: msg.sentAt,
  });
  return { id: created.id as string, leadId: created.leadId as string | null | undefined };
};

const ingestMessage = async (
  msg: MetaInboundMessage,
  data: DataApi,
  debounce: Debouncer,
): Promise<{ conversationId: string; messageId: string } | null> => {
  const dup = await data.list('chatMessage', {
    filter: { externalId: { eq: msg.externalId } },
    limit: 1,
    select: { id: true },
  });
  if (dup.length > 0) return null; // Meta retry — já processada

  const conversation = await findOrCreateConversation(msg, data);
  const gate = debounce.check(conversation.id, msg.externalId, msg.text);
  const created = await data.create('chatMessage', {
    conversationId: conversation.id,
    direction: 'IN',
    body: msg.text,
    sentAt: msg.sentAt,
    externalId: msg.externalId,
    messageType: msg.messageType,
    agentHandled: gate.status !== 'process',
  });

  if (gate.status === 'optout') {
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
  if (gate.status === 'skip') {
    console.log(JSON.stringify({ event: 'meta_debounce_skip', conversationId: conversation.id, messageId: msg.externalId }));
    return null;
  }
  const messageId = typeof created.id === 'string' ? created.id : '';
  return messageId ? { conversationId: conversation.id, messageId } : null;
};

export const handleMetaWebhook = async (
  body: unknown,
  data: DataApi,
  debounce: Debouncer = defaultDebounce,
): Promise<MetaWebhookProcessingResult> => {
  const { messages, statuses } = parseMetaEvent(body);
  const processedMessages: MetaWebhookProcessingResult['processedMessages'] = [];
  for (const status of statuses) await applyStatus(status, data);
  for (const msg of messages) {
    const processed = await ingestMessage(msg, data, debounce);
    if (processed) processedMessages.push(processed);
  }

  console.log(
    JSON.stringify({ event: 'meta_webhook', messages: messages.length, statuses: statuses.length }),
  );
  return { processedMessages };
};
