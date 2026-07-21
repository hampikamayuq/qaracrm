// Parse defensivo dos webhooks do Kommo (ex-amoCRM). Os webhooks de CRM
// chegam como POST x-www-form-urlencoded com chaves aninhadas
// (`leads[add][0][id]=...`, `message[add][0][text]=...`) que o
// express.urlencoded({ extended: true }) transforma em objetos/arrays. O hook
// do salesbot (widget_request) chega como JSON com o shape que NÓS definimos
// no corpo do passo (ver docs/kommo-integration.md). Mesmo estilo
// puro/síncrono do meta-parse.ts / evolution-parse.ts.

import { createHash } from 'node:crypto';

export type KommoLeadUpsert = {
  kind: 'lead';
  kommoLeadId: string;
  name: string;
  statusId: string | null;
  pipelineId: string | null;
  price: number | null;
};

export type KommoStatusChange = {
  kind: 'status';
  kommoLeadId: string;
  statusId: string | null;
  pipelineId: string | null;
  oldStatusId: string | null;
  oldPipelineId: string | null;
};

export type KommoMessage = {
  kind: 'message';
  direction: 'IN' | 'OUT';
  externalId: string;
  chatId: string;
  talkId: string | null;
  contactId: string | null;
  kommoLeadId: string | null;
  text: string;
  sentAt: string;
  authorName: string;
  contactName: string;
  contactPhone: string | null;
};

export type KommoEvent = KommoLeadUpsert | KommoStatusChange | KommoMessage;

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const asStr = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const idOrNull = (v: unknown): string | null => {
  const s = asStr(v);
  return s ? s : null;
};

// `leads[add][0]` pode virar array OU objeto com chaves numéricas, dependendo
// do parser/qs — normalizamos para lista.
const listOf = (v: unknown): Rec[] => {
  if (Array.isArray(v)) return v.map(asRec);
  const rec = asRec(v);
  const keys = Object.keys(rec);
  if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
    return keys.sort((a, b) => Number(a) - Number(b)).map((k) => asRec(rec[k]));
  }
  return [];
};

const sentAtFromUnix = (v: unknown): string => {
  const ts = Number(v);
  return Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString();
};

const parseLeadUpsert = (item: Rec): KommoLeadUpsert | null => {
  const kommoLeadId = asStr(item.id);
  if (!kommoLeadId) return null;
  const price = Number(item.price);
  return {
    kind: 'lead',
    kommoLeadId,
    name: asStr(item.name),
    statusId: idOrNull(item.status_id),
    pipelineId: idOrNull(item.pipeline_id),
    price: Number.isFinite(price) && asStr(item.price) !== '' ? price : null,
  };
};

const parseStatusChange = (item: Rec): KommoStatusChange | null => {
  const kommoLeadId = asStr(item.id);
  if (!kommoLeadId) return null;
  return {
    kind: 'status',
    kommoLeadId,
    statusId: idOrNull(item.status_id),
    pipelineId: idOrNull(item.pipeline_id),
    oldStatusId: idOrNull(item.old_status_id),
    oldPipelineId: idOrNull(item.old_pipeline_id),
  };
};

const parseMessage = (item: Rec): KommoMessage | null => {
  const id = asStr(item.id);
  const text = asStr(item.text);
  if (!id || !text) return null;
  const type = asStr(item.type).toLowerCase();
  // entity_type 'lead'/'leads' + entity_id = lead do Kommo dono da conversa.
  const entityType = asStr(item.entity_type).toLowerCase();
  const author = asRec(item.author);
  return {
    kind: 'message',
    direction: type === 'outgoing' ? 'OUT' : 'IN',
    externalId: `kommo:${id}`,
    chatId: asStr(item.chat_id) || asStr(item.talk_id) || asStr(item.contact_id) || asStr(item.entity_id),
    talkId: idOrNull(item.talk_id),
    contactId: idOrNull(item.contact_id),
    kommoLeadId: entityType.startsWith('lead') ? idOrNull(item.entity_id) : null,
    text,
    sentAt: sentAtFromUnix(item.created_at),
    authorName: asStr(author.name),
    contactName: '',
    contactPhone: null,
  };
};

