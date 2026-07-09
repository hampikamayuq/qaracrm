import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/deps';
import { authMiddleware } from '../middleware/auth-middleware';
import { STAGE_LABELS, stageFromTags, tagsOf, type UiStage } from './pipeline-routes';
import { logger } from '../lib/logger';

const router = Router();

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

// Erro inesperado (500): loga o detalhe no servidor e devolve mensagem
// genérica — dados de paciente nunca vazam detalhe interno na resposta.
const serverError = (res: Response, error: unknown, where: string): void => {
  logger.error({ where, error: (error as Error).message }, 'erro interno na rota de pacientes');
  jsonError(res, 500, 'erro interno');
};

const paramStr = (value: unknown): string => (typeof value === 'string' ? value : '');

const positiveInt = (value: unknown, fallback: number): number => {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// Estágio "convertido" do funil: o Lead que virou paciente é movido para
// `atendido` (label "Compareceu"), o estágio terminal ganho — mesmo destino
// que o LEGACY_STAGE_MAP dá a `CONVERTIDO` em pipeline-routes.ts. O schema não
// tem coluna `convertedPatientId`: o vínculo lead↔paciente é a FK Patient.leadId.
const CONVERTED_STAGE: UiStage = 'atendido';

// Campos graváveis do Patient (schema) — nada inventado. Mesmo conjunto do
// serviço legado patient.service.js.
const PATIENT_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  cpf: true,
  birthDate: true,
  preferredChannel: true,
  lgpdConsent: true,
  notesAdministrative: true,
  leadId: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ---------------------------------------------------------------- validação

const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'data inválida' });

const createSchema = z.object({
  name: z.string().trim().min(1, 'name obrigatório'),
  phone: z.string().trim().nullable().optional(),
  email: z.string().trim().nullable().optional(),
  cpf: z.string().trim().nullable().optional(),
  birthDate: isoDate.nullable().optional(),
  preferredChannel: z.string().trim().nullable().optional(),
  lgpdConsent: z.boolean().optional(),
  notesAdministrative: z.string().nullable().optional(),
});

const updateSchema = createSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'nenhum campo para atualizar' },
);

const toDateOrNull = (value: string | null | undefined): Date | null =>
  value ? new Date(value) : null;

const nullableString = (value: string | null | undefined): string | null =>
  value === undefined || value === null ? null : value;

// ---------------------------------------------------------------- listagem

export const listPatientsRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const page = positiveInt(req.query.page, 1);
    const pageSize = Math.min(100, positiveInt(req.query.pageSize, 25));

    const where: Prisma.PatientWhereInput = {};
    if (search) {
      // ILIKE no nome + contains no telefone — mesmo critério do listPatients legado.
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.patient.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: PATIENT_SELECT,
      }),
      prisma.patient.count({ where }),
    ]);

    res.json({ success: true, data: { items, total, page } });
  } catch (error) {
    serverError(res, error, 'GET /patients');
  }
};

// ---------------------------------------------------------------- timeline

type TimelineItem = {
  id: string;
  type: 'appointment' | 'budget' | 'messages' | 'task' | 'note' | 'stage_change' | 'pipeline_change';
  at: string;
  title: string;
  detail?: string;
  byName?: string | null;
};

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

const formatDateTimePt = (d: Date): string =>
  d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'Agendado',
  CONFIRMED: 'Confirmado',
  DONE: 'Realizado',
  NO_SHOW: 'Faltou',
  CANCELLED: 'Cancelado',
};

const BUDGET_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  SENT: 'Enviado',
  ACCEPTED: 'Aceito',
  REJECTED: 'Recusado',
  EXPIRED: 'Expirado',
};

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const stageLabel = (value: string | null | undefined): string => {
  if (!value) return '—';
  if (value in STAGE_LABELS) return STAGE_LABELS[value as UiStage];
  return value;
};

