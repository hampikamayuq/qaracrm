import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataApi } from 'src/lib/data';
import { handleMetaWebhook } from './meta-webhook';

const SECRET = 'app-secret';
const sign = (raw: string): string =>
  `sha256=${createHmac('sha256', SECRET).update(raw, 'utf8').digest('hex')}`;

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
  ...over,
});

const waBody = {
  object: 'whatsapp_business_account',
  entry: [
    {
      changes: [
        {
          value: {
            messages: [
              {
                id: 'wamid.IN1',
                from: '5511999998888',
                timestamp: '1751650000',
                type: 'text',
                text: { body: 'Oi, quero agendar' },
              },
            ],
          },
        },
      ],
    },
  ],
};

const event = (body: object, rawOverride?: string, sigOverride?: string) => {
  const raw = rawOverride ?? JSON.stringify(body);
  return {
    headers: { 'x-hub-signature-256': sigOverride ?? sign(raw) },
    queryStringParameters: {},
    pathParameters: {},
    body,
    rawBody: raw,
    isBase64Encoded: false,
    requestContext: { http: { method: 'POST', path: '/meta/webhook' } },
    userWorkspaceId: null,
  };
};

beforeEach(() => {
  process.env.META_APP_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.META_APP_SECRET;
});

describe('handleMetaWebhook — auth', () => {
  it('503s when META_APP_SECRET is not configured', async () => {
    delete process.env.META_APP_SECRET;
    const res = await handleMetaWebhook(event(waBody), api());
    expect(res.status).toBe(503);
  });

  it('401s on invalid signature and on missing rawBody', async () => {
    const bad = await handleMetaWebhook(event(waBody, undefined, 'sha256=deadbeef'), api());
    expect(bad.status).toBe(401);
    const noRaw = { ...event(waBody), rawBody: undefined };
    expect((await handleMetaWebhook(noRaw, api())).status).toBe(401);
  });
});

describe('handleMetaWebhook — inbound messages', () => {
  it('creates conversation + IN message for a new sender', async () => {
    const list = vi.fn().mockResolvedValue([]); // no dup, no existing conversation
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: 'conv-1' }) // conversation
      .mockResolvedValueOnce({ id: 'msg-1' }); // chatMessage
    const update = vi.fn().mockResolvedValue({ id: 'conv-1' });
    const res = await handleMetaWebhook(event(waBody), api({ list, create, update }));

    expect(res.status).toBe(200);
    expect(create).toHaveBeenNthCalledWith(
      1,
      'conversation',
      expect.objectContaining({
        channel: 'WHATSAPP',
        externalId: '5511999998888',
        status: 'OPEN',
      }),
    );
    expect(create).toHaveBeenNthCalledWith(
      2,
      'chatMessage',
      expect.objectContaining({
        conversationId: 'conv-1',
        direction: 'IN',
        body: 'Oi, quero agendar',
        externalId: 'wamid.IN1',
        messageType: 'TEXT',
        agentHandled: false,
      }),
    );
    expect(update).toHaveBeenCalledWith('conversation', 'conv-1', {
      lastMessageAt: expect.any(String),
    });
  });

  it('reuses an existing conversation', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([]) // dedup: no message with this externalId
      .mockResolvedValueOnce([{ id: 'conv-9' }]); // conversation found
    const create = vi.fn().mockResolvedValue({ id: 'msg-2' });
    await handleMetaWebhook(event(waBody), api({ list, create }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      'chatMessage',
      expect.objectContaining({ conversationId: 'conv-9' }),
    );
  });

  it('skips duplicate messages (Meta retry)', async () => {
    const list = vi.fn().mockResolvedValueOnce([{ id: 'already' }]);
    const create = vi.fn();
    const res = await handleMetaWebhook(event(waBody), api({ list, create }));
    expect(res.status).toBe(200);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('handleMetaWebhook — statuses', () => {
  const statusBody = {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [{ id: 'wamid.OUT1', status: 'read', timestamp: '1751650100' }],
            },
          },
        ],
      },
    ],
  };

  it('updates deliveryStatus of the matching outbound message', async () => {
    const list = vi.fn().mockResolvedValue([{ id: 'msg-out-1' }]);
    const update = vi.fn().mockResolvedValue({ id: 'msg-out-1' });
    const res = await handleMetaWebhook(event(statusBody), api({ list, update }));
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith('chatMessage', 'msg-out-1', { deliveryStatus: 'READ' });
  });

  it('ignores statuses for unknown messages', async () => {
    const update = vi.fn();
    const res = await handleMetaWebhook(event(statusBody), api({ update }));
    expect(res.status).toBe(200);
    expect(update).not.toHaveBeenCalled();
  });
});
