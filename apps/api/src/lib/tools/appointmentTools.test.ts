import { describe, expect, it, vi } from 'vitest';
import type { DataApi } from '../data';
import { bookAppointment, checkAvailability } from './appointmentTools';

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
  ...over,
});

describe('appointment tools', () => {
  it('checkAvailability returns free slots excluding existing appointments', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce([{ scheduledAt: '2026-07-10T12:00:00.000Z', endAt: '2026-07-10T12:30:00.000Z' }]);

    const result = JSON.parse(await checkAvailability.execute({
      from: '2026-07-10T12:00:00.000Z',
      to: '2026-07-10T14:00:00.000Z',
      professionalId: 'p1',
      durationMinutes: 30,
    }, api({ list })));

    expect(result.availableSlots).toEqual([
      { professionalId: 'p1', start: '2026-07-10T12:30:00.000Z', end: '2026-07-10T13:00:00.000Z' },
      { professionalId: 'p1', start: '2026-07-10T13:00:00.000Z', end: '2026-07-10T13:30:00.000Z' },
      { professionalId: 'p1', start: '2026-07-10T13:30:00.000Z', end: '2026-07-10T14:00:00.000Z' },
    ]);
  });

  it('bookAppointment refuses occupied slots and creates an appointment when free', async () => {
    const occupiedList = vi.fn().mockResolvedValue([{
      id: 'a1',
      scheduledAt: '2026-07-10T12:00:00.000Z',
      endAt: '2026-07-10T12:30:00.000Z',
    }]);
    await expect(bookAppointment.execute({
      scheduledAt: '2026-07-10T12:00:00.000Z',
      endAt: '2026-07-10T12:30:00.000Z',
      professionalId: 'p1',
      leadId: 'l1',
    }, api({ list: occupiedList }))).rejects.toThrow('slot_unavailable');

    const list = vi.fn().mockResolvedValue([]);
    const create = vi.fn().mockResolvedValue({ id: 'a2' });
    const result = JSON.parse(await bookAppointment.execute({
      scheduledAt: '2026-07-10T12:00:00.000Z',
      endAt: '2026-07-10T12:30:00.000Z',
      professionalId: 'p1',
      leadId: 'l1',
    }, api({ list, create })));

    expect(create).toHaveBeenCalledWith('appointment', expect.objectContaining({
      scheduledAt: new Date('2026-07-10T12:00:00.000Z'),
      endAt: new Date('2026-07-10T12:30:00.000Z'),
      professionalId: 'p1',
      leadId: 'l1',
      status: 'SCHEDULED',
    }));
    expect(result).toEqual({ ok: true, appointmentId: 'a2' });
  });
});
