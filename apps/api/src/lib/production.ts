import type { NextFunction, Request, Response } from 'express';
import { logger } from './logger';

export const assertProductionConfig = (
  env: Partial<Record<'NODE_ENV' | 'JWT_SECRET' | 'CORS_DOMAIN' | 'CORS_ORIGIN', string | undefined>> = process.env,
): void => {
  if (env.NODE_ENV !== 'production') return;
  if (!env.JWT_SECRET || Buffer.byteLength(env.JWT_SECRET) < 32) {
    throw new Error('JWT_SECRET must be at least 32 bytes in production');
  }
  if (!env.CORS_DOMAIN && !env.CORS_ORIGIN) {
    throw new Error('CORS_DOMAIN or CORS_ORIGIN must be configured in production');
  }
};

export const securityHeaders = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  next();
};

export const sanitizeErrorResponses = (req: Request, res: Response, next: NextFunction): void => {
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (
      res.statusCode >= 500
      && typeof body === 'object'
      && body !== null
      && 'success' in body
      && (body as { success?: unknown }).success === false
      && 'error' in body
    ) {
      logger.error({ path: req.path, error: String((body as { error?: unknown }).error) }, 'resposta 5xx sanitizada');
      return originalJson({ ...(body as Record<string, unknown>), error: 'Erro interno' });
    }
    return originalJson(body);
  }) as Response['json'];
  next();
};

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startedAt = Date.now();
  res.on('finish', () => {
    logger.info({
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    }, 'request');
  });
  next();
};
