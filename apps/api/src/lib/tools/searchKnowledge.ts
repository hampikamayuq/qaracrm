import { z } from 'zod';
import type { DataApi } from 'src/lib/data';
import { AI_SETTINGS_SLUG } from 'src/lib/ai-settings';
import { loadKnowledgeContext, type KnowledgeSectionRow } from 'src/lib/tawany/knowledge';

type Chunk = { id: string; title: string; content: string };

// Fallback quando a tabela KnowledgeSection está vazia ou o banco falha —
// mesmo espírito do loadKnowledgeContext (zero regressão).
const FALLBACK_CHUNKS: Chunk[] = [
  { id: 'horarios', title: 'Horários', content: 'Presencial: segunda a sexta 08h-21h; sábado 08h-13h. Tawany responde 24h no WhatsApp.' },
  { id: 'endereco-copacabana', title: 'Endereço Copacabana', content: 'Rua Santa Clara, 50, sala 521, Edifício Golden Point, Copacabana - RJ. Metrô: Siqueira Campos. Estacionamento com autorização prévia (informar placa e modelo; exceto moto).' },
  { id: 'endereco-barra', title: 'Endereço Barra', content: 'Av. das Américas, 2480, Bloco 2, sala 312, Lead Américas Business. Estacionamento rotativo.' },
  { id: 'endereco-sp', title: 'Endereço São Paulo', content: 'Rua Joaquim Floriano, 820, 10º e 19º andar, Itaim Bibi - SP. Agendamento SP pode exigir sinal de 30%.' },
  { id: 'convenio', title: 'Convênios', content: 'Atendimento particular. Emitimos nota fiscal para reembolso no convênio.' },
  { id: 'pagamento', title: 'Pagamento', content: 'Presencial: paga na clínica. Teleconsulta: PIX ou cartão, link só após escolher horário, confirmação só após pagamento. SP: sinal 30%.' },
  { id: 'remarcacao', title: 'Remarcação', content: 'Nunca perguntar motivo. Oferecer novos horários: "Sem problema. Tem algum dia ou período que fique melhor?"' },
  { id: 'orcamento-foto', title: 'Orçamento por foto', content: 'Valor de cirurgia depende de avaliação. Foto pode ser encaminhada ao médico, nunca analisada pela Tawany. Estimativa só quando autorizada pela equipe.' },
];

// Cada seção agrupa blocos "## N." separados por '---' (ver buildSeedSections).
// Um chunk por bloco mantém a granularidade de busca do array antigo.
const sectionChunks = (sections: KnowledgeSectionRow[]): Chunk[] =>
  sections
    .filter((s) => s.slug !== AI_SETTINGS_SLUG) // JSON de config salvo na mesma tabela, não é conhecimento
    .flatMap((s) =>
      s.content.split('\n\n---\n\n').map((piece, i) => {
        const heading = piece.match(/^##\s+(.+)$/mu)?.[1]?.trim();
        return {
          id: `${s.slug}-${i}`,
          title: heading ? `${s.title} — ${heading}` : s.title,
          content: piece.trim(),
        };
      }),
    )
    .filter((c) => c.content.length > 0);

const STOP_WORDS = new Set(['a', 'o', 'de', 'da', 'do', 'e', 'em', 'para', 'com', 'um', 'uma', 'os', 'as', 'dos', 'das', 'no', 'na', 'ao']);

const tokenize = (s: string): string[] =>
  s.toLowerCase().split(/\W+/).filter((t) => t.length > 2 && !STOP_WORDS.has(t));

const score = (query: string, text: string): number => {
  const queryTokens = new Set(tokenize(query));
  const textTokens = new Set(tokenize(text));
  let hits = 0;
  for (const qt of queryTokens) if (textTokens.has(qt)) hits++;
  return hits / Math.max(queryTokens.size, 1);
};

// ponytail: scoring lexical por overlap de tokens, com peso extra pro título.
// Embeddings/pgvector só entram se a base crescer a ponto do lexical falhar.
export const searchKnowledge = {
  name: 'searchKnowledge',
  description: 'Busca na knowledge base operacional. Retorna top-3 chunks por relevância.',
  parameters: z.object({
    query: z.string().min(1).describe('Pergunta ou termo de busca'),
  }),
  execute: async (args: { query: string }, ctx: DataApi): Promise<string> => {
    // Mesma fonte viva do system prompt (KnowledgeSection editável na UI),
    // com o mesmo cache de 60s e fallback do loadKnowledgeContext.
    const { sections } = await loadKnowledgeContext(ctx);
    const live = sectionChunks(sections);
    const chunks = live.length > 0 ? live : FALLBACK_CHUNKS;
    const ranked = chunks
      .map((c) => ({ c, s: score(args.query, `${c.title} ${c.content}`) + 0.5 * score(args.query, c.title) }))
      .sort((a, b) => b.s - a.s);
    const top = ranked.filter((r) => r.s > 0).slice(0, 3).map((r) => r.c);
    return JSON.stringify(top.length > 0 ? top : ranked.slice(0, 3).map((r) => r.c));
  },
};
