import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// supertest com router real + auth-middleware real (verifyToken mockado) —
// cobre wiring, validação e o 401 sem Authorization (padrão tags-routes).
const mocks = vi.hoisted(() => ({
  prisma: {
    knowledgeSection: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    session: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
  invalidateKnowledgeCache: vi.fn(),
}));

vi.mock('../lib/deps', () => ({ prisma: mocks.prisma }));
vi.mock('../lib/auth', () => ({
  verifyToken: vi.fn((token: string) => {
    if (token === 'good-token') return { userId: 'u1', role: 'ADMIN' };
    if (token === 'reception-token') return { userId: 'u2', role: 'recepcao' };
    return null;
  }),
}));
vi.mock('../lib/tawany/knowledge', () => ({
  invalidateKnowledgeCache: mocks.invalidateKnowledgeCache,
}));

const AUTH = { Authorization: 'Bearer good-token' };
const RECEPTION_AUTH = { Authorization: 'Bearer reception-token' };

const makeApp = async () => {
  const { default: router } = await import('./settings-routes');
  const app = express();
  app.use(express.json());
  app.use('/api/settings', router);
  return app;
};

describe('Settings routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.session.findUnique.mockResolvedValue({
      token: 'good-token',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    mocks.prisma.knowledgeSection.findMany.mockResolvedValue([]);
    mocks.prisma.auditLog.create.mockResolvedValue({});
  });

  it('retorna 401 sem Authorization em todos os endpoints', async () => {
    const app = await makeApp();
    expect((await request(app).get('/api/settings/knowledge')).status).toBe(401);
    expect((await request(app).put('/api/settings/knowledge/tags').send({ content: 'x' })).status).toBe(401);
    expect((await request(app).get('/api/settings/ai')).status).toBe(401);
    expect(mocks.prisma.knowledgeSection.findMany).not.toHaveBeenCalled();
  });

  it('GET /knowledge lista seções em ordem com nome de quem editou', async () => {
    mocks.prisma.knowledgeSection.findMany.mockResolvedValue([
      { id: 'k1', slug: 'tags', title: 'Tags', content: '...', updatedAt: new Date(), updatedById: 'u9' },
      { id: 'k2', slug: 'clinica', title: 'Clínica', content: '...', updatedAt: new Date(), updatedById: null },
    ]);
    mocks.prisma.user.findMany.mockResolvedValue([{ id: 'u9', name: 'Ana' }]);
    const app = await makeApp();

    const res = await request(app).get('/api/settings/knowledge').set(AUTH);

    expect(res.status).toBe(200);
    expect(mocks.prisma.knowledgeSection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { sortOrder: 'asc' } }),
    );
    expect(res.body.data[0].updatedByName).toBe('Ana');
    expect(res.body.data[1].updatedByName).toBeNull();
  });

  it('PUT /knowledge/:slug valida content e title', async () => {
    const app = await makeApp();

    expect((await request(app).put('/api/settings/knowledge/tags').set(AUTH).send({})).status).toBe(400);
    expect((await request(app).put('/api/settings/knowledge/tags').set(AUTH).send({ content: '  ' })).status).toBe(400);
    expect(
      (await request(app).put('/api/settings/knowledge/tags').set(AUTH).send({ content: 'a'.repeat(20_001) })).status,
    ).toBe(400);
    expect(
      (await request(app).put('/api/settings/knowledge/tags').set(AUTH).send({ content: 'ok', title: '' })).status,
    ).toBe(400);
    expect(mocks.prisma.knowledgeSection.updateMany).not.toHaveBeenCalled();
  });

  it('PUT /knowledge/:slug bloqueia usuário não-admin', async () => {
    const app = await makeApp();

    const res = await request(app)
      .put('/api/settings/knowledge/tags')
      .set(RECEPTION_AUTH)
      .send({ content: 'novo conteúdo' });

    expect(res.status).toBe(403);
    expect(mocks.prisma.knowledgeSection.updateMany).not.toHaveBeenCalled();
    expect(mocks.invalidateKnowledgeCache).not.toHaveBeenCalled();
  });

  it('PUT /knowledge/:slug grava content + updatedById e invalida o cache', async () => {
    mocks.prisma.knowledgeSection.updateMany.mockResolvedValue({ count: 1 });
    const app = await makeApp();

    const res = await request(app)
      .put('/api/settings/knowledge/tags')
      .set(AUTH)
      .send({ content: 'novo conteúdo', title: 'Tags do CRM' });

    expect(res.status).toBe(200);
    expect(mocks.prisma.knowledgeSection.updateMany).toHaveBeenCalledWith({
      where: { slug: 'tags' },
      data: { content: 'novo conteúdo', title: 'Tags do CRM', updatedById: 'u1' },
    });
    expect(mocks.invalidateKnowledgeCache).toHaveBeenCalled();
  });

  it('PUT /knowledge/:slug retorna 404 para slug inexistente', async () => {
    mocks.prisma.knowledgeSection.updateMany.mockResolvedValue({ count: 0 });
    const app = await makeApp();

    const res = await request(app).put('/api/settings/knowledge/ghost').set(AUTH).send({ content: 'x' });

    expect(res.status).toBe(404);
    expect(mocks.invalidateKnowledgeCache).not.toHaveBeenCalled();
  });

  it('GET /ai devolve shadowMode e promptVersion', async () => {
    mocks.prisma.knowledgeSection.findMany.mockResolvedValue([]);
    const app = await makeApp();

    const res = await request(app).get('/api/settings/ai').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      mode: expect.stringMatching(/^(shadow|human_approval|autopilot|recomendacoes|hibrido)$/),
      shadowMode: expect.stringMatching(/^(shadow|human_approval|autopilot)$/),
      promptVersion: expect.any(String),
      autopilotIntents: expect.any(Array),
    });
  });

  it('PUT /ai salva modo híbrido e intents permitidas somente para admin', async () => {
    mocks.prisma.knowledgeSection.upsert.mockResolvedValue({ id: 'cfg' });
    const app = await makeApp();

    const forbidden = await request(app)
      .put('/api/settings/ai')
      .set(RECEPTION_AUTH)
      .send({ mode: 'hibrido', autopilotIntents: ['ENDERECO'] });
    expect(forbidden.status).toBe(403);

    const res = await request(app)
      .put('/api/settings/ai')
      .set(AUTH)
      .send({ mode: 'hibrido', autopilotIntents: ['ENDERECO', 'HORARIO'] });

    expect(res.status).toBe(200);
    expect(mocks.prisma.knowledgeSection.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { slug: '__ai_settings' },
      create: expect.objectContaining({ slug: '__ai_settings' }),
      update: expect.objectContaining({ updatedById: 'u1' }),
    }));
    expect(JSON.parse(mocks.prisma.knowledgeSection.upsert.mock.calls[0][0].update.content)).toEqual({
      mode: 'hibrido',
      autopilotIntents: ['ENDERECO', 'HORARIO'],
    });
  });

  it('PUT /ai grava auditoria com before/after do JSON de settings', async () => {
    // Arrange
    mocks.prisma.knowledgeSection.findMany.mockResolvedValue([
      { content: JSON.stringify({ mode: 'shadow', autopilotIntents: [] }) },
    ]);
    mocks.prisma.knowledgeSection.upsert.mockResolvedValue({ id: 'cfg' });
    const app = await makeApp();

    // Act
    const res = await request(app)
      .put('/api/settings/ai')
      .set(AUTH)
      .send({ mode: 'hibrido', autopilotIntents: ['ENDERECO'] });

    // Assert
    expect(res.status).toBe(200);
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        action: 'ai_settings.update',
        entity: 'ai_settings',
        entityId: '__ai_settings',
        before: { mode: 'shadow', autopilotIntents: [] },
        after: { mode: 'hibrido', autopilotIntents: ['ENDERECO'] },
      },
    });
  });

  it('PUT /knowledge/:slug grava auditoria truncando before/after em 200 chars', async () => {
    // Arrange
    const longContent = 'x'.repeat(500);
    mocks.prisma.knowledgeSection.findFirst.mockResolvedValue({ content: 'conteúdo antigo' });
    mocks.prisma.knowledgeSection.updateMany.mockResolvedValue({ count: 1 });
    const app = await makeApp();

    // Act
    const res = await request(app).put('/api/settings/knowledge/tags').set(AUTH).send({ content: longContent });

    // Assert
    expect(res.status).toBe(200);
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        action: 'knowledge.update',
        entity: 'knowledge_section',
        entityId: 'tags',
        before: { content: 'conteúdo antigo' },
        after: { content: 'x'.repeat(200) },
      },
    });
  });
});
