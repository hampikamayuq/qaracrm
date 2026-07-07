import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/deps';
import { authMiddleware } from '../middleware/auth-middleware';

const router = Router();

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

// Status reais do schema (Appointment.status) — nada inventado.
export const APPOINTMENT_STATUSES = ['SCHEDULED', 'CONFIRMED', 'DONE', 'NO_SHOW', 'CANCELLED'] as const;
const STATUS_SET = new Set<string>(APPOINTMENT_STATUSES);

const isValidDate = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));

const APPOINTMENT_INCLUDE = {
  lead: { select: { id: true, name: true, phone: true } },
  patient: { select: { id: true, name: true } },
  professional: { select: { id: true, name: true, specialty: true } },
  unit: { select: { id: true, name: true } },
} as const;

// Filtro comum de GET / e GET /export.ics. Retorna null quando from/to/status
// vêm malformados (o caller responde 400).
const buildListWhere = (query: Request['query']): Record<string, unknown> | null => {
  const where: Record<string, unknown> = {};
  const from = query.from;
  const to = query.to;
  if (from !== undefined || to !== undefined) {
    if ((from !== undefined && !isValidDate(from)) || (to !== undefined && !isValidDate(to))) return null;
    where.scheduledAt = {
      ...(from ? { gte: new Date(from as string) } : {}),
      ...(to ? { lte: new Date(to as string) } : {}),
    };
  }
  if (query.status !== undefined) {
    if (typeof query.status !== 'string' || !STATUS_SET.has(query.status)) return null;
    where.status = query.status;
  }
  if (typeof query.professionalId === 'string' && query.professionalId) {
    where.professionalId = query.professionalId;
  }
  return where;
};

export const listAppointmentsRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const where = buildListWhere(req.query);
    if (!where) {
      jsonError(res, 400, `from/to must be valid dates; status must be one of: ${APPOINTMENT_STATUSES.join(', ')}`);
      return;
    }
    const appointments = await prisma.appointment.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      take: 500,
      include: APPOINTMENT_INCLUDE,
    });
    res.json({ success: true, data: appointments });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

const cleanAppointmentInput = (body: unknown): Record<string, unknown> | null => {
  if (!body || typeof body !== 'object') return null;
  const input = body as Record<string, unknown>;
  if ('scheduledAt' in input && !isValidDate(input.scheduledAt)) return null;
  if ('endAt' in input && input.endAt !== null && !isValidDate(input.endAt)) return null;
  if ('status' in input && (typeof input.status !== 'string' || !STATUS_SET.has(input.status))) return null;

  const clean = Object.fromEntries(
    ['scheduledAt', 'endAt', 'status', 'leadId', 'patientId', 'professionalId', 'serviceId', 'unitId', 'notes']
      .filter((key) => input[key] !== undefined)
      .map((key) => [key, input[key]]),
  );
  if (typeof clean.scheduledAt === 'string') clean.scheduledAt = new Date(clean.scheduledAt);
  if (typeof clean.endAt === 'string') clean.endAt = new Date(clean.endAt);
  return clean;
};

export const createAppointmentRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const input = cleanAppointmentInput(req.body);
    if (!input?.scheduledAt) {
      jsonError(res, 400, 'scheduledAt required');
      return;
    }
    const appointment = await prisma.appointment.create({
      data: input as never,
      include: APPOINTMENT_INCLUDE,
    });
    res.status(201).json({ success: true, data: appointment });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const updateAppointmentRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const input = cleanAppointmentInput(req.body);
    if (!id || !input || Object.keys(input).length === 0) {
      jsonError(res, 400, 'valid appointment update required');
      return;
    }
    const result = await prisma.appointment.updateMany({ where: { id }, data: input as never });
    if (result.count === 0) {
      jsonError(res, 404, 'Appointment not found');
      return;
    }
    const appointment = await prisma.appointment.findUnique({ where: { id }, include: APPOINTMENT_INCLUDE });
    res.json({ success: true, data: appointment });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const listProfessionalsRoute = async (_req: Request, res: Response): Promise<void> => {
  try {
    const professionals = await prisma.professional.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, specialty: true },
    });
    res.json({ success: true, data: professionals });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const listUnitsRoute = async (_req: Request, res: Response): Promise<void> => {
  try {
    const units = await prisma.clinicUnit.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, city: true },
    });
    res.json({ success: true, data: units });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

// ---------------- export .ics ----------------

// RFC 5545: vírgula, ponto e vírgula, contrabarra e quebra de linha escapados.
const escapeIcsText = (text: string): string =>
  text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const icsDate = (d: Date): string =>
  d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

const DEFAULT_DURATION_MS = 30 * 60_000;

const STATUS_LABELS_PT: Record<string, string> = {
  SCHEDULED: 'Agendado',
  CONFIRMED: 'Confirmado',
  DONE: 'Realizado',
  NO_SHOW: 'Faltou',
  CANCELLED: 'Cancelado',
};

type IcsAppointment = {
  id: string;
  scheduledAt: Date;
  endAt: Date | null;
  status: string;
  lead: { name: string } | null;
  patient: { name: string } | null;
  professional: { name: string } | null;
};

// iCalendar gerado à mão (sem dependência): VCALENDAR + VEVENTs com UID,
// DTSTART/DTEND, SUMMARY. CRLF conforme a RFC.
export const buildIcs = (appointments: IcsAppointment[], now: Date): string => {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//QARA Clinic//Agenda//PT-BR'];
  for (const appt of appointments) {
    const who = appt.patient?.name ?? appt.lead?.name ?? 'Paciente';
    const parts = [`Consulta: ${who}`];
    if (appt.professional?.name) parts.push(appt.professional.name);
    parts.push(STATUS_LABELS_PT[appt.status] ?? appt.status);
    const end = appt.endAt ?? new Date(appt.scheduledAt.getTime() + DEFAULT_DURATION_MS);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${appt.id}@qara-clinic`,
      `DTSTAMP:${icsDate(now)}`,
      `DTSTART:${icsDate(appt.scheduledAt)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${escapeIcsText(parts.join(' — '))}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
};

export const exportIcsRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const where = buildListWhere(req.query);
    if (!where) {
      jsonError(res, 400, 'from/to must be valid dates');
      return;
    }
    const appointments = await prisma.appointment.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      take: 500,
      select: {
        id: true,
        scheduledAt: true,
        endAt: true,
        status: true,
        lead: { select: { name: true } },
        patient: { select: { name: true } },
        professional: { select: { name: true } },
      },
    });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="agenda-qara.ics"');
    res.send(buildIcs(appointments, new Date()));
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

router.get('/', authMiddleware, (req, res) => void listAppointmentsRoute(req, res));
router.get('/professionals', authMiddleware, (req, res) => void listProfessionalsRoute(req, res));
router.get('/units', authMiddleware, (req, res) => void listUnitsRoute(req, res));
router.get('/export.ics', authMiddleware, (req, res) => void exportIcsRoute(req, res));
router.post('/', authMiddleware, (req, res) => void createAppointmentRoute(req, res));
router.patch('/:id', authMiddleware, (req, res) => void updateAppointmentRoute(req, res));

export default router;
