import { z } from 'zod';
import type { DataApi } from '../data';

const ISODate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'invalid date');
const SLOT_STEP_MINUTES = 30;

const overlaps = (
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean => aStart < bEnd && bStart < aEnd;

export const checkAvailability = {
  name: 'checkAvailability',
  description: 'Lista horários livres na agenda entre duas datas.',
  parameters: z.object({
    from: ISODate,
    to: ISODate,
    professionalId: z.string().optional(),
    durationMinutes: z.number().int().min(15).max(240).default(30),
  }),
  execute: async (
    args: { from: string; to: string; professionalId?: string; durationMinutes: number },
    ctx: DataApi,
  ): Promise<string> => {
    const from = new Date(args.from);
    const to = new Date(args.to);
    if (from >= to) throw new Error('invalid_window');

    const professionals = args.professionalId
      ? [{ id: args.professionalId }]
      : await ctx.list('professional', { filter: { active: { eq: true } }, select: { id: true }, limit: 50 });
    const availableSlots: Array<{ professionalId: string; start: string; end: string }> = [];

    for (const professional of professionals) {
      const professionalId = typeof professional.id === 'string' ? professional.id : '';
      if (!professionalId) continue;
      const busy = await ctx.list('appointment', {
        filter: { professionalId: { eq: professionalId } },
        select: { scheduledAt: true, endAt: true },
        limit: 500,
      });
      for (let t = from.getTime(); t + args.durationMinutes * 60_000 <= to.getTime(); t += SLOT_STEP_MINUTES * 60_000) {
        const start = new Date(t);
        const end = new Date(t + args.durationMinutes * 60_000);
        const isBusy = busy.some((slot) => {
          const slotStart = new Date(String(slot.scheduledAt));
          const slotEnd = slot.endAt ? new Date(String(slot.endAt)) : new Date(slotStart.getTime() + args.durationMinutes * 60_000);
          return overlaps(start, end, slotStart, slotEnd);
        });
        if (!isBusy) availableSlots.push({ professionalId, start: start.toISOString(), end: end.toISOString() });
      }
    }

    return JSON.stringify({ availableSlots: availableSlots.slice(0, 20) });
  },
};

export const bookAppointment = {
  name: 'bookAppointment',
  description: 'Cria um agendamento se o horário estiver livre.',
  parameters: z.object({
    scheduledAt: ISODate,
    endAt: ISODate,
    professionalId: z.string().optional(),
    leadId: z.string().optional(),
    patientId: z.string().optional(),
    serviceId: z.string().optional(),
    unitId: z.string().optional(),
  }),
  execute: async (
    args: {
      scheduledAt: string;
      endAt: string;
      professionalId?: string;
      leadId?: string;
      patientId?: string;
      serviceId?: string;
      unitId?: string;
    },
    ctx: DataApi,
  ): Promise<string> => {
    const scheduledAt = new Date(args.scheduledAt);
    const endAt = new Date(args.endAt);
    if (scheduledAt >= endAt) throw new Error('invalid_window');
    const existing = await ctx.list('appointment', {
      filter: {
        ...(args.professionalId ? { professionalId: { eq: args.professionalId } } : {}),
      },
      select: { id: true, scheduledAt: true, endAt: true },
      limit: 500,
    });
    const occupied = existing.some((slot) => {
      const slotStart = new Date(String(slot.scheduledAt));
      const slotEnd = slot.endAt ? new Date(String(slot.endAt)) : new Date(slotStart.getTime() + 30 * 60_000);
      return overlaps(scheduledAt, endAt, slotStart, slotEnd);
    });
    if (occupied) throw new Error('slot_unavailable');

    const created = await ctx.create('appointment', {
      scheduledAt,
      endAt,
      status: 'SCHEDULED',
      ...(args.professionalId ? { professionalId: args.professionalId } : {}),
      ...(args.leadId ? { leadId: args.leadId } : {}),
      ...(args.patientId ? { patientId: args.patientId } : {}),
      ...(args.serviceId ? { serviceId: args.serviceId } : {}),
      ...(args.unitId ? { unitId: args.unitId } : {}),
    });
    return JSON.stringify({ ok: true, appointmentId: created.id });
  },
};
