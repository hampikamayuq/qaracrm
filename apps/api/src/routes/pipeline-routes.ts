import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/deps';
import { authMiddleware } from '../middleware/auth-middleware';
import { daysSince, FOLLOWUP_THRESHOLD_DAYS } from '../lib/followup/categorize';

const router = Router();

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

const paramStr = (value: unknown): string => (typeof value === 'string' ? value : '');

export const CLINICAL_PIPELINES = [
  'dermatologia-clinica',
  'tricologia',
  'cirurgia',
  'unhas',
  'podologia',
  'inflamatorias',
  'dermatopediatria',
  'administrativo',
  'reativacao',
] as const;

// Estágios canônicos do funil (KB §5). Guardados como tag `status:<estagio>`
// no Lead (mesmo prefixo já aprovado no QARA_CLASSIFICATION_PROMPT) em vez de
// um novo campo — Lead.stageId/PipelineStage segue servindo o funil original
// (Task 11 / operations-routes), que tem granularidade diferente.
export const UI_STAGES = [
  'novo-lead',
  'qualificado',
  'horario-oferecido',
  'agendado',
  'confirmado',
  'atendido',
  'reagendado',
  'perdido',
  'alta-manutencao',
] as const;

export type UiStage = (typeof UI_STAGES)[number];
const DEFAULT_STAGE: UiStage = 'novo-lead';

export const STAGE_LABELS: Record<UiStage, string> = {
  'novo-lead': 'Novo lead',
  qualificado: 'Qualificado',
  'horario-oferecido': 'Horário oferecido',
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  atendido: 'Compareceu',
  reagendado: 'Reagendado',
  perdido: 'Perdido',
  'alta-manutencao': 'Alta / manutenção',
};

// Estágios terminais: a UI os diferencia visualmente e leads neles nunca
// contam como "parados".
const TERMINAL_STAGES: readonly UiStage[] = ['atendido', 'perdido', 'alta-manutencao'];

// Motivos canônicos de perda — família `status:perdido-*` da KB §15, estendida.
export const LOSS_REASONS = [
  'preco',
  'plano',
  'horario',
  'sem-resposta',
  'concorrente',
  'fora-de-perfil',
  'outro',
] as const;

// Compatibilidade: tags `status:` antigas (maiúsculas) → estágio canônico.
const LEGACY_STAGE_MAP: Record<string, UiStage> = {
  NOVO: 'novo-lead',
  QUALIFICADO: 'qualificado',
  AGENDADO: 'agendado',
  COMPARECEU: 'atendido',
  CONVERTIDO: 'atendido',
  PERDIDO: 'perdido',
};

export const tagsOf = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : [];

