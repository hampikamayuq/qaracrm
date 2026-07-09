import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/deps';
import { authMiddleware } from '../middleware/auth-middleware';
import { hasReportExportRole, requireReportExportRole } from '../middleware/authorization';
import { logger } from '../lib/logger';

const router = Router();

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

// Erro inesperado (500): loga o detalhe no servidor e devolve mensagem
// genérica ao cliente — nunca vaza detalhe interno na resposta.
const serverError = (res: Response, error: unknown, where: string): void => {
  logger.error({ where, error: (error as Error).message }, 'erro interno na rota de orçamentos');
  jsonError(res, 500, 'erro interno');
};

const paramStr = (value: unknown): string => (typeof value === 'string' ? value : '');

// Status reais do enum BudgetStatus (schema) — nada inventado.
export const BUDGET_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'] as const;
type BudgetStatus = (typeof BUDGET_STATUSES)[number];
const STATUS_SET = new Set<string>(BUDGET_STATUSES);

export const STATUS_LABELS_PT: Record<BudgetStatus, string> = {
  DRAFT: 'Rascunho',
  SENT: 'Enviado',
  ACCEPTED: 'Aceito',
  REJECTED: 'Recusado',
  EXPIRED: 'Expirado',
};

const BUDGET_INCLUDE = {
  lead: { select: { id: true, name: true, phone: true } },
  patient: { select: { id: true, name: true } },
  service: { select: { id: true, name: true } },
} as const;

// A LISTA não expõe o telefone do lead (ACHADO 2 — minimização de dados
// pessoais/LGPD): a recepção precisa operar orçamentos, mas o telefone só é
// necessário no detalhe (GET /:id). Só id + name na listagem.
const BUDGET_LIST_INCLUDE = {
  lead: { select: { id: true, name: true } },
  patient: { select: { id: true, name: true } },
  service: { select: { id: true, name: true } },
} as const;

// Saldo derivado na leitura: amount − pagamentos liquidados (PAID/PARTIALLY_PAID).
// Mesma regra do serviço legado (budget.service.js). Nunca gravado.
type PaymentLike = { amount: unknown; status: string };
// Exportado para o relatório financeiro reusar a mesma regra de saldo
// (pagamentos pendentes de orçamentos aceitos) sem duplicar a lógica.
export const settledAmount = (payments: PaymentLike[]): number =>
  payments
    .filter((p) => p.status === 'PAID' || p.status === 'PARTIALLY_PAID')
    .reduce((sum, p) => sum + Number(p.amount), 0);

const withBalance = <T extends { amount: unknown; payments?: PaymentLike[] }>(budget: T) => {
  const { payments = [], ...rest } = budget;
  const paid = settledAmount(payments);
  const amount = Number(budget.amount);
  return { ...rest, totalPaid: paid, balance: Math.max(amount - paid, 0) };
};

// ---------------------------------------------------------------- validação

const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'data inválida' });

const createSchema = z.object({
  title: z.string().trim().min(1, 'title obrigatório'),
  amount: z.number().nonnegative('amount deve ser >= 0'),
  entryAmount: z.number().nonnegative().nullable().optional(),
  installments: z.number().int().min(1).optional(),
  expiresAt: isoDate.nullable().optional(),
  notes: z.string().nullable().optional(),
  leadId: z.string().nullable().optional(),
  patientId: z.string().nullable().optional(),
  serviceId: z.string().nullable().optional(),
});

// PATCH altera campos do orçamento — status só muda pelas transições
// (/send, /accept, /reject) para preservar a máquina de estados.
const updateSchema = createSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'nenhum campo para atualizar' },
);

const toDateOrNull = (value: string | null | undefined): Date | null =>
  value ? new Date(value) : null;

// ---------------------------------------------------------------- listagem

export const listBudgetsRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const status = typeof req.query.status === 'string' && STATUS_SET.has(req.query.status)
      ? (req.query.status as BudgetStatus)
      : undefined;
    const leadId = typeof req.query.leadId === 'string' && req.query.leadId ? req.query.leadId : undefined;

    const budgets = await prisma.budget.findMany({
      where: { ...(status ? { status } : {}), ...(leadId ? { leadId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { ...BUDGET_LIST_INCLUDE, payments: { select: { amount: true, status: true } } },
    });
    res.json({ success: true, data: budgets.map(withBalance) });
  } catch (error) {
    serverError(res, error, 'GET /budgets');
  }
};

export const getBudgetRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const budget = await prisma.budget.findUnique({
      where: { id: paramStr(req.params.id) },
      include: { ...BUDGET_INCLUDE, payments: true },
    });
    if (!budget) {
      jsonError(res, 404, 'Orçamento não encontrado');
      return;
    }
    res.json({ success: true, data: withBalance(budget) });
  } catch (error) {
    serverError(res, error, 'GET /budgets/:id');
  }
};

