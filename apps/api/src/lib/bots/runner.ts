// Executa bots ativos contra uma mensagem inbound. First-match entre bots
// (ordem de criação) e first-match entre regras. Quando casa, envia as
// respostas pelo WhatsApp (viram ChatMessage OUT — visíveis na Inbox).
import type { DataApi } from '../data';
import { sendWhatsApp } from '../tools/sendWhatsApp';
import { botBlockedByRisk, findMatchingRule, parseBotSteps, MAX_RESPONSES_PER_RULE, type BotRule } from './engine';

export type BotMatch = {
  botId: string;
  botName: string;
  rule: BotRule;
};

export const matchActiveBots = async (data: DataApi, text: string): Promise<BotMatch | null> => {
  if (botBlockedByRisk(text)) return null;
  const bots = await data.list('bot', {
    filter: { active: { eq: true } },
    orderBy: { createdAt: 'ASC' },
  });
  for (const bot of bots) {
    const flow = parseBotSteps(bot.steps);
    if (!flow) continue;
    const rule = findMatchingRule(flow.rules, text);
    if (rule) {
      return { botId: String(bot.id), botName: String(bot.name ?? 'Bot'), rule };
    }
  }
  return null;
};

export const runBotsForInbound = async (
  params: { conversationId: string; text: string },
  data: DataApi,
): Promise<BotMatch | null> => {
  const match = await matchActiveBots(data, params.text);
  if (!match) return null;

  for (const response of match.rule.responses.slice(0, MAX_RESPONSES_PER_RULE)) {
    await sendWhatsApp.execute({ conversationId: params.conversationId, text: response }, data);
  }
  await data.create('activity', {
    targetType: 'conversation',
    targetId: params.conversationId,
    conversationId: params.conversationId,
    type: 'MESSAGE_SENT',
    title: `Fluxo automático: ${match.botName}`,
    body: `Bot "${match.botName}" respondeu com ${match.rule.responses.length} mensagem(ns).`,
  });
  console.log(JSON.stringify({
    event: 'bot_reply',
    conversationId: params.conversationId,
    botId: match.botId,
    responses: match.rule.responses.length,
  }));
  return match;
};
