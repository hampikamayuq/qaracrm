import type { DataApi } from './data';
import { metaGraphBreaker } from './tools/sendWhatsApp';
import { sendWhatsAppTemplate } from './tools/sendWhatsAppTemplate';
import { HSM_D1_REMINDER_TEMPLATE, HSM_FOLLOW_UP_TEMPLATE, HSM_NPS_TEMPLATE } from './templates/hsm-messages';
import { isMetaSendConfigured, sendViaMeta } from './whatsapp-client';
import { runReactivationJob } from './reactivation';

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

// Mesma lógica do saoPauloTomorrowWindow, mas para o dia anterior — usado pela
// pesquisa NPS pós-consulta (LEVA 2B): consultas cujo scheduledAt caiu inteiro
// no dia de ontem (janela Sao Paulo), ou seja "consulta de ontem".
const saoPauloYesterdayWindow = (now: Date): { gte: string; lt: string } => {
  const start = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - 1,
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

// FASE 6: com APPOINTMENT_CONFIRM_BUTTONS=true, o lembrete D-1 sai com botões
// quick-reply (confirm_apt_<id> / reschedule_apt_<id>) para o paciente
// confirmar/remarcar num toque — sem IA (ver logic-functions/appointment-confirmation.ts).
// Default false: o template ainda não tem botões aprovados na Meta, então
// degradamos para o envio simples de sempre via sendWhatsAppTemplate.
const appointmentConfirmButtonsEnabled = (): boolean =>
  process.env.APPOINTMENT_CONFIRM_BUTTONS === 'true';

// Envia o template D-1 diretamente via Meta Cloud API com os componentes de
// botão (bypassa a tool sendWhatsAppTemplate, que ainda não aceita botões),
// replicando a mesma gravação de ChatMessage/Conversation que ela faz.
const sendD1ReminderWithButtons = async (
  data: DataApi,
  conversationId: string,
  appointmentId: string,
  conversation: Record<string, unknown>,
): Promise<void> => {
  const to = typeof conversation.externalId === 'string' ? conversation.externalId : '';
  const canSend = isMetaSendConfigured() && conversation.channel === 'WHATSAPP' && to.length > 0;
  const wamid = canSend
    ? await metaGraphBreaker.execute(() =>
        sendViaMeta(to, '', {
          messageType: 'template',
          templateName: HSM_D1_REMINDER_TEMPLATE,
          languageCode: 'pt_BR',
          buttonPayloads: [`confirm_apt_${appointmentId}`, `reschedule_apt_${appointmentId}`],
        }),
      )
    : null;

  await data.create('chatMessage', {
    body: `[template:${HSM_D1_REMINDER_TEMPLATE}]`,
    direction: 'OUT',
    sentAt: new Date().toISOString(),
    conversationId,
    messageType: 'TEMPLATE',
    deliveryStatus: wamid ? 'SENT' : 'PENDING',
    agentHandled: true,
    ...(wamid ? { externalId: wamid } : {}),
  });
  await data.update('conversation', conversationId, { lastMessageAt: new Date().toISOString() });
};

export const runD1ReminderJob = async (
  data: DataApi,
  now = new Date(),
): Promise<{ checked: number; sent: number }> => {
  const appointments = await getD1Appointments(data, now);
  let sent = 0;
  const withButtons = appointmentConfirmButtonsEnabled();

  for (const appointment of appointments) {
    const leadId = typeof appointment.leadId === 'string' ? appointment.leadId : '';
    const appointmentId = typeof appointment.id === 'string' ? appointment.id : '';
    if (!leadId || !appointmentId) continue;

    const conversations = await data.list('conversation', {
      filter: { leadId: { eq: leadId } },
      limit: 1,
      select: { id: true, channel: true, externalId: true },
    });
    const conversation = conversations[0];
    const conversationId = typeof conversation?.id === 'string' ? conversation.id : '';
    if (!conversationId) continue;
    // Templates HSM são só WhatsApp: pula Instagram sem enviar nem marcar como
    // enviado (evita a mensagem fantasma [template:...] PENDING).
    if (conversation?.channel === 'INSTAGRAM') continue;

    if (withButtons) {
      await sendD1ReminderWithButtons(data, conversationId, appointmentId, conversation);
    } else {
      await sendWhatsAppTemplate.execute({
        conversationId,
        templateName: HSM_D1_REMINDER_TEMPLATE,
        language: 'pt_BR',
      }, data);
    }
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
    select: { id: true, channel: true },
  });
  let sent = 0;

  for (const conversation of conversations) {
    const conversationId = typeof conversation.id === 'string' ? conversation.id : '';
    if (!conversationId) continue;
    // Templates HSM são só WhatsApp: pula Instagram sem enviar nem mudar o status
    // (evita a mensagem fantasma [template:...] PENDING e o PENDING_PATIENT falso).
    if (conversation.channel === 'INSTAGRAM') continue;
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

// LEVA 2B: gate por NPS_ENABLED (default false) — a pesquisa só sai depois que
// o template qara_nps_pos_consulta estiver aprovado no Business Manager.
const npsJobEnabled = (): boolean => process.env.NPS_ENABLED === 'true';
const npsTemplateName = (): string => process.env.NPS_TEMPLATE || HSM_NPS_TEMPLATE;

// Consultas "concluídas ontem" para a pesquisa NPS. O CRM não marca o status
// DONE de forma confiável hoje (é edição manual da recepção — ver
// APPOINTMENT_STATUSES em routes/appointment-routes.ts), então o critério
// robusto aqui é por data/hora: qualquer agendamento cujo horário caiu no dia
// anterior (janela Sao Paulo) conta como "concluído ontem", desde que não
// tenha sido cancelado nem marcado como falta (não faz sentido pesquisar
// satisfação de quem não compareceu ou teve a consulta cancelada).
export const getNpsAppointments = async (
  data: DataApi,
  now = new Date(),
): Promise<Record<string, unknown>[]> => data.list('appointment', {
  filter: {
    scheduledAt: saoPauloYesterdayWindow(now),
    status: { notIn: ['CANCELLED', 'NO_SHOW'] },
    npsSentAt: { eq: null },
  },
  select: { id: true, scheduledAt: true, leadId: true, patientId: true, status: true },
});

// Nome do paciente pro template (parâmetro {{1}}): prioriza Patient.name (mais
// provável de estar atualizado pra quem já teve consulta) e cai para
// Lead.name quando não há patientId no agendamento.
const getPatientDisplayName = async (
  data: DataApi,
  appointment: Record<string, unknown>,
): Promise<string> => {
  const patientId = typeof appointment.patientId === 'string' ? appointment.patientId : '';
  if (patientId) {
    const patient = await data.get('patient', patientId, { name: true });
    if (typeof patient?.name === 'string' && patient.name) return patient.name;
  }
  const leadId = typeof appointment.leadId === 'string' ? appointment.leadId : '';
  if (leadId) {
    const lead = await data.get('lead', leadId, { name: true });
    if (typeof lead?.name === 'string' && lead.name) return lead.name;
  }
  return '';
};

export const runNpsJob = async (
  data: DataApi,
  now = new Date(),
): Promise<{ checked: number; sent: number }> => {
  if (!npsJobEnabled()) return { checked: 0, sent: 0 };

  const appointments = await getNpsAppointments(data, now);
  let sent = 0;
  const templateName = npsTemplateName();

  for (const appointment of appointments) {
    const leadId = typeof appointment.leadId === 'string' ? appointment.leadId : '';
    const appointmentId = typeof appointment.id === 'string' ? appointment.id : '';
    if (!leadId || !appointmentId) continue;

    const conversations = await data.list('conversation', {
      filter: { leadId: { eq: leadId } },
      limit: 1,
      select: { id: true, channel: true, externalId: true },
    });
    const conversation = conversations[0];
    const conversationId = typeof conversation?.id === 'string' ? conversation.id : '';
    if (!conversationId) continue;
    // Templates HSM são só WhatsApp: pula Instagram sem enviar nem marcar como
    // enviado (mesmo motivo do D-1 e do follow-up 48h).
    if (conversation?.channel === 'INSTAGRAM') continue;

    const patientName = await getPatientDisplayName(data, appointment);
    await sendWhatsAppTemplate.execute({
      conversationId,
      templateName,
      language: 'pt_BR',
      parameters: patientName ? [patientName] : [],
    }, data);
    await data.update('appointment', appointmentId, { npsSentAt: new Date().toISOString() });
    sent++;
  }

  console.log(JSON.stringify({ event: 'scheduler_nps', checked: appointments.length, sent }));
  return { checked: appointments.length, sent };
};

// Gates por job (Lote 1.1 do plano): ENABLE_SCHEDULER liga só o loop; cada
// job que ENVIA mensagem tem sua própria flag, default false. Isso elimina o
// efeito colateral de ligar o D-1 e disparar junto uma rajada de follow-ups
// 48h para o backlog de conversas OPEN antigas.
const d1RemindersEnabled = (): boolean => process.env.ENABLE_D1_REMINDERS === 'true';
const followUpHsmEnabled = (): boolean => process.env.ENABLE_FOLLOWUP_HSM === 'true';

export const runSchedulerTick = async (
  data: DataApi,
  now = new Date(),
  jobs: SchedulerJobs = {},
): Promise<void> => {
  await jobs.processPendingMetaWebhookEvents?.({ now });
  if (followUpHsmEnabled()) await runFollowUpJob(data, now);
  if (d1RemindersEnabled()) await runD1ReminderJob(data, now);
  await runNpsJob(data, now);
  await runReactivationJob(data, now);
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
