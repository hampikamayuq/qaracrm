import { z } from 'zod';
import type { DataApi } from 'src/lib/data';

export const handoffToHuman = {
  name: 'handoffToHuman',
  description: 'Transfere a conversa para atendimento humano. Seta needsHuman=true e encerra o turno da Tawany.',
  parameters: z.object({
    conversationId: z.string().uuid(),
    reason: z.string().min(1).max(200).describe('Motivo do handoff (ex: "urgencia", "conflito_valor")'),
  }),
  execute: async (args: { conversationId: string; reason: string }, ctx: DataApi): Promise<string> => {
    const result = await ctx.update('conversation', args.conversationId, {
      needsHuman: true,
      handoffReason: args.reason,
      status: 'NEEDS_HUMAN',
    });
    return JSON.stringify(result);
  },
};
