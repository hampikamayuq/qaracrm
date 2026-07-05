import { z } from 'zod';
import type { DataApi } from 'src/lib/data';

const TAGS = ['LEAD_QUENTE', 'LEAD_FRIO', 'NOVO', 'AGENDAR', 'FOLLOW_UP', 'NO_SHOW', 'VIP', 'HUMANO'] as const;

// Tags são um campo MULTI_SELECT no próprio registro (não objetos separados).
export const assignTag = {
  name: 'assignTag',
  description: 'Adiciona uma tag a um lead, paciente ou conversa (campo tags MULTI_SELECT).',
  parameters: z.object({
    targetType: z.enum(['lead', 'patient', 'conversation']),
    targetId: z.string().uuid(),
    tag: z.enum(TAGS),
  }),
  execute: async (
    args: { targetType: 'lead' | 'patient' | 'conversation'; targetId: string; tag: string },
    ctx: DataApi,
  ): Promise<string> => {
    const record = await ctx.get(args.targetType, args.targetId, { id: true, tags: true });
    if (!record) throw new Error(`${args.targetType} ${args.targetId} não encontrado`);
    const current = (record.tags ?? []) as string[];
    if (current.includes(args.tag)) return JSON.stringify({ ok: true, unchanged: true });
    const result = await ctx.update(args.targetType, args.targetId, { tags: [...current, args.tag] });
    return JSON.stringify(result);
  },
};
