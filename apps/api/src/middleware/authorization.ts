import type { NextFunction, Request, Response } from 'express';

const normalizeRole = (role: string | undefined): string => role?.trim().toLowerCase() ?? '';

export const requireAnyRole = (...allowedRoles: string[]) => {
  const allowed = new Set(allowedRoles.map((role) => role.trim().toLowerCase()));

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!allowed.has(normalizeRole(req.userRole))) {
      res.status(403).json({ success: false, error: 'forbidden' });
      return;
    }

    next();
  };
};

export const requireRole = (role: string) => requireAnyRole(role);

export const requireAdmin = requireRole('admin');

// Conjunto de papéis autorizados a operações financeiras/relatórios. Mantido
// num único lugar para o middleware e a checagem in-handler (gate dependente
// do estado do recurso, ex.: orçamento fora de DRAFT) usarem a mesma regra.
export const REPORT_EXPORT_ROLES = ['admin', 'financeiro', 'finance', 'marketing'] as const;

const REPORT_EXPORT_ROLE_SET = new Set<string>(REPORT_EXPORT_ROLES);

// Predicado reusável quando o gate depende do estado do recurso e precisa ser
// avaliado dentro do handler (não dá para pendurar como middleware fixo).
export const hasReportExportRole = (role: string | undefined): boolean =>
  REPORT_EXPORT_ROLE_SET.has(normalizeRole(role));

export const requireReportExportRole = requireAnyRole(...REPORT_EXPORT_ROLES);
