import type { DataApi } from 'src/lib/data';
import { daysSince, FOLLOWUP_THRESHOLD_DAYS } from 'src/lib/followup/categorize';
import { stageFromTags, tagsOf } from 'src/routes/pipeline-routes';

const FOLLOWUP_DUE_OFFSET_DAYS = 1; // dá 24h para a Tawany antes de escalar

// Estágios que não recebem follow-up automático: terminais + sucesso.
const CLOSED_STAGES = new Set(['perdido', 'alta-manutencao', 'atendido']);

type LeadLike = {
  id: string;
  tags?: unknown;
  updatedAt?: string | Date | null;
  nextActionAt?: string | Date | null;
  assignedToId?: string | null;
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
): Promise<FollowupResult> => {
  const result: FollowupResult = { leadsScanned: 0, tasksCreated: 0, errors: 0 };

  const leads = (await data.list('lead', {
    filter: { optedOut: { eq: false } },
    select: { id: true, tags: true, updatedAt: true, nextActionAt: true, assignedToId: true },
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
    } catch {
      result.errors++;
    }
  }

  return result;
};

// ponytail: o wrapper defineLogicFunction (cron Twenty) foi removido — o
// agendamento agora é o setInterval de src/server.ts (FOLLOWUP_INTERVAL_MS).
