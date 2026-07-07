import { describe, it, expect, vi } from 'vitest';
import type { DataApi } from 'src/lib/data';
import { readLead } from './readLead';
import { readConversationHistory } from './readConversationHistory';
import { listProfessionals } from './listProfessionals';
import { searchKnowledge } from './searchKnowledge';
import { updateLead } from './updateLead';
import { updateConversation } from './updateConversation';
import { assignTag } from './assignTag';
import { createActivity } from './createActivity';
import { metaGraphBreaker, sendWhatsApp } from './sendWhatsApp';
import { handoffToHuman } from './handoffToHuman';
import { tawanyTools, ALL_TOOLS } from './index';

const UUID = '00000000-0000-4000-8000-000000000000';

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
  ...over,
});

describe('read tools', () => {
  it('readLead returns null for missing lead', async () => {
    const r = await readLead.execute({ leadId: UUID }, api());
    expect(JSON.parse(r)).toBeNull();
  });

  it('readLead returns lead when found', async () => {
    const ctx = api({ get: vi.fn().mockResolvedValue({ id: 'abc', score: 75 }) });
    const r = await readLead.execute({ leadId: UUID }, ctx);
    expect(JSON.parse(r)).toEqual({ id: 'abc', score: 75 });
  });

  it('readConversationHistory returns ascending order from chatMessage', async () => {
    const list = vi.fn().mockResolvedValue([{ id: 'm3' }, { id: 'm2' }, { id: 'm1' }]);
    const r = await readConversationHistory.execute({ conversationId: UUID, limit: 3 }, api({ list }));
    expect(list).toHaveBeenCalledWith('chatMessage', expect.objectContaining({ limit: 3 }));
    expect(JSON.parse(r)[0].id).toBe('m1');
  });

  it('listProfessionals filters by UPPER_SNAKE specialty', async () => {
    const list = vi.fn().mockResolvedValue([]);
    await listProfessionals.execute({ specialty: 'CIRURGIA' }, api({ list }));
    expect(list).toHaveBeenCalledWith('professional', expect.objectContaining({
      filter: { active: { eq: true }, specialty: { eq: 'CIRURGIA' } },
    }));
  });

  it('searchKnowledge returns top-3 with fallback', async () => {
    const hit = JSON.parse(await searchKnowledge.execute({ query: 'estacionamento copacabana' }));
    expect(hit[0].id).toBe('endereco-copacabana');
    const fallback = JSON.parse(await searchKnowledge.execute({ query: 'xyzabc' }));
    expect(fallback.length).toBe(3);
  });
});

