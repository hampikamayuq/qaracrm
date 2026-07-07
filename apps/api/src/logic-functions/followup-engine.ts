import type { DataApi } from 'src/lib/data';
import { categorizeTask, daysSince, FOLLOWUP_THRESHOLD_DAYS, type TaskCategory } from 'src/lib/followup/categorize';

const FOLLOWUP_DUE_OFFSET_DAYS = 1; // give Tawany 24h before recategorization escalates

type LeadLike = { id: string; stage?: string | null; lastFollowUpAt?: string | null; nextFollowUpAt?: string | null; assignedToId?: string | null };
type TaskLike = { id: string; status?: string | null; dueAt?: string | null; category?: string | null };

const isOpenLead = (lead: LeadLike): boolean =>
  lead.stage !== 'CONVERTIDO' && lead.stage !== 'PERDIDO';

const needsFollowup = (lead: LeadLike, now: Date): boolean => {
  if (lead.nextFollowUpAt) return false;
  const days = daysSince(lead.lastFollowUpAt, now);
  // If we never had a follow-up but the lead is older than the threshold, fire.
  // If we have one, fire when it's >= threshold days old.
  return days === null || days >= FOLLOWUP_THRESHOLD_DAYS;
};

const tomorrow = (now: Date): string => {
  const x = new Date(now);
  x.setDate(x.getDate() + FOLLOWUP_DUE_OFFSET_DAYS);
  return x.toISOString();
};

export type FollowupResult = {
  leadsScanned: number;
  tasksCreated: number;
  tasksRecategorized: number;
  errors: number;
};

export const runFollowupEngine = async (
  now: Date,
  data: DataApi,
): Promise<FollowupResult> => {
  const result: FollowupResult = { leadsScanned: 0, tasksCreated: 0, tasksRecategorized: 0, errors: 0 };

  // 1. Iterate open leads, create a follow-up task if it's been >= 3 days.
  const leads = (await data.list('lead', {
    filter: { stage: { neq: 'CONVERTIDO' } },
    select: { id: true, stage: true, lastFollowUpAt: true, nextFollowUpAt: true, assignedToId: true },
    limit: 500,
  })) as LeadLike[];
  result.leadsScanned = leads.length;

  for (const lead of leads) {
    if (!isOpenLead(lead)) continue;
    if (!needsFollowup(lead, now)) continue;
    try {
      await data.create('task', {
        title: 'Follow-up',
        status: 'TODO',
        dueAt: tomorrow(now),
        leadId: lead.id,
        assigneeId: lead.assignedToId ?? null,
        category: 'TODAY' as TaskCategory,
      });
      result.tasksCreated++;
      await data.update('lead', lead.id, { nextFollowUpAt: tomorrow(now) });
    } catch {
      result.errors++;
    }
  }

  // 2. Recategorize all open tasks. Re-derive bucket from dueAt + now so the
  //    view never shows stale categories.
  const tasks = (await data.list('task', {
    filter: { status: { eq: 'TODO' } },
    select: { id: true, status: true, dueAt: true, category: true },
    limit: 1000,
  })) as TaskLike[];

  for (const task of tasks) {
    const cat = categorizeTask(task, now);
    if (!cat || cat === task.category) continue;
    try {
      await data.update('task', task.id, { category: cat });
      result.tasksRecategorized++;
    } catch {
      result.errors++;
    }
  }

  return result;
};

// ponytail: o wrapper defineLogicFunction (cron Twenty) foi removido — o
// agendamento agora é o setInterval de src/server.ts (FOLLOWUP_INTERVAL_MS).
