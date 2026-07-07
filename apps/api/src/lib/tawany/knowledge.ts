import type { DataApi } from 'src/lib/data';
import { QARA_KNOWLEDGE_PROMPT } from 'src/lib/prompts';

export type KnowledgeSectionRow = { slug: string; title: string; content: string };
export type TawanyExampleRow = { question: string; answer: string };
export type KnowledgeContext = { sections: KnowledgeSectionRow[]; examples: TawanyExampleRow[] };

export const MAX_FEW_SHOT_EXAMPLES = 10;

// Agrupamento lógico dos blocos "## N." do QARA_KNOWLEDGE_PROMPT em seções
// editáveis. O conteúdo do seed é derivado do prompt hardcoded (fonte única),
// não duplicado à mão.
const SECTION_GROUPS: Array<{ slug: string; title: string; parts: string[] }> = [
  { slug: 'clinica-unidades', title: 'Clínica e unidades', parts: ['1', '3'] },
  { slug: 'profissionais-direcionamento', title: 'Profissionais e direcionamento', parts: ['2', '4', '5'] },
  { slug: 'pagamento-convenios', title: 'Pagamento e convênios', parts: ['8', '9', '10'] },
  { slug: 'regras-atendimento', title: 'Regras de atendimento', parts: ['5.1', '6', '7', '12', '13', '16', '17'] },
  { slug: 'follow-up-nps', title: 'Follow-up e NPS', parts: ['11', '14'] },
  { slug: 'tags', title: 'Tags do CRM', parts: ['15'] },
];

const parseKnowledgeChunks = (): Map<string, string> => {
  const chunks = new Map<string, string>();
  for (const part of QARA_KNOWLEDGE_PROMPT.split(/\n(?=## )/)) {
    const heading = part.match(/^## (\d+(?:\.\d+)?)\./);
    if (!heading) continue;
    chunks.set(heading[1], part.replace(/\n+---\s*$/u, '').trim());
  }
  return chunks;
};

export const buildSeedSections = (): Array<KnowledgeSectionRow & { sortOrder: number }> => {
  const chunks = parseKnowledgeChunks();
  return SECTION_GROUPS.map((group, index) => ({
    slug: group.slug,
    title: group.title,
    sortOrder: index,
    content: group.parts
      .map((n) => {
        const chunk = chunks.get(n);
        if (!chunk) throw new Error(`Knowledge section §${n} not found in QARA_KNOWLEDGE_PROMPT`);
        return chunk;
      })
      .join('\n\n---\n\n'),
  }));
};

// Cache em memória com TTL de 60s para não consultar o banco a cada mensagem.
// ponytail: cache módulo-level único — a API roda com um DataApi só; escritas
// locais invalidam na hora, outras instâncias convergem no TTL.
const CACHE_TTL_MS = 60_000;
let cache: (KnowledgeContext & { at: number }) | null = null;

export const invalidateKnowledgeCache = (): void => {
  cache = null;
};

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');

export const loadKnowledgeContext = async (data: DataApi): Promise<KnowledgeContext> => {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { sections: cache.sections, examples: cache.examples };
  }
  try {
    const [sectionRows, exampleRows] = await Promise.all([
      data.list('knowledgeSection', {
        orderBy: { sortOrder: 'ASC' },
        select: { slug: true, title: true, content: true },
      }),
      data.list('tawanyExample', {
        orderBy: { createdAt: 'DESC' },
        limit: MAX_FEW_SHOT_EXAMPLES,
        select: { question: true, answer: true },
      }),
    ]);
    const sections = (sectionRows ?? [])
      .map((r) => ({ slug: asString(r.slug), title: asString(r.title), content: asString(r.content) }))
      .filter((r) => r.content.length > 0);
    const examples = (exampleRows ?? [])
      .map((r) => ({ question: asString(r.question), answer: asString(r.answer) }))
      .filter((r) => r.question.length > 0 && r.answer.length > 0);
    cache = { at: Date.now(), sections, examples };
    return { sections, examples };
  } catch (e) {
    // Tabela ausente ou banco fora: fallback total pro prompt hardcoded (zero regressão).
    console.error('[knowledge] load failed, falling back to hardcoded prompt:', (e as Error).message);
    return { sections: [], examples: [] };
  }
};
