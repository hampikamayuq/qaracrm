// Gestão de templates HSM via WhatsApp Business Management API.
// A Meta é a fonte da verdade (status APPROVED/PENDING/REJECTED muda lá) —
// sem tabela local, sem sync: listamos direto da Graph API.
// Requer META_WABA_ID (WhatsApp Business Account) além do META_ACCESS_TOKEN
// com a permissão whatsapp_business_management.

const DEFAULT_GRAPH_BASE_URL = 'https://graph.facebook.com/v20.0';

export type MetaTemplateStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | string;
export type MetaTemplateCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';

// Botões do template: resposta rápida (QUICK_REPLY, só texto) ou link (URL).
export type TemplateButton =
  | { type: 'QUICK_REPLY'; text: string }
  | { type: 'URL'; text: string; url: string };

export type MetaTemplate = {
  id: string;
  name: string;
  status: MetaTemplateStatus;
  category: string;
  language: string;
  // Componentes extraídos para exibição (header texto, body, footer, botões).
  header: string | null;
  body: string;
  footer: string | null;
  buttons: TemplateButton[];
  rejectedReason: string | null;
};

export type CreateTemplateInput = {
  name: string;
  category: MetaTemplateCategory;
  language: string;
  body: string;
  header?: string;
  footer?: string;
  buttons?: TemplateButton[];
  // Valores de exemplo para {{1}}..{{n}} — a Meta exige quando há placeholder.
  examples?: string[];
};

export const isMetaTemplatesConfigured = (): boolean =>
  Boolean(process.env.META_ACCESS_TOKEN && process.env.META_WABA_ID);

const graphBase = (): string => process.env.META_GRAPH_BASE_URL ?? DEFAULT_GRAPH_BASE_URL;

const graphFetch = async (path: string, init?: RequestInit): Promise<Response> => {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const wabaId = process.env.META_WABA_ID;
  if (!accessToken || !wabaId) {
    throw new Error('Templates não configurados (META_ACCESS_TOKEN / META_WABA_ID)');
  }
  return fetch(`${graphBase()}/${wabaId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
};

const graphError = async (res: Response): Promise<Error> => {
  let detail = `${res.status}`;
  try {
    const json = (await res.json()) as { error?: { message?: string; error_user_msg?: string } };
    detail = json.error?.error_user_msg ?? json.error?.message ?? detail;
  } catch {
    // corpo não-JSON: fica o status
  }
  return new Error(`Meta Templates API: ${detail}`);
};

type GraphButton = { type?: string; text?: string; url?: string };
type GraphComponent = { type?: string; format?: string; text?: string; buttons?: GraphButton[] };
type GraphTemplate = {
  id?: string;
  name?: string;
  status?: string;
  category?: string;
  language?: string;
  components?: GraphComponent[];
  rejected_reason?: string;
};

const parseButtons = (raw: GraphButton[] | undefined): TemplateButton[] =>
  (raw ?? []).flatMap((b): TemplateButton[] => {
    if (b.type === 'URL' && b.url) return [{ type: 'URL', text: String(b.text ?? ''), url: b.url }];
    if (b.type === 'QUICK_REPLY') return [{ type: 'QUICK_REPLY', text: String(b.text ?? '') }];
    return [];
  });

export const listMetaTemplates = async (): Promise<MetaTemplate[]> => {
  const res = await graphFetch(
    '/message_templates?fields=id,name,status,category,language,components,rejected_reason&limit=100',
  );
  if (!res.ok) throw await graphError(res);
  const json = (await res.json()) as { data?: GraphTemplate[] };
  return (json.data ?? []).map((t) => {
    const components = t.components ?? [];
    const headerComp = components.find((c) => c.type === 'HEADER' && c.format === 'TEXT');
    const buttonsComp = components.find((c) => c.type === 'BUTTONS');
    return {
      id: String(t.id ?? ''),
      name: String(t.name ?? ''),
      status: String(t.status ?? 'PENDING'),
      category: String(t.category ?? ''),
      language: String(t.language ?? ''),
      header: headerComp?.text ?? null,
      body: components.find((c) => c.type === 'BODY')?.text ?? '',
      footer: components.find((c) => c.type === 'FOOTER')?.text ?? null,
      buttons: parseButtons(buttonsComp?.buttons),
      rejectedReason: t.rejected_reason ?? null,
    };
  });
};

// Quantos placeholders {{n}} o corpo usa (maior índice encontrado).
export const countPlaceholders = (body: string): number => {
  let max = 0;
  for (const match of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    max = Math.max(max, Number(match[1]));
  }
  return max;
};

export const createMetaTemplate = async (input: CreateTemplateInput): Promise<{ id: string; status: string }> => {
  const placeholders = countPlaceholders(input.body);
  const components: Array<Record<string, unknown>> = [];
  if (input.header?.trim()) {
    components.push({ type: 'HEADER', format: 'TEXT', text: input.header.trim() });
  }
  components.push({
    type: 'BODY',
    text: input.body,
    ...(placeholders > 0
      ? { example: { body_text: [(input.examples ?? []).slice(0, placeholders)] } }
      : {}),
  });
  if (input.footer?.trim()) {
    components.push({ type: 'FOOTER', text: input.footer.trim() });
  }
  if (input.buttons && input.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: input.buttons.map((b) =>
        b.type === 'URL'
          ? { type: 'URL', text: b.text, url: b.url }
          : { type: 'QUICK_REPLY', text: b.text }),
    });
  }
  const res = await graphFetch('/message_templates', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      category: input.category,
      language: input.language,
      components,
    }),
  });
  if (!res.ok) throw await graphError(res);
  const json = (await res.json()) as { id?: string; status?: string };
  return { id: String(json.id ?? ''), status: String(json.status ?? 'PENDING') };
};

export const deleteMetaTemplate = async (name: string): Promise<void> => {
  const res = await graphFetch(`/message_templates?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
  if (!res.ok) throw await graphError(res);
};
