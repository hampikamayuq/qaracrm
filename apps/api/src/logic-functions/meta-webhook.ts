import { type DataApi } from '../lib/data';
import { parseMetaEvent, type MetaInboundMessage, type MetaStatusUpdate } from '../lib/meta-parse';

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
): Promise<string> => {
  const existing = await data.list('conversation', {
    filter: { channel: { eq: msg.channel }, externalId: { eq: msg.from } },
    limit: 1,
    select: { id: true },
  });
  if (existing[0]) return existing[0].id as string;
  const created = await data.create('conversation', {
    channel: msg.channel,
    externalId: msg.from,
    status: 'OPEN',
    lastMessageAt: msg.sentAt,
  });
  return created.id as string;
};

const ingestMessage = async (msg: MetaInboundMessage, data: DataApi): Promise<void> => {
  const dup = await data.list('chatMessage', {
    filter: { externalId: { eq: msg.externalId } },
    limit: 1,
    select: { id: true },
  });
  if (dup.length > 0) return; // Meta retry — já processada

  const conversationId = await findOrCreateConversation(msg, data);
  // chatMessage.created dispara tawany-handler + summarize-conversation (Fase 1).
  await data.create('chatMessage', {
    conversationId,
    direction: 'IN',
    body: msg.text,
    sentAt: msg.sentAt,
    externalId: msg.externalId,
    messageType: msg.messageType,
    agentHandled: false,
  });
  await data.update('conversation', conversationId, { lastMessageAt: msg.sentAt });
};

export const handleMetaWebhook = async (
  body: unknown,
  data: DataApi,
): Promise<void> => {
  const { messages, statuses } = parseMetaEvent(body);
  for (const status of statuses) await applyStatus(status, data);
  for (const msg of messages) await ingestMessage(msg, data);

  console.log(
    JSON.stringify({ event: 'meta_webhook', messages: messages.length, statuses: statuses.length }),
  );
};
