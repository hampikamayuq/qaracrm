import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadDirectMedia, downloadWhatsAppMedia } from './media-client';

const ENV_KEYS = [
  'WHATSAPP_ACCESS_TOKEN',
  'META_ACCESS_TOKEN',
  'META_GRAPH_BASE_URL',
  'AUDIO_MAX_BYTES',
  'AUDIO_DOWNLOAD_TIMEOUT_MS',
] as const;
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

const okJson = (body: unknown, headers: Record<string, string> = {}) => ({
  ok: true,
  status: 200,
  headers: new Headers(headers),
  json: async () => body,
});
const okBinary = (bytes: Uint8Array, headers: Record<string, string> = {}) => ({
  ok: true,
  status: 200,
  headers: new Headers(headers),
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
});

describe('downloadWhatsAppMedia', () => {
  beforeEach(() => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'wa-tok';
  });

  it('does the two-step download (id -> url -> binary) with Bearer on both', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ url: 'https://cdn.example/media.ogg', mime_type: 'audio/ogg' }))
      .mockResolvedValueOnce(okBinary(bytes, { 'content-type': 'audio/ogg; codecs=opus' }));
    vi.stubGlobal('fetch', fetchMock);

    const media = await downloadWhatsAppMedia('MEDIA-123');

    expect(media.sizeBytes).toBe(4);
    expect(media.mimeType).toBe('audio/ogg');
    expect(Buffer.from(media.base64, 'base64')).toEqual(Buffer.from(bytes));

    const [metaUrl, metaInit] = fetchMock.mock.calls[0];
    expect(metaUrl).toBe('https://graph.facebook.com/v20.0/MEDIA-123');
    expect(metaInit.headers.Authorization).toBe('Bearer wa-tok');
    const [binUrl, binInit] = fetchMock.mock.calls[1];
    expect(binUrl).toBe('https://cdn.example/media.ogg');
    expect(binInit.headers.Authorization).toBe('Bearer wa-tok');
  });

  it('falls back to META_ACCESS_TOKEN when WHATSAPP_ACCESS_TOKEN is unset', async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    process.env.META_ACCESS_TOKEN = 'meta-tok';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ url: 'https://cdn.example/a.ogg' }))
      .mockResolvedValueOnce(okBinary(new Uint8Array([9])));
    vi.stubGlobal('fetch', fetchMock);
    await downloadWhatsAppMedia('m1');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer meta-tok');
  });

  it('throws a legible error when unconfigured (no token)', async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.META_ACCESS_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(downloadWhatsAppMedia('m1')).rejects.toThrow(/não configurado/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts on file_size over AUDIO_MAX_BYTES from metadata (never fetches the binary)', async () => {
    process.env.AUDIO_MAX_BYTES = '10';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ url: 'https://cdn.example/big.ogg', file_size: 999 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(downloadWhatsAppMedia('m1')).rejects.toThrow(/too large/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts when the downloaded buffer exceeds the limit', async () => {
    process.env.AUDIO_MAX_BYTES = '3';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ url: 'https://cdn.example/a.ogg' }))
      .mockResolvedValueOnce(okBinary(new Uint8Array([1, 2, 3, 4, 5])));
    vi.stubGlobal('fetch', fetchMock);
    await expect(downloadWhatsAppMedia('m1')).rejects.toThrow(/too large/);
  });

  it('throws on non-ok metadata response with just the status', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 404, headers: new Headers() });
    vi.stubGlobal('fetch', fetchMock);
    await expect(downloadWhatsAppMedia('m1')).rejects.toThrow('media metadata fetch failed: 404');
  });

  it('respects META_GRAPH_BASE_URL override', async () => {
    process.env.META_GRAPH_BASE_URL = 'http://localhost:9999/v21.0';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ url: 'https://cdn.example/a.ogg' }))
      .mockResolvedValueOnce(okBinary(new Uint8Array([1])));
    vi.stubGlobal('fetch', fetchMock);
    await downloadWhatsAppMedia('m1');
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:9999/v21.0/m1');
  });
});

describe('downloadDirectMedia', () => {
  it('fetches the url without auth and returns base64 + mime', async () => {
    const bytes = new Uint8Array([7, 8, 9]);
    const fetchMock = vi.fn().mockResolvedValueOnce(okBinary(bytes, { 'content-type': 'audio/mp4' }));
    vi.stubGlobal('fetch', fetchMock);

    const media = await downloadDirectMedia('https://ig.example/a.m4a');
    expect(media.sizeBytes).toBe(3);
    expect(media.mimeType).toBe('audio/mp4');
    expect(fetchMock.mock.calls[0][1].headers).toBeUndefined();
  });

  it('enforces the size limit via content-length header before buffering', async () => {
    process.env.AUDIO_MAX_BYTES = '5';
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': '99' }),
      arrayBuffer: async () => new ArrayBuffer(99),
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(downloadDirectMedia('https://ig.example/big')).rejects.toThrow(/too large/);
  });

  it('throws on non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 403, headers: new Headers() });
    vi.stubGlobal('fetch', fetchMock);
    await expect(downloadDirectMedia('https://ig.example/x')).rejects.toThrow('media binary fetch failed: 403');
  });
});
