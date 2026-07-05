import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/deps';
import type { DataApi } from '../lib/data';
import { createPrismaDataApi } from '../lib/prisma-data-api';
import { authMiddleware } from '../middleware/auth-middleware';

const data = createPrismaDataApi(prisma);
const router = Router();

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

const isValidDate = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));

const cleanAppointmentInput = (body: unknown): Record<string, unknown> | null => {
  if (!body || typeof body !== 'object') return null;
  const input = body as Record<string, unknown>;
  if ('scheduledAt' in input && !isValidDate(input.scheduledAt)) return null;

  return Object.fromEntries(
    ['scheduledAt', 'status', 'leadId', 'patientId', 'professionalId', 'serviceId', 'notes']
      .filter((key) => input[key] !== undefined)
      .map((key) => [key, input[key]]),
  );
};

export const listAppointmentsRoute = async (
  _req: Request,
  res: Response,
  api: DataApi = data,
): Promise<void> => {
  const appointments = await api.list('appointment', {
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
  res.json({ success: true, data: appointments });
};

export const createAppointmentRoute = async (
  req: Request,
  res: Response,
  api: DataApi = data,
): Promise<void> => {
  const input = cleanAppointmentInput(req.body);
  if (!input?.scheduledAt) {
    jsonError(res, 400, 'scheduledAt required');
    return;
  }
  const appointment = await api.create('appointment', input);
  res.status(201).json({ success: true, data: appointment });
};

export const updateAppointmentRoute = async (
  req: Request,
  res: Response,
  api: DataApi = data,
): Promise<void> => {
  const id = req.params.id;
  const input = cleanAppointmentInput(req.body);
  if (!id || !input) {
    jsonError(res, 400, 'valid appointment update required');
    return;
  }
  const appointment = await api.update('appointment', id, input);
  res.json({ success: true, data: appointment });
};

router.get('/', authMiddleware, (req, res) => void listAppointmentsRoute(req, res));
router.post('/', authMiddleware, (req, res) => void createAppointmentRoute(req, res));
router.patch('/:id', authMiddleware, (req, res) => void updateAppointmentRoute(req, res));

export default router;
