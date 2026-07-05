import { describe, expect, it, vi } from 'vitest';
import type { DataApi } from '../lib/data';
import { handleMetaWebhook } from './meta-webhook';

// Auth + HMAC now handled by meta-webhook-routes.ts — this file tests only event processing.

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

describe('handleMetaWebhook — inbound messages', () => {
  it('creates conversation + IN message for a new sender', async () => {
    const list = vi.fn().mockResolvedValue([]); // no dup, no existing conversation
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: 'conv-1' }) // conversation
      .mockResolvedValueOnce({ id: 'msg-1' }); // chatMessage
    const update = vi.fn().mockResolvedValue({ id: 'conv-1' });
    await handleMetaWebhook(waBody, api({ list, create, update }));

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
    await handleMetaWebhook(waBody, api({ list, create }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      'chatMessage',
      expect.objectContaining({ conversationId: 'conv-9' }),
    );
  });

  it('skips duplicate messages (Meta retry)', async () => {
    const list = vi.fn().mockResolvedValueOnce([{ id: 'already' }]);
    const create = vi.fn();
    await handleMetaWebhook(waBody, api({ list, create }));
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
    await handleMetaWebhook(statusBody, api({ list, update }));
    expect(update).toHaveBeenCalledWith('chatMessage', 'msg-out-1', { deliveryStatus: 'READ' });
  });

  it('ignores statuses for unknown messages', async () => {
    const update = vi.fn();
    await handleMetaWebhook(statusBody, api({ update }));
    expect(update).not.toHaveBeenCalled();
  });
});