// Timeline do paciente: união ordenada (desc) de consultas, orçamentos,
// mensagens (agregadas por conversa/dia), tarefas e activities (notas +
// conversão) do paciente e do lead de origem, se houver.
export const getPatientRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = paramStr(req.params.id);
    if (!id) {
      jsonError(res, 400, 'patient id required');
      return;
    }

    const patient = await prisma.patient.findUnique({
      where: { id },
      select: { ...PATIENT_SELECT, lead: { select: { id: true, name: true, tags: true } } },
    });
    if (!patient) {
      jsonError(res, 404, 'Paciente não encontrado');
      return;
    }

    const conversations = await prisma.conversation.findMany({
      where: { patientId: id },
      select: { id: true },
    });
    const conversationIds = conversations.map((c) => c.id);

    // Activities do paciente + do lead de origem (conversão vive como
    // Activity targetType 'lead').
    const activityFilters: Prisma.ActivityWhereInput[] = [{ targetType: 'patient', targetId: id }];
    if (patient.leadId) {
      activityFilters.push({
        targetType: 'lead',
        targetId: patient.leadId,
        type: { in: ['NOTE', 'STAGE_CHANGE', 'PIPELINE_CHANGE', 'LEAD_CONVERTED'] },
      });
    }

    const [appointments, budgets, tasks, messages, activities] = await Promise.all([
      prisma.appointment.findMany({
        where: { patientId: id },
        orderBy: { scheduledAt: 'desc' },
        take: 100,
        select: {
          id: true, scheduledAt: true, status: true, value: true, createdAt: true,
          professional: { select: { name: true } },
          service: { select: { name: true } },
        },
      }),
      prisma.budget.findMany({
        where: { patientId: id },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, title: true, amount: true, status: true, sentAt: true, respondedAt: true, createdAt: true },
      }),
      prisma.task.findMany({
        where: { patientId: id },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, title: true, status: true, dueAt: true, createdAt: true, updatedAt: true },
      }),
      conversationIds.length === 0 ? [] : prisma.chatMessage.findMany({
        where: { conversationId: { in: conversationIds } },
        orderBy: { sentAt: 'desc' },
        take: 1000,
        select: { conversationId: true, sentAt: true, direction: true, agentHandled: true },
      }),
      prisma.activity.findMany({
        where: { OR: activityFilters },
        orderBy: { createdAt: 'desc' },
        take: 300,
        include: { user: { select: { name: true } } },
      }),
    ]);

    const now = new Date();
    const items: TimelineItem[] = [];

    for (const appt of appointments) {
      items.push({
        id: `appt-${appt.id}`,
        type: 'appointment',
        at: appt.createdAt.toISOString(),
        title: `Consulta em ${formatDateTimePt(appt.scheduledAt)}`,
        detail: [APPOINTMENT_STATUS_LABELS[appt.status] ?? appt.status, appt.service?.name, appt.professional?.name]
          .filter(Boolean).join(' · ') || undefined,
      });
    }

    for (const b of budgets) {
      items.push({
        id: `budget-created-${b.id}`,
        type: 'budget',
        at: b.createdAt.toISOString(),
        title: `Orçamento: ${b.title}`,
        detail: `${brl.format(Number(b.amount))} · ${BUDGET_STATUS_LABELS[b.status] ?? b.status}`,
      });
      if (b.sentAt) {
        items.push({ id: `budget-sent-${b.id}`, type: 'budget', at: b.sentAt.toISOString(), title: `Orçamento enviado: ${b.title}` });
      }
      if (b.respondedAt && (b.status === 'ACCEPTED' || b.status === 'REJECTED')) {
        items.push({
          id: `budget-resp-${b.id}`,
          type: 'budget',
          at: b.respondedAt.toISOString(),
          title: `Orçamento ${b.status === 'ACCEPTED' ? 'aceito' : 'recusado'}: ${b.title}`,
        });
      }
    }

    for (const task of tasks) {
      items.push({ id: `task-created-${task.id}`, type: 'task', at: task.createdAt.toISOString(), title: `Tarefa criada: ${task.title}` });
      if (task.status === 'DONE') {
        items.push({ id: `task-done-${task.id}`, type: 'task', at: task.updatedAt.toISOString(), title: `Tarefa concluída: ${task.title}` });
      } else if (task.status !== 'CANCELED' && task.dueAt && task.dueAt < now) {
        items.push({ id: `task-due-${task.id}`, type: 'task', at: task.dueAt.toISOString(), title: `Tarefa venceu: ${task.title}` });
      }
    }

    // Mensagens agregadas por conversa+dia — nunca uma linha por mensagem.
    const groups = new Map<string, { total: number; tawany: number; incoming: number; last: Date }>();
    for (const msg of messages) {
      const key = `${msg.conversationId}|${dayKey(msg.sentAt)}`;
      const group = groups.get(key) ?? { total: 0, tawany: 0, incoming: 0, last: msg.sentAt };
      group.total += 1;
      if (msg.direction === 'IN') group.incoming += 1;
      if (msg.direction === 'OUT' && msg.agentHandled) group.tawany += 1;
      if (msg.sentAt > group.last) group.last = msg.sentAt;
      groups.set(key, group);
    }
    for (const [key, group] of groups) {
      items.push({
        id: `msgs-${key}`,
        type: 'messages',
        at: group.last.toISOString(),
        title: `${group.total} ${group.total === 1 ? 'mensagem' : 'mensagens'}${group.tawany > 0 ? ` (${group.tawany} da Tawany)` : ''}`,
        detail: `${group.incoming} recebidas · ${group.total - group.incoming} enviadas`,
      });
    }

    for (const row of activities) {
      if (row.type === 'NOTE') {
        items.push({
          id: `note-${row.id}`,
          type: 'note',
          at: row.createdAt.toISOString(),
          title: 'Nota',
          detail: truncate(row.body, 500),
          byName: row.user?.name ?? 'Tawany',
        });
        continue;
      }
      if (row.type === 'LEAD_CONVERTED') {
        items.push({
          id: `conv-${row.id}`,
          type: 'stage_change',
          at: row.createdAt.toISOString(),
          title: 'Lead convertido em paciente',
          byName: row.user?.name ?? null,
        });
        continue;
      }
      let parsed: { type?: string; from?: string; to?: string; lostReason?: string; note?: string } = {};
      try {
        parsed = JSON.parse(row.body) as typeof parsed;
      } catch { /* body legado não-JSON */ }
      const isPipeline = row.type === 'PIPELINE_CHANGE';
      items.push({
        id: `move-${row.id}`,
        type: isPipeline ? 'pipeline_change' : 'stage_change',
        at: row.createdAt.toISOString(),
        title: isPipeline
          ? `Especialidade: ${parsed.from ?? '—'} → ${parsed.to ?? '—'}`
          : `${stageLabel(parsed.from)} → ${stageLabel(parsed.to)}${parsed.lostReason ? ` (motivo: ${parsed.lostReason})` : ''}`,
        ...(parsed.note ? { detail: parsed.note } : {}),
        byName: row.user?.name ?? null,
      });
    }

    items.sort((a, b) => b.at.localeCompare(a.at));

    const { lead, ...rest } = patient;
    res.json({
      success: true,
      data: {
        ...rest,
        lead: lead ? { id: lead.id, name: lead.name, stage: stageFromTags(tagsOf(lead.tags)) } : null,
        appointments,
        budgets,
        timeline: items.slice(0, 200),
      },
    });
  } catch (error) {
    serverError(res, error, 'GET /patients/:id');
  }
};

