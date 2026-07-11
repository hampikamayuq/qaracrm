import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectEvolutionInstance,
  createEvolutionInstance,
  getEvolutionConnectionState,
  getEvolutionMediaBase64,
  isEvolutionConfigured,
  mapEvolutionState,
  sendEvolutionText,
} from './evolution-client';

const ENV_KEYS = [
  'EVOLUTION_BASE_URL',
  'EVOLUTION_API_KEY',
  'EVOLUTION_WEBHOOK_SECRET',
  'EVOLUTION_WEBHOOK_URL',
] as const;
const saved: Record<string, string | undefined> = {};

const setEnv = () => {
  process.env.EVOLUTION_BASE_URL = 'http://evo.local:8080';
  process.env.EVOLUTION_API_KEY = 'dev-key';
  process.env.EVOLUTION_WEBHOOK_SECRET = 'whsec';
  process.env.EVOLUTION_WEBHOOK_URL = 'https://crm.example/api/webhooks/evolution';
};

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

const stubFetch = (json: unknown, ok = true, status = 200) => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => json,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('isEvolutionConfigured', () => {
  it('is false without env, true with all four vars', () => {
    expect(isEvolutionConfigured()).toBe(false);
    setEnv();
    expect(isEvolutionConfigured()).toBe(true);
  });
});

describe('createEvolutionInstance', () => {
  it('POSTs /instance/create with baileys integration + webhook config (base64:false, secret header)', async () => {
    setEnv();
    const fetchMock = stubFetch({ instance: { instanceName: 'qara-recepcao' } });
    await createEvolutionInstance('qara-recepcao');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://evo.local:8080/instance/create',
      expect.objectContaining({ method: 'POST' }),
    );
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string>; body: string };
    expect(init.headers.apikey).toBe('dev-key');
    expect(JSON.parse(init.body)).toEqual({
      instanceName: 'qara-recepcao',
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      webhook: {
        url: 'https://crm.example/api/webhooks/evolution',
        base64: false,
        headers: { 'x-webhook-secret': 'whsec' },
        events: ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT'],
      },
    });
  });

  it('throws without env', async () => {
    await expect(createEvolutionInstance('x')).rejects.toThrow('Evolution não configurado');
  });
});

describe('connectEvolutionInstance', () => {
  it('returns the QR base64 from GET /instance/connect', async () => {
    setEnv();
    const fetchMock = stubFetch({ base64: 'data:image/png;base64,QR==', code: 'raw' });
    const result = await connectEvolutionInstance('qara-recepcao');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://evo.local:8080/instance/connect/qara-recepcao',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toEqual({ qrBase64: 'data:image/png;base64,QR==', pairingCode: null });
  });

  it('tolerates responses without base64 (already connected)', async () => {
    setEnv();
    stubFetch({});
    expect(await connectEvolutionInstance('x')).toEqual({ qrBase64: null, pairingCode: null });
  });
});

describe('connection state', () => {
  it('maps open/connecting/close to CONNECTED/PAIRING/DISCONNECTED', () => {
    expect(mapEvolutionState('open')).toBe('CONNECTED');
    expect(mapEvolutionState('connecting')).toBe('PAIRING');
    expect(mapEvolutionState('close')).toBe('DISCONNECTED');
    expect(mapEvolutionState('weird')).toBeNull();
    expect(mapEvolutionState(undefined)).toBeNull();
  });

  it('reads instance.state from GET /instance/connectionState', async () => {
    setEnv();
    stubFetch({ instance: { instanceName: 'x', state: 'open' } });
    expect(await getEvolutionConnectionState('x')).toBe('CONNECTED');
  });
});

describe('sendEvolutionText', () => {
  it('POSTs /message/sendText and returns key.id', async () => {
    setEnv();
    const fetchMock = stubFetch({ key: { id: 'EVOMSG1', remoteJid: '5511@s.whatsapp.net' } });
    const id = await sendEvolutionText('qara-recepcao', '5511999998888', 'Olá');
    expect(id).toBe('EVOMSG1');
    const init = fetchMock.mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body)).toEqual({ number: '5511999998888', text: 'Olá' });
  });

  it('throws on HTTP error and on missing id', async () => {
    setEnv();
    stubFetch({}, false, 500);
    await expect(sendEvolutionText('x', '55', 'oi')).rejects.toThrow('Evolution API error: 500');
    stubFetch({ key: {} });
    await expect(sendEvolutionText('x', '55', 'oi')).rejects.toThrow('sem message id');
  });
});

describe('getEvolutionMediaBase64', () => {
  it('POSTs the message key and returns base64 + mimetype', async () => {
    setEnv();
    const fetchMock = stubFetch({ base64: 'AUDIO==', mimetype: 'audio/ogg; codecs=opus' });
    const media = await getEvolutionMediaBase64('inst', { id: 'M1', remoteJid: 'x', fromMe: false });
    expect(media).toEqual({ base64: 'AUDIO==', mimeType: 'audio/ogg; codecs=opus' });
    const init = fetchMock.mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body)).toEqual({
      message: { key: { id: 'M1', remoteJid: 'x', fromMe: false } },
      convertToMp4: false,
    });
  });

  it('throws when media has no base64', async () => {
    setEnv();
    stubFetch({});
    await expect(getEvolutionMediaBase64('inst', { id: 'M1' })).rejects.toThrow('mídia sem base64');
  });
});
