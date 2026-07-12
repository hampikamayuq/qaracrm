import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataApi } from '../lib/data';
import { handleMetaWebhook } from './meta-webhook';
import { createDebounce } from '../lib/debounce';

// Auth + HMAC now handled by meta-webhook-routes.ts — this file tests only event processing.

const mocks = vi.hoisted(() => ({
  sendWhatsApp: {
    execute: vi.fn().mockResolvedValue(JSON.stringify({ ok: true, sent: false })),
  },
  appointmentConfirmation: vi.fn().mockResolvedValue({ handled: false }),
  npsCapture: vi.fn().mockResolvedValue({ handled: false }),
  downloadWhatsAppMedia: vi.fn(),
  downloadDirectMedia: vi.fn(),
  isAudioTranscriptionEnabled: vi.fn().mockReturnValue(false),
  transcribeAudio: vi.fn(),
  emitInboundMessage: vi.fn(),
}));

vi.mock('../lib/tools/sendWhatsApp', () => ({
  sendWhatsApp: mocks.sendWhatsApp,
}));

vi.mock('../lib/events', () => ({
  emitInboundMessage: mocks.emitInboundMessage,
}));

vi.mock('./appointment-confirmation', () => ({
  runAppointmentConfirmationForInbound: mocks.appointmentConfirmation,
}));

vi.mock('./nps-capture', () => ({
  runNpsCaptureForInbound: mocks.npsCapture,
}));

vi.mock('../lib/media-client', () => ({
  downloadWhatsAppMedia: mocks.downloadWhatsAppMedia,
  downloadDirectMedia: mocks.downloadDirectMedia,
}));

