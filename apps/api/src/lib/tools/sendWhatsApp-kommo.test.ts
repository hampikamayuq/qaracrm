import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataApi } from 'src/lib/data';

const mocks = vi.hoisted(() => ({
  isKommoReplyConfigured: vi.fn().mockReturnValue(true),
  updateKommoLeadTextField: vi.fn().mockResolvedValue(undefined),
  runKommoSalesbot: vi.fn().mockResolvedValue(undefined),
  addKommoNote: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('src/lib/kommo-client', () => ({
  isKommoReplyConfigured: mocks.isKommoReplyConfigured,
  updateKommoLeadTextField: mocks.updateKommoLeadTextField,
  runKommoSalesbot: mocks.runKommoSalesbot,
  addKommoNote: mocks.addKommoNote,
  kommoBreaker: { execute: (fn: () => unknown) => fn() },
}));

// Importado após o mock para o branch KOMMO usar o cliente mockado.
const { sendWhatsApp } = await import('./sendWhatsApp');

const UUID = '00000000-0000-4000-8000-000000000001';
const CONV = { id: UUID, channel: 'KOMMO', externalId: 'chat-9', instanceId: null, leadId: 'lead-1' };

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn(async (object: string) => {
    if (object === 'conversation') return CONV;
    if (object === 'lead') return { id: 'lead-1', kommoLeadId: '123' };
    return null;
  }),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'msg-kommo-1' }),
  update: vi.fn().mockResolvedValue({ id: UUID }),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isKommoReplyConfigured.mockReturnValue(true);
  process.env.KOMMO_REPLY_BOT_ID = '10';
  process.env.KOMMO_REPLY_FIELD_ID = '900';
});

afterEach(() => {
  delete process.env.KOMMO_REPLY_BOT_ID;
  delete process.env.KOMMO_REPLY_FIELD_ID;
  delete process.env.KOMMO_AUDIT_NOTES;
});

describe('sendWhatsApp — branch KOMMO', () => {
  it('grava a resposta no custom field, dispara o salesbot e persiste OUT SENT', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'msg-kommo-1' });
    const result = await sendWhatsApp.execute(
      { conversationId: UUID, text: 'Olá! Posso ajudar?' },
      api({ create }),
    );

    expect(mocks.updateKommoLeadTextField).toHaveBeenCalledWith('123', '900', 'Olá! Posso ajudar?');
    expect(mocks.runKommoSalesbot).toHaveBeenCalledWith('10', '123');
    expect(create).toHaveBeenCalledWith('chatMessage', expect.objectContaining({
      direction: 'OUT',
      body: 'Olá! Posso ajudar?',
      deliveryStatus: 'SENT',
      externalId: expect.stringMatching(/^kommo-out:/),
    }));
    expect(JSON.parse(result)).toMatchObject({ ok: true, sent: true });
  });

  it('sem config de resposta: erro claro, sem mensagem fantasma', async () => {
    mocks.isKommoReplyConfigured.mockReturnValue(false);
    const create = vi.fn();

    const result = await sendWhatsApp.execute(
      { conversationId: UUID, text: 'Oi' },
      api({ create }),
    );

    expect(JSON.parse(result)).toEqual({ ok: false, error: 'kommo_send_not_configured' });
    expect(create).not.toHaveBeenCalled();
    expect(mocks.runKommoSalesbot).not.toHaveBeenCalled();
  });

  it('lead sem vínculo kommoLeadId: erro claro, sem envio', async () => {
    const get = vi.fn(async (object: string) => {
      if (object === 'conversation') return CONV;
      if (object === 'lead') return { id: 'lead-1', kommoLeadId: null };
      return null;
    });

    const result = await sendWhatsApp.execute({ conversationId: UUID, text: 'Oi' }, api({ get }));

    expect(JSON.parse(result)).toEqual({ ok: false, error: 'kommo_lead_not_linked' });
    expect(mocks.runKommoSalesbot).not.toHaveBeenCalled();
  });

  it('KOMMO_AUDIT_NOTES=true registra nota de auditoria no lead do Kommo', async () => {
    process.env.KOMMO_AUDIT_NOTES = 'true';
    await sendWhatsApp.execute({ conversationId: UUID, text: 'Oi' }, api());
    expect(mocks.addKommoNote).toHaveBeenCalledWith('123', expect.stringContaining('Oi'));
  });
});
