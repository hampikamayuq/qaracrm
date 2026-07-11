import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// supertest com router real + auth-middleware real (verifyToken mockado) —
// cobre wiring, validação e o 401 sem Authorization (padrão settings-routes).
const mocks = vi.hoisted(() => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    session: {
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('../lib/deps', () => ({ prisma: mocks.prisma }));
vi.mock('../lib/auth', () => ({
  verifyToken: vi.fn((token: string) => {
    if (token === 'good-token') return { userId: 'admin-1', role: 'admin' };
    if (token === 'reception-token') return { userId: 'u2', role: 'recepcao' };
    return null;
  }),
  hashPassword: vi.fn(async (password: string) => `hashed:${password}`),
  verifyPassword: vi.fn(),
  createToken: vi.fn(() => 'jwt-token'),
}));

const AUTH = { Authorization: 'Bearer good-token' };
const RECEPTION_AUTH = { Authorization: 'Bearer reception-token' };

const VALID_INPUT = { name: 'Ana', email: 'ana@qara.com', password: 'senha-forte', role: 'recepcao' };

const makeApp = async () => {
  const { default: router } = await import('./users-routes');
  const app = express();
  app.use(express.json());
  app.use('/api/users', router);
  return app;
};

describe('Users routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.session.findUnique.mockResolvedValue({
      token: 'good-token',
      expiresAt: new Date(Date.now() + 3600_000),
    });
  });

  it('retorna 401 sem Authorization em todos os endpoints', async () => {
    const app = await makeApp();
    expect((await request(app).get('/api/users')).status).toBe(401);
    expect((await request(app).post('/api/users').send(VALID_INPUT)).status).toBe(401);
    expect((await request(app).patch('/api/users/u9').send({ active: false })).status).toBe(401);
    expect(mocks.prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('retorna 403 para usuário não-admin', async () => {
    const app = await makeApp();
    expect((await request(app).get('/api/users').set(RECEPTION_AUTH)).status).toBe(403);
    expect((await request(app).post('/api/users').set(RECEPTION_AUTH).send(VALID_INPUT)).status).toBe(403);
    expect((await request(app).patch('/api/users/u9').set(RECEPTION_AUTH).send({ active: false })).status).toBe(403);
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
  });

  it('GET / lista usuários sem expor senha', async () => {
    const users = [
      { id: 'admin-1', name: 'Admin', email: 'admin@qara.com', role: 'admin', active: true, createdAt: new Date().toISOString() },
    ];
    mocks.prisma.user.findMany.mockResolvedValue(users);
    const app = await makeApp();

    const res = await request(app).get('/api/users').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(users);
    expect(mocks.prisma.user.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    });
  });

  it('POST / cria usuário com senha hasheada', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null);
    mocks.prisma.user.create.mockResolvedValue({
      id: 'u9', name: 'Ana', email: 'ana@qara.com', role: 'recepcao', active: true, createdAt: new Date().toISOString(),
    });
    const app = await makeApp();

    const res = await request(app).post('/api/users').set(AUTH).send(VALID_INPUT);

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe('ana@qara.com');
    expect(mocks.prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ password: 'hashed:senha-forte', role: 'recepcao' }),
    }));
  });

  it('POST / retorna 409 para email duplicado', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    const app = await makeApp();

    const res = await request(app).post('/api/users').set(AUTH).send(VALID_INPUT);

    expect(res.status).toBe(409);
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
  });

  it('POST / valida email, senha curta e role inválida (incl. agente_ia)', async () => {
    const app = await makeApp();

    expect((await request(app).post('/api/users').set(AUTH).send({ ...VALID_INPUT, email: 'sem-arroba' })).status).toBe(400);
    expect((await request(app).post('/api/users').set(AUTH).send({ ...VALID_INPUT, password: 'curta' })).status).toBe(400);
    expect((await request(app).post('/api/users').set(AUTH).send({ ...VALID_INPUT, role: 'superuser' })).status).toBe(400);
    expect((await request(app).post('/api/users').set(AUTH).send({ ...VALID_INPUT, role: 'agente_ia' })).status).toBe(400);
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
  });

  it('PATCH /:id bloqueia autodesativação do admin', async () => {
    const app = await makeApp();

    const res = await request(app).patch('/api/users/admin-1').set(AUTH).send({ active: false });

    expect(res.status).toBe(400);
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it('PATCH /:id valida role e senha curta', async () => {
    const app = await makeApp();

    expect((await request(app).patch('/api/users/u9').set(AUTH).send({ role: 'agente_ia' })).status).toBe(400);
    expect((await request(app).patch('/api/users/u9').set(AUTH).send({ password: 'curta' })).status).toBe(400);
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it('PATCH /:id retorna 404 para usuário inexistente', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null);
    const app = await makeApp();

    const res = await request(app).patch('/api/users/ghost').set(AUTH).send({ active: false });

    expect(res.status).toBe(404);
  });

  it('PATCH /:id ao desativar revoga as sessions do usuário', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 'u9' });
    mocks.prisma.user.update.mockResolvedValue({
      id: 'u9', name: 'Ana', email: 'ana@qara.com', role: 'recepcao', active: false, createdAt: new Date().toISOString(),
    });
    const app = await makeApp();

    const res = await request(app).patch('/api/users/u9').set(AUTH).send({ active: false });

    expect(res.status).toBe(200);
    expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u9' } });
  });

  it('PATCH /:id ao trocar senha hasheia e revoga as sessions', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 'u9' });
    mocks.prisma.user.update.mockResolvedValue({
      id: 'u9', name: 'Ana', email: 'ana@qara.com', role: 'recepcao', active: true, createdAt: new Date().toISOString(),
    });
    const app = await makeApp();

    const res = await request(app).patch('/api/users/u9').set(AUTH).send({ password: 'nova-senha-8' });

    expect(res.status).toBe(200);
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { password: 'hashed:nova-senha-8' },
    }));
    expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u9' } });
  });

  it('PATCH /:id sem desativar nem trocar senha não mexe nas sessions', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 'u9' });
    mocks.prisma.user.update.mockResolvedValue({
      id: 'u9', name: 'Ana', email: 'ana@qara.com', role: 'medico', active: true, createdAt: new Date().toISOString(),
    });
    const app = await makeApp();

    const res = await request(app).patch('/api/users/u9').set(AUTH).send({ role: 'medico' });

    expect(res.status).toBe(200);
    expect(mocks.prisma.session.deleteMany).not.toHaveBeenCalled();
  });

  it('login de usuário inativo falha com 401 genérico', async () => {
    // Usa o loginRoute real: user existe mas active=false → mesma mensagem de credencial inválida.
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: 'u9', email: 'ana@qara.com', password: 'hash', role: 'recepcao', active: false,
    });
    const { loginRoute } = await import('./auth-routes');
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    await loginRoute(
      { body: { email: 'ana@qara.com', password: 'senha-forte' } } as never,
      { status } as never,
    );

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ success: false, error: 'Invalid credentials' });
    expect(mocks.prisma.session.create).not.toHaveBeenCalled();
  });
});
