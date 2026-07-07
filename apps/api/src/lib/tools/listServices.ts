import { z } from 'zod';
import type { DataApi } from 'src/lib/data';

const SERVICE_SELECT = { id: true, name: true, description: true, category: true, priceCents: true, professionalId: true };

export const listServices = {
  name: 'listServices',
  description: 'Lista serviços ativos da clínica. Preços em centavos.',
  parameters: z.object({
    activeOnly: z.boolean().default(true),
  }),
  execute: async (args: { activeOnly: boolean }, ctx: DataApi): Promise<string> => {
    const filter = args.activeOnly ? { active: { eq: true } } : {};
    const services = await ctx.list('service', { filter, select: SERVICE_SELECT });
    return JSON.stringify(services);
  },
};
