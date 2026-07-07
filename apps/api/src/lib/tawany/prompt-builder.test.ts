import { describe, expect, it } from 'vitest';
import { QARA_KNOWLEDGE_PROMPT } from 'src/lib/prompts';
import type { TawanyContext } from './context';
import { buildSystemPrompt } from './prompt-builder';

const ctx = (over: Partial<TawanyContext> = {}): TawanyContext => ({
  conversationId: 'conv-1',
  lead: null,
  recentMessages: [],
  summary: null,
  knownPrices: [],
  knowledgeSections: [],
  examples: [],
  ...over,
});

describe('buildSystemPrompt', () => {
  it('sem seções no banco → usa o QARA_KNOWLEDGE_PROMPT hardcoded (zero regressão)', () => {
    const system = buildSystemPrompt(ctx());
    expect(system).toContain(QARA_KNOWLEDGE_PROMPT);
    expect(system).not.toContain('## Exemplos de boas respostas');
  });

  it('com seções do banco → usa o conteúdo delas no lugar do hardcoded', () => {
    const system = buildSystemPrompt(ctx({
      knowledgeSections: [
        { slug: 'a', title: 'A', content: '## Valores atualizados\nConsulta: R$ 500,00' },
        { slug: 'b', title: 'B', content: '## Endereço novo\nRua X, 123' },
      ],
    }));
    expect(system).toContain('Consulta: R$ 500,00');
    expect(system).toContain('Rua X, 123');
    expect(system).not.toContain(QARA_KNOWLEDGE_PROMPT);
  });

  it('injeta no máximo 10 exemplos como "## Exemplos de boas respostas"', () => {
    const examples = Array.from({ length: 12 }, (_, i) => ({
      question: `pergunta ${i}`,
      answer: `resposta ${i}`,
    }));
    const system = buildSystemPrompt(ctx({ examples }));
    expect(system).toContain('## Exemplos de boas respostas');
    expect(system).toContain('Paciente: pergunta 0\nTawany: resposta 0');
    expect(system).toContain('pergunta 9');
    expect(system).not.toContain('pergunta 10');
  });
});
