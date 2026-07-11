import { describe, expect, it } from 'vitest';
import { parseMetaEvent } from './meta-parse';

const waText = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '123',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            contacts: [{ wa_id: '5511999998888', profile: { name: 'Maria' } }],
            messages: [
              {
                id: 'wamid.ABC123',
                from: '5511999998888',
                timestamp: '1751650000',
                type: 'text',
                text: { body: 'Quero agendar uma consulta' },
              },
            ],
          },
        },
      ],
    },
  ],
};

const waStatuses = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '123',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            statuses: [
              { id: 'wamid.OUT1', status: 'delivered', timestamp: '1751650100' },
              { id: 'wamid.OUT2', status: 'read', timestamp: '1751650200' },
            ],
          },
        },
      ],
    },
  ],
};

const igMessage = {
  object: 'instagram',
  entry: [
    {
      id: 'ig-page-1',
      time: 1751650000000,
      messaging: [
        {
          sender: { id: 'IGSID-42' },
          recipient: { id: 'ig-page-1' },
          timestamp: 1751650000000,
          message: { mid: 'mid.IG1', text: 'Oi, vi o post de vocês' },
        },
      ],
    },
  ],
};

describe('parseMetaEvent — WhatsApp', () => {
  it('parses a text message', () => {
    const { messages, statuses } = parseMetaEvent(waText);
    expect(statuses).toEqual([]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      channel: 'WHATSAPP',
      externalId: 'wamid.ABC123',
      from: '5511999998888',
      text: 'Quero agendar uma consulta',
      sentAt: new Date(1751650000 * 1000).toISOString(),
      messageType: 'TEXT',
    });
  });

  it('parses interactive button and list replies', () => {
    const make = (interactive: object) => ({
      ...waText,
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.I1',
                    from: '551188887777',
                    timestamp: '1751650000',
                    type: 'interactive',
                    interactive,
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const btn = parseMetaEvent(
      make({ type: 'button_reply', button_reply: { id: 'b1', title: 'Sim' } }),
    );
    expect(btn.messages[0].messageType).toBe('BUTTON');
    expect(btn.messages[0].text).toBe('Sim');
    expect(btn.messages[0].buttonPayload).toBe('b1');

    const list = parseMetaEvent(
      make({ type: 'list_reply', list_reply: { id: 'r1', title: 'Botox' } }),
    );
    expect(list.messages[0].messageType).toBe('LIST');
    expect(list.messages[0].text).toBe('Botox');
    expect(list.messages[0].buttonPayload).toBeUndefined();
  });

  it('parses a template quick-reply button click (type=button) with its payload', () => {
    const body = {
      ...waText,
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.B1',
                    from: '551166665555',
                    timestamp: '1751650000',
                    type: 'button',
                    button: { payload: 'confirm_apt_a1b2', text: 'Confirmar' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const { messages } = parseMetaEvent(body);
    expect(messages[0].messageType).toBe('BUTTON');
    expect(messages[0].text).toBe('Confirmar');
    expect(messages[0].buttonPayload).toBe('confirm_apt_a1b2');
  });

  it('parses media with placeholder text', () => {
    const body = {
      ...waText,
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.M1',
                    from: '551177776666',
                    timestamp: '1751650000',
                    type: 'image',
                    image: { caption: 'minha pele' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const { messages } = parseMetaEvent(body);
    expect(messages[0].messageType).toBe('IMAGE');
    expect(messages[0].text).toBe('minha pele');
  });

  it('parses an audio note into the [áudio] placeholder + a whatsapp audio ref', () => {
    const body = {
      ...waText,
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.AUD1',
                    from: '551177776666',
                    timestamp: '1751650000',
                    type: 'audio',
                    audio: { id: 'MEDIA-XYZ', voice: true },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const { messages } = parseMetaEvent(body);
    expect(messages[0].text).toBe('[áudio]');
    expect(messages[0].messageType).toBe('TEXT');
    expect(messages[0].audio).toEqual({ source: 'whatsapp', mediaId: 'MEDIA-XYZ', voice: true });
  });

  it('parses delivery statuses', () => {
    const { messages, statuses } = parseMetaEvent(waStatuses);
    expect(messages).toEqual([]);
    expect(statuses).toEqual([
      { externalId: 'wamid.OUT1', status: 'DELIVERED' },
      { externalId: 'wamid.OUT2', status: 'READ' },
    ]);
  });
});

// Coexistence: espelhos de mensagens enviadas pelo app WhatsApp Business
// chegam pelo campo smb_message_echoes com from=nosso número e to=paciente.
const waEcho = (echo: object) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '123',
      changes: [
        {
          field: 'smb_message_echoes',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '5511900001111', phone_number_id: 'PNID-1' },
            message_echoes: [echo],
          },
        },
      ],
    },
  ],
});

