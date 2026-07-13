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

  it('requires the trusted CRM origin in production for cookie CSRF protection', async () => {
    const { assertProductionConfig } = await import('./production');

    expect(() => assertProductionConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'x'.repeat(32),
    })).toThrow('CORS_DOMAIN or CORS_ORIGIN must be configured in production');
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

  it('sanitizes internal error details from 5xx JSON responses', async () => {
    const { sanitizeErrorResponses } = await import('./production');
    const json = vi.fn();
    const response = { statusCode: 500, json };

    sanitizeErrorResponses({ path: '/api/test' } as never, response as never, vi.fn());
    response.json({ success: false, error: 'relation User does not exist at db.internal' });

    expect(json).toHaveBeenCalledWith({ success: false, error: 'Erro interno' });
  });
});
