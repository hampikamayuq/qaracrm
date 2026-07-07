import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/deps';
import { authMiddleware } from '../middleware/auth-middleware';
import { STAGE_LABELS, type UiStage } from './pipeline-routes';

const router = Router();

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

export type FeedItem = {
  id: string;
  type: 'stage_change' | 'pipeline_change' | 'note' | 'bot' | 'suggestion' | 'appointment';
  at: string;
  title: string;
  detail?: string;
  byName?: string | null;
};

const PERIODS: Record<string, number> = { '24h': 24 * 3600_000, '7d': 7 * 24 * 3600_000 };
const FEED_LIMIT = 100;

const stageLabel = (value: string | null | undefined): string => {
  if (!value) return '—';
  if (value in STAGE_LABELS) return STAGE_LABELS[value as UiStage];
  return value;
};

const pipelineTitle = (value: string | null | undefined): string =>
  value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/-/g, ' ') : '—';

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const formatDateTimePt = (d: Date): string =>
  d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

type MoveEvent = { from?: string | null; to?: string | null; lostReason?: string; note?: string };

// Feed da operação inteira: movimentos de estágio/pipeline, notas, bots
// salvos, sugestões da Tawany aprovadas e agendamentos criados no período.
export const getActivityFeedRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const period = typeof req.query.period === 'string' && req.query.period in PERIODS ? req.query.period : '24h';
    const since = new Date(Date.now() - PERIODS[period]);
    const items: FeedItem[] = [];

    const [activities, suggestions, appointments] = await Promise.all([
      prisma.activity.findMany({
        where: {
          createdAt: { gte: since },
          type: { in: ['STAGE_CHANGE', 'PIPELINE_CHANGE', 'NOTE', 'BOT_VERSION'] },
        },
        orderBy: { createdAt: 'desc' },
        take: FEED_LIMIT,
        include: { user: { select: { name: true } } },
      }),
      prisma.aiSuggestion.findMany({
        where: { decidedAt: { gte: since }, status: { in: ['APPROVED', 'SENT'] }, approvedById: { not: null } },
        orderBy: { decidedAt: 'desc' },
        take: FEED_LIMIT,
        include: {
          approvedBy: { select: { name: true } },
          conversation: { select: { lead: { select: { name: true } } } },
        },
      }),
      prisma.appointment.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: FEED_LIMIT,
        select: {
          id: true, createdAt: true, scheduledAt: true,
          lead: { select: { name: true } },
          patient: { select: { name: true } },
          professional: { select: { name: true } },
        },
      }),
    ]);

    // Nome dos leads-alvo em uma query só (sem N+1).
    const leadIds = [...new Set(
      activities.filter((a) => a.targetType === 'lead').map((a) => a.targetId),
    )];
    const leads = leadIds.length === 0 ? [] : await prisma.lead.findMany({
      where: { id: { in: leadIds } },
      select: { id: true, name: true },
    });
    const leadNameById = new Map(leads.map((l) => [l.id, l.name]));

    for (const row of activities) {
      const leadName = row.targetType === 'lead' ? leadNameById.get(row.targetId) ?? 'Lead' : null;
      if (row.type === 'BOT_VERSION') {
        items.push({
          id: `bot-${row.id}`,
          type: 'bot',
          at: row.createdAt.toISOString(),
          title: row.title ?? 'Bot salvo',
          byName: row.user?.name ?? null,
        });
        continue;
      }
      if (row.type === 'NOTE') {
        items.push({
          id: `note-${row.id}`,
          type: 'note',
          at: row.createdAt.toISOString(),
          title: leadName ? `Nota em ${leadName}` : 'Nota',
          detail: truncate(row.body, 200),
          byName: row.user?.name ?? 'Tawany',
        });
        continue;
      }
      let parsed: MoveEvent = {};
      try {
        parsed = JSON.parse(row.body) as MoveEvent;
      } catch { /* body legado não-JSON */ }
      const isPipeline = row.type === 'PIPELINE_CHANGE';
      items.push({
        id: `move-${row.id}`,
        type: isPipeline ? 'pipeline_change' : 'stage_change',
        at: row.createdAt.toISOString(),
        title: isPipeline
          ? `${leadName ?? 'Lead'}: ${pipelineTitle(parsed.from)} → ${pipelineTitle(parsed.to)}`
          : `${leadName ?? 'Lead'}: ${stageLabel(parsed.from)} → ${stageLabel(parsed.to)}${parsed.lostReason ? ` (motivo: ${parsed.lostReason})` : ''}`,
        ...(parsed.note ? { detail: parsed.note } : {}),
        byName: row.user?.name ?? null,
      });
    }

    for (const sug of suggestions) {
      items.push({
        id: `sug-${sug.id}`,
        type: 'suggestion',
        at: (sug.decidedAt ?? sug.createdAt).toISOString(),
        title: `Sugestão da Tawany aprovada${sug.conversation?.lead?.name ? ` — ${sug.conversation.lead.name}` : ''}`,
        detail: truncate(sug.body, 200),
        byName: sug.approvedBy?.name ?? null,
      });
    }

    for (const appt of appointments) {
      const who = appt.patient?.name ?? appt.lead?.name ?? 'Paciente';
      items.push({
        id: `appt-${appt.id}`,
        type: 'appointment',
        at: appt.createdAt.toISOString(),
        title: `Agendamento criado: ${who} — ${formatDateTimePt(appt.scheduledAt)}`,
        ...(appt.professional?.name ? { detail: appt.professional.name } : {}),
      });
    }

    items.sort((a, b) => b.at.localeCompare(a.at));
    res.json({ success: true, data: items.slice(0, FEED_LIMIT) });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

router.get('/feed', authMiddleware, (req, res) => void getActivityFeedRoute(req, res));

export default router;
