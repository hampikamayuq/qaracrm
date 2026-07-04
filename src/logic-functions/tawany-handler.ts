import { defineLogicFunction, type ObjectRecordCreateEvent } from 'twenty-sdk/define';
import type { DatabaseEventPayload } from 'twenty-sdk/logic-function';
import { createAiClient, type AiClient } from 'src/lib/ai-client';
import { createDataApi, type DataApi } from 'src/lib/data';
import { tawanyTools } from 'src/lib/tools';
import { validateReply } from 'src/lib/guards/reply-validator';
import { handoff } from 'src/lib/handoff';
import { buildTawanyContext } from 'src/lib/tawany/context';
import { buildMessages, buildSystemPrompt } from 'src/lib/tawany/prompt-builder';

const MAX_ITERATIONS = 6;

export type TawanyHandlerParams = { messageId: string; conversationId: string };
export type TawanyDeps = { ai: AiClient; data: DataApi };
export type TawanyResult = { status: 'replied' | 'handoff'; content: string; toolCalls: number };

export const runTawany = async (
  params: TawanyHandlerParams,
  deps: TawanyDeps,
): Promise<TawanyResult> => {
  const { ai, data } = deps;
  let totalToolCalls = 0;

  try {
    const tawanyCtx = await buildTawanyContext(params.conversationId, data);
    const system = buildSystemPrompt(tawanyCtx);
    const messages = buildMessages(tawanyCtx);

    for (let turn = 0; turn < MAX_ITERATIONS; turn++) {
      const res = await ai.chat({
        model: process.env.DEFAULT_MODEL_PATIENT ?? 'minimax/minimax-m3',
        system,
        messages,
        tools: tawanyTools.schema,
      });

      if (res.finishReason === 'tool_calls') {
        messages.push({ role: 'assistant', content: res.content, tool_calls: res.toolCalls });
        for (const call of res.toolCalls) {
          if (call.name === 'handoffToHuman') {
            await tawanyTools.execute(call.name, call.arguments, data);
            return { status: 'handoff', content: '', toolCalls: totalToolCalls };
          }
          let result: string;
          try {
            result = await tawanyTools.execute(call.name, call.arguments, data);
          } catch (e) {
            await handoff(params.conversationId, `tool_error: ${call.name}: ${(e as Error).message}`.slice(0, 200), data);
            return { status: 'handoff', content: '', toolCalls: totalToolCalls };
          }
          messages.push({ role: 'tool', tool_call_id: call.id, content: result });
          totalToolCalls++;
        }
        continue;
      }

      const reply = res.content ?? '';
      const guard = validateReply(reply, { knownPrices: tawanyCtx.knownPrices });
      if (!guard.ok) {
        await handoff(params.conversationId, `guard_failed: ${guard.reason}`.slice(0, 200), data);
        return { status: 'handoff', content: '', toolCalls: totalToolCalls };
      }

      await tawanyTools.execute(
        'sendWhatsApp',
        JSON.stringify({ conversationId: params.conversationId, text: reply }),
        data,
      );
      return { status: 'replied', content: reply, toolCalls: totalToolCalls };
    }

    await handoff(params.conversationId, 'max_iterations', data);
    return { status: 'handoff', content: '', toolCalls: totalToolCalls };
  } catch (e) {
    // Fase 4 insere o leads-novos-flow aqui como camada 2; Fase 1 vai direto ao humano.
    await handoff(params.conversationId, `tawany_error: ${(e as Error).message}`.slice(0, 200), deps.data);
    return { status: 'handoff', content: '', toolCalls: totalToolCalls };
  }
};

type ChatMessageRecord = {
  id: string;
  conversationId: string;
  direction: 'IN' | 'OUT';
  agentHandled?: boolean;
};

export default defineLogicFunction({
  universalIdentifier: 'cee5b550-44cd-428e-ae99-2a8804586ea9',
  name: 'tawany-handler',
  description: 'Roda a Tawany (OpenRouter + tools + guardrails) a cada mensagem inbound; handoff em qualquer falha.',
  timeoutSeconds: 120,
  databaseEventTriggerSettings: {
    eventName: 'chatMessage.created',
  },
  handler: async (event: DatabaseEventPayload<ObjectRecordCreateEvent<ChatMessageRecord>>): Promise<void> => {
    const message = event.properties.after;
    if (message.direction !== 'IN' || message.agentHandled) return; // sem filtro no trigger — gate aqui

    const data = createDataApi();
    try {
      // Gate: skip if conversation is no longer OPEN. Prevents Tawany from
      // re-engaging after a handoff / resolution / archive.
      const conv = await data.get('conversation', message.conversationId, {
        id: true,
        status: true,
        needsHuman: true,
      });
      if (!conv || conv.needsHuman === true || (typeof conv.status === 'string' && conv.status !== 'OPEN')) {
        console.log(JSON.stringify({
          event: 'tawany_run',
          messageId: message.id,
          status: 'skipped',
          reason: 'conversation_closed',
          convStatus: conv?.status,
          convNeedsHuman: conv?.needsHuman,
        }));
        return;
      }

      let ai;
      try {
        ai = createAiClient();
      } catch (e) {
        // sem OPENROUTER_API_KEY configurada: comportamento de produção é handoff, não crash
        const h = await handoff(message.conversationId, `config: ${(e as Error).message}`.slice(0, 200), data);
        if (!h.ok) console.error('[tawany-handler] config handoff failed:', h.error);
        console.log(JSON.stringify({ event: 'tawany_run', messageId: message.id, status: 'handoff', reason: 'config' }));
        return;
      }
      const r = await runTawany(
        { messageId: message.id, conversationId: message.conversationId },
        { ai, data },
      );
      console.log(JSON.stringify({ event: 'tawany_run', messageId: message.id, status: r.status, toolCalls: r.toolCalls }));
    } finally {
      await data.update('chatMessage', message.id, { agentHandled: true });
    }
  },
});
