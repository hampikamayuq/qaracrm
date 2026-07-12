import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataApi } from '../data';
import { matchActiveBots, runBotsForInbound } from './runner';

const mocks = vi.hoisted(() => ({
  sendExecute: vi.fn().mockResolvedValue(JSON.stringify({ ok: true })),
  handoff: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../tools/sendWhatsApp', () => ({
  sendWhatsApp: { execute: mocks.sendExecute },
}));

vi.mock('../handoff', () => ({
  handoff: mocks.handoff,
}));

const bot = (id: string, rules: unknown[], name = `Bot ${id}`) => ({
  id,
  name,
  steps: { mode: 'first-match', match: 'normalized-contains', rules },
});

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
  ...over,
});

describe('matchActiveBots', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pede bots ordenados por priority e desempata por createdAt', async () => {
    const list = vi.fn().mockResolvedValue([]);
    await matchActiveBots(api({ list }), 'oi');
    expect(list).toHaveBeenCalledWith('bot', {
      filter: { active: { eq: true } },
      orderBy: { priority: 'ASC', createdAt: 'ASC' },
    });
  });

  it('devolve o ruleIndex da regra que casou', async () => {
    const list = vi.fn().mockResolvedValue([
      bot('b1', [
        { terms: ['endereco'], responses: ['Rua X'] },
        { terms: ['horario'], responses: ['8h às 21h'] },
      ]),
    ]);
    const match = await matchActiveBots(api({ list }), 'horario');
    expect(match).toMatchObject({ botId: 'b1', ruleIndex: 1 });
  });

  it('risco bloqueia antes de consultar qualquer bot', async () => {
    const list = vi.fn();
    const match = await matchActiveBots(api({ list }), 'essa pinta pode ser melanoma?');
    expect(match).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });
});

describe('runBotsForInbound', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reply: envia respostas, grava BotReply e Activity, handled true', async () => {
    const list = vi.fn().mockResolvedValue([
      bot('b1', [{ terms: ['endereco'], responses: ['Rua X', 'Sala 2'] }]),
    ]);
    const create = vi.fn().mockResolvedValue({ id: 'x' });
    const data = api({ list, create });

    const outcome = await runBotsForInbound({ conversationId: 'c1', text: 'endereco' }, data);

    expect(outcome).toMatchObject({ handled: true, match: { botId: 'b1', ruleIndex: 0 } });
    expect(mocks.sendExecute).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledWith('botReply', expect.objectContaining({
      botId: 'b1', botName: 'Bot b1', ruleIndex: 0, action: 'reply', conversationId: 'c1',
    }));
    expect(create).toHaveBeenCalledWith('activity', expect.objectContaining({ type: 'MESSAGE_SENT' }));
    expect(mocks.handoff).not.toHaveBeenCalled();
  });

  it('tawany: não envia nada, grava BotReply e handled false', async () => {
    const list = vi.fn().mockResolvedValue([
      bot('b1', [{ terms: ['plano de saude'], responses: [], action: 'tawany' }]),
    ]);
    const create = vi.fn().mockResolvedValue({ id: 'x' });

    const outcome = await runBotsForInbound({ conversationId: 'c1', text: 'plano de saude' }, api({ list, create }));

    expect(outcome).toMatchObject({ handled: false });
    expect(mocks.sendExecute).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith('botReply', expect.objectContaining({ action: 'tawany' }));
    // Sem Activity MESSAGE_SENT — nada foi enviado.
    expect(create).not.toHaveBeenCalledWith('activity', expect.anything());
  });

  it('handoff: responde antes (se houver respostas) e marca a conversa pro humano', async () => {
    const list = vi.fn().mockResolvedValue([
      bot('b1', [{ terms: ['falar com atendente'], responses: ['Já te conecto!'], action: 'handoff', handoffReason: 'pediu humano' }]),
    ]);
    const data = api({ list });

    const outcome = await runBotsForInbound({ conversationId: 'c1', text: 'falar com atendente' }, data);

    expect(outcome).toMatchObject({ handled: true });
    expect(mocks.sendExecute).toHaveBeenCalledTimes(1);
    expect(mocks.handoff).toHaveBeenCalledWith('c1', 'pediu humano', data);
  });

  it('handoff sem respostas e sem motivo: só o handoff, com motivo derivado do nome', async () => {
    const list = vi.fn().mockResolvedValue([
      bot('b1', [{ terms: ['reagendar'], responses: [], action: 'handoff' }], 'Recepção'),
    ]);
    const data = api({ list });

    await runBotsForInbound({ conversationId: 'c1', text: 'reagendar' }, data);

    expect(mocks.sendExecute).not.toHaveBeenCalled();
    expect(mocks.handoff).toHaveBeenCalledWith('c1', 'Bot "Recepção"', data);
  });

  it('interpola {{nome}}/{{primeiro_nome}} com o lead da conversa', async () => {
    const list = vi.fn().mockResolvedValue([
      bot('b1', [{ terms: ['oi'], responses: ['Olá {{primeiro_nome}}, tudo bem?'] }]),
    ]);
    const get = vi.fn().mockImplementation(async (obj: string) =>
      obj === 'conversation' ? { leadId: 'l1' } : { name: 'Maria Silva' });

    await runBotsForInbound({ conversationId: 'c1', text: 'oi' }, api({ list, get }));

    expect(mocks.sendExecute).toHaveBeenCalledWith(
      { conversationId: 'c1', text: 'Olá Maria, tudo bem?' },
      expect.anything(),
    );
  });

  it('lead sem nome: placeholder some e espaços duplos colapsam', async () => {
    const list = vi.fn().mockResolvedValue([
      bot('b1', [{ terms: ['oi'], responses: ['Olá {{nome}} , bem-vinda!'] }]),
    ]);
    const get = vi.fn().mockResolvedValue(null);

    await runBotsForInbound({ conversationId: 'c1', text: 'oi' }, api({ list, get }));

    expect(mocks.sendExecute).toHaveBeenCalledWith(
      { conversationId: 'c1', text: 'Olá , bem-vinda!' },
      expect.anything(),
    );
  });

  it('falha ao gravar BotReply nunca segura a resposta (non-fatal)', async () => {
    const list = vi.fn().mockResolvedValue([
      bot('b1', [{ terms: ['endereco'], responses: ['Rua X'] }]),
    ]);
    const create = vi.fn().mockImplementation(async (obj: string) => {
      if (obj === 'botReply') throw new Error('db down');
      return { id: 'x' };
    });

    const outcome = await runBotsForInbound({ conversationId: 'c1', text: 'endereco' }, api({ list, create }));

    expect(outcome).toMatchObject({ handled: true });
    expect(mocks.sendExecute).toHaveBeenCalledTimes(1);
  });
});
