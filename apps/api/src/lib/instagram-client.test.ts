import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isInstagramSendConfigured, sendViaInstagram } from './instagram-client';

const ENV_KEYS = ['INSTAGRAM_PAGE_ACCESS_TOKEN', 'INSTAGRAM_SEND_ID', 'META_GRAPH_BASE_URL'] as const;
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

describe('isInstagramSendConfigured', () => {
  it('is false without env, true with page access token', () => {
    expect(isInstagramSendConfigured()).toBe(false);
    process.env.INSTAGRAM_PAGE_ACCESS_TOKEN = 't';
    expect(isInstagramSendConfigured()).toBe(true);
  });
});

describe('sendViaInstagram', () => {
  beforeEach(() => {
    process.env.INSTAGRAM_PAGE_ACCESS_TOKEN = 'ig-tok';
  });

  it('POSTs to /me/messages by default and returns the message id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ recipient_id: 'IGSID-42', message_id: 'mid.OUT1' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const messageId = await sendViaInstagram('IGSID-42', 'Olá');
    expect(messageId).toBe('mid.OUT1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v20.0/me/messages');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer ig-tok');
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      recipient: { id: 'IGSID-42' },
      message: { text: 'Olá' },
      messaging_type: 'RESPONSE',
    });
  });

  it('uses INSTAGRAM_SEND_ID and META_GRAPH_BASE_URL overrides', async () => {
    process.env.INSTAGRAM_SEND_ID = '178414';
    process.env.META_GRAPH_BASE_URL = 'http://localhost:9999/v20.0';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message_id: 'mid.X' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await sendViaInstagram('IGSID-1', 'oi');
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:9999/v20.0/178414/messages');
  });

  it('throws on non-ok response without leaking the body text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }),
    );
    await expect(sendViaInstagram('IGSID-1', 'oi')).rejects.toThrow('Instagram API error: 400');
  });

  it('throws when unconfigured', async () => {
    delete process.env.INSTAGRAM_PAGE_ACCESS_TOKEN;
    await expect(sendViaInstagram('IGSID-1', 'oi')).rejects.toThrow(/configurado/);
  });
});
