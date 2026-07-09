import type { DataApi } from 'src/lib/data';
import { modelWithFallback, type AiClient } from 'src/lib/ai-client';
import { loadAiSettings } from 'src/lib/ai-settings';
import { daysSince, FOLLOWUP_THRESHOLD_DAYS } from 'src/lib/followup/categorize';
import { validateReply } from 'src/lib/guards/reply-validator';
import { classifyTawanyRisk } from 'src/lib/tawany/risk';
import { sendWhatsApp } from 'src/lib/tools/sendWhatsApp';
import { sendWhatsAppTemplate } from 'src/lib/tools/sendWhatsAppTemplate';
import { HSM_BUDGET_FOLLOWUP_TEMPLATE } from 'src/lib/templates/hsm-messages';
import { stageFromTags, tagsOf } from 'src/routes/pipeline-routes';

const FOLLOWUP_DUE_OFFSET_DAYS = 1; // dá 24h para a Tawany antes de escalar

// Estágios que não recebem follow-up automático: terminais + sucesso.
const CLOSED_STAGES = new Set(['perdido', 'alta-manutencao', 'atendido']);

type LeadLike = {
  id: string;
  intent?: string | null;
  score?: number | null;
  tags?: unknown;
  updatedAt?: string | Date | null;
  nextActionAt?: string | Date | null;
  assignedToId?: string | null;
};

type ConversationLike = {
  id: string;
  leadId?: string | null;
  status?: string | null;
};

const tomorrow = (now: Date): string => {
  const x = new Date(now);
  x.setDate(x.getDate() + FOLLOWUP_DUE_OFFSET_DAYS);
  return x.toISOString();
};

export type FollowupResult = {
  leadsScanned: number;
  tasksCreated: number;
  errors: number;
};

// Varre leads abertos e cria uma task de follow-up quando o lead está sem
// movimento há >= FOLLOWUP_THRESHOLD_DAYS. Dedup por task 'Follow-up' aberta
// e por lead.nextActionAt futuro. Buckets (Atrasadas/Hoje/Próximas) são
// derivados na leitura por lib/followup/categorize — nada é gravado aqui.
export const runFollowupEngine = async (
  now: Date,
  data: DataApi,
  deps: { ai?: AiClient } = {},
): Promise<FollowupResult> => {
  const result: FollowupResult = { leadsScanned: 0, tasksCreated: 0, errors: 0 };

  const leads = (await data.list('lead', {
    filter: { optedOut: { eq: false } },
    select: { id: true, intent: true, score: true, tags: true, updatedAt: true, nextActionAt: true, assignedToId: true },
    limit: 500,
  })) as LeadLike[];
  result.leadsScanned = leads.length;

  const openFollowups = (await data.list('task', {
    filter: { title: { eq: 'Follow-up' }, status: { eq: 'OPEN' } },
    select: { leadId: true },
    limit: 1000,
  })) as { leadId?: string | null }[];
  const hasOpenFollowup = new Set(
    openFollowups.map((t) => t.leadId).filter((id): id is string => typeof id === 'string'),
  );

  for (const lead of leads) {
    if (CLOSED_STAGES.has(stageFromTags(tagsOf(lead.tags)))) continue;
    if (hasOpenFollowup.has(lead.id)) continue;
    if (lead.nextActionAt && new Date(lead.nextActionAt as string | Date) > now) continue;
    const days = daysSince(
      lead.updatedAt ? new Date(lead.updatedAt as string | Date).toISOString() : null,
      now,
    );
    if (days === null || days < FOLLOWUP_THRESHOLD_DAYS) continue;
    try {
      await data.create('task', {
        title: 'Follow-up',
        status: 'OPEN',
        dueAt: tomorrow(now),
        leadId: lead.id,
        assignedToId: lead.assignedToId ?? null,
      });
      result.tasksCreated++;
      await data.update('lead', lead.id, { nextActionAt: tomorrow(now) });
      if (deps.ai) {
        await createIntelligentFollowup(lead, data, deps.ai);
      }
    } catch {
      result.errors++;
    }
  }

  return result;
};

const normalizedIntent = (intent: string | null | undefined): string => (
  typeof intent === 'string' ? intent.trim().toUpperCase() : ''
);

const shouldSendFollowup = (
  mode: string,
  riskLevel: 'low' | 'medium' | 'high',
  intent: string | null | undefined,
  autopilotIntents: string[],
): boolean => {
  if (mode === 'autopilot') return true;
  if (mode !== 'hibrido' || riskLevel !== 'low') return false;
  return autopilotIntents.includes(normalizedIntent(intent));
};

