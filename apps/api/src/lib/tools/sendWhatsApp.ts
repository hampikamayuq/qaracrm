import { z } from 'zod';
import type { DataApi } from 'src/lib/data';
import { CircuitBreaker } from 'src/lib/resilience/circuit-breaker';
import { isMetaSendConfigured, sendViaMeta } from 'src/lib/whatsapp-client';
import { isInstagramSendConfigured, sendViaInstagram } from 'src/lib/instagram-client';
import { isEvolutionConfigured, sendEvolutionText } from 'src/lib/evolution-client';
import {
  addKommoNote,
  isKommoReplyConfigured,
  kommoBreaker,
  runKommoSalesbot,
  updateKommoLeadTextField,
} from 'src/lib/kommo-client';
import { randomUUID } from 'node:crypto';
import { sendViaWeb } from 'src/lib/web-chat-send';

export const metaGraphBreaker = new CircuitBreaker('meta-graph', {
  threshold: 5,
  cooldownMs: 30_000,
});

export const igGraphBreaker = new CircuitBreaker('ig-graph', {
  threshold: 5,
  cooldownMs: 30_000,
});

export const evolutionBreaker = new CircuitBreaker('evolution', {
  threshold: 5,
  cooldownMs: 30_000,
});

export const webBreaker = new CircuitBreaker('web-chat', {
  threshold: 5,
  cooldownMs: 30_000,
});

