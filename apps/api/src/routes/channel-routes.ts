import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/deps';
import { authMiddleware } from '../middleware/auth-middleware';
import { requireAdmin } from '../middleware/authorization';
import {
  connectEvolutionInstance,
  createEvolutionInstance,
  deleteEvolutionInstance,
  getEvolutionConnectionState,
  isEvolutionConfigured,
  logoutEvolutionInstance,
} from '../lib/evolution-client';

// Gestão dos números extras de WhatsApp (instâncias Evolution, pareadas por
// QR). O número oficial (Meta Cloud API) não aparece aqui — é fixo por env.

const router = Router();

const paramStr = (value: unknown): string => (typeof value === 'string' ? value : '');

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

const INSTANCE_SELECT = {
  id: true,
  name: true,
  instanceName: true,
  phoneNumber: true,
  status: true,
  lastConnectedAt: true,
  createdAt: true,
} as const;

// Slug estável para o Evolution: derivado do nome + sufixo aleatório para
// nunca colidir com instâncias antigas do mesmo nome no gateway.
export const buildInstanceName = (name: string): string => {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 32) || 'numero';
  return `qara-${slug}-${randomBytes(2).toString('hex')}`;
};

export const listChannelsRoute = async (_req: Request, res: Response): Promise<void> => {
  try {
    const items = await prisma.whatsAppInstance.findMany({
      orderBy: { createdAt: 'asc' },
      select: INSTANCE_SELECT,
    });
    res.json({ success: true, data: { items, evolutionConfigured: isEvolutionConfigured() } });
  } catch {
    jsonError(res, 500, 'Failed to load channels');
  }
};

export const createChannelRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isEvolutionConfigured()) {
      jsonError(res, 503, 'Gateway Evolution não configurado (EVOLUTION_* envs)');
      return;
    }
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      jsonError(res, 400, 'name required');
      return;
    }
    const instanceName = buildInstanceName(name);
    // Cria primeiro no Evolution: se falhar, não persiste nada no banco.
    await createEvolutionInstance(instanceName);
    const created = await prisma.whatsAppInstance.create({
      data: { name, instanceName },
      select: INSTANCE_SELECT,
    });
    res.status(201).json({ success: true, data: created });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

// QR on-demand: proxy do connect do Evolution (o QR expira em ~40s; a tela
// re-busca enquanto o painel de pareamento está aberto). Não armazenamos QR.
export const channelQrRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isEvolutionConfigured()) {
      jsonError(res, 503, 'Gateway Evolution não configurado');
      return;
    }
    const id = paramStr(req.params.id);
    const instance = await prisma.whatsAppInstance.findUnique({ where: { id } });
    if (!instance) {
      jsonError(res, 404, 'Channel not found');
      return;
    }
    const { qrBase64, pairingCode } = await connectEvolutionInstance(instance.instanceName);
    if (instance.status !== 'CONNECTED') {
      await prisma.whatsAppInstance.update({ where: { id }, data: { status: 'PAIRING' } });
    }
    res.json({ success: true, data: { qrBase64, pairingCode } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

// Alvo do polling da tela de Canais: reconcilia o status com o Evolution
// (CONNECTION_UPDATE pode se perder) e devolve o estado atual.
export const channelStatusRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = paramStr(req.params.id);
    const instance = await prisma.whatsAppInstance.findUnique({ where: { id }, select: INSTANCE_SELECT });
    if (!instance) {
      jsonError(res, 404, 'Channel not found');
      return;
    }
    let status = instance.status;
    if (isEvolutionConfigured()) {
      try {
        const remote = await getEvolutionConnectionState(instance.instanceName);
        if (remote && remote !== instance.status) {
          status = remote;
          await prisma.whatsAppInstance.update({
            where: { id },
            data: {
              status,
              ...(status === 'CONNECTED' ? { lastConnectedAt: new Date() } : {}),
            },
          });
        }
      } catch (err) {
        // Reconciliação é best-effort: devolve o status do banco se o gateway
        // estiver fora — a tela mostra o último estado conhecido.
        console.error('[channels] connectionState falhou (non-fatal):', (err as Error).message);
      }
    }
    res.json({ success: true, data: { ...instance, status } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const disconnectChannelRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isEvolutionConfigured()) {
      jsonError(res, 503, 'Gateway Evolution não configurado');
      return;
    }
    const id = paramStr(req.params.id);
    const instance = await prisma.whatsAppInstance.findUnique({ where: { id } });
    if (!instance) {
      jsonError(res, 404, 'Channel not found');
      return;
    }
    await logoutEvolutionInstance(instance.instanceName);
    const updated = await prisma.whatsAppInstance.update({
      where: { id },
      data: { status: 'DISCONNECTED' },
      select: INSTANCE_SELECT,
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const deleteChannelRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = paramStr(req.params.id);
    const instance = await prisma.whatsAppInstance.findUnique({ where: { id } });
    if (!instance) {
      jsonError(res, 404, 'Channel not found');
      return;
    }
    if (isEvolutionConfigured()) {
      try {
        await deleteEvolutionInstance(instance.instanceName);
      } catch (err) {
        // Instância já removida no gateway (404 etc.): segue com a remoção
        // local — o histórico de conversas fica (FK instanceId vira NULL).
        console.error('[channels] delete no Evolution falhou (non-fatal):', (err as Error).message);
      }
    }
    await prisma.whatsAppInstance.delete({ where: { id } });
    res.json({ success: true, data: { id } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

router.get('/', authMiddleware, listChannelsRoute);
router.post('/', authMiddleware, requireAdmin, createChannelRoute);
router.get('/:id/qr', authMiddleware, channelQrRoute);
router.get('/:id/status', authMiddleware, channelStatusRoute);
router.post('/:id/disconnect', authMiddleware, requireAdmin, disconnectChannelRoute);
router.delete('/:id', authMiddleware, requireAdmin, deleteChannelRoute);

export default router;
