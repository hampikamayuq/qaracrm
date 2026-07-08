import { z } from 'zod';
import type { DataApi } from 'src/lib/data';
import { CircuitBreaker } from 'src/lib/resilience/circuit-breaker';
import { isMetaSendConfigured, sendViaMeta } from 'src/lib/whatsapp-client';

export const metaGraphBreaker = new CircuitBreaker('meta-graph', {
  threshold: 5,
  cooldownMs: 30_000,
});

const sendWindows = new Map<string, { startedAt: number; count: number }>();
const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value.replaceAll('_', ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const resetSendWhatsAppRateLimit = (): void => {
  sendWindows.clear();
};

const assertSendRateLimit = (conversationId: string): void => {
  const max = parsePositiveInt(process.env.SEND_WHATSAPP_RATE_LIMIT_PER_MINUTE, 30);
  const now = Date.now();
  const existing = sendWindows.get(conversationId);
  if (!existing || now - existing.startedAt >= 60_000) {
    sendWindows.set(conversationId, { startedAt: now, count: 1 });
    return;
  }
  if (existing.count >= max) {
    throw new Error('rate_limited:sendWhatsApp');
  }
  existing.count++;
};

export const sendWhatsApp = {
  name: 'sendWhatsApp',
  description: 'Envia mensagem WhatsApp para uma conversa via Meta Cloud API.',
  parameters: z.object({
    conversationId: z.string().uuid(),
    text: z.string().min(1).max(1024),
  }),
  execute: async (args: { conversationId: string; text: string }, ctx: DataApi & { testMode?: boolean }): Promise<string> => {
    const conv = await ctx.get('conversation', args.conversationId, {
      id: true,
      channel: true,
      externalId: true,
    });
    if (!conv) return JSON.stringify({ ok: false, error: 'conversation_not_found' });

    const to = typeof conv.externalId === 'string' ? conv.externalId : '';
    assertSendRateLimit(args.conversationId);
    
    // In test mode, never send to Meta - just record in CRM
    const isTestMode = ctx.testMode === true;
    const canSend = !isTestMode && isMetaSendConfigured() && conv.channel === 'WHATSAPP' && to.length > 0;
    const wamid = canSend
      ? await metaGraphBreaker.execute(() => sendViaMeta(to, args.text))
      : null;

    const message = await ctx.create('chatMessage', {
      body: args.text,
      direction: 'OUT',
      sentAt: new Date().toISOString(),
      conversationId: args.conversationId,
      messageType: 'TEXT',
      deliveryStatus: wamid ? 'SENT' : (isTestMode ? 'TEST_MODE' : 'PENDING'),
      agentHandled: true,
      ...(wamid ? { externalId: wamid } : {}),
    });
    await ctx.update('conversation', args.conversationId, { lastMessageAt: new Date().toISOString() });
    return JSON.stringify({ ok: true, sent: Boolean(wamid), messageId: message.id, testMode: isTestMode });
  },
};
