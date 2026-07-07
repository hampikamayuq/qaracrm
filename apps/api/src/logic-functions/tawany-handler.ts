import { createAiClient, modelWithFallback, type AiClient } from 'src/lib/ai-client';
import type { DataApi } from 'src/lib/data';
import { tawanyTools } from 'src/lib/tools';
import { validateReply } from 'src/lib/guards/reply-validator';
import { detectInjection } from 'src/lib/guards/prompt-injection';
import { handoff } from 'src/lib/handoff';
import { recordAiRun } from 'src/lib/ai-run-log';
import { truncateToContextWindow } from 'src/lib/ai/context-window';
import { buildTawanyContext } from 'src/lib/tawany/context';
import { buildMessages, buildSystemPrompt } from 'src/lib/tawany/prompt-builder';
import { runQaraClassifier } from './qara-classifier';
import { runLeadScorer } from 'src/lib/lead-score/orchestrator';
import { runLeadsNovosFlow } from './leads-novos-flow';

const MAX_ITERATIONS = 6;
const OPT_OUT_PATTERN = /\b(sair|parar|cancelar|n[aã]o quero mais|n[aã]o enviar|remover|descadastrar)\b/iu;
const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value.replaceAll('_', ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const contextWindowOptions = () => ({
  maxMessages: parsePositiveInt(process.env.AI_MAX_CONTEXT_MESSAGES, 20),
  maxTotalChars: parsePositiveInt(process.env.AI_MAX_CONTEXT_CHARS, 10_000),
});

export type TawanyHandlerParams = { messageId: string; conversationId: string };
export type TawanyDeps = { ai: AiClient; data: DataApi; testMode?: boolean };
export type TawanyResult = { status: 'replied' | 'handoff'; content: string; toolCalls: number };

export const runTawany = async (
  params: TawanyHandlerParams,
  deps: TawanyDeps,
): Promise<TawanyResult> => {
  const { ai, data, testMode } = deps;
  let totalToolCalls = 0;

  try {
    const tawanyCtx = await buildTawanyContext(params.conversationId, data);
    const system = buildSystemPrompt(tawanyCtx);
    const messages = buildMessages(tawanyCtx);

    for (let turn = 0; turn < MAX_ITERATIONS; turn++) {
      const startedAt = Date.now();
      const contextWindow = truncateToContextWindow(messages, contextWindowOptions());
      if (contextWindow.truncated) {
        console.log(JSON.stringify({
          event: 'tawany_context_truncated',
          messageId: params.messageId,
          droppedCount: contextWindow.droppedCount,
        }));
      }
      const res = await ai.chat({
        model: modelWithFallback(
          process.env.DEFAULT_MODEL_PATIENT,
          process.env.DEFAULT_MODEL_PATIENT_FALLBACK,
          'minimax/minimax-m3',
        ),
        system,
        messages: contextWindow.messages,
        tools: tawanyTools.schema,
      });

      if (res.finishReason === 'tool_calls') {
        await recordAiRun(data, {
          layer: 'tawany',
          model: res.modelUsed,
          fallbackUsed: res.fallbackUsed,
          latencyMs: Date.now() - startedAt,
          success: true,
          reason: 'tool_calls',
          conversationId: params.conversationId,
          messageId: params.messageId,
        });
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
        await recordAiRun(data, {
          layer: 'tawany',
          model: res.modelUsed,
          fallbackUsed: res.fallbackUsed,
          latencyMs: Date.now() - startedAt,
          success: false,
          validationPass: false,
          reason: `guard_failed: ${guard.reason}`,
          conversationId: params.conversationId,
          messageId: params.messageId,
        });
        await handoff(params.conversationId, `guard_failed: ${guard.reason}`.slice(0, 200), data);
        return { status: 'handoff', content: '', toolCalls: totalToolCalls };
      }

      const suggestion = await data.create('aiSuggestion', {
        conversationId: params.conversationId,
        messageId: params.messageId,
        model: res.modelUsed,
        body: reply,
        riskLevel: 'low',
        status: 'PENDING',
        promptVersion: process.env.TAWANY_PROMPT_VERSION ?? 'v1',
      });
      if (!deps.testMode) {
        await tawanyTools.execute(
          'sendWhatsApp',
          JSON.stringify({ conversationId: params.conversationId, text: reply }),
          data,
        );
      }
      if (typeof suggestion.id === 'string') {
        await data.update('aiSuggestion', suggestion.id, { status: deps.testMode ? 'TEST_SENT' : 'SENT' });
      }
      await recordAiRun(data, {
        layer: 'tawany',
        model: res.modelUsed,
        fallbackUsed: res.fallbackUsed,
        latencyMs: Date.now() - startedAt,
        success: true,
        validationPass: true,
        reason: 'replied',
        conversationId: params.conversationId,
        messageId: params.messageId,
      });
      return { status: 'replied', content: reply, toolCalls: totalToolCalls };
    }

    await recordAiRun(data, {
      layer: 'tawany',
      success: false,
      reason: 'max_iterations',
      conversationId: params.conversationId,
      messageId: params.messageId,
    });
    await handoff(params.conversationId, 'max_iterations', data);
    return { status: 'handoff', content: '', toolCalls: totalToolCalls };
  } catch (e) {
    // Fase 4 insere o leads-novos-flow aqui como camada 2; Fase 1 vai direto ao humano.
    const originalError = (e as Error).message;
    await recordAiRun(deps.data, {
      layer: 'tawany',
      success: false,
      reason: `tawany_error: ${originalError}`,
      conversationId: params.conversationId,
      messageId: params.messageId,
    });
    try {
      const fallback = await runLeadsNovosFlow(
        { messageId: params.messageId, conversationId: params.conversationId, originalError },
        { data: deps.data },
      );
      if (fallback.status === 'replied') {
        return { status: 'replied', content: fallback.content, toolCalls: totalToolCalls };
      }
      return { status: 'handoff', content: '', toolCalls: totalToolCalls };
    } catch (fallbackError) {
      await handoff(
        params.conversationId,
        `tawany_error: ${originalError}; leads_novos_error: ${(fallbackError as Error).message}`.slice(0, 200),
        deps.data,
      );
      return { status: 'handoff', content: '', toolCalls: totalToolCalls };
    }
  }
};

type ChatMessageRecord = {
  id: string;
  conversationId: string;
  direction: 'IN' | 'OUT';
  body: string;
  agentHandled?: boolean;
};

export type TawanyHandlerRunResult =
  | { status: 'skipped'; reason: string }
  | { status: 'replied' | 'handoff'; toolCalls: number; reason?: string };

// ponytail: extraído para ser testável sem depender do runtime HTTP.
// Espelha o handler real: skip se não-IN ou já tratado; gate de conversation;
// cria ai; roda Tawany; roda classificador. Falha do classificador é logada, não fatal.
export const runTawanyHandler = async (
  message: ChatMessageRecord,
  deps: { ai?: AiClient; data: DataApi; testMode?: boolean },
): Promise<TawanyHandlerRunResult> => {
  if (message.direction !== 'IN' || message.agentHandled) {
    return { status: 'skipped', reason: 'not_inbound_or_already_handled' };
  }

  try {
    // Gate: skip if conversation is no longer OPEN. Prevents Tawany from
    // re-engaging after a handoff / resolution / archive.
    const conv = await deps.data.get('conversation', message.conversationId, {
      id: true,
      status: true,
      needsHuman: true,
      leadId: true,
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
      return { status: 'skipped', reason: 'conversation_closed' };
    }

    if (OPT_OUT_PATTERN.test(message.body)) {
      if (typeof conv.leadId === 'string' && conv.leadId.length > 0) {
        await deps.data.update('lead', conv.leadId, { optedOut: true, optedOutAt: new Date() });
      }
      await deps.data.update('conversation', message.conversationId, {
        needsHuman: true,
        status: 'PENDING_HUMAN',
      });
      console.log(JSON.stringify({
        event: 'tawany_run',
        messageId: message.id,
        status: 'handoff',
        reason: 'opt_out_detected',
      }));
      return { status: 'handoff', toolCalls: 0, reason: 'opt_out_detected' };
    }

    const injectionCheck = detectInjection(message.body);
    if (!injectionCheck.safe) {
      await deps.data.update('conversation', message.conversationId, {
        needsHuman: true,
        status: 'PENDING_HUMAN',
      });
      await recordAiRun(deps.data, {
        layer: 'tawany',
        success: false,
        reason: 'injection_blocked',
        conversationId: message.conversationId,
        messageId: message.id,
      });
      console.log(JSON.stringify({
        event: 'tawany_run',
        messageId: message.id,
        status: 'handoff',
        reason: 'prompt_injection',
      }));
      return { status: 'handoff', toolCalls: 0, reason: 'prompt_injection' };
    }

    let ai: AiClient;
    try {
      ai = deps.ai ?? createAiClient();
    } catch (e) {
      // sem OPENROUTER_API_KEY configurada: comportamento de produção é handoff, não crash
      const h = await handoff(message.conversationId, `config: ${(e as Error).message}`.slice(0, 200), deps.data);
      if (!h.ok) console.error('[tawany-handler] config handoff failed:', h.error);
      await recordAiRun(deps.data, {
        layer: 'tawany',
        success: false,
        reason: `config: ${(e as Error).message}`,
        conversationId: message.conversationId,
        messageId: message.id,
      });
      console.log(JSON.stringify({ event: 'tawany_run', messageId: message.id, status: 'handoff', reason: 'config' }));
      return { status: 'handoff', toolCalls: 0 };
    }

    const r = await runTawany(
      { messageId: message.id, conversationId: message.conversationId },
      { ai, data: deps.data, testMode: deps.testMode },
    );
    console.log(JSON.stringify({ event: 'tawany_run', messageId: message.id, status: r.status, toolCalls: r.toolCalls }));

    // Classificação estruturada: escreve tags sugeridas (LEAD_QUENTE, etc.) no lead.
    // Roda após Tawany (independente de replied/handoff). Falha do classificador
    // NUNCA quebra o run de Tawany — só logamos.
    if (
      typeof conv.leadId === 'string' && conv.leadId.length > 0 &&
      typeof message.body === 'string' && message.body.trim().length > 0
    ) {
      let classification: import('src/lib/classification/schema').ClassificationResult | null = null;
      try {
        const cls = await runQaraClassifier(
          { message: message.body, leadId: conv.leadId, conversationId: message.conversationId },
          { ai, data: deps.data },
        );
        if (cls) {
          classification = cls.result;
          await recordAiRun(deps.data, {
            layer: 'qara-classifier',
            model: process.env.DEFAULT_MODEL_INTERNAL,
            success: true,
            reason: cls.path,
            conversationId: message.conversationId,
            messageId: message.id,
          });
          console.log(JSON.stringify({
            event: 'qara_classify',
            messageId: message.id,
            leadId: conv.leadId,
            path: cls.path,
            tagsWritten: cls.tagsWritten,
            temperatura: cls.result.temperatura,
            prioridade: cls.result.prioridade,
          }));
        }
      } catch (e) {
        await recordAiRun(deps.data, {
          layer: 'qara-classifier',
          model: process.env.DEFAULT_MODEL_INTERNAL,
          success: false,
          reason: (e as Error).message,
          conversationId: message.conversationId,
          messageId: message.id,
        });
        console.error('[tawany-handler] classifier failed (non-fatal):', (e as Error).message);
      }

      // Lead scorer: re-calcula score + scoreReasons usando o classification recém-feito
      // (ou cai no caminho message+intent-only se o classificador tiver falhado).
      // Falha do scorer NUNCA quebra o run de Tawany — só logamos.
      try {
        const lead = (await deps.data.get('lead', conv.leadId, { id: true, intent: true, source: true })) as { id?: string; intent?: string | null; source?: string | null } | null;
        if (lead) {
          const messages = (await deps.data.list('chatMessage', {
            filter: { conversationId: { eq: message.conversationId } },
            orderBy: { sentAt: 'DESC' },
            limit: 10,
            select: { body: true, sentAt: true },
          })) as Array<{ body?: string | null; sentAt?: string | null }>;
          const recent = [...messages]
            .sort((a, b) => String(a.sentAt ?? '').localeCompare(String(b.sentAt ?? '')))
            .map((m) => ({ body: m.body ?? null }));
          const result = await runLeadScorer(
            { intent: lead.intent ?? null, source: lead.source ?? null },
            recent,
            classification,
            { ai },
          );
          await deps.data.update('lead', conv.leadId, { score: result.score, scoreReasons: result.reasons });
          await recordAiRun(deps.data, {
            layer: 'lead-scorer',
            model: process.env.DEFAULT_MODEL_INTERNAL,
            success: true,
            reason: result.path,
            conversationId: message.conversationId,
            messageId: message.id,
          });
          console.log(JSON.stringify({
            event: 'lead_score',
            messageId: message.id,
            leadId: conv.leadId,
            path: result.path,
            score: result.score,
            reasonCount: result.reasons.length,
          }));
        }
      } catch (e) {
        await recordAiRun(deps.data, {
          layer: 'lead-scorer',
          model: process.env.DEFAULT_MODEL_INTERNAL,
          success: false,
          reason: (e as Error).message,
          conversationId: message.conversationId,
          messageId: message.id,
        });
        console.error('[tawany-handler] scorer failed (non-fatal):', (e as Error).message);
      }
    }

    return { status: r.status, toolCalls: r.toolCalls };
  } finally {
    await deps.data.update('chatMessage', message.id, { agentHandled: true });
  }
};
