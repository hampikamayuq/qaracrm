import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/deps';
import { createAiClient } from '../lib/ai-client';
import { createPrismaDataApi } from '../lib/prisma-data-api';
import { handleEvolutionWebhook } from '../logic-functions/evolution-webhook';
import { runTawanyForProcessedMessages } from '../lib/shadow';
import type { Debouncer } from '../lib/debounce';

// Webhook do gateway Evolution API (números extras via QR). Autenticação por
// segredo compartilhado: o header x-webhook-secret é configurado por instância
// na criação (evolution-client.createEvolutionInstance) — mesmo padrão do
// webhook de leads (LEAD_WEBHOOK_SECRET). Fail-closed sem env.

const router: Router = Router();
const data = createPrismaDataApi(prisma);

const PENDING_WEBHOOK_AGE_MS = 2 * 60 * 1000;
const PENDING_WEBHOOK_LIMIT = 25;

// Mesmo desenho do webhook Meta: no sweep as mensagens já envelheceram além
// da janela de debounce, então processa direto.
const immediateDebounce: Debouncer = {
  check: () => ({ status: 'process' }),
  isOptOut: (text: string) => {
    const normalized = text.trim().toLowerCase();
    return /(^|\s)(parar|pare|sair|cancelar|descadastrar|stop|nao quero|não quero)([\s.!?]|$)/i.test(normalized);
  },
};

const dispatchProcessedMessages = async (
  processedMessages: Array<{ conversationId: string; messageId: string }>,
): Promise<void> => {
  await runTawanyForProcessedMessages(processedMessages, {
    createAi: createAiClient,
    data,
  });
};

const isValidWebhookSecret = (req: Request): boolean => {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (!secret) return false; // fail-closed
  const received = req.headers['x-webhook-secret'];
  if (typeof received !== 'string') return false;
  // Comparação em tempo constante (mesmo desenho do meta-signature): compara
  // tamanho antes para não vazar timing e evitar throw do timingSafeEqual.
  const receivedBuf = Buffer.from(received, 'utf8');
  const secretBuf = Buffer.from(secret, 'utf8');
  if (receivedBuf.length !== secretBuf.length) return false;
  return timingSafeEqual(receivedBuf, secretBuf);
};

type PendingSweepOptions = {
  now?: Date;
  olderThanMs?: number;
  limit?: number;
};

// Rede de segurança para eventos que o setImmediate não concluiu (deploy no
// meio do processamento, crash) — mesmo desenho do sweep do webhook Meta.
export const processPendingEvolutionWebhookEvents = async (
  options: PendingSweepOptions = {},
): Promise<{ scanned: number; processed: number; failed: number }> => {
  const now = options.now ?? new Date();
  const olderThanMs = options.olderThanMs ?? PENDING_WEBHOOK_AGE_MS;
  const limit = options.limit ?? PENDING_WEBHOOK_LIMIT;
  const cutoff = new Date(now.getTime() - olderThanMs);
  const events = await prisma.webhookEvent.findMany({
    where: {
      source: 'evolution',
      processed: false,
      createdAt: { lt: cutoff },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  let processed = 0;
  let failed = 0;
  for (const event of events) {
    try {
      const result = await handleEvolutionWebhook(event.payload, data, immediateDebounce);
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { processed: true, error: null },
      });
      await dispatchProcessedMessages(result.processedMessages);
      processed++;
    } catch (error) {
      failed++;
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { processed: true, error: (error as Error).message.slice(0, 500) },
      });
    }
  }

  return { scanned: events.length, processed, failed };
};

export const receiveEvolutionWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!process.env.EVOLUTION_WEBHOOK_SECRET) {
      console.error('[evolution-webhook] EVOLUTION_WEBHOOK_SECRET não configurado — rejeitando webhook');
      res.sendStatus(401);
      return;
    }
    if (!isValidWebhookSecret(req)) {
      res.sendStatus(401);
      return;
    }

    // Persistir antes de processar (replay-safe); dedup fica por conta do
    // key.id no ingest — o Evolution não assina payloads como a Meta.
    const webhookEvent = await prisma.webhookEvent.create({
      data: {
        source: 'evolution',
        payload: req.body,
        processed: false,
      },
    });

    // 200 imediato — processamento assíncrono, como no webhook Meta.
    res.status(200).json({ success: true, data: { eventId: webhookEvent.id } });

    setImmediate(async () => {
      try {
        const result = await handleEvolutionWebhook(req.body, data, undefined, async (message) => {
          await dispatchProcessedMessages([message]);
        });
        await prisma.webhookEvent.update({
          where: { id: webhookEvent.id },
          data: { processed: true, error: null },
        });
        void dispatchProcessedMessages(result.processedMessages)
          .catch((err) => console.error('[tawany] evolution webhook run failed:', (err as Error).message));
      } catch (err) {
        console.error('[evolution-webhook] async processing error:', (err as Error).message);
        // Falha transiente (ex.: IA fora do ar) fica processed: false para o
        // sweep tentar de novo; o catch do sweep é quem dead-lettera. Replay é
        // idempotente: o ingest dedupa mensagens por externalId.
        await prisma.webhookEvent.update({
          where: { id: webhookEvent.id },
          data: { processed: false, error: (err as Error).message.slice(0, 500) },
        });
      }
    });
  } catch (e) {
    console.error('[evolution-webhook] error:', (e as Error).message);
    res.status(200).json({ success: false, error: (e as Error).message });
  }
};

router.post('/', receiveEvolutionWebhook);

export default router;
