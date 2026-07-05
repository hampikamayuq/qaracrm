import { z } from 'zod';
import type { DataApi } from 'src/lib/data';

export const readConversationHistory = {
  name: 'readConversationHistory',
  description: 'Retorna as últimas N mensagens de uma conversa, da mais antiga para a mais nova.',
  parameters: z.object({
    conversationId: z.string().uuid(),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  execute: async (args: { conversationId: string; limit: number }, ctx: DataApi): Promise<string> => {
    const messages = await ctx.list('chatMessage', {
      filter: { conversationId: { eq: args.conversationId } },
      orderBy: { sentAt: 'DESC' },
      limit: args.limit,
      select: { id: true, direction: true, body: true, sentAt: true },
    });
    return JSON.stringify(messages.reverse());
  },
};
