// Parse defensivo dos webhooks do Evolution API v2 (números extras pareados
// por QR). Shape geral: { event, instance, data } — um evento por POST.
// Mesmo estilo puro/síncrono do meta-parse.ts: o download de mídia e a
// transcrição acontecem no pipeline de ingestão, não aqui.

export type EvolutionMessageType = 'TEXT' | 'IMAGE' | 'DOCUMENT';

export type EvolutionInboundMessage = {
  kind: 'message';
  instanceName: string;
  externalId: string;
  // Telefone do paciente (dígitos do remoteJid) — chave da conversa, tanto no
  // inbound quanto no echo fromMe (mensagem enviada pelo celular pareado).
  contact: string;
  fromMe: boolean;
  pushName: string;
  text: string;
  sentAt: string;
  messageType: EvolutionMessageType;
  // Presente quando a mensagem é áudio/nota de voz: o ingest baixa via
  // getBase64FromMediaMessage usando a key completa e transcreve.
  audioKey?: Record<string, unknown>;
};

export type EvolutionConnectionUpdate = {
  kind: 'connection';
  instanceName: string;
  state: string; // open | connecting | close (mapeado em evolution-client)
  // wuid/ownerJid quando presente — vira WhatsAppInstance.phoneNumber.
  phoneNumber: string | null;
};

export type EvolutionQrUpdate = { kind: 'qr'; instanceName: string };

export type EvolutionEvent = EvolutionInboundMessage | EvolutionConnectionUpdate | EvolutionQrUpdate;

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');

export const AUDIO_PLACEHOLDER = '[áudio]';

// remoteJid → telefone. Só conversas 1:1 (@s.whatsapp.net); grupos, broadcast
// e newsletter ficam fora do CRM. JIDs @lid (privacidade) não carregam o
// telefone — ignorados no v1 (logados pelo caller).
const contactFromJid = (jid: string): string | null => {
  if (!jid.endsWith('@s.whatsapp.net')) return null;
  const digits = jid.split('@')[0];
  return /^\d+$/.test(digits) ? digits : null;
};

const messageContent = (
  message: Rec,
): { text: string; messageType: EvolutionMessageType; isAudio: boolean } => {
  const conversation = asStr(message.conversation);
  if (conversation) return { text: conversation, messageType: 'TEXT', isAudio: false };
  const extended = asStr(asRec(message.extendedTextMessage).text);
  if (extended) return { text: extended, messageType: 'TEXT', isAudio: false };
  if (message.audioMessage) return { text: AUDIO_PLACEHOLDER, messageType: 'TEXT', isAudio: true };
  if (message.imageMessage) {
    const caption = asStr(asRec(message.imageMessage).caption);
    return { text: caption ? `[imagem] ${caption}` : '[imagem]', messageType: 'IMAGE', isAudio: false };
  }
  if (message.videoMessage) {
    const caption = asStr(asRec(message.videoMessage).caption);
    return { text: caption ? `[vídeo] ${caption}` : '[vídeo]', messageType: 'TEXT', isAudio: false };
  }
  if (message.documentMessage) {
    const fileName = asStr(asRec(message.documentMessage).fileName);
    return {
      text: fileName ? `[documento: ${fileName}]` : '[documento]',
      messageType: 'DOCUMENT',
      isAudio: false,
    };
  }
  if (message.stickerMessage) return { text: '[figurinha]', messageType: 'TEXT', isAudio: false };
  return { text: '[mensagem não suportada]', messageType: 'TEXT', isAudio: false };
};

const parseMessageUpsert = (instanceName: string, data: Rec): EvolutionInboundMessage | null => {
  const key = asRec(data.key);
  const remoteJid = asStr(key.remoteJid);
  const externalId = asStr(key.id);
  if (!remoteJid || !externalId) return null;
  const contact = contactFromJid(remoteJid);
  if (!contact) return null; // grupo/broadcast/newsletter/@lid — fora do v1

  const message = asRec(data.message);
  const { text, messageType, isAudio } = messageContent(message);
  const ts = Number(data.messageTimestamp);
  return {
    kind: 'message',
    instanceName,
    externalId,
    contact,
    fromMe: key.fromMe === true,
    pushName: asStr(data.pushName),
    text,
    sentAt: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
    messageType,
    ...(isAudio ? { audioKey: key } : {}),
  };
};

// O Evolution manda um evento por POST; MESSAGES_UPSERT pode vir com data
// única ou array (varia por versão) — normalizamos para lista.
export const parseEvolutionWebhook = (body: unknown): EvolutionEvent[] => {
  const rec = asRec(body);
  const event = asStr(rec.event).toLowerCase();
  const instanceName = asStr(rec.instance);
  if (!instanceName) return [];

  if (event === 'connection.update') {
    const data = asRec(rec.data);
    const state = asStr(data.state);
    if (!state) return [];
    const wuid = asStr(data.wuid) || asStr(data.ownerJid);
    const phoneNumber = wuid ? (contactFromJid(wuid) ?? wuid.split('@')[0] ?? null) : null;
    return [{ kind: 'connection', instanceName, state, phoneNumber: phoneNumber || null }];
  }

  if (event === 'qrcode.updated') {
    return [{ kind: 'qr', instanceName }];
  }

  if (event === 'messages.upsert') {
    const items = Array.isArray(rec.data) ? rec.data : [rec.data];
    return items
      .map((item) => parseMessageUpsert(instanceName, asRec(item)))
      .filter((m): m is EvolutionInboundMessage => m !== null);
  }

  return [];
};
