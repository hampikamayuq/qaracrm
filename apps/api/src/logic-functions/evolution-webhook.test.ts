import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataApi } from '../lib/data';
import { handleEvolutionWebhook } from './evolution-webhook';

const mocks = vi.hoisted(() => ({
  getEvolutionMediaBase64: vi.fn(),
  isAudioTranscriptionEnabled: vi.fn().mockReturnValue(false),
  transcribeAudio: vi.fn(),
  emitInboundMessage: vi.fn(),
}));

vi.mock('../lib/events', () => ({
  emitInboundMessage: mocks.emitInboundMessage,
}));

vi.mock('../lib/evolution-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/evolution-client')>()),
  getEvolutionMediaBase64: mocks.getEvolutionMediaBase64,
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

const INSTANCE = { id: 'inst-1', status: 'CONNECTED' };

const inboundBody = (over: object = {}) => ({
  event: 'messages.upsert',
  instance: 'qara-recepcao',
  data: {
    key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'EVO1' },
    pushName: 'Maria Silva',
    message: { conversation: 'Oi, quero agendar' },
    messageTimestamp: 1751650000,
    ...over,
  },
});

describe('handleEvolutionWebhook — inbound (canal humano)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAudioTranscriptionEnabled.mockReturnValue(false);
  });

  it('creates lead (pushName) + conversation (instanceId) + IN message as PENDING_HUMAN', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([INSTANCE]) // whatsAppInstance
      .mockResolvedValueOnce([]) // dedup chatMessage
      .mockResolvedValueOnce([]) // conversation
      .mockResolvedValueOnce([]); // lead
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: 'lead-1' })
      .mockResolvedValueOnce({ id: 'conv-1' })
      .mockResolvedValueOnce({ id: 'msg-1' });
    const update = vi.fn().mockResolvedValue({ id: 'conv-1' });

    const result = await handleEvolutionWebhook(inboundBody(), api({ list, create, update }));

    expect(create).toHaveBeenNthCalledWith(
      1,
      'lead',
      expect.objectContaining({ name: 'Maria Silva', phone: '5511999998888', source: 'WHATSAPP_QR' }),
    );
    expect(create).toHaveBeenNthCalledWith(
      2,
      'conversation',
      expect.objectContaining({
        leadId: 'lead-1',
        channel: 'WHATSAPP_QR',
        instanceId: 'inst-1',
        externalId: '5511999998888',
      }),
    );
    expect(create).toHaveBeenNthCalledWith(
      3,
      'chatMessage',
      expect.objectContaining({
        conversationId: 'conv-1',
        direction: 'IN',
        body: 'Oi, quero agendar',
        externalId: 'EVO1',
        agentHandled: true,
      }),
    );
    // Canal humano: a conversa cai no Inbox como "aguardando humano".
    expect(update).toHaveBeenCalledWith(
      'conversation',
      'conv-1',
      expect.objectContaining({ needsHuman: true, status: 'PENDING_HUMAN', handoffReason: 'canal_qr' }),
    );
    expect(result).toEqual({ messages: 1, connections: 0 });
    // Notificação em tempo real (SSE) emitida no processamento da mensagem IN.
    expect(mocks.emitInboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      leadName: 'Maria Silva',
      preview: 'Oi, quero agendar',
    });
  });

  it('finds the conversation by channel + contact + instanceId', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([INSTANCE])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'conv-9', leadId: 'lead-9', status: 'OPEN' }]);
    const create = vi.fn().mockResolvedValue({ id: 'msg-9' });
    const update = vi.fn().mockResolvedValue({ id: 'conv-9' });

    await handleEvolutionWebhook(inboundBody(), api({ list, create, update }));

    expect(list).toHaveBeenNthCalledWith(3, 'conversation', expect.objectContaining({
      filter: {
        channel: { eq: 'WHATSAPP_QR' },
        externalId: { eq: '5511999998888' },
        instanceId: { eq: 'inst-1' },
      },
    }));
    expect(create).toHaveBeenCalledWith('chatMessage', expect.objectContaining({ conversationId: 'conv-9' }));
  });

  it('dedups by externalId (Evolution retry)', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([INSTANCE])
      .mockResolvedValueOnce([{ id: 'msg-dup' }]);
    const create = vi.fn();
    const update = vi.fn();

    const result = await handleEvolutionWebhook(inboundBody(), api({ list, create, update }));

    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({ messages: 0, connections: 0 });
  });

  it('discards events from unknown instances', async () => {
    const list = vi.fn().mockResolvedValueOnce([]); // instância não encontrada
    const create = vi.fn();

    const result = await handleEvolutionWebhook(inboundBody(), api({ list, create }));

    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual({ messages: 0, connections: 0 });
  });

  it('transcribes patient audio via Evolution media download when the gate is on', async () => {
    mocks.isAudioTranscriptionEnabled.mockReturnValue(true);
    mocks.getEvolutionMediaBase64.mockResolvedValue({ base64: 'AUDIO==', mimeType: 'audio/ogg' });
    mocks.transcribeAudio.mockResolvedValue({ ok: true, text: 'quero agendar botox' });
    const list = vi
      .fn()
      .mockResolvedValueOnce([INSTANCE])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'conv-1', leadId: 'lead-1', status: 'OPEN' }]);
    const create = vi.fn().mockResolvedValue({ id: 'msg-1' });
    const update = vi.fn().mockResolvedValue({ id: 'conv-1' });

    await handleEvolutionWebhook(
      inboundBody({ message: { audioMessage: { seconds: 8 } } }),
      api({ list, create, update }),
    );

    expect(mocks.getEvolutionMediaBase64).toHaveBeenCalledWith(
      'qara-recepcao',
      expect.objectContaining({ id: 'EVO1' }),
    );
    expect(create).toHaveBeenCalledWith(
      'chatMessage',
      expect.objectContaining({ body: '🎤 (áudio transcrito): quero agendar botox' }),
    );
  });

  it('keeps the [áudio] placeholder when transcription fails (non-fatal)', async () => {
    mocks.isAudioTranscriptionEnabled.mockReturnValue(true);
    mocks.getEvolutionMediaBase64.mockRejectedValue(new Error('boom'));
    const list = vi
      .fn()
      .mockResolvedValueOnce([INSTANCE])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'conv-1', leadId: 'lead-1', status: 'OPEN' }]);
    const create = vi.fn().mockResolvedValue({ id: 'msg-1' });
    const update = vi.fn().mockResolvedValue({ id: 'conv-1' });

    await handleEvolutionWebhook(
      inboundBody({ message: { audioMessage: { seconds: 8 } } }),
      api({ list, create, update }),
    );

    expect(create).toHaveBeenCalledWith('chatMessage', expect.objectContaining({ body: '[áudio]' }));
  });

  it('marks lead opted-out on opt-out text but sends NOTHING automatically', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([INSTANCE])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'conv-1', leadId: 'lead-1', status: 'OPEN' }]);
    const create = vi.fn().mockResolvedValue({ id: 'msg-1' });
    const update = vi.fn().mockResolvedValue({ id: 'x' });

    await handleEvolutionWebhook(
      inboundBody({ message: { conversation: 'PARAR' } }),
      api({ list, create, update }),
    );

    expect(update).toHaveBeenCalledWith('lead', 'lead-1', expect.objectContaining({ optedOut: true }));
    expect(update).toHaveBeenCalledWith(
      'conversation',
      'conv-1',
      expect.objectContaining({ handoffReason: 'opt_out_detected', needsHuman: true }),
    );
    // Só a mensagem IN do paciente — nenhuma resposta automática (create 1x).
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith('chatMessage', expect.objectContaining({ direction: 'IN' }));
  });
});

