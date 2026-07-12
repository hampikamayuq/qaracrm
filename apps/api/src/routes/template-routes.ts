import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/deps';
import { authMiddleware } from '../middleware/auth-middleware';
import { requireAdmin } from '../middleware/authorization';
import { recordAudit } from '../lib/audit';
import {
  countPlaceholders,
  createMetaTemplate,
  deleteMetaTemplate,
  isMetaTemplatesConfigured,
  listMetaTemplates,
  type MetaTemplateCategory,
  type TemplateButton,
} from '../lib/meta-templates';

// Templates HSM (WhatsApp oficial): criar/submeter pra aprovação da Meta,
// acompanhar status e excluir. A Meta é a fonte da verdade — nada local.

const router = Router();

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error });
};

const CATEGORIES = new Set<MetaTemplateCategory>(['UTILITY', 'MARKETING', 'AUTHENTICATION']);
// Regra da Meta: minúsculas, números e underscore.
const NAME_PATTERN = /^[a-z0-9_]{1,120}$/;
const MAX_BUTTONS = 3;

// Valida/normaliza os botões vindos do editor. Retorna string de erro ou a
// lista pronta pra Meta. QUICK_REPLY = só texto; URL = texto + link https.
const parseButtons = (raw: unknown): { error: string } | { buttons: TemplateButton[] } => {
  if (raw === undefined) return { buttons: [] };
  if (!Array.isArray(raw)) return { error: 'buttons deve ser uma lista' };
  if (raw.length > MAX_BUTTONS) return { error: `Máximo de ${MAX_BUTTONS} botões` };
  const buttons: TemplateButton[] = [];
  for (const [i, item] of raw.entries()) {
    const b = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const text = typeof b.text === 'string' ? b.text.trim() : '';
    if (!text) return { error: `Botão ${i + 1}: texto obrigatório` };
    if (text.length > 25) return { error: `Botão ${i + 1}: texto até 25 caracteres` };
    if (b.type === 'URL') {
      const url = typeof b.url === 'string' ? b.url.trim() : '';
      if (!/^https?:\/\/.+/.test(url)) return { error: `Botão ${i + 1}: informe um link válido (https://…)` };
      buttons.push({ type: 'URL', text, url });
    } else {
      buttons.push({ type: 'QUICK_REPLY', text });
    }
  }
  return { buttons };
};

export const listTemplatesRoute = async (_req: Request, res: Response): Promise<void> => {
  try {
    if (!isMetaTemplatesConfigured()) {
      res.json({ success: true, data: { configured: false, templates: [] } });
      return;
    }
    const templates = await listMetaTemplates();
    res.json({ success: true, data: { configured: true, templates } });
  } catch (error) {
    jsonError(res, 502, (error as Error).message);
  }
};

export const createTemplateRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isMetaTemplatesConfigured()) {
      jsonError(res, 409, 'Configure META_ACCESS_TOKEN e META_WABA_ID para gerenciar templates.');
      return;
    }
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const category = typeof req.body?.category === 'string' ? req.body.category : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    const header = typeof req.body?.header === 'string' ? req.body.header.trim() : '';
    const footer = typeof req.body?.footer === 'string' ? req.body.footer.trim() : '';
    const language = typeof req.body?.language === 'string' && req.body.language.trim()
      ? req.body.language.trim()
      : 'pt_BR';
    const examples = Array.isArray(req.body?.examples)
      ? req.body.examples.map((v: unknown) => String(v).trim()).filter(Boolean)
      : [];

    if (!NAME_PATTERN.test(name)) {
      jsonError(res, 400, 'name: use minúsculas, números e underscore (ex.: qara_confirmacao_consulta)');
      return;
    }
    if (!CATEGORIES.has(category as MetaTemplateCategory)) {
      jsonError(res, 400, 'category: UTILITY, MARKETING ou AUTHENTICATION');
      return;
    }
    if (!body) {
      jsonError(res, 400, 'body (texto do template) required');
      return;
    }
    const placeholders = countPlaceholders(body);
    if (placeholders > 0 && examples.length < placeholders) {
      jsonError(res, 400, `A Meta exige exemplo para cada variável: informe ${placeholders} exemplo(s) para {{1}}..{{${placeholders}}}.`);
      return;
    }
    if (header.length > 60) {
      jsonError(res, 400, 'header: até 60 caracteres');
      return;
    }
    const parsedButtons = parseButtons(req.body?.buttons);
    if ('error' in parsedButtons) {
      jsonError(res, 400, parsedButtons.error);
      return;
    }

    const created = await createMetaTemplate({
      name,
      category: category as MetaTemplateCategory,
      language,
      body,
      ...(header ? { header } : {}),
      ...(footer ? { footer } : {}),
      ...(parsedButtons.buttons.length > 0 ? { buttons: parsedButtons.buttons } : {}),
      examples,
    });
    await recordAudit(prisma, {
      userId: req.userId ?? null,
      action: 'template.create',
      entity: 'whatsapp_template',
      entityId: name,
      after: { category, language, status: created.status },
    });
    res.json({ success: true, data: { name, status: created.status } });
  } catch (error) {
    jsonError(res, 502, (error as Error).message);
  }
};

export const deleteTemplateRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isMetaTemplatesConfigured()) {
      jsonError(res, 409, 'Configure META_ACCESS_TOKEN e META_WABA_ID para gerenciar templates.');
      return;
    }
    const name = typeof req.params.name === 'string' ? req.params.name : '';
    if (!NAME_PATTERN.test(name)) {
      jsonError(res, 400, 'nome de template inválido');
      return;
    }
    await deleteMetaTemplate(name);
    await recordAudit(prisma, {
      userId: req.userId ?? null,
      action: 'template.delete',
      entity: 'whatsapp_template',
      entityId: name,
    });
    res.json({ success: true, data: { deleted: name } });
  } catch (error) {
    jsonError(res, 502, (error as Error).message);
  }
};

router.get('/', authMiddleware, listTemplatesRoute);
router.post('/', authMiddleware, requireAdmin, createTemplateRoute);
router.delete('/:name', authMiddleware, requireAdmin, deleteTemplateRoute);

export default router;
