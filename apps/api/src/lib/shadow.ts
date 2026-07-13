import type { AiClient } from './ai-client';
import type { DataApi } from './data';
import { runTawanyHandler, type TawanySendMode } from '../logic-functions/tawany-handler';
import { type ShadowMode } from './shadow-mode';
import { loadAiSettings, type AiOperationMode } from './ai-settings';

// Re-export para não quebrar os consumidores existentes de lib/shadow.
export { getShadowMode, isAutopilotMode, isHumanApprovalMode, isShadowMode, type ShadowMode } from './shadow-mode';

export type ProcessedShadowMessage = { conversationId: string; messageId: string };

export const recordShadowRun = async (
  data: DataApi,
  params: {
    conversationId: string;
    messageId: string;
    tawanyReply: string;
    twentyReply: string;
    tawanyToolCalls: number;
    match: boolean;
  },
): Promise<void> => {
  try {
    await data.create('activity', {
      targetType: 'conversation',
      targetId: params.conversationId,
      conversationId: params.conversationId,
      body: JSON.stringify({
        type: 'shadow_run',
        messageId: params.messageId,
        tawanyReply: params.tawanyReply.slice(0, 500),
        twentyReply: params.twentyReply.slice(0, 500),
        tawanyToolCalls: params.tawanyToolCalls,
        match: params.match,
      }),
    });
  } catch (error) {
    console.error('[shadow] failed to record:', (error as Error).message);
  }
};

// SHADOW_MODE → modo de envio da Tawany:
//   shadow         → 'test'         (observação pura: sugestão TEST_SENT, nunca envia)
//   human_approval → 'suggest_only' (sugestão PENDING; aprovação humana envia via /api/tawany/approve)
//   autopilot      → 'send'         (envia e marca SENT)
const SEND_MODE_BY_SHADOW_MODE: Record<ShadowMode, TawanySendMode> = {
  shadow: 'test',
  human_approval: 'suggest_only',
  autopilot: 'send',
};

// Modo efetivo salvo em __ai_settings (editável em /settings/ai) tem
// prioridade sobre SHADOW_MODE do ambiente — loadAiSettings já cai pro env
// quando não há linha salva, então isto é retrocompatível.
// ponytail: 'hibrido'/'recomendacoes' colapsam para human_approval aqui —
// a decisão por risco/intent de 'hibrido' (decideRuntimeSendMode) só roda
// hoje no disparo manual (/api/tawany/run), não neste dispatch em lote do
// webhook. Se isso importar pro canal WhatsApp/Instagram real, plugar o
// mesmo loadAiSettings+decideRuntimeSendMode aqui em vez de forçar sendMode.
const shadowModeFromSettingsMode = (mode: AiOperationMode): ShadowMode =>
  mode === 'shadow' || mode === 'autopilot' ? mode : 'human_approval';

// Roda a Tawany para as mensagens processadas pelo webhook, em TODOS os modos.
// Sempre via runTawanyHandler para aplicar os gates de entrada (conversa
// fechada/needsHuman, opt-out, prompt-injection) antes de qualquer chamada de IA.
export const runTawanyForProcessedMessages = async (
  messages: ProcessedShadowMessage[],
  deps: { createAi: () => AiClient; data: DataApi },
): Promise<void> => {
  if (messages.length === 0) return;
  const settings = await loadAiSettings(deps.data);
  const mode = shadowModeFromSettingsMode(settings.mode);
  const sendMode = SEND_MODE_BY_SHADOW_MODE[mode];

  let ai: AiClient | undefined;
  try {
    ai = deps.createAi();
  } catch {
    // sem OPENROUTER_API_KEY: runTawanyHandler trata a config ausente com handoff
    ai = undefined;
  }

  const processMessage = async (message: ProcessedShadowMessage): Promise<void> => {
    const chatMessage = await deps.data.get('chatMessage', message.messageId, {
      id: true,
      conversationId: true,
      direction: true,
      body: true,
      agentHandled: true,
    });
    if (!chatMessage) {
      console.error('[tawany] processed message not found:', message.messageId);
      return;
    }

    const result = await runTawanyHandler(
      chatMessage as { id: string; conversationId: string; direction: 'IN' | 'OUT'; body: string; agentHandled?: boolean },
      // shadow é observação pura: não marca agentHandled, para a mensagem
      // continuar elegível a um run real depois (ex.: sugestão manual no inbox).
      { ai, data: deps.data, sendMode, markHandled: mode !== 'shadow' },
    );

    if (mode === 'shadow' && result.status !== 'skipped') {
      await recordShadowRun(deps.data, {
        conversationId: message.conversationId,
        messageId: message.messageId,
        tawanyReply: result.content ?? '',
        twentyReply: '',
        tawanyToolCalls: result.toolCalls ?? 0,
        match: false,
      });
    }
  };

  // Conversas diferentes continuam em paralelo, mas uma mesma conversa é
  // sempre processada na ordem de entrada. Isso evita duas chamadas de IA
  // responderem ao mesmo histórico simultaneamente e enviarem fora de ordem.
  const messagesByConversation = new Map<string, ProcessedShadowMessage[]>();
  for (const message of messages) {
    const group = messagesByConversation.get(message.conversationId) ?? [];
    group.push(message);
    messagesByConversation.set(message.conversationId, group);
  }

  await Promise.all(Array.from(messagesByConversation.values(), async (group) => {
    for (const message of group) await processMessage(message);
  }));
};
