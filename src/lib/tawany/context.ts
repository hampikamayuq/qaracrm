import type { DataApi } from 'src/lib/data';

export type RecentMessage = { id: string; direction: 'IN' | 'OUT'; body: string; sentAt: string };
export type LeadSummary = {
  id: string;
  name: { firstName: string; lastName: string } | null;
  whatsapp: unknown;
  stage: string;
  score: number;
  intent: string | null;
  tags: string[];
} | null;

export type TawanyContext = {
  conversationId: string;
  lead: LeadSummary;
  recentMessages: RecentMessage[]; // últimas 3 verbatim, mais antiga primeiro
  summary: string | null; // pré-computado pelo summarize-conversation
  knownPrices: number[]; // centavos, dos professionals — alimenta validateReply
};

const N_RECENT = 3;

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

  const lead = conv.leadId
    ? ((await ctx.get('lead', conv.leadId, {
        id: true,
        name: { firstName: true, lastName: true },
        whatsapp: true,
        stage: true,
        score: true,
        intent: true,
        tags: true,
      })) as LeadSummary)
    : null;

  const messages = (await ctx.list('chatMessage', {
    filter: { conversationId: { eq: conversationId } },
    orderBy: { sentAt: 'DESC' },
    limit: N_RECENT,
    select: { id: true, direction: true, body: true, sentAt: true },
  })) as RecentMessage[];

  const professionals = (await ctx.list('professional', {
    filter: { active: { eq: true } },
    select: { defaultPriceCents: true, rjPriceCents: true, spPriceCents: true, telePriceCents: true },
  })) as Record<string, number | null>[];

  const knownPrices = professionals
    .flatMap((p) => [p.defaultPriceCents, p.rjPriceCents, p.spPriceCents, p.telePriceCents])
    .filter((v): v is number => typeof v === 'number');

  return {
    conversationId,
    lead,
    recentMessages: messages.reverse(),
    summary: conv.summary ?? null,
    knownPrices,
  };
};
