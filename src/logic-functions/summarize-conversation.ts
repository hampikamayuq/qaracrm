import { defineLogicFunction, type ObjectRecordCreateEvent } from 'twenty-sdk/define';
import type { DatabaseEventPayload } from 'twenty-sdk/logic-function';
import { createAiClient } from 'src/lib/ai-client';
import { createDataApi, type DataApi } from 'src/lib/data';

export type SummarizeParams = { messageId: string; conversationId: string };
export type SummarizeResult = { ok: true; tokens: number } | { ok: false; error: string };

const SYSTEM_PROMPT =
  'Você resume threads de conversa WhatsApp/Instagram de uma clínica dermatológica. Seja conciso (máx 200 palavras). Preserve: queixa do paciente, médico mencionado, valores discutidos, decisões tomadas, próximos passos. Ignore saudações e ruído. Responda em português.';

export const summarizeConversation = async (
  params: SummarizeParams,
  ctx: DataApi,
): Promise<SummarizeResult> => {
  try {
    const messages = await ctx.list('chatMessage', {
      filter: { conversationId: { eq: params.conversationId } },
      orderBy: { sentAt: 'DESC' },
      limit: 30,
      select: { id: true, direction: true, body: true },
    });
    const ordered = messages.reverse();
    if (ordered.length === 0) return { ok: true, tokens: 0 };

    const transcript = ordered
      .map((m) => `${(m as { direction: string }).direction === 'IN' ? 'Paciente' : 'Tawany'}: ${(m as { body: string }).body}`)
      .join('\n');

    const result = await createAiClient().chat({
      model: process.env.DEFAULT_MODEL_INTERNAL ?? 'deepseek/deepseek-chat',
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: transcript }],
    });
    if (!result.content) return { ok: true, tokens: 0 };

    await ctx.update('conversation', params.conversationId, {
      summary: result.content,
      summaryUpdatedAt: new Date().toISOString(),
    });
    return { ok: true, tokens: result.usage.totalTokens };
  } catch (e) {
    console.error(`[summarize-conversation] failed for ${params.conversationId}:`, e);
    return { ok: false, error: (e as Error).message };
  }
};

type ChatMessageRecord = { id: string; conversationId: string; direction: 'IN' | 'OUT' };

export default defineLogicFunction({
  universalIdentifier: '9b8403ff-2944-4c15-9a68-bc51e390328f',
  name: 'summarize-conversation',
  description: 'Recomputa conversation.summary após cada mensagem inbound (roda em paralelo ao tawany-handler).',
  timeoutSeconds: 60,
  databaseEventTriggerSettings: {
    eventName: 'chatMessage.created',
  },
  handler: async (event: DatabaseEventPayload<ObjectRecordCreateEvent<ChatMessageRecord>>): Promise<void> => {
    const message = event.properties.after;
    if (message.direction !== 'IN') return; // sem filtro no trigger — gate aqui
    await summarizeConversation(
      { messageId: message.id, conversationId: message.conversationId },
      createDataApi(),
    );
  },
});
