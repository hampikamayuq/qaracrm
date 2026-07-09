import type { DataApi } from '../lib/data';
import { sendWhatsApp } from '../lib/tools/sendWhatsApp';

export type AppointmentConfirmationInput = {
  conversationId: string;
  messageType: string;
  buttonPayload?: string;
};

export type AppointmentConfirmationResult = { handled: boolean };

const CONFIRM_PAYLOAD_RE = /^confirm_apt_(.+)$/;
const RESCHEDULE_PAYLOAD_RE = /^reschedule_apt_(.+)$/;

// Appointment.status é string livre no schema (prisma/schema.prisma), com o
// comentário "SCHEDULED | CONFIRMED | DONE | NO_SHOW | CANCELLED" documentando
// os valores usados hoje. CONFIRMED já existe (é o mesmo valor filtrado pelo
// scheduler ao selecionar os agendamentos elegíveis para o lembrete D-1), então
// reaproveitamos — não foi preciso nenhum valor novo.
const APPOINTMENT_STATUS_CONFIRMED = 'CONFIRMED';

const CONFIRM_REPLY_TEXT =
  'Sua consulta está confirmada. Te esperamos! Qualquer imprevisto, é só nos avisar por aqui.';
const RESCHEDULE_REPLY_TEXT =
  'Sem problemas, vamos te ajudar a remarcar. Nossa equipe entra em contato em breve para encontrar um novo horário.';

const confirmAppointment = async (
  conversationId: string,
  appointmentId: string,
  data: DataApi,
): Promise<void> => {
  await data.update('appointment', appointmentId, { status: APPOINTMENT_STATUS_CONFIRMED });
  await sendWhatsApp.execute({ conversationId, text: CONFIRM_REPLY_TEXT }, data);
  await data.create('activity', {
    targetType: 'conversation',
    targetId: conversationId,
    conversationId,
    type: 'APPOINTMENT_CONFIRMED',
    title: 'Consulta confirmada pelo paciente',
    body: `Paciente confirmou a consulta ${appointmentId} pelo botão do lembrete D-1.`,
  });
};

const requestReschedule = async (
  conversationId: string,
  appointmentId: string,
  data: DataApi,
): Promise<void> => {
  // Mesmo padrão do opt-out em meta-webhook.ts: needsHuman + status
  // PENDING_HUMAN sinalizam para a Inbox que a IA não deve responder aqui.
  await data.update('conversation', conversationId, {
    needsHuman: true,
    status: 'PENDING_HUMAN',
    handoffReason: 'appointment_reschedule_requested',
  });
  await data.create('task', {
    title: 'Remarcar consulta',
    description: `Paciente pediu para remarcar a consulta ${appointmentId} pelo botão do lembrete D-1.`,
    status: 'OPEN',
    priority: 'HIGH',
    conversationId,
  });
  await sendWhatsApp.execute({ conversationId, text: RESCHEDULE_REPLY_TEXT }, data);
  await data.create('activity', {
    targetType: 'conversation',
    targetId: conversationId,
    conversationId,
    type: 'APPOINTMENT_RESCHEDULE_REQUESTED',
    title: 'Paciente pediu para remarcar a consulta',
    body: `Task "Remarcar consulta" criada para a recepção (consulta ${appointmentId}).`,
  });
};

// Intercepta a resposta ao lembrete D-1 (template qara_appointment_reminder_d1)
// ANTES de bots e da Tawany. O payload chega via meta-parse.ts tanto de
// button.payload (clique em quick-reply de template) quanto de
// interactive.button_reply.id (botão de sessão) — ambos mapeados para
// MetaInboundMessage.buttonPayload. Processa sem IA: confirma o agendamento ou
// aciona a recepção para remarcar.
export const runAppointmentConfirmationForInbound = async (
  input: AppointmentConfirmationInput,
  data: DataApi,
): Promise<AppointmentConfirmationResult> => {
  if (input.messageType !== 'BUTTON' || !input.buttonPayload) return { handled: false };

  const confirmMatch = CONFIRM_PAYLOAD_RE.exec(input.buttonPayload);
  const rescheduleMatch = !confirmMatch ? RESCHEDULE_PAYLOAD_RE.exec(input.buttonPayload) : null;
  if (!confirmMatch && !rescheduleMatch) return { handled: false };

  const appointmentId = (confirmMatch ?? rescheduleMatch)?.[1] ?? '';
  if (!appointmentId) return { handled: false };

  const appointment = await data.get('appointment', appointmentId, { id: true });
  if (!appointment) {
    console.warn(
      JSON.stringify({ event: 'appointment_confirmation_unknown_appointment', appointmentId }),
    );
    return { handled: false };
  }

  if (confirmMatch) {
    await confirmAppointment(input.conversationId, appointmentId, data);
  } else {
    await requestReschedule(input.conversationId, appointmentId, data);
  }
  return { handled: true };
};
