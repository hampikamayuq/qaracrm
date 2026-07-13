import { Router } from 'express';
import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/deps';
import { verifyPassword, createToken } from '../lib/auth';
import { authMiddleware } from '../middleware/auth-middleware';
import { clearSessionCookie, sessionCookieTokenFromRequest, setSessionCookie } from '../lib/session-cookie';

const router = Router();

// [BLOQUEANTE] Rate limiting: 10 attempts per 15 min window
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many login attempts, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const loginRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ success: false, error: 'Email and password required' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.active) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    const valid = await verifyPassword(password, user.password);
    if (!valid) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    const token = createToken({ userId: user.id, role: user.role });
    const configuredExpHours = Number.parseInt(process.env.SESSION_EXPIRY_HOURS ?? '24', 10);
    const expHours = Number.isFinite(configuredExpHours) && configuredExpHours > 0 ? configuredExpHours : 24;
    const maxAgeSeconds = expHours * 3600;
    await prisma.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + maxAgeSeconds * 1000),
      },
    });
    setSessionCookie(res, token, maxAgeSeconds);

    res.json({
      success: true,
      data: { user: { id: user.id, name: user.name, email: user.email, role: user.role } },
    });
  } catch (e) {
    console.error('[auth] login failed:', (e as Error).message);
    res.status(500).json({ success: false, error: 'Erro interno' });
  }
};

router.post('/login', loginLimiter, loginRoute);

export const logoutRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.authToken ?? sessionCookieTokenFromRequest(req);
    if (!token) {
      res.status(401).json({ success: false, error: 'Invalid or expired token' });
      return;
    }
    await prisma.session.deleteMany({ where: { token } });
    clearSessionCookie(res);
    res.json({ success: true, data: null });
  } catch (e) {
    console.error('[auth] logout failed:', (e as Error).message);
    res.status(500).json({ success: false, error: 'Erro interno' });
  }
};

router.post('/logout', authMiddleware, logoutRoute);

router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    res.json({ success: true, data: user });
  } catch (e) {
    console.error('[auth] me failed:', (e as Error).message);
    res.status(500).json({ success: false, error: 'Erro interno' });
  }
});

export default router;
