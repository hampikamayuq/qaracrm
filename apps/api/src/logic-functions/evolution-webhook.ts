import type { DataApi } from '../lib/data';
import { defaultDebounce, type Debouncer } from '../lib/debounce';
import { emitInboundMessage } from '../lib/events';
import { getEvolutionMediaBase64, mapEvolutionState } from '../lib/evolution-client';
import {
  parseEvolutionWebhook,
  type EvolutionConnectionUpdate,
  type EvolutionInboundMessage,
} from '../lib/evolution-parse';
import { isAudioTranscriptionEnabled, transcribeAudio } from '../lib/transcription-client';

// Pipeline do canal WHATSAPP_QR (números extras pareados por QR via Evolution).
// Decisão de produto (2026-07-11): a Tawany TAMBÉM atende este canal — mesmo
// fluxo do oficial (debounce → Tawany), com duas diferenças deliberadas:
// - Sem confirmação D-1/NPS/bots aqui (HSM e botões são exclusivos do canal
//   oficial; bots por palavra-chave ficam de fora até decisão própria).
// - Em modos autônomos (autopilot/híbrido) a resposta em número QR exige
//   aprovação humana — gateSendModeForChannel força suggest_only, mitigando
//   o risco de ban em número não-oficial (mesmo tratamento do Instagram).

export type ProcessedMessageHandler = (message: {
  conversationId: string;
  messageId: string;
}) => Promise<void>;

export type EvolutionWebhookResult = {
  messages: number;
  connections: number;
  processedMessages: Array<{ conversationId: string; messageId: string }>;
};

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
  debounce: Debouncer,
  onProcessedMessage?: ProcessedMessageHandler,
): Promise<{ counted: boolean; processed: { conversationId: string; messageId: string } | null }> => {
  const dup = await data.list('chatMessage', {
    filter: { externalId: { eq: msg.externalId } },
    limit: 1,
    select: { id: true },
  });
  // Retry do Evolution — ou echo fromMe de mensagem que o CRM enviou via
  // sendText (gravada com o mesmo key.id).
  if (dup.length > 0) return { counted: false, processed: null };

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
    return { counted: true, processed: null };
  }

  await maybeTranscribeAudio(msg, data, conversation.id);

  const optout = debounce.isOptOut(msg.text);
  const immediateGate = !onProcessedMessage && !optout
    ? debounce.check(conversation.id, msg.externalId, msg.text)
    : null;

  // Mesmo espelho do canal oficial: a mensagem nasce agentHandled até o
  // debounce liberar (o processReadyMessage remarca como false).
  const created = await data.create('chatMessage', {
    conversationId: conversation.id,
    direction: 'IN',
    body: msg.text,
    sentAt: msg.sentAt,
    externalId: msg.externalId,
    messageType: msg.messageType,
    agentHandled: Boolean(onProcessedMessage) || optout || immediateGate?.status !== 'process',
  });
  const messageId = typeof created.id === 'string' ? created.id : '';

  // Notificação em tempo real (SSE) para o Inbox. emitInboundMessage é
  // internamente protegida: nunca quebra o webhook.
  emitInboundMessage({
    conversationId: conversation.id,
    leadName: msg.pushName || undefined,
    preview: msg.text,
  });

  if (optout) {
    // Opt-out vale para o lead inteiro (bloqueia também as automações do canal
    // oficial), mas nenhuma confirmação automática sai pelo número QR.
    await data.update('conversation', conversation.id, {
      lastMessageAt: msg.sentAt,
      needsHuman: true,
      status: 'PENDING_HUMAN',
      handoffReason: 'opt_out_detected',
    });
    if (typeof conversation.leadId === 'string' && conversation.leadId) {
      await data.update('lead', conversation.leadId, { optedOut: true, optedOutAt: new Date() });
      console.log(JSON.stringify({ event: 'evolution_optout', conversationId: conversation.id, messageId: msg.externalId }));
    }
    return { counted: true, processed: null };
  }

  // Sem handoff automático: a conversa segue no estado atual (OPEN vai pra
  // Tawany; PENDING_HUMAN/fechada é pulada pelo gate do runTawanyHandler,
  // igual ao canal oficial).
  await data.update('conversation', conversation.id, { lastMessageAt: msg.sentAt });

  const processReadyMessage = async (ready: { conversationId: string; messageId: string; text: string }): Promise<void> => {
    await data.update('chatMessage', ready.messageId, { agentHandled: false });
    await onProcessedMessage?.({ conversationId: ready.conversationId, messageId: ready.messageId });
  };

  const gate = immediateGate ?? debounce.check(
    conversation.id,
    messageId || msg.externalId,
    msg.text,
    processReadyMessage,
  );

  console.log(JSON.stringify({ event: 'evolution_inbound', conversationId: conversation.id, messageId: msg.externalId, gate: gate.status }));
  if (gate.status !== 'process') return { counted: true, processed: null };
  return {
    counted: true,
    processed: messageId ? { conversationId: conversation.id, messageId } : null,
  };
};

export const handleEvolutionWebhook = async (
  body: unknown,
  data: DataApi,
  debounce: Debouncer = defaultDebounce,
  onProcessedMessage?: ProcessedMessageHandler,
): Promise<EvolutionWebhookResult> => {
  const events = parseEvolutionWebhook(body);
  let messages = 0;
  let connections = 0;
  const processedMessages: EvolutionWebhookResult['processedMessages'] = [];

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
    } else {
      const result = await ingestMessage(event, instance, data, debounce, onProcessedMessage);
      if (result.counted) messages++;
      if (result.processed) processedMessages.push(result.processed);
    }
  }

  console.log(JSON.stringify({ event: 'evolution_webhook', messages, connections }));
  return { messages, connections, processedMessages };
};
