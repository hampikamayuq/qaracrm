import type { DataApi } from '../lib/data';
import { defaultDebounce } from '../lib/debounce';
import { getEvolutionMediaBase64, mapEvolutionState } from '../lib/evolution-client';
import {
  parseEvolutionWebhook,
  type EvolutionConnectionUpdate,
  type EvolutionInboundMessage,
} from '../lib/evolution-parse';
import { isAudioTranscriptionEnabled, transcribeAudio } from '../lib/transcription-client';

// Pipeline do canal WHATSAPP_QR (números extras pareados por QR via Evolution).
// ATENDIMENTO HUMANO APENAS: nada aqui importa/dispara debounce, bots, Tawany,
// NPS ou confirmação de agendamento — mensagens entram no Inbox como
// PENDING_HUMAN e quem responde é gente. Não adicione esses fluxos sem decisão
// explícita de produto (risco de ban em número não-oficial).

export type EvolutionWebhookResult = { messages: number; connections: number };

type InstanceRecord = { id: string; status?: string | null };

const findInstance = async (instanceName: string, data: DataApi): Promise<InstanceRecord | null> => {
  const found = await data.list('whatsAppInstance', {
    filter: { instanceName: { eq: instanceName } },
    limit: 1,
    select: { id: true, status: true },
  });
  if (!found[0]) return null;
  return { id: found[0].id as string, status: found[0].status as string | null | undefined };
};

const applyConnectionUpdate = async (
  event: EvolutionConnectionUpdate,
  instance: InstanceRecord,
  data: DataApi,
): Promise<void> => {
  const status = mapEvolutionState(event.state);
  if (!status) return;
  await data.update('whatsAppInstance', instance.id, {
    status,
    ...(event.phoneNumber ? { phoneNumber: event.phoneNumber } : {}),
    ...(status === 'CONNECTED' ? { lastConnectedAt: new Date().toISOString() } : {}),
  });
  console.log(JSON.stringify({ event: 'evolution_connection', instanceId: instance.id, status }));
};

const findOrCreateLead = async (msg: EvolutionInboundMessage, data: DataApi): Promise<string> => {
  const existing = await data.list('lead', {
    filter: { phone: { eq: msg.contact } },
    limit: 1,
    select: { id: true },
  });
  if (existing[0]) return existing[0].id as string;
  const created = await data.create('lead', {
    // pushName do WhatsApp é melhor que o telefone como nome inicial.
    name: msg.pushName || msg.contact,
    phone: msg.contact,
    source: 'WHATSAPP_QR',
  });
  return created.id as string;
};

const findOrCreateConversation = async (
  msg: EvolutionInboundMessage,
  instance: InstanceRecord,
  data: DataApi,
): Promise<{ id: string; leadId?: string | null; status?: string | null }> => {
  // instanceId na chave: o mesmo paciente falando com 2 números QR (ou com o
  // oficial) tem conversas separadas — o que converge é o Lead (por telefone).
  const existing = await data.list('conversation', {
    filter: {
      channel: { eq: 'WHATSAPP_QR' },
      externalId: { eq: msg.contact },
      instanceId: { eq: instance.id },
    },
    limit: 1,
    select: { id: true, leadId: true, status: true },
  });
  if (existing[0]) {
    return {
      id: existing[0].id as string,
      leadId: existing[0].leadId as string | null | undefined,
      status: existing[0].status as string | null | undefined,
    };
  }
  const leadId = await findOrCreateLead(msg, data);
  const created = await data.create('conversation', {
    leadId,
    channel: 'WHATSAPP_QR',
    instanceId: instance.id,
    externalId: msg.contact,
    status: 'OPEN',
    lastMessageAt: msg.sentAt,
  });
  return { id: created.id as string, leadId, status: 'OPEN' };
};

// Áudio do paciente: baixa via Evolution e transcreve com o mesmo pipeline do
// canal oficial. Falha é não-fatal — fica o placeholder [áudio]. Echo fromMe
// não é transcrito (só áudio do paciente interessa para o atendimento).
const maybeTranscribeAudio = async (
  msg: EvolutionInboundMessage,
  data: DataApi,
  conversationId: string,
): Promise<void> => {
  if (!msg.audioKey || msg.fromMe || !isAudioTranscriptionEnabled()) return;
  try {
    const media = await getEvolutionMediaBase64(msg.instanceName, msg.audioKey);
    const result = await transcribeAudio(
      { base64: media.base64, mimeType: media.mimeType },
      { data, conversationId },
    );
    if (result.ok && result.text) {
      msg.text = `🎤 (áudio transcrito): ${result.text}`;
    }
  } catch (err) {
    // Nunca logamos o conteúdo; só a natureza do erro.
    console.error('[evolution-webhook] audio transcription failed (non-fatal):', (err as Error).message);
  }
};

