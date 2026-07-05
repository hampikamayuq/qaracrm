import { z } from 'zod';

const KNOWLEDGE_CHUNKS = [
  { id: 'horarios', title: 'Horários', content: 'Presencial: segunda a sexta 08h-21h; sábado 08h-13h. Tawany responde 24h no WhatsApp.' },
  { id: 'endereco-copacabana', title: 'Endereço Copacabana', content: 'Rua Santa Clara, 50, sala 521, Edifício Golden Point, Copacabana - RJ. Metrô: Siqueira Campos. Estacionamento com autorização prévia (informar placa e modelo; exceto moto).' },
  { id: 'endereco-barra', title: 'Endereço Barra', content: 'Av. das Américas, 2480, Bloco 2, sala 312, Lead Américas Business. Estacionamento rotativo.' },
  { id: 'endereco-sp', title: 'Endereço São Paulo', content: 'Rua Joaquim Floriano, 820, 10º e 19º andar, Itaim Bibi - SP. Agendamento SP pode exigir sinal de 30%.' },
  { id: 'convenio', title: 'Convênios', content: 'Atendimento particular. Emitimos nota fiscal para reembolso no convênio.' },
  { id: 'pagamento', title: 'Pagamento', content: 'Presencial: paga na clínica. Teleconsulta: PIX ou cartão, link só após escolher horário, confirmação só após pagamento. SP: sinal 30%.' },
  { id: 'remarcacao', title: 'Remarcação', content: 'Nunca perguntar motivo. Oferecer novos horários: "Sem problema. Tem algum dia ou período que fique melhor?"' },
  { id: 'orcamento-foto', title: 'Orçamento por foto', content: 'Valor de cirurgia depende de avaliação. Foto pode ser encaminhada ao médico, nunca analisada pela Tawany. Estimativa só quando autorizada pela equipe.' },
] as const;

const STOP_WORDS = new Set(['a', 'o', 'de', 'da', 'do', 'e', 'em', 'para', 'com', 'um', 'uma', 'os', 'as', 'dos', 'das', 'no', 'na', 'ao']);

const tokenize = (s: string): string[] =>
  s.toLowerCase().split(/\W+/).filter((t) => t.length > 2 && !STOP_WORDS.has(t));

const score = (query: string, chunk: string): number => {
  const queryTokens = new Set(tokenize(query));
  const chunkTokens = new Set(tokenize(chunk));
  let hits = 0;
  for (const qt of queryTokens) if (chunkTokens.has(qt)) hits++;
  return hits / Math.max(queryTokens.size, 1);
};

export const searchKnowledge = {
  name: 'searchKnowledge',
  description: 'Busca na knowledge base operacional. Retorna top-3 chunks por relevância.',
  parameters: z.object({
    query: z.string().min(1).describe('Pergunta ou termo de busca'),
  }),
  execute: async (args: { query: string }): Promise<string> => {
    const ranked = KNOWLEDGE_CHUNKS
      .map((c) => ({ c, s: score(args.query, `${c.title} ${c.content}`) }))
      .sort((a, b) => b.s - a.s);
    const top = ranked.filter((r) => r.s > 0).slice(0, 3).map((r) => r.c);
    return JSON.stringify(top.length > 0 ? top : ranked.slice(0, 3).map((r) => r.c));
  },
};