// ---------------------------------------------------------------- escrita

export const createPatientRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      jsonError(res, 400, parsed.error.issues[0]?.message ?? 'payload inválido');
      return;
    }
    const input = parsed.data;
    const patient = await prisma.patient.create({
      data: {
        name: input.name,
        phone: nullableString(input.phone),
        email: nullableString(input.email),
        cpf: nullableString(input.cpf),
        birthDate: toDateOrNull(input.birthDate),
        preferredChannel: nullableString(input.preferredChannel),
        lgpdConsent: input.lgpdConsent ?? false,
        notesAdministrative: nullableString(input.notesAdministrative),
      },
      select: PATIENT_SELECT,
    });
    res.status(201).json({ success: true, data: patient });
  } catch (error) {
    serverError(res, error, 'POST /patients');
  }
};

export const updatePatientRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      jsonError(res, 400, parsed.error.issues[0]?.message ?? 'payload inválido');
      return;
    }
    const input = parsed.data;
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.phone !== undefined) data.phone = nullableString(input.phone);
    if (input.email !== undefined) data.email = nullableString(input.email);
    if (input.cpf !== undefined) data.cpf = nullableString(input.cpf);
    if (input.birthDate !== undefined) data.birthDate = toDateOrNull(input.birthDate);
    if (input.preferredChannel !== undefined) data.preferredChannel = nullableString(input.preferredChannel);
    if (input.lgpdConsent !== undefined) data.lgpdConsent = input.lgpdConsent;
    if (input.notesAdministrative !== undefined) data.notesAdministrative = nullableString(input.notesAdministrative);

    const result = await prisma.patient.updateMany({ where: { id: paramStr(req.params.id) }, data });
    if (result.count === 0) {
      jsonError(res, 404, 'Paciente não encontrado');
      return;
    }
    const patient = await prisma.patient.findUnique({ where: { id: paramStr(req.params.id) }, select: PATIENT_SELECT });
    res.json({ success: true, data: patient });
  } catch (error) {
    serverError(res, error, 'PATCH /patients/:id');
  }
};