export const valueByPrefix = (tags: string[], prefix: string): string | null => {
  const found = tags.find((t) => t.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
};

export const stageFromTags = (tags: string[]): UiStage => {
  for (const tag of tags) {
    if (!tag.startsWith('status:')) continue;
    const value = tag.slice('status:'.length);
    if ((UI_STAGES as readonly string[]).includes(value)) return value as UiStage;
    // `status:perdido-<motivo>` É a tag de estágio do lead perdido (KB §15).
    if (value.startsWith('perdido-')) return 'perdido';
    const legacy = LEGACY_STAGE_MAP[value];
    if (legacy) return legacy;
    // Tags de status paralelas (ex.: aguardando-pagamento) não definem estágio.
  }
  return DEFAULT_STAGE;
};

const lostReasonFromTags = (tags: string[]): string | null => {
  const found = tags.find((t) => t.startsWith('status:perdido-'));
  return found ? found.slice('status:perdido-'.length) : null;
};

export const setTagPrefix = (tags: string[], prefix: string, value: string | null): string[] => {
  const filtered = tags.filter((t) => !t.startsWith(prefix));
  return value ? [...filtered, `${prefix}${value}`] : filtered;
};

type StageChangeEvent = {
  type: 'stage_change' | 'pipeline_change';
  from: string | null;
  to: string;
  lostReason?: string;
  note?: string;
  byUserId?: string;
  at: string;
};

// Histórico de movimentação: reusa o modelo Activity (targetType 'lead'),
// body JSON estruturado + userId para resolver o nome de quem moveu na leitura.
const recordMoveActivity = async (leadId: string, userId: string | undefined, event: StageChangeEvent): Promise<void> => {
  await prisma.activity.create({
    data: {
      targetType: 'lead',
      targetId: leadId,
      type: event.type === 'pipeline_change' ? 'PIPELINE_CHANGE' : 'STAGE_CHANGE',
      userId: userId ?? null,
      body: JSON.stringify(event),
    },
  });
};

export const getPipelinesRoute = async (_req: Request, res: Response): Promise<void> => {
  try {
    const pipelines = CLINICAL_PIPELINES.map((slug, index) => ({
      id: slug,
      name: slug.charAt(0).toUpperCase() + slug.slice(1).replace('-', ' '),
      slug,
      order: index,
      color: '#1976d2',
    }));
    res.json({ success: true, data: pipelines });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const getPipelineStagesRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const pipeline = paramStr(req.params.pipeline) || 'default';
    const stages = UI_STAGES.map((stage, index) => ({
      id: `${pipeline}-${stage}`,
      slug: stage,
      name: STAGE_LABELS[stage],
      pipeline,
      order: index,
      terminal: TERMINAL_STAGES.includes(stage),
      color: '#1976d2',
    }));
    res.json({ success: true, data: stages });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const getPipelineLeadsRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const pipelineFilter = typeof req.query.pipeline === 'string' && req.query.pipeline !== 'all'
      ? req.query.pipeline
      : undefined;

    const leads = await prisma.lead.findMany({
      orderBy: { score: 'desc' },
      select: {
        id: true, name: true, phone: true, email: true, source: true, intent: true,
        score: true, tags: true, temperature: true, nextActionAt: true,
        createdAt: true, updatedAt: true,
      },
    });

    // Última mudança de estágio por lead em uma query agregada (sem N+1).
    const lastMoves = await prisma.activity.groupBy({
      by: ['targetId'],
      where: { targetType: 'lead', type: 'STAGE_CHANGE' },
      _max: { createdAt: true },
    });
    const stageEnteredById = new Map(
      lastMoves.map((move) => [move.targetId, move._max.createdAt] as const),
    );

    const now = new Date();
    const shaped = leads.map((lead) => {
      const tags = tagsOf(lead.tags);
      const stage = stageFromTags(tags);
      // Fallback quando o lead nunca foi movido: updatedAt/createdAt do lead.
      const stageEnteredAt = stageEnteredById.get(lead.id) ?? lead.updatedAt ?? lead.createdAt;
      const daysInStage = daysSince(stageEnteredAt ? stageEnteredAt.toISOString() : null, now) ?? 0;
      return {
        id: lead.id,
        name: { firstName: lead.name, lastName: '' },
        stage,
        score: lead.score,
        whatsapp: { primaryPhoneNumber: lead.phone },
        email: { primaryEmail: lead.email },
        source: lead.source,
        intent: lead.intent,
        tags,
        temperature: lead.temperature,
        pipeline: valueByPrefix(tags, 'pipeline:'),
        lostReason: lostReasonFromTags(tags),
        stageEnteredAt: stageEnteredAt ? stageEnteredAt.toISOString() : null,
        daysInStage,
        isStalled: daysInStage > FOLLOWUP_THRESHOLD_DAYS && !TERMINAL_STAGES.includes(stage),
        notes: null as string | null,
        lastFollowUpAt: null as string | null,
        nextFollowUpAt: lead.nextActionAt ? lead.nextActionAt.toISOString() : null,
      };
    });

    const filtered = pipelineFilter ? shaped.filter((lead) => lead.pipeline === pipelineFilter) : shaped;
    res.json({ success: true, data: filtered });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const moveLeadRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const leadId = paramStr(req.params.id);
    const stage = req.body?.stage;
    const pipeline = req.body?.pipeline;
    const lostReason = req.body?.lostReason;
    const note = req.body?.note;

    if (!leadId) {
      jsonError(res, 400, 'leadId required');
      return;
    }
    if (typeof stage !== 'string' || !(UI_STAGES as readonly string[]).includes(stage)) {
      jsonError(res, 400, `stage must be one of: ${UI_STAGES.join(', ')}`);
      return;
    }
    if (stage === 'perdido'
      && (typeof lostReason !== 'string' || !(LOSS_REASONS as readonly string[]).includes(lostReason))) {
      jsonError(res, 400, `Mover para "perdido" exige lostReason. Valores aceitos: ${LOSS_REASONS.join(', ')}`);
      return;
    }
    if (note !== undefined && typeof note !== 'string') {
      jsonError(res, 400, 'note must be a string');
      return;
    }

    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { tags: true } });
    if (!lead) {
      jsonError(res, 404, 'Lead not found');
      return;
    }

    const currentTags = tagsOf(lead.tags);
    const fromStage = stageFromTags(currentTags);
    // Perdido: a própria tag de estágio carrega o motivo (status:perdido-<motivo>),
    // e setTagPrefix remove as status:perdido-* anteriores.
    const statusValue = stage === 'perdido' ? `perdido-${lostReason}` : stage;
    let tags = setTagPrefix(currentTags, 'status:', statusValue);
    if (typeof pipeline === 'string' && (CLINICAL_PIPELINES as readonly string[]).includes(pipeline)) {
      tags = setTagPrefix(tags, 'pipeline:', pipeline);
    }

    await prisma.lead.update({ where: { id: leadId }, data: { tags } });

    // Não polui o histórico com re-seleção do mesmo estágio; perdido sempre
    // registra (o motivo pode mudar).
    if (fromStage !== stage || stage === 'perdido') {
      await recordMoveActivity(leadId, req.userId, {
        type: 'stage_change',
        from: fromStage,
        to: stage,
        ...(stage === 'perdido' ? { lostReason: lostReason as string } : {}),
        ...(typeof note === 'string' && note.trim() ? { note: note.trim() } : {}),
        ...(req.userId ? { byUserId: req.userId } : {}),
        at: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      data: { stage, pipeline, ...(stage === 'perdido' ? { lostReason } : {}) },
    });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const updateLeadPipelineRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const leadId = paramStr(req.params.id);
    const pipeline = req.body?.pipeline;

    if (!leadId) {
      jsonError(res, 400, 'leadId required');
      return;
    }
    if (typeof pipeline !== 'string' || !(CLINICAL_PIPELINES as readonly string[]).includes(pipeline)) {
      jsonError(res, 400, `pipeline must be one of: ${CLINICAL_PIPELINES.join(', ')}`);
      return;
    }

    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { tags: true } });
    if (!lead) {
      jsonError(res, 404, 'Lead not found');
      return;
    }

    const currentTags = tagsOf(lead.tags);
    const fromPipeline = valueByPrefix(currentTags, 'pipeline:');
    const tags = setTagPrefix(currentTags, 'pipeline:', pipeline);
    await prisma.lead.update({ where: { id: leadId }, data: { tags } });

    if (fromPipeline !== pipeline) {
      await recordMoveActivity(leadId, req.userId, {
        type: 'pipeline_change',
        from: fromPipeline,
        to: pipeline,
        ...(req.userId ? { byUserId: req.userId } : {}),
        at: new Date().toISOString(),
      });
    }

    res.json({ success: true, data: { pipeline } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const getLeadHistoryRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const leadId = paramStr(req.params.id);
    if (!leadId) {
      jsonError(res, 400, 'leadId required');
      return;
    }

    const rows = await prisma.activity.findMany({
      where: {
        targetType: 'lead',
        targetId: leadId,
        type: { in: ['STAGE_CHANGE', 'PIPELINE_CHANGE'] },
      },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true } } },
    });

    const data = rows.map((row) => {
      let parsed: Partial<StageChangeEvent> = {};
      try {
        parsed = JSON.parse(row.body) as Partial<StageChangeEvent>;
      } catch {
        // body legado não-JSON: devolve o registro cru sem quebrar a lista
      }
      return {
        id: row.id,
        type: parsed.type ?? 'stage_change',
        from: parsed.from ?? null,
        to: parsed.to ?? null,
        lostReason: parsed.lostReason ?? null,
        note: parsed.note ?? null,
        byUserId: row.userId,
        byName: row.user?.name ?? null,
        at: row.createdAt.toISOString(),
      };
    });

    res.json({ success: true, data });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

