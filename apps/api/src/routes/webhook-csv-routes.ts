import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/deps';
import { authMiddleware } from '../middleware/auth-middleware';

const router = Router();

const jsonError = (res: Response, status: number, error: string): void => {
  res.status(status).json({ success: false, error: status >= 500 ? 'Erro interno' : error });
};

const CLINICAL_PIPELINES = [
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

const UI_STAGES = ['NOVO', 'QUALIFICADO', 'AGENDADO', 'COMPARECEU', 'PERDIDO', 'CONVERTIDO'] as const;

const CSV_HEADERS = ['id', 'nome', 'telefone', 'email', 'origem', 'intencao', 'etapa', 'score', 'temperatura', 'pipeline', 'tags'];

const tagsOf = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : [];

const valueByPrefix = (tags: string[], prefix: string): string | null => {
  const found = tags.find((t) => t.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
};

const withTagPrefix = (tags: string[], prefix: string, value: string): string[] => [
  ...tags.filter((t) => !t.startsWith(prefix)),
  `${prefix}${value}`,
];

const stageFromTags = (tags: string[]): string => {
  const value = valueByPrefix(tags, 'status:');
  return value && (UI_STAGES as readonly string[]).includes(value) ? value : 'NOVO';
};

const csvCell = (value: string): string => `"${value.replace(/"/g, '""')}"`;

// Parser RFC 4180 suficiente para os CSVs gerados por este módulo: preserva
// vírgulas, aspas escapadas e quebras de linha dentro de campos entre aspas.
const parseCsv = (input: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === ',' && !quoted) {
      row.push(field.trim());
      field = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += char;
  }

  row.push(field.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
};

// Endpoint público (fontes externas: site, Google Ads, planilhas) — autenticado
// por segredo compartilhado, não por sessão de usuário. Ver docs/lgpd.md.
const isValidWebhookSecret = (req: Request): boolean => {
  const secret = process.env.LEAD_WEBHOOK_SECRET;
  if (!secret) return false;
  const provided = req.get('x-webhook-secret');
  if (!provided) return false;
  const providedBuffer = Buffer.from(provided, 'utf8');
  const secretBuffer = Buffer.from(secret, 'utf8');
  return providedBuffer.length === secretBuffer.length
    && timingSafeEqual(providedBuffer, secretBuffer);
};

export const receiveLeadWebhookRoute = async (req: Request, res: Response): Promise<void> => {
  if (!isValidWebhookSecret(req)) {
    jsonError(res, 401, 'Invalid or missing webhook secret');
    return;
  }

  try {
    const body = req.body ?? {};
    const nome = typeof body?.nome === 'string' ? body.nome.trim() : '';
    const telefone = typeof body?.telefone === 'string' ? body.telefone.trim() : '';
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const origem = typeof body?.origem === 'string' ? body.origem.trim() : 'SITE';
    const intencao = typeof body?.intencao === 'string' ? body.intencao.trim() : 'outro';
    const pipeline = typeof body?.pipeline === 'string' ? body.pipeline.trim() : 'dermatologia-clinica';
    const tags = Array.isArray(body?.tags) ? body.tags.filter((t: unknown): t is string => typeof t === 'string') : [];
    const score = typeof body?.score === 'number' ? body.score : 50;

    if (!nome && !telefone && !email) {
      jsonError(res, 400, 'Pelo menos um dos campos (nome, telefone, email) deve ser informado');
      return;
    }
    if (!(CLINICAL_PIPELINES as readonly string[]).includes(pipeline)) {
      jsonError(res, 400, `pipeline deve ser um de: ${CLINICAL_PIPELINES.join(', ')}`);
      return;
    }

    const leadTags = withTagPrefix(withTagPrefix(tags, 'pipeline:', pipeline), 'status:', 'NOVO');

    const lead = await prisma.lead.create({
      data: {
        name: nome || telefone || email,
        phone: telefone || null,
        email: email || null,
        source: origem,
        intent: intencao,
        score,
        tags: leadTags,
      },
    });

    res.status(201).json({ success: true, data: { id: lead.id } });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const exportLeadsCsvRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const pipelineFilter = typeof req.query.pipeline === 'string' && req.query.pipeline !== 'all'
      ? req.query.pipeline
      : undefined;
    const stageFilter = typeof req.query.stage === 'string' && req.query.stage !== 'all'
      ? req.query.stage
      : undefined;

    const leads = await prisma.lead.findMany({
      orderBy: { score: 'desc' },
      select: { id: true, name: true, phone: true, email: true, source: true, intent: true, score: true, temperature: true, tags: true },
    });

    const rows = leads
      .map((lead) => {
        const tags = tagsOf(lead.tags);
        return { lead, tags, stage: stageFromTags(tags), pipeline: valueByPrefix(tags, 'pipeline:') };
      })
      .filter((row) => !pipelineFilter || row.pipeline === pipelineFilter)
      .filter((row) => !stageFilter || row.stage === stageFilter);

    const csvLines = [CSV_HEADERS.map(csvCell).join(',')];
    for (const { lead, tags, stage, pipeline } of rows) {
      csvLines.push([
        lead.id,
        lead.name,
        lead.phone ?? '',
        lead.email ?? '',
        lead.source ?? '',
        lead.intent ?? '',
        stage,
        String(lead.score),
        lead.temperature ?? '',
        pipeline ?? '',
        tags.join('; '),
      ].map((v) => csvCell(String(v))).join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=leads-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(`﻿${csvLines.join('\n')}`);
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

export const importLeadsCsvRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const csvText = typeof req.body?.csv === 'string' ? req.body.csv : '';
    if (!csvText.trim()) {
      jsonError(res, 400, 'CSV vazio');
      return;
    }

    const rows = parseCsv(csvText.trim());
    if (rows.length < 2) {
      jsonError(res, 400, 'CSV deve ter cabeçalho e pelo menos uma linha de dados');
      return;
    }

    const headers = rows[0].map((value, index) => index === 0 ? value.replace(/^\uFEFF/, '') : value);
    const requiredHeaders = ['nome', 'telefone', 'email'];
    const missingHeaders = requiredHeaders.filter((h) => !headers.includes(h));
    if (missingHeaders.length > 0) {
      jsonError(res, 400, `Cabeçalhos obrigatórios ausentes: ${missingHeaders.join(', ')}`);
      return;
    }

    const results = { created: 0, errors: [] as string[] };

    for (let i = 1; i < rows.length; i++) {
      const values = rows[i];
      const row: Record<string, string> = {};
      headers.forEach((h: string, idx: number) => { row[h] = values[idx] ?? ''; });

      try {
        const nome = row.nome ?? '';
        const telefone = row.telefone ?? '';
        const email = row.email ?? '';
        const pipeline = row.pipeline || 'dermatologia-clinica';

        if (!nome && !telefone && !email) {
          results.errors.push(`Linha ${i + 1}: nome, telefone ou email deve ser informado`);
          continue;
        }
        if (!(CLINICAL_PIPELINES as readonly string[]).includes(pipeline)) {
          results.errors.push(`Linha ${i + 1}: pipeline inválido: ${pipeline}`);
          continue;
        }

        const tags = withTagPrefix(
          withTagPrefix(row.tags ? row.tags.split(';').map((t) => t.trim()).filter(Boolean) : [], 'pipeline:', pipeline),
          'status:', 'NOVO',
        );

        await prisma.lead.create({
          data: {
            name: nome || telefone || email,
            phone: telefone || null,
            email: email || null,
            source: row.origem || 'SITE',
            intent: row.intencao || 'outro',
            score: Number.isNaN(Number.parseInt(row.score ?? '', 10))
              ? 50
              : Number.parseInt(row.score ?? '', 10),
            tags,
          },
        });
        results.created++;
      } catch (err) {
        console.error(`[csv-import] linha ${i + 1}:`, (err as Error).message);
        results.errors.push(`Linha ${i + 1}: erro interno ao importar`);
      }
    }

    res.json({ success: true, data: results });
  } catch (error) {
    jsonError(res, 500, (error as Error).message);
  }
};

router.post('/lead', receiveLeadWebhookRoute);
router.get('/leads/export', authMiddleware, exportLeadsCsvRoute);
router.post('/leads/import', authMiddleware, importLeadsCsvRoute);

export default router;
