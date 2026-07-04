import type { DataApi } from 'src/lib/data';

export type HandoffResult = { ok: true } | { ok: false; error: string };

export const handoff = async (
  conversationId: string,
  reason: string,
  ctx: DataApi,
): Promise<HandoffResult> => {
  try {
    await ctx.update('conversation', conversationId, {
      needsHuman: true,
      handoffReason: reason,
      status: 'NEEDS_HUMAN',
    });
    const note = await ctx.create('note', { title: `Tawany → handoff: ${reason}`.slice(0, 240) });
    await ctx.create('noteTarget', { noteId: note.id, targetConversationId: conversationId });
    return { ok: true };
  } catch (e) {
    console.error(`[handoff] failed for ${conversationId}:`, e);
    return { ok: false, error: (e as Error).message };
  }
};
