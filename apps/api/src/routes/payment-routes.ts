import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/deps';
import { authMiddleware } from '../middleware/auth-middleware';

const router = Router();

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

const paramStr = (value: unknown): string => (typeof value === 'string' ? value : '');

// Valores reais do schema (Payment.method / Payment.status) — strings, sem enum
// Prisma (mesmo padrão do status legado em payment.service.js).
export const PAYMENT_METHODS = ['CASH', 'PIX', 'DEBIT', 'CREDIT', 'BANK_TRANSFER', 'OTHER'] as const;

export const PAYMENT_STATUSES = ['PENDING', 'PAID', 'PARTIALLY_PAID', 'CANCELED', 'REFUNDED'] as const;
type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
const STATUS_SET = new Set<string>(PAYMENT_STATUSES);

// Orçamento só recebe pagamento depois de enviado (mesma regra do serviço
// legado): DRAFT ainda é proposta, REJECTED/EXPIRED não recebem mais.
const BUDGET_STATUSES_ACCEPTING_PAYMENT = new Set(['SENT', 'ACCEPTED']);

// Saldo liquidado (PAID/PARTIALLY_PAID) — mesma regra de budget-routes.ts.
const isSettled = (status: string): boolean => status === 'PAID' || status === 'PARTIALLY_PAID';

const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'data inválida' });

const createSchema = z.object({
  budgetId: z.string().trim().min(1, 'budgetId obrigatório'),
  amount: z.number().positive('amount deve ser > 0'),
  method: z.enum(PAYMENT_METHODS),
  installments: z.number().int().min(1).optional(),
  cardFee: z.number().nonnegative().nullable().optional(),
  // criação só aceita estados iniciais — PAID por padrão (pagamento já
  // recebido); PENDING para agendar cobrança futura.
  status: z.enum(['PENDING', 'PAID', 'PARTIALLY_PAID']).optional(),
  paidAt: isoDate.nullable().optional(),
});

// PATCH só faz transições simples: marcar como pago ou cancelado.
const updateSchema = z.object({
  status: z.enum(['PAID', 'CANCELED']),
  paidAt: isoDate.nullable().optional(),
});

const toDateOrNull = (value: string | null | undefined): Date | null =>
  value ? new Date(value) : null;

// ---------------------------------------------------------------- listagem

export const listPaymentsRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const budgetId = typeof req.query.budgetId === 'string' && req.query.budgetId ? req.query.budgetId : undefined;
    const status = typeof req.query.status === 'string' && STATUS_SET.has(req.query.status)
      ? (req.query.status as PaymentStatus)
      : undefined;

    const payments = await prisma.payment.findMany({
      where: { ...(budgetId ? { budgetId } : {}), ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    res.json({ success: true, data: payments });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

// ---------------------------------------------------------------- criação

export const createPaymentRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      jsonError(res, 400, parsed.error.issues[0]?.message ?? 'payload inválido');
      return;
    }
    const input = parsed.data;

    const budget = await prisma.budget.findUnique({ where: { id: input.budgetId } });
    if (!budget) {
      jsonError(res, 404, 'Orçamento não encontrado');
      return;
    }
    if (!BUDGET_STATUSES_ACCEPTING_PAYMENT.has(budget.status)) {
      jsonError(res, 409, `Orçamento em ${budget.status} não aceita pagamentos`);
      return;
    }

    const status: PaymentStatus = input.status ?? 'PAID';
    const paidAt = input.paidAt !== undefined
      ? toDateOrNull(input.paidAt)
      : status === 'PENDING' ? null : new Date();

    // Soma liquidada ANTES deste pagamento — usada para detectar a transição
    // "acabou de quitar" sem disparar Activity de novo em pagamentos extras.
    const priorSettled = isSettled(status)
      ? await prisma.payment.findMany({
          where: { budgetId: input.budgetId, status: { in: ['PAID', 'PARTIALLY_PAID'] } },
          select: { amount: true },
        })
      : [];
    const priorTotal = priorSettled.reduce((sum, p) => sum + Number(p.amount), 0);

    const payment = await prisma.payment.create({
      data: {
        budgetId: input.budgetId,
        amount: input.amount,
        method: input.method,
        installments: input.installments ?? 1,
        cardFee: input.cardFee ?? null,
        status,
        paidAt,
      },
    });

    if (isSettled(status) && budget.leadId) {
      const newTotal = priorTotal + Number(payment.amount);
      const amount = Number(budget.amount);
      if (priorTotal < amount && newTotal >= amount) {
        await prisma.activity.create({
          data: {
            targetType: 'lead',
            targetId: budget.leadId,
            type: 'BUDGET_PAID',
            title: 'Orçamento quitado',
            body: JSON.stringify({ budgetId: budget.id, title: budget.title, amount }),
            userId: req.userId ?? null,
          },
        });
      }
    }

    res.status(201).json({ success: true, data: payment });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

// ---------------------------------------------------------------- transição

export const updatePaymentRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      jsonError(res, 400, parsed.error.issues[0]?.message ?? 'payload inválido');
      return;
    }
    const id = paramStr(req.params.id);
    const payment = await prisma.payment.findUnique({ where: { id } });
    if (!payment) {
      jsonError(res, 404, 'Pagamento não encontrado');
      return;
    }
    // Transições simples: só sai de estados abertos (PENDING/PARTIALLY_PAID).
    if (payment.status !== 'PENDING' && payment.status !== 'PARTIALLY_PAID') {
      jsonError(res, 409, `Pagamento em ${payment.status} não pode ser alterado`);
      return;
    }

    const { status } = parsed.data;
    const paidAt = status === 'PAID'
      ? (parsed.data.paidAt !== undefined ? toDateOrNull(parsed.data.paidAt) : new Date())
      : payment.paidAt;

    // Exclui o próprio pagamento da soma anterior — se ele já estava
    // PARTIALLY_PAID, a query abaixo o pegaria de novo e contaria em dobro
    // junto com updated.amount somado logo adiante.
    const priorSettled = status === 'PAID' && payment.budgetId
      ? await prisma.payment.findMany({
          where: { budgetId: payment.budgetId, id: { not: id }, status: { in: ['PAID', 'PARTIALLY_PAID'] } },
          select: { amount: true },
        })
      : [];
    const priorTotal = priorSettled.reduce((sum, p) => sum + Number(p.amount), 0);

    const updated = await prisma.payment.update({ where: { id }, data: { status, paidAt } });

    if (status === 'PAID' && payment.budgetId) {
      const budget = await prisma.budget.findUnique({ where: { id: payment.budgetId } });
      if (budget?.leadId) {
        const newTotal = priorTotal + Number(updated.amount);
        const amount = Number(budget.amount);
        if (priorTotal < amount && newTotal >= amount) {
          await prisma.activity.create({
            data: {
              targetType: 'lead',
              targetId: budget.leadId,
              type: 'BUDGET_PAID',
              title: 'Orçamento quitado',
              body: JSON.stringify({ budgetId: budget.id, title: budget.title, amount }),
              userId: req.userId ?? null,
            },
          });
        }
      }
    }

    res.json({ success: true, data: updated });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

router.get('/', authMiddleware, listPaymentsRoute);
router.post('/', authMiddleware, createPaymentRoute);
router.patch('/:id', authMiddleware, updatePaymentRoute);

export default router;
