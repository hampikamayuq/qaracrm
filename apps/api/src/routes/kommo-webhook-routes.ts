import { createHash, timingSafeEqual } from 'node:crypto';
import express, { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/deps';
import { createAiClient } from '../lib/ai-client';
import { createPrismaDataApi } from '../lib/prisma-data-api';
import { handleKommoSalesbotHook, handleKommoWebhook } from '../logic-functions/kommo-webhook';
import { isDuplicateWebhook } from '../lib/webhook-dedup';
import { runTawanyForProcessedMessages } from '../lib/shadow';
import type { Debouncer } from '../lib/debounce';

// Webhook do Kommo (ex-amoCRM). O Kommo não assina payloads nem envia headers
// customizados: a autenticação é o segredo embutido no path da URL
// (/api/webhooks/kommo/<KOMMO_WEBHOOK_SECRET>), comparado em tempo constante —
// fail-closed sem env. Payload de CRM chega form-urlencoded; o hook do
// salesbot (widget_request) chega JSON. Mesmo desenho persist→200→async+sweep
// dos webhooks Meta/Evolution.

const router: Router = Router();
const data = createPrismaDataApi(prisma);

// Só nesta rota: o express.json global ignora form-urlencoded, então o parser
// extra não afeta nenhum outro endpoint.
router.use(express.urlencoded({ extended: true, limit: '1mb' }));

const PENDING_WEBHOOK_AGE_MS = 2 * 60 * 1000;
const PENDING_WEBHOOK_LIMIT = 25;

// Mesmo desenho dos webhooks Meta/Evolution: no sweep as mensagens já
// envelheceram além da janela de debounce, então processa direto.
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
  const secret = process.env.KOMMO_WEBHOOK_SECRET;
  if (!secret) return false; // fail-closed
  const received = req.params.secret;
  if (typeof received !== 'string') return false;
  const receivedBuf = Buffer.from(received, 'utf8');
  const secretBuf = Buffer.from(secret, 'utf8');
  if (receivedBuf.length !== secretBuf.length) return false;
  return timingSafeEqual(receivedBuf, secretBuf);
};

// O Kommo reenvia em caso de falha/timeout e não assina o payload: dedup por
// hash do corpo na janela do webhook-dedup (5 min).
const bodySignature = (body: unknown): string =>
  createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');

type PendingSweepOptions = {
  now?: Date;
  olderThanMs?: number;
  limit?: number;
};

// Rede de segurança para eventos que o setImmediate não concluiu (deploy no
// meio do processamento, crash) — mesmo desenho do sweep dos outros webhooks.
export const processPendingKommoWebhookEvents = async (
  options: PendingSweepOptions = {},
): Promise<{ scanned: number; processed: number; failed: number }> => {
  const now = options.now ?? new Date();
  const olderThanMs = options.olderThanMs ?? PENDING_WEBHOOK_AGE_MS;
  const limit = options.limit ?? PENDING_WEBHOOK_LIMIT;
  const cutoff = new Date(now.getTime() - olderThanMs);
  const events = await prisma.webhookEvent.findMany({
    where: {
      source: 'kommo',
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
      const payload = event.payload as { __kommoSalesbotHook?: boolean } | null;
      const result = payload?.__kommoSalesbotHook
        ? await handleKommoSalesbotHook(payload, data, immediateDebounce)
        : await handleKommoWebhook(event.payload, data, immediateDebounce);
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

type KommoHandler = typeof handleKommoWebhook;

const receiveWith = (handler: KommoHandler, markSalesbot: boolean) =>
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!process.env.KOMMO_WEBHOOK_SECRET) {
        console.error('[kommo-webhook] KOMMO_WEBHOOK_SECRET não configurado — rejeitando webhook');
        res.sendStatus(401);
        return;
      }
      if (!isValidWebhookSecret(req)) {
        res.sendStatus(401);
        return;
      }

      const signature = bodySignature(req.body);
      if (await isDuplicateWebhook(prisma, 'kommo', signature)) {
        res.status(200).json({ success: true, data: { duplicate: true } });
        return;
      }

      // O marcador __kommoSalesbotHook permite ao sweep reprocessar o evento
      // com o handler certo depois de um crash.
      const payload = markSalesbot && req.body && typeof req.body === 'object'
        ? { ...(req.body as Record<string, unknown>), __kommoSalesbotHook: true }
        : req.body;

      const webhookEvent = await prisma.webhookEvent.create({
        data: {
          source: 'kommo',
          payload,
          signature,
          processed: false,
        },
      });

      // 200 imediato — o Kommo exige resposta < 2s e desativa o webhook após
      // falhas repetidas; todo o processamento é assíncrono.
      res.status(200).json({ success: true, data: { eventId: webhookEvent.id } });

      setImmediate(async () => {
        try {
          const result = await handler(req.body, data, undefined, async (message) => {
            await dispatchProcessedMessages([message]);
          });
          await prisma.webhookEvent.update({
            where: { id: webhookEvent.id },
            data: { processed: true, error: null },
          });
          void dispatchProcessedMessages(result.processedMessages)
            .catch((err) => console.error('[tawany] kommo webhook run failed:', (err as Error).message));
        } catch (err) {
          console.error('[kommo-webhook] async processing error:', (err as Error).message);
          // Falha transiente fica processed: false para o sweep tentar de
          // novo; o catch do sweep é quem dead-lettera. Replay é idempotente:
          // o ingest dedupa mensagens por externalId.
          await prisma.webhookEvent.update({
            where: { id: webhookEvent.id },
            data: { processed: false, error: (err as Error).message.slice(0, 500) },
          });
        }
      });
    } catch (e) {
      console.error('[kommo-webhook] error:', (e as Error).message);
      res.status(200).json({ success: false, error: 'Erro interno' });
    }
  };

export const receiveKommoWebhook = receiveWith(handleKommoWebhook, false);
export const receiveKommoSalesbotHook = receiveWith(handleKommoSalesbotHook, true);

router.post('/:secret', receiveKommoWebhook);
router.post('/:secret/salesbot', receiveKommoSalesbotHook);

export default router;
