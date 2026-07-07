import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ponytail: supertest com o router real + auth-middleware real (verifyToken
// mockado) — cobre o wiring das rotas E o 401 sem Authorization de verdade.
const mocks = vi.hoisted(() => ({
  prisma: {
    lead: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    session: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../lib/deps', () => ({ prisma: mocks.prisma }));
vi.mock('../lib/auth', () => ({
  verifyToken: vi.fn((token: string) => (token === 'good-token' ? { userId: 'u1', role: 'ADMIN' } : null)),
}));

const AUTH = { Authorization: 'Bearer good-token' };

const makeApp = async () => {
  const { default: router } = await import('./tags-routes');
  const app = express();
  app.use(express.json());
  app.use('/api/tags', router);
  return app;
};

describe('Tags routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.session.findUnique.mockResolvedValue({
      token: 'good-token',
      expiresAt: new Date(Date.now() + 3600_000),
    });
  });

  it('retorna 401 sem Authorization em todos os endpoints', async () => {
    const app = await makeApp();

    expect((await request(app).get('/api/tags/canonical')).status).toBe(401);
    expect((await request(app).get('/api/tags/contextual')).status).toBe(401);
    expect((await request(app).post('/api/tags/leads/l1/tags').send({ tag: 'VIP' })).status).toBe(401);
    expect((await request(app).delete('/api/tags/leads/l1/tags/VIP')).status).toBe(401);
    expect((await request(app).put('/api/tags/leads/l1/tags').send({ tags: [] })).status).toBe(401);
    expect(mocks.prisma.lead.findUnique).not.toHaveBeenCalled();
  });

  it('GET /canonical lista as tags canônicas', async () => {
    const app = await makeApp();

    const res = await request(app).get('/api/tags/canonical').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'LEAD_QUENTE', category: 'temperature' }),
      expect.objectContaining({ value: 'VIP', category: 'priority' }),
    ]));
  });

  it('GET /contextual lista as categorias de tags contextuais', async () => {
    const app = await makeApp();

    const res = await request(app).get('/api/tags/contextual').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.alerta).toContain('alerta:urgente');
    expect(res.body.data.pipeline).toContain('pipeline:cirurgia');
    expect(res.body.data.origem).toContain('origem:instagram');
  });

  it('POST /leads/:leadId/tags adiciona tag nova sem duplicar', async () => {
    mocks.prisma.lead.findUnique.mockResolvedValue({ tags: ['VIP'] });
    mocks.prisma.lead.update.mockResolvedValue({});
    const app = await makeApp();

    const added = await request(app).post('/api/tags/leads/l1/tags').set(AUTH).send({ tag: 'LEAD_QUENTE' });
    expect(added.status).toBe(200);
    expect(added.body.data).toEqual({ tags: ['VIP', 'LEAD_QUENTE'], added: true });

    const dup = await request(app).post('/api/tags/leads/l1/tags').set(AUTH).send({ tag: 'VIP' });
    expect(dup.body.data).toEqual({ tags: ['VIP'], added: false });
  });

  it('POST /leads/:leadId/tags valida payload e lead inexistente', async () => {
    const app = await makeApp();

    const noTag = await request(app).post('/api/tags/leads/l1/tags').set(AUTH).send({ tag: '   ' });
    expect(noTag.status).toBe(400);

    mocks.prisma.lead.findUnique.mockResolvedValue(null);
    const noLead = await request(app).post('/api/tags/leads/ghost/tags').set(AUTH).send({ tag: 'VIP' });
    expect(noLead.status).toBe(404);
  });

  it('DELETE /leads/:leadId/tags/:tag remove a tag (com decode de URI)', async () => {
    mocks.prisma.lead.findUnique.mockResolvedValue({ tags: ['VIP', 'pipeline:cirurgia'] });
    mocks.prisma.lead.update.mockResolvedValue({});
    const app = await makeApp();

    const res = await request(app).delete('/api/tags/leads/l1/tags/pipeline%3Acirurgia').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ tags: ['VIP'], removed: true });
  });

  it('PUT /leads/:leadId/tags substitui as tags filtrando não-strings', async () => {
    mocks.prisma.lead.findUnique.mockResolvedValue({ tags: ['VIP'] });
    mocks.prisma.lead.update.mockResolvedValue({});
    const app = await makeApp();

    const res = await request(app)
      .put('/api/tags/leads/l1/tags')
      .set(AUTH)
      .send({ tags: ['NOVO', 42, 'AGENDAR', null] });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ tags: ['NOVO', 'AGENDAR'] });
  });

  it('PUT /leads/:leadId/tags retorna 404 para lead inexistente', async () => {
    mocks.prisma.lead.findUnique.mockResolvedValue(null);
    const app = await makeApp();

    const res = await request(app).put('/api/tags/leads/ghost/tags').set(AUTH).send({ tags: [] });

    expect(res.status).toBe(404);
  });
});
