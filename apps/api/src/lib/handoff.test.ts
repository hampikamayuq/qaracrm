import { describe, it, expect, vi } from 'vitest';
import { handoff } from './handoff';

describe('handoff', () => {
  it('sets needsHuman and logs a timeline note', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'c1' });
    const create = vi.fn().mockResolvedValue({ id: 'n1' });
    const r = await handoff('00000000-0000-4000-8000-000000000001', 'urgencia', { update, create } as never);
    expect(r.ok).toBe(true);
    expect(update).toHaveBeenCalledWith('conversation', '00000000-0000-4000-8000-000000000001',
      expect.objectContaining({ needsHuman: true, handoffReason: 'urgencia', status: 'NEEDS_HUMAN' }));
    expect(create).toHaveBeenCalledWith('noteTarget', expect.objectContaining({ noteId: 'n1' }));
  });

  it('returns ok:false on error', async () => {
    const update = vi.fn().mockRejectedValue(new Error('DB down'));
    const r = await handoff('c1', 'x', { update, create: vi.fn() } as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/DB down/);
  });
});
