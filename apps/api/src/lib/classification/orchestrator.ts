// QARA classifier orchestrator. Pure function over the AI client.
// On LLM error or schema violation, returns a safe default + path: 'fallback'
// so callers can still apply tag assignments without crashing.
//
// ponytail: the fallback shape mirrors what a P3/WARM/dermatologia-clinica
// assistant would have returned — i.e., the most conservative option that
// doesn't actively mislead the consumer (no P1, no HOT, low confidence).

import { QARA_CLASSIFICATION_PROMPT } from 'src/lib/prompts';
import { modelWithFallback, type AiClient } from 'src/lib/ai-client';
import { ClassificationResult } from './schema';

export type ClassifyPath = 'llm' | 'fallback';

export type ClassifyInput = {
  message: string;
  leadId: string;
  conversationId?: string;
  recentMessages?: ReadonlyArray<{ direction: 'IN' | 'OUT'; body: string }>;
  model?: string;
};

export type ClassifyDeps = { ai: AiClient };

export type ClassifyResult = {
  result: ClassificationResult;
  path: ClassifyPath;
};

const FALLBACK: ClassificationResult = ClassificationResult.parse({
  intencao_principal: 'outro',
  temperatura: 'WARM',
  prioridade: 'P3',
  pipeline_funil: 'dermatologia-clinica',
  medico_indicado: null,
  unidade: null,
  confianca: 0,
  tags_sugeridas: [],
  proxima_acao: 'classificador em fallback; revisar manualmente',
  razoes: ['fallback: classificador não produziu JSON válido'],
});

const safeFallback = (): { result: ClassificationResult; path: ClassifyPath } => ({
  result: FALLBACK,
  path: 'fallback',
});

export const classifyMessage = async (
  input: ClassifyInput,
  deps: ClassifyDeps,
): Promise<ClassifyResult> => {
  const { ai } = deps;
  const model = input.model ?? modelWithFallback(
    process.env.DEFAULT_MODEL_INTERNAL,
    process.env.DEFAULT_MODEL_INTERNAL_FALLBACK,
    'minimax/minimax-m3',
  );

  // ponytail: keep the user-message minimal — the LLM only needs the
  // incoming patient message + the last few turns for context. We don't
  // dump the full conversation (token bloat, plus the LLM is a stateless
  // classifier, not the agent).
  const contextLines = (input.recentMessages ?? [])
    .map((m) => `${m.direction}: ${m.body}`)
    .join('\n');
  const userPrompt = contextLines
    ? `Últimas mensagens:\n${contextLines}\n\nMensagem mais recente do paciente:\n${input.message}`
    : input.message;

  let res;
  try {
    res = await ai.chat({
      model,
      system: QARA_CLASSIFICATION_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      responseFormat: { type: 'json_object' },
    });
  } catch {
    return safeFallback();
  }

  const raw = res.content;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return safeFallback();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return safeFallback();
  }

  const validated = ClassificationResult.safeParse(parsed);
  if (!validated.success) {
    return safeFallback();
  }
  return { result: validated.data, path: 'llm' };
};