const createIntelligentFollowup = async (
  lead: LeadLike,
  data: DataApi,
  ai: AiClient,
): Promise<void> => {
  const conversations = (await data.list('conversation', {
    filter: { leadId: { eq: lead.id }, status: { eq: 'OPEN' } },
    select: { id: true, leadId: true, status: true },
    limit: 1,
  })) as ConversationLike[];
  const conversation = conversations[0];
  if (!conversation?.id) return;

  const model = modelWithFallback(
    process.env.DEFAULT_MODEL_PATIENT,
    process.env.DEFAULT_MODEL_PATIENT_FALLBACK,
    'minimax/minimax-m3',
  );
  const response = await ai.chat({
    model,
    system: [
      'Voce e Tawany, assistente de atendimento da Qara Clinic.',
      'Redija um follow-up curto, acolhedor e sem inventar preco, diagnostico, disponibilidade ou conduta medica.',
      'Nao inclua dados sensiveis do paciente.',
    ].join(' '),
    messages: [
      {
        role: 'user',
        content: `Crie uma mensagem de follow-up para um lead com intencao ${normalizedIntent(lead.intent) || 'NAO_INFORMADA'}.`,
      },
    ],
  });
  const body = (response.content ?? '').trim();
  if (!body) return;

  const guard = validateReply(body, { knownPrices: [] });
  if (!guard.ok) return;

  const riskLevel = classifyTawanyRisk(body, {
    lead: {
      id: lead.id,
      name: '',
      phone: null,
      stage: null,
      score: lead.score ?? 0,
      intent: lead.intent ?? null,
      tags: [],
    },
  });
  const suggestion = await data.create('aiSuggestion', {
    conversationId: conversation.id,
    model: response.modelUsed ?? model,
    body,
    riskLevel,
    status: 'PENDING',
    promptVersion: process.env.TAWANY_PROMPT_VERSION ?? 'v1',
  });

  const settings = await loadAiSettings(data);
  if (
    shouldSendFollowup(settings.mode, riskLevel, lead.intent, settings.autopilotIntents) &&
    typeof suggestion.id === 'string'
  ) {
    await sendWhatsApp.execute({ conversationId: conversation.id, text: body }, data);
    await data.update('aiSuggestion', suggestion.id, { status: 'SENT' });
  }
};

// ---------------------------------------------------------------- orçamentos

const BUDGET_FOLLOWUP_DEFAULT_DAYS = 3;

const budgetFollowupDays = (): number => {
  const raw = Number.parseInt(process.env.BUDGET_FOLLOWUP_DAYS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : BUDGET_FOLLOWUP_DEFAULT_DAYS;
};

export type BudgetFollowupResult = {
  budgetsScanned: number;
  tasksCreated: number;
  templatesSent: number;
  errors: number;
};

type BudgetLike = {
  id: string;
  title?: string | null;
  leadId?: string | null;
};

// Varre orçamentos SENT sem resposta há >= BUDGET_FOLLOWUP_DAYS dias e cria uma
// task deduplicada "Follow-up orçamento: <title>" no lead. Se o lead tem conversa
// WhatsApp, dispara o HSM qara_budget_followup pelo caminho de templates
// (sendWhatsAppTemplate pula Instagram sozinho). Idempotente: dedup por
// (leadId, título da task aberta).
export const runBudgetFollowup = async (
  now: Date,
  data: DataApi,
): Promise<BudgetFollowupResult> => {
  const result: BudgetFollowupResult = { budgetsScanned: 0, tasksCreated: 0, templatesSent: 0, errors: 0 };
  const cutoff = new Date(now.getTime() - budgetFollowupDays() * 86_400_000).toISOString();

  const budgets = (await data.list('budget', {
    filter: { status: { eq: 'SENT' }, sentAt: { lt: cutoff }, respondedAt: null },
    select: { id: true, title: true, leadId: true },
    limit: 500,
  })) as BudgetLike[];
  result.budgetsScanned = budgets.length;

  const openTasks = (await data.list('task', {
    filter: { status: { eq: 'OPEN' } },
    select: { leadId: true, title: true },
    limit: 1000,
  })) as { leadId?: string | null; title?: string | null }[];
  const existing = new Set(
    openTasks
      .filter((t) => typeof t.leadId === 'string' && typeof t.title === 'string')
      .map((t) => `${t.leadId}::${t.title}`),
  );

  for (const budget of budgets) {
    if (!budget.leadId) continue;
    const title = `Follow-up orçamento: ${budget.title ?? 'sem título'}`;
    if (existing.has(`${budget.leadId}::${title}`)) continue;
    try {
      await data.create('task', {
        title,
        status: 'OPEN',
        priority: 'HIGH',
        dueAt: now.toISOString(),
        leadId: budget.leadId,
      });
      existing.add(`${budget.leadId}::${title}`);
      result.tasksCreated++;

      // HSM só quando a conversa é WhatsApp. sendWhatsAppTemplate também pula
      // Instagram por dentro, então o skip fica garantido nas duas pontas.
      const conversations = await data.list('conversation', {
        filter: { leadId: { eq: budget.leadId } },
        orderBy: { lastMessageAt: 'DESC' },
        select: { id: true, channel: true },
        limit: 1,
      });
      const conversation = conversations[0] as { id?: string; channel?: string } | undefined;
      if (conversation?.id && conversation.channel === 'WHATSAPP') {
        const raw = await sendWhatsAppTemplate.execute(
          { conversationId: conversation.id, templateName: HSM_BUDGET_FOLLOWUP_TEMPLATE, language: 'pt_BR' },
          data,
        );
        const parsed = JSON.parse(raw) as { ok?: boolean };
        if (parsed.ok) result.templatesSent++;
      }
    } catch {
      result.errors++;
    }
  }

  return result;
};

// ponytail: o wrapper defineLogicFunction (cron Twenty) foi removido — o
// agendamento agora é o setInterval de src/server.ts (FOLLOWUP_INTERVAL_MS).
