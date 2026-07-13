import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import {
  addWebChatListener,
  removeWebChatListener,
  pushWebChatEvent,
  webChatListenerCount,
} from './web-chat-events';

const fakeRes = () => ({ write: vi.fn(), end: vi.fn() } as unknown as Response & { write: ReturnType<typeof vi.fn> });

const SESSION = 'sess-a';

describe('web-chat-events — emitter por sessão', () => {
  beforeEach(() => {
    // Limpa listeners residuais entre testes.
    let n = webChatListenerCount(SESSION);
    while (n-- > 0) {
      // não temos handle; usa uma nova sessão por teste no lugar
    }
  });

  it('entrega o evento OUT só para os listeners da sessão', () => {
    const s = 'sess-deliver';
    const res = fakeRes();
    expect(addWebChatListener(s, res)).toBe(true);

    const delivered = pushWebChatEvent(s, {
      type: 'message',
      direction: 'OUT',
      text: 'Olá!',
      at: '2026-07-12T10:00:00.000Z',
      messageId: 'm1',
    });

    expect(delivered).toBe(1);
    expect(res.write).toHaveBeenCalledWith(
      expect.stringContaining('event: message'),
    );
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('"messageId":"m1"'));
    removeWebChatListener(s, res);
  });

  it('sem listener conectado, o push retorna 0 e não lança', () => {
    expect(() =>
      expect(
        pushWebChatEvent('sess-empty', {
          type: 'message',
          direction: 'OUT',
          text: 'ninguém ouve',
          at: '2026-07-12T10:00:00.000Z',
          messageId: 'm2',
        }),
      ).toBe(0),
    ).not.toThrow();
  });

  it('recusa conexões além do teto por sessão', () => {
    const s = 'sess-cap';
    const opened = [];
    for (let i = 0; i < 5; i++) {
      const res = fakeRes();
      expect(addWebChatListener(s, res)).toBe(true);
      opened.push(res);
    }
    // 6ª conexão recusada.
    expect(addWebChatListener(s, fakeRes())).toBe(false);
    opened.forEach((res) => removeWebChatListener(s, res));
  });

  it('um write que lança não quebra o push para os demais', () => {
    const s = 'sess-throw';
    const ok = fakeRes();
    const boom = { write: vi.fn(() => { throw new Error('dead socket'); }), end: vi.fn() } as unknown as Response;
    addWebChatListener(s, boom);
    addWebChatListener(s, ok);

    const delivered = pushWebChatEvent(s, {
      type: 'message',
      direction: 'OUT',
      text: 'x',
      at: '2026-07-12T10:00:00.000Z',
      messageId: 'm3',
    });

    expect(delivered).toBe(1); // só o ok recebeu
    removeWebChatListener(s, boom);
    removeWebChatListener(s, ok);
  });
});
