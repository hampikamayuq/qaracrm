import { z } from 'zod';
import type { DataApi } from 'src/lib/data';
import { isMetaSendConfigured, sendViaMeta } from 'src/lib/whatsapp-client';

// Fase 2: envio real via Meta Cloud API quando configurado; sem config
// (dev/test) mantém o comportamento Fase 1 de apenas registrar no CRM.
export const sendWhatsApp = {
  name: 'sendWhatsApp',
  description: 'Envia mensagem WhatsApp para uma conversa via Meta Cloud API.',
  parameters: z.object({
    conversationId: z.string().uuid(),
    text: z.string().min(1).max(1024),
  }),
  execute: async (args: { conversationId: string; text: string }, ctx: DataApi): Promise<string> => {
    const conv = await ctx.get('conversation', args.conversationId, {
      id: true,
      channel: true,
      externalId: true,
    });
    if (!conv) return JSON.stringify({ ok: false, error: 'conversation_not_found' });

    const to = typeof conv.externalId === 'string' ? conv.externalId : '';
    const canSend = isMetaSendConfigured() && conv.channel === 'WHATSAPP' && to.length > 0;
    // Erro do sendViaMeta propaga: o tawany-handler converte em handoff.
    const wamid = canSend ? await sendViaMeta(to, args.text) : null;

    const message = await ctx.create('chatMessage', {
      body: args.text,
      direction: 'OUT',
      sentAt: new Date().toISOString(),
      conversationId: args.conversationId,
      messageType: 'TEXT',
      deliveryStatus: wamid ? 'SENT' : 'PENDING',
      agentHandled: true,
      ...(wamid ? { externalId: wamid } : {}),
    });
    await ctx.update('conversation', args.conversationId, { lastMessageAt: new Date().toISOString() });
    // No console.log of message body — outbound text is patient PHI.
    return JSON.stringify({ ok: true, sent: Boolean(wamid), messageId: message.id });
  },
};
