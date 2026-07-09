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
    expect(parseMetaEvent(null)).toEqual({ messages: [], statuses: [] });
    expect(parseMetaEvent('x')).toEqual({ messages: [], statuses: [] });
    expect(parseMetaEvent({ object: 'page' })).toEqual({ messages: [], statuses: [] });
  });
});
