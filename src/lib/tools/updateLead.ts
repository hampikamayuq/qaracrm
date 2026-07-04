import { z } from 'zod';
import type { DataApi } from 'src/lib/data';

const ALLOWED_FIELDS = new Set(['score', 'intent', 'notes']);

export const updateLead = {
  name: 'updateLead',
  description: 'Atualiza um lead. Apenas score, intent e notes são permitidos (whitelist).',
  parameters: z.object({
    leadId: z.string().uuid(),
    updates: z
      .object({
        score: z.number().min(0).max(100).optional(),
        intent: z.enum(['CIRURGIA', 'UNHAS', 'TRICOLOGIA', 'AUTOIMUNE', 'DERMATOPEDIATRIA', 'OUTRO']).optional(),
        notes: z.string().max(2000).optional(),
      })
      .refine((u) => Object.keys(u).length > 0, { message: 'updates não pode ser vazio' }),
  }),
  execute: async (args: { leadId: string; updates: Record<string, unknown> }, ctx: DataApi): Promise<string> => {
    for (const key of Object.keys(args.updates)) {
      if (!ALLOWED_FIELDS.has(key)) {
        throw new Error(`Field "${key}" is not whitelisted. Allowed: ${[...ALLOWED_FIELDS].join(', ')}`);
      }
    }
    // 'notes' vira uma nota no timeline (não é campo do lead)
    const { notes, ...fieldUpdates } = args.updates as { notes?: string; score?: number; intent?: string };
    let result: Record<string, unknown> = {};
    if (Object.keys(fieldUpdates).length > 0) {
      result = await ctx.update('lead', args.leadId, fieldUpdates);
    }
    if (notes) {
      const note = await ctx.create('note', { title: notes.slice(0, 240) });
      await ctx.create('noteTarget', { noteId: note.id, targetLeadId: args.leadId });
    }
    return JSON.stringify({ ok: true, ...result });
  },
};
