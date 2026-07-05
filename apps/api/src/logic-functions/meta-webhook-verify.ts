import { defineLogicFunction } from 'twenty-sdk/define';
import { Response, type RoutePayload } from 'twenty-sdk/logic-function';

// GET handshake do Meta: ecoa hub.challenge se o verify token confere.
export const handleMetaVerify = (
  event: Pick<RoutePayload, 'queryStringParameters'>,
): Response => {
  const q = event.queryStringParameters ?? {};
  const verifyToken = process.env.META_VERIFY_TOKEN;
  const valid =
    Boolean(verifyToken) && q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === verifyToken;
  if (!valid) return new Response('Forbidden', { status: 403 });
  return new Response(q['hub.challenge'] ?? '', { status: 200 });
};

export default defineLogicFunction({
  universalIdentifier: 'e35bb4c5-8735-4ad1-ae1b-3fd77a30f993',
  name: 'meta-webhook-verify',
  description: 'Handshake GET do webhook Meta (hub.challenge).',
  timeoutSeconds: 10,
  httpRouteTriggerSettings: {
    path: '/meta/webhook',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
  handler: handleMetaVerify,
});
