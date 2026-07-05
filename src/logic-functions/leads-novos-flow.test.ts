import { describe, expect, it, vi } from 'vitest';
import type { DataApi } from 'src/lib/data';
import { runLeadsNovosFlow } from './leads-novos-flow';

const UUID = '00000000-0000-4000-8000-000000000000';

const makeData = (body = 'Oi, quero marcar consulta'): DataApi => ({
  get: vi.fn().mockImplementation(async (object: string) => {
    if (object === 'chatMessage') return { id: 'm1', body };
    if (object === 'conversation') return { id: UUID, channel: 'WHATSAPP', externalId: '5521999999999' };
    return { id: UUID };
  }),
  list: vi.fn(),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
});

describe('runLeadsNovosFlow', () => {
  it('sends a safe deterministic reply and records an activity', async () => {
    const data = makeData('Qual o endereço?');
    const result = await runLeadsNovosFlow({
      messageId: 'm1',
      conversationId: UUID,
      originalError: 'OpenRouter timeout',
    }, { data });

    expect(result.status).toBe('replied');
    if (result.status !== 'replied') throw new Error('expected replied');
    expect(result.rule).toBe('address');
    expect(data.create).toHaveBeenCalledWith('chatMessage', expect.objectContaining({
      direction: 'OUT',
      conversationId: UUID,
    }));
    expect(data.create).toHaveBeenCalledWith('note', expect.objectContaining({
      title: expect.stringContaining('leads-novos-flow: address'),
    }));
  });

  it('hands off when there is no safe deterministic match', async () => {
    const data = makeData('Tenho uma pergunta muito específica');
    const result = await runLeadsNovosFlow({ messageId: 'm1', conversationId: UUID }, { data });

    expect(result.status).toBe('handoff');
    expect(data.update).toHaveBeenCalledWith('conversation', UUID, expect.objectContaining({
      needsHuman: true,
      status: 'NEEDS_HUMAN',
      handoffReason: expect.stringContaining('leads_novos_no_match'),
    }));
  });

  it('hands off clinical risk instead of answering automatically', async () => {
    const data = makeData('Minha pinta cresceu e sangrou');
    const result = await runLeadsNovosFlow({ messageId: 'm1', conversationId: UUID }, { data });

    expect(result.status).toBe('handoff');
    expect(data.create).not.toHaveBeenCalledWith('chatMessage', expect.anything());
  });

  it('hands off if deterministic send fails', async () => {
    const data = makeData('oi');
    (data.create as ReturnType<typeof vi.fn>).mockImplementation(async (object: string) => {
      if (object === 'chatMessage') throw new Error('Meta down');
      return { id: 'created' };
    });

    const result = await runLeadsNovosFlow({ messageId: 'm1', conversationId: UUID }, { data });

    expect(result.status).toBe('handoff');
    expect(data.update).toHaveBeenCalledWith('conversation', UUID, expect.objectContaining({
      handoffReason: expect.stringContaining('leads_novos_error'),
    }));
  });
});
