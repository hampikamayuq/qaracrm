import type { ChatMessage } from 'src/lib/ai-client';
import type { TawanyContext } from './context';
import {
  QARA_CLASSIFICATION_PROMPT as CLASSIFIER,
  QARA_KNOWLEDGE_PROMPT as KNOWLEDGE,
  TAWANY_PERSONA_PROMPT as TAWANY_PERSONA,
} from 'src/lib/prompts';

export const buildSystemPrompt = (ctx: TawanyContext): string =>
  [
    TAWANY_PERSONA,
    '## Knowledge operacional',
    KNOWLEDGE,
    '## Regras de classificação',
    CLASSIFIER,
    '## Lead atual',
    JSON.stringify(ctx.lead ?? { note: 'lead ainda não identificado' }),
    `## conversationId\n${ctx.conversationId}`,
    ...(ctx.summary ? ['## Resumo da conversa até aqui', ctx.summary] : []),
  ].join('\n\n');

export const buildMessages = (ctx: TawanyContext): ChatMessage[] =>
  ctx.recentMessages.map((m) => ({
    role: m.direction === 'IN' ? ('user' as const) : ('assistant' as const),
    content: m.body,
  }));
