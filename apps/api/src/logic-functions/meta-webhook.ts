import { type DataApi } from '../lib/data';
import { runBotsForInbound } from '../lib/bots/runner';
import { defaultDebounce, type Debouncer } from '../lib/debounce';
import {
  parseMetaEvent,
  type MetaChannel,
  type MetaEchoMessage,
  type MetaInboundMessage,
  type MetaStatusUpdate,
} from '../lib/meta-parse';
import { downloadDirectMedia, downloadWhatsAppMedia } from '../lib/media-client';
import { isAudioTranscriptionEnabled, transcribeAudio } from '../lib/transcription-client';
import { sendWhatsApp } from '../lib/tools/sendWhatsApp';
import { runAppointmentConfirmationForInbound } from './appointment-confirmation';
import { runNpsCaptureForInbound } from './nps-capture';

const OPT_OUT_CONFIRMATION =
  'Você foi removido da nossa lista de contatos. Se mudar de ideia, é só enviar uma mensagem.';

export type MetaWebhookProcessingResult = {
  processedMessages: Array<{ conversationId: string; messageId: string }>;
};

export type ProcessedMessageHandler = (message: { conversationId: string; messageId: string }) => void | Promise<void>;

const applyStatus = async (status: MetaStatusUpdate, data: DataApi): Promise<void> => {
  const found = await data.list('chatMessage', {
    filter: { externalId: { eq: status.externalId } },
    limit: 1,
    select: { id: true },
  });
  if (found[0]) {
    await data.update('chatMessage', found[0].id as string, { deliveryStatus: status.status });
  }
};

// Chave externa da conversa: telefone (WhatsApp) ou PSID/IGSID (Instagram) do
// paciente — vem de `messages[].from` no inbound e de `message_echoes[].to`
// no echo de Coexistence (onde o `from` é o nosso próprio número).
type ConversationKey = { channel: MetaChannel; contact: string; sentAt: string };

// Conversation.leadId é obrigatório no schema — todo primeiro contato precisa
// de um Lead antes da conversa poder existir.
const findOrCreateLead = async (key: ConversationKey, data: DataApi): Promise<string> => {
  const existing = await data.list('lead', {
    filter: { phone: { eq: key.contact } },
    limit: 1,
    select: { id: true },
  });
  if (existing[0]) return existing[0].id as string;
  const created = await data.create('lead', {
    name: key.contact,
    phone: key.contact,
    source: key.channel,
  });
  return created.id as string;
};

