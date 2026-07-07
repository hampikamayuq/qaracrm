import type { ChatMessage } from 'src/lib/ai-client';
import type { TawanyContext } from './context';
import { MAX_FEW_SHOT_EXAMPLES } from './knowledge';
import {
  QARA_CLASSIFICATION_PROMPT as CLASSIFIER,
  QARA_KNOWLEDGE_PROMPT as KNOWLEDGE,
  TAWANY_PERSONA_PROMPT as TAWANY_PERSONA,
} from 'src/lib/prompts';

export const buildSystemPrompt = (ctx: TawanyContext): string => {
  // Knowledge vivo do banco quando existir; tabela vazia → hardcoded (zero regressão).
  const knowledge = ctx.knowledgeSections.length > 0
    ? ctx.knowledgeSections.map((s) => s.content).join('\n\n---\n\n')
    : KNOWLEDGE;
  const examples = ctx.examples.slice(0, MAX_FEW_SHOT_EXAMPLES);
  return [
    TAWANY_PERSONA,
    '## Knowledge operacional',
    knowledge,
    ...(examples.length > 0
      ? [
          '## Exemplos de boas respostas',
          examples.map((e) => `Paciente: ${e.question}\nTawany: ${e.answer}`).join('\n\n'),
        ]
      : []),
    '## Regras de classificação',
    CLASSIFIER,
    '## Lead atual',
    JSON.stringify(ctx.lead ?? { note: 'lead ainda não identificado' }),
    `## conversationId\n${ctx.conversationId}`,
    ...(ctx.summary ? ['## Resumo da conversa até aqui', ctx.summary] : []),
  ].join('\n\n');
};

export const buildMessages = (ctx: TawanyContext): ChatMessage[] =>
  ctx.recentMessages.map((m) => ({
    role: m.direction === 'IN' ? ('user' as const) : ('assistant' as const),
    content: m.body,
  }));
