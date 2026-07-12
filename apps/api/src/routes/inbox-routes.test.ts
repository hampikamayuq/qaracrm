import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => ({
  prisma: {
    conversation: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    lead: {
      update: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    patient: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    whatsAppInstance: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    aiSuggestion: {
      findMany: vi.fn(),
    },
    chatMessage: {
      updateMany: vi.fn(),
    },
  },
  sendWhatsApp: {
    execute: vi.fn(),
  },
}));

vi.mock('../lib/deps', () => ({ prisma: mocks.prisma }));
vi.mock('../lib/tools/sendWhatsApp', () => ({ sendWhatsApp: mocks.sendWhatsApp }));
vi.mock('../middleware/auth-middleware', () => ({
  authMiddleware: vi.fn((_req, _res, next) => next()),
}));

const req = (overrides: Partial<Request>): Request => overrides as Request;

const res = () => {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response as unknown as Response & typeof response;
};

describe('Inbox routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.aiSuggestion.findMany.mockResolvedValue([]);
  });

  it('lists conversations with search, filters, pagination, and latest message only', async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([
      {
        id: 'c1',
        status: 'OPEN',
        needsHuman: true,
        updatedAt: new Date('2026-07-05T12:00:00.000Z'),
        lead: { id: 'l1', name: 'Maria Silva' },
        messages: [{ body: 'Quero consulta', sentAt: new Date('2026-07-05T11:59:00.000Z') }],
        aiSuggestions: [{ id: 's1', body: 'Posso ajudar?', riskLevel: 'low' }],
      },
    ]);
    mocks.prisma.conversation.count.mockResolvedValue(1);
    const { listInboxRoute } = await import('./inbox-routes');
    const response = res();

    await listInboxRoute(
      req({ query: { search: ' Maria ', status: 'OPEN', needsHuman: 'true', page: '2', pageSize: '10' } }),
      response,
    );

    const expectedWhere = {
      status: 'OPEN',
      needsHuman: true,
      lead: { name: { contains: 'Maria', mode: 'insensitive' } },
    };
    expect(mocks.prisma.conversation.findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      orderBy: { updatedAt: 'desc' },
      skip: 10,
      take: 10,
      select: {
        id: true,
        status: true,
        needsHuman: true,
        handoffReason: true,
        channel: true,
        instance: { select: { id: true, name: true } },
        lastMessageAt: true,
        updatedAt: true,
        lead: {
          select: {
            id: true,
            name: true,
            phone: true,
            score: true,
            tags: true,
            temperature: true,
          },
        },
        messages: {
          take: 1,
          orderBy: { sentAt: 'desc' },
          select: { id: true, body: true, sentAt: true, direction: true },
        },
        aiSuggestions: {
          where: { status: 'PENDING' },
          take: 1,
          select: { id: true, body: true, riskLevel: true, status: true },
        },
      },
    });
    expect(mocks.prisma.conversation.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: {
        items: expect.any(Array),
        total: 1,
        page: 2,
      },
    });
  });

  it('caps pageSize and ignores invalid needsHuman values', async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([]);
    mocks.prisma.conversation.count.mockResolvedValue(0);
    const { listInboxRoute } = await import('./inbox-routes');
    const response = res();

    await listInboxRoute(req({ query: { needsHuman: 'maybe', page: '-3', pageSize: '500' } }), response);

    expect(mocks.prisma.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {},
      skip: 0,
      take: 100,
    }));
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: { items: [], total: 0, page: 1 },
    });
  });

  it('exports an express router', async () => {
    const mod = await import('./inbox-routes');
    expect(mod.default).toBeDefined();
  });

  it('loads a conversation detail with messages, lead sidebar data, tasks, and pending suggestions', async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue({
      id: 'c1',
      status: 'OPEN',
      needsHuman: false,
      channel: 'WHATSAPP',
      lastMessageAt: new Date('2026-07-05T12:00:00.000Z'),
      updatedAt: new Date('2026-07-05T12:00:00.000Z'),
      lead: {
        id: 'l1',
        name: 'Maria Silva',
        phone: '+5511999999999',
        email: 'maria@example.com',
        source: 'Instagram',
        intent: 'consulta cabelo',
        score: 83,
        temperature: 'HOT',
        tags: ['tricologia'],
        nextAction: 'Retornar com horarios',
        stage: { id: 's1', name: 'Qualificado' },
      },
      patient: null,
      messages: [
        { id: 'm1', direction: 'IN', body: 'Quero consulta', sentAt: new Date('2026-07-05T11:59:00.000Z'), agentHandled: false },
      ],
      tasks: [
        { id: 't1', title: 'Ligar para Maria', status: 'OPEN', priority: 'HIGH', dueAt: new Date('2026-07-06T12:00:00.000Z') },
      ],
      aiSuggestions: [
        { id: 'a1', body: 'Claro, posso ajudar.', riskLevel: 'low', status: 'PENDING', createdAt: new Date('2026-07-05T12:00:00.000Z') },
      ],
    });
    const { getInboxDetailRoute } = await import('./inbox-routes');
    const response = res();

    await getInboxDetailRoute(req({ params: { id: 'c1' } }), response);

    expect(mocks.prisma.conversation.findUnique).toHaveBeenCalledWith({
      where: { id: 'c1' },
      select: expect.objectContaining({
        messages: expect.objectContaining({ orderBy: { sentAt: 'asc' } }),
        lead: expect.objectContaining({
          select: expect.objectContaining({ phone: true, email: true, stage: expect.any(Object) }),
        }),
        tasks: expect.objectContaining({ where: { status: { not: 'DONE' } } }),
        aiSuggestions: expect.objectContaining({ where: { status: 'PENDING' } }),
      }),
    });
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ id: 'c1', lead: expect.objectContaining({ phone: '+5511999999999' }) }),
    });
  });

  it('detail devolve agentState derivado e as sugestões enviadas (feedback 👍/👎)', async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue({
      id: 'c1',
      status: 'PENDING_HUMAN',
      needsHuman: true,
      handoffReason: 'guard_failed: price_not_in_kb: 99900',
      lead: { id: 'l1', name: 'Maria' },
      messages: [],
      tasks: [],
      aiSuggestions: [],
    });
    mocks.prisma.aiSuggestion.findMany.mockResolvedValue([
      { id: 's1', body: 'Olá!', status: 'SENT', feedback: null },
    ]);
    const { getInboxDetailRoute } = await import('./inbox-routes');
    const response = res();

    await getInboxDetailRoute(req({ params: { id: 'c1' } }), response);

    expect(mocks.prisma.aiSuggestion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId: 'c1', status: { in: ['SENT', 'TEST_SENT'] } },
    }));
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        agentState: 'aguardando_humano',
        handoffReason: 'guard_failed: price_not_in_kb: 99900',
        sentSuggestions: [{ id: 's1', body: 'Olá!', status: 'SENT', feedback: null }],
      }),
    });
  });
});

