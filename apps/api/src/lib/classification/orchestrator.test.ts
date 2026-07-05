import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { AiClient, ChatResult } from 'src/lib/ai-client';
import { classifyMessage } from './orchestrator';
import { QARA_CLASSIFICATION_PROMPT } from 'src/lib/prompts';

const UUID = '00000000-0000-4000-8000-000000000000';

const chatResult = (over: Partial<ChatResult>): ChatResult => ({
  content: null,
  finishReason: 'stop',
  toolCalls: [],
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  ...over,
});

const makeAi = (...results: ChatResult[]): AiClient => {
  const chat = vi.fn();
  for (const r of results) chat.mockResolvedValueOnce(r);
  return { chat } as unknown as AiClient;
};

const validJson = JSON.stringify({
  intencao_principal: 'agendar',
  temperatura: 'HOT',
  prioridade: 'P1',
  pipeline_funil: 'dermatologia-clinica',
  medico_indicado: 'Dr. Diego Galvez',
  unidade: 'Copacabana',
  confianca: 0.92,
  tags_sugeridas: ['LEAD_QUENTE', 'AGENDAR', 'HUMANO'],
  proxima_acao: 'enviar horários disponíveis Dr. Diego em Copacabana',
  razoes: ['paciente quer marcar', 'queixa genérica de pele'],
});

describe('classifyMessage', () => {
  beforeEach(() => {
    delete process.env.DEFAULT_MODEL_INTERNAL;
    delete process.env.DEFAULT_MODEL_INTERNAL_FALLBACK;
  });

  it('returns the LLM result (path: llm) when JSON parses and Zod validates', async () => {
    const ai = makeAi(chatResult({ content: validJson }));
    const r = await classifyMessage({ message: 'Quero agendar uma consulta', leadId: UUID }, { ai });
    expect(r.path).toBe('llm');
    expect(r.result.temperatura).toBe('HOT');
    expect(r.result.prioridade).toBe('P1');
    expect(r.result.pipeline_funil).toBe('dermatologia-clinica');
  });

  it('uses responseFormat json_object and the QARA classifier prompt as system', async () => {
    const ai = makeAi(chatResult({ content: validJson }));
    await classifyMessage({ message: 'oi', leadId: UUID }, { ai });
    const call = (ai.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.system).toBe(QARA_CLASSIFICATION_PROMPT);
    expect(call.responseFormat).toEqual({ type: 'json_object' });
  });

  it('passes the internal model fallback list to the ai client', async () => {
    process.env.DEFAULT_MODEL_INTERNAL = 'deepseek/deepseek-chat';
    process.env.DEFAULT_MODEL_INTERNAL_FALLBACK = 'z-ai/glm-5.2';
    const ai = makeAi(chatResult({ content: validJson }));
    await classifyMessage({ message: 'oi', leadId: UUID }, { ai });
    const call = (ai.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.model).toEqual(['deepseek/deepseek-chat', 'z-ai/glm-5.2']);
  });

  it('falls back to safe defaults when LLM returns malformed JSON', async () => {
    const ai = makeAi(chatResult({ content: 'not json at all' }));
    const r = await classifyMessage({ message: 'oi', leadId: UUID }, { ai });
    expect(r.path).toBe('fallback');
    expect(r.result.temperatura).toBe('WARM');
    expect(r.result.prioridade).toBe('P3');
    expect(r.result.pipeline_funil).toBe('dermatologia-clinica');
    expect(r.result.confianca).toBe(0);
  });

  it('falls back when JSON is valid but violates the Zod schema', async () => {
    const ai = makeAi(
      chatResult({
        content: JSON.stringify({ ...JSON.parse(validJson), prioridade: 'P9', confianca: 1.5 }),
      }),
    );
    const r = await classifyMessage({ message: 'oi', leadId: UUID }, { ai });
    expect(r.path).toBe('fallback');
    expect(r.result.prioridade).toBe('P3');
  });

  it('falls back when the LLM call throws', async () => {
    const ai = { chat: vi.fn().mockRejectedValue(new Error('OpenRouter 500')) } as unknown as AiClient;
    const r = await classifyMessage({ message: 'oi', leadId: UUID }, { ai });
    expect(r.path).toBe('fallback');
    expect(r.result.confianca).toBe(0);
  });

  it('falls back when the LLM returns null content', async () => {
    const ai = makeAi(chatResult({ content: null }));
    const r = await classifyMessage({ message: 'oi', leadId: UUID }, { ai });
    expect(r.path).toBe('fallback');
  });
});