describe('write tools', () => {
  it('updateLead allows whitelisted fields', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'l1' });
    await updateLead.execute({ leadId: UUID, updates: { score: 75 } }, api({ update }));
    expect(update).toHaveBeenCalledWith('lead', UUID, { score: 75 });
  });

  it('updateLead turns notes into a timeline activity', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'a1' });
    await updateLead.execute({ leadId: UUID, updates: { notes: 'quer agendar' } }, api({ create }));
    expect(create).toHaveBeenCalledWith('activity', {
      targetType: 'lead', targetId: UUID, type: 'NOTE', body: 'quer agendar',
    });
  });

  it('updateConversation updates status', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'c1' });
    await updateConversation.execute({ conversationId: UUID, status: 'RESOLVED' }, api({ update }));
    expect(update).toHaveBeenCalledWith('conversation', UUID, { status: 'RESOLVED' });
  });

  it('assignTag appends to the MULTI_SELECT tags array', async () => {
    const get = vi.fn().mockResolvedValue({ id: UUID, tags: ['NOVO'] });
    const update = vi.fn().mockResolvedValue({ id: UUID });
    await assignTag.execute({ targetType: 'lead', targetId: UUID, tag: 'LEAD_QUENTE' }, api({ get, update }));
    expect(update).toHaveBeenCalledWith('lead', UUID, { tags: ['NOVO', 'LEAD_QUENTE'] });
  });

  it('assignTag is idempotent for existing tag', async () => {
    const get = vi.fn().mockResolvedValue({ id: UUID, tags: ['VIP'] });
    const update = vi.fn();
    const r = await assignTag.execute({ targetType: 'lead', targetId: UUID, tag: 'VIP' }, api({ get, update }));
    expect(JSON.parse(r).unchanged).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });

  it('createActivity writes a real Activity row for the target', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'a1' });
    await createActivity.execute({ targetType: 'conversation', targetId: UUID, body: 'Tawany respondeu' }, api({ create }));
    expect(create).toHaveBeenCalledWith('activity', {
      targetType: 'conversation', targetId: UUID, type: 'NOTE', body: 'Tawany respondeu',
    });
  });

  it('sendWhatsApp records outbound without sending when Meta is not configured', async () => {
    const get = vi.fn().mockResolvedValue({ id: UUID, channel: 'WHATSAPP', externalId: '5511999998888' });
    const create = vi.fn().mockResolvedValue({ id: 'm1' });
    const update = vi.fn().mockResolvedValue({ id: 'c1' });
    const r = await sendWhatsApp.execute({ conversationId: UUID, text: 'Olá' }, api({ get, create, update }));
    expect(create).toHaveBeenCalledWith(
      'chatMessage',
      expect.objectContaining({ direction: 'OUT', body: 'Olá', deliveryStatus: 'PENDING' }),
    );
    expect(JSON.parse(r)).toMatchObject({ ok: true, sent: false, messageId: 'm1' });
  });

  it('sendWhatsApp sends via Meta and stores the wamid when configured', async () => {
    metaGraphBreaker.reset();
    process.env.META_ACCESS_TOKEN = 'tok';
    process.env.META_PHONE_NUMBER_ID = 'phone';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.SENT1' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const get = vi.fn().mockResolvedValue({ id: UUID, channel: 'WHATSAPP', externalId: '5511999998888' });
      const create = vi.fn().mockResolvedValue({ id: 'm2' });
      const r = await sendWhatsApp.execute({ conversationId: UUID, text: 'Olá' }, api({ get, create }));
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(create).toHaveBeenCalledWith(
        'chatMessage',
        expect.objectContaining({ externalId: 'wamid.SENT1', deliveryStatus: 'SENT' }),
      );
      expect(JSON.parse(r)).toMatchObject({ ok: true, sent: true });
    } finally {
      metaGraphBreaker.reset();
      delete process.env.META_ACCESS_TOKEN;
      delete process.env.META_PHONE_NUMBER_ID;
      vi.unstubAllGlobals();
    }
  });

  it('sendWhatsApp short-circuits Meta calls when the breaker is open', async () => {
    metaGraphBreaker.reset();
    process.env.META_ACCESS_TOKEN = 'tok';
    process.env.META_PHONE_NUMBER_ID = 'phone';
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const get = vi.fn().mockResolvedValue({ id: UUID, channel: 'WHATSAPP', externalId: '5511999998888' });
      const ctx = api({ get });
      for (let i = 0; i < 5; i++) {
        await expect(sendWhatsApp.execute({ conversationId: UUID, text: 'Olá' }, ctx)).rejects.toThrow('Meta API error: 500');
      }
      await expect(sendWhatsApp.execute({ conversationId: UUID, text: 'Olá' }, ctx)).rejects.toThrow('circuit_open:meta-graph');
      expect(fetchMock).toHaveBeenCalledTimes(5);
    } finally {
      metaGraphBreaker.reset();
      delete process.env.META_ACCESS_TOKEN;
      delete process.env.META_PHONE_NUMBER_ID;
      vi.unstubAllGlobals();
    }
  });

  it('sendWhatsApp fails cleanly for a missing conversation', async () => {
    const r = await sendWhatsApp.execute({ conversationId: UUID, text: 'Olá' }, api());
    expect(JSON.parse(r)).toMatchObject({ ok: false, error: 'conversation_not_found' });
  });

  it('handoffToHuman sets needsHuman + status', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'c1' });
    await handoffToHuman.execute({ conversationId: UUID, reason: 'urgencia' }, api({ update }));
    expect(update).toHaveBeenCalledWith('conversation', UUID, {
      needsHuman: true,
      handoffReason: 'urgencia',
      status: 'NEEDS_HUMAN',
    });
  });
});

describe('tawanyTools index', () => {
  it('exports 12 LLM-callable tools with OpenAI-compatible schema', () => {
    // sendWhatsApp is now INTERNAL only (handler-side, not model-callable) to
    // prevent the model from sending a free-text reply AND calling sendWhatsApp
    // in the same iteration (double-send).
    expect(ALL_TOOLS).toHaveLength(12);
    for (const entry of tawanyTools.schema) {
      expect(entry.type).toBe('function');
      expect(entry.function.parameters).toHaveProperty('properties');
    }
  });

  it('execute dispatches by name and validates args', async () => {
    const get = vi.fn().mockResolvedValue({ id: 'l1' });
    const r = await tawanyTools.execute('readLead', JSON.stringify({ leadId: UUID }), api({ get }));
    expect(JSON.parse(r).id).toBe('l1');
  });

  it('execute throws on unknown tool and invalid JSON', async () => {
    await expect(tawanyTools.execute('nope', '{}', api())).rejects.toThrow(/Unknown tool/);
    await expect(tawanyTools.execute('readLead', 'not json', api())).rejects.toThrow(/Invalid JSON/);
  });

  it('enum schema carries UPPER_SNAKE values', () => {
    const spec = tawanyTools.schema.find((s) => s.function.name === 'updateLead');
    const params = spec?.function.parameters as { properties: { updates: { properties: { intent: { enum: string[] } } } } };
    expect(params.properties.updates.properties.intent.enum).toContain('CIRURGIA');
  });
});