describe('handleEvolutionWebhook — echo fromMe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAudioTranscriptionEnabled.mockReturnValue(false);
  });

  const echoBody = inboundBody({
    key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: true, id: 'EVO-ECHO' },
    message: { conversation: 'Podemos sim!' },
  });

  it('records OUT and marks human-assumed (same as Inbox manual reply)', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([INSTANCE])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'conv-1', leadId: 'lead-1', status: 'OPEN' }]);
    const create = vi.fn().mockResolvedValue({ id: 'msg-out' });
    const update = vi.fn().mockResolvedValue({ id: 'conv-1' });

    await handleEvolutionWebhook(echoBody, api({ list, create, update }));

    expect(create).toHaveBeenCalledWith(
      'chatMessage',
      expect.objectContaining({ direction: 'OUT', deliveryStatus: 'SENT', externalId: 'EVO-ECHO' }),
    );
    expect(update).toHaveBeenCalledWith(
      'conversation',
      'conv-1',
      expect.objectContaining({ needsHuman: false, status: 'PENDING_PATIENT' }),
    );
  });

  it('dedups echoes of messages the CRM sent via sendText (same key.id)', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([INSTANCE])
      .mockResolvedValueOnce([{ id: 'msg-sent-by-crm' }]);
    const create = vi.fn();

    await handleEvolutionWebhook(echoBody, api({ list, create }));

    expect(create).not.toHaveBeenCalled();
  });
});

describe('handleEvolutionWebhook — connection/qr', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates instance status + phone on connection.update open', async () => {
    const list = vi.fn().mockResolvedValueOnce([{ id: 'inst-1', status: 'PAIRING' }]);
    const update = vi.fn().mockResolvedValue({ id: 'inst-1' });

    const result = await handleEvolutionWebhook(
      {
        event: 'connection.update',
        instance: 'qara-recepcao',
        data: { state: 'open', wuid: '5511900001111@s.whatsapp.net' },
      },
      api({ list, update }),
    );

    expect(update).toHaveBeenCalledWith(
      'whatsAppInstance',
      'inst-1',
      expect.objectContaining({
        status: 'CONNECTED',
        phoneNumber: '5511900001111',
        lastConnectedAt: expect.any(String),
      }),
    );
    expect(result).toEqual({ messages: 0, connections: 1 });
  });

  it('marks DISCONNECTED on state close', async () => {
    const list = vi.fn().mockResolvedValueOnce([{ id: 'inst-1', status: 'CONNECTED' }]);
    const update = vi.fn().mockResolvedValue({ id: 'inst-1' });

    await handleEvolutionWebhook(
      { event: 'connection.update', instance: 'qara-recepcao', data: { state: 'close' } },
      api({ list, update }),
    );

    expect(update).toHaveBeenCalledWith(
      'whatsAppInstance',
      'inst-1',
      expect.objectContaining({ status: 'DISCONNECTED' }),
    );
  });

  it('marks PAIRING on qrcode.updated unless already connected', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'inst-1', status: 'DISCONNECTED' }]);
    const update = vi.fn().mockResolvedValue({ id: 'inst-1' });

    await handleEvolutionWebhook(
      { event: 'qrcode.updated', instance: 'qara-recepcao', data: {} },
      api({ list, update }),
    );

    expect(update).toHaveBeenCalledWith('whatsAppInstance', 'inst-1', { status: 'PAIRING' });
  });
});
