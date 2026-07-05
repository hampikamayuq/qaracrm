import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth-routes.js';
import metaWebhookRoutes from './routes/meta-webhook-routes.js';
import tawanyRoutes from './routes/tawany-routes.js';
import operationsRoutes from './routes/operations-routes.js';
import inboxRoutes from './routes/inbox-routes.js';
import appointmentRoutes from './routes/appointment-routes.js';
import lgpdRoutes from './routes/lgpd-routes.js';
import { prisma } from './lib/deps.js';
import { createPrismaDataApi } from './lib/prisma-data-api.js';
import { startScheduler } from './lib/scheduler.js';
import { assertProductionConfig, requestLogger, securityHeaders } from './lib/production.js';

assertProductionConfig();
const app = express();

app.use(securityHeaders);
app.use(requestLogger);
app.use(
  cors({
    origin: process.env.CORS_DOMAIN ?? process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  }),
);

// ponytail: rawBody is only for Meta HMAC, but capturing it globally is simpler
// and keeps route tests from needing a special body parser.
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf: Buffer) => {
      (req as unknown as Record<string, unknown>).rawBody = buf;
    },
  }),
);

app.use('/api/auth', authRoutes);
app.use('/api/webhooks/meta', metaWebhookRoutes);
app.use('/api/tawany', tawanyRoutes);
app.use('/api/operations', operationsRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/lgpd', lgpdRoutes);

startScheduler(createPrismaDataApi(prisma));

app.get('/api/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok' } });
});

app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[api] unhandled error:', err.message);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

export default app;
