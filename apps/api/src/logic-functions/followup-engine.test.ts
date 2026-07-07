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
});