const sendWindows = new Map<string, { startedAt: number; count: number }>();
const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value.replaceAll('_', ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const resetSendWhatsAppRateLimit = (): void => {
  sendWindows.clear();
};

const assertSendRateLimit = (conversationId: string): void => {
  const max = parsePositiveInt(process.env.SEND_WHATSAPP_RATE_LIMIT_PER_MINUTE, 30);
  const now = Date.now();
  const existing = sendWindows.get(conversationId);
  if (!existing || now - existing.startedAt >= 60_000) {
    sendWindows.set(conversationId, { startedAt: now, count: 1 });
    return;
  }
  if (existing.count >= max) {
    throw new Error('rate_limited:sendWhatsApp');
  }
  existing.count++;
};

export const sendWhatsApp = {
  name: 'sendWhatsApp',
  description: 'Envia mensagem WhatsApp para uma conversa via Meta Cloud API.',
  parameters: z.object({
    conversationId: z.string().uuid(),
    text: z.string().min(1).max(1024),
  }),
  execute: async (args: { conversationId: string; text: string }, ctx: DataApi & { testMode?: boolean }): Promise<string> => {
    const conv = await ctx.get('conversation', args.conversationId, {
      id: true,
      channel: true,
      externalId: true,
      instanceId: true,
      leadId: true,
    });
    if (!conv) return JSON.stringify({ ok: false, error: 'conversation_not_found' });

    // externalId da conversa = destino externo: telefone (WhatsApp) ou PSID/IGSID
    // (Instagram Direct), gravado no ingest do webhook a partir do sender.id.
    const to = typeof conv.externalId === 'string' ? conv.externalId : '';
    const channel = typeof conv.channel === 'string' ? conv.channel : '';
    assertSendRateLimit(args.conversationId);

    // In test mode, never send to Meta - just record in CRM
    const isTestMode = ctx.testMode === true;
    // Despacha por canal: WhatsApp via Cloud API, Instagram via Graph API,
    // número QR via gateway Evolution (instância da conversa), WEB via SSE.
    // externalId aqui = id externo da entrega (wamid/psid). No canal WEB não há
    // gateway externo: geramos um UUID para o ChatMessage e o push SSE é feito
    // após a persistência (precisa do messageId).
    let externalId: string | null = null;
    if (!isTestMode && channel === 'WEB') {
      externalId = randomUUID();
    } else if (!isTestMode && to.length > 0) {
      if (channel === 'WHATSAPP' && isMetaSendConfigured()) {
        externalId = await metaGraphBreaker.execute(() => sendViaMeta(to, args.text));
      } else if (channel === 'INSTAGRAM' && isInstagramSendConfigured()) {
        externalId = await igGraphBreaker.execute(() => sendViaInstagram(to, args.text));
      } else if (channel === 'WHATSAPP_QR') {
        // Sem instância conectada não há como entregar: erro claro para o
        // Inbox, sem gravar mensagem fantasma no histórico.
        const instanceId = typeof conv.instanceId === 'string' ? conv.instanceId : '';
        const instance = instanceId
          ? await ctx.get('whatsAppInstance', instanceId, { id: true, instanceName: true, status: true })
          : null;
        if (!instance || instance.status !== 'CONNECTED' || !isEvolutionConfigured()) {
          return JSON.stringify({ ok: false, error: 'instance_disconnected' });
        }
        externalId = await evolutionBreaker.execute(() =>
          sendEvolutionText(instance.instanceName as string, to, args.text),
        );
      } else if (channel === 'KOMMO') {
        // Canal Kommo: a entrega é indireta — grava a resposta num custom
        // field do lead no Kommo e dispara o salesbot de resposta, que faz o
        // `show` do campo no chat do cliente (único caminho suportado para
        // integração externa responder em canal nativo do Kommo). Sem config
        // ou sem vínculo, erro claro e nada de mensagem fantasma.
        if (!isKommoReplyConfigured()) {
          return JSON.stringify({ ok: false, error: 'kommo_send_not_configured' });
        }
        const leadId = typeof conv.leadId === 'string' ? conv.leadId : '';
        const lead = leadId ? await ctx.get('lead', leadId, { id: true, kommoLeadId: true }) : null;
        const kommoLeadId = typeof lead?.kommoLeadId === 'string' ? lead.kommoLeadId : '';
        if (!kommoLeadId) {
          return JSON.stringify({ ok: false, error: 'kommo_lead_not_linked' });
        }
        await kommoBreaker.execute(async () => {
          await updateKommoLeadTextField(kommoLeadId, process.env.KOMMO_REPLY_FIELD_ID as string, args.text);
          await runKommoSalesbot(process.env.KOMMO_REPLY_BOT_ID as string, kommoLeadId);
        });
        // Não há id externo de mensagem no run do salesbot: id sintético, como
        // no canal WEB. O echo outgoing do webhook do Kommo dedupa pelo id real.
        externalId = `kommo-out:${randomUUID()}`;
        if (process.env.KOMMO_AUDIT_NOTES === 'true') {
          void addKommoNote(kommoLeadId, `QARA/Tawany respondeu: ${args.text}`)
            .catch((err) => console.error('[sendWhatsApp] kommo note failed (non-fatal):', (err as Error).message));
        }
      }
    }

    const sentAt = new Date().toISOString();
    const message = await ctx.create('chatMessage', {
      body: args.text,
      direction: 'OUT',
      sentAt,
      conversationId: args.conversationId,
      messageType: 'TEXT',
      deliveryStatus: externalId ? 'SENT' : (isTestMode ? 'TEST_MODE' : 'PENDING'),
      agentHandled: true,
      ...(externalId ? { externalId } : {}),
    });

    // Canal WEB: empurra a resposta OUT no SSE da sessão do visitante. Sem
    // listener conectado o push retorna 0 e NÃO lança — a mensagem já está
    // persistida e o widget rebusca ao reconectar. O breaker protege o push
    // por simetria com os outros canais (aqui é in-memory, então raramente abre).
    if (!isTestMode && channel === 'WEB') {
      try {
        await webBreaker.execute(async () =>
          sendViaWeb(to, args.text, typeof message.id === 'string' ? message.id : '', sentAt),
        );
      } catch (err) {
        console.error('[sendWhatsApp] web push failed (non-fatal):', (err as Error).message);
      }
    }

    await ctx.update('conversation', args.conversationId, { lastMessageAt: sentAt });
    return JSON.stringify({ ok: true, sent: Boolean(externalId), messageId: message.id, testMode: isTestMode });
  },
};
