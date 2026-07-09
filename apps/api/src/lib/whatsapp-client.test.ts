import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMetaPayload, isMetaSendConfigured, sendViaMeta } from './whatsapp-client';

const ENV_KEYS = ['META_ACCESS_TOKEN', 'META_PHONE_NUMBER_ID', 'META_GRAPH_BASE_URL'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe('isMetaSendConfigured', () => {
  it('is false without env, true with token + phone id', () => {
    expect(isMetaSendConfigured()).toBe(false);
    process.env.META_ACCESS_TOKEN = 't';
    process.env.META_PHONE_NUMBER_ID = 'p';
    expect(isMetaSendConfigured()).toBe(true);
  });
});

describe('buildMetaPayload', () => {
  it('builds a text payload by default', () => {
    expect(buildMetaPayload('5511999998888', 'Olá')).toEqual({
      messaging_product: 'whatsapp',
      to: '5511999998888',
      type: 'text',
      text: { body: 'Olá' },
    });
  });

  it('builds a buttons payload (max 3 reply buttons)', () => {
    const p = buildMetaPayload('551', 'Confirma?', {
      messageType: 'buttons',
      buttons: [
        { id: 'y', title: 'Sim' },
        { id: 'n', title: 'Não' },
      ],
    });
    expect(p.type).toBe('interactive');
    expect(p.interactive).toEqual({
      type: 'button',
      body: { text: 'Confirma?' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'y', title: 'Sim' } },
          { type: 'reply', reply: { id: 'n', title: 'Não' } },
        ],
      },
    });
  });

  it('builds a list payload', () => {
    const p = buildMetaPayload('551', 'Escolha um serviço', {
      messageType: 'list',
      listButtonText: 'Serviços',
      listSections: [{ title: 'Estética', rows: [{ id: 's1', title: 'Botox' }] }],
    });
    expect(p.type).toBe('interactive');
    expect(p.interactive).toEqual({
      type: 'list',
      body: { text: 'Escolha um serviço' },
      action: {
        button: 'Serviços',
        sections: [{ title: 'Estética', rows: [{ id: 's1', title: 'Botox' }] }],
      },
    });
  });

  it('builds a template payload with body parameters', () => {
    const p = buildMetaPayload('551', '', {
      messageType: 'template',
      templateName: 'lembrete_consulta',
      parameters: ['Maria', 'sexta 14h'],
    });
    expect(p.type).toBe('template');
    expect(p.template).toEqual({
      name: 'lembrete_consulta',
      language: { code: 'pt_BR' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Maria' },
            { type: 'text', text: 'sexta 14h' },
          ],
        },
      ],
    });
  });

  it('builds a template payload with no components when there are no parameters or buttons', () => {
    const p = buildMetaPayload('551', '', {
      messageType: 'template',
      templateName: 'qara_appointment_reminder_d1',
    });
    expect(p.template).toEqual({
      name: 'qara_appointment_reminder_d1',
      language: { code: 'pt_BR' },
      components: [],
    });
  });

  it('builds a template payload with quick-reply button components (payload per button)', () => {
    const p = buildMetaPayload('551', '', {
      messageType: 'template',
      templateName: 'qara_appointment_reminder_d1',
      buttonPayloads: ['confirm_apt_a1', 'reschedule_apt_a1'],
    });
    expect(p.type).toBe('template');
    expect(p.template).toEqual({
      name: 'qara_appointment_reminder_d1',
      language: { code: 'pt_BR' },
      components: [
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: '0',
          parameters: [{ type: 'payload', payload: 'confirm_apt_a1' }],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: '1',
          parameters: [{ type: 'payload', payload: 'reschedule_apt_a1' }],
        },
      ],
    });
  });

  it('builds a template payload with body parameters AND quick-reply buttons together', () => {
    const p = buildMetaPayload('551', '', {
      messageType: 'template',
      templateName: 'qara_appointment_reminder_d1',
      parameters: ['Maria'],
      buttonPayloads: ['confirm_apt_a1', 'reschedule_apt_a1'],
    });
    expect(p.template).toEqual({
      name: 'qara_appointment_reminder_d1',
      language: { code: 'pt_BR' },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: 'Maria' }] },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: '0',
          parameters: [{ type: 'payload', payload: 'confirm_apt_a1' }],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: '1',
          parameters: [{ type: 'payload', payload: 'reschedule_apt_a1' }],
        },
      ],
    });
  });
});

describe('sendViaMeta', () => {
  beforeEach(() => {
    process.env.META_ACCESS_TOKEN = 'tok-1';
    process.env.META_PHONE_NUMBER_ID = 'phone-1';
  });

  it('POSTs to the Graph API and returns the wamid', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.NEW1' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const wamid = await sendViaMeta('5511999998888', 'Olá');
    expect(wamid).toBe('wamid.NEW1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v20.0/phone-1/messages');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok-1');
    expect(JSON.parse(init.body).text.body).toBe('Olá');
  });

  it('respects META_GRAPH_BASE_URL override', async () => {
    process.env.META_GRAPH_BASE_URL = 'http://localhost:9999/v20.0';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.X' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await sendViaMeta('551', 'oi');
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:9999/v20.0/phone-1/messages');
  });

  it('throws on non-ok response without leaking the body text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    );
    await expect(sendViaMeta('551', 'oi')).rejects.toThrow('Meta API error: 401');
  });

  it('throws when unconfigured', async () => {
    delete process.env.META_ACCESS_TOKEN;
    await expect(sendViaMeta('551', 'oi')).rejects.toThrow(/configurado/);
  });

  it('sends the D-1 reminder template with quick-reply button payloads (exact wire payload)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.D1' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendViaMeta('5511999998888', '', {
      messageType: 'template',
      templateName: 'qara_appointment_reminder_d1',
      languageCode: 'pt_BR',
      buttonPayloads: ['confirm_apt_appt-1', 'reschedule_apt_appt-1'],
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      to: '5511999998888',
      type: 'template',
      template: {
        name: 'qara_appointment_reminder_d1',
        language: { code: 'pt_BR' },
        components: [
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: '0',
            parameters: [{ type: 'payload', payload: 'confirm_apt_appt-1' }],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: '1',
            parameters: [{ type: 'payload', payload: 'reschedule_apt_appt-1' }],
          },
        ],
      },
    });
  });
});
