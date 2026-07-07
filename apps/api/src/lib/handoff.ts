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
    await ctx.create('activity', {
      targetType: 'conversation',
      targetId: conversationId,
      conversationId,
      type: 'HANDOFF',
      title: 'Tawany → handoff',
      body: reason.slice(0, 240),
    });
    return { ok: true };
  } catch (e) {
    console.error(`[handoff] failed for ${conversationId}:`, e);
    return { ok: false, error: (e as Error).message };
  }
};
