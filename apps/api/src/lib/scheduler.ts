import type { DataApi } from './data';
import { sendWhatsAppTemplate } from './tools/sendWhatsAppTemplate';
import { HSM_D1_REMINDER_TEMPLATE, HSM_FOLLOW_UP_TEMPLATE } from './templates/hsm-messages';

export type SchedulerHandle = { stop(): void };
export type SchedulerJobs = {
  processPendingMetaWebhookEvents?: (options?: { now?: Date }) => Promise<unknown>;
};

const SAO_PAULO_UTC_OFFSET_HOURS = 3;
const DEFAULT_INTERVAL_MS = 60_000;

const saoPauloTomorrowWindow = (now: Date): { gte: string; lt: string } => {
  // ponytail: Sao Paulo is UTC-3 today; replace with Temporal if DST ever returns.
  const start = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    SAO_PAULO_UTC_OFFSET_HOURS,
    0,
    0,
  ));
  const end = new Date(start.getTime() + 24 * 3600_000);
  return { gte: start.toISOString(), lt: end.toISOString() };
};

export const getD1Appointments = async (
  data: DataApi,
  now = new Date(),
): Promise<Record<string, unknown>[]> => data.list('appointment', {
  filter: {
    scheduledAt: saoPauloTomorrowWindow(now),
    status: { eq: 'CONFIRMED' },
    reminderD1Sent: { eq: false },
  },
  select: { id: true, scheduledAt: true, leadId: true, patientId: true, status: true },
});

export const runD1ReminderJob = async (
  data: DataApi,
  now = new Date(),
): Promise<{ checked: number; sent: number }> => {
  const appointments = await getD1Appointments(data, now);
  let sent = 0;

  for (const appointment of appointments) {
    const leadId = typeof appointment.leadId === 'string' ? appointment.leadId : '';
    const appointmentId = typeof appointment.id === 'string' ? appointment.id : '';
    if (!leadId || !appointmentId) continue;

    const conversations = await data.list('conversation', {
      filter: { leadId: { eq: leadId } },
      limit: 1,
      select: { id: true },
    });
    const conversationId = typeof conversations[0]?.id === 'string' ? conversations[0].id : '';
    if (!conversationId) continue;

    await sendWhatsAppTemplate.execute({
      conversationId,
      templateName: HSM_D1_REMINDER_TEMPLATE,
      language: 'pt_BR',
    }, data);
    await data.update('appointment', appointmentId, { reminderD1Sent: true });
    sent++;
  }

  console.log(JSON.stringify({ event: 'scheduler_d1_reminder', checked: appointments.length, sent }));
  return { checked: appointments.length, sent };
};

export const runFollowUpJob = async (
  data: DataApi,
  now = new Date(),
): Promise<{ checked: number; sent: number }> => {
  const cutoff = new Date(now.getTime() - 48 * 3600_000).toISOString();
  const conversations = await data.list('conversation', {
    filter: {
      status: { eq: 'OPEN' },
      lastMessageAt: { lt: cutoff },
    },
    select: { id: true },
  });
  let sent = 0;

  for (const conversation of conversations) {
    const conversationId = typeof conversation.id === 'string' ? conversation.id : '';
    if (!conversationId) continue;
    await sendWhatsAppTemplate.execute({
      conversationId,
      templateName: HSM_FOLLOW_UP_TEMPLATE,
      language: 'pt_BR',
    }, data);
    await data.update('conversation', conversationId, { status: 'PENDING_PATIENT' });
    sent++;
  }

  console.log(JSON.stringify({ event: 'scheduler_followup', checked: conversations.length, sent }));
  return { checked: conversations.length, sent };
};

export const runSchedulerTick = async (
  data: DataApi,
  now = new Date(),
  jobs: SchedulerJobs = {},
): Promise<void> => {
  await jobs.processPendingMetaWebhookEvents?.({ now });
  await runFollowUpJob(data, now);
  await runD1ReminderJob(data, now);
};

export const startScheduler = (
  data: DataApi,
  intervalMs = DEFAULT_INTERVAL_MS,
  jobs: SchedulerJobs = {},
): SchedulerHandle | undefined => {
  if (process.env.ENABLE_SCHEDULER !== 'true') return undefined;

  const timer = setInterval(() => {
    void runSchedulerTick(data, new Date(), jobs).catch((error) => {
      console.error('[scheduler] tick failed:', (error as Error).message);
    });
  }, intervalMs);

  console.log('[scheduler] started');
  return { stop: () => clearInterval(timer) };
};
