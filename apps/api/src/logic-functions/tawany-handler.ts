import { createAiClient, modelWithFallback, type AiClient } from 'src/lib/ai-client';
import type { DataApi } from 'src/lib/data';
import { tawanyTools } from 'src/lib/tools';
import { validateReply } from 'src/lib/guards/reply-validator';
import { detectInjection } from 'src/lib/guards/prompt-injection';
import { handoff } from 'src/lib/handoff';
import { recordAiRun } from 'src/lib/ai-run-log';
import { captureExplicitPatientProfile } from 'src/lib/patient-profile';
import { truncateToContextWindow } from 'src/lib/ai/context-window';
import { buildTawanyContext, N_RECENT } from 'src/lib/tawany/context';
import { isAutopilotMode } from 'src/lib/shadow';
import { buildMessages, buildSystemPrompt } from 'src/lib/tawany/prompt-builder';
import { loadAiSettings, type AiRuntimeSettings } from 'src/lib/ai-settings';
import { classifyTawanyRisk, type TawanyRiskLevel } from 'src/lib/tawany/risk';
import { runQaraClassifier } from './qara-classifier';
import { runLeadScorer } from 'src/lib/lead-score/orchestrator';
import { runLeadsNovosFlow } from './leads-novos-flow';
import { summarizeConversation } from './summarize-conversation';

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
// Modo de envio da resposta final:
//   'send'         — envia via sendWhatsApp e marca a aiSuggestion como SENT (autopilot).
//   'suggest_only' — cria a aiSuggestion PENDING e NÃO envia; a aprovação humana
//                    envia depois via /api/tawany/approve (human_approval).
//   'test'         — cria a aiSuggestion TEST_SENT e NÃO envia (shadow / modo teste do inbox).
// testMode: true é mantido por compat e equivale a sendMode: 'test'.
// Sem sendMode explícito, o default é o comportamento seguro: só envia em autopilot.
export type TawanySendMode = 'send' | 'suggest_only' | 'test';
export type TawanyDeps = { ai: AiClient; data: DataApi; testMode?: boolean; sendMode?: TawanySendMode };
export type TawanyResult = { status: 'replied' | 'handoff'; content: string; toolCalls: number };

const resolveSendMode = (deps: { testMode?: boolean; sendMode?: TawanySendMode }): TawanySendMode => {
  if (deps.sendMode) return deps.sendMode;
  if (deps.testMode) return 'test';
  return isAutopilotMode() ? 'send' : 'suggest_only';
};

const usageLog = (res: { usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }) => ({
  promptTokens: res.usage?.promptTokens ?? 0,
  completionTokens: res.usage?.completionTokens ?? 0,
  totalTokens: res.usage?.totalTokens ?? 0,
  estimatedCostCents: 0,
});

// Segurança de produto: enquanto o Instagram Direct é um canal novo, nenhuma
// resposta da Tawany em conversa INSTAGRAM é auto-enviada — nem em autopilot,
// nem em hibrido. Força human_approval (suggest_only) para revisão humana antes
// de qualquer envio. Os demais modos ('suggest_only'/'test') já são seguros.
export const gateSendModeForChannel = (
  sendMode: TawanySendMode,
  channel: string | null | undefined,
): TawanySendMode => (channel === 'INSTAGRAM' && sendMode === 'send' ? 'suggest_only' : sendMode);

const decideRuntimeSendMode = (
  deps: { testMode?: boolean; sendMode?: TawanySendMode },
  settings: AiRuntimeSettings,
  riskLevel: TawanyRiskLevel,
  intent: string | null | undefined,
): TawanySendMode => {
  if (deps.sendMode) return deps.sendMode;
  if (deps.testMode) return 'test';
  if (settings.mode === 'autopilot') return 'send';
  if (settings.mode === 'hibrido') {
    const normalizedIntent = typeof intent === 'string' ? intent.trim().toUpperCase() : '';
    return riskLevel === 'low' && settings.autopilotIntents.includes(normalizedIntent)
      ? 'send'
      : 'suggest_only';
  }
  return 'suggest_only';
};