const ingestMessage = async (
  msg: EvolutionInboundMessage,
  instance: InstanceRecord,
  data: DataApi,
): Promise<boolean> => {
  const dup = await data.list('chatMessage', {
    filter: { externalId: { eq: msg.externalId } },
    limit: 1,
    select: { id: true },
  });
  // Retry do Evolution — ou echo fromMe de mensagem que o CRM enviou via
  // sendText (gravada com o mesmo key.id).
  if (dup.length > 0) return false;

  const conversation = await findOrCreateConversation(msg, instance, data);
  const closed = conversation.status === 'RESOLVED' || conversation.status === 'CLOSED';

  if (msg.fromMe) {
    // Alguém da clínica respondeu pelo celular pareado: espelha como OUT e
    // marca humano-assumiu (mesmo efeito da resposta manual pelo Inbox).
    await data.create('chatMessage', {
      conversationId: conversation.id,
      direction: 'OUT',
      body: msg.text,
      sentAt: msg.sentAt,
      externalId: msg.externalId,
      messageType: msg.messageType,
      deliveryStatus: 'SENT',
      agentHandled: true,
    });
    await data.update('conversation', conversation.id, {
      lastMessageAt: msg.sentAt,
      ...(closed ? {} : { needsHuman: false, status: 'PENDING_PATIENT' }),
    });
    console.log(JSON.stringify({ event: 'evolution_echo', conversationId: conversation.id, messageId: msg.externalId }));
    return true;
  }

  await maybeTranscribeAudio(msg, data, conversation.id);

  // agentHandled: true — não existe fila de IA neste canal; a mensagem é do
  // humano ler no Inbox.
  await data.create('chatMessage', {
    conversationId: conversation.id,
    direction: 'IN',
    body: msg.text,
    sentAt: msg.sentAt,
    externalId: msg.externalId,
    messageType: msg.messageType,
    agentHandled: true,
  });

  // Opt-out vale para o lead inteiro (bloqueia também as automações do canal
  // oficial), mas nenhuma confirmação automática sai pelo número QR.
  const optout = defaultDebounce.isOptOut(msg.text);
  await data.update('conversation', conversation.id, {
    lastMessageAt: msg.sentAt,
    needsHuman: true,
    status: 'PENDING_HUMAN',
    handoffReason: optout ? 'opt_out_detected' : 'canal_qr',
  });
  if (optout && typeof conversation.leadId === 'string' && conversation.leadId) {
    await data.update('lead', conversation.leadId, { optedOut: true, optedOutAt: new Date() });
    console.log(JSON.stringify({ event: 'evolution_optout', conversationId: conversation.id, messageId: msg.externalId }));
  }
  console.log(JSON.stringify({ event: 'evolution_inbound', conversationId: conversation.id, messageId: msg.externalId }));
  return true;
};

export const handleEvolutionWebhook = async (
  body: unknown,
  data: DataApi,
): Promise<EvolutionWebhookResult> => {
  const events = parseEvolutionWebhook(body);
  let messages = 0;
  let connections = 0;

  for (const event of events) {
    const instance = await findInstance(event.instanceName, data);
    if (!instance) {
      // Instância desconhecida (removida do CRM ou de outro ambiente): descarta.
      console.log(JSON.stringify({ event: 'evolution_unknown_instance', instanceName: event.instanceName }));
      continue;
    }
    if (event.kind === 'connection') {
      await applyConnectionUpdate(event, instance, data);
      connections++;
    } else if (event.kind === 'qr') {
      // QR novo emitido = pareamento em andamento. Não guardamos o QR (a tela
      // busca on-demand via /api/channels/:id/qr).
      if (instance.status !== 'CONNECTED') {
        await data.update('whatsAppInstance', instance.id, { status: 'PAIRING' });
      }
      connections++;
    } else if (await ingestMessage(event, instance, data)) {
      messages++;
    }
  }

  console.log(JSON.stringify({ event: 'evolution_webhook', messages, connections }));
  return { messages, connections };
};
