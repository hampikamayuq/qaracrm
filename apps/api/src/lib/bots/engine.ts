// Motor de bots determinísticos (fluxos importados do ManyChat/Kommo).
// Portado do CRM legado (crm-clinica-qara): parseBotFlow + normalized-contains.
// Um bot é { mode: 'first-match', rules: [{ terms, responses }] } guardado em Bot.steps.

import { LEADS_NOVOS_RISK_KEYWORDS } from '../leads-novos/rules';

export type BotRule = {
  blockId?: number;
  targetBlock?: number;
  terms: string[];
  responses: string[];
};

export type BotFlow = {
  mode: 'first-match';
  match: 'normalized-contains';
  rules: BotRule[];
};

export const MAX_RESPONSES_PER_RULE = 4;

export const normalizeText = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const cleanText = (text: string): string =>
  String(text).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();

// Mensagem com sinal clínico/risco nunca recebe resposta automática de bot —
// segue para Tawany/humano (mesma lista usada pelo fallback determinístico).
export const botBlockedByRisk = (text: string): boolean => {
  const normalized = normalizeText(text);
  return LEADS_NOVOS_RISK_KEYWORDS.some((keyword) => normalized.includes(normalizeText(keyword)));
};

export const findMatchingRule = (rules: BotRule[], text: string): BotRule | null => {
  const incoming = normalizeText(text);
  if (!incoming) return null;
  return (
    rules.find((rule) =>
      (rule.terms ?? []).some((term) => {
        const candidate = normalizeText(term);
        if (!candidate) return false;
        // Termo de uma palavra só casa por igualdade — o fluxo é stateless,
        // então "unha" não pode disparar em "minha unha está estranha".
        // ponytail: para menus numerados/curtos isso preserva a resposta exata.
        if (!candidate.includes(' ')) return incoming === candidate;
        return incoming === candidate || incoming.includes(candidate) || candidate.includes(incoming);
      }),
    ) ?? null
  );
};

export const parseBotSteps = (value: unknown): BotFlow | null => {
  if (!value || typeof value !== 'object') return null;
  const flow = value as Partial<BotFlow>;
  if (!Array.isArray(flow.rules) || flow.rules.length === 0) return null;
  return {
    mode: 'first-match',
    match: 'normalized-contains',
    rules: flow.rules
      .map((rule) => ({
        blockId: rule.blockId,
        targetBlock: rule.targetBlock,
        terms: (rule.terms ?? []).map(cleanText).filter(Boolean),
        responses: (rule.responses ?? []).map(cleanText).filter(Boolean),
      }))
      .filter((rule) => rule.terms.length > 0 && rule.responses.length > 0),
  };
};

// --- Conversor do formato ManyChat/Kommo (model.positions) ---

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const getHandler = (action: Rec): string => {
  const params = asRec(action.params);
  return String(params.handler ?? asRec(params.params).handler ?? '');
};
const getParams = (action: Rec): Rec => asRec(asRec(action.params).params);

export const parseBotFlow = (
  raw: unknown,
  source = 'importado.json',
): { name: string; flow: BotFlow } => {
  const root = asRec(raw);

  // Formato já convertido: { name, rules: [...] }
  const direct = parseBotSteps(root);
  if (direct) return { name: String(root.name ?? source.replace(/\.json$/i, '')), flow: direct };

  const model = asRec(root.model);
  const positionsRaw = model.positions;
  if (!positionsRaw) throw new Error('Fluxo sem model.positions e sem rules');
  const positions = asArr(
    typeof positionsRaw === 'string' ? JSON.parse(positionsRaw) : positionsRaw,
  ).map(asRec);
  if (positions.length === 0) throw new Error('positions vazio');

  const blockMap = new Map(positions.map((block) => [String(block.id), block]));

  const getTexts = (block: Rec): string[] =>
    asArr(block.actions)
      .map(asRec)
      .filter((action) => getHandler(action) === 'send_message')
      .map((action) => String(getParams(action).text ?? ''))
      .filter(Boolean);

  const getNextBlocks = (block: Rec): string[] => {
    const ids: string[] = [];
    for (const action of asArr(block.actions).map(asRec)) {
      for (const link of asArr(action.links).map(asRec)) {
        if (link.block != null) ids.push(String(link.block));
      }
    }
    const goto = asRec(block.goto);
    if (goto.block != null) ids.push(String(goto.block));
    return [...new Set(ids)];
  };

  const collectResponses = (startId: string, visited = new Set<string>()): string[] => {
    if (visited.has(startId) || visited.size > 12) return [];
    const block = blockMap.get(startId);
    if (!block) return [];
    visited.add(startId);
    const texts = getTexts(block);
    const hasCondition = asArr(block.actions).map(asRec).some((a) => getHandler(a) === 'conditions');
    if (hasCondition && texts.length === 0) return [];
    const responses = [...texts];
    for (const next of getNextBlocks(block)) {
      responses.push(...collectResponses(next, new Set(visited)));
    }
    return responses;
  };

  const rules: BotRule[] = [];
  for (const block of positions) {
    for (const action of asArr(block.actions).map(asRec)) {
      if (getHandler(action) !== 'conditions') continue;
      const params = getParams(action);
      const terms = asArr(params.conditions)
        .map(asRec)
        .map((condition) => String(condition.term2 ?? ''))
        .filter(Boolean);
      const links = asArr(action.links)
        .map(asRec)
        .map((link) => link.block)
        .filter((b) => b != null);
      for (const targetBlock of links) {
        const responses = [...new Set(collectResponses(String(targetBlock)).map(cleanText))]
          .filter(Boolean)
          .slice(0, MAX_RESPONSES_PER_RULE);
        if (terms.length > 0 && responses.length > 0) {
          rules.push({ blockId: Number(block.id), targetBlock: Number(targetBlock), terms, responses });
        }
      }
    }
  }

  if (rules.length === 0) throw new Error('Nenhuma regra extraída do fluxo');
  return {
    name: String(model.name ?? source.replace(/\.json$/i, '')),
    flow: { mode: 'first-match', match: 'normalized-contains', rules },
  };
};
