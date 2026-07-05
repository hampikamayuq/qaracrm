import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    session: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('../lib/deps', () => ({ prisma: mocks.prisma }));
vi.mock('../lib/auth', () => ({
  createToken: vi.fn(() => 'jwt-token'),
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
}));
vi.mock('../middleware/auth-middleware', () => ({
  authMiddleware: vi.fn((_req, _res, next) => next()),
}));

const req = (overrides: Partial<Request>): Request => overrides as Request;

const res = () => {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response as unknown as Response & typeof response;
};

describe('Auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when email or password is missing', async () => {
    const { loginRoute } = await import('./auth-routes');
    const response = res();

    await loginRoute(req({ body: {} }), response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: 'Email and password required',
    });
  });

  it('returns 401 for invalid credentials', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null);
    const { loginRoute } = await import('./auth-routes');
    const response = res();

    await loginRoute(req({ body: { email: 'missing@example.com', password: 'x' } }), response);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: 'Invalid credentials',
    });
  });

  it('creates a session for valid credentials', async () => {
    const { verifyPassword, createToken } = await import('../lib/auth');
    vi.mocked(verifyPassword).mockResolvedValue(true);
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      name: 'Admin',
      email: 'admin@example.com',
      password: 'hash',
      role: 'admin',
      active: true,
    });
    mocks.prisma.session.create.mockResolvedValue({ id: 'session-1' });
    const { loginRoute } = await import('./auth-routes');
    const response = res();

    await loginRoute(req({ body: { email: 'admin@example.com', password: 'secret' } }), response);

    expect(createToken).toHaveBeenCalledWith({ userId: 'u1', role: 'admin' });
    expect(mocks.prisma.session.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', token: 'jwt-token' }),
    });
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: {
        token: 'jwt-token',
        user: { id: 'u1', name: 'Admin', email: 'admin@example.com', role: 'admin' },
      },
    });
  });
});
