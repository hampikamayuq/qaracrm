import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/auth';
import { prisma } from '../lib/deps';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: string;
    }
  }
}

// Validação completa (JWT + Session no banco), compartilhada com o SSE
// (/api/events/stream), onde o token chega via query string em vez do header.
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
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing or invalid Authorization header' });
    return;
  }

  const payload = await authenticateSessionToken(header.slice(7));
  if (!payload) {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
    return;
  }

  req.userId = payload.userId;
  req.userRole = payload.role;
  next();
};