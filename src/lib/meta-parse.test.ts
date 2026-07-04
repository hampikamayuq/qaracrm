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

    const list = parseMetaEvent(
      make({ type: 'list_reply', list_reply: { id: 'r1', title: 'Botox' } }),
    );
    expect(list.messages[0].messageType).toBe('LIST');
    expect(list.messages[0].text).toBe('Botox');
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

  it('parses delivery statuses', () => {
    const { messages, statuses } = parseMetaEvent(waStatuses);
    expect(messages).toEqual([]);
    expect(statuses).toEqual([
      { externalId: 'wamid.OUT1', status: 'DELIVERED' },
      { externalId: 'wamid.OUT2', status: 'READ' },
    ]);
  });
});

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
});

describe('parseMetaEvent — garbage in', () => {
  it('returns empty for null / non-object / unknown object', () => {
    expect(parseMetaEvent(null)).toEqual({ messages: [], statuses: [] });
    expect(parseMetaEvent('x')).toEqual({ messages: [], statuses: [] });
    expect(parseMetaEvent({ object: 'page' })).toEqual({ messages: [], statuses: [] });
  });
});
