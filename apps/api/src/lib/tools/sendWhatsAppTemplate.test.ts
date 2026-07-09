import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataApi } from 'src/lib/data';
import { metaGraphBreaker } from './sendWhatsApp';
import { sendWhatsAppTemplate } from './sendWhatsAppTemplate';

const UUID = '00000000-0000-4000-8000-000000000000';

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockResolvedValue({ id: UUID, channel: 'WHATSAPP', externalId: '5511999998888' }),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'm1' }),
  update: vi.fn().mockResolvedValue({ id: 'c1' }),
  ...over,
});

beforeEach(() => {
  metaGraphBreaker.reset();
  delete process.env.META_ACCESS_TOKEN;
  delete process.env.META_PHONE_NUMBER_ID;
  vi.unstubAllGlobals();
});

describe('sendWhatsAppTemplate', () => {
  it('records outbound template without sending when Meta is not configured', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'm1' });
    const ctx = api({ create });

    const result = await sendWhatsAppTemplate.execute({
      conversationId: UUID,
      templateName: 'qara_followup_24h',
      language: 'pt_BR',
    }, ctx);

    expect(create).toHaveBeenCalledWith('chatMessage', expect.objectContaining({
      body: '[template:qara_followup_24h]',
      direction: 'OUT',
      messageType: 'TEMPLATE',
      deliveryStatus: 'PENDING',
    }));
    expect(JSON.parse(result)).toMatchObject({ ok: true, sent: false, messageId: 'm1' });
  });

  it('skips INSTAGRAM conversations without writing a phantom template message', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'm1' });
    const update = vi.fn().mockResolvedValue({ id: 'c1' });
    const get = vi.fn().mockResolvedValue({ id: UUID, channel: 'INSTAGRAM', externalId: 'IGSID-42' });

    const result = await sendWhatsAppTemplate.execute({
      conversationId: UUID,
      templateName: 'qara_followup_24h',
      language: 'pt_BR',
    }, api({ get, create, update }));

    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(JSON.parse(result)).toMatchObject({ ok: false, skipped: true });
  });

  it('sends a Meta template and stores the wamid when configured', async () => {
    process.env.META_ACCESS_TOKEN = 'tok';
    process.env.META_PHONE_NUMBER_ID = 'phone';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.TEMPLATE1' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const create = vi.fn().mockResolvedValue({ id: 'm2' });

    const result = await sendWhatsAppTemplate.execute({
      conversationId: UUID,
      templateName: 'qara_followup_24h',
      language: 'pt_BR',
      parameters: ['Maria'],
    }, api({ create }));

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.type).toBe('template');
    expect(body.template.name).toBe('qara_followup_24h');
    expect(create).toHaveBeenCalledWith('chatMessage', expect.objectContaining({
      externalId: 'wamid.TEMPLATE1',
      deliveryStatus: 'SENT',
    }));
    expect(JSON.parse(result)).toMatchObject({ ok: true, sent: true, messageId: 'm2' });
  });
});
