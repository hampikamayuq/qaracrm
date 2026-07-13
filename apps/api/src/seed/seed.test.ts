import { describe, it, expect, vi } from 'vitest';
import { seed } from './seed';
import type { DataApi } from 'src/lib/data';

const makeCtx = (existing: boolean): DataApi => ({
  get: vi.fn(),
  list: vi.fn().mockResolvedValue(existing ? [{ id: 'existing' }] : []),
  create: vi.fn().mockImplementation(async (_obj, input) => ({ id: 'mock-id', ...input })),
  update: vi.fn(),
});

describe('seed', () => {
  it('seeds 1 unit, 5 professionals, 7 services when empty', async () => {
    const ctx = makeCtx(false);
    const result = await seed(ctx);
    expect(result.created).toBe(13);
    expect(ctx.create).toHaveBeenCalledTimes(13);
  });

  it('skips existing records (idempotent)', async () => {
    const ctx = makeCtx(true);
    const result = await seed(ctx);
    expect(result.created).toBe(0);
    expect(ctx.create).not.toHaveBeenCalled();
  });
});
