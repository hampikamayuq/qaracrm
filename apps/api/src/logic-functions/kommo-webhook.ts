import type { DataApi } from '../lib/data';
import { runBotsForInbound } from '../lib/bots/runner';
import { defaultDebounce, type Debouncer } from '../lib/debounce';
import { emitInboundMessage } from '../lib/events';
import { getKommoContact, getKommoLead, isKommoConfigured, kommoBreaker } from '../lib/kommo-client';
import {
  parseKommoSalesbotHook,
  parseKommoStageMap,
  parseKommoWebhook,
  stageForKommoStatus,
  type KommoLeadUpsert,
  type KommoMessage,
  type KommoStatusChange,
} from '../lib/kommo-parse';
import { candidatePhonesBR, normalizePhoneBRDigits } from '../lib/phone-br';
import {
  CLINICAL_PIPELINES,
  setTagPrefix,
  stageFromTags,
  tagsOf,
  UI_STAGES,
} from '../routes/pipeline-routes';

// Pipeline do canal KOMMO (mensagens/leads que entram pelo Kommo, ex-amoCRM).
// Mesmo fluxo dos demais canais de entrada: debounce → bots → Tawany. A
// resposta NÃO sai por aqui — sai pelo branch KOMMO do sendWhatsApp (custom
// field + salesbot). Mensagens outgoing do Kommo (humano ou bot de lá) são
// espelhadas como OUT com human-takeover, para a Tawany não atropelar.

export type ProcessedMessageHandler = (message: {
  conversationId: string;
  messageId: string;
}) => Promise<void>;

export type KommoWebhookResult = {
  messages: number;
  leads: number;
  statusChanges: number;
  processedMessages: Array<{ conversationId: string; messageId: string }>;
};

export type KommoLinkedLead = { id: string; tags: string[] };
type LeadRecord = KommoLinkedLead;

const leadRecordOf = (raw: Record<string, unknown>): LeadRecord => ({
  id: raw.id as string,
  tags: tagsOf(raw.tags),
});

export const findLeadByKommoId = async (kommoLeadId: string, data: DataApi): Promise<LeadRecord | null> => {
  const found = await data.list('lead', {
    filter: { kommoLeadId: { eq: kommoLeadId } },
    limit: 1,
    select: { id: true, tags: true },
  });
  return found[0] ? leadRecordOf(found[0]) : null;
};

const findLeadByPhone = async (phone: string, data: DataApi): Promise<LeadRecord | null> => {
  for (const candidate of candidatePhonesBR(phone)) {
    const found = await data.list('lead', {
      filter: { phone: { eq: candidate } },
      limit: 1,
      select: { id: true, tags: true },
    });
    if (found[0]) return leadRecordOf(found[0]);
  }
  return null;
};

// Enriquecimento best-effort via API do Kommo (nome/telefone/email do contato
// principal). Nunca segura o ingest: sem config ou com API fora, segue com o
// que veio no webhook.
type KommoEnrichment = { name: string; phone: string | null; email: string | null };

const enrichFromKommo = async (kommoLeadId: string): Promise<KommoEnrichment | null> => {
  if (!isKommoConfigured()) return null;
  try {
    return await kommoBreaker.execute(async () => {
      const lead = await getKommoLead(kommoLeadId);
      if (!lead) return null;
      const contact = lead.mainContactId ? await getKommoContact(lead.mainContactId) : null;
      return {
        name: contact?.name || lead.name,
        phone: contact?.phone ?? null,
        email: contact?.email ?? null,
      };
    });
  } catch (err) {
    console.error('[kommo-webhook] enrichment failed (non-fatal):', (err as Error).message);
    return null;
  }
};

const defaultPipelineTag = (): string | null => {
  const value = process.env.KOMMO_DEFAULT_PIPELINE ?? '';
  return (CLINICAL_PIPELINES as readonly string[]).includes(value) ? value : null;
};

const initialTags = (): string[] => {
  const withStage = setTagPrefix([], 'status:', 'novo-lead');
  const pipeline = defaultPipelineTag();
  return pipeline ? setTagPrefix(withStage, 'pipeline:', pipeline) : withStage;
};

