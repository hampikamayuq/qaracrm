import { createAiClient, modelWithFallback } from 'src/lib/ai-client';
import type { DataApi } from 'src/lib/data';

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
      model: modelWithFallback(
        process.env.DEFAULT_MODEL_INTERNAL,
        process.env.DEFAULT_MODEL_INTERNAL_FALLBACK,
        'deepseek/deepseek-chat',
      ),
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

// ponytail: o wrapper defineLogicFunction (trigger Twenty) foi removido — este
// runtime é Express e o gatilho agora é o tawany-handler pós-processamento.
