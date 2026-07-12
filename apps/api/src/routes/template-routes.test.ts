import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => ({
  listMetaTemplates: vi.fn(),
  createMetaTemplate: vi.fn(),
  deleteMetaTemplate: vi.fn(),
  isMetaTemplatesConfigured: vi.fn().mockReturnValue(true),
  auditCreate: vi.fn().mockResolvedValue({}),
}));

vi.mock('../lib/meta-templates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/meta-templates')>()),
  listMetaTemplates: mocks.listMetaTemplates,
  createMetaTemplate: mocks.createMetaTemplate,
  deleteMetaTemplate: mocks.deleteMetaTemplate,
  isMetaTemplatesConfigured: mocks.isMetaTemplatesConfigured,
}));

vi.mock('../lib/deps', () => ({ prisma: { auditLog: { create: mocks.auditCreate } } }));
vi.mock('../middleware/auth-middleware', () => ({
  authMiddleware: vi.fn((_req, _res, next) => next()),
}));

const req = (overrides: Partial<Request>): Request => overrides as Request;
const res = () => {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  return response as unknown as Response & typeof response;
};

describe('Template routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isMetaTemplatesConfigured.mockReturnValue(true);
  });

  it('GET devolve configured:false sem credenciais (sem chamar a Meta)', async () => {
    mocks.isMetaTemplatesConfigured.mockReturnValue(false);
    const { listTemplatesRoute } = await import('./template-routes');
    const response = res();

    await listTemplatesRoute(req({}), response);

    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: { configured: false, templates: [] },
    });
    expect(mocks.listMetaTemplates).not.toHaveBeenCalled();
  });

  it('GET lista templates da Meta quando configurado', async () => {
    mocks.listMetaTemplates.mockResolvedValue([{ name: 'qara_x', status: 'APPROVED' }]);
    const { listTemplatesRoute } = await import('./template-routes');
    const response = res();

    await listTemplatesRoute(req({}), response);

    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: { configured: true, templates: [{ name: 'qara_x', status: 'APPROVED' }] },
    });
  });

  it('POST valida nome snake_case, categoria e exemplos por placeholder', async () => {
    const { createTemplateRoute } = await import('./template-routes');

    const badName = res();
    await createTemplateRoute(req({ body: { name: 'Nome Ruim', category: 'UTILITY', body: 'x' } }), badName);
    expect(badName.status).toHaveBeenCalledWith(400);

    const badCategory = res();
    await createTemplateRoute(req({ body: { name: 'qara_ok', category: 'SPAM', body: 'x' } }), badCategory);
    expect(badCategory.status).toHaveBeenCalledWith(400);

    const missingExamples = res();
    await createTemplateRoute(
      req({ body: { name: 'qara_ok', category: 'UTILITY', body: 'Oi {{1}} e {{2}}', examples: ['só um'] } }),
      missingExamples,
    );
    expect(missingExamples.status).toHaveBeenCalledWith(400);
    expect(mocks.createMetaTemplate).not.toHaveBeenCalled();
  });

  it('POST cria, audita e devolve status PENDING', async () => {
    mocks.createMetaTemplate.mockResolvedValue({ id: 't1', status: 'PENDING' });
    const { createTemplateRoute } = await import('./template-routes');
    const response = res();

    await createTemplateRoute(
      req({ userId: 'u1', body: { name: 'qara_lembrete', category: 'UTILITY', body: 'Oi {{1}}', examples: ['Maria'], footer: 'QARA' } } as Partial<Request>),
      response,
    );

    expect(mocks.createMetaTemplate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'qara_lembrete',
      category: 'UTILITY',
      language: 'pt_BR',
      footer: 'QARA',
      examples: ['Maria'],
    }));
    expect(mocks.auditCreate).toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: { name: 'qara_lembrete', status: 'PENDING' },
    });
  });

  it('POST valida botões (máx 3, URL exige link) e repassa header', async () => {
    const { createTemplateRoute } = await import('./template-routes');

    const badUrl = res();
    await createTemplateRoute(
      req({ body: { name: 'qara_ok', category: 'UTILITY', body: 'oi', buttons: [{ type: 'URL', text: 'ir', url: 'nao-e-url' }] } }),
      badUrl,
    );
    expect(badUrl.status).toHaveBeenCalledWith(400);

    const tooMany = res();
    await createTemplateRoute(
      req({ body: { name: 'qara_ok', category: 'UTILITY', body: 'oi', buttons: [
        { type: 'QUICK_REPLY', text: 'a' }, { type: 'QUICK_REPLY', text: 'b' },
        { type: 'QUICK_REPLY', text: 'c' }, { type: 'QUICK_REPLY', text: 'd' },
      ] } }),
      tooMany,
    );
    expect(tooMany.status).toHaveBeenCalledWith(400);
    expect(mocks.createMetaTemplate).not.toHaveBeenCalled();

    mocks.createMetaTemplate.mockResolvedValue({ id: 't1', status: 'PENDING' });
    const ok = res();
    await createTemplateRoute(
      req({ body: { name: 'qara_ok', category: 'UTILITY', header: 'Título', body: 'oi', buttons: [{ type: 'QUICK_REPLY', text: 'Confirmar' }] } }),
      ok,
    );
    expect(mocks.createMetaTemplate).toHaveBeenCalledWith(expect.objectContaining({
      header: 'Título',
      buttons: [{ type: 'QUICK_REPLY', text: 'Confirmar' }],
    }));
  });

  it('DELETE exclui na Meta e audita; erro da Graph vira 502 legível', async () => {
    const { deleteTemplateRoute } = await import('./template-routes');
    const ok = res();
    await deleteTemplateRoute(req({ params: { name: 'qara_x' } }), ok);
    expect(mocks.deleteMetaTemplate).toHaveBeenCalledWith('qara_x');
    expect(ok.json).toHaveBeenCalledWith({ success: true, data: { deleted: 'qara_x' } });

    mocks.deleteMetaTemplate.mockRejectedValueOnce(new Error('Meta Templates API: sem permissão'));
    const fail = res();
    await deleteTemplateRoute(req({ params: { name: 'qara_x' } }), fail);
    expect(fail.status).toHaveBeenCalledWith(502);
  });
});
