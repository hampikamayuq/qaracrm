import type { DataApi } from './data';
import { HSM_REACTIVATION_TEMPLATE } from './templates/hsm-messages';
import { sendWhatsAppTemplate } from './tools/sendWhatsAppTemplate';
import { setTagPrefix, stageFromTags, tagsOf } from 'src/routes/pipeline-routes';

// Lote 2.3 do plano — reativação de perdidos:
// lead com `status:perdido-sem-resposta` há 30/60 dias, sem opt-out, recebe o
// template HSM de reativação NO MÁXIMO 1x por janela (tag `reativacao:30d` /
// `reativacao:60d` marca a janela já usada). Quando o paciente responde, o
// ingest do webhook reabre o lead no pipeline `reativacao` (ver
// maybeReopenReactivatedLead). Gate: ENABLE_REACTIVATION, default false — o
// template precisa estar aprovado na Meta antes de ligar.

const LOST_NO_RESPONSE_TAG = 'status:perdido-sem-resposta';

// 60d primeiro: lead que entra no backlog já com 60+ dias recebe UMA mensagem
// (a da janela maior), não duas.
const REACTIVATION_WINDOWS = [
  { days: 60, tag: 'reativacao:60d' },
  { days: 30, tag: 'reativacao:30d' },
] as const;

const reactivationEnabled = (): boolean => process.env.ENABLE_REACTIVATION === 'true';
const reactivationTemplateName = (): string =>
  process.env.REACTIVATION_TEMPLATE || HSM_REACTIVATION_TEMPLATE;

// Quando o lead virou "perdido": último STAGE_CHANGE com to='perdido' no
// histórico (modelo Activity, mesmo registro do kanban). Sem registro (lead
// marcado por outro caminho), cai para updatedAt — conservador: qualquer toque
// no lead "rejuvenesce" e adia a reativação, nunca antecipa.
const lostSince = async (data: DataApi, leadId: string, fallback: Date): Promise<Date> => {
  const activities = await data.list('activity', {
    filter: { targetType: { eq: 'lead' }, targetId: { eq: leadId }, type: { eq: 'STAGE_CHANGE' } },
    orderBy: { createdAt: 'DESC' },
    limit: 10,
    select: { body: true, createdAt: true },
  });
  for (const activity of activities) {
    try {
      const event = JSON.parse(typeof activity.body === 'string' ? activity.body : '{}') as { to?: string };
      if (event.to === 'perdido') {
        const at = activity.createdAt;
        if (at instanceof Date) return at;
        if (typeof at === 'string') return new Date(at);
      }
    } catch {
      // body não estruturado — ignora e segue para a próxima atividade
    }
  }
  return fallback;
};

const dueWindow = (
  tags: string[],
  lostAt: Date,
  now: Date,
): (typeof REACTIVATION_WINDOWS)[number] | null => {
  const ageDays = (now.getTime() - lostAt.getTime()) / 86_400_000;
  for (const window of REACTIVATION_WINDOWS) {
    if (ageDays >= window.days && !tags.includes(window.tag)) return window;
  }
  return null;
};

export const runReactivationJob = async (
  data: DataApi,
  now = new Date(),
): Promise<{ checked: number; sent: number }> => {
  if (!reactivationEnabled()) return { checked: 0, sent: 0 };

  const leads = await data.list('lead', {
    filter: {
      optedOut: { eq: false },
      tags: { array_contains: [LOST_NO_RESPONSE_TAG] },
    },
    select: { id: true, name: true, tags: true, updatedAt: true },
  });
  let sent = 0;
  const templateName = reactivationTemplateName();

  for (const lead of leads) {
    const leadId = typeof lead.id === 'string' ? lead.id : '';
    if (!leadId) continue;
    const tags = tagsOf(lead.tags);
    // Janela 60d já usada = ciclo de reativação encerrado para este lead.
    if (tags.includes('reativacao:60d')) continue;

    const fallback = lead.updatedAt instanceof Date
      ? lead.updatedAt
      : new Date(typeof lead.updatedAt === 'string' ? lead.updatedAt : now.toISOString());
    const lostAt = await lostSince(data, leadId, fallback);
    const window = dueWindow(tags, lostAt, now);
    if (!window) continue;

    const conversations = await data.list('conversation', {
      filter: { leadId: { eq: leadId } },
      limit: 1,
      select: { id: true, channel: true },
    });
    const conversation = conversations[0];
    const conversationId = typeof conversation?.id === 'string' ? conversation.id : '';
    if (!conversationId) continue;
    // Templates HSM são só WhatsApp: pula Instagram e WEB sem enviar nem marcar
    // a janela (mesmo motivo do D-1, follow-up 48h e NPS). No WEB a ponte
    // WhatsApp é Fase 2 (pelo telefone do lead), nunca template na conversa WEB.
    // (QR mantém o comportamento atual — ver nota de reativação-fantasma no QR.)
    if (conversation?.channel === 'INSTAGRAM' || conversation?.channel === 'WEB') continue;

    const name = typeof lead.name === 'string' ? lead.name : '';
    await sendWhatsAppTemplate.execute({
      conversationId,
      templateName,
      language: 'pt_BR',
      parameters: name ? [name] : [],
    }, data);
    await data.update('lead', leadId, { tags: [...tags, window.tag] });
    // Registro no feed/histórico — também é a fonte para a métrica de
    // reativação no dashboard (contagem por type=REACTIVATION).
    await data.create('activity', {
      targetType: 'lead',
      targetId: leadId,
      type: 'REACTIVATION',
      body: JSON.stringify({ type: 'reactivation_sent', window: window.tag, at: now.toISOString() }),
    });
    sent++;
  }

  console.log(JSON.stringify({ event: 'scheduler_reactivation', checked: leads.length, sent }));
  return { checked: leads.length, sent };
};

// Chamado pelo ingest de mensagem inbound: se o lead está perdido e já recebeu
// uma mensagem de reativação (tag reativacao:*), a resposta dele reabre o
// funil no pipeline `reativacao` com estágio novo-lead — e a Tawany/equipe
// seguem o fluxo normal a partir daí.
export const maybeReopenReactivatedLead = async (
  leadId: string,
  data: DataApi,
): Promise<boolean> => {
  const lead = await data.get('lead', leadId, { id: true, tags: true });
  if (!lead) return false;
  const tags = tagsOf(lead.tags);
  if (stageFromTags(tags) !== 'perdido') return false;
  if (!tags.some((t) => t.startsWith('reativacao:'))) return false;

  let updated = setTagPrefix(tags, 'status:', 'novo-lead');
  updated = setTagPrefix(updated, 'pipeline:', 'reativacao');
  await data.update('lead', leadId, { tags: updated });
  await data.create('activity', {
    targetType: 'lead',
    targetId: leadId,
    type: 'STAGE_CHANGE',
    body: JSON.stringify({
      type: 'stage_change',
      from: 'perdido',
      to: 'novo-lead',
      note: 'Reativação: paciente respondeu à mensagem de reativação',
      at: new Date().toISOString(),
    }),
  });
  console.log(JSON.stringify({ event: 'reactivation_reopened', leadId }));
  return true;
};
