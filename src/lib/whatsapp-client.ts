export type SendWhatsAppOptions = {
  messageType?: 'text' | 'buttons' | 'list' | 'template';
  buttons?: Array<{ id: string; title: string }>;
  listButtonText?: string;
  listSections?: Array<{ title: string; rows: Array<{ id: string; title: string }> }>;
  templateName?: string;
  languageCode?: string;
  parameters?: string[];
};

const DEFAULT_GRAPH_BASE_URL = 'https://graph.facebook.com/v20.0';

export const isMetaSendConfigured = (): boolean =>
  Boolean(process.env.META_ACCESS_TOKEN && process.env.META_PHONE_NUMBER_ID);

export const buildMetaPayload = (
  to: string,
  text: string,
  options?: SendWhatsAppOptions,
): Record<string, unknown> => {
  const base = { messaging_product: 'whatsapp', to };
  const type = options?.messageType ?? 'text';

  if (type === 'buttons') {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text },
        action: {
          buttons: (options?.buttons ?? []).slice(0, 3).map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.title },
          })),
        },
      },
    };
  }
  if (type === 'list') {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text },
        action: {
          button: options?.listButtonText ?? 'Opções',
          sections: options?.listSections ?? [],
        },
      },
    };
  }
  if (type === 'template') {
    return {
      ...base,
      type: 'template',
      template: {
        name: options?.templateName ?? '',
        language: { code: options?.languageCode ?? 'pt_BR' },
        components: options?.parameters?.length
          ? [
              {
                type: 'body',
                parameters: options.parameters.map((p) => ({ type: 'text', text: p })),
              },
            ]
          : [],
      },
    };
  }
  return { ...base, type: 'text', text: { body: text } };
};

// Envia via Meta Cloud API e retorna o wamid. Nunca loga o corpo (PHI).
export const sendViaMeta = async (
  to: string,
  text: string,
  options?: SendWhatsAppOptions,
): Promise<string> => {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  if (!accessToken || !phoneNumberId) {
    throw new Error('Meta send não configurado (META_ACCESS_TOKEN / META_PHONE_NUMBER_ID)');
  }
  const baseUrl = process.env.META_GRAPH_BASE_URL ?? DEFAULT_GRAPH_BASE_URL;

  const res = await fetch(`${baseUrl}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildMetaPayload(to, text, options)),
  });
  if (!res.ok) throw new Error(`Meta API error: ${res.status}`);

  const json = (await res.json()) as { messages?: Array<{ id: string }> };
  const wamid = json.messages?.[0]?.id;
  if (!wamid) throw new Error('Meta API: resposta sem message id');
  return wamid;
};
