// Download de mídia (áudio) recebida via Meta para transcrição.
//
// WhatsApp Cloud API: a mensagem traz apenas o `media id`. Baixar é um passo
// em duas etapas — primeiro um GET no id (com Bearer) que devolve uma `url`
// temporária, depois um GET nessa url (também com Bearer) que devolve o binário.
// Instagram Direct: o webhook já entrega a `url` direta do anexo (sem auth).
//
// NUNCA logamos o conteúdo binário nem a URL (dados de saúde). Só metadados
// técnicos (tamanho, mime, status HTTP) podem aparecer em erro/telemetria.

const DEFAULT_GRAPH_BASE_URL = 'https://graph.facebook.com/v20.0';
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024; // 16 MB
const DEFAULT_TIMEOUT_MS = 20_000;

export type DownloadedMedia = {
  base64: string;
  mimeType: string;
  sizeBytes: number;
};

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value.replaceAll('_', ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const maxBytes = (): number => parsePositiveInt(process.env.AUDIO_MAX_BYTES, DEFAULT_MAX_BYTES);
const timeoutMs = (): number =>
  parsePositiveInt(process.env.AUDIO_DOWNLOAD_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

const graphBaseUrl = (): string => process.env.META_GRAPH_BASE_URL ?? DEFAULT_GRAPH_BASE_URL;

// SSRF (ACHADO 4): a url do anexo do Instagram vem do webhook, controlada por
// terceiro. Antes do fetch validamos: https obrigatório + host num sufixo de
// domínio da Meta. Comparação por SUFIXO real (=== host ou termina em ".suf"),
// nunca includes(), para não aceitar "evilcdninstagram.com".
const DEFAULT_MEDIA_HOST_SUFFIXES = ['cdninstagram.com', 'fbcdn.net', 'fbsbx.com'];

// MEDIA_URL_ALLOWLIST (opcional): sufixos extras separados por vírgula, para
// acrescentar CDNs sem alterar código. Ver .env.example.
const mediaHostSuffixes = (): string[] => {
  const extra = (process.env.MEDIA_URL_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...DEFAULT_MEDIA_HOST_SUFFIXES, ...extra];
};

const hostAllowed = (host: string, suffixes: string[]): boolean =>
  suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));

// Valida e normaliza a URL de mídia direta. Lança em qualquer violação para
// abortar ANTES de qualquer requisição de rede.
const assertSafeMediaUrl = (raw: string): URL => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('media url inválida');
  }
  if (url.protocol !== 'https:') {
    throw new Error('media url deve usar https');
  }
  const host = url.hostname.toLowerCase();
  if (!hostAllowed(host, mediaHostSuffixes())) {
    throw new Error(`media host não permitido: ${host}`);
  }
  return url;
};

// O token de mídia do WhatsApp reusa a credencial da Graph API. Aceitamos o
// nome dedicado (WHATSAPP_ACCESS_TOKEN) e caímos no META_ACCESS_TOKEN já usado
// pelo whatsapp-client para não exigir uma segunda credencial em produção.
const whatsappToken = (): string | undefined =>
  process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;

const fetchWithTimeout = async (
  url: string,
  init: Record<string, unknown>,
): Promise<Response> => {
  const ms = timeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new Error(`media download timed out after ${ms}ms`);
    }
    throw new Error(`media download failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
};

// Lê o corpo binário respeitando o limite de tamanho. Aborta cedo pelo header
// content-length quando disponível; senão valida o buffer já materializado.
const readCappedBody = async (res: Response): Promise<{ base64: string; sizeBytes: number }> => {
  const max = maxBytes();
  const declared = Number.parseInt(res.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > max) {
    throw new Error(`media too large: ${declared} bytes (max ${max})`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > max) {
    throw new Error(`media too large: ${buffer.byteLength} bytes (max ${max})`);
  }
  return { base64: buffer.toString('base64'), sizeBytes: buffer.byteLength };
};

const mimeFrom = (res: Response, fallback: string): string => {
  const header = res.headers.get('content-type');
  if (header) return header.split(';')[0].trim();
  return fallback;
};

// WhatsApp: media id -> { url } -> binário. Ambos os GETs usam o mesmo Bearer.
export const downloadWhatsAppMedia = async (mediaId: string): Promise<DownloadedMedia> => {
  const token = whatsappToken();
  if (!token) {
    throw new Error('WhatsApp media download não configurado (WHATSAPP_ACCESS_TOKEN)');
  }
  const authHeaders = { Authorization: `Bearer ${token}` };

  const metaRes = await fetchWithTimeout(`${graphBaseUrl()}/${mediaId}`, { headers: authHeaders });
  if (!metaRes.ok) throw new Error(`media metadata fetch failed: ${metaRes.status}`);
  const meta = (await metaRes.json()) as {
    url?: string;
    mime_type?: string;
    file_size?: number;
  };
  if (!meta.url) throw new Error('media metadata sem url');
  if (typeof meta.file_size === 'number' && meta.file_size > maxBytes()) {
    throw new Error(`media too large: ${meta.file_size} bytes (max ${maxBytes()})`);
  }

  const binRes = await fetchWithTimeout(meta.url, { headers: authHeaders });
  if (!binRes.ok) throw new Error(`media binary fetch failed: ${binRes.status}`);
  const { base64, sizeBytes } = await readCappedBody(binRes);
  return { base64, sizeBytes, mimeType: mimeFrom(binRes, meta.mime_type ?? 'audio/ogg') };
};

// Instagram: a url do anexo é pública/assinada e não leva Bearer. Validada
// contra a allowlist da Meta (SSRF) e sem seguir redirects — um 3xx aponta
// para fora da CDN validada e é tratado como erro.
export const downloadDirectMedia = async (url: string): Promise<DownloadedMedia> => {
  if (!url) throw new Error('media url ausente');
  const safeUrl = assertSafeMediaUrl(url);
  const res = await fetchWithTimeout(safeUrl.toString(), { redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`media redirect bloqueado: ${res.status}`);
  }
  if (!res.ok) throw new Error(`media binary fetch failed: ${res.status}`);
  const { base64, sizeBytes } = await readCappedBody(res);
  return { base64, sizeBytes, mimeType: mimeFrom(res, 'audio/mp4') };
};
