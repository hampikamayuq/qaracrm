import type { DataApi } from 'src/lib/data';
import { loadKnowledgeContext, type KnowledgeSectionRow, type TawanyExampleRow } from './knowledge';

export type RecentMessage = { id: string; direction: 'IN' | 'OUT'; body: string; sentAt: string };
export type LeadSummary = {
  id: string;
  name: string;
  phone: string | null;
  stage: string | null;
  score: number;
  intent: string | null;
  tags: string[];
} | null;

export type TawanyContext = {
  conversationId: string;
  lead: LeadSummary;
  recentMessages: RecentMessage[]; // últimas N_RECENT verbatim, mais antiga primeiro
  // Resumo pré-computado por summarize-conversation (rodado pós-Tawany no
  // tawany-handler quando o histórico excede a janela verbatim).
  summary: string | null;
  knownPrices: number[]; // centavos, dos Services ativos — alimenta validateReply
  // Knowledge vivo (/settings/knowledge) + exemplos few-shot aprovados, ambos do
  // cache de 60s. Vazios → prompt-builder cai no QARA_KNOWLEDGE_PROMPT hardcoded.
  knowledgeSections: KnowledgeSectionRow[];
  examples: TawanyExampleRow[];
};

export const N_RECENT = 10;

export const buildTawanyContext = async (
  conversationId: string,
  ctx: DataApi,
): Promise<TawanyContext> => {
  const conv = (await ctx.get('conversation', conversationId, {
    id: true,
    leadId: true,
    summary: true,
  })) as { leadId?: string | null; summary?: string | null } | null;
  if (!conv) throw new Error(`Conversation not found: ${conversationId}`);

  let lead: LeadSummary = null;
  if (conv.leadId) {
    const leadRow = (await ctx.get('lead', conv.leadId, {
      id: true,
      name: true,
      phone: true,
      stageId: true,
      score: true,
      intent: true,
      tags: true,
    })) as { id: string; name: string; phone: string | null; stageId: string | null; score: number; intent: string | null; tags: unknown } | null;

    if (leadRow) {
      const stageRow = leadRow.stageId
        ? ((await ctx.get('pipelineStage', leadRow.stageId, { name: true })) as { name?: string } | null)
        : null;
      lead = {
        id: leadRow.id,
        name: leadRow.name,
        phone: leadRow.phone,
        stage: stageRow?.name ?? null,
        score: leadRow.score,
        intent: leadRow.intent,
        tags: Array.isArray(leadRow.tags) ? leadRow.tags.filter((t): t is string => typeof t === 'string') : [],
      };
    }
  }

  const messages = (await ctx.list('chatMessage', {
    filter: { conversationId: { eq: conversationId } },
    orderBy: { sentAt: 'DESC' },
    limit: N_RECENT,
    select: { id: true, direction: true, body: true, sentAt: true },
  })) as RecentMessage[];

  const services = (await ctx.list('service', {
    filter: { active: { eq: true } },
    select: { priceCents: true },
  })) as { priceCents: number | null }[];

  const knownPrices = services
    .map((s) => s.priceCents)
    .filter((v): v is number => typeof v === 'number');

  const knowledge = await loadKnowledgeContext(ctx);

  return {
    conversationId,
    lead,
    recentMessages: messages.reverse(),
    summary: typeof conv.summary === 'string' && conv.summary.length > 0 ? conv.summary : null,
    knownPrices,
    knowledgeSections: knowledge.sections,
    examples: knowledge.examples,
  };
};
