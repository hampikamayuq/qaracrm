import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/deps';
import { createPrismaDataApi } from '../lib/prisma-data-api';
import { authMiddleware } from '../middleware/auth-middleware';
import { sendWhatsApp } from '../lib/tools/sendWhatsApp';
import { isMetaSendConfigured } from '../lib/whatsapp-client';

const router = Router();
const data = createPrismaDataApi(prisma);

const paramStr = (value: unknown): string => (typeof value === 'string' ? value : '');

const CONVERSATION_STATUSES = new Set([
  'OPEN', 'PENDING_PATIENT', 'PENDING_HUMAN', 'NEEDS_HUMAN', 'RESOLVED', 'CLOSED',
]);

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

// Estado derivado de quem está conduzindo a conversa (badge do inbox):
//   tawany_ativa      — OPEN e sem needsHuman: Tawany responde sozinha.
//   aguardando_humano — needsHuman: handoff pendente (motivo em handoffReason).
//   humano_assumiu    — humano respondeu/assumiu (status != OPEN, sem needsHuman).
export type AgentState = 'tawany_ativa' | 'aguardando_humano' | 'humano_assumiu';
export const agentStateOf = (status: string, needsHuman: boolean): AgentState =>
  needsHuman ? 'aguardando_humano' : status === 'OPEN' ? 'tawany_ativa' : 'humano_assumiu';

const positiveInt = (value: unknown, fallback: number): number => {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const listInboxRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const status = typeof req.query.status === 'string' && req.query.status.length > 0
      ? req.query.status
      : undefined;
    const needsHuman = req.query.needsHuman === 'true'
      ? true
      : req.query.needsHuman === 'false'
        ? false
        : undefined;
    const page = positiveInt(req.query.page, 1);
    const pageSize = Math.min(100, positiveInt(req.query.pageSize, 25));
    const where: Prisma.ConversationWhereInput = {};

    if (status) where.status = status;
    if (needsHuman !== undefined) where.needsHuman = needsHuman;
    if (search) {
      // ponytail: ILIKE on lead name is enough for C1; add pg_trgm when this hurts.
      where.lead = { name: { contains: search, mode: 'insensitive' } };
    }

    const [items, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          status: true,
          needsHuman: true,
          handoffReason: true,
          channel: true,
          instance: { select: { id: true, name: true } },
          lastMessageAt: true,
          updatedAt: true,
          lead: {
            select: {
              id: true,
              name: true,
              phone: true,
              score: true,
              tags: true,
              temperature: true,
            },
          },
          messages: {
            take: 1,
            orderBy: { sentAt: 'desc' },
            select: { id: true, body: true, sentAt: true, direction: true },
          },
          aiSuggestions: {
            where: { status: 'PENDING' },
            take: 1,
            select: { id: true, body: true, riskLevel: true, status: true },
          },
        },
      }),
      prisma.conversation.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        items: items.map((item) => ({ ...item, agentState: agentStateOf(item.status, item.needsHuman) })),
        total,
        page,
      },
    });
  } catch {
    jsonError(res, 500, 'Failed to load inbox');
  }
};

export const getInboxDetailRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    if (typeof id !== 'string' || id.length === 0) {
      jsonError(res, 400, 'conversation id required');
      return;
    }

    const item = await prisma.conversation.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        needsHuman: true,
        handoffReason: true,
        channel: true,
        instance: { select: { id: true, name: true } },
        lastMessageAt: true,
        updatedAt: true,
        classification: true,
        lead: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            source: true,
            intent: true,
            score: true,
            tags: true,
            temperature: true,
            nextAction: true,
            stage: { select: { id: true, name: true } },
          },
        },
        patient: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            preferredChannel: true,
            notesAdministrative: true,
          },
        },
        messages: {
          take: 100,
          orderBy: { sentAt: 'asc' },
          select: {
            id: true,
            direction: true,
            body: true,
            mediaUrl: true,
            agentHandled: true,
            sentAt: true,
          },
        },
        tasks: {
          where: { status: { not: 'DONE' } },
          orderBy: { dueAt: 'asc' },
          take: 8,
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueAt: true,
          },
        },
        aiSuggestions: {
          where: { status: 'PENDING' },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            body: true,
            riskLevel: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    if (!item) {
      jsonError(res, 404, 'Conversation not found');
      return;
    }

    // Sugestões já enviadas (SENT/TEST_SENT) para o feedback 👍/👎 nas bolhas
    // da Tawany. A UI casa mensagem ↔ sugestão pelo body.
    const sentSuggestions = await prisma.aiSuggestion.findMany({
      where: { conversationId: id, status: { in: ['SENT', 'TEST_SENT'] } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, body: true, status: true, feedback: true },
    });

    res.json({
      success: true,
      data: {
        ...item,
        agentState: agentStateOf(item.status, item.needsHuman),
        sentSuggestions,
      },
    });
  } catch {
    jsonError(res, 500, 'Failed to load conversation');
  }
};

