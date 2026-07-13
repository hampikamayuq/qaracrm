import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateSessionToken } from '../middleware/auth-middleware';
import { subscribe } from '../lib/events';
import { sessionCookieTokenFromRequest } from '../lib/session-cookie';

const router: Router = Router();

const HEARTBEAT_MS = 25_000;

// GET /api/events/stream — SSE autenticado pelo cookie HttpOnly da sessão.
export const streamEventsRoute = async (req: Request, res: Response): Promise<void> => {
  const token = sessionCookieTokenFromRequest(req);
  const payload = token ? await authenticateSessionToken(token) : null;
  if (!payload) {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Handshake: o cliente sabe que o stream está de pé antes do 1º evento real.
  res.write('event: connected\ndata: {}\n\n');

  // Heartbeat (comentário `: ping`) mantém proxies/load balancers de não
  // derrubarem a conexão ociosa.
  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, HEARTBEAT_MS);

  const unsubscribe = subscribe((event) => {
    res.write(`event: inbound-message\ndata: ${JSON.stringify(event)}\n\n`);
  });

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
};

router.get('/stream', streamEventsRoute);

export default router;
