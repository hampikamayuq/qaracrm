import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataApi } from 'src/lib/data';
import { invalidateKnowledgeCache } from 'src/lib/tawany/knowledge';
import { searchKnowledge } from './searchKnowledge';

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
  ...over,
});

const withSections = (sections: Array<{ slug: string; title: string; content: string }>): DataApi =>
  api({
    list: vi.fn(async (object: string) => (object === 'knowledgeSection' ? sections : [])) as unknown as DataApi['list'],
  });

describe('searchKnowledge (fonte viva: KnowledgeSection)', () => {
  beforeEach(() => {
    invalidateKnowledgeCache();
  });

  it('acha conteúdo vindo do banco, não dos chunks hardcoded', async () => {
    // Arrange
    const ctx = withSections([
      { slug: 'promocoes', title: 'Promoções', content: 'Botox com 20% de desconto em julho para pacientes novos.' },
    ]);

    // Act
    const result = JSON.parse(await searchKnowledge.execute({ query: 'desconto botox julho' }, ctx));

    // Assert
    expect(result[0].id).toBe('promocoes-0');
    expect(result[0].title).toBe('Promoções');
    expect(result[0].content).toContain('20% de desconto');
  });

  it('divide o content da seção nos separadores "---" em chunks com título derivado', async () => {
    // Arrange
    const content = [
      '## 1. Sobre a clínica\nClínica QARA em Copacabana, referência em dermatologia.',
      '## 3. Estacionamento\nEstacionamento com autorização prévia no Golden Point.',
    ].join('\n\n---\n\n');
    const ctx = withSections([{ slug: 'clinica-unidades', title: 'Clínica e unidades', content }]);

    // Act
    const result = JSON.parse(await searchKnowledge.execute({ query: 'estacionamento autorização' }, ctx));

    // Assert — só o pedaço relevante vem no topo, com título seção + heading
    expect(result[0].id).toBe('clinica-unidades-1');
    expect(result[0].title).toBe('Clínica e unidades — 3. Estacionamento');
    expect(result[0].content).not.toContain('Sobre a clínica');
  });

  it('filtra o slug reservado __ai_settings (config JSON, não conhecimento)', async () => {
    // Arrange
    const ctx = withSections([
      { slug: '__ai_settings', title: 'settings', content: '{"mode":"hibrido","autopilotIntents":["PRECO"]}' },
      { slug: 'precos', title: 'Preços', content: 'Consulta dermatológica: R$ 450,00.' },
    ]);

    // Act
    const result = JSON.parse(await searchKnowledge.execute({ query: 'autopilotIntents hibrido' }, ctx));

    // Assert — nenhum chunk vem do __ai_settings, mesmo com match lexical perfeito
    expect(result.every((c: { id: string }) => !c.id.startsWith('__ai_settings'))).toBe(true);
  });

  it('cai nos chunks hardcoded quando a tabela está vazia', async () => {
    // Arrange
    const ctx = api();

    // Act
    const result = JSON.parse(await searchKnowledge.execute({ query: 'estacionamento copacabana' }, ctx));

    // Assert
    expect(result[0].id).toBe('endereco-copacabana');
  });

  it('cai nos chunks hardcoded quando o banco falha', async () => {
    // Arrange
    const ctx = api({ list: vi.fn().mockRejectedValue(new Error('relation "KnowledgeSection" does not exist')) });

    // Act
    const result = JSON.parse(await searchKnowledge.execute({ query: 'pix teleconsulta' }, ctx));

    // Assert
    expect(result[0].id).toBe('pagamento');
  });

  it('retorna no máximo 3 chunks mesmo sem match (formato estável pro prompt)', async () => {
    // Arrange
    const ctx = withSections([
      { slug: 'a', title: 'A', content: 'primeiro bloco\n\n---\n\nsegundo bloco\n\n---\n\nterceiro bloco\n\n---\n\nquarto bloco' },
    ]);

    // Act
    const result = JSON.parse(await searchKnowledge.execute({ query: 'xyzabc' }, ctx));

    // Assert
    expect(result).toHaveLength(3);
    for (const c of result) {
      expect(Object.keys(c).sort()).toEqual(['content', 'id', 'title']);
    }
  });
});
