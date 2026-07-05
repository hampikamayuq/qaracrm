export type MetaChannel = 'WHATSAPP' | 'INSTAGRAM';
export type MetaMessageType = 'TEXT' | 'BUTTON' | 'LIST' | 'IMAGE' | 'DOCUMENT';

export type MetaInboundMessage = {
  channel: MetaChannel;
  externalId: string;
  from: string;
  text: string;
  sentAt: string;
  messageType: MetaMessageType;
};

export type MetaDeliveryStatus = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export type MetaStatusUpdate = { externalId: string; status: MetaDeliveryStatus };
export type ParsedMetaEvent = { messages: MetaInboundMessage[]; statuses: MetaStatusUpdate[] };

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

// Extrai texto + tipo de uma mensagem WhatsApp Cloud API.
const waContent = (msg: Rec): { text: string; messageType: MetaMessageType } => {
  const type = asStr(msg.type);
  if (type === 'text') return { text: asStr(asRec(msg.text).body), messageType: 'TEXT' };
  if (type === 'button') return { text: asStr(asRec(msg.button).text), messageType: 'BUTTON' };
  if (type === 'interactive') {
    const i = asRec(msg.interactive);
    const btn = asRec(i.button_reply);
    const list = asRec(i.list_reply);
    if (asStr(i.type) === 'list_reply') return { text: asStr(list.title), messageType: 'LIST' };
    return { text: asStr(btn.title), messageType: 'BUTTON' };
  }
  if (type === 'image')
    return { text: asStr(asRec(msg.image).caption) || '[imagem]', messageType: 'IMAGE' };
  if (type === 'document')
    return { text: asStr(asRec(msg.document).caption) || '[documento]', messageType: 'DOCUMENT' };
  return { text: `[${type || 'desconhecido'}]`, messageType: 'TEXT' };
};

const parseWhatsApp = (body: Rec): ParsedMetaEvent => {
  const messages: MetaInboundMessage[] = [];
  const statuses: MetaStatusUpdate[] = [];
  for (const entry of asArr(body.entry)) {
    for (const change of asArr(asRec(entry).changes)) {
      const value = asRec(asRec(change).value);
      for (const s of asArr(value.statuses)) {
        const status = STATUS_MAP[asStr(asRec(s).status)];
        const id = asStr(asRec(s).id);
        if (status && id) statuses.push({ externalId: id, status });
      }
      for (const m of asArr(value.messages)) {
        const msg = asRec(m);
        const id = asStr(msg.id);
        const from = asStr(msg.from);
        if (!id || !from) continue;
        const { text, messageType } = waContent(msg);
        messages.push({
          channel: 'WHATSAPP',
          externalId: id,
          from,
          text,
          sentAt: new Date(Number(asStr(msg.timestamp)) * 1000).toISOString(),
          messageType,
        });
      }
    }
  }
  return { messages, statuses };
};

const parseInstagram = (body: Rec): ParsedMetaEvent => {
  const messages: MetaInboundMessage[] = [];
  for (const entry of asArr(body.entry)) {
    for (const ev of asArr(asRec(entry).messaging)) {
      const e = asRec(ev);
      const msg = asRec(e.message);
      const mid = asStr(msg.mid);
      const from = asStr(asRec(e.sender).id);
      if (!mid || !from) continue;
      messages.push({
        channel: 'INSTAGRAM',
        externalId: mid,
        from,
        text: asStr(msg.text) || '[anexo]',
        sentAt: new Date(Number(e.timestamp) || Date.now()).toISOString(),
        messageType: 'TEXT',
      });
    }
  }
  return { messages, statuses: [] };
};

export const parseMetaEvent = (body: unknown): ParsedMetaEvent => {
  const rec = asRec(body);
  if (rec.object === 'whatsapp_business_account') return parseWhatsApp(rec);
  if (rec.object === 'instagram') return parseInstagram(rec);
  return { messages: [], statuses: [] };
};
