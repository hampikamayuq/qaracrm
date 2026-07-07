import { z } from 'zod';
import type { DataApi } from 'src/lib/data';

// Preços vivem em Service.priceCents (Professional não tem colunas de preço).
const PRO_SELECT = { id: true, name: true, specialty: true };
const SERVICE_SELECT = { name: true, priceCents: true, professionalId: true };

export const listProfessionals = {
  name: 'listProfessionals',
  description: 'Lista médicos ativos com seus serviços e preços (em centavos), opcionalmente filtrados por especialidade.',
  parameters: z.object({
    specialty: z.enum(['CIRURGIA', 'UNHAS', 'TRICOLOGIA', 'AUTOIMUNE', 'DERMATOPEDIATRIA']).optional(),
  }),
  execute: async (args: { specialty?: string }, ctx: DataApi): Promise<string> => {
    const filter: Record<string, unknown> = { active: { eq: true } };
    if (args.specialty) filter.specialty = { eq: args.specialty };
    const pros = (await ctx.list('professional', { filter, select: PRO_SELECT })) as {
      id: string; name: string; specialty: string | null;
    }[];
    const services = (await ctx.list('service', {
      filter: { active: { eq: true } },
      select: SERVICE_SELECT,
    })) as { name: string; priceCents: number; professionalId: string | null }[];
    return JSON.stringify(
      pros.map((p) => ({
        ...p,
        services: services
          .filter((s) => s.professionalId === p.id)
          .map(({ name, priceCents }) => ({ name, priceCents })),
      })),
    );
  },
};
