import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataApi } from './data';

const mocks = vi.hoisted(() => ({
  sendWhatsAppTemplate: {
    execute: vi.fn().mockResolvedValue(JSON.stringify({ ok: true, sent: false })),
  },
}));

vi.mock('./tools/sendWhatsAppTemplate', () => ({
  sendWhatsAppTemplate: mocks.sendWhatsAppTemplate,
}));

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
  ...over,
});

const NOW = new Date('2026-07-10T12:00:00.000Z');
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString();

// lead perdido-sem-resposta com STAGE_CHANGE para perdido há `lostDays`
const listFor = (leadTags: string[], lostDays: number, channel = 'WHATSAPP') =>
  vi.fn().mockImplementation(async (object: string) => {
    if (object === 'lead') {
      return [{ id: 'l1', name: 'Maria', tags: leadTags, updatedAt: daysAgo(lostDays) }];
    }
    if (object === 'activity') {
      return [{
        body: JSON.stringify({ type: 'stage_change', from: 'qualificado', to: 'perdido', at: daysAgo(lostDays) }),
        createdAt: daysAgo(lostDays),
      }];
    }
    if (object === 'conversation') {
      return [{ id: 'c1', channel }];
    }
    return [];
  });

const ENV_KEYS = ['ENABLE_REACTIVATION', 'REACTIVATION_TEMPLATE'] as const;
const savedEnv: Record<string, string | undefined> = {};

describe('runReactivationJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('does nothing when ENABLE_REACTIVATION is not "true" (default off)', async () => {
    const list = vi.fn();
    const { runReactivationJob } = await import('./reactivation');

    const result = await runReactivationJob(api({ list }), NOW);

    expect(list).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppTemplate.execute).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 0, sent: 0 });
  });

  it('queries only perdido-sem-resposta leads without opt-out', async () => {
    process.env.ENABLE_REACTIVATION = 'true';
    const list = vi.fn().mockResolvedValue([]);
    const { runReactivationJob } = await import('./reactivation');

    await runReactivationJob(api({ list }), NOW);

    expect(list).toHaveBeenCalledWith('lead', {
      filter: {
        optedOut: { eq: false },
        tags: { array_contains: ['status:perdido-sem-resposta'] },
      },
      select: { id: true, name: true, tags: true, updatedAt: true },
    });
  });

  it('sends the 30d window template once and tags reativacao:30d', async () => {
    process.env.ENABLE_REACTIVATION = 'true';
    const tags = ['status:perdido-sem-resposta', 'pipeline:unhas'];
    const list = listFor(tags, 35);
    const update = vi.fn().mockResolvedValue({ id: 'l1' });
    const create = vi.fn().mockResolvedValue({ id: 'act' });
    const { runReactivationJob } = await import('./reactivation');

    const result = await runReactivationJob(api({ list, update, create }), NOW);

    expect(mocks.sendWhatsAppTemplate.execute).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'c1', templateName: 'qara_reativacao', parameters: ['Maria'] }),
      expect.any(Object),
    );
    expect(update).toHaveBeenCalledWith('lead', 'l1', { tags: [...tags, 'reativacao:30d'] });
    expect(create).toHaveBeenCalledWith('activity', expect.objectContaining({ type: 'REACTIVATION' }));
    expect(result).toEqual({ checked: 1, sent: 1 });
  });

  it('does not resend the 30d window and waits for 60d', async () => {
    process.env.ENABLE_REACTIVATION = 'true';
    const list = listFor(['status:perdido-sem-resposta', 'reativacao:30d'], 45);
    const { runReactivationJob } = await import('./reactivation');

    const result = await runReactivationJob(api({ list }), NOW);

    expect(mocks.sendWhatsAppTemplate.execute).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, sent: 0 });
  });

  it('sends the 60d window after the 30d one', async () => {
    process.env.ENABLE_REACTIVATION = 'true';
    const tags = ['status:perdido-sem-resposta', 'reativacao:30d'];
    const list = listFor(tags, 61);
    const update = vi.fn().mockResolvedValue({ id: 'l1' });
    const { runReactivationJob } = await import('./reactivation');

    const result = await runReactivationJob(api({ list, update }), NOW);

    expect(update).toHaveBeenCalledWith('lead', 'l1', { tags: [...tags, 'reativacao:60d'] });
    expect(result).toEqual({ checked: 1, sent: 1 });
  });

  it('lead entering the backlog already past 60d gets a single message (60d window)', async () => {
    process.env.ENABLE_REACTIVATION = 'true';
    const tags = ['status:perdido-sem-resposta'];
    const list = listFor(tags, 90);
    const update = vi.fn().mockResolvedValue({ id: 'l1' });
    const { runReactivationJob } = await import('./reactivation');

    const result = await runReactivationJob(api({ list, update }), NOW);

    expect(mocks.sendWhatsAppTemplate.execute).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('lead', 'l1', { tags: [...tags, 'reativacao:60d'] });
    expect(result).toEqual({ checked: 1, sent: 1 });
  });

  it('skips leads whose 60d window was already used (cycle finished)', async () => {
    process.env.ENABLE_REACTIVATION = 'true';
    const list = listFor(['status:perdido-sem-resposta', 'reativacao:30d', 'reativacao:60d'], 90);
    const { runReactivationJob } = await import('./reactivation');

    const result = await runReactivationJob(api({ list }), NOW);

    expect(mocks.sendWhatsAppTemplate.execute).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, sent: 0 });
  });

  it('skips leads lost less than 30 days ago', async () => {
    process.env.ENABLE_REACTIVATION = 'true';
    const list = listFor(['status:perdido-sem-resposta'], 10);
    const { runReactivationJob } = await import('./reactivation');

    const result = await runReactivationJob(api({ list }), NOW);

    expect(mocks.sendWhatsAppTemplate.execute).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, sent: 0 });
  });

  it('skips Instagram conversations (no template, no window tag)', async () => {
    process.env.ENABLE_REACTIVATION = 'true';
    const list = listFor(['status:perdido-sem-resposta'], 35, 'INSTAGRAM');
    const update = vi.fn();
    const { runReactivationJob } = await import('./reactivation');

    const result = await runReactivationJob(api({ list, update }), NOW);

    expect(mocks.sendWhatsAppTemplate.execute).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, sent: 0 });
  });

  it('honors a custom REACTIVATION_TEMPLATE name', async () => {
    process.env.ENABLE_REACTIVATION = 'true';
    process.env.REACTIVATION_TEMPLATE = 'custom_reativacao';
    const list = listFor(['status:perdido-sem-resposta'], 35);
    const update = vi.fn().mockResolvedValue({ id: 'l1' });
    const { runReactivationJob } = await import('./reactivation');

    await runReactivationJob(api({ list, update }), NOW);

    expect(mocks.sendWhatsAppTemplate.execute).toHaveBeenCalledWith(
      expect.objectContaining({ templateName: 'custom_reativacao' }),
      expect.any(Object),
    );
  });

  it('falls back to lead.updatedAt when there is no stage_change activity', async () => {
    process.env.ENABLE_REACTIVATION = 'true';
    const list = vi.fn().mockImplementation(async (object: string) => {
      if (object === 'lead') {
        return [{ id: 'l1', name: 'Maria', tags: ['status:perdido-sem-resposta'], updatedAt: daysAgo(40) }];
      }
      if (object === 'activity') return [];
      if (object === 'conversation') return [{ id: 'c1', channel: 'WHATSAPP' }];
      return [];
    });
    const update = vi.fn().mockResolvedValue({ id: 'l1' });
    const { runReactivationJob } = await import('./reactivation');

    const result = await runReactivationJob(api({ list, update }), NOW);

    expect(result).toEqual({ checked: 1, sent: 1 });
  });
});

