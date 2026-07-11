export type MetaChannel = 'WHATSAPP' | 'INSTAGRAM';
export type MetaMessageType = 'TEXT' | 'BUTTON' | 'LIST' | 'IMAGE' | 'DOCUMENT';

// Referência para baixar o áudio depois (o parse é síncrono e puro; o download
// + transcrição acontecem no pipeline de ingestão). WhatsApp entrega só o media
// id (baixar em 2 etapas com Bearer); Instagram já entrega a url direta.
export type MetaAudioRef =
  | { source: 'whatsapp'; mediaId: string; voice: boolean }
  | { source: 'instagram'; url: string };

export type MetaInboundMessage = {
  channel: MetaChannel;
  externalId: string;
  from: string;
  text: string;
  sentAt: string;
  messageType: MetaMessageType;
  // Payload estável do botão clicado: button.payload (quick-reply de template)
  // ou interactive.button_reply.id (botões de sessão). Usado para intercepções
  // determinísticas (ex.: confirmação do lembrete D-1) sem depender do texto.
  buttonPayload?: string;
  // Presente quando a mensagem é uma nota de voz/áudio. O pipeline usa isto para
  // baixar e transcrever; sem transcrição, o `text` fica no placeholder [áudio].
  audio?: MetaAudioRef;
};

// Placeholder exibido no Inbox quando o áudio não é (ou não pôde ser) transcrito.
export const AUDIO_PLACEHOLDER = '[áudio]';

// Coexistence (número compartilhado entre o app WhatsApp Business e a Cloud
// API): quando alguém da clínica responde pelo celular, a Meta espelha a
// mensagem para nós via campo `smb_message_echoes`. `to` é o telefone do
// paciente (wa_id) — a chave da conversa, já que o `from` é o nosso número.
export type MetaEchoMessage = {
  channel: 'WHATSAPP';
  externalId: string;
  to: string;
  text: string;
  sentAt: string;
  messageType: MetaMessageType;
};

export type MetaDeliveryStatus = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export type MetaStatusUpdate = { externalId: string; status: MetaDeliveryStatus };
export type ParsedMetaEvent = {
  messages: MetaInboundMessage[];
  statuses: MetaStatusUpdate[];
  echoes: MetaEchoMessage[];
};

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');

const STATUS_MAP: Record<string, MetaDeliveryStatus> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};

// Extrai texto + tipo (+ payload do botão, quando houver) de uma mensagem
// WhatsApp Cloud API.
const waContent = (
  msg: Rec,
): { text: string; messageType: MetaMessageType; buttonPayload?: string; audio?: MetaAudioRef } => {
  const type = asStr(msg.type);
  if (type === 'text') return { text: asStr(asRec(msg.text).body), messageType: 'TEXT' };
  if (type === 'audio') {
    // Nota de voz (voice:true) ou arquivo de áudio: guardamos o media id para
    // o pipeline baixar + transcrever. Enquanto isso, placeholder no corpo.
    const audio = asRec(msg.audio);
    const mediaId = asStr(audio.id);
    return {
      text: AUDIO_PLACEHOLDER,
      messageType: 'TEXT',
      ...(mediaId ? { audio: { source: 'whatsapp', mediaId, voice: Boolean(audio.voice) } } : {}),
    };
  }
  if (type === 'button') {
    // Clique em botão quick-reply de um template HSM aprovado.
    const btn = asRec(msg.button);
    const payload = asStr(btn.payload);
    return { text: asStr(btn.text), messageType: 'BUTTON', ...(payload ? { buttonPayload: payload } : {}) };
  }
  if (type === 'interactive') {
    const i = asRec(msg.interactive);
    const btn = asRec(i.button_reply);
    const list = asRec(i.list_reply);
    if (asStr(i.type) === 'list_reply') return { text: asStr(list.title), messageType: 'LIST' };
    // Clique em botão interativo de sessão: o "id" que definimos ao montar o
    // botão funciona como payload estável (mesmo papel do button.payload acima).
    const payload = asStr(btn.id);
    return { text: asStr(btn.title), messageType: 'BUTTON', ...(payload ? { buttonPayload: payload } : {}) };
  }
  if (type === 'image')
    return { text: asStr(asRec(msg.image).caption) || '[imagem]', messageType: 'IMAGE' };
  if (type === 'video')
    return { text: asStr(asRec(msg.video).caption) || '[vídeo]', messageType: 'TEXT' };
  if (type === 'document')
    return { text: asStr(asRec(msg.document).caption) || '[documento]', messageType: 'DOCUMENT' };
  return { text: `[${type || 'desconhecido'}]`, messageType: 'TEXT' };
};

