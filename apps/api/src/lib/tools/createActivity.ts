import { z } from 'zod';
import type { DataApi } from 'src/lib/data';

const TARGET_FK: Record<string, string> = {
  lead: 'targetLeadId',
  patient: 'targetPatientId',
  conversation: 'targetConversationId',
};

// Timeline "activity" = built-in Note + NoteTarget apontando para o registro.
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
    const note = await ctx.create('note', { title: args.body.slice(0, 240) });
    await ctx.create('noteTarget', { noteId: note.id, [TARGET_FK[args.targetType]]: args.targetId });
    return JSON.stringify({ ok: true, noteId: note.id });
  },
};
