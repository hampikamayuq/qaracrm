import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataApi } from '../lib/data';
import { handleMetaWebhook } from './meta-webhook';

// Auth + HMAC now handled by meta-webhook-routes.ts — this file tests only event processing.

const mocks = vi.hoisted(() => ({
  sendWhatsApp: {
    execute: vi.fn().mockResolvedValue(JSON.stringify({ ok: true, sent: false })),
  },
}));

vi.mock('../lib/tools/sendWhatsApp', () => ({
  sendWhatsApp: mocks.sendWhatsApp,
}));

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

const processDebounce = () => ({
  check: vi.fn().mockReturnValue({ status: 'process' }),
  isOptOut: vi.fn().mockReturnValue(false),
});

describe('handleMetaWebhook — inbound messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a lead + conversation + IN message for a new sender', async () => {
    const list = vi.fn().mockResolvedValue([]); // no dup, no existing conversation, no existing lead
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: 'lead-1' }) // lead
      .mockResolvedValueOnce({ id: 'conv-1' }) // conversation
      .mockResolvedValueOnce({ id: 'msg-1' }); // chatMessage
    const update = vi.fn().mockResolvedValue({ id: 'conv-1' });
    const result = await handleMetaWebhook(waBody, api({ list, create, update }), processDebounce());

    expect(create).toHaveBeenNthCalledWith(
      1,
      'lead',
      expect.objectContaining({ name: '5511999998888', phone: '5511999998888' }),
    );
    expect(create).toHaveBeenNthCalledWith(
      2,
      'conversation',
      expect.objectContaining({
        leadId: 'lead-1',
        channel: 'WHATSAPP',
        externalId: '5511999998888',
        status: 'OPEN',
      }),
    );
    expect(create).toHaveBeenNthCalledWith(
      3,
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
    expect(result.processedMessages).toEqual([{ conversationId: 'conv-1', messageId: 'msg-1' }]);
  });

  it('reuses an existing lead by phone when creating a new conversation for it', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([]) // dedup
      .mockResolvedValueOnce([]) // no existing conversation
      .mockResolvedValueOnce([{ id: 'lead-existing' }]); // existing lead by phone
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: 'conv-1' })
      .mockResolvedValueOnce({ id: 'msg-1' });
    await handleMetaWebhook(waBody, api({ list, create, update: vi.fn() }), processDebounce());

    expect(create).toHaveBeenNthCalledWith(
      1,
      'conversation',
      expect.objectContaining({ leadId: 'lead-existing' }),
    );
  });

  it('reuses an existing conversation', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([]) // dedup: no message with this externalId
      .mockResolvedValueOnce([{ id: 'conv-9' }]); // conversation found
    const create = vi.fn().mockResolvedValue({ id: 'msg-2' });
    await handleMetaWebhook(waBody, api({ list, create }), processDebounce());
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      'chatMessage',
      expect.objectContaining({ conversationId: 'conv-9' }),
    );
  });

  it('skips duplicate messages (Meta retry)', async () => {
    const list = vi.fn().mockResolvedValueOnce([{ id: 'already' }]);
    const create = vi.fn();
    await handleMetaWebhook(waBody, api({ list, create }), processDebounce());
    expect(create).not.toHaveBeenCalled();
  });

  it('persists rapid duplicate-window messages as already handled', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'conv-9', leadId: 'lead-1' }]);
    const create = vi.fn().mockResolvedValue({ id: 'msg-2' });

    await handleMetaWebhook(waBody, api({ list, create }), {
      check: vi.fn().mockReturnValue({ status: 'skip' }),
      isOptOut: vi.fn().mockReturnValue(false),
    });

    expect(create).toHaveBeenCalledWith(
      'chatMessage',
      expect.objectContaining({ conversationId: 'conv-9', agentHandled: true }),
    );
    expect(mocks.sendWhatsApp.execute).not.toHaveBeenCalled();
  });

  it('marks opt-out leads and sends the confirmation without logging the body', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'conv-9', leadId: 'lead-1' }]);
    const create = vi.fn().mockResolvedValue({ id: 'msg-2' });
    const update = vi.fn().mockResolvedValue({ id: 'updated' });

    await handleMetaWebhook(waBody, api({ list, create, update }), {
      check: vi.fn().mockReturnValue({ status: 'optout' }),
      isOptOut: vi.fn().mockReturnValue(true),
    });

    expect(create).toHaveBeenCalledWith(
      'chatMessage',
      expect.objectContaining({ conversationId: 'conv-9', agentHandled: true }),
    );
    expect(update).toHaveBeenCalledWith('lead', 'lead-1', {
      optedOut: true,
      optedOutAt: expect.any(Date),
    });
    expect(update).toHaveBeenCalledWith('conversation', 'conv-9', expect.objectContaining({
      needsHuman: true,
      status: 'PENDING_HUMAN',
    }));
    expect(mocks.sendWhatsApp.execute).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-9' }),
      expect.any(Object),
    );
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
    await handleMetaWebhook(statusBody, api({ list, update }), processDebounce());
    expect(update).toHaveBeenCalledWith('chatMessage', 'msg-out-1', { deliveryStatus: 'READ' });
  });

  it('ignores statuses for unknown messages', async () => {
    const update = vi.fn();
    await handleMetaWebhook(statusBody, api({ update }), processDebounce());
    expect(update).not.toHaveBeenCalled();
  });
});
