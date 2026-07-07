import { describe, expect, it, vi } from 'vitest';
import type { DataApi } from 'src/lib/data';
import { checkBotFaq } from './checkBotFaq';

const flow = {
  mode: 'first-match',
  match: 'normalized-contains',
  rules: [{ terms: ['Quanto custa a consulta'], responses: ['Os valores variam por médico e unidade.'] }],
};

const api = (bots: unknown[]): DataApi => ({
  get: vi.fn(),
  list: vi.fn().mockResolvedValue(bots),
  create: vi.fn(),
  update: vi.fn(),
});

describe('checkBotFaq tool', () => {
  it('returns the ready-made response when an active bot matches the query', async () => {
    const ctx = api([{ id: 'bot-1', name: 'Leads novos', steps: flow, createdAt: new Date() }]);
    const result = JSON.parse(await checkBotFaq.execute({ query: 'quanto custa a consulta?' }, ctx));
    expect(result).toEqual({
      matched: true,
      botName: 'Leads novos',
      responses: ['Os valores variam por médico e unidade.'],
    });
  });

  it('reports no match when nothing casa (Tawany should answer on its own)', async () => {
    const ctx = api([{ id: 'bot-1', name: 'Leads novos', steps: flow, createdAt: new Date() }]);
    const result = JSON.parse(await checkBotFaq.execute({ query: 'estou com dor intensa e febre' }, ctx));
    expect(result).toEqual({ matched: false });
  });

  it('reports no match when there are no active bots', async () => {
    const ctx = api([]);
    const result = JSON.parse(await checkBotFaq.execute({ query: 'qualquer coisa' }, ctx));
    expect(result).toEqual({ matched: false });
  });
});
