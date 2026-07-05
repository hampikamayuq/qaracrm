import { z } from 'zod';
import type { DataApi } from 'src/lib/data';

const LEAD_SELECT = { id: true, name: true, whatsapp: true, email: true, source: true, intent: true, stage: true, score: true, tags: true };

export const readLead = {
  name: 'readLead',
  description: 'Busca dados completos de um lead por ID. Retorna null se não existir.',
  parameters: z.object({
    leadId: z.string().uuid().describe('UUID do lead'),
  }),
  execute: async (args: { leadId: string }, ctx: DataApi): Promise<string> => {
    const result = await ctx.get('lead', args.leadId, LEAD_SELECT);
    return JSON.stringify(result ?? null);
  },
};
