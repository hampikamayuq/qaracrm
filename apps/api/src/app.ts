import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth-routes.js';
import metaWebhookRoutes, { processPendingMetaWebhookEvents } from './routes/meta-webhook-routes.js';
import evolutionWebhookRoutes, { processPendingEvolutionWebhookEvents } from './routes/evolution-webhook-routes.js';
import kommoWebhookRoutes, { processPendingKommoWebhookEvents } from './routes/kommo-webhook-routes.js';
import tawanyRoutes from './routes/tawany-routes.js';
import operationsRoutes from './routes/operations-routes.js';
import inboxRoutes from './routes/inbox-routes.js';
import appointmentRoutes from './routes/appointment-routes.js';
import lgpdRoutes from './routes/lgpd-routes.js';
import botRoutes from './routes/bot-routes.js';
import taskRoutes from './routes/task-routes.js';
import budgetRoutes from './routes/budget-routes.js';
import paymentRoutes from './routes/payment-routes.js';
import patientRoutes from './routes/patient-routes.js';
import pipelineRoutes from './routes/pipeline-routes.js';
import activityRoutes from './routes/activity-routes.js';
import tagsRoutes from './routes/tags-routes.js';
import webhookCsvRoutes from './routes/webhook-csv-routes.js';
import dashboardRoutes from './routes/dashboard-routes.js';
import reportRoutes from './routes/report-routes.js';
import settingsRoutes from './routes/settings-routes.js';
import usersRoutes from './routes/users-routes.js';
import quickReplyRoutes from './routes/quick-reply-routes.js';
import channelRoutes from './routes/channel-routes.js';
import eventsRoutes from './routes/events-routes.js';
import webChatRoutes from './routes/web-chat-routes.js';
import auditRoutes from './routes/audit-routes.js';
import templateRoutes from './routes/template-routes.js';
import { prisma } from './lib/deps.js';
import { createPrismaDataApi } from './lib/prisma-data-api.js';
import { startScheduler } from './lib/scheduler.js';
import { assertProductionConfig, requestLogger, sanitizeErrorResponses, securityHeaders } from './lib/production.js';

assertProductionConfig();
const app = express();

app.use(securityHeaders);
app.use(requestLogger);
app.use(sanitizeErrorResponses);

// Canal WEB: CORS próprio, restrito ao origin do site do widget. Precisa vir
// ANTES do CORS global do CRM — senão o preflight OPTIONS de /api/web-chat é
// respondido pelo cors global com a origin do CRM e o browser bloqueia o widget.
// Sem credentials — o widget autentica por token no header. origin=false nega
// quando WEB_WIDGET_ORIGIN não está setado (fail-closed).
const webChatCors = cors({ origin: process.env.WEB_WIDGET_ORIGIN ?? false });
app.use('/api/web-chat', webChatCors);

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
app.use('/api/webhooks/evolution', evolutionWebhookRoutes);
app.use('/api/webhooks/kommo', kommoWebhookRoutes);
app.use('/api/tawany', tawanyRoutes);
app.use('/api/operations', operationsRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/lgpd', lgpdRoutes);
app.use('/api/bots', botRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/budgets', budgetRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/pipeline', pipelineRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/tags', tagsRoutes);
app.use('/api/webhook', webhookCsvRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/quick-replies', quickReplyRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/events', eventsRoutes);
// Canal WEB: reusa o mesmo webChatCors do preflight (definido acima).
app.use('/api/web-chat', webChatCors, webChatRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/templates', templateRoutes);

startScheduler(createPrismaDataApi(prisma), undefined, {
  processPendingMetaWebhookEvents,
  processPendingEvolutionWebhookEvents,
  processPendingKommoWebhookEvents,
});

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
