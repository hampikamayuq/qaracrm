import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ponytail: mock prisma session check, test JWT + session guard together
vi.mock('../lib/deps', () => ({
  prisma: {
    session: {
      findUnique: vi.fn(),
    },
  },
}));

describe('authMiddleware', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
    vi.clearAllMocks();
  });

  it('allows valid token with active session', async () => {
    const { authMiddleware } = await import('./auth-middleware');
    const { createToken } = await import('../lib/auth');
    const { prisma } = await import('../lib/deps');
    const token = createToken({ userId: 'u1', role: 'admin' });
    (prisma.session.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      token,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const req = { headers: { authorization: `Bearer ${token}` } } as Request;
    let nextCalled = false;

    await authMiddleware(req, {} as Response, (() => { nextCalled = true; }) as NextFunction);
    expect(nextCalled).toBe(true);
    expect((req as unknown as Record<string, unknown>).userId).toBe('u1');
  });

  it('accepts a valid session from the HttpOnly cookie', async () => {
    const { authMiddleware } = await import('./auth-middleware');
    const { createToken } = await import('../lib/auth');
    const { prisma } = await import('../lib/deps');
    const token = createToken({ userId: 'u1', role: 'admin' });
    (prisma.session.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      token,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const req = {
      method: 'GET',
      headers: { cookie: `qara_session=${token}` },
    } as Request;
    const next = vi.fn();

    await authMiddleware(req, {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(req.userId).toBe('u1');
  });

  it('rejects mutating cookie-auth requests from an untrusted origin (CSRF)', async () => {
    process.env.CORS_DOMAIN = 'https://crm.example.com';
    const { authMiddleware } = await import('./auth-middleware');
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = vi.fn();

    await authMiddleware({
      method: 'POST',
      headers: { cookie: 'qara_session=token', origin: 'https://evil.example' },
    } as Request, response, next as NextFunction);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    delete process.env.CORS_DOMAIN;
  });

  it('blocks missing Authorization header', async () => {
    const { authMiddleware } = await import('./auth-middleware');
    const req = { headers: {} } as Request;
    let statusCode = 0;
    const mockRes = {
      status: (code: number) => {
        statusCode = code;
        return { json: () => {} };
      },
    } as unknown as Response;

    await authMiddleware(req, mockRes, (() => {}) as NextFunction);
    expect(statusCode).toBe(401);
  });

  it('blocks invalid token', async () => {
    const { authMiddleware } = await import('./auth-middleware');
    const req = { headers: { authorization: 'Bearer bad' } } as Request;
    let statusCode = 0;
    const mockRes = {
      status: (code: number) => {
        statusCode = code;
        return { json: () => {} };
      },
    } as unknown as Response;

    await authMiddleware(req, mockRes, (() => {}) as NextFunction);
    expect(statusCode).toBe(401);
  });

  it('blocks valid token with no DB session', async () => {
    const { authMiddleware } = await import('./auth-middleware');
    const { createToken } = await import('../lib/auth');
    const { prisma } = await import('../lib/deps');
    const token = createToken({ userId: 'u1', role: 'admin' });
    (prisma.session.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const req = { headers: { authorization: `Bearer ${token}` } } as Request;
    let statusCode = 0;
    const mockRes = {
      status: (code: number) => {
        statusCode = code;
        return { json: () => {} };
      },
    } as unknown as Response;

    await authMiddleware(req, mockRes, (() => {}) as NextFunction);
    expect(statusCode).toBe(401);
  });
});