// Inicia (ou reabre) uma conversa a partir de um contato — até aqui conversa
// só nascia de mensagem RECEBIDA via webhook. Aceita leadId ou patientId;
// paciente sem lead ganha um (find-or-create por telefone, mesmo padrão dos
// webhooks). Se o lead já tem conversa, devolve a mais recente em vez de
// duplicar. Canal da conversa nova: oficial quando o envio Meta está
// configurado; senão a primeira instância QR conectada; senão oficial mesmo
// (em dev sem Meta o envio grava a mensagem como PENDING, sem quebrar).
export const startConversationRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const leadIdInput = typeof req.body?.leadId === 'string' ? req.body.leadId : '';
    const patientIdInput = typeof req.body?.patientId === 'string' ? req.body.patientId : '';
    if (!leadIdInput && !patientIdInput) {
      jsonError(res, 400, 'leadId ou patientId required');
      return;
    }

    let leadId = leadIdInput;
    let name = '';
    let phone = '';

    if (patientIdInput) {
      const patient = await prisma.patient.findUnique({
        where: { id: patientIdInput },
        select: { id: true, name: true, phone: true, leadId: true },
      });
      if (!patient) {
        jsonError(res, 404, 'Patient not found');
        return;
      }
      name = patient.name;
      phone = (patient.phone ?? '').replace(/\D/g, '');
      leadId = patient.leadId ?? '';
    }

    if (leadId) {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { id: true, name: true, phone: true },
      });
      if (!lead) {
        jsonError(res, 404, 'Lead not found');
        return;
      }
      name = name || lead.name;
      phone = phone || (lead.phone ?? '').replace(/\D/g, '');
    }

    if (!phone) {
      jsonError(res, 400, 'Contato sem telefone — cadastre o telefone antes de iniciar a conversa.');
      return;
    }

    // Paciente sem lead: find-or-create por telefone (Conversation.leadId é obrigatório).
    if (!leadId) {
      const existingLead = await prisma.lead.findFirst({ where: { phone }, select: { id: true } });
      leadId = existingLead
        ? existingLead.id
        : (await prisma.lead.create({ data: { name: name || phone, phone, source: 'CRM' } })).id;
      // Liga o paciente ao lead para as próximas vezes.
      await prisma.patient.update({ where: { id: patientIdInput }, data: { leadId } }).catch(() => {});
    }

    const existing = await prisma.conversation.findFirst({
      where: { leadId },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
      select: { id: true },
    });
    if (existing) {
      res.json({ success: true, data: { conversationId: existing.id, created: false } });
      return;
    }

    let channel = 'WHATSAPP';
    let instanceId: string | null = null;
    if (!isMetaSendConfigured()) {
      const instance = await prisma.whatsAppInstance.findFirst({
        where: { status: 'CONNECTED' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (instance) {
        channel = 'WHATSAPP_QR';
        instanceId = instance.id;
      }
    }

    const conversation = await prisma.conversation.create({
      data: {
        leadId,
        ...(patientIdInput ? { patientId: patientIdInput } : {}),
        channel,
        instanceId,
        externalId: phone,
        status: 'OPEN',
        // Conversa iniciada pela equipe é conduzida por humano — a Tawany só
        // entra se alguém devolver pra ela no Inbox.
        needsHuman: true,
        handoffReason: 'conversa_iniciada_pela_equipe',
        lastMessageAt: new Date(),
      },
      select: { id: true },
    });
    res.json({ success: true, data: { conversationId: conversation.id, created: true } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const replyRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = paramStr(req.params.id);
    const text = req.body?.text;
    if (typeof text !== 'string' || text.trim().length === 0) {
      jsonError(res, 400, 'text required');
      return;
    }
    const conversation = await prisma.conversation.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!conversation) {
      jsonError(res, 404, 'Conversation not found');
      return;
    }
    const result = JSON.parse(await sendWhatsApp.execute({ conversationId: id, text: text.trim() }, data));
    // Falha dura (ex.: número QR com instância desconectada): nada foi gravado
    // nem enviado — devolve 409 para o Inbox mostrar o erro em vez de fingir
    // sucesso.
    if (result?.ok === false) {
      jsonError(res, 409, typeof result.error === 'string' ? result.error : 'send_failed');
      return;
    }
    // Autoria: reply manual pertence ao atendente logado (sentById), o que
    // habilita "conversas por atendente" nos relatórios. A tool sendWhatsApp é
    // compartilhada com a Tawany, então a autoria é gravada aqui, não nela.
    if (typeof result?.messageId === 'string' && req.userId) {
      await prisma.chatMessage.updateMany({
        where: { id: result.messageId },
        data: { sentById: req.userId },
      });
    }
    // Resposta manual = humano assumiu: formaliza o estado. Tawany não volta a
    // responder (gate exige status OPEN) até "Devolver para a Tawany".
    if (conversation.status !== 'RESOLVED' && conversation.status !== 'CLOSED') {
      await prisma.conversation.updateMany({
        where: { id },
        data: { needsHuman: false, status: 'PENDING_PATIENT' },
      });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const handoffRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await prisma.conversation.updateMany({
      where: { id: paramStr(req.params.id) },
      data: { needsHuman: true, status: 'PENDING_HUMAN', handoffReason: 'manual_handoff' },
    });
    if (result.count === 0) {
      jsonError(res, 404, 'Conversation not found');
      return;
    }
    res.json({ success: true, data: { needsHuman: true, status: 'PENDING_HUMAN' } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

// Reabre a conversa para a Tawany: precisa de needsHuman=false + status OPEN
// (o gate do runTawanyHandler exige os dois) e limpa o motivo do handoff.
export const devolverTawanyRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await prisma.conversation.updateMany({
      where: { id: paramStr(req.params.id) },
      data: { needsHuman: false, status: 'OPEN', handoffReason: null },
    });
    if (result.count === 0) {
      jsonError(res, 404, 'Conversation not found');
      return;
    }
    res.json({ success: true, data: { status: 'OPEN', needsHuman: false, agentState: 'tawany_ativa' } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const setStatusRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const status = req.body?.status;
    if (typeof status !== 'string' || !CONVERSATION_STATUSES.has(status)) {
      jsonError(res, 400, `status must be one of: ${[...CONVERSATION_STATUSES].join(', ')}`);
      return;
    }
    const closing = status === 'RESOLVED' || status === 'CLOSED';
    const result = await prisma.conversation.updateMany({
      where: { id: paramStr(req.params.id) },
      data: { status, ...(closing ? { needsHuman: false } : {}) },
    });
    if (result.count === 0) {
      jsonError(res, 404, 'Conversation not found');
      return;
    }
    res.json({ success: true, data: { status } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

const leadTagsOf = async (conversationId: string): Promise<{ leadId: string; tags: string[] } | null> => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { lead: { select: { id: true, tags: true } } },
  });
  if (!conversation?.lead) return null;
  const tags = Array.isArray(conversation.lead.tags)
    ? conversation.lead.tags.filter((t): t is string => typeof t === 'string')
    : [];
  return { leadId: conversation.lead.id, tags };
};

export const addTagRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const tag = typeof req.body?.tag === 'string' ? req.body.tag.trim() : '';
    if (!tag) {
      jsonError(res, 400, 'tag required');
      return;
    }
    const lead = await leadTagsOf(paramStr(req.params.id));
    if (!lead) {
      jsonError(res, 404, 'Conversation or lead not found');
      return;
    }
    const tags = lead.tags.includes(tag) ? lead.tags : [...lead.tags, tag];
    await prisma.lead.update({ where: { id: lead.leadId }, data: { tags } });
    res.json({ success: true, data: { tags } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const removeTagRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const tag = decodeURIComponent(paramStr(req.params.tag));
    const lead = await leadTagsOf(paramStr(req.params.id));
    if (!lead) {
      jsonError(res, 404, 'Conversation or lead not found');
      return;
    }
    const tags = lead.tags.filter((existing) => existing !== tag);
    await prisma.lead.update({ where: { id: lead.leadId }, data: { tags } });
    res.json({ success: true, data: { tags } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

router.get('/list', authMiddleware, listInboxRoute);
router.get('/:id', authMiddleware, getInboxDetailRoute);
router.post('/start', authMiddleware, startConversationRoute);
router.post('/:id/reply', authMiddleware, replyRoute);
router.post('/:id/handoff', authMiddleware, handoffRoute);
router.post('/:id/devolver-tawany', authMiddleware, devolverTawanyRoute);
router.patch('/:id/status', authMiddleware, setStatusRoute);
router.post('/:id/tags', authMiddleware, addTagRoute);
router.delete('/:id/tags/:tag', authMiddleware, removeTagRoute);

export default router;
