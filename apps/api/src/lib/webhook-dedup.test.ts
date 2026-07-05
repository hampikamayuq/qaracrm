import { describe, it, expect, vi } from 'vitest';
import { isDuplicateWebhook } from './webhook-dedup';

describe('isDuplicateWebhook', () => {
  it('returns true when same signature was processed within window', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'evt-1' });
    const result = await isDuplicateWebhook(
      { webhookEvent: { findFirst } } as any,
      'meta',
      'sha256=abc',
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        source: 'meta',
        signature: 'sha256=abc',
        createdAt: { gte: expect.any(Date) },
      },
      select: { id: true },
    });
    expect(result).toBe(true);
  });

  it('returns false when no recent event matches', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const result = await isDuplicateWebhook(
      { webhookEvent: { findFirst } } as any,
      'meta',
      'sha256=new',
    );
    expect(result).toBe(false);
  });

  it('returns false when signature is null', async () => {
    const findFirst = vi.fn();
    const result = await isDuplicateWebhook(
      { webhookEvent: { findFirst } } as any,
      'meta',
      null,
    );
    expect(result).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
