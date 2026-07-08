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

export const requireReportExportRole = requireAnyRole('admin', 'financeiro', 'finance', 'marketing');
