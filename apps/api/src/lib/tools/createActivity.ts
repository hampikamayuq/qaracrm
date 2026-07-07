import { z } from 'zod';
import type { DataApi } from 'src/lib/data';

export const createActivity = {
  name: 'createActivity',
  description: 'Cria uma nota no timeline de um lead, paciente ou conversa.',
  parameters: z.object({
    targetType: z.enum(['lead', 'patient', 'conversation']),
    targetId: z.string().uuid(),
    body: z.string().min(1).max(2000),
  }),
  execute: async (
    args: { targetType: 'lead' | 'patient' | 'conversation'; targetId: string; body: string },
    ctx: DataApi,
  ): Promise<string> => {
    const activity = await ctx.create('activity', {
      targetType: args.targetType,
      targetId: args.targetId,
      type: 'NOTE',
      body: args.body,
    });
    return JSON.stringify({ ok: true, activityId: activity.id });
  },
};
