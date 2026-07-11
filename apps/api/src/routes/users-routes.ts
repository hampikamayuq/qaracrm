import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/deps';
import { hashPassword } from '../lib/auth';
import { authMiddleware } from '../middleware/auth-middleware';
import { requireAdmin } from '../middleware/authorization';

const router = Router();

// Papéis atribuíveis pela UI — 'agente_ia' é interno e não entra aqui.
const ALLOWED_ROLES = ['admin', 'recepcao', 'medico', 'financeiro', 'marketing'];

const MIN_PASSWORD_LENGTH = 8;
// Formato básico: algo@algo.algo, sem espaços.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const USER_SELECT = { id: true, name: true, email: true, role: true, active: true, createdAt: true } as const;

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

export const listUsersRoute = async (_req: Request, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: USER_SELECT,
    });
    res.json({ success: true, data: users });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const createUserRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, role } = req.body ?? {};
    if (typeof name !== 'string' || name.trim().length === 0) {
      jsonError(res, 400, 'name must be a non-empty string');
      return;
    }
    if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
      jsonError(res, 400, 'invalid email');
      return;
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      jsonError(res, 400, `password must have at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (!ALLOWED_ROLES.includes(role)) {
      jsonError(res, 400, 'invalid role');
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      jsonError(res, 409, 'email already in use');
      return;
    }

    const user = await prisma.user.create({
      data: { name: name.trim(), email, password: await hashPassword(password), role },
      select: USER_SELECT,
    });
    res.status(201).json({ success: true, data: user });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const updateUserRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const { name, role, active, password } = req.body ?? {};

    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      jsonError(res, 400, 'name must be a non-empty string');
      return;
    }
    if (role !== undefined && !ALLOWED_ROLES.includes(role)) {
      jsonError(res, 400, 'invalid role');
      return;
    }
    if (active !== undefined && typeof active !== 'boolean') {
      jsonError(res, 400, 'active must be a boolean');
      return;
    }
    if (password !== undefined && (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH)) {
      jsonError(res, 400, `password must have at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    // Guarda: admin não pode desativar a própria conta.
    if (active === false && id === req.userId) {
      jsonError(res, 400, 'cannot deactivate your own account');
      return;
    }

    const existing = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      jsonError(res, 404, 'User not found');
      return;
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(role !== undefined ? { role } : {}),
        ...(active !== undefined ? { active } : {}),
        ...(password !== undefined ? { password: await hashPassword(password) } : {}),
      },
      select: USER_SELECT,
    });

    // Desativar ou trocar senha revoga o acesso na hora (auth-middleware checa Session no banco).
    if (active === false || password !== undefined) {
      await prisma.session.deleteMany({ where: { userId: id } });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

router.get('/', authMiddleware, requireAdmin, listUsersRoute);
router.post('/', authMiddleware, requireAdmin, createUserRoute);
router.patch('/:id', authMiddleware, requireAdmin, updateUserRoute);

export default router;
