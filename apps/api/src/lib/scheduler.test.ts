import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataApi } from './data';
import { metaGraphBreaker } from './tools/sendWhatsApp';

const mocks = vi.hoisted(() => ({
  sendWhatsAppTemplate: {
    execute: vi.fn().mockResolvedValue(JSON.stringify({ ok: true, sent: false })),
  },
}));

vi.mock('./tools/sendWhatsAppTemplate', () => ({
  sendWhatsAppTemplate: mocks.sendWhatsAppTemplate,
}));

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
  ...over,
});

const D1_ENV_KEYS = ['APPOINTMENT_CONFIRM_BUTTONS', 'META_ACCESS_TOKEN', 'META_PHONE_NUMBER_ID'] as const;
const savedD1Env: Record<string, string | undefined> = {};

describe('scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of D1_ENV_KEYS) {
      savedD1Env[k] = process.env[k];
      delete process.env[k];
    }
    metaGraphBreaker.reset();
  });

  afterEach(() => {
    for (const k of D1_ENV_KEYS) {
      if (savedD1Env[k] === undefined) delete process.env[k];
      else process.env[k] = savedD1Env[k];
    }
    vi.unstubAllGlobals();
  });

  it('gets confirmed D-1 appointments in the Sao Paulo day window', async () => {
    const list = vi.fn().mockResolvedValue([{ id: 'a1', leadId: 'l1', scheduledAt: '2026-07-06T14:00:00.000Z' }]);
    const { getD1Appointments } = await import('./scheduler');

    const result = await getD1Appointments(api({ list }), new Date('2026-07-05T12:00:00.000Z'));

    expect(list).toHaveBeenCalledWith('appointment', {
      filter: {
        scheduledAt: { gte: '2026-07-06T03:00:00.000Z', lt: '2026-07-07T03:00:00.000Z' },
        status: { eq: 'CONFIRMED' },
        reminderD1Sent: { eq: false },
      },
      select: { id: true, scheduledAt: true, leadId: true, patientId: true, status: true },
    });
    expect(result).toHaveLength(1);
  });

  it('sends D-1 reminders through lead conversations and marks appointments sent', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'a1', leadId: 'l1', scheduledAt: '2026-07-06T14:00:00.000Z' }])
      .mockResolvedValueOnce([{ id: 'c1' }]);
    const update = vi.fn().mockResolvedValue({ id: 'a1' });
    const { runD1ReminderJob } = await import('./scheduler');

    const result = await runD1ReminderJob(api({ list, update }), new Date('2026-07-05T12:00:00.000Z'));

    expect(mocks.sendWhatsAppTemplate.execute).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'c1', templateName: 'qara_appointment_reminder_d1' }),
      expect.any(Object),
    );
    expect(update).toHaveBeenCalledWith('appointment', 'a1', { reminderD1Sent: true });
    expect(result).toEqual({ checked: 1, sent: 1 });
  });

  it('runs follow-up job for stale open conversations', async () => {
    const list = vi.fn().mockResolvedValue([{ id: 'c-old' }]);
    const update = vi.fn().mockResolvedValue({ id: 'c-old' });
    const { runFollowUpJob } = await import('./scheduler');

    const result = await runFollowUpJob(api({ list, update }), new Date('2026-07-05T12:00:00.000Z'));

    expect(list).toHaveBeenCalledWith('conversation', expect.objectContaining({
      filter: {
        status: { eq: 'OPEN' },
        lastMessageAt: { lt: '2026-07-03T12:00:00.000Z' },
      },
    }));
    expect(mocks.sendWhatsAppTemplate.execute).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'c-old', templateName: 'qara_followup_48h' }),
      expect.any(Object),
    );
    expect(update).toHaveBeenCalledWith('conversation', 'c-old', { status: 'PENDING_PATIENT' });
    expect(result).toEqual({ checked: 1, sent: 1 });
  });

  it('skips Instagram conversations in the follow-up job (no template, no status change)', async () => {
    const list = vi.fn().mockResolvedValue([{ id: 'c-ig', channel: 'INSTAGRAM' }]);
    const update = vi.fn().mockResolvedValue({ id: 'c-ig' });
    const { runFollowUpJob } = await import('./scheduler');

    const result = await runFollowUpJob(api({ list, update }), new Date('2026-07-05T12:00:00.000Z'));

    expect(mocks.sendWhatsAppTemplate.execute).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, sent: 0 });
  });

  it('sends the D-1 reminder with confirm/reschedule button payloads when APPOINTMENT_CONFIRM_BUTTONS=true', async () => {
    process.env.APPOINTMENT_CONFIRM_BUTTONS = 'true';
    process.env.META_ACCESS_TOKEN = 'tok';
    process.env.META_PHONE_NUMBER_ID = 'phone';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.D1BTN' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const list = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'a1', leadId: 'l1', scheduledAt: '2026-07-06T14:00:00.000Z' }])
      .mockResolvedValueOnce([{ id: 'c1', channel: 'WHATSAPP', externalId: '5511999998888' }]);
    const create = vi.fn().mockResolvedValue({ id: 'msg-1' });
    const update = vi.fn().mockResolvedValue({ id: 'a1' });
    const { runD1ReminderJob } = await import('./scheduler');

    const result = await runD1ReminderJob(api({ list, create, update }), new Date('2026-07-05T12:00:00.000Z'));

    expect(mocks.sendWhatsAppTemplate.execute).not.toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.template.name).toBe('qara_appointment_reminder_d1');
    expect(body.template.components).toEqual([
      {
        type: 'button',
        sub_type: 'quick_reply',
        index: '0',
        parameters: [{ type: 'payload', payload: 'confirm_apt_a1' }],
      },
      {
        type: 'button',
        sub_type: 'quick_reply',
        index: '1',
        parameters: [{ type: 'payload', payload: 'reschedule_apt_a1' }],
      },
    ]);
    expect(create).toHaveBeenCalledWith('chatMessage', expect.objectContaining({
      body: '[template:qara_appointment_reminder_d1]',
      conversationId: 'c1',
      messageType: 'TEMPLATE',
      deliveryStatus: 'SENT',
      externalId: 'wamid.D1BTN',
    }));
    expect(update).toHaveBeenCalledWith('conversation', 'c1', { lastMessageAt: expect.any(String) });
    expect(update).toHaveBeenCalledWith('appointment', 'a1', { reminderD1Sent: true });
    expect(result).toEqual({ checked: 1, sent: 1 });
  });

  it('records the D-1 reminder as PENDING (no send) when buttons are enabled but Meta is not configured', async () => {
    process.env.APPOINTMENT_CONFIRM_BUTTONS = 'true';

    const list = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'a1', leadId: 'l1', scheduledAt: '2026-07-06T14:00:00.000Z' }])
      .mockResolvedValueOnce([{ id: 'c1', channel: 'WHATSAPP', externalId: '5511999998888' }]);
    const create = vi.fn().mockResolvedValue({ id: 'msg-1' });
    const update = vi.fn().mockResolvedValue({ id: 'a1' });
    const { runD1ReminderJob } = await import('./scheduler');

    await runD1ReminderJob(api({ list, create, update }), new Date('2026-07-05T12:00:00.000Z'));

    expect(mocks.sendWhatsAppTemplate.execute).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith('chatMessage', expect.objectContaining({
      body: '[template:qara_appointment_reminder_d1]',
      deliveryStatus: 'PENDING',
    }));
  });

  it('skips Instagram conversations in the D-1 reminder job', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'a1', leadId: 'l1', scheduledAt: '2026-07-06T14:00:00.000Z' }])
      .mockResolvedValueOnce([{ id: 'c-ig', channel: 'INSTAGRAM' }]);
    const update = vi.fn().mockResolvedValue({ id: 'a1' });
    const { runD1ReminderJob } = await import('./scheduler');

    const result = await runD1ReminderJob(api({ list, update }), new Date('2026-07-05T12:00:00.000Z'));

    expect(mocks.sendWhatsAppTemplate.execute).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, sent: 0 });
  });

  it('runs pending Meta webhook sweep as part of the scheduler tick', async () => {
    const list = vi.fn().mockResolvedValue([]);
    const processPendingMetaWebhookEvents = vi.fn().mockResolvedValue({ scanned: 0, processed: 0, failed: 0 });
    const { runSchedulerTick } = await import('./scheduler');
    const now = new Date('2026-07-05T12:00:00.000Z');

    await runSchedulerTick(api({ list }), now, { processPendingMetaWebhookEvents });

    expect(processPendingMetaWebhookEvents).toHaveBeenCalledWith({ now });
  });
});
