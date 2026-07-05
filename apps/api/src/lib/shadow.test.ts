import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { DataApi } from './data';

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
  ...over,
});

describe('shadow mode helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.SHADOW_MODE;
    delete process.env.TWENTY_FORWARD_URL;
  });

  it('reads shadow mode flags from env', async () => {
    process.env.SHADOW_MODE = 'human_approval';
    const { isHumanApprovalMode, isShadowMode } = await import('./shadow');

    expect(isHumanApprovalMode()).toBe(true);
    expect(isShadowMode()).toBe(false);
  });

  it('rejects invalid shadow mode', async () => {
    process.env.SHADOW_MODE = 'invalid';
    const { isShadowMode } = await import('./shadow');

    expect(() => isShadowMode()).toThrow('Invalid SHADOW_MODE: invalid');
  });

  it('forwards raw webhook bytes to Twenty with the original signature', async () => {
    process.env.TWENTY_FORWARD_URL = 'https://twenty.example/webhook';
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const rawBody = Buffer.from('{"object":"whatsapp_business_account"}');
    const { forwardWebhookToTwenty } = await import('./shadow');

    const forwarded = await forwardWebhookToTwenty({
      rawBody,
      signature: 'sha256=abc',
      fetchImpl,
    });

    expect(forwarded).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith('https://twenty.example/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=abc',
      },
      body: rawBody,
    });
  });

  it('records shadow run as an Activity without full message bodies', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'a1' });
    const { recordShadowRun } = await import('./shadow');

    await recordShadowRun(api({ create }), {
      conversationId: 'conv-1',
      messageId: 'msg-1',
      tawanyReply: 'x'.repeat(600),
      twentyReply: '',
      tawanyToolCalls: 2,
      match: false,
    });

    expect(create).toHaveBeenCalledWith('activity', expect.objectContaining({
      targetType: 'conversation',
      targetId: 'conv-1',
    }));
    const body = JSON.parse(create.mock.calls[0][1].body);
    expect(body.type).toBe('shadow_run');
    expect(body.tawanyReply).toHaveLength(500);
  });
});
