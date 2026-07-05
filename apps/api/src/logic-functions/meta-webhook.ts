import { defineLogicFunction } from 'twenty-sdk/define';
import { Response, type RoutePayload } from 'twenty-sdk/logic-function';
import { createDataApi, type DataApi } from 'src/lib/data';
import { verifyMetaSignature } from 'src/lib/meta-signature';
import { parseMetaEvent, type MetaInboundMessage, type MetaStatusUpdate } from 'src/lib/meta-parse';

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
  event: RoutePayload,
  data: DataApi,
): Promise<Response> => {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return new Response('Meta not configured', { status: 503 });

  const signature = event.headers?.['x-hub-signature-256'];
  if (!event.rawBody || !verifyMetaSignature(event.rawBody, signature, appSecret)) {
    return new Response('Invalid signature', { status: 401 });
  }

  const { messages, statuses } = parseMetaEvent(event.body);
  for (const status of statuses) await applyStatus(status, data);
  for (const msg of messages) await ingestMessage(msg, data);

  console.log(
    JSON.stringify({ event: 'meta_webhook', messages: messages.length, statuses: statuses.length }),
  );
  return new Response('OK', { status: 200 });
};

export default defineLogicFunction({
  universalIdentifier: '27d865bc-66f7-407d-a49f-d3763e313c87',
  name: 'meta-webhook',
  description:
    'Recebe eventos do Meta (WhatsApp/Instagram): mensagens inbound + delivery statuses. Assinatura HMAC obrigatória.',
  timeoutSeconds: 30,
  httpRouteTriggerSettings: {
    path: '/meta/webhook',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-hub-signature-256'],
  },
  handler: (event: RoutePayload) => handleMetaWebhook(event, createDataApi()),
});
