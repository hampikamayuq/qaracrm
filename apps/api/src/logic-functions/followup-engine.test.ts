import { describe, expect, it, vi } from 'vitest';
import type { DataApi } from 'src/lib/data';
import { runFollowupEngine } from './followup-engine';

const NOW = new Date('2026-07-07T12:00:00Z');
const OLD = '2026-07-01T12:00:00Z'; // 6 dias atrás
const FRESH = '2026-07-06T12:00:00Z'; // 1 dia atrás

const makeData = (leads: Record<string, unknown>[], tasks: Record<string, unknown>[] = []) => {
  const create = vi.fn(async () => ({ id: 'task-1' }));
  const update = vi.fn(async () => ({}));
  const list = vi.fn(async (object: string) => {
    if (object === 'lead') return leads;
    if (object === 'task') return tasks;
    return [];
  });
  return { data: { list, create, update } as unknown as DataApi, create, update, list };
};

describe('runFollowupEngine', () => {
  it('cria follow-up para lead aberto parado além do limite', async () => {
    const { data, create, update } = makeData([
      { id: 'l1', tags: ['status:qualificado'], updatedAt: OLD, nextActionAt: null, assignedToId: 'u1' },
    ]);
    const r = await runFollowupEngine(NOW, data);
    expect(r.tasksCreated).toBe(1);
    expect(create).toHaveBeenCalledWith('task', expect.objectContaining({
      title: 'Follow-up',
      status: 'OPEN',
      leadId: 'l1',
      assignedToId: 'u1',
    }));
    expect(update).toHaveBeenCalledWith('lead', 'l1', expect.objectContaining({ nextActionAt: expect.any(String) }));
  });

  it('pula leads em estágio fechado (perdido, alta, atendido)', async () => {
    const { data, create } = makeData([
      { id: 'l1', tags: ['status:perdido-preco'], updatedAt: OLD },
      { id: 'l2', tags: ['status:alta-manutencao'], updatedAt: OLD },
      { id: 'l3', tags: ['status:atendido'], updatedAt: OLD },
    ]);
    const r = await runFollowupEngine(NOW, data);
    expect(r.tasksCreated).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('pula lead com movimento recente ou nextActionAt futuro', async () => {
    const { data, create } = makeData([
      { id: 'l1', tags: ['status:novo-lead'], updatedAt: FRESH },
      { id: 'l2', tags: ['status:novo-lead'], updatedAt: OLD, nextActionAt: '2026-07-09T00:00:00Z' },
    ]);
    const r = await runFollowupEngine(NOW, data);
    expect(r.tasksCreated).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('não duplica quando já existe follow-up aberto para o lead', async () => {
    const { data, create } = makeData(
      [{ id: 'l1', tags: ['status:qualificado'], updatedAt: OLD }],
      [{ leadId: 'l1' }],
    );
    const r = await runFollowupEngine(NOW, data);
    expect(r.tasksCreated).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('conta erro sem derrubar o run quando o create falha', async () => {
    const { data, create } = makeData([
      { id: 'l1', tags: ['status:qualificado'], updatedAt: OLD },
      { id: 'l2', tags: ['status:qualificado'], updatedAt: OLD },
    ]);
    create.mockRejectedValueOnce(new Error('db down'));
    const r = await runFollowupEngine(NOW, data);
    expect(r.errors).toBe(1);
    expect(r.tasksCreated).toBe(1);
  });

  it('cria sugestão inteligente e respeita gating híbrido antes de enviar', async () => {
    const data = makeData([
      { id: 'l1', tags: ['status:qualificado'], updatedAt: OLD, assignedToId: 'u1', intent: 'FOLLOWUP' },
    ]).data;
    const list = vi.fn(async (object: string) => {
      if (object === 'lead') return [{ id: 'l1', tags: ['status:qualificado'], updatedAt: OLD, assignedToId: 'u1', intent: 'FOLLOWUP' }];
      if (object === 'task') return [];
      if (object === 'conversation') return [{ id: 'c1', leadId: 'l1', status: 'OPEN' }];
      if (object === 'knowledgeSection') return [{ content: JSON.stringify({ mode: 'hibrido', autopilotIntents: ['FOLLOWUP'] }) }];
      return [];
    });
    const create = vi.fn(async (object: string) => object === 'aiSuggestion' ? { id: 's1' } : { id: 'task-1' });
    const update = vi.fn(async () => ({}));
    const get = vi.fn(async (object: string, id: string) => {
      if (object === 'conversation' && id === 'c1') {
        return { id: 'c1', channel: 'WHATSAPP', externalId: '5511999998888' };
      }
      return null;
    });
    const ai = {
      chat: vi.fn().mockResolvedValue({ content: 'Oi! Posso te ajudar a seguir com o atendimento?', finishReason: 'stop', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }),
    };

    const r = await runFollowupEngine(NOW, { ...data, get, list, create, update }, { ai: ai as never });

    expect(r.tasksCreated).toBe(1);
    expect(create).toHaveBeenCalledWith('aiSuggestion', expect.objectContaining({
      conversationId: 'c1',
      body: 'Oi! Posso te ajudar a seguir com o atendimento?',
      riskLevel: 'low',
      status: 'PENDING',
    }));
    expect(create).toHaveBeenCalledWith('chatMessage', expect.objectContaining({
      conversationId: 'c1',
      direction: 'OUT',
      body: 'Oi! Posso te ajudar a seguir com o atendimento?',
    }));
    expect(update).toHaveBeenCalledWith('aiSuggestion', 's1', { status: 'SENT' });
  });
});