vi.mock('../lib/transcription-client', () => ({
  isAudioTranscriptionEnabled: mocks.isAudioTranscriptionEnabled,
  transcribeAudio: mocks.transcribeAudio,
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

  afterEach(() => {
    vi.useRealTimers();
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
    // Notificação em tempo real (SSE) emitida no processamento da mensagem IN.
    expect(mocks.emitInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', preview: 'Oi, quero agendar' }),
    );
  });

  it('does not emit the SSE event for duplicate messages', async () => {
    const list = vi.fn().mockResolvedValueOnce([{ id: 'already' }]);
    await handleMetaWebhook(waBody, api({ list }), processDebounce());
    expect(mocks.emitInboundMessage).not.toHaveBeenCalled();
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

  it('with trailing debounce processes only the last rapid message after the quiet window', async () => {
    vi.useFakeTimers();
    const secondBody = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.IN2',
                    from: '5511999998888',
                    timestamp: '1751650005',
                    type: 'text',
                    text: { body: 'quero agendar botox' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const list = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'conv-9', leadId: 'lead-1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'conv-9', leadId: 'lead-1' }]);
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: 'msg-1' })
      .mockResolvedValueOnce({ id: 'msg-2' });
    const update = vi.fn().mockResolvedValue({ id: 'updated' });
    const onProcessed = vi.fn();
    const debounce = createDebounce(20_000);

    const first = await handleMetaWebhook(waBody, api({ list, create, update }), debounce, onProcessed);
    const second = await handleMetaWebhook(secondBody, api({ list, create, update }), debounce, onProcessed);

    expect(first.processedMessages).toEqual([]);
    expect(second.processedMessages).toEqual([]);
    expect(onProcessed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(20_000);

    expect(onProcessed).toHaveBeenCalledTimes(1);
    expect(onProcessed).toHaveBeenCalledWith({ conversationId: 'conv-9', messageId: 'msg-2' });
    expect(update).toHaveBeenCalledWith('chatMessage', 'msg-2', { agentHandled: false });
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

describe('handleMetaWebhook — bots com action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const withBot = (rules: unknown[]) => vi
    .fn()
    .mockImplementation(async (obj: string) => {
      if (obj === 'bot') return [{ id: 'b1', name: 'FAQ', steps: { rules } }];
      return [];
    });

  // O gate do runner consulta a conversa: OPEN sem handoff deixa o bot rodar.
  const openConvGet = () => vi.fn().mockImplementation(async (obj: string) =>
    obj === 'conversation' ? { status: 'OPEN', needsHuman: false } : null);

  it('bot reply casa: envia, grava botReply e NÃO segue pra Tawany', async () => {
    const list = withBot([{ terms: ['quero agendar'], responses: ['Já te ajudo!'] }]);
    const create = vi.fn().mockResolvedValue({ id: 'x' });

    const result = await handleMetaWebhook(waBody, api({ list, create, get: openConvGet() }), processDebounce());

    expect(mocks.sendWhatsApp.execute).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Já te ajudo!' }),
      expect.anything(),
    );
    expect(create).toHaveBeenCalledWith('botReply', expect.objectContaining({ botId: 'b1', action: 'reply' }));
    expect(result.processedMessages).toEqual([]);
  });

  it('regra com action tawany casa: nada é enviado e a mensagem segue pra Tawany', async () => {
    const list = withBot([{ terms: ['quero agendar'], responses: [], action: 'tawany' }]);
    const create = vi.fn().mockResolvedValue({ id: 'msg-1' });

    const result = await handleMetaWebhook(waBody, api({ list, create, get: openConvGet() }), processDebounce());

    expect(mocks.sendWhatsApp.execute).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith('botReply', expect.objectContaining({ action: 'tawany' }));
    expect(result.processedMessages).toHaveLength(1);
  });
});

describe('handleMetaWebhook — appointment confirmation interception', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appointmentConfirmation.mockResolvedValue({ handled: false });
  });

  it('does not run bots nor forward to Tawany when a button reply confirms an appointment', async () => {
    mocks.appointmentConfirmation.mockResolvedValueOnce({ handled: true });
    const buttonBody = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.BTN1',
                    from: '5511999998888',
                    timestamp: '1751650000',
                    type: 'button',
                    button: { payload: 'confirm_apt_a1', text: 'Confirmar' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const list = vi
      .fn()
      .mockResolvedValueOnce([]) // dedup: no message with this externalId
      .mockResolvedValueOnce([{ id: 'conv-9', leadId: 'lead-1' }]); // existing conversation
    const create = vi.fn().mockResolvedValue({ id: 'msg-2' });

    const result = await handleMetaWebhook(buttonBody, api({ list, create }), processDebounce());

    expect(mocks.appointmentConfirmation).toHaveBeenCalledWith(
      { conversationId: 'conv-9', messageType: 'BUTTON', buttonPayload: 'confirm_apt_a1' },
      expect.any(Object),
    );
    // Não deve sobrar processedMessages: a Tawany (dispatchada a partir daqui
    // pela rota) não deve ser acionada quando a confirmação já tratou o botão.
    expect(result.processedMessages).toEqual([]);
  });

  it('still runs bots/Tawany normally when the button is not an appointment-confirmation payload', async () => {
    const buttonBody = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.BTN2',
                    from: '5511999998888',
                    timestamp: '1751650000',
                    type: 'button',
                    button: { payload: 'some_other_flow', text: 'Ok' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const list = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'conv-9', leadId: 'lead-1' }]);
    const create = vi.fn().mockResolvedValue({ id: 'msg-2' });

    const result = await handleMetaWebhook(buttonBody, api({ list, create }), processDebounce());

    expect(mocks.appointmentConfirmation).toHaveBeenCalledWith(
      { conversationId: 'conv-9', messageType: 'BUTTON', buttonPayload: 'some_other_flow' },
      expect.any(Object),
    );
    expect(result.processedMessages).toEqual([{ conversationId: 'conv-9', messageId: 'msg-2' }]);
  });
});

describe('handleMetaWebhook — NPS capture interception', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appointmentConfirmation.mockResolvedValue({ handled: false });
    mocks.npsCapture.mockResolvedValue({ handled: false });
  });

  const numericBody = {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: 'wamid.NPS1',
                  from: '5511999998888',
                  timestamp: '1751650000',
                  type: 'text',
                  text: { body: '9' },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  it('does not forward a numeric reply to Tawany when the NPS capture handles it', async () => {
    mocks.npsCapture.mockResolvedValueOnce({ handled: true });
    const list = vi
      .fn()
      .mockResolvedValueOnce([]) // dedup
      .mockResolvedValueOnce([{ id: 'conv-9', leadId: 'lead-1' }]); // existing conversation
    const create = vi.fn().mockResolvedValue({ id: 'msg-2' });

    const result = await handleMetaWebhook(numericBody, api({ list, create }), processDebounce());

    expect(mocks.npsCapture).toHaveBeenCalledWith(
      { conversationId: 'conv-9', messageType: 'TEXT', text: '9' },
      expect.any(Object),
    );
    // A Tawany (dispatchada pela rota a partir de processedMessages) não deve
    // ser acionada quando a captura NPS já tratou a nota.
    expect(result.processedMessages).toEqual([]);
  });

  it('runs the NPS capture only after appointment confirmation (which wins when handled)', async () => {
    mocks.appointmentConfirmation.mockResolvedValueOnce({ handled: true });
    const list = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'conv-9', leadId: 'lead-1' }]);
    const create = vi.fn().mockResolvedValue({ id: 'msg-2' });

    const result = await handleMetaWebhook(numericBody, api({ list, create }), processDebounce());

    expect(mocks.npsCapture).not.toHaveBeenCalled();
    expect(result.processedMessages).toEqual([]);
  });

  it('forwards the message normally when the NPS capture does not handle it', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'conv-9', leadId: 'lead-1' }]);
    const create = vi.fn().mockResolvedValue({ id: 'msg-2' });

    const result = await handleMetaWebhook(numericBody, api({ list, create }), processDebounce());

    expect(mocks.npsCapture).toHaveBeenCalled();
    expect(result.processedMessages).toEqual([{ conversationId: 'conv-9', messageId: 'msg-2' }]);
  });

  it('continues to bots/Tawany when the NPS capture throws (non-fatal)', async () => {
    mocks.npsCapture.mockRejectedValueOnce(new Error('boom'));
    const list = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'conv-9', leadId: 'lead-1' }]);
    const create = vi.fn().mockResolvedValue({ id: 'msg-2' });

    const result = await handleMetaWebhook(numericBody, api({ list, create }), processDebounce());

    expect(result.processedMessages).toEqual([{ conversationId: 'conv-9', messageId: 'msg-2' }]);
  });
});

