import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/auth';
import { prisma } from '../lib/deps';
import { hasTrustedCookieOrigin, sessionCookieTokenFromRequest } from '../lib/session-cookie';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: string;
      authToken?: string;
    }
  }
}

// Validação completa (JWT + Session no banco), compartilhada com o SSE.
export const authenticateSessionToken = async (
  token: string,
): Promise<ReturnType<typeof verifyToken>> => {
  const payload = verifyToken(token);
  if (!payload) return null;

  // [BLOQUEANTE] DB session check: session must exist and not be expired
  const session = await prisma.session.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) return null;

  return payload;
};

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const header = req.headers.authorization;
  const bearerToken = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const cookieToken = bearerToken ? null : sessionCookieTokenFromRequest(req);
  const token = bearerToken ?? cookieToken;
  if (!token) {
    res.status(401).json({ success: false, error: 'Missing or invalid Authorization header' });
    return;
  }

  if (cookieToken && !hasTrustedCookieOrigin(req)) {
    res.status(403).json({ success: false, error: 'Origem não autorizada' });
    return;
  }

  const payload = await authenticateSessionToken(token);
  if (!payload) {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
    return;
  }

  req.userId = payload.userId;
  req.userRole = payload.role;
  req.authToken = token;
  next();
};
