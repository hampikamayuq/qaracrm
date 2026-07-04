import { z } from 'zod';
import type { DataApi } from 'src/lib/data';

// Fase 1: stub. Registra a mensagem outbound no CRM; o envio real via Meta
// Cloud API entra na Fase 2 (whatsapp-client.ts).
export const sendWhatsApp = {
  name: 'sendWhatsApp',
  description: 'Envia mensagem WhatsApp para uma conversa (Fase 1: registra outbound sem envio real).',
  parameters: z.object({
    conversationId: z.string().uuid(),
    text: z.string().min(1).max(1024),
  }),
  execute: async (args: { conversationId: string; text: string }, ctx: DataApi): Promise<string> => {
    const message = await ctx.create('chatMessage', {
      body: args.text,
      direction: 'OUT',
      sentAt: new Date().toISOString(),
      conversationId: args.conversationId,
      messageType: 'TEXT',
      deliveryStatus: 'PENDING',
      agentHandled: true,
    });
    await ctx.update('conversation', args.conversationId, { lastMessageAt: new Date().toISOString() });
    console.log(`[sendWhatsApp STUB] conv=${args.conversationId} text=${args.text.slice(0, 80)}`);
    return JSON.stringify({ ok: true, stub: true, messageId: message.id });
  },
};