describe('handleMetaWebhook — audio transcription (LEVA 3)', () => {
  const waAudioBody = {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: 'wamid.AUD1',
                  from: '5511999998888',
                  timestamp: '1751650000',
                  type: 'audio',
                  audio: { id: 'MEDIA-1', voice: true },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appointmentConfirmation.mockResolvedValue({ handled: false });
    mocks.npsCapture.mockResolvedValue({ handled: false });
    mocks.isAudioTranscriptionEnabled.mockReturnValue(false);
    mocks.downloadWhatsAppMedia.mockResolvedValue({ base64: 'QUJD', mimeType: 'audio/ogg', sizeBytes: 3 });
    mocks.transcribeAudio.mockResolvedValue({ ok: false, text: '' });
  });

  it('transcribes the audio and stores the marked text when the gate is on', async () => {
    mocks.isAudioTranscriptionEnabled.mockReturnValue(true);
    mocks.transcribeAudio.mockResolvedValue({ ok: true, text: 'quero agendar botox' });
    const list = vi
      .fn()
      .mockResolvedValueOnce([]) // dedup
      .mockResolvedValueOnce([{ id: 'conv-9', leadId: 'lead-1' }]); // existing conversation
    const create = vi.fn().mockResolvedValue({ id: 'msg-a' });

    const result = await handleMetaWebhook(waAudioBody, api({ list, create }), processDebounce());

    expect(mocks.downloadWhatsAppMedia).toHaveBeenCalledWith('MEDIA-1');
    expect(mocks.transcribeAudio).toHaveBeenCalledWith(
      { base64: 'QUJD', mimeType: 'audio/ogg' },
      expect.objectContaining({ conversationId: 'conv-9' }),
    );
    expect(create).toHaveBeenCalledWith(
      'chatMessage',
      expect.objectContaining({
        conversationId: 'conv-9',
        body: '🎤 (áudio transcrito): quero agendar botox',
      }),
    );
    // Transcribed text flows to bots/NPS (as text) and on to Tawany dispatch.
    expect(mocks.npsCapture).toHaveBeenCalledWith(
      expect.objectContaining({ text: '🎤 (áudio transcrito): quero agendar botox' }),
      expect.any(Object),
    );
    expect(result.processedMessages).toEqual([{ conversationId: 'conv-9', messageId: 'msg-a' }]);
  });

  it('keeps the [áudio] placeholder and never downloads when the gate is off', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'conv-9', leadId: 'lead-1' }]);
    const create = vi.fn().mockResolvedValue({ id: 'msg-a' });

    await handleMetaWebhook(waAudioBody, api({ list, create }), processDebounce());

    expect(mocks.downloadWhatsAppMedia).not.toHaveBeenCalled();
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      'chatMessage',
      expect.objectContaining({ body: '[áudio]' }),
    );
  });

  it('keeps the placeholder when transcription fails (non-fatal degradation)', async () => {
    mocks.isAudioTranscriptionEnabled.mockReturnValue(true);
    mocks.transcribeAudio.mockResolvedValue({ ok: false, text: '' });
    const list = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'conv-9', leadId: 'lead-1' }]);
    const create = vi.fn().mockResolvedValue({ id: 'msg-a' });

    await handleMetaWebhook(waAudioBody, api({ list, create }), processDebounce());

    expect(create).toHaveBeenCalledWith(
      'chatMessage',
      expect.objectContaining({ body: '[áudio]' }),
    );
  });

  it('keeps the placeholder when the media download throws (non-fatal)', async () => {
    mocks.isAudioTranscriptionEnabled.mockReturnValue(true);
    mocks.downloadWhatsAppMedia.mockRejectedValue(new Error('boom'));
    const list = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'conv-9', leadId: 'lead-1' }]);
    const create = vi.fn().mockResolvedValue({ id: 'msg-a' });

    await handleMetaWebhook(waAudioBody, api({ list, create }), processDebounce());

    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      'chatMessage',
      expect.objectContaining({ body: '[áudio]' }),
    );
  });

  it('does not touch media/transcription for a normal text message even with the gate on', async () => {
    mocks.isAudioTranscriptionEnabled.mockReturnValue(true);
    const list = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'conv-9', leadId: 'lead-1' }]);
    const create = vi.fn().mockResolvedValue({ id: 'msg-a' });

    await handleMetaWebhook(waBody, api({ list, create }), processDebounce());

    expect(mocks.downloadWhatsAppMedia).not.toHaveBeenCalled();
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      'chatMessage',
      expect.objectContaining({ body: 'Oi, quero agendar' }),
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