describe('maybeReopenReactivatedLead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reopens a reactivated lost lead into the reativacao pipeline as novo-lead', async () => {
    const get = vi.fn().mockResolvedValue({
      id: 'l1',
      tags: ['status:perdido-sem-resposta', 'pipeline:unhas', 'reativacao:30d'],
    });
    const update = vi.fn().mockResolvedValue({ id: 'l1' });
    const create = vi.fn().mockResolvedValue({ id: 'act' });
    const { maybeReopenReactivatedLead } = await import('./reactivation');

    const reopened = await maybeReopenReactivatedLead('l1', api({ get, update, create }));

    expect(reopened).toBe(true);
    expect(update).toHaveBeenCalledWith('lead', 'l1', {
      tags: ['reativacao:30d', 'status:novo-lead', 'pipeline:reativacao'],
    });
    expect(create).toHaveBeenCalledWith('activity', expect.objectContaining({
      type: 'STAGE_CHANGE',
      targetId: 'l1',
    }));
  });

  it('does nothing for leads that are not perdido', async () => {
    const get = vi.fn().mockResolvedValue({ id: 'l1', tags: ['status:qualificado', 'reativacao:30d'] });
    const update = vi.fn();
    const { maybeReopenReactivatedLead } = await import('./reactivation');

    const reopened = await maybeReopenReactivatedLead('l1', api({ get, update }));

    expect(reopened).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('does nothing for lost leads that never received a reactivation message', async () => {
    const get = vi.fn().mockResolvedValue({ id: 'l1', tags: ['status:perdido-sem-resposta'] });
    const update = vi.fn();
    const { maybeReopenReactivatedLead } = await import('./reactivation');

    const reopened = await maybeReopenReactivatedLead('l1', api({ get, update }));

    expect(reopened).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('does nothing when the lead does not exist', async () => {
    const update = vi.fn();
    const { maybeReopenReactivatedLead } = await import('./reactivation');

    const reopened = await maybeReopenReactivatedLead('ghost', api({ update }));

    expect(reopened).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