describe('agentStateOf', () => {
  it('deriva o estado de quem conduz a conversa', async () => {
    const { agentStateOf } = await import('./inbox-routes');
    expect(agentStateOf('OPEN', false)).toBe('tawany_ativa');
    expect(agentStateOf('OPEN', true)).toBe('aguardando_humano');
    expect(agentStateOf('PENDING_HUMAN', true)).toBe('aguardando_humano');
    expect(agentStateOf('PENDING_PATIENT', false)).toBe('humano_assumiu');
    expect(agentStateOf('RESOLVED', false)).toBe('humano_assumiu');
  });
});

describe('Inbox phase-3 actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.aiSuggestion.findMany.mockResolvedValue([]);
  });

  it('reply requires text and sends via WhatsApp tool', async () => {
    const { replyRoute } = await import('./inbox-routes');
    const bad = res();
    await replyRoute(req({ params: { id: 'c1' }, body: {} }), bad);
    expect(bad.status).toHaveBeenCalledWith(400);

    mocks.prisma.conversation.findUnique.mockResolvedValue({ id: 'c1' });
    mocks.sendWhatsApp.execute.mockResolvedValue(JSON.stringify({ ok: true, sent: true, messageId: 'm1' }));
    const ok = res();
    await replyRoute(req({ params: { id: 'c1' }, body: { text: '  Oi, tudo bem? ' } }), ok);

    expect(mocks.sendWhatsApp.execute).toHaveBeenCalledWith(
      { conversationId: 'c1', text: 'Oi, tudo bem?' },
      expect.anything(),
    );
    expect(ok.json).toHaveBeenCalledWith({ success: true, data: { ok: true, sent: true, messageId: 'm1' } });
  });

  it('reply grava a autoria (sentById) do atendente logado na mensagem enviada', async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue({ id: 'c1', status: 'OPEN' });
    mocks.sendWhatsApp.execute.mockResolvedValue(JSON.stringify({ ok: true, sent: true, messageId: 'm1' }));
    const { replyRoute } = await import('./inbox-routes');
    await replyRoute(req({ params: { id: 'c1' }, body: { text: 'Oi' }, userId: 'u1' } as Partial<Request>), res());

    expect(mocks.prisma.chatMessage.updateMany).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { sentById: 'u1' },
    });
  });

  it('reply sem messageId no resultado não tenta gravar autoria', async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue({ id: 'c1', status: 'OPEN' });
    mocks.sendWhatsApp.execute.mockResolvedValue(JSON.stringify({ ok: false, error: 'conversation_not_found' }));
    const { replyRoute } = await import('./inbox-routes');
    await replyRoute(req({ params: { id: 'c1' }, body: { text: 'Oi' }, userId: 'u1' } as Partial<Request>), res());

    expect(mocks.prisma.chatMessage.updateMany).not.toHaveBeenCalled();
  });

  it('reply formaliza "humano assumiu": limpa needsHuman e sai de OPEN', async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue({ id: 'c1', status: 'PENDING_HUMAN' });
    mocks.sendWhatsApp.execute.mockResolvedValue(JSON.stringify({ ok: true, sent: true }));
    const { replyRoute } = await import('./inbox-routes');
    await replyRoute(req({ params: { id: 'c1' }, body: { text: 'Oi' } }), res());

    expect(mocks.prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { needsHuman: false, status: 'PENDING_PATIENT' },
    });
  });

  it('reply devolve 409 quando o envio falha (ex.: instância QR desconectada), sem mudar o estado', async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue({ id: 'c1', status: 'PENDING_HUMAN' });
    mocks.sendWhatsApp.execute.mockResolvedValue(JSON.stringify({ ok: false, error: 'instance_disconnected' }));
    const { replyRoute } = await import('./inbox-routes');
    const response = res();
    await replyRoute(req({ params: { id: 'c1' }, body: { text: 'Oi' } }), response);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({ success: false, error: 'instance_disconnected' });
    expect(mocks.prisma.conversation.updateMany).not.toHaveBeenCalled();
  });

  it('reply em conversa RESOLVED não reabre o estado', async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue({ id: 'c1', status: 'RESOLVED' });
    mocks.sendWhatsApp.execute.mockResolvedValue(JSON.stringify({ ok: true, sent: true }));
    const { replyRoute } = await import('./inbox-routes');
    await replyRoute(req({ params: { id: 'c1' }, body: { text: 'Oi' } }), res());

    expect(mocks.prisma.conversation.updateMany).not.toHaveBeenCalled();
  });

  it('devolver-tawany reabre a conversa para a Tawany e limpa o motivo', async () => {
    mocks.prisma.conversation.updateMany.mockResolvedValue({ count: 1 });
    const { devolverTawanyRoute } = await import('./inbox-routes');
    const response = res();
    await devolverTawanyRoute(req({ params: { id: 'c1' } }), response);

    expect(mocks.prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { needsHuman: false, status: 'OPEN', handoffReason: null },
    });
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: { status: 'OPEN', needsHuman: false, agentState: 'tawany_ativa' },
    });
  });

  it('devolver-tawany retorna 404 para conversa inexistente', async () => {
    mocks.prisma.conversation.updateMany.mockResolvedValue({ count: 0 });
    const { devolverTawanyRoute } = await import('./inbox-routes');
    const response = res();
    await devolverTawanyRoute(req({ params: { id: 'ghost' } }), response);

    expect(response.status).toHaveBeenCalledWith(404);
  });

  it('handoff flags conversation for human', async () => {
    mocks.prisma.conversation.updateMany.mockResolvedValue({ count: 1 });
    const { handoffRoute } = await import('./inbox-routes');
    const response = res();
    await handoffRoute(req({ params: { id: 'c1' }, body: {} }), response);

    expect(mocks.prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { needsHuman: true, status: 'PENDING_HUMAN', handoffReason: 'manual_handoff' },
    });
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: { needsHuman: true, status: 'PENDING_HUMAN' },
    });
  });

  it('status change rejects unknown statuses and clears needsHuman on resolve', async () => {
    const { setStatusRoute } = await import('./inbox-routes');
    const bad = res();
    await setStatusRoute(req({ params: { id: 'c1' }, body: { status: 'WHATEVER' } }), bad);
    expect(bad.status).toHaveBeenCalledWith(400);

    mocks.prisma.conversation.updateMany.mockResolvedValue({ count: 1 });
    const ok = res();
    await setStatusRoute(req({ params: { id: 'c1' }, body: { status: 'RESOLVED' } }), ok);
    expect(mocks.prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'RESOLVED', needsHuman: false },
    });
  });

  it('addTag merges into lead tags without duplicating', async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue({
      lead: { id: 'l1', tags: ['unha'] },
    });
    mocks.prisma.lead.update.mockResolvedValue({});
    const { addTagRoute } = await import('./inbox-routes');
    const response = res();
    await addTagRoute(req({ params: { id: 'c1' }, body: { tag: 'lead quente' } }), response);

    expect(mocks.prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { tags: ['unha', 'lead quente'] },
    });
  });

  it('removeTag filters lead tags', async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue({
      lead: { id: 'l1', tags: ['unha', 'lead quente'] },
    });
    mocks.prisma.lead.update.mockResolvedValue({});
    const { removeTagRoute } = await import('./inbox-routes');
    const response = res();
    await removeTagRoute(req({ params: { id: 'c1', tag: 'lead%20quente' } }), response);

    expect(mocks.prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { tags: ['unha'] },
    });
  });

  describe('startConversationRoute', () => {
    beforeEach(() => {
      delete process.env.META_ACCESS_TOKEN;
      delete process.env.META_PHONE_NUMBER_ID;
    });

    it('400 sem leadId/patientId e 404 para patient inexistente', async () => {
      const { startConversationRoute } = await import('./inbox-routes');
      const r1 = res();
      await startConversationRoute(req({ body: {} }), r1);
      expect(r1.status).toHaveBeenCalledWith(400);

      mocks.prisma.patient.findUnique.mockResolvedValue(null);
      const r2 = res();
      await startConversationRoute(req({ body: { patientId: 'p-x' } }), r2);
      expect(r2.status).toHaveBeenCalledWith(404);
    });

    it('400 quando o contato não tem telefone', async () => {
      mocks.prisma.patient.findUnique.mockResolvedValue({ id: 'p1', name: 'Maria', phone: null, leadId: null });
      const { startConversationRoute } = await import('./inbox-routes');
      const response = res();
      await startConversationRoute(req({ body: { patientId: 'p1' } }), response);
      expect(response.status).toHaveBeenCalledWith(400);
    });

    it('devolve a conversa existente do lead em vez de duplicar', async () => {
      mocks.prisma.lead.findUnique.mockResolvedValue({ id: 'l1', name: 'Maria', phone: '55 (11) 99999-8888' });
      mocks.prisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      const { startConversationRoute } = await import('./inbox-routes');
      const response = res();

      await startConversationRoute(req({ body: { leadId: 'l1' } }), response);

      expect(response.json).toHaveBeenCalledWith({
        success: true,
        data: { conversationId: 'conv-1', created: false },
      });
      expect(mocks.prisma.conversation.create).not.toHaveBeenCalled();
    });

    it('cria conversa nova conduzida por humano com telefone normalizado', async () => {
      mocks.prisma.lead.findUnique.mockResolvedValue({ id: 'l1', name: 'Maria', phone: '+55 (11) 99999-8888' });
      mocks.prisma.conversation.findFirst.mockResolvedValue(null);
      mocks.prisma.conversation.create.mockResolvedValue({ id: 'conv-new' });
      const { startConversationRoute } = await import('./inbox-routes');
      const response = res();

      await startConversationRoute(req({ body: { leadId: 'l1' } }), response);

      expect(mocks.prisma.conversation.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          leadId: 'l1',
          externalId: '5511999998888',
          status: 'OPEN',
          needsHuman: true,
          handoffReason: 'conversa_iniciada_pela_equipe',
        }),
      }));
      expect(response.json).toHaveBeenCalledWith({
        success: true,
        data: { conversationId: 'conv-new', created: true },
      });
    });

    it('paciente sem lead: cria lead por telefone e liga o paciente', async () => {
      mocks.prisma.patient.findUnique.mockResolvedValue({ id: 'p1', name: 'Ana', phone: '5511988887777', leadId: null });
      mocks.prisma.lead.findFirst.mockResolvedValue(null);
      mocks.prisma.lead.create.mockResolvedValue({ id: 'lead-new' });
      mocks.prisma.conversation.findFirst.mockResolvedValue(null);
      mocks.prisma.conversation.create.mockResolvedValue({ id: 'conv-new' });
      const { startConversationRoute } = await import('./inbox-routes');
      const response = res();

      await startConversationRoute(req({ body: { patientId: 'p1' } }), response);

      expect(mocks.prisma.lead.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ phone: '5511988887777', source: 'CRM' }),
      }));
      expect(mocks.prisma.patient.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'p1' },
        data: { leadId: 'lead-new' },
      }));
      expect(mocks.prisma.conversation.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ leadId: 'lead-new', patientId: 'p1' }),
      }));
    });

    it('sem Meta configurado usa a primeira instância QR conectada', async () => {
      mocks.prisma.lead.findUnique.mockResolvedValue({ id: 'l1', name: 'Maria', phone: '5511999998888' });
      mocks.prisma.conversation.findFirst.mockResolvedValue(null);
      mocks.prisma.whatsAppInstance.findFirst.mockResolvedValue({ id: 'inst-1' });
      mocks.prisma.conversation.create.mockResolvedValue({ id: 'conv-qr' });
      const { startConversationRoute } = await import('./inbox-routes');
      const response = res();

      await startConversationRoute(req({ body: { leadId: 'l1' } }), response);

      expect(mocks.prisma.conversation.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ channel: 'WHATSAPP_QR', instanceId: 'inst-1' }),
      }));
    });
  });
});
