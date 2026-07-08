// Teste de integração ponta a ponta do fluxo de produção:
// banco Postgres REAL (qara-crm-test) + OpenRouter mockado (createAiClient).
//
// Fluxo A — mensagem nova via webhook Meta → Tawany sugere (SHADOW_MODE=human_approval)
//           → humano aprova → OUT registrada (Meta não configurada, sem envio real).
// Fluxo B — resposta da IA com preço inventado → reply-validator bloqueia → handoff
//           → devolver-tawany reabre a conversa.
// Fluxo C — timeline do lead agrega mensagens e sugestão enviada.
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

// Estado mutável do mock: cada fluxo troca a resposta que a "IA" devolve.
const aiMock = vi.hoisted(() => {
  const state = { reply: 'Olá! Posso te ajudar a agendar uma consulta?' };
  const createAiClient = () => ({
    chat: async () => ({
      content: state.reply,
      finishReason: 'stop' as const,
      toolCalls: [] as never[],
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      modelUsed: 'mock/tawany-integration',
      fallbackUsed: false,
    }),
  });
  return { state, createAiClient };
});

// O módulo é importado por dois especificadores no código real:
// '../lib/ai-client' (rotas) e 'src/lib/ai-client' (tawany-handler, tools).
// Mockamos os dois para garantir que nenhum caminho chame a OpenRouter real.
vi.mock('./lib/ai-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/ai-client')>()),
  createAiClient: aiMock.createAiClient,
}));
vi.mock('src/lib/ai-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/ai-client')>()),
  createAiClient: aiMock.createAiClient,
}));

import app from './app';
import { prisma } from './lib/deps';
import { hashPassword } from './lib/auth';

const PHONE = '5511999990000';
const USER_EMAIL = 'ana.integration@qara.test';
const USER_PASSWORD = 'senha-teste-123';
const KNOWN_PRICE_CENTS = 50_000; // R$ 500,00 — único preço "conhecido" pelo guard

const TAWANY_REPLY = 'Olá! Posso te ajudar a agendar uma consulta?';
const INVENTED_PRICE_REPLY = 'O procedimento custa R$ 999,00.';

let conversationId = '';
let leadId = '';
let token = '';

// Payload real da Meta Cloud API (shape esperado por parseMetaEvent).
const metaPayload = (text: string, wamid: string) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'entry-1',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '5511888880000', phone_number_id: '1234567890' },
            contacts: [{ profile: { name: 'Paciente Teste' }, wa_id: PHONE }],
            messages: [
              {
                from: PHONE,
                id: wamid,
                timestamp: String(Math.floor(Date.now() / 1000)),
                type: 'text',
                text: { body: text },
              },
            ],
          },
        },
      ],
    },
  ],
});

const signBody = (rawBody: string): string =>
  `sha256=${createHmac('sha256', process.env.META_APP_SECRET as string)
    .update(rawBody, 'utf8')
    .digest('hex')}`;

// Envia o webhook assinado com o MESMO corpo bruto usado no HMAC.
const postMetaWebhook = async (text: string, wamid: string) => {
  const raw = JSON.stringify(metaPayload(text, wamid));
  return request(app)
    .post('/api/webhooks/meta')
    .set('content-type', 'application/json')
    .set('x-hub-signature-256', signBody(raw))
    .send(raw);
};

