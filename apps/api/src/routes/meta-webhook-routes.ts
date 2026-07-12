import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/deps';
import { createAiClient } from '../lib/ai-client';
import { createPrismaDataApi } from '../lib/prisma-data-api';
import { handleMetaWebhook } from '../logic-functions/meta-webhook';
import { verifyMetaSignature } from '../lib/meta-signature';
import { isDuplicateWebhook } from '../lib/webhook-dedup';
import { forwardWebhookToTwenty, runTawanyForProcessedMessages } from '../lib/shadow';
import type { Debouncer } from '../lib/debounce';

const router: Router = Router();
const data = createPrismaDataApi(prisma);

const PENDING_WEBHOOK_AGE_MS = 2 * 60 * 1000;
const PENDING_WEBHOOK_LIMIT = 25;

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

type PendingSweepOptions = {
  now?: Date;
  olderThanMs?: number;
  limit?: number;
};

export const processPendingMetaWebhookEvents = async (
  options: PendingSweepOptions = {},
): Promise<{ scanned: number; processed: number; failed: number }> => {
  const now = options.now ?? new Date();
  const olderThanMs = options.olderThanMs ?? PENDING_WEBHOOK_AGE_MS;
  const limit = options.limit ?? PENDING_WEBHOOK_LIMIT;
  const cutoff = new Date(now.getTime() - olderThanMs);
  const events = await prisma.webhookEvent.findMany({
    where: {
      source: 'meta',
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
      const result = await handleMetaWebhook(event.payload, data, immediateDebounce);
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

// Meta verification endpoint (GET)
export const verifyMetaWebhook = (req: Request, res: Response): void => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === (process.env.META_VERIFY_TOKEN ?? 'qara-verify-token')) {
    res.status(200).send(challenge as string);
    return;
  }
  res.sendStatus(403);
};

// Incoming webhook events (POST)
export const receiveMetaWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    // [BLOQUEANTE] Use raw bytes for HMAC verification (not JSON.stringify)
    const rawBytes = (req as unknown as { rawBody?: Buffer }).rawBody;
    const rawBody = rawBytes ? rawBytes.toString('utf-8') : JSON.stringify(req.body);

    // Fail-closed: sem META_APP_SECRET o webhook rejeita tudo — antes ele
    // aceitava qualquer POST anônimo quando o secret não estava configurado.
    if (!process.env.META_APP_SECRET) {
      console.error('[meta-webhook] META_APP_SECRET não configurado — rejeitando webhook');
      res.sendStatus(403);
      return;
    }
    if (!signature) {
      res.sendStatus(403);
      return;
    }
    const valid = verifyMetaSignature(rawBody, signature, process.env.META_APP_SECRET);
    if (!valid) {
      res.sendStatus(403);
      return;
    }

    // Signature-based dedup (5-min window)
    const duplicate = await isDuplicateWebhook(prisma, 'meta', signature ?? null);
    if (duplicate) {
      res.status(200).json({ success: true, data: { deduplicated: true } });
      return;
    }

    // [BLOQUEANTE] Persist WebhookEvent before processing (replay-safe, no queues needed)
    const webhookEvent = await prisma.webhookEvent.create({
      data: {
        source: 'meta',
        payload: req.body,
        signature: signature ?? null,
        processed: false,
      },
    });

    void forwardWebhookToTwenty({
      rawBody: rawBytes ?? Buffer.from(rawBody),
      signature,
    }).catch((err) => console.error('[shadow] forward to Twenty failed:', (err as Error).message));

    // Always return 200 to Meta immediately — they retry non-200
    res.status(200).json({ success: true, data: { eventId: webhookEvent.id } });

    // [BLOQUEANTE] Process async: don't block the HTTP response
    setImmediate(async () => {
      try {
        const result = await handleMetaWebhook(req.body, data, undefined, async (message) => {
          await dispatchProcessedMessages([message]);
        });
        await prisma.webhookEvent.update({
          where: { id: webhookEvent.id },
          data: { processed: true, error: null },
        });
        void dispatchProcessedMessages(result.processedMessages)
          .catch((err) => console.error('[tawany] webhook run failed:', (err as Error).message));
      } catch (err) {
        console.error('[meta-webhook] async processing error:', (err as Error).message);
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
    console.error('[meta-webhook] error:', (e as Error).message);
    // Always return 200 to Meta — they retry non-200
    res.status(200).json({ success: false, error: (e as Error).message });
  }
};

router.get('/', verifyMetaWebhook);
router.post('/', receiveMetaWebhook);

export default router;