export const parseKommoWebhook = (body: unknown): KommoEvent[] => {
  const rec = asRec(body);
  const events: KommoEvent[] = [];

  const leads = asRec(rec.leads);
  for (const item of [...listOf(leads.add), ...listOf(leads.update)]) {
    const parsed = parseLeadUpsert(item);
    if (parsed) events.push(parsed);
  }
  for (const item of listOf(leads.status)) {
    const parsed = parseStatusChange(item);
    if (parsed) events.push(parsed);
  }

  const message = asRec(rec.message);
  for (const item of listOf(message.add)) {
    const parsed = parseMessage(item);
    if (parsed) events.push(parsed);
  }

  return events;
};

// Hook do salesbot (widget_request). O corpo é definido por nós na
// configuração do passo — placeholders do Kommo preenchem os campos:
// { "message_id": "{{message.id}}", "message_text": "{{message_text}}",
//   "lead_id": "{{lead.id}}", "talk_id": "{{talk.id}}",
//   "contact_name": "{{contact.name}}", "contact_phone": "{{contact.phone}}" }
// Sem message_id estável, sintetizamos um id com bucket de 60s + hash do
// texto: retry do mesmo POST dentro do minuto dedupa, mas mensagens
// DIFERENTES no mesmo minuto não colidem. Texto idêntico repetido dentro do
// mesmo minuto ainda dedupa (limitação documentada).
export const parseKommoSalesbotHook = (body: unknown, nowMs = Date.now()): KommoMessage | null => {
  const rec = asRec(body);
  const data = asRec(rec.data);
  // Campos podem vir na raiz ou dentro de `data`, conforme a configuração.
  const field = (key: string): unknown => (rec[key] !== undefined ? rec[key] : data[key]);
  const text = asStr(field('message_text')).trim();
  const leadId = asStr(field('lead_id'));
  const chatId = asStr(field('chat_id')) || asStr(field('talk_id')) || leadId;
  if (!text || !chatId) return null;
  const messageId = asStr(field('message_id'));
  const minuteBucket = Math.floor(nowMs / 60_000);
  const textHash = createHash('sha1').update(text).digest('hex').slice(0, 10);
  return {
    kind: 'message',
    direction: 'IN',
    externalId: messageId ? `kommo:${messageId}` : `kommo:sb:${chatId}:${minuteBucket}:${textHash}`,
    chatId,
    talkId: idOrNull(field('talk_id')),
    contactId: idOrNull(field('contact_id')),
    kommoLeadId: leadId || null,
    text,
    sentAt: new Date(nowMs).toISOString(),
    authorName: '',
    contactName: asStr(field('contact_name')),
    contactPhone: idOrNull(field('contact_phone')),
  };
};

// KOMMO_STAGE_MAP: JSON `{"<pipelineId>:<statusId>": "<estagio-ui>", ...}`;
// aceita também `"<statusId>"` como chave (vale para qualquer pipeline).
// Valores devem ser estágios canônicos de UI_STAGES (validados no ingest).
export const parseKommoStageMap = (raw: string | undefined): Record<string, string> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    const rec = asRec(parsed);
    const map: Record<string, string> = {};
    for (const [key, value] of Object.entries(rec)) {
      if (typeof value === 'string' && value) map[key] = value;
    }
    return map;
  } catch {
    console.error('[kommo] KOMMO_STAGE_MAP inválido (JSON) — ignorando');
    return {};
  }
};

export const stageForKommoStatus = (
  map: Record<string, string>,
  pipelineId: string | null,
  statusId: string | null,
): string | null => {
  if (!statusId) return null;
  if (pipelineId && map[`${pipelineId}:${statusId}`]) return map[`${pipelineId}:${statusId}`];
  return map[statusId] ?? null;
};
