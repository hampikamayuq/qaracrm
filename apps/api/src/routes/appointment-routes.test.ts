import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { DataApi } from '../lib/data';

vi.mock('../middleware/auth-middleware', () => ({
  authMiddleware: vi.fn((_req, _res, next) => next()),
}));

const req = (overrides: Partial<Request>): Request => overrides as Request;

const res = () => {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response as unknown as Response & typeof response;
};

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
  ...over,
});

describe('Appointment routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists appointments ordered by date', async () => {
    const list = vi.fn().mockResolvedValue([{ id: 'a1' }]);
    const { listAppointmentsRoute } = await import('./appointment-routes');
    const response = res();

    await listAppointmentsRoute(req({}), response, api({ list }));

    expect(list).toHaveBeenCalledWith('appointment', {
      orderBy: { scheduledAt: 'ASC' },
      limit: 50,
      select: {
        id: true,
        scheduledAt: true,
        status: true,
        leadId: true,
        patientId: true,
        professionalId: true,
        serviceId: true,
        reminderD1Sent: true,
      },
    });
    expect(response.json).toHaveBeenCalledWith({ success: true, data: [{ id: 'a1' }] });
  });

  it('creates an appointment only with a valid scheduledAt', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'a1' });
    const { createAppointmentRoute } = await import('./appointment-routes');
    const response = res();

    await createAppointmentRoute(req({ body: { scheduledAt: '2026-07-06T14:00:00.000Z', leadId: 'l1' } }), response, api({ create }));

    expect(create).toHaveBeenCalledWith('appointment', {
      scheduledAt: '2026-07-06T14:00:00.000Z',
      leadId: 'l1',
    });
    expect(response.status).toHaveBeenCalledWith(201);
  });

  it('rejects invalid appointment dates', async () => {
    const create = vi.fn();
    const { createAppointmentRoute } = await import('./appointment-routes');
    const response = res();

    await createAppointmentRoute(req({ body: { scheduledAt: 'not-a-date' } }), response, api({ create }));

    expect(create).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
  });
});
