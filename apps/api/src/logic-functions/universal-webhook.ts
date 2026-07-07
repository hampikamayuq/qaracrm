import { defineLogicFunction } from 'twenty-sdk/define';
import { Response, type RoutePayload } from 'twenty-sdk/logic-function';
import { prisma } from 'src/lib/deps';
import { createPrismaDataApi } from 'src/lib/prisma-data-api';

const data = createPrismaDataApi(prisma);

const CLINICAL_PIPELINES = [
  'dermatologia-clinica',
  'tricologia',
  'cirurgia',
  'unhas',
  'podologia',
  'inflamatorias',
  'dermatopediatria',
  'administrativo',
  'reativacao',
] as const;

const jsonError = (status: number, error: string): Response => {
  return new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
};

const normalizePhoneBR = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('55')) return `+${digits}`;
  if (digits.length === 10) return `+55${digits}`;
  if (digits.length === 11) return `+55${digits}`;
  return phone;
};

export const handleUniversalWebhook = async (event: RoutePayload): Promise<Response> => {
  const secret = process.env.LEAD_WEBHOOK_SECRET;
  const providedSecret = event.headers?.['x-webhook-secret'] ?? event.headers?.['X-Webhook-Secret'];

  if (!secret || providedSecret !== secret) {
    return jsonError(401, 'Invalid or missing webhook secret');
  }

  try {
    const body = event.body ?? {};
    const nome = typeof body?.nome === 'string' ? body.nome.trim() : '';
    const telefone = typeof body?.telefone === 'string' ? body.telefone.trim() : '';
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const origem = typeof body?.origem === 'string' ? body.origem.trim() : 'SITE';
    const intencao = typeof body?.intencao === 'string' ? body.intencao.trim() : 'OUTRO';
    const pipeline = typeof body?.pipeline === 'string' ? body.pipeline.trim() : 'dermatologia-clinica';
    const tags = Array.isArray(body?.tags) ? body.tags.filter((t): t is string => typeof t === 'string') : [];
    const observacoes = typeof body?.observacoes === 'string' ? body.observacoes : '';
    const score = typeof body?.score === 'number' ? body.score : 50;
    const externalId = typeof body?.externalId === 'string' ? body.externalId.trim() : '';

    if (!nome && !telefone && !email) {
      return jsonError(400, 'Pelo menos um dos campos (nome, telefone, email) deve ser informado');
    }

    if (pipeline && !CLINICAL_PIPELINES.includes(pipeline as typeof CLINICAL_PIPELINES[number])) {
      return jsonError(400, `Pipeline inválido. Deve ser um de: ${CLINICAL_PIPELINES.join(', ')}`);
    }

    const normalizedPhone = telefone ? normalizePhoneBR(telefone) : telefone;

    let leadId: string;

    if (normalizedPhone) {
      const existingLeads = await data.list('lead', {
        filter: { whatsapp: { primaryPhoneNumber: { eq: normalizedPhone } } },
        select: { id: true },
      });
      if (existingLeads.length > 0) {
        leadId = existingLeads[0].id as string;
        const [firstName, ...lastNameParts] = nome.split(' ');
        const lastName = lastNameParts.join(' ');
        await data.update('lead', leadId, {
          name: { firstName, lastName },
          email: email ? { primaryEmail: email } : undefined,
          source: origem,
          intent: intencao,
          pipeline,
          tags,
          notes: observacoes,
          score,
        });
      } else {
        const [firstName, ...lastNameParts] = nome.split(' ');
        const lastName = lastNameParts.join(' ');
        const lead = await data.create('lead', {
          name: { firstName, lastName },
          whatsapp: normalizedPhone ? { primaryPhoneNumber: normalizedPhone } : undefined,
          email: email ? { primaryEmail: email } : undefined,
          source: origem,
          intent: intencao,
          pipeline,
          tags,
          notes: observacoes,
          score,
          stage: 'NOVO',
          position: 0,
        });
        leadId = lead.id;
      }
    } else if (email) {
      const existingLeads = await data.list('lead', {
        filter: { email: { primaryEmail: { eq: email } } },
        select: { id: true },
      });
      if (existingLeads.length > 0) {
        leadId = existingLeads[0].id as string;
        const [firstName, ...lastNameParts] = nome.split(' ');
        const lastName = lastNameParts.join(' ');
        await data.update('lead', leadId, {
          name: { firstName, lastName },
          whatsapp: telefone ? { primaryPhoneNumber: telefone } : undefined,
          source: origem,
          intent: intencao,
          pipeline,
          tags,
          notes: observacoes,
          score,
        });
      } else {
        const [firstName, ...lastNameParts] = nome.split(' ');
        const lastName = lastNameParts.join(' ');
        const lead = await data.create('lead', {
          name: { firstName, lastName },
          whatsapp: telefone ? { primaryPhoneNumber: telefone } : undefined,
          email: email ? { primaryEmail: email } : undefined,
          source: origem,
          intent: intencao,
          pipeline,
          tags,
          notes: observacoes,
          score,
          stage: 'NOVO',
          position: 0,
        });
        leadId = lead.id;
      }
    } else {
      const [firstName, ...lastNameParts] = nome.split(' ');
      const lastName = lastNameParts.join(' ');
      const lead = await data.create('lead', {
        name: { firstName, lastName },
        source: origem,
        intent: intencao,
        pipeline,
        tags,
        notes: observacoes,
        score,
        stage: 'NOVO',
        position: 0,
      });
      leadId = lead.id;
    }

    let conversationId: string;
    const existingConvs = await data.list('conversation', {
      filter: { leadId: { eq: leadId }, status: { in: ['OPEN', 'NEEDS_HUMAN'] } },
      select: { id: true },
      orderBy: { lastMessageAt: 'DESC' },
    });
    if (existingConvs.length > 0) {
      conversationId = existingConvs[0].id as string;
    } else {
      const conv = await data.create('conversation', {
        leadId,
        status: 'OPEN',
        channel: 'WEBHOOK',
        externalId: externalId || `webhook-${Date.now()}`,
        needsHuman: false,
      });
      conversationId = conv.id;
    }

    const message = await data.create('chatMessage', {
      conversationId,
      direction: 'IN',
      body: typeof body?.mensagem === 'string' ? body.mensagem : 'Lead recebido via webhook universal',
      sentAt: new Date().toISOString(),
      agentHandled: false,
    });

    return new Response(JSON.stringify({
      success: true,
      data: { leadId, conversationId, messageId: message.id },
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return jsonError(500, (error as Error).message);
  }
};

export default defineLogicFunction({
  universalIdentifier: 'a1b2c3d4-e5f6-7890-abcd-ef1234567892',
  name: 'universal-webhook',
  description: 'Webhook universal para receber leads externos (site, Google Ads, planilhas) via POST /s/webhook/lead',
  timeoutSeconds: 30,
  httpRouteTriggerSettings: {
    path: '/webhook/lead',
    httpMethod: 'POST',
    isAuthRequired: false,
  },
  handler: handleUniversalWebhook,
});