export const createBudgetRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      jsonError(res, 400, parsed.error.issues[0]?.message ?? 'payload inválido');
      return;
    }
    const input = parsed.data;
    const budget = await prisma.budget.create({
      data: {
        title: input.title,
        amount: input.amount,
        entryAmount: input.entryAmount ?? null,
        installments: input.installments ?? 1,
        expiresAt: toDateOrNull(input.expiresAt),
        notes: input.notes ?? null,
        leadId: input.leadId ?? null,
        patientId: input.patientId ?? null,
        serviceId: input.serviceId ?? null,
      },
      include: { ...BUDGET_INCLUDE, payments: true },
    });
    res.status(201).json({ success: true, data: withBalance(budget) });
  } catch (error) {
    serverError(res, error, 'POST /budgets');
  }
};

export const updateBudgetRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      jsonError(res, 400, parsed.error.issues[0]?.message ?? 'payload inválido');
      return;
    }
    const id = paramStr(req.params.id);
    const existing = await prisma.budget.findUnique({ where: { id } });
    if (!existing) {
      jsonError(res, 404, 'Orçamento não encontrado');
      return;
    }

    // Gate dependente do estado (ACHADO 1): a recepção pode editar rascunhos,
    // mas mexer num orçamento já enviado/aceito é ato financeiro — exige papel
    // financeiro/admin/marketing.
    if (existing.status !== 'DRAFT' && !hasReportExportRole(req.userRole)) {
      jsonError(res, 403, 'forbidden');
      return;
    }

    const input = parsed.data;
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.amount !== undefined) data.amount = input.amount;
    if (input.entryAmount !== undefined) data.entryAmount = input.entryAmount ?? null;
    if (input.installments !== undefined) data.installments = input.installments;
    if (input.expiresAt !== undefined) data.expiresAt = toDateOrNull(input.expiresAt);
    if (input.notes !== undefined) data.notes = input.notes ?? null;
    if (input.leadId !== undefined) data.leadId = input.leadId ?? null;
    if (input.patientId !== undefined) data.patientId = input.patientId ?? null;
    if (input.serviceId !== undefined) data.serviceId = input.serviceId ?? null;

    // Trilha (ACHADO 1): alteração de valor/entrada do orçamento é ato
    // financeiro — registra de→para por campo no Activity do lead.
    const changes: Array<{ field: string; from: number | null; to: number | null }> = [];
    if (input.amount !== undefined && Number(input.amount) !== Number(existing.amount)) {
      changes.push({ field: 'amount', from: Number(existing.amount), to: Number(input.amount) });
    }
    if (input.entryAmount !== undefined) {
      const from = existing.entryAmount === null ? null : Number(existing.entryAmount);
      const to = input.entryAmount ?? null;
      if (from !== to) changes.push({ field: 'entryAmount', from, to });
    }

    const budget = await prisma.budget.update({
      where: { id },
      data,
      include: { ...BUDGET_INCLUDE, payments: true },
    });

    if (changes.length > 0 && existing.leadId) {
      await prisma.activity.create({
        data: {
          targetType: 'lead',
          targetId: existing.leadId,
          type: 'BUDGET_UPDATED',
          title: 'Orçamento alterado',
          body: JSON.stringify({ budgetId: id, changes }),
          userId: req.userId ?? null,
        },
      });
    }

    res.json({ success: true, data: withBalance(budget) });
  } catch (error) {
    serverError(res, error, 'PATCH /budgets/:id');
  }
};

// ---------------------------------------------------------------- transições

// Transições válidas da máquina de estados. send parte de DRAFT; accept/reject
// partem de SENT. Estado inválido → 409 (conflito), sem tocar no registro.
const TRANSITIONS: Record<string, { from: BudgetStatus[]; to: BudgetStatus }> = {
  send: { from: ['DRAFT'], to: 'SENT' },
  accept: { from: ['SENT'], to: 'ACCEPTED' },
  reject: { from: ['SENT'], to: 'REJECTED' },
};