const createKommoLead = async (
  data: DataApi,
  params: { kommoLeadId: string | null; name: string; phone: string | null; email: string | null },
): Promise<LeadRecord> => {
  const tags = initialTags();
  const phone = params.phone ? normalizePhoneBRDigits(params.phone) : null;
  const created = await data.create('lead', {
    name: params.name || params.phone || `Lead Kommo ${params.kommoLeadId ?? ''}`.trim(),
    ...(phone ? { phone } : {}),
    ...(params.email ? { email: params.email } : {}),
    source: 'KOMMO',
    ...(params.kommoLeadId ? { kommoLeadId: params.kommoLeadId } : {}),
    tags,
  });
  return { id: created.id as string, tags };
};

// Resolve o Lead do QARA para um lead do Kommo: 1º vínculo direto
// (kommoLeadId), 2º telefone (lead que já existe de outro canal — backfilla o
// vínculo), senão cria.
const resolveLead = async (
  data: DataApi,
  params: { kommoLeadId: string | null; name?: string; phone?: string | null },
): Promise<LeadRecord> => {
  if (params.kommoLeadId) {
    const linked = await findLeadByKommoId(params.kommoLeadId, data);
    if (linked) return linked;
  }

  const enriched = params.kommoLeadId ? await enrichFromKommo(params.kommoLeadId) : null;
  const name = enriched?.name || params.name || '';
  const phone = enriched?.phone ?? params.phone ?? null;

  if (phone) {
    const byPhone = await findLeadByPhone(phone, data);
    if (byPhone) {
      if (params.kommoLeadId) {
        await data.update('lead', byPhone.id, { kommoLeadId: params.kommoLeadId });
      }
      return byPhone;
    }
  }

  return createKommoLead(data, {
    kommoLeadId: params.kommoLeadId,
    name,
    phone,
    email: enriched?.email ?? null,
  });
};

const recordActivity = async (
  data: DataApi,
  leadId: string,
  type: 'STAGE_CHANGE' | 'NOTE',
  body: Record<string, unknown>,
): Promise<void> => {
  await data.create('activity', {
    targetType: 'lead',
    targetId: leadId,
    type,
    body: JSON.stringify(body),
  });
};

// Mapeia status/pipeline do Kommo para a tag de estágio canônica e grava o
// mesmo Activity STAGE_CHANGE do kanban (routes/pipeline-routes) — sem tabela
// nova de histórico. Estágio não mapeado no KOMMO_STAGE_MAP não move o lead:
// vira só uma nota de auditoria.
export const applyKommoStage = async (
  data: DataApi,
  lead: LeadRecord,
  statusId: string | null,
  pipelineId: string | null,
): Promise<boolean> => {
  if (!statusId) return false; // evento sem estágio (ex.: lead add magro) — nada a mapear
  const map = parseKommoStageMap(process.env.KOMMO_STAGE_MAP);
  const mapped = stageForKommoStatus(map, pipelineId, statusId);
  const isValidStage = mapped !== null &&
    ((UI_STAGES as readonly string[]).includes(mapped) || mapped.startsWith('perdido-'));

  if (!isValidStage) {
    await recordActivity(data, lead.id, 'NOTE', {
      type: 'note',
      note: `Kommo: estágio alterado (pipeline ${pipelineId ?? '?'}, status ${statusId ?? '?'}) — sem mapeamento no KOMMO_STAGE_MAP`,
      at: new Date().toISOString(),
    });
    return false;
  }

  const from = stageFromTags(lead.tags);
  if (from === stageFromTags(setTagPrefix([], 'status:', mapped))) return false;

  const tags = setTagPrefix(lead.tags, 'status:', mapped);
  await data.update('lead', lead.id, { tags });
  lead.tags = tags;
  await recordActivity(data, lead.id, 'STAGE_CHANGE', {
    type: 'stage_change',
    from,
    to: mapped,
    note: 'kommo',
    at: new Date().toISOString(),
  });
  console.log(JSON.stringify({ event: 'kommo_stage_change', leadId: lead.id, from, to: mapped }));
  return true;
};

const applyLeadUpsert = async (event: KommoLeadUpsert, data: DataApi): Promise<void> => {
  const lead = await resolveLead(data, { kommoLeadId: event.kommoLeadId, name: event.name });
  if (event.price !== null) {
    await data.update('lead', lead.id, { estimatedValue: event.price });
  }
  await applyKommoStage(data, lead, event.statusId, event.pipelineId);
};

const applyStatusChange = async (event: KommoStatusChange, data: DataApi): Promise<void> => {
  const lead = await resolveLead(data, { kommoLeadId: event.kommoLeadId });
  await applyKommoStage(data, lead, event.statusId, event.pipelineId);
};

