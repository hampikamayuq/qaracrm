import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/deps';
import { authMiddleware } from '../middleware/auth-middleware';
import { requireAdmin } from '../middleware/authorization';

const router = Router();

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

const paramStr = (value: unknown): string => (typeof value === 'string' ? value : '');

// ---------------------------------------------------------------- validação

const createSchema = z.object({
  shortcut: z.string().trim().min(1, 'shortcut obrigatório'),
  title: z.string().trim().min(1, 'title obrigatório'),
  content: z.string().trim().min(1, 'content obrigatório'),
  active: z.boolean().optional(),
});

// PATCH aceita qualquer subconjunto dos campos de criação.
const updateSchema = createSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'nenhum campo para atualizar' },
);

// ------------------------------------------------------------------ leitura

// Não há coluna "categoria" no modelo QuickReply (schema.prisma) — a busca
// cobre shortcut/title/content. Sem filtro, devolve só as ativas (mesmo
// padrão do quickreply.service.js legado); ?active=false lista as inativas
// e ?active=all devolve todas.
export const listQuickRepliesRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const activeParam = typeof req.query.active === 'string' ? req.query.active : undefined;

    const where: Record<string, unknown> = {};
    if (activeParam === 'true') where.active = true;
    else if (activeParam === 'false') where.active = false;
    else if (activeParam !== 'all') where.active = true;

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } },
        { shortcut: { contains: search, mode: 'insensitive' } },
      ];
    }

    const quickReplies = await prisma.quickReply.findMany({
      where,
      orderBy: { shortcut: 'asc' },
    });
    res.json({ success: true, data: quickReplies });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const createQuickReplyRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      jsonError(res, 400, parsed.error.issues[0]?.message ?? 'payload inválido');
      return;
    }
    const input = parsed.data;
    const quickReply = await prisma.quickReply.create({
      data: {
        shortcut: input.shortcut,
        title: input.title,
        content: input.content,
        active: input.active ?? true,
      },
    });
    res.status(201).json({ success: true, data: quickReply });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const updateQuickReplyRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      jsonError(res, 400, parsed.error.issues[0]?.message ?? 'payload inválido');
      return;
    }
    const input = parsed.data;
    const data: Record<string, unknown> = {};
    if (input.shortcut !== undefined) data.shortcut = input.shortcut;
    if (input.title !== undefined) data.title = input.title;
    if (input.content !== undefined) data.content = input.content;
    if (input.active !== undefined) data.active = input.active;

    const result = await prisma.quickReply.updateMany({ where: { id: paramStr(req.params.id) }, data });
    if (result.count === 0) {
      jsonError(res, 404, 'Resposta rápida não encontrada');
      return;
    }
    const quickReply = await prisma.quickReply.findUnique({ where: { id: paramStr(req.params.id) } });
    res.json({ success: true, data: quickReply });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const deleteQuickReplyRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await prisma.quickReply.deleteMany({ where: { id: paramStr(req.params.id) } });
    if (result.count === 0) {
      jsonError(res, 404, 'Resposta rápida não encontrada');
      return;
    }
    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

// Leitura liberada para qualquer usuário autenticado (inclui o serviço do
// MCP); escrita restrita a admin — respostas rápidas são conteúdo
// operacional compartilhado por toda a equipe.
router.get('/', authMiddleware, listQuickRepliesRoute);
router.post('/', authMiddleware, requireAdmin, createQuickReplyRoute);
router.patch('/:id', authMiddleware, requireAdmin, updateQuickReplyRoute);
router.delete('/:id', authMiddleware, requireAdmin, deleteQuickReplyRoute);

export default router;
