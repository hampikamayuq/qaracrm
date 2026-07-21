import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataApi } from './data';

const mocks = vi.hoisted(() => ({
  isKommoConfigured: vi.fn().mockReturnValue(true),
  listKommoLeadsUpdatedSince: vi.fn().mockResolvedValue([]),
  findLeadByKommoId: vi.fn().mockResolvedValue(null),
  applyKommoStage: vi.fn().mockResolvedValue(false),
}));

vi.mock('./kommo-client', () => ({
  isKommoConfigured: mocks.isKommoConfigured,
  listKommoLeadsUpdatedSince: mocks.listKommoLeadsUpdatedSince,
  kommoBreaker: { execute: (fn: () => unknown) => fn() },
}));

vi.mock('../logic-functions/kommo-webhook', () => ({
  findLeadByKommoId: mocks.findLeadByKommoId,
  applyKommoStage: mocks.applyKommoStage,
}));

const { resetKommoReconcileClock, runKommoReconcileJob } = await import('./kommo-sync');

const api = (): DataApi => ({
  get: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
});

beforeEach(() => {
  vi.clearAllMocks();
  resetKommoReconcileClock();
  mocks.isKommoConfigured.mockReturnValue(true);
  process.env.ENABLE_KOMMO_SYNC = 'true';
});

afterEach(() => {
  delete process.env.ENABLE_KOMMO_SYNC;
});

describe('runKommoReconcileJob', () => {
  it('desligado sem ENABLE_KOMMO_SYNC ou sem config', async () => {
    delete process.env.ENABLE_KOMMO_SYNC;
    expect(await runKommoReconcileJob(api())).toEqual({ checked: 0, updated: 0 });
    expect(mocks.listKommoLeadsUpdatedSince).not.toHaveBeenCalled();

    process.env.ENABLE_KOMMO_SYNC = 'true';
    mocks.isKommoConfigured.mockReturnValue(false);
    expect(await runKommoReconcileJob(api())).toEqual({ checked: 0, updated: 0 });
    expect(mocks.listKommoLeadsUpdatedSince).not.toHaveBeenCalled();
  });

  it('re-aplica estágio só em leads já vinculados e conta os movidos', async () => {
    mocks.listKommoLeadsUpdatedSince.mockResolvedValueOnce([
      { id: '123', name: 'Maria', statusId: '55', pipelineId: '7', updatedAt: 1752000100 },
      { id: '999', name: 'Sem vínculo', statusId: '55', pipelineId: '7', updatedAt: 1752000200 },
    ]);
    mocks.findLeadByKommoId
      .mockResolvedValueOnce({ id: 'lead-1', tags: [] })
      .mockResolvedValueOnce(null);
    mocks.applyKommoStage.mockResolvedValueOnce(true);

    const result = await runKommoReconcileJob(api(), new Date(1752000300 * 1000));

    expect(result).toEqual({ checked: 2, updated: 1 });
    expect(mocks.applyKommoStage).toHaveBeenCalledTimes(1);
    expect(mocks.applyKommoStage).toHaveBeenCalledWith(expect.anything(), { id: 'lead-1', tags: [] }, '55', '7');
  });

  it('faz throttle: segunda chamada dentro de 5min não consulta a API', async () => {
    const now = new Date(1752000300 * 1000);
    await runKommoReconcileJob(api(), now);
    expect(mocks.listKommoLeadsUpdatedSince).toHaveBeenCalledTimes(1);

    await runKommoReconcileJob(api(), new Date(now.getTime() + 60_000));
    expect(mocks.listKommoLeadsUpdatedSince).toHaveBeenCalledTimes(1);

    await runKommoReconcileJob(api(), new Date(now.getTime() + 6 * 60_000));
    expect(mocks.listKommoLeadsUpdatedSince).toHaveBeenCalledTimes(2);
  });

  it('falha da API é non-fatal e não avança o cursor', async () => {
    mocks.listKommoLeadsUpdatedSince.mockRejectedValueOnce(new Error('api down'));
    const result = await runKommoReconcileJob(api(), new Date(1752000300 * 1000));
    expect(result).toEqual({ checked: 0, updated: 0 });
  });
});