const findOrCreateConversation = async (
  key: ConversationKey,
  data: DataApi,
): Promise<{ id: string; leadId?: string | null; status?: string | null }> => {
  const existing = await data.list('conversation', {
    filter: { channel: { eq: key.channel }, externalId: { eq: key.contact } },
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

  const leadId = await findOrCreateLead(key, data);
  const created = await data.create('conversation', {
    leadId,
    channel: key.channel,
    externalId: key.contact,
    status: 'OPEN',
    lastMessageAt: key.sentAt,
  });
  return { id: created.id as string, leadId, status: 'OPEN' };
};

// Coexistence: alguém da clínica respondeu pelo app WhatsApp Business no
// celular. Gravamos o espelho como OUT (o Inbox mostra a conversa completa) e
// aplicamos o mesmo efeito da resposta manual pelo Inbox: humano assumiu —
// a Tawany não fala por cima (o gate exige status OPEN) até "Devolver para a
// Tawany". Echo NUNCA passa por debounce, bots ou Tawany.
const ingestEcho = async (echo: MetaEchoMessage, data: DataApi): Promise<void> => {
  const dup = await data.list('chatMessage', {
    filter: { externalId: { eq: echo.externalId } },
    limit: 1,
    select: { id: true },
  });
  // Retry da Meta — ou mensagem que nós mesmos enviamos via Cloud API (já
  // gravada com o mesmo wamid pelo sendWhatsApp).
  if (dup.length > 0) return;

  const conversation = await findOrCreateConversation(
    { channel: echo.channel, contact: echo.to, sentAt: echo.sentAt },
    data,
  );
  await data.create('chatMessage', {
    conversationId: conversation.id,
    direction: 'OUT',
    body: echo.text,
    sentAt: echo.sentAt,
    externalId: echo.externalId,
    messageType: echo.messageType,
    deliveryStatus: 'SENT',
    agentHandled: true,
  });
  const closed = conversation.status === 'RESOLVED' || conversation.status === 'CLOSED';
  await data.update('conversation', conversation.id, {
    lastMessageAt: echo.sentAt,
    ...(closed ? {} : { needsHuman: false, status: 'PENDING_PATIENT' }),
  });
  console.log(JSON.stringify({ event: 'meta_echo', conversationId: conversation.id, messageId: echo.externalId }));
};

// Transcreve nota de voz/áudio inbound ANTES de gravar a mensagem e de liberar
// o debounce, para que o corpo já vire texto e siga o fluxo normal (Tawany,
// bots, NPS, Inbox) como se fosse texto do paciente. Mutação in-place de
// `msg.text`. Só roda quando a mensagem é áudio e o gate está ligado; qualquer
// falha é não-fatal e degrada para o placeholder ([áudio]). Não adiciona
// latência a mensagens de texto (retorna cedo se não houver `msg.audio`).
const maybeTranscribeAudio = async (
  msg: MetaInboundMessage,
  data: DataApi,
  conversationId: string,
): Promise<void> => {
  if (!msg.audio || !isAudioTranscriptionEnabled()) return;
  try {
    const media =
      msg.audio.source === 'whatsapp'
        ? await downloadWhatsAppMedia(msg.audio.mediaId)
        : await downloadDirectMedia(msg.audio.url);
    const result = await transcribeAudio(
      { base64: media.base64, mimeType: media.mimeType },
      { data, conversationId },
    );
    if (result.ok && result.text) {
      msg.text = `🎤 (áudio transcrito): ${result.text}`;
    }
  } catch (err) {
    // Nunca logamos o conteúdo; só a natureza do erro.
    console.error('[meta-webhook] audio transcription failed (non-fatal):', (err as Error).message);
  }
};

const ingestMessage = async (
  msg: MetaInboundMessage,
  data: DataApi,
  debounce: Debouncer,
  onProcessedMessage?: ProcessedMessageHandler,
): Promise<{ conversationId: string; messageId: string } | null> => {
  const dup = await data.list('chatMessage', {
    filter: { externalId: { eq: msg.externalId } },
    limit: 1,
    select: { id: true },
  });
  if (dup.length > 0) return null; // Meta retry — já processada

  const conversation = await findOrCreateConversation(
    { channel: msg.channel, contact: msg.from, sentAt: msg.sentAt },
    data,
  );
  // Áudio -> texto antes de gravar/debounce, para fluir como texto do paciente.
  await maybeTranscribeAudio(msg, data, conversation.id);
  const optout = debounce.isOptOut(msg.text);
  const immediateGate = !onProcessedMessage && !optout
    ? debounce.check(conversation.id, msg.externalId, msg.text)
    : null;
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

  if (optout) {
    debounce.check(conversation.id, messageId || msg.externalId, msg.text);
    if (conversation.leadId) {
      await data.update('lead', conversation.leadId, { optedOut: true, optedOutAt: new Date() });
    }
    await data.update('conversation', conversation.id, {
      lastMessageAt: msg.sentAt,
      needsHuman: true,
      status: 'PENDING_HUMAN',
      handoffReason: 'opt_out_detected',
    });
    await sendWhatsApp.execute({ conversationId: conversation.id, text: OPT_OUT_CONFIRMATION }, data);
    console.log(JSON.stringify({ event: 'meta_optout', conversationId: conversation.id, messageId: msg.externalId }));
    return null;
  }

  await data.update('conversation', conversation.id, { lastMessageAt: msg.sentAt });

  const processReadyMessage = async (ready: { conversationId: string; messageId: string; text: string }): Promise<void> => {
    await data.update('chatMessage', ready.messageId, { agentHandled: false });
    // Confirmação de agendamento (botão do lembrete D-1) tem precedência sobre
    // bots e a Tawany: se casar, ela responde e a mensagem não segue adiante.
    let handled = false;
    try {
      handled = (await runAppointmentConfirmationForInbound({
        conversationId: ready.conversationId,
        messageType: msg.messageType,
        buttonPayload: msg.buttonPayload,
      }, data)).handled;
    } catch (err) {
      console.error('[meta-webhook] appointment confirmation failed (non-fatal):', (err as Error).message);
    }
    // Captura da pesquisa NPS pós-consulta (LEVA 2B) tem precedência sobre
    // bots e a Tawany, mas cede pra confirmação de agendamento acima: se o
    // paciente respondeu um botão de confirmação, não é nota NPS.
    if (!handled) {
      try {
        handled = (await runNpsCaptureForInbound({
          conversationId: ready.conversationId,
          messageType: msg.messageType,
          text: ready.text,
        }, data)).handled;
      } catch (err) {
        console.error('[meta-webhook] nps capture failed (non-fatal):', (err as Error).message);
      }
    }
    if (!handled) {
      try {
        handled = (await runBotsForInbound({ conversationId: ready.conversationId, text: ready.text }, data)) !== null;
      } catch (err) {
        console.error('[meta-webhook] bot runner failed (non-fatal):', (err as Error).message);
      }
    }
    if (!handled) {
      await onProcessedMessage?.({ conversationId: ready.conversationId, messageId: ready.messageId });
    }
  };

  const gate = immediateGate ?? debounce.check(
    conversation.id,
    messageId || msg.externalId,
    msg.text,
    processReadyMessage,
  );

  if (gate.status === 'defer') {
    return null;
  }
  if (gate.status === 'skip') {
    console.log(JSON.stringify({ event: 'meta_debounce_skip', conversationId: conversation.id, messageId: msg.externalId }));
    return null;
  }
  return messageId ? { conversationId: conversation.id, messageId } : null;
};

export const handleMetaWebhook = async (
  body: unknown,
  data: DataApi,
  debounce: Debouncer = defaultDebounce,
  onProcessedMessage?: ProcessedMessageHandler,
): Promise<MetaWebhookProcessingResult> => {
  const { messages, statuses, echoes } = parseMetaEvent(body);
  const processedMessages: MetaWebhookProcessingResult['processedMessages'] = [];
  for (const status of statuses) await applyStatus(status, data);
  // Echoes de Coexistence antes do inbound: se o mesmo payload trouxer a
  // resposta da clínica e uma mensagem nova do paciente, o "humano assumiu"
  // já vale quando a mensagem do paciente for processada.
  for (const echo of echoes) await ingestEcho(echo, data);
  for (const msg of messages) {
    const processed = await ingestMessage(msg, data, debounce, onProcessedMessage);
    if (!processed) continue;
    // Confirmação de agendamento (botão do lembrete D-1) tem precedência sobre
    // bots e a Tawany: se casar, ela responde e a mensagem não segue adiante.
    let handled = false;
    try {
      handled = (await runAppointmentConfirmationForInbound({
        conversationId: processed.conversationId,
        messageType: msg.messageType,
        buttonPayload: msg.buttonPayload,
      }, data)).handled;
    } catch (err) {
      console.error('[meta-webhook] appointment confirmation failed (non-fatal):', (err as Error).message);
    }
    // Captura da pesquisa NPS pós-consulta (LEVA 2B) tem precedência sobre
    // bots e a Tawany, mas cede pra confirmação de agendamento acima.
    if (!handled) {
      try {
        handled = (await runNpsCaptureForInbound({
          conversationId: processed.conversationId,
          messageType: msg.messageType,
          text: msg.text,
        }, data)).handled;
      } catch (err) {
        console.error('[meta-webhook] nps capture failed (non-fatal):', (err as Error).message);
      }
    }
    // Bots determinísticos têm precedência sobre a Tawany: se um fluxo
    // importado casa, ele responde e a mensagem não segue para a IA.
    if (!handled) {
      try {
        handled = (await runBotsForInbound({ conversationId: processed.conversationId, text: msg.text }, data)) !== null;
      } catch (err) {
        console.error('[meta-webhook] bot runner failed (non-fatal):', (err as Error).message);
      }
    }
    if (!handled) processedMessages.push(processed);
  }

  console.log(
    JSON.stringify({
      event: 'meta_webhook',
      messages: messages.length,
      statuses: statuses.length,
      echoes: echoes.length,
    }),
  );
  return { processedMessages };
};
