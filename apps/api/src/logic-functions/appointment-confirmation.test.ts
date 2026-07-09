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

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockResolvedValue({ id: APPOINTMENT_ID }),
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
    const get = vi.fn().mockResolvedValue({ id: APPOINTMENT_ID });
    const update = vi.fn().mockResolvedValue({ id: APPOINTMENT_ID });
    const create = vi.fn().mockResolvedValue({ id: 'act-1' });
    const data = api({ get, update, create });

    const result = await runAppointmentConfirmationForInbound(
      { conversationId: 'conv-1', messageType: 'BUTTON', buttonPayload: `confirm_apt_${APPOINTMENT_ID}` },
      data,
    );

    expect(result).toEqual({ handled: true });
    expect(get).toHaveBeenCalledWith('appointment', APPOINTMENT_ID, { id: true });
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
    const get = vi.fn().mockResolvedValue({ id: APPOINTMENT_ID });
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
});
