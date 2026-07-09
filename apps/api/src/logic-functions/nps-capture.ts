import type { DataApi } from '../lib/data';
import { sendWhatsApp } from '../lib/tools/sendWhatsApp';

export type NpsCaptureInput = {
  conversationId: string;
  messageType: string;
  text: string;
};

export type NpsCaptureResult = { handled: boolean };

// Casa "8", "10", "nota 8", "nota: 8!" etc.: prefixo/sufixo não-numérico é
// ignorado, mas o miolo tem que ser exatamente "10" ou um único dígito — não
// casa números fora da faixa 0-10 (ex.: "20", "100") nem decimais ("9.5").
const SCORE_RE = /^\D*?(10|[0-9])\D*$/;

const DEFAULT_CAPTURE_WINDOW_HOURS = 48;

// Janela de validade da captura: quanto tempo depois do envio do template
// ainda tratamos uma resposta numérica como nota NPS. Fora dela, a mensagem
// segue o fluxo normal (bots/Tawany) — não fica bloqueada nem interpretada
// como nota de uma pesquisa antiga.
const captureWindowHours = (): number => {
  const raw = process.env.NPS_CAPTURE_WINDOW_HOURS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CAPTURE_WINDOW_HOURS;
};

const extractScore = (text: string): number | null => {
  const match = SCORE_RE.exec(text.trim());
  if (!match) return null;
  const score = Number.parseInt(match[1], 10);
  return Number.isFinite(score) && score >= 0 && score <= 10 ? score : null;
};

const DETRACTOR_REPLY =
  'Obrigado pela sua nota! Sentimos muito que sua experiência não tenha sido a melhor — nossa equipe vai entrar em contato para entender melhor e te ajudar.';
const PASSIVE_REPLY = 'Muito obrigado pela sua avaliação! Ficamos felizes em cuidar de você.';
const PROMOTER_REPLY =
  'Muito obrigado pela nota! Ficamos muito felizes com sua experiência. Se puder, adoraríamos que deixasse também uma avaliação no Google — isso nos ajuda bastante!';

const replyForScore = (score: number): string => {
  if (score <= 6) return DETRACTOR_REPLY;
  if (score <= 8) return PASSIVE_REPLY;
  return PROMOTER_REPLY;
};

// Detrator (nota 0-6): sinaliza a conversa pra recepção (mesmo padrão do
// requestReschedule em appointment-confirmation.ts) e cria a task de
// acompanhamento — sem IA, determinístico.
const registerDetractor = async (
  conversationId: string,
  appointmentId: string,
  score: number,
  data: DataApi,
): Promise<void> => {
  await data.update('conversation', conversationId, {
    needsHuman: true,
    status: 'PENDING_HUMAN',
    handoffReason: 'nps_detractor',
  });
  await data.create('task', {
    title: `Detrator NPS: nota ${score}`,
    description: `Paciente respondeu a pesquisa NPS pós-consulta com nota ${score} (agendamento ${appointmentId}).`,
    status: 'OPEN',
    priority: 'HIGH',
    conversationId,
  });
};

// Intercepta a resposta à pesquisa NPS pós-consulta (template
// qara_nps_pos_consulta enviado por lib/scheduler.ts runNpsJob) ANTES de bots
// e da Tawany — mesmo padrão de runAppointmentConfirmationForInbound em
// appointment-confirmation.ts. Captura a nota de forma determinística (SEM
// IA): só um número inteiro 0-10, sem ambiguidade, dispara o fluxo.
export const runNpsCaptureForInbound = async (
  input: NpsCaptureInput,
  data: DataApi,
  now = new Date(),
): Promise<NpsCaptureResult> => {
  if (input.messageType !== 'TEXT' || !input.text) return { handled: false };

  const conversation = await data.get('conversation', input.conversationId, { id: true, leadId: true });
  const leadId = typeof conversation?.leadId === 'string' ? conversation.leadId : '';
  if (!leadId) return { handled: false };

  const pending = await data.list('appointment', {
    filter: {
      leadId: { eq: leadId },
      npsSentAt: { not: null },
      npsScore: { eq: null },
      npsRespondedAt: { eq: null },
    },
    orderBy: { npsSentAt: 'DESC' },
    limit: 1,
    select: { id: true, npsSentAt: true },
  });
  const appointment = pending[0];
  const appointmentId = typeof appointment?.id === 'string' ? appointment.id : '';
  const npsSentAtRaw = appointment?.npsSentAt;
  if (!appointmentId || !npsSentAtRaw) return { handled: false };

  const npsSentAt = npsSentAtRaw instanceof Date ? npsSentAtRaw : new Date(npsSentAtRaw as string);
  if (Number.isNaN(npsSentAt.getTime())) return { handled: false };
  const hoursSinceSent = (now.getTime() - npsSentAt.getTime()) / 3_600_000;
  // Fora da janela de captura: não mexe em nada, deixa a mensagem seguir o
  // fluxo normal (não é mais tratada como resposta à pesquisa).
  if (hoursSinceSent > captureWindowHours()) return { handled: false };

  const score = extractScore(input.text);
  if (score === null) return { handled: false };

  await data.update('appointment', appointmentId, {
    npsScore: score,
    npsRespondedAt: now.toISOString(),
  });
  await data.create('activity', {
    targetType: 'conversation',
    targetId: input.conversationId,
    conversationId: input.conversationId,
    type: 'NPS_RECEIVED',
    title: 'Nota NPS recebida',
    body: `Paciente respondeu a pesquisa NPS pós-consulta com nota ${score} (agendamento ${appointmentId}).`,
  });

  if (score <= 6) {
    await registerDetractor(input.conversationId, appointmentId, score, data);
  }

  await sendWhatsApp.execute({ conversationId: input.conversationId, text: replyForScore(score) }, data);

  return { handled: true };
};