export const runTawany = async (
  params: TawanyHandlerParams,
  deps: TawanyDeps,
): Promise<TawanyResult> => {
  const { ai, data } = deps;
  const explicitSendMode = resolveSendMode(deps);
  let totalToolCalls = 0;

  try {
    const tawanyCtx = await buildTawanyContext(params.conversationId, data);
    const aiSettings = deps.sendMode || deps.testMode
      ? null
      : await loadAiSettings(data);
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
          ...usageLog(res),
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
          ...usageLog(res),
        });
        await handoff(params.conversationId, `guard_failed: ${guard.reason}`.slice(0, 200), data);
        return { status: 'handoff', content: '', toolCalls: totalToolCalls };
      }

      const riskLevel = classifyTawanyRisk(reply, tawanyCtx);
      const decidedSendMode = aiSettings
        ? decideRuntimeSendMode(deps, aiSettings, riskLevel, tawanyCtx.lead?.intent)
        : explicitSendMode;
      const sendMode = gateSendModeForChannel(decidedSendMode, tawanyCtx.channel);
      const suggestion = await data.create('aiSuggestion', {
        conversationId: params.conversationId,
        messageId: params.messageId,
        model: res.modelUsed,
        body: reply,
        riskLevel,
        status: 'PENDING',
        promptVersion: process.env.TAWANY_PROMPT_VERSION ?? 'v1',
      });
      // 'send' (autopilot) é o único modo que envia sem revisão humana.
      // 'suggest_only' (human_approval) deixa a sugestão PENDING — visível no
      // Inbox para aprovar/editar/descartar. 'test' (shadow/modo teste) marca
      // TEST_SENT para não poluir a fila de aprovação.
      if (sendMode === 'send') {
        await tawanyTools.execute(
          'sendWhatsApp',
          JSON.stringify({ conversationId: params.conversationId, text: reply }),
          data,
        );
        if (typeof suggestion.id === 'string') {
          await data.update('aiSuggestion', suggestion.id, { status: 'SENT' });
        }
      } else if (sendMode === 'test' && typeof suggestion.id === 'string') {
        await data.update('aiSuggestion', suggestion.id, { status: 'TEST_SENT' });
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
        ...usageLog(res),
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
  | { status: 'replied' | 'handoff'; toolCalls: number; reason?: string; content?: string };

// ponytail: extraído para ser testável sem depender do runtime HTTP.
// Espelha o handler real: skip se não-IN ou já tratado; gate de conversation;
// cria ai; roda Tawany; roda classificador. Falha do classificador é logada, não fatal.
export const runTawanyHandler = async (
  message: ChatMessageRecord,
  // markHandled=false: run de observação (shadow) não consome a mensagem —
  // um run real posterior (ex.: sugestão manual no inbox) ainda pode tratá-la.
  deps: { ai?: AiClient; data: DataApi; testMode?: boolean; sendMode?: TawanySendMode; markHandled?: boolean },
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
        handoffReason: 'opt_out_detected',
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
        handoffReason: 'prompt_injection',
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

    try {
      await captureExplicitPatientProfile(
        { conversationId: message.conversationId, text: message.body },
        deps.data,
      );
    } catch (e) {
      console.error('[tawany-handler] patient profile capture failed:', (e as Error).message);
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
      { ai, data: deps.data, testMode: deps.testMode, sendMode: deps.sendMode },
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

    // Summary: recomputa conversation.summary quando o histórico excede a janela
    // verbatim do contexto (N_RECENT). Como o classifier: falha é logada, não fatal.
    try {
      const window = await deps.data.list('chatMessage', {
        filter: { conversationId: { eq: message.conversationId } },
        limit: N_RECENT + 1,
        select: { id: true },
      });
      if (window.length > N_RECENT) {
        const summary = await summarizeConversation(
          { messageId: message.id, conversationId: message.conversationId },
          deps.data,
        );
        console.log(JSON.stringify({
          event: 'conversation_summary',
          messageId: message.id,
          conversationId: message.conversationId,
          ok: summary.ok,
        }));
      }
    } catch (e) {
      console.error('[tawany-handler] summarize failed (non-fatal):', (e as Error).message);
    }

    return { status: r.status, toolCalls: r.toolCalls, content: r.content };
  } finally {
    if (deps.markHandled !== false) {
      await deps.data.update('chatMessage', message.id, { agentHandled: true });
    }
  }
};
