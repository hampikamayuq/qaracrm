import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => ({
  prisma: {
    whatsAppInstance: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
  evolution: {
    isEvolutionConfigured: vi.fn().mockReturnValue(true),
    createEvolutionInstance: vi.fn().mockResolvedValue(undefined),
    setEvolutionWebhook: vi.fn().mockResolvedValue(undefined),
    connectEvolutionInstance: vi.fn(),
    getEvolutionConnectionState: vi.fn(),
    logoutEvolutionInstance: vi.fn().mockResolvedValue(undefined),
    deleteEvolutionInstance: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../lib/deps', () => ({ prisma: mocks.prisma }));
vi.mock('../lib/evolution-client', () => mocks.evolution);
vi.mock('../middleware/auth-middleware', () => ({
  authMiddleware: vi.fn((_req, _res, next) => next()),
}));
vi.mock('../middleware/authorization', () => ({
  requireAdmin: vi.fn((_req, _res, next) => next()),
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

const INSTANCE = {
  id: 'inst-1',
  name: 'Recepção',
  instanceName: 'qara-recepcao-ab12',
  phoneNumber: null,
  status: 'DISCONNECTED',
  lastConnectedAt: null,
  createdAt: new Date('2026-07-11T00:00:00.000Z'),
};

describe('channel routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.evolution.isEvolutionConfigured.mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lista instâncias com flag de configuração do gateway', async () => {
    mocks.prisma.whatsAppInstance.findMany.mockResolvedValue([INSTANCE]);
    const { listChannelsRoute } = await import('./channel-routes');
    const response = res();

    await listChannelsRoute(req({}), response);

    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: { items: [INSTANCE], evolutionConfigured: true },
    });
  });

  it('create: 503 sem gateway configurado; 400 sem nome', async () => {
    const { createChannelRoute } = await import('./channel-routes');

    mocks.evolution.isEvolutionConfigured.mockReturnValue(false);
    const r503 = res();
    await createChannelRoute(req({ body: { name: 'Recepção' } }), r503);
    expect(r503.status).toHaveBeenCalledWith(503);

    mocks.evolution.isEvolutionConfigured.mockReturnValue(true);
    const r400 = res();
    await createChannelRoute(req({ body: {} }), r400);
    expect(r400.status).toHaveBeenCalledWith(400);
  });

  it('create: cria no Evolution ANTES de persistir e devolve 201', async () => {
    mocks.prisma.whatsAppInstance.create.mockResolvedValue(INSTANCE);
    const { createChannelRoute } = await import('./channel-routes');
    const response = res();

    await createChannelRoute(req({ body: { name: 'Recepção' } }), response);

    expect(mocks.evolution.createEvolutionInstance).toHaveBeenCalledWith(
      expect.stringMatching(/^qara-recepcao-[0-9a-f]{4}$/),
    );
    expect(mocks.prisma.whatsAppInstance.create).toHaveBeenCalledWith({
      data: { name: 'Recepção', instanceName: expect.stringMatching(/^qara-recepcao-/) },
      select: expect.any(Object),
    });
    expect(response.status).toHaveBeenCalledWith(201);
  });

  it('create: não persiste no banco quando o Evolution falha', async () => {
    mocks.evolution.createEvolutionInstance.mockRejectedValueOnce(new Error('Evolution API error: 500'));
    const { createChannelRoute } = await import('./channel-routes');
    const response = res();

    await createChannelRoute(req({ body: { name: 'Recepção' } }), response);

    expect(mocks.prisma.whatsAppInstance.create).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(500);
  });

  it('qr: proxy do connect (QR on-demand) e marca PAIRING', async () => {
    mocks.prisma.whatsAppInstance.findUnique.mockResolvedValue(INSTANCE);
    mocks.evolution.connectEvolutionInstance.mockResolvedValue({
      qrBase64: 'data:image/png;base64,QR==',
      pairingCode: null,
    });
    const { channelQrRoute } = await import('./channel-routes');
    const response = res();

    await channelQrRoute(req({ params: { id: 'inst-1' } }), response);

    expect(mocks.evolution.connectEvolutionInstance).toHaveBeenCalledWith('qara-recepcao-ab12');
    expect(mocks.prisma.whatsAppInstance.update).toHaveBeenCalledWith({
      where: { id: 'inst-1' },
      data: { status: 'PAIRING' },
    });
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: { qrBase64: 'data:image/png;base64,QR==', pairingCode: null },
    });
  });

  it('status: reconcilia com o Evolution quando diverge do banco', async () => {
    mocks.prisma.whatsAppInstance.findUnique.mockResolvedValue({ ...INSTANCE, status: 'PAIRING' });
    mocks.evolution.getEvolutionConnectionState.mockResolvedValue('CONNECTED');
    const { channelStatusRoute } = await import('./channel-routes');
    const response = res();

    await channelStatusRoute(req({ params: { id: 'inst-1' } }), response);

    expect(mocks.prisma.whatsAppInstance.update).toHaveBeenCalledWith({
      where: { id: 'inst-1' },
      data: { status: 'CONNECTED', lastConnectedAt: expect.any(Date) },
    });
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ status: 'CONNECTED' }),
    });
  });

  it('status: devolve o estado do banco quando o gateway está fora (best-effort)', async () => {
    mocks.prisma.whatsAppInstance.findUnique.mockResolvedValue({ ...INSTANCE, status: 'CONNECTED' });
    mocks.evolution.getEvolutionConnectionState.mockRejectedValue(new Error('down'));
    const { channelStatusRoute } = await import('./channel-routes');
    const response = res();

    await channelStatusRoute(req({ params: { id: 'inst-1' } }), response);

    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ status: 'CONNECTED' }),
    });
  });

  it('disconnect: logout no Evolution + status DISCONNECTED', async () => {
    mocks.prisma.whatsAppInstance.findUnique.mockResolvedValue({ ...INSTANCE, status: 'CONNECTED' });
    mocks.prisma.whatsAppInstance.update.mockResolvedValue({ ...INSTANCE, status: 'DISCONNECTED' });
    const { disconnectChannelRoute } = await import('./channel-routes');
    const response = res();

    await disconnectChannelRoute(req({ params: { id: 'inst-1' } }), response);

    expect(mocks.evolution.logoutEvolutionInstance).toHaveBeenCalledWith('qara-recepcao-ab12');
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ status: 'DISCONNECTED' }),
    });
  });

  it('delete: remove local mesmo se o Evolution falhar (histórico preservado via FK SET NULL)', async () => {
    mocks.prisma.whatsAppInstance.findUnique.mockResolvedValue(INSTANCE);
    mocks.evolution.deleteEvolutionInstance.mockRejectedValueOnce(new Error('Evolution API error: 404'));
    const { deleteChannelRoute } = await import('./channel-routes');
    const response = res();

    await deleteChannelRoute(req({ params: { id: 'inst-1' } }), response);

    expect(mocks.prisma.whatsAppInstance.delete).toHaveBeenCalledWith({ where: { id: 'inst-1' } });
    expect(response.json).toHaveBeenCalledWith({ success: true, data: { id: 'inst-1' } });
  });

  it('404 para instância inexistente nas rotas por id', async () => {
    mocks.prisma.whatsAppInstance.findUnique.mockResolvedValue(null);
    const { channelQrRoute, channelStatusRoute, deleteChannelRoute, disconnectChannelRoute } =
      await import('./channel-routes');

    for (const route of [channelQrRoute, channelStatusRoute, disconnectChannelRoute, deleteChannelRoute]) {
      const response = res();
      await route(req({ params: { id: 'nope' } }), response);
      expect(response.status).toHaveBeenCalledWith(404);
    }
  });

  describe('linkChannelRoute (instância existente no Evolution)', () => {
    it('valida payload e evita vínculo duplicado', async () => {
      const { linkChannelRoute } = await import('./channel-routes');

      const missing = res();
      await linkChannelRoute(req({ body: { name: 'Clinica' } }), missing);
      expect(missing.status).toHaveBeenCalledWith(400);

      mocks.prisma.whatsAppInstance.findFirst.mockResolvedValueOnce({ id: 'w1' });
      const dup = res();
      await linkChannelRoute(req({ body: { name: 'Clinica', instanceName: 'qara222' } }), dup);
      expect(dup.status).toHaveBeenCalledWith(409);
    });

    it('404 quando a instância não existe no gateway', async () => {
      mocks.prisma.whatsAppInstance.findFirst.mockResolvedValue(null);
      mocks.evolution.getEvolutionConnectionState.mockRejectedValueOnce(new Error('Evolution API error: 404'));
      const { linkChannelRoute } = await import('./channel-routes');
      const response = res();

      await linkChannelRoute(req({ body: { name: 'Clinica', instanceName: 'nao-existe' } }), response);

      expect(response.status).toHaveBeenCalledWith(404);
      expect(mocks.evolution.setEvolutionWebhook).not.toHaveBeenCalled();
    });

    it('vincula: configura webhook no gateway e registra com o status remoto', async () => {
      mocks.prisma.whatsAppInstance.findFirst.mockResolvedValue(null);
      mocks.evolution.getEvolutionConnectionState.mockResolvedValueOnce('CONNECTED');
      mocks.prisma.whatsAppInstance.create.mockResolvedValueOnce({ id: 'w9', name: 'Clinica Qara', instanceName: 'qara222', status: 'CONNECTED' });
      const { linkChannelRoute } = await import('./channel-routes');
      const response = res();

      await linkChannelRoute(req({ body: { name: 'Clinica Qara', instanceName: 'qara222' } }), response);

      expect(mocks.evolution.setEvolutionWebhook).toHaveBeenCalledWith('qara222');
      expect(mocks.prisma.whatsAppInstance.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ name: 'Clinica Qara', instanceName: 'qara222', status: 'CONNECTED' }),
      }));
      expect(response.status).toHaveBeenCalledWith(201);
    });
  });
});
