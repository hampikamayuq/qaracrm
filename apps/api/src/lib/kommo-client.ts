// Cliente da API do Kommo (ex-amoCRM) — integração privada com token de longa
// duração (Bearer) sobre https://{KOMMO_SUBDOMAIN}.kommo.com. Leitura de
// leads/contatos para enriquecer o ingest do webhook, notas de auditoria e o
// caminho de resposta via salesbot (custom field + run). Nunca logar corpo de
// mensagem (PHI) — mesmo contrato do evolution-client.

import { CircuitBreaker } from './resilience/circuit-breaker';

export const kommoBreaker = new CircuitBreaker('kommo-api', {
  threshold: 5,
  cooldownMs: 30_000,
});

// Leitura (enriquecimento/notas/reconcile) exige só subdomínio + token.
export const isKommoConfigured = (): boolean =>
  Boolean(process.env.KOMMO_SUBDOMAIN && process.env.KOMMO_ACCESS_TOKEN);

// Envio de resposta exige também o salesbot de resposta e o custom field que
// ele lê — sem eles o canal KOMMO não envia (nada de mensagem fantasma).
export const isKommoReplyConfigured = (): boolean =>
  isKommoConfigured() &&
  Boolean(process.env.KOMMO_REPLY_BOT_ID && process.env.KOMMO_REPLY_FIELD_ID);

type KommoEnv = { baseUrl: string; token: string };

const env = (): KommoEnv => {
  const subdomain = process.env.KOMMO_SUBDOMAIN;
  const token = process.env.KOMMO_ACCESS_TOKEN;
  if (!subdomain || !token) {
    throw new Error('Kommo não configurado (KOMMO_SUBDOMAIN / KOMMO_ACCESS_TOKEN)');
  }
  return { baseUrl: `https://${subdomain}.kommo.com`, token };
};

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');

const request = async (
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<Rec> => {
  const { baseUrl, token } = env();
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  // 204 (sem corpo) é sucesso em alguns endpoints (ex.: salesbot/run).
  if (!res.ok) throw new Error(`Kommo API error: ${res.status} (${method} ${path})`);
  const json = (await res.json().catch(() => ({}))) as unknown;
  return asRec(json);
};

export type KommoLead = {
  id: string;
  name: string;
  statusId: string | null;
  pipelineId: string | null;
  price: number | null;
  mainContactId: string | null;
};

export const getKommoLead = async (leadId: string): Promise<KommoLead | null> => {
  const json = await request('GET', `/api/v4/leads/${encodeURIComponent(leadId)}?with=contacts`);
  const id = json.id !== undefined ? String(json.id) : '';
  if (!id) return null;
  const contacts = asRec(json._embedded).contacts;
  const list = Array.isArray(contacts) ? contacts.map(asRec) : [];
  const main = list.find((c) => c.is_main === true) ?? list[0];
  const price = Number(json.price);
  return {
    id,
    name: asStr(json.name),
    statusId: json.status_id !== undefined ? String(json.status_id) : null,
    pipelineId: json.pipeline_id !== undefined ? String(json.pipeline_id) : null,
    price: Number.isFinite(price) ? price : null,
    mainContactId: main?.id !== undefined ? String(main.id) : null,
  };
};

export type KommoContact = { id: string; name: string; phone: string | null; email: string | null };

// Telefone/email vivem em custom_fields_values com field_code PHONE/EMAIL.
const valueByFieldCode = (fields: unknown, code: string): string | null => {
  if (!Array.isArray(fields)) return null;
  for (const field of fields.map(asRec)) {
    if (asStr(field.field_code).toUpperCase() !== code) continue;
    const values = Array.isArray(field.values) ? field.values.map(asRec) : [];
    const value = values[0]?.value;
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number') return String(value);
  }
  return null;
};

export const getKommoContact = async (contactId: string): Promise<KommoContact | null> => {
  const json = await request('GET', `/api/v4/contacts/${encodeURIComponent(contactId)}`);
  const id = json.id !== undefined ? String(json.id) : '';
  if (!id) return null;
  return {
    id,
    name: asStr(json.name),
    phone: valueByFieldCode(json.custom_fields_values, 'PHONE'),
    email: valueByFieldCode(json.custom_fields_values, 'EMAIL'),
  };
};

// Nota comum no card do lead — auditoria do que a Tawany/QARA fez, visível
// para quem opera dentro do Kommo.
export const addKommoNote = async (leadId: string, text: string): Promise<void> => {
  await request('POST', '/api/v4/leads/notes', [
    { entity_id: Number(leadId), note_type: 'common', params: { text } },
  ]);
};

// Grava o texto da resposta no custom field que o salesbot de resposta lê.
export const updateKommoLeadTextField = async (
  leadId: string,
  fieldId: string,
  value: string,
): Promise<void> => {
  await request('PATCH', `/api/v4/leads/${encodeURIComponent(leadId)}`, {
    custom_fields_values: [{ field_id: Number(fieldId), values: [{ value }] }],
  });
};

// Dispara um salesbot para um lead (entity_type 2 = lead na API v2 do
// salesbot). É o caminho suportado para uma integração externa mandar mensagem
// num chat de canal nativo do Kommo (o bot faz `show` do custom field).
export const runKommoSalesbot = async (botId: string, leadId: string): Promise<void> => {
  await request('POST', '/api/v2/salesbot/run', [
    { bot_id: Number(botId), entity_id: Number(leadId), entity_type: 2 },
  ]);
};

export type KommoLeadSummary = {
  id: string;
  name: string;
  statusId: string | null;
  pipelineId: string | null;
  updatedAt: number;
};

// Página de leads alterados desde `sinceUnix` — usada pelo job de
// reconciliação (webhooks perdidos). Ordena por updated_at asc para o cursor
// avançar de forma estável.
export const listKommoLeadsUpdatedSince = async (
  sinceUnix: number,
  page = 1,
  limit = 50,
): Promise<KommoLeadSummary[]> => {
  const path = `/api/v4/leads?filter[updated_at][from]=${Math.floor(sinceUnix)}` +
    `&order[updated_at]=asc&page=${page}&limit=${limit}`;
  const json = await request('GET', path);
  const leads = asRec(json._embedded).leads;
  if (!Array.isArray(leads)) return [];
  return leads.map(asRec).flatMap((lead) => {
    const id = lead.id !== undefined ? String(lead.id) : '';
    if (!id) return [];
    const updated = Number(lead.updated_at);
    return [{
      id,
      name: asStr(lead.name),
      statusId: lead.status_id !== undefined ? String(lead.status_id) : null,
      pipelineId: lead.pipeline_id !== undefined ? String(lead.pipeline_id) : null,
      updatedAt: Number.isFinite(updated) ? updated : 0,
    }];
  });
};
