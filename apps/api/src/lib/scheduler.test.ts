import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataApi } from './data';

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

describe('scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