// Converte um Lead em Patient (POST /api/patients/convert-from-lead/:leadId).
// Transação: cria o Patient a partir do Lead, vincula as conversas do lead ao
// paciente, move o lead para o estágio convertido (`atendido`) via tag
// `status:` e registra as Activities STAGE_CHANGE + LEAD_CONVERTED. Idempotente:
// se o lead já tem paciente vinculado (Patient.leadId), devolve o existente.
export const convertFromLeadRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const leadId = paramStr(req.params.leadId);
    if (!leadId) {
      jsonError(res, 400, 'leadId required');
      return;
    }

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, name: true, phone: true, email: true, tags: true },
    });
    if (!lead) {
      jsonError(res, 404, 'Lead não encontrado');
      return;
    }

    const existing = await prisma.patient.findFirst({ where: { leadId }, select: PATIENT_SELECT });
    if (existing) {
      res.status(200).json({ success: true, data: { ...existing, alreadyConverted: true } });
      return;
    }

    const userId = req.userId ?? null;
    const currentTags = tagsOf(lead.tags);
    const fromStage = stageFromTags(currentTags);
    const nextTags = [...currentTags.filter((t) => !t.startsWith('status:')), `status:${CONVERTED_STAGE}`];

    const patient = await prisma.$transaction(async (tx) => {
      const created = await tx.patient.create({
        data: { name: lead.name, phone: lead.phone, email: lead.email, leadId },
        select: PATIENT_SELECT,
      });

      await tx.conversation.updateMany({
        where: { leadId, patientId: null },
        data: { patientId: created.id },
      });

      await tx.lead.update({ where: { id: leadId }, data: { tags: nextTags } });

      // Histórico de estágio (só quando muda) — mesma convenção do pipeline.
      if (fromStage !== CONVERTED_STAGE) {
        await tx.activity.create({
          data: {
            targetType: 'lead',
            targetId: leadId,
            type: 'STAGE_CHANGE',
            userId,
            body: JSON.stringify({
              type: 'stage_change',
              from: fromStage,
              to: CONVERTED_STAGE,
              ...(userId ? { byUserId: userId } : {}),
              at: new Date().toISOString(),
            }),
          },
        });
      }

      await tx.activity.create({
        data: {
          targetType: 'lead',
          targetId: leadId,
          type: 'LEAD_CONVERTED',
          title: 'Lead convertido em paciente',
          body: JSON.stringify({ patientId: created.id }),
          userId,
        },
      });

      return created;
    });

    res.status(201).json({ success: true, data: patient });
  } catch (error) {
    serverError(res, error, 'POST /patients/convert-from-lead/:leadId');
  }
};

// convert-from-lead antes de /:id não é necessário (caminho distinto), mas a
// ordem segue o padrão: coleções, item, escritas.
router.get('/', authMiddleware, listPatientsRoute);
router.get('/:id', authMiddleware, getPatientRoute);
router.post('/', authMiddleware, createPatientRoute);
router.patch('/:id', authMiddleware, updatePatientRoute);
router.post('/convert-from-lead/:leadId', authMiddleware, convertFromLeadRoute);

export default router;
