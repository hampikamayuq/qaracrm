import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addKommoNote,
  getKommoContact,
  getKommoLead,
  isKommoConfigured,
  isKommoReplyConfigured,
  kommoBreaker,
  listKommoLeadsUpdatedSince,
  runKommoSalesbot,
  updateKommoLeadTextField,
} from './kommo-client';

const fetchMock = vi.fn();

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  kommoBreaker.reset();
  process.env.KOMMO_SUBDOMAIN = 'clinica';
  process.env.KOMMO_ACCESS_TOKEN = 'tok-123';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.KOMMO_SUBDOMAIN;
  delete process.env.KOMMO_ACCESS_TOKEN;
  delete process.env.KOMMO_REPLY_BOT_ID;
  delete process.env.KOMMO_REPLY_FIELD_ID;
});

describe('config', () => {
  it('isKommoConfigured exige subdomínio + token; reply exige bot + field', () => {
    expect(isKommoConfigured()).toBe(true);
    expect(isKommoReplyConfigured()).toBe(false);
    process.env.KOMMO_REPLY_BOT_ID = '10';
    process.env.KOMMO_REPLY_FIELD_ID = '900';
    expect(isKommoReplyConfigured()).toBe(true);
    delete process.env.KOMMO_ACCESS_TOKEN;
    expect(isKommoConfigured()).toBe(false);
    expect(isKommoReplyConfigured()).toBe(false);
  });
});

describe('getKommoLead / getKommoContact', () => {
  it('busca lead com contatos e normaliza ids para string', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: 123,
      name: 'Maria',
      status_id: 42,
      pipeline_id: 7,
      price: 350,
      _embedded: { contacts: [{ id: 31, is_main: true }, { id: 32 }] },
    }));

    const lead = await getKommoLead('123');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://clinica.kommo.com/api/v4/leads/123?with=contacts',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok-123' }) }),
    );
    expect(lead).toEqual({
      id: '123',
      name: 'Maria',
      statusId: '42',
      pipelineId: '7',
      price: 350,
      mainContactId: '31',
    });
  });

  it('extrai telefone/email dos custom_fields_values por field_code', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: 31,
      name: 'Maria',
      custom_fields_values: [
        { field_code: 'PHONE', values: [{ value: '+5511999998888' }] },
        { field_code: 'EMAIL', values: [{ value: 'maria@example.com' }] },
      ],
    }));

    const contact = await getKommoContact('31');
    expect(contact).toEqual({ id: '31', name: 'Maria', phone: '+5511999998888', email: 'maria@example.com' });
  });

  it('lança em erro HTTP (para breaker/caller tratarem)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));
    await expect(getKommoLead('123')).rejects.toThrow('Kommo API error: 401');
  });

  it('lança sem config (fail-closed)', async () => {
    delete process.env.KOMMO_ACCESS_TOKEN;
    await expect(getKommoLead('123')).rejects.toThrow('Kommo não configurado');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('escrita (nota, custom field, salesbot)', () => {
  it('addKommoNote posta nota comum no lead', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await addKommoNote('123', 'Tawany respondeu');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://clinica.kommo.com/api/v4/leads/notes');
    expect(JSON.parse((init as { body: string }).body)).toEqual([
      { entity_id: 123, note_type: 'common', params: { text: 'Tawany respondeu' } },
    ]);
  });

  it('updateKommoLeadTextField grava o custom field da resposta', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await updateKommoLeadTextField('123', '900', 'Olá! Posso ajudar?');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://clinica.kommo.com/api/v4/leads/123');
    expect((init as { method: string }).method).toBe('PATCH');
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      custom_fields_values: [{ field_id: 900, values: [{ value: 'Olá! Posso ajudar?' }] }],
    });
  });

  it('runKommoSalesbot dispara o bot para o lead (entity_type 2)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await runKommoSalesbot('10', '123');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://clinica.kommo.com/api/v2/salesbot/run');
    expect(JSON.parse((init as { body: string }).body)).toEqual([
      { bot_id: 10, entity_id: 123, entity_type: 2 },
    ]);
  });
});

describe('listKommoLeadsUpdatedSince', () => {
  it('pagina leads alterados e normaliza campos', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      _embedded: {
        leads: [
          { id: 123, name: 'Maria', status_id: 42, pipeline_id: 7, updated_at: 1752000100 },
          { name: 'sem id — ignorado' },
        ],
      },
    }));

    const leads = await listKommoLeadsUpdatedSince(1752000000, 2, 10);

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('filter[updated_at][from]=1752000000');
    expect(url).toContain('page=2');
    expect(url).toContain('limit=10');
    expect(leads).toEqual([
      { id: '123', name: 'Maria', statusId: '42', pipelineId: '7', updatedAt: 1752000100 },
    ]);
  });

  it('resposta sem leads vira lista vazia', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    expect(await listKommoLeadsUpdatedSince(0)).toEqual([]);
  });
});
