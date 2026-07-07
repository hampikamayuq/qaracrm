import { describe, expect, it, vi } from 'vitest';
import type { DataApi } from 'src/lib/data';
import { buildTawanyContext } from './context';

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
  ...over,
});

describe('buildTawanyContext', () => {
  it('throws when the conversation does not exist', async () => {
    await expect(buildTawanyContext('missing', api())).rejects.toThrow('Conversation not found');
  });

  it('builds context using only real Lead/Service fields (no ghost fields)', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ leadId: 'lead-1' }) // conversation
      .mockResolvedValueOnce({ id: 'lead-1', name: 'Maria Silva', phone: '+5521999999999', stageId: 'stage-1', score: 80, intent: 'agendar', tags: ['VIP'] }) // lead
      .mockResolvedValueOnce({ name: 'QUALIFICADO' }); // pipelineStage
    const list = vi.fn()
      .mockResolvedValueOnce([{ id: 'm1', direction: 'IN', body: 'Oi', sentAt: '2026-07-01T00:00:00.000Z' }]) // chatMessage
      .mockResolvedValueOnce([{ priceCents: 45000 }, { priceCents: 55000 }]); // service

    const ctx = await buildTawanyContext('conv-1', api({ get, list }));

    expect(ctx.lead).toEqual({
      id: 'lead-1', name: 'Maria Silva', phone: '+5521999999999',
      stage: 'QUALIFICADO', score: 80, intent: 'agendar', tags: ['VIP'],
    });
    expect(ctx.knownPrices).toEqual([45000, 55000]);
    expect(ctx.recentMessages).toEqual([{ id: 'm1', direction: 'IN', body: 'Oi', sentAt: '2026-07-01T00:00:00.000Z' }]);
    expect(ctx.summary).toBeNull();

    // Nenhuma chamada usa campos fantasmas (whatsapp, name aninhado, summary, *PriceCents)
    expect(get).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ whatsapp: true }));
  });

  it('returns lead: null when the conversation has no leadId yet', async () => {
    const get = vi.fn().mockResolvedValueOnce({ leadId: null });
    const ctx = await buildTawanyContext('conv-2', api({ get }));
    expect(ctx.lead).toBeNull();
  });

  it('carrega o summary pré-computado da conversation quando existe', async () => {
    const get = vi.fn().mockResolvedValueOnce({ leadId: null, summary: 'Paciente quer agendar unhas.' });
    const ctx = await buildTawanyContext('conv-3', api({ get }));
    expect(ctx.summary).toBe('Paciente quer agendar unhas.');
    expect(get).toHaveBeenCalledWith('conversation', 'conv-3', expect.objectContaining({ summary: true }));
  });
});