// Coexistence: alguém da clínica respondeu pelo app WhatsApp Business e a
// Meta espelhou a mensagem via smb_message_echoes.
describe('handleMetaWebhook — Coexistence echoes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const echoBody = {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'smb_message_echoes',
            value: {
              metadata: { display_phone_number: '5511900001111', phone_number_id: 'PNID-1' },
              message_echoes: [
                {
                  from: '5511900001111',
                  to: '5511999998888',
                  id: 'wamid.ECHO1',
                  timestamp: '1751650300',
                  type: 'text',
                  text: { body: 'Oi Maria, podemos sim!' },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  it('records an OUT message and marks the conversation as human-assumed', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([]) // dedup do wamid
      .mockResolvedValueOnce([{ id: 'conv-1', leadId: 'lead-1', status: 'OPEN' }]);
    const create = vi.fn().mockResolvedValue({ id: 'msg-echo-1' });
    const update = vi.fn().mockResolvedValue({ id: 'conv-1' });

    const result = await handleMetaWebhook(echoBody, api({ list, create, update }), processDebounce());

    expect(create).toHaveBeenCalledWith(
      'chatMessage',
      expect.objectContaining({
        conversationId: 'conv-1',
        direction: 'OUT',
        body: 'Oi Maria, podemos sim!',
        externalId: 'wamid.ECHO1',
        deliveryStatus: 'SENT',
        agentHandled: true,
      }),
    );
    // Mesmo efeito da resposta manual pelo Inbox: humano assumiu, Tawany
    // não volta a responder até "Devolver para a Tawany".
    expect(update).toHaveBeenCalledWith(
      'conversation',
      'conv-1',
      expect.objectContaining({ needsHuman: false, status: 'PENDING_PATIENT' }),
    );
    // Echo nunca entra na fila da Tawany nem dispara bots.
    expect(result.processedMessages).toEqual([]);
    expect(mocks.sendWhatsApp.execute).not.toHaveBeenCalled();
  });

  it('creates lead + conversation when the clinic starts the chat from the phone', async () => {
    const list = vi.fn().mockResolvedValue([]); // sem dup, sem conversa, sem lead
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: 'lead-9' }) // lead
      .mockResolvedValueOnce({ id: 'conv-9' }) // conversation
      .mockResolvedValueOnce({ id: 'msg-9' }); // chatMessage
    const update = vi.fn().mockResolvedValue({ id: 'conv-9' });

    await handleMetaWebhook(echoBody, api({ list, create, update }), processDebounce());

    expect(create).toHaveBeenNthCalledWith(
      1,
      'lead',
      expect.objectContaining({ name: '5511999998888', phone: '5511999998888', source: 'WHATSAPP' }),
    );
    expect(create).toHaveBeenNthCalledWith(
      2,
      'conversation',
      expect.objectContaining({ channel: 'WHATSAPP', externalId: '5511999998888' }),
    );
    expect(create).toHaveBeenNthCalledWith(
      3,
      'chatMessage',
      expect.objectContaining({ direction: 'OUT', externalId: 'wamid.ECHO1' }),
    );
  });

  it('dedups echoes of messages we sent via Cloud API (same wamid)', async () => {
    const list = vi.fn().mockResolvedValueOnce([{ id: 'msg-out-1' }]); // wamid já gravado
    const create = vi.fn();
    const update = vi.fn();

    await handleMetaWebhook(echoBody, api({ list, create, update }), processDebounce());

    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('does not reopen RESOLVED/CLOSED conversations, only records the message', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([]) // dedup
      .mockResolvedValueOnce([{ id: 'conv-2', leadId: 'lead-2', status: 'RESOLVED' }]);
    const create = vi.fn().mockResolvedValue({ id: 'msg-echo-2' });
    const update = vi.fn().mockResolvedValue({ id: 'conv-2' });

    await handleMetaWebhook(echoBody, api({ list, create, update }), processDebounce());

    expect(update).toHaveBeenCalledWith('conversation', 'conv-2', {
      lastMessageAt: new Date(1751650300 * 1000).toISOString(),
    });
  });
});
