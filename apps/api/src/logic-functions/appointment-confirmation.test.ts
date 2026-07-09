import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataApi } from '../lib/data';
import { runAppointmentConfirmationForInbound } from './appointment-confirmation';

const mocks = vi.hoisted(() => ({
  sendWhatsApp: {
    execute: vi.fn().mockResolvedValue(JSON.stringify({ ok: true, sent: false })),
  },
}));

vi.mock('../lib/tools/sendWhatsApp', () => ({
  sendWhatsApp: mocks.sendWhatsApp,
}));

const APPOINTMENT_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const LEAD_ID = 'lead-1';

// get() é object-aware: a conversa devolve o leadId de origem e o agendamento
// devolve o leadId dono. Por padrão ambos batem (mesmo lead) — o fluxo feliz.
// Passe leadIds distintos para simular um agendamento de outro lead (IDOR).
const objectAwareGet = (
  { conversationLeadId = LEAD_ID, appointmentLeadId = LEAD_ID }: {
    conversationLeadId?: string | null;
    appointmentLeadId?: string | null;
  } = {},
) =>
  vi.fn((object: string, id: string) =>
    object === 'conversation'
      ? Promise.resolve({ id: 'conv-1', leadId: conversationLeadId })
      : Promise.resolve({ id, leadId: appointmentLeadId }),
  );

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: objectAwareGet(),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
  ...over,
});

describe('runAppointmentConfirmationForInbound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confirms the appointment, replies to the patient and logs an activity', async () => {
    const get = objectAwareGet();
    const update = vi.fn().mockResolvedValue({ id: APPOINTMENT_ID });
    const create = vi.fn().mockResolvedValue({ id: 'act-1' });
    const data = api({ get, update, create });

    const result = await runAppointmentConfirmationForInbound(
      { conversationId: 'conv-1', messageType: 'BUTTON', buttonPayload: `confirm_apt_${APPOINTMENT_ID}` },
      data,
    );

    expect(result).toEqual({ handled: true });
    // agora seleciona também o leadId para validar a posse do agendamento
    expect(get).toHaveBeenCalledWith('appointment', APPOINTMENT_ID, { id: true, leadId: true });
    expect(get).toHaveBeenCalledWith('conversation', 'conv-1', { id: true, leadId: true });
    expect(update).toHaveBeenCalledWith('appointment', APPOINTMENT_ID, { status: 'CONFIRMED' });
    expect(mocks.sendWhatsApp.execute).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1' }),
      data,
    );
    expect(create).toHaveBeenCalledWith('activity', expect.objectContaining({
      targetType: 'conversation',
      targetId: 'conv-1',
      conversationId: 'conv-1',
      type: 'APPOINTMENT_CONFIRMED',
    }));
    // não deve mexer na conversa nem criar task ao confirmar
    expect(update).not.toHaveBeenCalledWith('conversation', expect.anything(), expect.anything());
    expect(create).not.toHaveBeenCalledWith('task', expect.anything());
  });

  it('marks the conversation for a human, creates a reschedule task and replies', async () => {
    const get = objectAwareGet();
    const update = vi.fn().mockResolvedValue({ id: 'conv-1' });
    const create = vi.fn().mockResolvedValue({ id: 'created' });
    const data = api({ get, update, create });

    const result = await runAppointmentConfirmationForInbound(
      { conversationId: 'conv-1', messageType: 'BUTTON', buttonPayload: `reschedule_apt_${APPOINTMENT_ID}` },
      data,
    );

    expect(result).toEqual({ handled: true });
    expect(update).toHaveBeenCalledWith('conversation', 'conv-1', {
      needsHuman: true,
      status: 'PENDING_HUMAN',
      handoffReason: 'appointment_reschedule_requested',
    });
    expect(create).toHaveBeenCalledWith('task', expect.objectContaining({
      title: 'Remarcar consulta',
      conversationId: 'conv-1',
    }));
    expect(mocks.sendWhatsApp.execute).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1' }),
      data,
    );
    expect(create).toHaveBeenCalledWith('activity', expect.objectContaining({
      type: 'APPOINTMENT_RESCHEDULE_REQUESTED',
    }));
    // não deve mudar o status do agendamento ao pedir remarcação
    expect(update).not.toHaveBeenCalledWith('appointment', expect.anything(), expect.anything());
  });

  it('does not handle an unrecognized button payload', async () => {
    const data = api();
    const result = await runAppointmentConfirmationForInbound(
      { conversationId: 'conv-1', messageType: 'BUTTON', buttonPayload: 'some_other_flow_payload' },
      data,
    );

    expect(result).toEqual({ handled: false });
    expect(data.get).not.toHaveBeenCalled();
    expect(data.update).not.toHaveBeenCalled();
    expect(data.create).not.toHaveBeenCalled();
    expect(mocks.sendWhatsApp.execute).not.toHaveBeenCalled();
  });

  it('does not handle a message without a button payload', async () => {
    const data = api();
    const result = await runAppointmentConfirmationForInbound(
      { conversationId: 'conv-1', messageType: 'TEXT' },
      data,
    );

    expect(result).toEqual({ handled: false });
    expect(data.get).not.toHaveBeenCalled();
    expect(mocks.sendWhatsApp.execute).not.toHaveBeenCalled();
  });

  it('does not handle a BUTTON message with an empty payload', async () => {
    const data = api();
    const result = await runAppointmentConfirmationForInbound(
      { conversationId: 'conv-1', messageType: 'BUTTON', buttonPayload: '' },
      data,
    );

    expect(result).toEqual({ handled: false });
    expect(data.get).not.toHaveBeenCalled();
  });

  it('does not handle when the appointment no longer exists', async () => {
    const get = vi.fn().mockResolvedValue(null);
    const data = api({ get });

    const result = await runAppointmentConfirmationForInbound(
      { conversationId: 'conv-1', messageType: 'BUTTON', buttonPayload: `confirm_apt_${APPOINTMENT_ID}` },
      data,
    );

    expect(result).toEqual({ handled: false });
    expect(data.update).not.toHaveBeenCalled();
    expect(mocks.sendWhatsApp.execute).not.toHaveBeenCalled();
  });

  // ACHADO 3 (IDOR): o appointmentId vem do payload do botão. Um remetente não
  // pode confirmar/remarcar o agendamento de OUTRO lead só forjando o payload.
  it('does not handle when the appointment belongs to another lead (IDOR guard)', async () => {
    const get = objectAwareGet({ conversationLeadId: 'lead-1', appointmentLeadId: 'lead-999' });
    const update = vi.fn();
    const create = vi.fn();
    const data = api({ get, update, create });

    const result = await runAppointmentConfirmationForInbound(
      { conversationId: 'conv-1', messageType: 'BUTTON', buttonPayload: `confirm_apt_${APPOINTMENT_ID}` },
      data,
    );

    expect(result).toEqual({ handled: false });
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(mocks.sendWhatsApp.execute).not.toHaveBeenCalled();
  });

  // Sem leadId na conversa não há como validar a posse — não age.
  it('does not handle when the conversation has no leadId', async () => {
    const get = objectAwareGet({ conversationLeadId: null, appointmentLeadId: 'lead-1' });
    const update = vi.fn();
    const data = api({ get, update });

    const result = await runAppointmentConfirmationForInbound(
      { conversationId: 'conv-1', messageType: 'BUTTON', buttonPayload: `confirm_apt_${APPOINTMENT_ID}` },
      data,
    );

    expect(result).toEqual({ handled: false });
    expect(update).not.toHaveBeenCalled();
    expect(mocks.sendWhatsApp.execute).not.toHaveBeenCalled();
  });
});