describe('parseMetaEvent — WhatsApp Coexistence (smb_message_echoes)', () => {
  it('parses a text echo sent from the WhatsApp Business app', () => {
    const { messages, statuses, echoes } = parseMetaEvent(
      waEcho({
        from: '5511900001111',
        to: '5511999998888',
        id: 'wamid.ECHO1',
        timestamp: '1751650300',
        type: 'text',
        text: { body: 'Oi Maria, podemos sim!' },
      }),
    );
    expect(messages).toEqual([]);
    expect(statuses).toEqual([]);
    expect(echoes).toEqual([
      {
        channel: 'WHATSAPP',
        externalId: 'wamid.ECHO1',
        to: '5511999998888',
        text: 'Oi Maria, podemos sim!',
        sentAt: new Date(1751650300 * 1000).toISOString(),
        messageType: 'TEXT',
      },
    ]);
  });

  it('parses media echoes with placeholder text', () => {
    const image = parseMetaEvent(
      waEcho({ to: '5511999998888', id: 'wamid.E2', timestamp: '1751650300', type: 'image', image: {} }),
    );
    expect(image.echoes[0].text).toBe('[imagem]');
    expect(image.echoes[0].messageType).toBe('IMAGE');

    const video = parseMetaEvent(
      waEcho({ to: '5511999998888', id: 'wamid.E3', timestamp: '1751650300', type: 'video', video: {} }),
    );
    expect(video.echoes[0].text).toBe('[vídeo]');
  });

  it('ignores revoke/edit echoes and echoes without id/to', () => {
    const revoke = parseMetaEvent(
      waEcho({ to: '5511999998888', id: 'wamid.E4', timestamp: '1751650300', type: 'revoke' }),
    );
    expect(revoke.echoes).toEqual([]);
    const edit = parseMetaEvent(
      waEcho({ to: '5511999998888', id: 'wamid.E5', timestamp: '1751650300', type: 'edit' }),
    );
    expect(edit.echoes).toEqual([]);
    const noTo = parseMetaEvent(
      waEcho({ id: 'wamid.E6', timestamp: '1751650300', type: 'text', text: { body: 'x' } }),
    );
    expect(noTo.echoes).toEqual([]);
  });

  it('does not leak echoes into inbound messages', () => {
    const { messages } = parseMetaEvent(
      waEcho({
        to: '5511999998888',
        id: 'wamid.E7',
        timestamp: '1751650300',
        type: 'text',
        text: { body: 'resposta da clínica' },
      }),
    );
    expect(messages).toEqual([]);
  });
});

const igPageMessage = {
  object: 'page',
  entry: [
    {
      id: 'fb-page-1',
      time: 1751650000000,
      messaging: [
        {
          sender: { id: 'IGSID-99' },
          recipient: { id: 'fb-page-1' },
          timestamp: 1751650000000,
          message: { mid: 'mid.PAGE1', text: 'Oi via página' },
        },
      ],
    },
  ],
};

const igEcho = {
  object: 'instagram',
  entry: [
    {
      id: 'ig-page-1',
      time: 1751650000000,
      messaging: [
        {
          sender: { id: 'ig-page-1' },
          recipient: { id: 'IGSID-42' },
          timestamp: 1751650000000,
          message: { mid: 'mid.ECHO1', text: 'resposta nossa', is_echo: true },
        },
      ],
    },
  ],
};

describe('parseMetaEvent — Instagram', () => {
  it('parses an IG DM', () => {
    const { messages } = parseMetaEvent(igMessage);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      channel: 'INSTAGRAM',
      externalId: 'mid.IG1',
      from: 'IGSID-42',
      text: 'Oi, vi o post de vocês',
      sentAt: new Date(1751650000000).toISOString(),
      messageType: 'TEXT',
    });
  });

  it('parses IG delivered as object=page (Facebook Page shape)', () => {
    const { messages } = parseMetaEvent(igPageMessage);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      channel: 'INSTAGRAM',
      externalId: 'mid.PAGE1',
      from: 'IGSID-99',
      text: 'Oi via página',
      sentAt: new Date(1751650000000).toISOString(),
      messageType: 'TEXT',
    });
  });

  it('ignores echoes of our own outbound (is_echo)', () => {
    const { messages } = parseMetaEvent(igEcho);
    expect(messages).toEqual([]);
  });

  it('parses an IG audio attachment into the [áudio] placeholder + a direct-url audio ref', () => {
    const igAudio = {
      object: 'instagram',
      entry: [
        {
          id: 'ig-page-1',
          messaging: [
            {
              sender: { id: 'IGSID-42' },
              recipient: { id: 'ig-page-1' },
              timestamp: 1751650000000,
              message: {
                mid: 'mid.AUD1',
                attachments: [{ type: 'audio', payload: { url: 'https://cdn.ig/a.m4a' } }],
              },
            },
          ],
        },
      ],
    };
    const { messages } = parseMetaEvent(igAudio);
    expect(messages[0].text).toBe('[áudio]');
    expect(messages[0].audio).toEqual({ source: 'instagram', url: 'https://cdn.ig/a.m4a' });
  });
});

describe('parseMetaEvent — garbage in', () => {
  it('returns empty for null / non-object / unknown object', () => {
    expect(parseMetaEvent(null)).toEqual({ messages: [], statuses: [], echoes: [] });
    expect(parseMetaEvent('x')).toEqual({ messages: [], statuses: [], echoes: [] });
    expect(parseMetaEvent({ object: 'page' })).toEqual({ messages: [], statuses: [], echoes: [] });
  });
});
