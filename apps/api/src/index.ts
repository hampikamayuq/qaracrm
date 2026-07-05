import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth-routes';
import metaWebhookRoutes from './routes/meta-webhook-routes';
import tawanyRoutes from './routes/tawany-routes';
import operationsRoutes from './routes/operations-routes';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

// [BLOQUEANTE] rawBody capture for Meta webhook HMAC verification
app.use(
  express.json({
    verify: (req, _res, buf: Buffer) => {
      (req as unknown as Record<string, unknown>).rawBody = buf;
    },
  }),
);

app.use(cors());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/webhooks/meta', metaWebhookRoutes);
app.use('/api/tawany', tawanyRoutes);
app.use('/api/operations', operationsRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok' } });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});

export default app;
