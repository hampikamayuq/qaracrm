import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { DataApi } from './data';

vi.mock('../logic-functions/tawany-handler', () => ({
  runTawanyHandler: vi.fn(),
}));

import { runTawanyHandler } from '../logic-functions/tawany-handler';

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
  ...over,
});

const inboundMessage = {
  id: 'msg-1',
  conversationId: 'conv-1',
  direction: 'IN',
  body: 'oi',
  agentHandled: false,
};

describe('shadow mode helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.SHADOW_MODE;
  });

  it('reads shadow mode flags from env', async () => {
    process.env.SHADOW_MODE = 'human_approval';
    const { isHumanApprovalMode, isShadowMode } = await import('./shadow');

    expect(isHumanApprovalMode()).toBe(true);
    expect(isShadowMode()).toBe(false);
  });

  it('rejects invalid shadow mode', async () => {
    process.env.SHADOW_MODE = 'invalid';
    const { isShadowMode } = await import('./shadow');

    expect(() => isShadowMode()).toThrow('Invalid SHADOW_MODE: invalid');
  });

  it('records shadow run as an Activity without full message bodies', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'a1' });
    const { recordShadowRun } = await import('./shadow');

    await recordShadowRun(api({ create }), {
      conversationId: 'conv-1',
      messageId: 'msg-1',
      tawanyReply: 'x'.repeat(600),
      twentyReply: '',
      tawanyToolCalls: 2,
      match: false,
    });

    expect(create).toHaveBeenCalledWith('activity', expect.objectContaining({
      targetType: 'conversation',
      targetId: 'conv-1',
    }));
    const body = JSON.parse(create.mock.calls[0][1].body);
    expect(body.type).toBe('shadow_run');
    expect(body.tawanyReply).toHaveLength(500);
  });
});

