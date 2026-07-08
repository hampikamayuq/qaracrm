import type { AiClient } from '../ai-client';
import { validateReply } from '../guards/reply-validator';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type GoldenCase = {
  id: string;
  user: string;
  shouldPass?: boolean;
  expectedGuardOk?: boolean;
  mustIncludeAny?: string[];
  mustNotInclude?: string[];
};

export type GoldenSetResult = {
  total: number;
  passed: number;
  failed: number;
  results: Array<{
    id: string;
    ok: boolean;
    guardOk: boolean;
    guardReason?: string;
    reply: string;
    contentFailures: string[];
  }>;
};

const DEFAULT_FIXTURE_PATHS = [
  path.join(process.cwd(), 'src/lib/tawany/golden-cases.json'),
  path.join(__dirname, 'golden-cases.json'),
];

const expectedGuardOk = (item: GoldenCase): boolean =>
  item.expectedGuardOk ?? item.shouldPass ?? true;

const includesAny = (reply: string, terms: string[] | undefined): boolean => {
  if (!terms || terms.length === 0) return true;
  const lower = reply.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
};

const includesForbidden = (reply: string, terms: string[] | undefined): string | null => {
  if (!terms || terms.length === 0) return null;
  const lower = reply.toLowerCase();
  return terms.find((term) => lower.includes(term.toLowerCase())) ?? null;
};

const evaluateContent = (reply: string, item: GoldenCase): string[] => {
  const failures: string[] = [];
  if (!includesAny(reply, item.mustIncludeAny)) {
    failures.push('missing_required_term');
  }
  const forbidden = includesForbidden(reply, item.mustNotInclude);
  if (forbidden) {
    failures.push(`forbidden_term:${forbidden}`);
  }
  return failures;
};

const readFirstExisting = async (fixturePaths: string[]): Promise<string> => {
  let lastError: unknown = null;
  for (const fixturePath of fixturePaths) {
    try {
      return await readFile(fixturePath, 'utf8');
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('golden_cases_not_found');
};

export const loadGoldenCases = async (fixturePath?: string): Promise<GoldenCase[]> => {
  const raw = await readFirstExisting(fixturePath ? [fixturePath] : DEFAULT_FIXTURE_PATHS);
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('golden_cases_invalid: expected array');
  }
  return parsed.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`golden_cases_invalid: item ${index}`);
    }
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== 'string' || typeof rec.user !== 'string') {
      throw new Error(`golden_cases_invalid: item ${index}`);
    }
    return {
      id: rec.id,
      user: rec.user,
      expectedGuardOk: typeof rec.expectedGuardOk === 'boolean' ? rec.expectedGuardOk : true,
      mustIncludeAny: Array.isArray(rec.mustIncludeAny)
        ? rec.mustIncludeAny.filter((v): v is string => typeof v === 'string')
        : undefined,
      mustNotInclude: Array.isArray(rec.mustNotInclude)
        ? rec.mustNotInclude.filter((v): v is string => typeof v === 'string')
        : undefined,
    };
  });
};

export const runGoldenSet = async (params: {
  ai: AiClient;
  cases: GoldenCase[];
  knownPrices?: number[];
  system?: string;
}): Promise<GoldenSetResult> => {
  const results: GoldenSetResult['results'] = [];
  for (const item of params.cases) {
    const res = await params.ai.chat({
      model: process.env.DEFAULT_MODEL_PATIENT ?? 'minimax/minimax-m3',
      system: params.system ?? 'Você é Tawany. Responda com segurança.',
      messages: [{ role: 'user', content: item.user }],
    });
    const reply = res.content ?? '';
    const guard = validateReply(reply, { knownPrices: params.knownPrices ?? [] });
    const guardOk = guard.ok;
    const contentFailures = evaluateContent(reply, item);
    results.push({
      id: item.id,
      ok: guardOk === expectedGuardOk(item) && contentFailures.length === 0,
      guardOk,
      ...(guard.ok ? {} : { guardReason: guard.reason }),
      reply,
      contentFailures,
    });
  }
  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results };
};

const preview = (text: string): string => {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= 120 ? oneLine : `${oneLine.slice(0, 117)}...`;
};

export const formatGoldenSetReport = (result: GoldenSetResult): string => {
  const status = result.failed === 0 ? 'PASSED' : 'FAILED';
  const lines = [
    `# Tawany Golden Set ${status}`,
    `- Total: ${result.total}`,
    `- Passed: ${result.passed}`,
    `- Failed: ${result.failed}`,
  ];
  for (const item of result.results) {
    if (item.ok) {
      lines.push(`- PASS ${item.id}`);
      continue;
    }
    const reasons = [
      item.guardOk ? null : item.guardReason ?? 'guard_failed',
      ...item.contentFailures,
    ].filter((value): value is string => Boolean(value));
    lines.push(`- FAIL ${item.id}: ${reasons.join(', ') || 'unexpected_result'}; reply="${preview(item.reply)}"`);
  }
  return lines.join('\n');
};

export const assertGoldenSetPassed = (result: GoldenSetResult): void => {
  if (result.failed > 0) {
    throw new Error(`golden_set_failed: ${result.failed}/${result.total}`);
  }
};
