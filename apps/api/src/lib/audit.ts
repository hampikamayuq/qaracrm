import type { Prisma, PrismaClient } from '@prisma/client';

export type AuditInput = {
  userId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
};

// Só o delegate auditLog — facilita mockar nos testes.
export type AuditClient = Pick<PrismaClient, 'auditLog'>;

// Auditoria é best-effort: NUNCA lança — a operação de negócio não pode
// falhar porque a trilha de auditoria falhou.
export const recordAudit = async (prisma: AuditClient, input: AuditInput): Promise<void> => {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        ...(input.before !== undefined ? { before: input.before as Prisma.InputJsonValue } : {}),
        ...(input.after !== undefined ? { after: input.after as Prisma.InputJsonValue } : {}),
      },
    });
  } catch (error) {
    console.error('[audit] falha ao gravar auditoria:', (error as Error).message);
  }
};
