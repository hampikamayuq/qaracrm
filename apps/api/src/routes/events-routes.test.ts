import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => ({
  authenticateSessionToken: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
}));

vi.mock('../middleware/auth-middleware', () => ({
  authenticateSessionToken: mocks.authenticateSessionToken,
}));
vi.mock('../lib/session-cookie', () => ({
  sessionCookieTokenFromRequest: vi.fn((req: Request) => {
    const match = req.headers.cookie?.match(/(?:^|;\s*)qara_session=([^;]+)/);
    return match?.[1] ?? null;
  }),
}));
vi.mock('../lib/events', () => ({ subscribe: mocks.subscribe }));

const response = () => ({
  status: vi.fn().mockReturnThis(),
  json: vi.fn(),
  setHeader: vi.fn(),
  flushHeaders: vi.fn(),
  write: vi.fn(),
}) as unknown as Response;

describe('events SSE route', () => {
  beforeEach(() => vi.clearAllMocks());

  it('authenticates through the HttpOnly session cookie', async () => {
    mocks.authenticateSessionToken.mockResolvedValue({ userId: 'u1', role: 'admin' });
    const { streamEventsRoute } = await import('./events-routes');
    const req = {
      headers: { cookie: 'qara_session=jwt-cookie' },
      query: {},
      on: vi.fn(),
    } as unknown as Request;
    const res = response();

    await streamEventsRoute(req, res);

    expect(mocks.authenticateSessionToken).toHaveBeenCalledWith('jwt-cookie');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
  });

  it('does not accept JWTs from the query string', async () => {
    const { streamEventsRoute } = await import('./events-routes');
    const res = response();

    await streamEventsRoute({
      headers: {},
      query: { token: 'leaked-jwt' },
    } as unknown as Request, res);

    expect(mocks.authenticateSessionToken).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
