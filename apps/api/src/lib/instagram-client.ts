const DEFAULT_GRAPH_BASE_URL = 'https://graph.facebook.com/v20.0';

export const isInstagramSendConfigured = (): boolean =>
  Boolean(process.env.INSTAGRAM_PAGE_ACCESS_TOKEN);

// Envia DM pelo Instagram Direct via Graph API e retorna o message id.
// O recipientId é o PSID/IGSID externo do lead (sender.id do webhook).
// Nunca loga o corpo da mensagem (dados de saúde).
export const sendViaInstagram = async (recipientId: string, text: string): Promise<string> => {
  const token = process.env.INSTAGRAM_PAGE_ACCESS_TOKEN;
  if (!token) {
    throw new Error('Instagram send não configurado (INSTAGRAM_PAGE_ACCESS_TOKEN)');
  }
  const sendId = process.env.INSTAGRAM_SEND_ID || 'me';
  const baseUrl = process.env.META_GRAPH_BASE_URL ?? DEFAULT_GRAPH_BASE_URL;

  const res = await fetch(`${baseUrl}/${sendId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
      messaging_type: 'RESPONSE',
    }),
  });
  if (!res.ok) throw new Error(`Instagram API error: ${res.status}`);

  const json = (await res.json()) as { message_id?: string; recipient_id?: string };
  const messageId = json.message_id;
  if (!messageId) throw new Error('Instagram API: resposta sem message id');
  return messageId;
};
