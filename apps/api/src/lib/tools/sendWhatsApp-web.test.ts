import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataApi } from 'src/lib/data';

const mocks = vi.hoisted(() => ({
  sendViaWeb: vi.fn().mockReturnValue({ delivered: 0 }),
}));

vi.mock('src/lib/web-chat-send', () => ({
  sendViaWeb: mocks.sendViaWeb,
}));

// Importado após o mock para o branch WEB usar o sendViaWeb mockado.
const { sendWhatsApp, webBreaker } = await import('./sendWhatsApp');

const UUID = '00000000-0000-4000-8000-000000000000';
const SESSION = '22222222-2222-4222-8222-222222222222';

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockResolvedValue({ id: UUID, channel: 'WEB', externalId: SESSION }),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'msg-web-1' }),
  update: vi.fn().mockResolvedValue({ id: 'conv-1' }),
  ...over,
});

beforeEach(() => {
  webBreaker.reset();
  vi.clearAllMocks();
  mocks.sendViaWeb.mockReturnValue({ delivered: 0 });
});

describe('sendWhatsApp — branch WEB', () => {
  it('persiste ChatMessage OUT (externalId UUID) e faz push no SSE da sessão', async () => {
    mocks.sendViaWeb.mockReturnValue({ delivered: 1 });
    const create = vi.fn().mockResolvedValue({ id: 'msg-web-1' });

    const result = await sendWhatsApp.execute(
      { conversationId: UUID, text: 'Resposta da Tawany' },
      api({ create }),
    );

    expect(create).toHaveBeenCalledWith(
      'chatMessage',
      expect.objectContaining({
        direction: 'OUT',
        body: 'Resposta da Tawany',
        deliveryStatus: 'SENT',
        externalId: expect.any(String),
      }),
    );
    // sendViaWeb(webSessionId, text, messageId, at)
    expect(mocks.sendViaWeb).toHaveBeenCalledWith(SESSION, 'Resposta da Tawany', 'msg-web-1', expect.any(String));
    expect(JSON.parse(result)).toMatchObject({ ok: true, sent: true, messageId: 'msg-web-1' });
  });

  it('sem listener conectado: persiste e NÃO lança (push retorna 0)', async () => {
    mocks.sendViaWeb.mockReturnValue({ delivered: 0 });
    const create = vi.fn().mockResolvedValue({ id: 'msg-web-2' });

    const result = await sendWhatsApp.execute(
      { conversationId: UUID, text: 'ninguém ouvindo' },
      api({ create }),
    );

    expect(create).toHaveBeenCalledWith('chatMessage', expect.objectContaining({ direction: 'OUT' }));
    expect(JSON.parse(result)).toMatchObject({ ok: true, sent: true });
  });

  it('modo teste: grava TEST_MODE e não faz push no SSE', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'msg-web-3' });

    await sendWhatsApp.execute(
      { conversationId: UUID, text: 'teste' },
      { ...api({ create }), testMode: true } as DataApi & { testMode: boolean },
    );

    expect(create).toHaveBeenCalledWith('chatMessage', expect.objectContaining({ deliveryStatus: 'TEST_MODE' }));
    expect(mocks.sendViaWeb).not.toHaveBeenCalled();
  });
});
