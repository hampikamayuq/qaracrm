import { describe, expect, it } from 'vitest';
import { parseEvolutionWebhook } from './evolution-parse';

const upsert = (data: object) => ({
  event: 'messages.upsert',
  instance: 'qara-recepcao',
  data,
});

const textData = (over: object = {}) => ({
  key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'EVO1' },
  pushName: 'Maria Silva',
  message: { conversation: 'Oi, quero agendar' },
  messageTimestamp: 1751650000,
  ...over,
});

describe('parseEvolutionWebhook — messages.upsert', () => {
  it('parses a plain text message', () => {
    const events = parseEvolutionWebhook(upsert(textData()));
    expect(events).toEqual([
      {
        kind: 'message',
        instanceName: 'qara-recepcao',
        externalId: 'EVO1',
        contact: '5511999998888',
        fromMe: false,
        pushName: 'Maria Silva',
        text: 'Oi, quero agendar',
        sentAt: new Date(1751650000 * 1000).toISOString(),
        messageType: 'TEXT',
      },
    ]);
  });

  it('parses extendedTextMessage and fromMe echoes', () => {
    const events = parseEvolutionWebhook(
      upsert(textData({
        key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: true, id: 'EVO2' },
        message: { extendedTextMessage: { text: 'Podemos sim!' } },
      })),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'message', fromMe: true, text: 'Podemos sim!' });
  });

  it('parses media into placeholders (caption/fileName preserved) and audio with its key', () => {
    const image = parseEvolutionWebhook(
      upsert(textData({ message: { imageMessage: { caption: 'minha pele' } } })),
    );
    expect(image[0]).toMatchObject({ text: '[imagem] minha pele', messageType: 'IMAGE' });

    const doc = parseEvolutionWebhook(
      upsert(textData({ message: { documentMessage: { fileName: 'exame.pdf' } } })),
    );
    expect(doc[0]).toMatchObject({ text: '[documento: exame.pdf]', messageType: 'DOCUMENT' });

    const audio = parseEvolutionWebhook(
      upsert(textData({ message: { audioMessage: { seconds: 12 } } })),
    );
    expect(audio[0]).toMatchObject({
      text: '[áudio]',
      messageType: 'TEXT',
      audioKey: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'EVO1' },
    });
  });

  it('ignores groups, broadcast and @lid JIDs', () => {
    for (const remoteJid of [
      '123456-789@g.us',
      'status@broadcast',
      '987654@lid',
    ]) {
      const events = parseEvolutionWebhook(
        upsert(textData({ key: { remoteJid, fromMe: false, id: 'EVOX' } })),
      );
      expect(events).toEqual([]);
    }
  });

  it('accepts data as an array (some Evolution builds batch upserts)', () => {
    const events = parseEvolutionWebhook({
      event: 'messages.upsert',
      instance: 'qara-recepcao',
      data: [textData(), textData({ key: { remoteJid: '5511888887777@s.whatsapp.net', id: 'EVO3' } })],
    });
    expect(events).toHaveLength(2);
  });
});

describe('parseEvolutionWebhook — connection/qr events', () => {
  it('parses connection.update with the owner phone', () => {
    const events = parseEvolutionWebhook({
      event: 'connection.update',
      instance: 'qara-recepcao',
      data: { state: 'open', wuid: '5511900001111@s.whatsapp.net' },
    });
    expect(events).toEqual([
      { kind: 'connection', instanceName: 'qara-recepcao', state: 'open', phoneNumber: '5511900001111' },
    ]);
  });

  it('parses qrcode.updated as a pairing signal (QR itself is not stored)', () => {
    const events = parseEvolutionWebhook({
      event: 'qrcode.updated',
      instance: 'qara-recepcao',
      data: { qrcode: { base64: 'data:image/png;base64,...' } },
    });
    expect(events).toEqual([{ kind: 'qr', instanceName: 'qara-recepcao' }]);
  });
});

describe('parseEvolutionWebhook — garbage in', () => {
  it('returns empty for null, unknown events and missing instance', () => {
    expect(parseEvolutionWebhook(null)).toEqual([]);
    expect(parseEvolutionWebhook({ event: 'messages.upsert' })).toEqual([]);
    expect(parseEvolutionWebhook({ event: 'contacts.update', instance: 'x', data: {} })).toEqual([]);
    expect(parseEvolutionWebhook({ event: 'messages.upsert', instance: 'x', data: { key: {} } })).toEqual([]);
  });
});
