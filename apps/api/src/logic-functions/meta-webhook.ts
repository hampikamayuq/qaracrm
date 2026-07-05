import { type DataApi } from '../lib/data';
import { defaultDebounce, type Debouncer } from '../lib/debounce';
import { parseMetaEvent, type MetaInboundMessage, type MetaStatusUpdate } from '../lib/meta-parse';
import { sendWhatsApp } from '../lib/tools/sendWhatsApp';

const OPT_OUT_CONFIRMATION =
  'Você foi removido da nossa lista de contatos. Se mudar de ideia, é só enviar uma mensagem.';

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
): Promise<void> => {
  const dup = await data.list('chatMessage', {
    filter: { externalId: { eq: msg.externalId } },
    limit: 1,
    select: { id: true },
  });
  if (dup.length > 0) return; // Meta retry — já processada

  const conversation = await findOrCreateConversation(msg, data);
  const gate = debounce.check(conversation.id, msg.externalId, msg.text);
  await data.create('chatMessage', {
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
    return;
  }

  await data.update('conversation', conversation.id, { lastMessageAt: msg.sentAt });
  if (gate.status === 'skip') {
    console.log(JSON.stringify({ event: 'meta_debounce_skip', conversationId: conversation.id, messageId: msg.externalId }));
  }
};

export const handleMetaWebhook = async (
  body: unknown,
  data: DataApi,
  debounce: Debouncer = defaultDebounce,
): Promise<void> => {
  const { messages, statuses } = parseMetaEvent(body);
  for (const status of statuses) await applyStatus(status, data);
  for (const msg of messages) await ingestMessage(msg, data, debounce);

  console.log(
    JSON.stringify({ event: 'meta_webhook', messages: messages.length, statuses: statuses.length }),
  );
};
