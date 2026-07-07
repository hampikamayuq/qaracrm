import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataApi } from 'src/lib/data';
import { QARA_KNOWLEDGE_PROMPT } from 'src/lib/prompts';
import { buildSeedSections, invalidateKnowledgeCache, loadKnowledgeContext } from './knowledge';

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
  ...over,
});

describe('buildSeedSections', () => {
  it('divide o QARA_KNOWLEDGE_PROMPT em 6 seções nomeadas, em ordem', () => {
    const sections = buildSeedSections();
    expect(sections.map((s) => s.slug)).toEqual([
      'clinica-unidades',
      'profissionais-direcionamento',
      'pagamento-convenios',
      'regras-atendimento',
      'follow-up-nps',
      'tags',
    ]);
    expect(sections.map((s) => s.sortOrder)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const s of sections) expect(s.content.length).toBeGreaterThan(50);
  });

  it('coloca o conteúdo certo em cada seção (derivado do prompt, não duplicado)', () => {
    const bySlug = new Map(buildSeedSections().map((s) => [s.slug, s.content]));
    expect(bySlug.get('clinica-unidades')).toContain('Rua Santa Clara');
    expect(bySlug.get('profissionais-direcionamento')).toContain('Dr. Diego Galvez');
    expect(bySlug.get('profissionais-direcionamento')).toContain('R$ 650,00');
    expect(bySlug.get('pagamento-convenios')).toContain('PIX');
    expect(bySlug.get('regras-atendimento')).toContain('Nunca inventar horários');
    expect(bySlug.get('follow-up-nps')).toContain('nps:9-10');
    expect(bySlug.get('tags')).toContain('origem:instagram');
    // Todo bloco "## N." do prompt original aparece em alguma seção
    const all = [...bySlug.values()].join('\n');
    for (const heading of QARA_KNOWLEDGE_PROMPT.match(/^## \d[^\n]*/gmu) ?? []) {
      expect(all).toContain(heading);
    }
  });
});

describe('loadKnowledgeContext', () => {
  beforeEach(() => {
    invalidateKnowledgeCache();
  });

  it('carrega seções e exemplos do banco e filtra linhas vazias', async () => {
    const list = vi.fn(async (object: string) =>
      object === 'knowledgeSection'
        ? [
            { slug: 'a', title: 'A', content: 'conteúdo A' },
            { slug: 'vazia', title: 'Vazia', content: '' },
          ]
        : [{ question: 'Qual o valor?', answer: 'R$ 450,00.' }, { question: '', answer: 'sem pergunta' }],
    );
    const ctx = await loadKnowledgeContext(api({ list: list as unknown as DataApi['list'] }));
    expect(ctx.sections).toEqual([{ slug: 'a', title: 'A', content: 'conteúdo A' }]);
    expect(ctx.examples).toEqual([{ question: 'Qual o valor?', answer: 'R$ 450,00.' }]);
  });

  it('usa o cache de 60s na segunda chamada (não consulta o banco de novo)', async () => {
    const list = vi.fn().mockResolvedValue([]);
    const data = api({ list });
    await loadKnowledgeContext(data);
    await loadKnowledgeContext(data);
    expect(list).toHaveBeenCalledTimes(2); // sections + examples, uma vez só
  });

  it('recarrega após invalidateKnowledgeCache()', async () => {
    const list = vi.fn().mockResolvedValue([]);
    const data = api({ list });
    await loadKnowledgeContext(data);
    invalidateKnowledgeCache();
    await loadKnowledgeContext(data);
    expect(list).toHaveBeenCalledTimes(4);
  });

  it('falha de banco → fallback silencioso para vazio (prompt hardcoded)', async () => {
    const list = vi.fn().mockRejectedValue(new Error('relation "KnowledgeSection" does not exist'));
    const ctx = await loadKnowledgeContext(api({ list }));
    expect(ctx).toEqual({ sections: [], examples: [] });
  });
});