const transitionRoute = (action: keyof typeof TRANSITIONS) =>
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = paramStr(req.params.id);
      const budget = await prisma.budget.findUnique({ where: { id } });
      if (!budget) {
        jsonError(res, 404, 'Orçamento não encontrado');
        return;
      }
      const rule = TRANSITIONS[action];
      if (!rule.from.includes(budget.status)) {
        jsonError(
          res,
          409,
          `Transição inválida: orçamento ${STATUS_LABELS_PT[budget.status]} não pode ir para ${STATUS_LABELS_PT[rule.to]}`,
        );
        return;
      }

      const now = new Date();
      const data: Record<string, unknown> = { status: rule.to };
      if (action === 'send') data.sentAt = now;
      else data.respondedAt = now; // accept | reject

      const updated = await prisma.budget.update({
        where: { id },
        data,
        include: { ...BUDGET_INCLUDE, payments: true },
      });

      // Histórico reusa o modelo Activity (targetType 'lead') — mesma convenção
      // do pipeline. Só grava quando o orçamento está vinculado a um lead.
      if (updated.leadId && (action === 'send' || action === 'accept')) {
        await prisma.activity.create({
          data: {
            targetType: 'lead',
            targetId: updated.leadId,
            type: action === 'send' ? 'BUDGET_SENT' : 'BUDGET_ACCEPTED',
            title: action === 'send' ? 'Orçamento enviado' : 'Orçamento aceito',
            body: JSON.stringify({ budgetId: id, title: updated.title, amount: Number(updated.amount) }),
            userId: req.userId ?? null,
          },
        });
      }

      res.json({ success: true, data: withBalance(updated) });
    } catch (error) {
      serverError(res, error, `POST /budgets/:id/${action}`);
    }
  };

// ------------------------------------------------------------ export CSV

const csvCell = (value: string): string => `"${value.replace(/"/g, '""')}"`;

const brDate = (value: Date | null): string =>
  value ? value.toLocaleDateString('pt-BR') : '';

export const exportBudgetsCsvRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const status = typeof req.query.status === 'string' && STATUS_SET.has(req.query.status)
      ? (req.query.status as BudgetStatus)
      : undefined;
    const leadId = typeof req.query.leadId === 'string' && req.query.leadId ? req.query.leadId : undefined;

    const budgets = await prisma.budget.findMany({
      where: { ...(status ? { status } : {}), ...(leadId ? { leadId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 1000,
      include: { lead: { select: { name: true } }, payments: { select: { amount: true, status: true } } },
    });

    const header = ['Título', 'Valor', 'Entrada', 'Parcelas', 'Status', 'Lead', 'Saldo', 'Vencimento', 'Criado em'];
    const lines = [header.map(csvCell).join(',')];
    for (const b of budgets) {
      const amount = Number(b.amount);
      const balance = Math.max(amount - settledAmount(b.payments), 0);
      const row: Array<string | number> = [
        b.title,
        amount.toFixed(2),
        b.entryAmount === null ? '' : Number(b.entryAmount).toFixed(2),
        b.installments,
        STATUS_LABELS_PT[b.status],
        b.lead?.name ?? '',
        balance.toFixed(2),
        brDate(b.expiresAt),
        brDate(b.createdAt),
      ];
      lines.push(row.map((v) => csvCell(String(v))).join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=orcamentos-qara.csv');
    // BOM para o Excel abrir UTF-8 direto — mesmo padrão do export de relatórios.
    res.send(`﻿${lines.join('\n')}`);
  } catch (error) {
    serverError(res, error, 'GET /budgets/export.csv');
  }
};

// export.csv antes de /:id para não ser capturado pelo parâmetro.
router.get('/', authMiddleware, listBudgetsRoute);
router.get('/export.csv', authMiddleware, requireReportExportRole, exportBudgetsCsvRoute);
router.get('/:id', authMiddleware, getBudgetRoute);
router.post('/', authMiddleware, createBudgetRoute);
router.patch('/:id', authMiddleware, updateBudgetRoute);
router.post('/:id/send', authMiddleware, transitionRoute('send'));
router.post('/:id/accept', authMiddleware, transitionRoute('accept'));
router.post('/:id/reject', authMiddleware, transitionRoute('reject'));

export default router;
