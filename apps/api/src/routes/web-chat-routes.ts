import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/deps';
import { createAiClient } from '../lib/ai-client';
import { createPrismaDataApi } from '../lib/prisma-data-api';
import { handleWebChatMessage, findWebConversation } from '../logic-functions/web-chat';
import { runTawanyForProcessedMessages } from '../lib/shadow';
import { addWebChatListener, removeWebChatListener } from '../lib/web-chat-events';

// Canal WEB — endpoint público de entrada (POST /message) + SSE por sessão
// (GET /stream/:webSessionId). Auth do POST: token de widget compartilhado
// (WEB_WIDGET_TOKEN, header x-widget-token, comparação timing-safe, fail-closed
// sem env). O SSE é público (o webSessionId é um UUID opaco). CORS de ambos
// restrito a WEB_WIDGET_ORIGIN (aplicado no wiring em app.ts).

const router: Router = Router();
const data = createPrismaDataApi(prisma);

const HEARTBEAT_MS = 25_000;

// Rate limit por IP (mesmo padrão do loginLimiter em auth-routes): protege o
// endpoint público de flood. Janela curta, teto generoso para chat ao vivo.
const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, error: 'Too many messages, slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Teto de conexões SSE por IP: evita que um único cliente abra EventSource em
// loop. O teto por sessão fica em web-chat-events (memória/sockets).
const streamLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, error: 'Too many stream connections' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limit do histórico por IP: o widget busca o histórico ao (re)conectar,
// então o teto é folgado, mas ainda protege de flood.
const historyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, error: 'Too many history requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Últimas N mensagens do histórico (widget reidrata ao reconectar).
const HISTORY_LIMIT = 50;

// Comparação em tempo constante (mesmo desenho do meta-signature): compara
// tamanho antes para não vazar timing e evitar throw do timingSafeEqual.
const isValidWidgetToken = (req: Request): boolean => {
  const token = process.env.WEB_WIDGET_TOKEN;
  if (!token) return false; // fail-closed
  const received = req.headers['x-widget-token'];
  if (typeof received !== 'string') return false;
  const receivedBuf = Buffer.from(received, 'utf8');
  const tokenBuf = Buffer.from(token, 'utf8');
  if (receivedBuf.length !== tokenBuf.length) return false;
  return timingSafeEqual(receivedBuf, tokenBuf);
};

const messageSchema = z.object({
  webSessionId: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().min(8).max(20).optional(),
  text: z.string().trim().min(1).max(2000),
  clientMsgId: z.string().trim().min(1).max(120),
});

const dispatchProcessedMessages = async (
  processedMessages: Array<{ conversationId: string; messageId: string }>,
): Promise<void> => {
  await runTawanyForProcessedMessages(processedMessages, {
    createAi: createAiClient,
    data,
  });
};

export const receiveWebChatMessage = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!process.env.WEB_WIDGET_TOKEN) {
      console.error('[web-chat] WEB_WIDGET_TOKEN não configurado — rejeitando');
      res.status(401).json({ success: false, error: 'unauthorized' });
      return;
    }
    if (!isValidWidgetToken(req)) {
      res.status(401).json({ success: false, error: 'unauthorized' });
      return;
    }

    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'invalid_body' });
      return;
    }
    const msg = parsed.data;

    // Primeira mensagem da sessão exige nome + telefone: sem eles o Lead não
    // nasce identificado. Só validamos quando ainda não há conversa WEB.
    const existing = await findWebConversation(msg.webSessionId, data);
    if (!existing && (!msg.name || !msg.phone)) {
      res.status(400).json({ success: false, error: 'name_and_phone_required' });
      return;
    }

    const result = await handleWebChatMessage(msg, data, undefined, async (m) => {
      await dispatchProcessedMessages([m]);
    });

    // 200 imediato para o widget; Tawany do caminho imediato roda em background.
    res.status(200).json({
      ok: true,
      conversationId: result.conversationId,
      messageId: result.messageId,
    });

    void dispatchProcessedMessages(result.processedMessages)
      .catch((err) => console.error('[web-chat] tawany dispatch failed:', (err as Error).message));
  } catch (e) {
    console.error('[web-chat] error:', (e as Error).message);
    res.status(500).json({ success: false, error: 'internal_error' });
  }
};

// SSE público por sessão. Sem JWT — o webSessionId é o segredo (UUID opaco).
export const streamWebChat = (req: Request, res: Response): void => {
  const webSessionId = typeof req.params.webSessionId === 'string' ? req.params.webSessionId : '';
  if (!webSessionId || !/^[0-9a-fA-F-]{36}$/.test(webSessionId)) {
    res.status(400).json({ success: false, error: 'invalid_session' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Cap de conexões por sessão: além do teto, emite um frame de erro e encerra
  // (headers já foram enviados, então não dá para trocar por um status HTTP).
  if (!addWebChatListener(webSessionId, res)) {
    res.write('event: error\ndata: {"error":"too_many_connections"}\n\n');
    res.end();
    return;
  }

  res.write('event: connected\ndata: {}\n\n');

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeWebChatListener(webSessionId, res);
  });
};

// Histórico da sessão: o widget busca as últimas mensagens ao (re)conectar para
// reidratar a conversa. Mesma auth por token do POST /message (fail-closed).
// Sessão nova sem conversa não é erro — devolve lista vazia (200). Cada item usa
// o mesmo shape do evento SSE OUT ({ direction, text, at, messageId }, messageId
// = id do ChatMessage) para o widget deduplicar histórico ↔ ao vivo pelo id.
export const getWebChatHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!process.env.WEB_WIDGET_TOKEN) {
      console.error('[web-chat] WEB_WIDGET_TOKEN não configurado — rejeitando');
      res.status(401).json({ success: false, error: 'unauthorized' });
      return;
    }
    if (!isValidWidgetToken(req)) {
      res.status(401).json({ success: false, error: 'unauthorized' });
      return;
    }

    const webSessionId = typeof req.params.webSessionId === 'string' ? req.params.webSessionId : '';
    if (!/^[0-9a-fA-F-]{36}$/.test(webSessionId)) {
      res.status(400).json({ success: false, error: 'invalid_session' });
      return;
    }

    const conversation = await findWebConversation(webSessionId, data);
    if (!conversation) {
      // Sessão fresca sem conversa: histórico vazio, não 404.
      res.status(200).json({ ok: true, messages: [] });
      return;
    }

    // Pega as últimas HISTORY_LIMIT (DESC) e devolve em ordem cronológica (ASC).
    // direction sempre IN/OUT no schema — não há linha de sistema para filtrar.
    const rows = await data.list('chatMessage', {
      filter: { conversationId: { eq: conversation.id }, direction: { in: ['IN', 'OUT'] } },
      orderBy: { sentAt: 'DESC' },
      limit: HISTORY_LIMIT,
      select: { id: true, direction: true, body: true, sentAt: true },
    });

    const messages = rows
      .reverse()
      .map((row) => ({
        direction: row.direction as 'IN' | 'OUT',
        text: typeof row.body === 'string' ? row.body : '',
        at: new Date(row.sentAt as string | number | Date).toISOString(),
        messageId: row.id as string,
      }));

    res.status(200).json({ ok: true, messages });
  } catch (e) {
    console.error('[web-chat] history error:', (e as Error).message);
    res.status(500).json({ success: false, error: 'internal_error' });
  }
};

router.post('/message', messageLimiter, receiveWebChatMessage);
router.get('/stream/:webSessionId', streamLimiter, streamWebChat);
router.get('/history/:webSessionId', historyLimiter, getWebChatHistory);

export default router;
