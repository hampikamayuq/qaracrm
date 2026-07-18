import type { Request, Response } from 'express';

export const SESSION_COOKIE_NAME = 'qara_session';

const cookieAttributes = (maxAgeSeconds: number): string[] => {
  const production = process.env.NODE_ENV === 'production';
  return [
    'Path=/api',
    'HttpOnly',
    'SameSite=Lax',
    ...(production ? ['Secure'] : []),
    `Max-Age=${maxAgeSeconds}`,
  ];
};

export const sessionCookieTokenFromRequest = (req: Request): string | null => {
  const cookie = req.headers.cookie;
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === SESSION_COOKIE_NAME) {
      const value = rawValue.join('=');
      if (!value) return null;
      try {
        return decodeURIComponent(value);
      } catch {
        return null;
      }
    }
  }
  return null;
};

export const setSessionCookie = (res: Response, token: string, maxAgeSeconds: number): void => {
  res.setHeader('Set-Cookie', [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    ...cookieAttributes(maxAgeSeconds),
  ].join('; '));
};

export const clearSessionCookie = (res: Response): void => {
  res.setHeader('Set-Cookie', [
    `${SESSION_COOKIE_NAME}=`,
    ...cookieAttributes(0),
  ].join('; '));
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const hasTrustedCookieOrigin = (req: Request): boolean => {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return true;
  const origin = req.headers.origin;
  if (typeof origin !== 'string') return false;
  const configured = process.env.CORS_DOMAIN ?? process.env.CORS_ORIGIN ?? 'http://localhost:3000';
  const normalizeOrigin = (value: string): string => {
    try {
      return new URL(value).origin;
    } catch {
      return value.replace(/\/$/, '');
    }
  };
  return configured.split(',').map((value) => normalizeOrigin(value.trim())).includes(normalizeOrigin(origin));
};
