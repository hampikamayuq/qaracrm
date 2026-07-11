import { z } from 'zod';
import type { DataApi } from 'src/lib/data';
import { metaGraphBreaker } from './sendWhatsApp';
import { isMetaSendConfigured, sendViaMeta } from 'src/lib/whatsapp-client';

export const sendWhatsAppTemplate = {
  name: 'sendWhatsAppTemplate',
  description: 'Envia template HSM aprovado pelo WhatsApp Cloud API para uma conversa.',
  parameters: z.object({
    conversationId: z.string().uuid(),
    templateName: z.string().min(1),
    language: z.string().default('pt_BR'),
    parameters: z.array(z.string()).default([]),
  }),
  execute: async (
    args: { conversationId: string; templateName: string; language?: string; parameters?: string[] },
    ctx: DataApi,
  ): Promise<string> => {
    const conv = await ctx.get('conversation', args.conversationId, {
      id: true,
      channel: true,
      externalId: true,
    });
    if (!conv) return JSON.stringify({ ok: false, error: 'conversation_not_found' });

    // Templates HSM são exclusivos do canal oficial (Meta Cloud API). Em
    // Instagram ou números QR (WHATSAPP_QR via Evolution), gravar a mensagem
    // [template:...] só criaria um fantasma PENDING que nunca é enviado —
    // então pulamos explicitamente sem tocar no histórico.
    if (conv.channel !== 'WHATSAPP') {
      return JSON.stringify({ ok: false, skipped: true, reason: 'template_unsupported_on_channel' });
    }

    const to = typeof conv.externalId === 'string' ? conv.externalId : '';
    const canSend = isMetaSendConfigured() && conv.channel === 'WHATSAPP' && to.length > 0;
    const wamid = canSend
      ? await metaGraphBreaker.execute(() =>
          sendViaMeta(to, '', {
            messageType: 'template',
            templateName: args.templateName,
            languageCode: args.language ?? 'pt_BR',
            parameters: args.parameters ?? [],
          }),
        )
      : null;

    const message = await ctx.create('chatMessage', {
      body: `[template:${args.templateName}]`,
      direction: 'OUT',
      sentAt: new Date().toISOString(),
      conversationId: args.conversationId,
      messageType: 'TEMPLATE',
      deliveryStatus: wamid ? 'SENT' : 'PENDING',
      agentHandled: true,
      ...(wamid ? { externalId: wamid } : {}),
    });
    await ctx.update('conversation', args.conversationId, { lastMessageAt: new Date().toISOString() });
    return JSON.stringify({ ok: true, sent: Boolean(wamid), messageId: message.id });
  },
};
