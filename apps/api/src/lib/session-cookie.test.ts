import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { hasTrustedCookieOrigin, sessionCookieTokenFromRequest, setSessionCookie } from './session-cookie';

describe('session cookie', () => {
  afterEach(() => {
    delete process.env.CORS_DOMAIN;
    process.env.NODE_ENV = 'test';
  });

  it('sets HttpOnly, Secure and SameSite=Lax in production', () => {
    process.env.NODE_ENV = 'production';
    const setHeader = vi.fn();

    setSessionCookie({ setHeader } as unknown as Response, 'jwt', 3600);

    const cookie = setHeader.mock.calls[0][1] as string;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api');
  });

  it('reads only the named session cookie', () => {
    const req = { headers: { cookie: 'theme=dark; qara_session=jwt%2Etoken; other=x' } } as Request;
    expect(sessionCookieTokenFromRequest(req)).toBe('jwt.token');
  });

  it('rejects malformed percent-encoding without throwing', () => {
    const req = { headers: { cookie: 'qara_session=%E0%A4%A' } } as Request;
    expect(() => sessionCookieTokenFromRequest(req)).not.toThrow();
    expect(sessionCookieTokenFromRequest(req)).toBeNull();
  });

  it('accepts mutations only from the configured CRM origin', () => {
    process.env.CORS_DOMAIN = 'https://crm.example.com';
    expect(hasTrustedCookieOrigin({
      method: 'POST', headers: { origin: 'https://crm.example.com' },
    } as Request)).toBe(true);
    expect(hasTrustedCookieOrigin({
      method: 'POST', headers: { origin: 'https://evil.example' },
    } as Request)).toBe(false);
  });
});