describe('runTawanyForProcessedMessages', () => {
  const ai = { chat: vi.fn() };
  const deps = (data: DataApi) => ({ createAi: () => ai as never, data });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.SHADOW_MODE;
  });

  it("modo shadow: busca a chatMessage, roda via runTawanyHandler com sendMode 'test' e registra shadow_run", async () => {
    process.env.SHADOW_MODE = 'shadow';
    const data = api({ get: vi.fn().mockResolvedValue(inboundMessage) });
    vi.mocked(runTawanyHandler).mockResolvedValue({ status: 'replied', toolCalls: 2, content: 'Olá!' });
    const { runTawanyForProcessedMessages } = await import('./shadow');

    await runTawanyForProcessedMessages(
      [{ conversationId: 'conv-1', messageId: 'msg-1' }],
      deps(data),
    );

    expect(data.get).toHaveBeenCalledWith('chatMessage', 'msg-1', expect.objectContaining({
      id: true, conversationId: true, direction: true, body: true, agentHandled: true,
    }));
    expect(runTawanyHandler).toHaveBeenCalledWith(
      inboundMessage,
      // markHandled false: shadow não consome a mensagem (run real depois ainda pode tratá-la)
      expect.objectContaining({ data, sendMode: 'test', markHandled: false }),
    );
    // observação pura: registra a Activity de shadow_run
    expect(data.create).toHaveBeenCalledWith('activity', expect.objectContaining({
      targetType: 'conversation',
      targetId: 'conv-1',
    }));
  });

  it("modo human_approval: roda com sendMode 'suggest_only' e não registra shadow_run", async () => {
    process.env.SHADOW_MODE = 'human_approval';
    const data = api({ get: vi.fn().mockResolvedValue(inboundMessage) });
    vi.mocked(runTawanyHandler).mockResolvedValue({ status: 'replied', toolCalls: 0, content: 'Olá!' });
    const { runTawanyForProcessedMessages } = await import('./shadow');

    await runTawanyForProcessedMessages(
      [{ conversationId: 'conv-1', messageId: 'msg-1' }],
      deps(data),
    );

    expect(runTawanyHandler).toHaveBeenCalledWith(
      inboundMessage,
      expect.objectContaining({ sendMode: 'suggest_only', markHandled: true }),
    );
    expect(data.create).not.toHaveBeenCalledWith('activity', expect.anything());
  });

  it("modo autopilot: roda com sendMode 'send'", async () => {
    process.env.SHADOW_MODE = 'autopilot';
    const data = api({ get: vi.fn().mockResolvedValue(inboundMessage) });
    vi.mocked(runTawanyHandler).mockResolvedValue({ status: 'replied', toolCalls: 1, content: 'Olá!' });
    const { runTawanyForProcessedMessages } = await import('./shadow');

    await runTawanyForProcessedMessages(
      [{ conversationId: 'conv-1', messageId: 'msg-1' }],
      deps(data),
    );

    expect(runTawanyHandler).toHaveBeenCalledWith(
      inboundMessage,
      expect.objectContaining({ sendMode: 'send' }),
    );
  });

  it('não registra shadow_run quando o handler pulou a mensagem (gates)', async () => {
    process.env.SHADOW_MODE = 'shadow';
    const data = api({ get: vi.fn().mockResolvedValue(inboundMessage) });
    vi.mocked(runTawanyHandler).mockResolvedValue({ status: 'skipped', reason: 'conversation_closed' });
    const { runTawanyForProcessedMessages } = await import('./shadow');

    await runTawanyForProcessedMessages(
      [{ conversationId: 'conv-1', messageId: 'msg-1' }],
      deps(data),
    );

    expect(data.create).not.toHaveBeenCalled();
  });

  it('ignora mensagens que não existem mais no banco', async () => {
    process.env.SHADOW_MODE = 'shadow';
    const data = api({ get: vi.fn().mockResolvedValue(null) });
    const { runTawanyForProcessedMessages } = await import('./shadow');

    await runTawanyForProcessedMessages(
      [{ conversationId: 'conv-1', messageId: 'msg-gone' }],
      deps(data),
    );

    expect(runTawanyHandler).not.toHaveBeenCalled();
  });

  it('usa o modo salvo em __ai_settings (DB), sobrepondo SHADOW_MODE do ambiente', async () => {
    process.env.SHADOW_MODE = 'shadow';
    const data = api({
      get: vi.fn().mockResolvedValue(inboundMessage),
      list: vi.fn().mockResolvedValue([{ content: JSON.stringify({ mode: 'autopilot', autopilotIntents: [] }) }]),
    });
    vi.mocked(runTawanyHandler).mockResolvedValue({ status: 'replied', toolCalls: 0, content: 'Olá!' });
    const { runTawanyForProcessedMessages } = await import('./shadow');

    await runTawanyForProcessedMessages([{ conversationId: 'conv-1', messageId: 'msg-1' }], deps(data));

    expect(runTawanyHandler).toHaveBeenCalledWith(
      inboundMessage,
      expect.objectContaining({ sendMode: 'send', markHandled: true }),
    );
  });

  it("modo 'hibrido' no banco colapsa para sendMode 'suggest_only' neste dispatch em lote", async () => {
    const data = api({
      get: vi.fn().mockResolvedValue(inboundMessage),
      list: vi.fn().mockResolvedValue([{ content: JSON.stringify({ mode: 'hibrido', autopilotIntents: ['AGENDAMENTO'] }) }]),
    });
    vi.mocked(runTawanyHandler).mockResolvedValue({ status: 'replied', toolCalls: 0, content: 'Olá!' });
    const { runTawanyForProcessedMessages } = await import('./shadow');

    await runTawanyForProcessedMessages([{ conversationId: 'conv-1', messageId: 'msg-1' }], deps(data));

    expect(runTawanyHandler).toHaveBeenCalledWith(
      inboundMessage,
      expect.objectContaining({ sendMode: 'suggest_only' }),
    );
  });

  it('segue mesmo sem createAi funcional — runTawanyHandler trata a config ausente', async () => {
    process.env.SHADOW_MODE = 'human_approval';
    const data = api({ get: vi.fn().mockResolvedValue(inboundMessage) });
    vi.mocked(runTawanyHandler).mockResolvedValue({ status: 'handoff', toolCalls: 0 });
    const { runTawanyForProcessedMessages } = await import('./shadow');

    await runTawanyForProcessedMessages(
      [{ conversationId: 'conv-1', messageId: 'msg-1' }],
      { createAi: () => { throw new Error('OPENROUTER_API_KEY missing'); }, data },
    );

    expect(runTawanyHandler).toHaveBeenCalledWith(
      inboundMessage,
      expect.objectContaining({ ai: undefined, sendMode: 'suggest_only' }),
    );
  });

  it('serializa mensagens da mesma conversa para evitar respostas concorrentes e fora de ordem', async () => {
    process.env.SHADOW_MODE = 'human_approval';
    const messages = {
      'msg-1': inboundMessage,
      'msg-2': { ...inboundMessage, id: 'msg-2', body: 'segunda mensagem' },
    };
    const data = api({
      get: vi.fn((_object, id) => Promise.resolve(messages[id as keyof typeof messages] ?? null)),
    });
    let releaseFirst: (() => void) | undefined;
    vi.mocked(runTawanyHandler)
      .mockImplementationOnce(() => new Promise((resolve) => {
        releaseFirst = () => resolve({ status: 'replied', content: 'primeira' });
      }))
      .mockResolvedValueOnce({ status: 'replied', content: 'segunda' });
    const { runTawanyForProcessedMessages } = await import('./shadow');

    const processing = runTawanyForProcessedMessages([
      { conversationId: 'conv-1', messageId: 'msg-1' },
      { conversationId: 'conv-1', messageId: 'msg-2' },
    ], deps(data));
    await vi.waitFor(() => expect(runTawanyHandler).toHaveBeenCalledTimes(1));

    releaseFirst?.();
    await processing;

    expect(runTawanyHandler).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runTawanyHandler).mock.calls.map(([message]) => message.id)).toEqual(['msg-1', 'msg-2']);
  });
});
