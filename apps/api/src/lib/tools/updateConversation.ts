import { z } from 'zod';
import type { DataApi } from 'src/lib/data';

export const updateConversation = {
  name: 'updateConversation',
  description: 'Atualiza o status de uma conversa. Apenas o campo status é permitido.',
  parameters: z.object({
    conversationId: z.string().uuid(),
    status: z.enum(['OPEN', 'NEEDS_HUMAN', 'RESOLVED', 'ARCHIVED']),
  }),
  execute: async (
    args: { conversationId: string; status: 'OPEN' | 'NEEDS_HUMAN' | 'RESOLVED' | 'ARCHIVED' },
    ctx: DataApi,
  ): Promise<string> => {
    const result = await ctx.update('conversation', args.conversationId, { status: args.status });
    return JSON.stringify(result);
  },
};
