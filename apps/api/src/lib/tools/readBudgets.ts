import { z } from 'zod';
import type { DataApi } from 'src/lib/data';

// Só os campos que a Tawany precisa para responder sobre orçamentos — nada de
// dados internos (pagamentos, notas). Read-only.
const BUDGET_SELECT = {
  id: true,
  title: true,
  amount: true,
  entryAmount: true,
  installments: true,
  status: true,
  expiresAt: true,
};

export const readBudgets = {
  name: 'readBudgets',
  description:
    'Lista os orçamentos do lead vinculado a uma conversa (título, valor, status, validade). Retorna [] se a conversa não tiver lead ou não houver orçamentos.',
  parameters: z.object({
    conversationId: z.string().uuid().describe('UUID da conversa'),
  }),
  execute: async (args: { conversationId: string }, ctx: DataApi): Promise<string> => {
    const conversation = await ctx.get('conversation', args.conversationId, { id: true, leadId: true });
    const leadId = conversation && typeof conversation.leadId === 'string' ? conversation.leadId : null;
    if (!leadId) return JSON.stringify([]);

    const budgets = await ctx.list('budget', {
      filter: { leadId: { eq: leadId } },
      orderBy: { createdAt: 'DESC' },
      limit: 20,
      select: BUDGET_SELECT,
    });
    return JSON.stringify(budgets);
  },
};
