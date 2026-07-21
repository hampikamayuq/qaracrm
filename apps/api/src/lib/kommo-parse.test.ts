import { describe, expect, it } from 'vitest';
import {
  parseKommoSalesbotHook,
  parseKommoStageMap,
  parseKommoWebhook,
  stageForKommoStatus,
} from './kommo-parse';

// Shapes reais pós express.urlencoded({ extended: true }): chaves aninhadas
// viram objetos; índices numéricos podem virar array OU objeto {'0': ...}.

describe('parseKommoWebhook', () => {
  it('parseia leads[add] e leads[update]', () => {
    const events = parseKommoWebhook({
      leads: {
        add: [{ id: '123', name: 'Maria', status_id: '42', pipeline_id: '7', price: '350' }],
        update: { '0': { id: '124', name: 'João' } },
      },
    });
    expect(events).toEqual([
      { kind: 'lead', kommoLeadId: '123', name: 'Maria', statusId: '42', pipelineId: '7', price: 350 },
      { kind: 'lead', kommoLeadId: '124', name: 'João', statusId: null, pipelineId: null, price: null },
    ]);
  });

  it('parseia leads[status] com estágio anterior', () => {
    const events = parseKommoWebhook({
      leads: {
        status: [{ id: '123', status_id: '55', pipeline_id: '7', old_status_id: '42', old_pipeline_id: '7' }],
      },
    });
    expect(events).toEqual([
      {
        kind: 'status',
        kommoLeadId: '123',
        statusId: '55',
        pipelineId: '7',
        oldStatusId: '42',
        oldPipelineId: '7',
      },
    ]);
  });

  it('parseia message[add] incoming e outgoing com vínculo ao lead', () => {
    const events = parseKommoWebhook({
      message: {
        add: [
          {
            id: 'abc-1',
            chat_id: 'chat-9',
            talk_id: '77',
            contact_id: '31',
            text: 'Olá, quero agendar',
            created_at: '1752000000',
            entity_type: 'lead',
            entity_id: '123',
            type: 'incoming',
            author: { name: 'Maria' },
          },
          { id: 'abc-2', chat_id: 'chat-9', text: 'Já respondo!', type: 'outgoing' },
        ],
      },
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      kind: 'message',
      direction: 'IN',
      externalId: 'kommo:abc-1',
      chatId: 'chat-9',
      talkId: '77',
      contactId: '31',
      kommoLeadId: '123',
      text: 'Olá, quero agendar',
      sentAt: new Date(1752000000 * 1000).toISOString(),
      authorName: 'Maria',
    });
    expect(events[1]).toMatchObject({ direction: 'OUT', externalId: 'kommo:abc-2', kommoLeadId: null });
  });

  it('tolera payload vazio/lixo sem lançar', () => {
    expect(parseKommoWebhook(undefined)).toEqual([]);
    expect(parseKommoWebhook('lixo')).toEqual([]);
    expect(parseKommoWebhook({ account: { id: '1' } })).toEqual([]);
    expect(parseKommoWebhook({ message: { add: [{ id: 'x' }] } })).toEqual([]); // sem texto
  });
});

describe('parseKommoSalesbotHook', () => {
  it('parseia o shape configurado no widget_request (campos na raiz)', () => {
    const msg = parseKommoSalesbotHook({
      message_id: 'm-1',
      message_text: 'Oi, tudo bem?',
      lead_id: '123',
      talk_id: '77',
      contact_name: 'Maria',
      contact_phone: '+55 11 99999-8888',
      return_url: 'https://example.kommo.com/continue',
    }, 1752000000000);
    expect(msg).toMatchObject({
      kind: 'message',
      direction: 'IN',
      externalId: 'kommo:m-1',
      chatId: '77',
      kommoLeadId: '123',
      text: 'Oi, tudo bem?',
      contactName: 'Maria',
      contactPhone: '+55 11 99999-8888',
    });
  });

  it('aceita campos dentro de data e sintetiza id com bucket de 60s + hash do texto', () => {
    const at = 1752000000000;
    const msg = parseKommoSalesbotHook({ data: { message_text: 'oi', lead_id: '9' } }, at);
    expect(msg?.externalId).toMatch(new RegExp(`^kommo:sb:9:${Math.floor(at / 60_000)}:[0-9a-f]{10}$`));
    // Retry no mesmo minuto gera o MESMO id (dedup); minuto seguinte, outro.
    const retry = parseKommoSalesbotHook({ data: { message_text: 'oi', lead_id: '9' } }, at + 30_000);
    const later = parseKommoSalesbotHook({ data: { message_text: 'oi', lead_id: '9' } }, at + 61_000);
    expect(retry?.externalId).toBe(msg?.externalId);
    expect(later?.externalId).not.toBe(msg?.externalId);
    // Mensagens DIFERENTES no mesmo minuto não colidem (hash do texto no id).
    const other = parseKommoSalesbotHook({ data: { message_text: 'quero agendar', lead_id: '9' } }, at + 10_000);
    expect(other?.externalId).not.toBe(msg?.externalId);
  });

  it('retorna null sem texto ou sem chave de conversa', () => {
    expect(parseKommoSalesbotHook({ message_text: '   ' })).toBeNull();
    expect(parseKommoSalesbotHook({ lead_id: '9' })).toBeNull();
    expect(parseKommoSalesbotHook(undefined)).toBeNull();
  });
});

describe('KOMMO_STAGE_MAP', () => {
  it('parseia o JSON e resolve por pipeline:status com fallback por status', () => {
    const map = parseKommoStageMap('{"7:42":"qualificado","55":"agendado"}');
    expect(stageForKommoStatus(map, '7', '42')).toBe('qualificado');
    expect(stageForKommoStatus(map, '9', '55')).toBe('agendado');
    expect(stageForKommoStatus(map, '7', '99')).toBeNull();
    expect(stageForKommoStatus(map, null, null)).toBeNull();
  });

  it('JSON inválido ou vazio vira mapa vazio (não lança)', () => {
    expect(parseKommoStageMap('{nope')).toEqual({});
    expect(parseKommoStageMap(undefined)).toEqual({});
    expect(parseKommoStageMap('{"7:42": 13}')).toEqual({});
  });
});
