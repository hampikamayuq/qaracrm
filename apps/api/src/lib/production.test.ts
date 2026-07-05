import { describe, expect, it, vi } from 'vitest';

describe('production hardening', () => {
  it('rejects short JWT_SECRET in production', async () => {
    const { assertProductionConfig } = await import('./production');

    expect(() => assertProductionConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'short',
    })).toThrow('JWT_SECRET must be at least 32 bytes in production');
  });

  it('allows non-production without JWT_SECRET', async () => {
    const { assertProductionConfig } = await import('./production');

    expect(() => assertProductionConfig({ NODE_ENV: 'test' })).not.toThrow();
  });

  it('sets baseline security headers', async () => {
    const { securityHeaders } = await import('./production');
    const setHeader = vi.fn();
    const next = vi.fn();

    securityHeaders({} as never, { setHeader } as never, next);

    expect(setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
    expect(next).toHaveBeenCalledOnce();
  });
});