const findOrCreateConversation = async (
  msg: KommoMessage,
  data: DataApi,
): Promise<{ id: string; leadId?: string | null; status?: string | null }> => {
  const existing = await data.list('conversation', {
    filter: { channel: { eq: 'KOMMO' }, externalId: { eq: msg.chatId } },
    limit: 1,
    select: { id: true, leadId: true, status: true },
  });
  if (existing[0]) {
    return {
      id: existing[0].id as string,
      leadId: existing[0].leadId as string | null | undefined,
      status: existing[0].status as string | null | undefined,
    };
  }
  const lead = await resolveLead(data, {
    kommoLeadId: msg.kommoLeadId,
    name: msg.contactName,
    phone: msg.contactPhone,
  });
  const created = await data.create('conversation', {
    leadId: lead.id,
    channel: 'KOMMO',
    externalId: msg.chatId,
    status: 'OPEN',
    lastMessageAt: msg.sentAt,
  });
  return { id: created.id as string, leadId: lead.id, status: 'OPEN' };
};

const ingestMessage = async (
  msg: KommoMessage,
  data: DataApi,
  debounce: Debouncer,
  onProcessedMessage?: ProcessedMessageHandler,
): Promise<{ counted: boolean; processed: { conversationId: string; messageId: string } | null }> => {
  const dup = await data.list('chatMessage', {
    filter: { externalId: { eq: msg.externalId } },
    limit: 1,
    select: { id: true },
  });
  // Retry do webhook do Kommo (sem HMAC/assinatura) — dedup por id da mensagem.
  if (dup.length > 0) return { counted: false, processed: null };

  const conversation = await findOrCreateConversation(msg, data);
  const closed = conversation.status === 'RESOLVED' || conversation.status === 'CLOSED';

  if (msg.direction === 'OUT') {
    // Eco da própria resposta do QARA: o envio via salesbot grava o OUT com id
    // sintético (kommo-out:*), e o webhook devolve a mesma mensagem como
    // outgoing com o id real do Kommo — dedup por corpo idêntico recente.
    const recentOut = await data.list('chatMessage', {
      filter: { conversationId: { eq: conversation.id }, direction: { eq: 'OUT' }, body: { eq: msg.text } },
      orderBy: { sentAt: 'DESC' },
      limit: 1,
      select: { id: true, sentAt: true },
    });
    const recentSentAt = recentOut[0]?.sentAt;
    const recentMs = recentSentAt instanceof Date
      ? recentSentAt.getTime()
      : typeof recentSentAt === 'string' ? Date.parse(recentSentAt) : Number.NaN;
    if (Number.isFinite(recentMs) && Math.abs(Date.parse(msg.sentAt) - recentMs) < 10 * 60_000) {
      return { counted: false, processed: null };
    }
    // Humano ou bot do próprio Kommo respondeu por lá: espelha como OUT e
    // marca humano-assumiu — a Tawany não disputa a conversa com o Kommo.
    await data.create('chatMessage', {
      conversationId: conversation.id,
      direction: 'OUT',
      body: msg.text,
      sentAt: msg.sentAt,
      externalId: msg.externalId,
      messageType: 'TEXT',
      deliveryStatus: 'SENT',
      agentHandled: true,
    });
    await data.update('conversation', conversation.id, {
      lastMessageAt: msg.sentAt,
      ...(closed ? {} : { needsHuman: false, status: 'PENDING_PATIENT' }),
    });
    console.log(JSON.stringify({ event: 'kommo_echo', conversationId: conversation.id, messageId: msg.externalId }));
    return { counted: true, processed: null };
  }

  const optout = debounce.isOptOut(msg.text);
  const immediateGate = !onProcessedMessage && !optout
    ? debounce.check(conversation.id, msg.externalId, msg.text)
    : null;

  // Mesmo espelho dos outros canais: a mensagem nasce agentHandled até o
  // debounce liberar (o processReadyMessage remarca como false).
  const created = await data.create('chatMessage', {
    conversationId: conversation.id,
    direction: 'IN',
    body: msg.text,
    sentAt: msg.sentAt,
    externalId: msg.externalId,
    messageType: 'TEXT',
    agentHandled: Boolean(onProcessedMessage) || optout || immediateGate?.status !== 'process',
  });
  const messageId = typeof created.id === 'string' ? created.id : '';

  emitInboundMessage({
    conversationId: conversation.id,
    leadName: msg.contactName || msg.authorName || undefined,
    preview: msg.text,
  });

  if (optout) {
    await data.update('conversation', conversation.id, {
      lastMessageAt: msg.sentAt,
      needsHuman: true,
      status: 'PENDING_HUMAN',
      handoffReason: 'opt_out_detected',
    });
    if (typeof conversation.leadId === 'string' && conversation.leadId) {
      await data.update('lead', conversation.leadId, { optedOut: true, optedOutAt: new Date() });
      console.log(JSON.stringify({ event: 'kommo_optout', conversationId: conversation.id, messageId: msg.externalId }));
    }
    return { counted: true, processed: null };
  }

  await data.update('conversation', conversation.id, { lastMessageAt: msg.sentAt });

  const processReadyMessage = async (ready: { conversationId: string; messageId: string; text: string }): Promise<void> => {
    await data.update('chatMessage', ready.messageId, { agentHandled: false });
    let handled = false;
    try {
      handled = (await runBotsForInbound({ conversationId: ready.conversationId, text: ready.text }, data))?.handled ?? false;
    } catch (err) {
      console.error('[kommo-webhook] bot runner failed (non-fatal):', (err as Error).message);
    }
    if (!handled) {
      await onProcessedMessage?.({ conversationId: ready.conversationId, messageId: ready.messageId });
    }
  };

  const gate = immediateGate ?? debounce.check(
    conversation.id,
    messageId || msg.externalId,
    msg.text,
    processReadyMessage,
  );

  console.log(JSON.stringify({ event: 'kommo_inbound', conversationId: conversation.id, messageId: msg.externalId, gate: gate.status }));
  if (gate.status !== 'process') return { counted: true, processed: null };
  return {
    counted: true,
    processed: messageId ? { conversationId: conversation.id, messageId } : null,
  };
};

