import { z } from 'zod';
import type { DataApi } from 'src/lib/data';

const PRO_SELECT = { id: true, name: true, specialty: true, modality: true, defaultPriceCents: true, rjPriceCents: true, spPriceCents: true, telePriceCents: true };

export const listProfessionals = {
  name: 'listProfessionals',
  description: 'Lista médicos ativos, opcionalmente filtrados por especialidade. Preços em centavos.',
  parameters: z.object({
    specialty: z.enum(['CIRURGIA', 'UNHAS', 'TRICOLOGIA', 'AUTOIMUNE', 'DERMATOPEDIATRIA']).optional(),
  }),
  execute: async (args: { specialty?: string }, ctx: DataApi): Promise<string> => {
    const filter: Record<string, unknown> = { active: { eq: true } };
    if (args.specialty) filter.specialty = { eq: args.specialty };
    const pros = await ctx.list('professional', { filter, select: PRO_SELECT });
    return JSON.stringify(pros);
  },
};
