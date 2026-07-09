import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataApi } from './data';
import {
  audioFormatFromMime,
  isAudioTranscriptionEnabled,
  transcribeAudio,
} from './transcription-client';

const ENV_KEYS = [
  'AUDIO_TRANSCRIPTION_ENABLED',
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'TRANSCRIPTION_MODEL',
  'TRANSCRIPTION_MODEL_FALLBACK',
  'AI_TIMEOUT_MS',
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.OPENROUTER_API_KEY = 'or-key';
  process.env.AUDIO_TRANSCRIPTION_ENABLED = 'true';
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

const dataStub = (): DataApi => ({
  get: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'log-1' }),
  update: vi.fn().mockResolvedValue({ id: 'log-1' }),
});

const okChat = (content: string) => ({
  ok: true,
  status: 200,
  json: async () => ({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  }),
});

describe('audioFormatFromMime', () => {
  it('maps common mime types to input_audio format', () => {
    expect(audioFormatFromMime('audio/ogg; codecs=opus')).toBe('ogg');
    expect(audioFormatFromMime('audio/mpeg')).toBe('mp3');
    expect(audioFormatFromMime('audio/mp4')).toBe('m4a');
    expect(audioFormatFromMime('audio/wav')).toBe('wav');
    expect(audioFormatFromMime('application/octet-stream')).toBe('mp3');
  });
});

describe('isAudioTranscriptionEnabled', () => {
  it('is driven by the env gate (default off)', () => {
    delete process.env.AUDIO_TRANSCRIPTION_ENABLED;
    expect(isAudioTranscriptionEnabled()).toBe(false);
    process.env.AUDIO_TRANSCRIPTION_ENABLED = 'true';
    expect(isAudioTranscriptionEnabled()).toBe(true);
  });
});

describe('transcribeAudio', () => {
  it('returns ok:false and never hits the network when the gate is off', async () => {
    process.env.AUDIO_TRANSCRIPTION_ENABLED = 'false';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await transcribeAudio({ base64: 'AAA', mimeType: 'audio/ogg' });
    expect(res).toEqual({ ok: false, text: '' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts OpenAI-style input_audio content parts and returns the transcription', async () => {
    process.env.TRANSCRIPTION_MODEL = 'google/gemini-2.5-flash';
    const fetchMock = vi.fn().mockResolvedValue(okChat('  Oi, quero agendar botox  '));
    vi.stubGlobal('fetch', fetchMock);
    const data = dataStub();

    const res = await transcribeAudio(
      { base64: 'QUJD', mimeType: 'audio/ogg; codecs=opus' },
      { data, conversationId: 'conv-1', messageId: 'msg-1' },
    );

    expect(res).toEqual({ ok: true, text: 'Oi, quero agendar botox' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer or-key');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('google/gemini-2.5-flash');
    const parts = body.messages[0].content;
    expect(parts[0].type).toBe('text');
    expect(parts[0].text).toMatch(/português do Brasil/i);
    expect(parts[1]).toEqual({
      type: 'input_audio',
      input_audio: { data: 'QUJD', format: 'ogg' },
    });

    // Logs the run in the 'transcription' layer.
    expect(data.create).toHaveBeenCalledWith(
      'aiRunLog',
      expect.objectContaining({ layer: 'transcription', success: true, totalTokens: 120 }),
    );
  });

  it('returns ok:false (never throws) on a non-ok response and logs the failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const data = dataStub();

    const res = await transcribeAudio({ base64: 'QUJD', mimeType: 'audio/ogg' }, { data });
    expect(res).toEqual({ ok: false, text: '' });
    expect(data.create).toHaveBeenCalledWith(
      'aiRunLog',
      expect.objectContaining({ layer: 'transcription', success: false }),
    );
  });

  it('returns ok:false when the model returns empty content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okChat('   ')));
    const res = await transcribeAudio({ base64: 'QUJD', mimeType: 'audio/ogg' });
    expect(res).toEqual({ ok: false, text: '' });
  });

  it('falls back to the second model when the first fails', async () => {
    process.env.TRANSCRIPTION_MODEL = 'primary/model';
    process.env.TRANSCRIPTION_MODEL_FALLBACK = 'fallback/model';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) })
      .mockResolvedValueOnce(okChat('transcrição do fallback'));
    vi.stubGlobal('fetch', fetchMock);

    const res = await transcribeAudio({ base64: 'QUJD', mimeType: 'audio/ogg' });
    expect(res).toEqual({ ok: true, text: 'transcrição do fallback' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe('fallback/model');
  });

  it('returns ok:false without a key', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await transcribeAudio({ base64: 'QUJD', mimeType: 'audio/ogg' });
    expect(res).toEqual({ ok: false, text: '' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
