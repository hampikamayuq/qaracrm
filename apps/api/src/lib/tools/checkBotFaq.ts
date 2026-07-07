import { z } from 'zod';
import type { DataApi } from 'src/lib/data';
import { matchActiveBots } from 'src/lib/bots/runner';

export const checkBotFaq = {
  name: 'checkBotFaq',
  description:
    'Consulta os fluxos automáticos (bots) importados por uma resposta pronta e já aprovada para a pergunta do paciente. Use antes de responder perguntas administrativas recorrentes (preço, endereço, médico, horário) — se houver match, reaproveite o texto retornado em vez de compor uma resposta nova.',
  parameters: z.object({
    query: z.string().min(1).describe('Pergunta ou mensagem do paciente a verificar contra os fluxos ativos'),
  }),
  execute: async (args: { query: string }, ctx: DataApi): Promise<string> => {
    const match = await matchActiveBots(ctx, args.query);
    if (!match) return JSON.stringify({ matched: false });
    return JSON.stringify({ matched: true, botName: match.botName, responses: match.rule.responses });
  },
};
