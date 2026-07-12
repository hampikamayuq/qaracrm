import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countPlaceholders,
  createMetaTemplate,
  deleteMetaTemplate,
  isMetaTemplatesConfigured,
  listMetaTemplates,
} from './meta-templates';

const fetchMock = vi.fn();

describe('meta-templates', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    process.env.META_ACCESS_TOKEN = 'token';
    process.env.META_WABA_ID = 'waba-1';
    delete process.env.META_GRAPH_BASE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.META_WABA_ID;
  });

  it('configured exige token E waba id', () => {
    expect(isMetaTemplatesConfigured()).toBe(true);
    delete process.env.META_WABA_ID;
    expect(isMetaTemplatesConfigured()).toBe(false);
  });

  it('countPlaceholders devolve o maior índice {{n}}', () => {
    expect(countPlaceholders('sem variável')).toBe(0);
    expect(countPlaceholders('Oi {{1}}, sua consulta é {{ 2 }}.')).toBe(2);
  });

  it('lista templates extraindo body/footer dos components', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          id: 't1',
          name: 'qara_confirmacao',
          status: 'APPROVED',
          category: 'UTILITY',
          language: 'pt_BR',
          components: [
            { type: 'BODY', text: 'Olá {{1}}!' },
            { type: 'FOOTER', text: 'Clínica QARA' },
          ],
        }],
      }),
    });

    const templates = await listMetaTemplates();

    expect(fetchMock.mock.calls[0][0]).toContain('/waba-1/message_templates');
    expect(templates[0]).toMatchObject({
      name: 'qara_confirmacao',
      status: 'APPROVED',
      body: 'Olá {{1}}!',
      footer: 'Clínica QARA',
    });
  });

  it('cria template com example quando há placeholders e FOOTER opcional', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 't9', status: 'PENDING' }) });

    const result = await createMetaTemplate({
      name: 'qara_lembrete',
      category: 'UTILITY',
      language: 'pt_BR',
      body: 'Oi {{1}}, sua consulta é {{2}}.',
      footer: 'Clínica QARA',
      examples: ['Maria', 'amanhã às 10h'],
    });

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(payload.components[0]).toEqual({
      type: 'BODY',
      text: 'Oi {{1}}, sua consulta é {{2}}.',
      example: { body_text: [['Maria', 'amanhã às 10h']] },
    });
    expect(payload.components[1]).toEqual({ type: 'FOOTER', text: 'Clínica QARA' });
    expect(result).toEqual({ id: 't9', status: 'PENDING' });
  });

  it('lista extrai HEADER (texto) e BUTTONS dos components', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          id: 't2', name: 'qara_lembrete', status: 'APPROVED', category: 'UTILITY', language: 'pt_BR',
          components: [
            { type: 'HEADER', format: 'TEXT', text: 'Lembrete' },
            { type: 'BODY', text: 'Oi {{1}}' },
            { type: 'BUTTONS', buttons: [
              { type: 'QUICK_REPLY', text: 'Confirmar' },
              { type: 'URL', text: 'Agendar', url: 'https://qara.example/agendar' },
            ] },
          ],
        }],
      }),
    });

    const [t] = await listMetaTemplates();

    expect(t.header).toBe('Lembrete');
    expect(t.buttons).toEqual([
      { type: 'QUICK_REPLY', text: 'Confirmar' },
      { type: 'URL', text: 'Agendar', url: 'https://qara.example/agendar' },
    ]);
  });

  it('cria com HEADER, BUTTONS (quick-reply + url) na ordem certa dos components', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 't3', status: 'PENDING' }) });

    await createMetaTemplate({
      name: 'qara_confirma',
      category: 'UTILITY',
      language: 'pt_BR',
      header: 'Confirmação',
      body: 'Oi {{1}}, confirma?',
      footer: 'QARA',
      examples: ['Maria'],
      buttons: [
        { type: 'QUICK_REPLY', text: 'Sim' },
        { type: 'URL', text: 'Remarcar', url: 'https://qara.example/remarcar' },
      ],
    });

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(payload.components.map((c: { type: string }) => c.type)).toEqual(['HEADER', 'BODY', 'FOOTER', 'BUTTONS']);
    expect(payload.components[0]).toEqual({ type: 'HEADER', format: 'TEXT', text: 'Confirmação' });
    expect(payload.components[3].buttons).toEqual([
      { type: 'QUICK_REPLY', text: 'Sim' },
      { type: 'URL', text: 'Remarcar', url: 'https://qara.example/remarcar' },
    ]);
  });

  it('erros da Graph API viram mensagem legível (error_user_msg)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'genérico', error_user_msg: 'Nome já existe.' } }),
    });

    await expect(deleteMetaTemplate('qara_x')).rejects.toThrow('Nome já existe.');
  });
});
