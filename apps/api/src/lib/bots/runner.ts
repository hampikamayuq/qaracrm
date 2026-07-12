// Executa bots ativos contra uma mensagem inbound. First-match entre bots
// (priority ASC, desempate por createdAt) e first-match entre regras.
// Ações por regra: 'reply' responde e encerra; 'handoff' responde (se houver
// respostas) e marca a conversa pro humano; 'tawany' não responde e deixa a
// mensagem seguir pra Tawany (handled: false).
import { substituteVars } from '@qara/shared';
import type { DataApi } from '../data';
import { handoff } from '../handoff';
import { sendWhatsApp } from '../tools/sendWhatsApp';
import { botBlockedByRisk, findMatchingRule, parseBotSteps, MAX_RESPONSES_PER_RULE, type BotRule } from './engine';

export type BotMatch = {
  botId: string;
  botName: string;
  rule: BotRule;
  ruleIndex: number;
};

export type BotOutcome = {
  match: BotMatch;
  // false apenas na ação 'tawany': a disputa de bots encerrou, mas a mensagem
  // deve seguir pro handler seguinte (Tawany).
  handled: boolean;
};

export const matchActiveBots = async (data: DataApi, text: string): Promise<BotMatch | null> => {
  if (botBlockedByRisk(text)) return null;
  const bots = await data.list('bot', {
    filter: { active: { eq: true } },
    orderBy: { priority: 'ASC', createdAt: 'ASC' },
  });
  for (const bot of bots) {
    const flow = parseBotSteps(bot.steps);
    if (!flow) continue;
    const rule = findMatchingRule(flow.rules, text);
    if (rule) {
      return {
        botId: String(bot.id),
        botName: String(bot.name ?? 'Bot'),
        rule,
        ruleIndex: flow.rules.indexOf(rule),
      };
    }
  }
  return null;
};

// {{nome}}/{{primeiro_nome}} nas respostas: mesma semântica do quick reply
// (placeholder sem valor vira vazio; colapsa espaço duplo resultante).
const interpolate = async (
  responses: string[],
  conversationId: string,
  data: DataApi,
): Promise<string[]> => {
  if (!responses.some((r) => r.includes('{{'))) return responses;
  let nome = '';
  try {
    const conv = await data.get('conversation', conversationId, { leadId: true });
    const leadId = typeof conv?.leadId === 'string' ? conv.leadId : '';
    if (leadId) {
      const lead = await data.get('lead', leadId, { name: true });
      nome = typeof lead?.name === 'string' ? lead.name : '';
    }
  } catch (err) {
    console.error('[bots] lead lookup for vars failed (non-fatal):', (err as Error).message);
  }
  return responses.map((r) => substituteVars(r, { nome }).replace(/ {2,}/g, ' ').trim());
};

export const runBotsForInbound = async (
  params: { conversationId: string; text: string },
  data: DataApi,
): Promise<BotOutcome | null> => {
  const match = await matchActiveBots(data, params.text);
  if (!match) return null;

  const action = match.rule.action ?? 'reply';

  const recordReply = async (): Promise<void> => {
    try {
      await data.create('botReply', {
        botId: match.botId,
        botName: match.botName,
        ruleIndex: match.ruleIndex,
        action,
        conversationId: params.conversationId,
      });
    } catch (err) {
      // Métrica nunca segura a resposta ao paciente.
      console.error('[bots] botReply record failed (non-fatal):', (err as Error).message);
    }
  };

  if (action === 'tawany') {
    await recordReply();
    console.log(JSON.stringify({
      event: 'bot_to_tawany',
      conversationId: params.conversationId,
      botId: match.botId,
      ruleIndex: match.ruleIndex,
    }));
    return { match, handled: false };
  }

  const responses = await interpolate(
    match.rule.responses.slice(0, MAX_RESPONSES_PER_RULE),
    params.conversationId,
    data,
  );
  for (const response of responses) {
    await sendWhatsApp.execute({ conversationId: params.conversationId, text: response }, data);
  }

  if (action === 'handoff') {
    await handoff(params.conversationId, match.rule.handoffReason ?? `Bot "${match.botName}"`, data);
  }

  await recordReply();
  await data.create('activity', {
    targetType: 'conversation',
    targetId: params.conversationId,
    conversationId: params.conversationId,
    type: 'MESSAGE_SENT',
    title: `Fluxo automático: ${match.botName}`,
    body: `Bot "${match.botName}" respondeu com ${responses.length} mensagem(ns).`,
  });
  console.log(JSON.stringify({
    event: 'bot_reply',
    conversationId: params.conversationId,
    botId: match.botId,
    responses: responses.length,
    action,
  }));
  return { match, handled: true };
};
