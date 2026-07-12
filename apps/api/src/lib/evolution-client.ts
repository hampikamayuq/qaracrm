// Cliente do gateway Evolution API v2 (self-hosted) — números extras de
// WhatsApp pareados por QR code (integração WHATSAPP-BAILEYS, não-oficial).
// O número principal segue na Meta Cloud API (whatsapp-client.ts); este canal
// é atendimento humano apenas. Nunca logar corpo de mensagem (PHI).

export type EvolutionInstanceState = 'DISCONNECTED' | 'PAIRING' | 'CONNECTED';

// Eventos assinados no webhook por instância. base64:false é obrigatório:
// o express.json global aceita no máximo 1mb e mídia embutida estouraria 413.
const WEBHOOK_EVENTS = ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT'];

export const isEvolutionConfigured = (): boolean =>
  Boolean(
    process.env.EVOLUTION_BASE_URL &&
      process.env.EVOLUTION_API_KEY &&
      process.env.EVOLUTION_WEBHOOK_SECRET &&
      process.env.EVOLUTION_WEBHOOK_URL,
  );

type EvolutionEnv = { baseUrl: string; apiKey: string; webhookSecret: string; webhookUrl: string };

const env = (): EvolutionEnv => {
  const baseUrl = process.env.EVOLUTION_BASE_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
  const webhookUrl = process.env.EVOLUTION_WEBHOOK_URL;
  if (!baseUrl || !apiKey || !webhookSecret || !webhookUrl) {
    throw new Error(
      'Evolution não configurado (EVOLUTION_BASE_URL / EVOLUTION_API_KEY / EVOLUTION_WEBHOOK_SECRET / EVOLUTION_WEBHOOK_URL)',
    );
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey, webhookSecret, webhookUrl };
};

const request = async (
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const { baseUrl, apiKey } = env();
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      apikey: apiKey,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`Evolution API error: ${res.status} (${method} ${path})`);
  const json = (await res.json().catch(() => ({}))) as unknown;
  return json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
};

// Cria a instância já com o webhook apontando para o CRM. O secret vai num
// header customizado que o nosso endpoint valida (fail-closed).
export const createEvolutionInstance = async (instanceName: string): Promise<void> => {
  const { webhookSecret, webhookUrl } = env();
  await request('POST', '/instance/create', {
    instanceName,
    integration: 'WHATSAPP-BAILEYS',
    qrcode: true,
    webhook: {
      url: webhookUrl,
      base64: false,
      headers: { 'x-webhook-secret': webhookSecret },
      events: WEBHOOK_EVENTS,
    },
  });
};

// Configura o webhook numa instância JÁ EXISTENTE no Evolution (criada fora
// do CRM, ex.: pelo manager) — mesmo payload do create, apontando pro CRM
// com o secret no header. É o que torna uma instância externa "vinculável".
export const setEvolutionWebhook = async (instanceName: string): Promise<void> => {
  const { webhookSecret, webhookUrl } = env();
  await request('POST', `/webhook/set/${encodeURIComponent(instanceName)}`, {
    webhook: {
      enabled: true,
      url: webhookUrl,
      base64: false,
      headers: { 'x-webhook-secret': webhookSecret },
      events: WEBHOOK_EVENTS,
    },
  });
};

// Inicia/renova o pareamento e retorna o QR em base64 (o Evolution devolve
// `base64` já como data-uri na v2; alguns builds mandam só `code`).
export const connectEvolutionInstance = async (
  instanceName: string,
): Promise<{ qrBase64: string | null; pairingCode: string | null }> => {
  const json = await request('GET', `/instance/connect/${encodeURIComponent(instanceName)}`);
  const base64 = typeof json.base64 === 'string' ? json.base64 : null;
  const code = typeof json.pairingCode === 'string' ? json.pairingCode : null;
  return { qrBase64: base64, pairingCode: code };
};

const STATE_MAP: Record<string, EvolutionInstanceState> = {
  open: 'CONNECTED',
  connecting: 'PAIRING',
  close: 'DISCONNECTED',
};

export const mapEvolutionState = (state: unknown): EvolutionInstanceState | null =>
  typeof state === 'string' ? (STATE_MAP[state] ?? null) : null;

export const getEvolutionConnectionState = async (
  instanceName: string,
): Promise<EvolutionInstanceState | null> => {
  const json = await request('GET', `/instance/connectionState/${encodeURIComponent(instanceName)}`);
  const instance = (json.instance ?? {}) as Record<string, unknown>;
  return mapEvolutionState(instance.state);
};

export const logoutEvolutionInstance = async (instanceName: string): Promise<void> => {
  await request('DELETE', `/instance/logout/${encodeURIComponent(instanceName)}`);
};

export const deleteEvolutionInstance = async (instanceName: string): Promise<void> => {
  await request('DELETE', `/instance/delete/${encodeURIComponent(instanceName)}`);
};

// Envia texto e retorna o id externo da mensagem (key.id) para dedup com o
// echo fromMe que volta pelo webhook MESSAGES_UPSERT.
export const sendEvolutionText = async (
  instanceName: string,
  number: string,
  text: string,
): Promise<string> => {
  // delay: a Evolution simula "digitando…" e espaça o envio. Sem isso,
  // mensagens consecutivas (ex.: bot com 2+ respostas, 1s de intervalo) são
  // aceitas pelo gateway mas silenciosamente descartadas pelo WhatsApp —
  // visto em produção (4 SENT com id, só a 1ª entregue).
  const delay = Number.parseInt(process.env.EVOLUTION_SEND_DELAY_MS ?? '1200', 10);
  const json = await request('POST', `/message/sendText/${encodeURIComponent(instanceName)}`, {
    number,
    text,
    ...(Number.isFinite(delay) && delay > 0 ? { delay } : {}),
  });
  const key = (json.key ?? {}) as Record<string, unknown>;
  const id = typeof key.id === 'string' ? key.id : '';
  if (!id) throw new Error('Evolution API: resposta sem message id');
  return id;
};

// Baixa a mídia de uma mensagem recebida (webhook vem com base64:false).
// Usado só para transcrever áudio no ingest.
export const getEvolutionMediaBase64 = async (
  instanceName: string,
  messageKey: Record<string, unknown>,
): Promise<{ base64: string; mimeType: string }> => {
  const json = await request(
    'POST',
    `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
    { message: { key: messageKey }, convertToMp4: false },
  );
  const base64 = typeof json.base64 === 'string' ? json.base64 : '';
  const mimeType = typeof json.mimetype === 'string' ? json.mimetype : 'audio/ogg';
  if (!base64) throw new Error('Evolution API: mídia sem base64');
  return { base64, mimeType };
};