const parseWhatsApp = (body: Rec): ParsedMetaEvent => {
  const messages: MetaInboundMessage[] = [];
  const statuses: MetaStatusUpdate[] = [];
  const echoes: MetaEchoMessage[] = [];
  for (const entry of asArr(body.entry)) {
    for (const change of asArr(asRec(entry).changes)) {
      const value = asRec(asRec(change).value);
      for (const s of asArr(value.statuses)) {
        const status = STATUS_MAP[asStr(asRec(s).status)];
        const id = asStr(asRec(s).id);
        if (status && id) statuses.push({ externalId: id, status });
      }
      // Coexistence: espelho de mensagens enviadas pelo app WhatsApp Business.
      // revoke/edit de mensagens do app ficam fora do escopo v1 — ignorados.
      for (const e of asArr(value.message_echoes)) {
        const echo = asRec(e);
        const type = asStr(echo.type);
        if (type === 'revoke' || type === 'edit') continue;
        const id = asStr(echo.id);
        const to = asStr(echo.to);
        if (!id || !to) continue;
        const { text, messageType } = waContent(echo);
        echoes.push({
          channel: 'WHATSAPP',
          externalId: id,
          to,
          text,
          sentAt: new Date(Number(asStr(echo.timestamp)) * 1000).toISOString(),
          messageType,
        });
      }
      for (const m of asArr(value.messages)) {
        const msg = asRec(m);
        const id = asStr(msg.id);
        const from = asStr(msg.from);
        if (!id || !from) continue;
        const { text, messageType, buttonPayload, audio } = waContent(msg);
        messages.push({
          channel: 'WHATSAPP',
          externalId: id,
          from,
          text,
          sentAt: new Date(Number(asStr(msg.timestamp)) * 1000).toISOString(),
          messageType,
          ...(buttonPayload ? { buttonPayload } : {}),
          ...(audio ? { audio } : {}),
        });
      }
    }
  }
  return { messages, statuses, echoes };
};

const parseInstagram = (body: Rec): ParsedMetaEvent => {
  const messages: MetaInboundMessage[] = [];
  for (const entry of asArr(body.entry)) {
    for (const ev of asArr(asRec(entry).messaging)) {
      const e = asRec(ev);
      const msg = asRec(e.message);
      // Ignora ecos das nossas próprias respostas (is_echo). Sem isso, o eco
      // vira inbound e pode disparar a Tawany num loop de auto-resposta.
      if (msg.is_echo) continue;
      const mid = asStr(msg.mid);
      const from = asStr(asRec(e.sender).id);
      if (!mid || !from) continue;
      // Anexo de áudio: o webhook do IG entrega attachments[].payload.url direto.
      const audioAtt = asArr(msg.attachments)
        .map(asRec)
        .find((a) => asStr(a.type) === 'audio' && asStr(asRec(a.payload).url));
      const audio: MetaAudioRef | undefined = audioAtt
        ? { source: 'instagram', url: asStr(asRec(audioAtt.payload).url) }
        : undefined;
      const text = asStr(msg.text) || (audio ? AUDIO_PLACEHOLDER : '[anexo]');
      messages.push({
        channel: 'INSTAGRAM',
        externalId: mid,
        from,
        text,
        sentAt: new Date(Number(e.timestamp) || Date.now()).toISOString(),
        messageType: 'TEXT',
        ...(audio ? { audio } : {}),
      });
    }
  }
  return { messages, statuses: [], echoes: [] };
};

export const parseMetaEvent = (body: unknown): ParsedMetaEvent => {
  const rec = asRec(body);
  if (rec.object === 'whatsapp_business_account') return parseWhatsApp(rec);
  // O Instagram Direct entrega os eventos ora como object='instagram', ora como
  // object='page' (via Página do Facebook vinculada). Mesmo shape entry[].messaging[].
  if (rec.object === 'instagram' || rec.object === 'page') return parseInstagram(rec);
  return { messages: [], statuses: [], echoes: [] };
};