// ---------------- timeline do lead ----------------

export type TimelineItem = {
  id: string;
  type: 'stage_change' | 'pipeline_change' | 'note' | 'task' | 'appointment' | 'messages' | 'suggestion';
  at: string;
  title: string;
  detail?: string;
  byName?: string | null;
};

const stageLabel = (value: string | null | undefined): string => {
  if (!value) return '—';
  if (value in STAGE_LABELS) return STAGE_LABELS[value as UiStage];
  return value;
};

const pipelineTitle = (value: string | null | undefined): string =>
  value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/-/g, ' ') : '—';

const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'Agendado',
  CONFIRMED: 'Confirmado',
  DONE: 'Realizado',
  NO_SHOW: 'Faltou',
  CANCELLED: 'Cancelado',
};

const SUGGESTION_TITLES: Record<string, string> = {
  SENT: 'Tawany enviou resposta',
  APPROVED: 'Sugestão da Tawany aprovada',
  TEST_SENT: 'Tawany respondeu em modo teste',
};

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

const formatDateTimePt = (d: Date): string =>
  d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

// União ordenada (desc) de activities, tasks, appointments, mensagens
// agregadas por dia/conversa e sugestões da Tawany. Item: {type,at,title,…}.
export const getLeadTimelineRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const leadId = paramStr(req.params.id);
    if (!leadId) {
      jsonError(res, 400, 'leadId required');
      return;
    }
    const rawLimit = Number(req.query.limit);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
    const now = new Date();
    const items: TimelineItem[] = [];

    const conversations = await prisma.conversation.findMany({ where: { leadId }, select: { id: true } });
    const conversationIds = conversations.map((c) => c.id);

    const [activities, tasks, appointments, messages, suggestions] = await Promise.all([
      prisma.activity.findMany({
        where: { targetType: 'lead', targetId: leadId, type: { in: ['STAGE_CHANGE', 'PIPELINE_CHANGE', 'NOTE'] } },
        orderBy: { createdAt: 'desc' },
        take: 300,
        include: { user: { select: { name: true } } },
      }),
      prisma.task.findMany({
        where: { leadId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, title: true, status: true, dueAt: true, createdAt: true, updatedAt: true },
      }),
      prisma.appointment.findMany({
        where: { leadId },
        orderBy: { scheduledAt: 'desc' },
        take: 100,
        select: {
          id: true, scheduledAt: true, status: true, createdAt: true,
          professional: { select: { name: true } },
        },
      }),
      conversationIds.length === 0 ? [] : prisma.chatMessage.findMany({
        where: { conversationId: { in: conversationIds } },
        orderBy: { sentAt: 'desc' },
        take: 1000,
        select: { conversationId: true, sentAt: true, direction: true, agentHandled: true },
      }),
      conversationIds.length === 0 ? [] : prisma.aiSuggestion.findMany({
        where: { conversationId: { in: conversationIds }, status: { in: ['SENT', 'APPROVED', 'TEST_SENT'] } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { approvedBy: { select: { name: true } } },
      }),
    ]);

    for (const row of activities) {
      if (row.type === 'NOTE') {
        items.push({
          id: `note-${row.id}`,
          type: 'note',
          at: row.createdAt.toISOString(),
          title: 'Nota',
          detail: truncate(row.body, 500),
          // ponytail: notas sem userId hoje só vêm da tool createActivity da
          // Tawany; humanos passam pelo POST /leads/:id/notes (com userId).
          byName: row.user?.name ?? 'Tawany',
        });
        continue;
      }
      let parsed: Partial<StageChangeEvent> = {};
      try {
        parsed = JSON.parse(row.body) as Partial<StageChangeEvent>;
      } catch { /* body legado não-JSON */ }
      const isPipeline = row.type === 'PIPELINE_CHANGE';
      items.push({
        id: `move-${row.id}`,
        type: isPipeline ? 'pipeline_change' : 'stage_change',
        at: row.createdAt.toISOString(),
        title: isPipeline
          ? `${pipelineTitle(parsed.from)} → ${pipelineTitle(parsed.to)}`
          : `${stageLabel(parsed.from)} → ${stageLabel(parsed.to)}${parsed.lostReason ? ` (motivo: ${parsed.lostReason})` : ''}`,
        ...(parsed.note ? { detail: parsed.note } : {}),
        byName: row.user?.name ?? null,
      });
    }

    for (const task of tasks) {
      items.push({ id: `task-created-${task.id}`, type: 'task', at: task.createdAt.toISOString(), title: `Tarefa criada: ${task.title}` });
      if (task.status === 'DONE') {
        items.push({ id: `task-done-${task.id}`, type: 'task', at: task.updatedAt.toISOString(), title: `Tarefa concluída: ${task.title}` });
      } else if (task.status !== 'CANCELED' && task.dueAt && task.dueAt < now) {
        items.push({ id: `task-due-${task.id}`, type: 'task', at: task.dueAt.toISOString(), title: `Tarefa venceu: ${task.title}` });
      }
    }

    for (const appt of appointments) {
      items.push({
        id: `appt-${appt.id}`,
        type: 'appointment',
        at: appt.createdAt.toISOString(),
        title: `Agendamento para ${formatDateTimePt(appt.scheduledAt)}`,
        detail: [APPOINTMENT_STATUS_LABELS[appt.status] ?? appt.status, appt.professional?.name].filter(Boolean).join(' · '),
      });
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

    for (const sug of suggestions) {
      items.push({
        id: `sug-${sug.id}`,
        type: 'suggestion',
        at: (sug.decidedAt ?? sug.createdAt).toISOString(),
        title: SUGGESTION_TITLES[sug.status] ?? `Sugestão da Tawany (${sug.status})`,
        detail: truncate(sug.body, 200),
        byName: sug.approvedBy?.name ?? null,
      });
    }

    items.sort((a, b) => b.at.localeCompare(a.at));
    res.json({ success: true, data: items.slice(0, limit) });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

// Nota manual no timeline — mesma Activity NOTE da tool createActivity da
// Tawany, mas com userId do autor.
export const createLeadNoteRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const leadId = paramStr(req.params.id);
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!leadId || !body) {
      jsonError(res, 400, 'body required');
      return;
    }
    if (body.length > 2000) {
      jsonError(res, 400, 'body must be at most 2000 characters');
      return;
    }
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
    if (!lead) {
      jsonError(res, 404, 'Lead not found');
      return;
    }
    const activity = await prisma.activity.create({
      data: {
        targetType: 'lead',
        targetId: leadId,
        type: 'NOTE',
        body,
        userId: req.userId ?? null,
      },
    });
    res.status(201).json({ success: true, data: { id: activity.id, body, at: activity.createdAt.toISOString() } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

// Montado em /api/pipeline (app.ts). Os paths de leads eram '/pipeline/leads…',
// o que gerava /api/pipeline/pipeline/leads… — e o front chama
// /api/pipeline/leads…, então tudo de leads respondia 404. Corrigido.
router.get('/pipelines', authMiddleware, getPipelinesRoute);
router.get('/pipelines/:pipeline/stages', authMiddleware, getPipelineStagesRoute);
router.get('/leads', authMiddleware, getPipelineLeadsRoute);
router.get('/leads/:id/history', authMiddleware, getLeadHistoryRoute);
router.get('/leads/:id/timeline', authMiddleware, getLeadTimelineRoute);
router.post('/leads/:id/notes', authMiddleware, createLeadNoteRoute);
router.patch('/leads/:id/move', authMiddleware, moveLeadRoute);
router.patch('/leads/:id/pipeline', authMiddleware, updateLeadPipelineRoute);

export default router;