// O processamento do webhook é assíncrono (setImmediate) — aguarda o efeito
// aparecer no banco com polling curto, sem sleeps cegos.
const waitFor = async <T>(
  probe: () => Promise<T | null | undefined | false>,
  label: string,
  timeoutMs = 5_000,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timeout (${timeoutMs}ms) esperando: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const countOutMessages = (): Promise<number> =>
  prisma.chatMessage.count({ where: { conversationId, direction: 'OUT' } });

beforeAll(async () => {
  // Limpeza na ordem das FKs (filhos → pais). NÃO derruba o schema e preserva
  // o seed de knowledge (KnowledgeSection / TawanyExample).
  await prisma.aiSuggestion.deleteMany();
  await prisma.chatMessage.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.task.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.patient.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.aiRunLog.deleteMany();
  await prisma.service.deleteMany();
  await prisma.bot.deleteMany();

  const user = await prisma.user.create({
    data: {
      name: 'Ana Recepção',
      email: USER_EMAIL,
      password: await hashPassword(USER_PASSWORD),
      role: 'recepcao',
    },
  });
  expect(user.id).toBeTruthy();

  // Preço conhecido: sem Service ativo, knownPrices fica vazio e o guard de
  // preço do reply-validator nem roda (Fluxo B depende dele).
  await prisma.service.create({
    data: { name: 'Consulta Dermatológica', priceCents: KNOWN_PRICE_CENTS, active: true },
  });

  const lead = await prisma.lead.create({
    data: { name: 'Paciente Teste', phone: PHONE, source: 'WHATSAPP' },
  });
  leadId = lead.id;

  const conversation = await prisma.conversation.create({
    data: {
      leadId,
      channel: 'WHATSAPP',
      externalId: PHONE,
      status: 'OPEN',
    },
  });
  conversationId = conversation.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Fluxo de produção ponta a ponta (banco real, IA mockada)', () => {
  describe('Fluxo A — mensagem nova → Tawany sugere → humano aprova', () => {
    it('aceita o webhook da Meta assinado e registra a mensagem IN', async () => {
      const response = await postMetaWebhook('Olá, gostaria de saber mais sobre a consulta', 'wamid.FLOWA.1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const inbound = await waitFor(
        () => prisma.chatMessage.findFirst({ where: { externalId: 'wamid.FLOWA.1' } }),
        'chatMessage IN criada pelo webhook',
      );
      expect(inbound.conversationId).toBe(conversationId);
      expect(inbound.direction).toBe('IN');
      expect(inbound.body).toBe('Olá, gostaria de saber mais sobre a consulta');
    });

    it('cria aiSuggestion PENDING sem enviar (human_approval) e mantém a conversa com a Tawany', async () => {
      const suggestion = await waitFor(
        () => prisma.aiSuggestion.findFirst({ where: { conversationId, status: 'PENDING' } }),
        'aiSuggestion PENDING criada pela Tawany',
      );
      expect(suggestion.body).toBe(TAWANY_REPLY);
      expect(suggestion.model).toBe('mock/tawany-integration');

      // human_approval NÃO envia: nenhuma mensagem OUT ainda.
      expect(await countOutMessages()).toBe(0);

      const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      expect(conversation.status).toBe('OPEN');
      expect(conversation.needsHuman).toBe(false);
    });

    it('faz login e vê a conversa no inbox com agentState tawany_ativa', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: USER_EMAIL, password: USER_PASSWORD });
      expect(login.status).toBe(200);
      expect(login.body.success).toBe(true);
      token = login.body.data.token;
      expect(token).toBeTruthy();

      const list = await request(app)
        .get('/api/inbox/list')
        .set('authorization', `Bearer ${token}`);
      expect(list.status).toBe(200);
      const item = list.body.data.items.find(
        (candidate: { id: string }) => candidate.id === conversationId,
      );
      expect(item).toBeDefined();
      expect(item.agentState).toBe('tawany_ativa');

      const detail = await request(app)
        .get(`/api/inbox/${conversationId}`)
        .set('authorization', `Bearer ${token}`);
      expect(detail.status).toBe(200);
      const bodies = detail.body.data.messages.map((message: { body: string }) => message.body);
      expect(bodies).toContain('Olá, gostaria de saber mais sobre a consulta');
    });

    it('aprova a sugestão → vira SENT e cria a OUT (sem envio real: deliveryStatus PENDING)', async () => {
      const suggestion = await prisma.aiSuggestion.findFirstOrThrow({
        where: { conversationId, status: 'PENDING' },
      });

      const approve = await request(app)
        .post('/api/tawany/approve')
        .set('authorization', `Bearer ${token}`)
        .send({ suggestionId: suggestion.id });
      expect(approve.status).toBe(200);
      expect(approve.body.success).toBe(true);
      expect(approve.body.data.humanEdited).toBe(false);

      const updated = await prisma.aiSuggestion.findUniqueOrThrow({ where: { id: suggestion.id } });
      expect(updated.status).toBe('SENT');

      const outbound = await prisma.chatMessage.findFirstOrThrow({
        where: { conversationId, direction: 'OUT' },
      });
      expect(outbound.body).toBe(TAWANY_REPLY);
      // Meta não configurada (sem META_ACCESS_TOKEN): registra no CRM sem enviar.
      expect(outbound.deliveryStatus).toBe('PENDING');
      expect(outbound.externalId).toBeNull();
    });

    it('dashboard /summary responde autenticado com leadsAtivos >= 1', async () => {
      const summary = await request(app)
        .get('/api/dashboard/summary')
        .set('authorization', `Bearer ${token}`);
      expect(summary.status).toBe(200);
      expect(summary.body.success).toBe(true);
      expect(summary.body.data.leadsAtivos).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Fluxo B — resposta de risco → reply-validator bloqueia → handoff', () => {
    it('IA inventa preço fora da base → handoff sem NENHUMA mensagem OUT nova', async () => {
      const outBefore = await countOutMessages();
      aiMock.state.reply = INVENTED_PRICE_REPLY; // R$ 999,00 não está em knownPrices

      const response = await postMetaWebhook('Quanto custa a consulta?', 'wamid.FLOWB.1');
      expect(response.status).toBe(200);

      const conversation = await waitFor(async () => {
        const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
        return row.needsHuman ? row : null;
      }, 'conversation com needsHuman=true após guard bloquear');

      expect(conversation.status).toBe('NEEDS_HUMAN');
      expect(conversation.handoffReason).toContain('guard_failed: price_not_in_kb');

      // Aguarda o handler concluir de fato (finally marca agentHandled) antes
      // de afirmar que nada foi enviado.
      await waitFor(async () => {
        const message = await prisma.chatMessage.findFirstOrThrow({ where: { externalId: 'wamid.FLOWB.1' } });
        return message.agentHandled ? message : null;
      }, 'mensagem do Fluxo B processada até o fim');

      expect(await countOutMessages()).toBe(outBefore);
      expect(
        await prisma.aiSuggestion.count({ where: { conversationId, status: 'PENDING' } }),
      ).toBe(0);
    });

    it('inbox mostra agentState aguardando_humano', async () => {
      const list = await request(app)
        .get('/api/inbox/list')
        .set('authorization', `Bearer ${token}`);
      expect(list.status).toBe(200);
      const item = list.body.data.items.find(
        (candidate: { id: string }) => candidate.id === conversationId,
      );
      expect(item).toBeDefined();
      expect(item.agentState).toBe('aguardando_humano');
      expect(item.handoffReason).toContain('guard_failed: price_not_in_kb');
    });

    it('devolver-tawany reabre a conversa (OPEN, needsHuman=false, handoffReason null)', async () => {
      const response = await request(app)
        .post(`/api/inbox/${conversationId}/devolver-tawany`)
        .set('authorization', `Bearer ${token}`);
      expect(response.status).toBe(200);
      expect(response.body.data.agentState).toBe('tawany_ativa');

      const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      expect(conversation.status).toBe('OPEN');
      expect(conversation.needsHuman).toBe(false);
      expect(conversation.handoffReason).toBeNull();
    });
  });

  describe('Fluxo C — timeline do lead', () => {
    it('agrega as mensagens da conversa e a sugestão enviada', async () => {
      const timeline = await request(app)
        .get(`/api/pipeline/leads/${leadId}/timeline`)
        .set('authorization', `Bearer ${token}`);
      expect(timeline.status).toBe(200);
      expect(timeline.body.success).toBe(true);

      const items = timeline.body.data as Array<{ type: string; title: string; detail?: string }>;
      expect(items.length).toBeGreaterThan(0);

      const messagesItem = items.find((item) => item.type === 'messages');
      expect(messagesItem).toBeDefined();
      // 2 IN (Fluxos A e B) + 1 OUT aprovada, agregadas por dia.
      expect(messagesItem?.detail).toContain('2 recebidas');

      const suggestionItem = items.find((item) => item.type === 'suggestion');
      expect(suggestionItem).toBeDefined();
      expect(suggestionItem?.title).toBe('Tawany enviou resposta');
      expect(suggestionItem?.detail).toContain(TAWANY_REPLY);
    });
  });
});
