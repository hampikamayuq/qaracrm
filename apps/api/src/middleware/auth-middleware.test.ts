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
