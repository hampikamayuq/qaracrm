import type { NextFunction, Request, Response } from 'express';
import { logger } from './logger';

export const assertProductionConfig = (env: Pick<NodeJS.ProcessEnv, 'NODE_ENV' | 'JWT_SECRET'> = process.env): void => {
  if (env.NODE_ENV !== 'production') return;
  if (!env.JWT_SECRET || Buffer.byteLength(env.JWT_SECRET) < 32) {
    throw new Error('JWT_SECRET must be at least 32 bytes in production');
  }
};

export const securityHeaders = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
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