const runInboundBots = async (
  processed: { conversationId: string; messageId: string },
  text: string,
  data: DataApi,
): Promise<boolean> => {
  try {
    return (await runBotsForInbound({ conversationId: processed.conversationId, text }, data))?.handled ?? false;
  } catch (err) {
    console.error('[kommo-webhook] bot runner failed (non-fatal):', (err as Error).message);
    return false;
  }
};

export const handleKommoWebhook = async (
  body: unknown,
  data: DataApi,
  debounce: Debouncer = defaultDebounce,
  onProcessedMessage?: ProcessedMessageHandler,
): Promise<KommoWebhookResult> => {
  const events = parseKommoWebhook(body);
  let messages = 0;
  let leads = 0;
  let statusChanges = 0;
  const processedMessages: KommoWebhookResult['processedMessages'] = [];

  for (const event of events) {
    if (event.kind === 'lead') {
      await applyLeadUpsert(event, data);
      leads++;
    } else if (event.kind === 'status') {
      await applyStatusChange(event, data);
      statusChanges++;
    } else {
      const result = await ingestMessage(event, data, debounce, onProcessedMessage);
      if (result.counted) messages++;
      if (result.processed) {
        // Caminho imediato (gate 'process'): bots antes da Tawany, espelhando
        // o processReadyMessage — mesmo desenho do evolution-webhook.
        const handled = await runInboundBots(result.processed, event.text, data);
        if (!handled) processedMessages.push(result.processed);
      }
    }
  }

  console.log(JSON.stringify({ event: 'kommo_webhook', messages, leads, statusChanges }));
  return { messages, leads, statusChanges, processedMessages };
};

// Hook do salesbot (widget_request): um POST = uma mensagem do paciente. O
// corpo é JSON com shape definido na configuração do passo (ver docs).
export const handleKommoSalesbotHook = async (
  body: unknown,
  data: DataApi,
  debounce: Debouncer = defaultDebounce,
  onProcessedMessage?: ProcessedMessageHandler,
): Promise<KommoWebhookResult> => {
  const msg = parseKommoSalesbotHook(body);
  if (!msg) return { messages: 0, leads: 0, statusChanges: 0, processedMessages: [] };

  const processedMessages: KommoWebhookResult['processedMessages'] = [];
  const result = await ingestMessage(msg, data, debounce, onProcessedMessage);
  if (result.processed) {
    const handled = await runInboundBots(result.processed, msg.text, data);
    if (!handled) processedMessages.push(result.processed);
  }

  console.log(JSON.stringify({ event: 'kommo_salesbot_hook', messages: result.counted ? 1 : 0 }));
  return { messages: result.counted ? 1 : 0, leads: 0, statusChanges: 0, processedMessages };
};
