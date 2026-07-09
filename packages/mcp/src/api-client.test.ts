import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, buildQuery } from './api-client';

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response;

describe('buildQuery', () => {
  it('ignora valores undefined/null/vazios e monta querystring', () => {
    expect(buildQuery({ a: 'x', b: undefined, c: null, d: '', e: 1, f: false })).toBe('?a=x&e=1&f=false');
  });

  it('retorna string vazia quando não há parâmetros', () => {
    expect(buildQuery({ a: undefined })).toBe('');
  });
});

describe('ApiClient', () => {
  it('faz login antes da primeira chamada e envia o Bearer token', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/auth/login')) {
        expect(init?.method).toBe('POST');
        return jsonResponse(200, { success: true, data: { token: 'tok-1', user: { id: 'u1' } } });
      }
      if (url.endsWith('/api/tasks')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer tok-1' });
        return jsonResponse(200, { success: true, data: [{ id: 't1' }] });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const client = new ApiClient({
      baseUrl: 'http://api.local',
      email: 'mcp@qara.local',
      password: 'secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const data = await client.get<Array<{ id: string }>>('/api/tasks');
    expect(data).toEqual([{ id: 't1' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('refaz login uma vez quando recebe 401 e repete a chamada original', async () => {
    let loginCalls = 0;
    let taskCalls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/api/auth/login')) {
        loginCalls += 1;
        return jsonResponse(200, { success: true, data: { token: `tok-${loginCalls}`, user: { id: 'u1' } } });
      }
      if (url.endsWith('/api/tasks')) {
        taskCalls += 1;
        // Primeira chamada com o token antigo falha com 401; segunda (após novo login) funciona.
        if (taskCalls === 1) return jsonResponse(401, { success: false, error: 'Session revoked or expired' });
        return jsonResponse(200, { success: true, data: [{ id: 't2' }] });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const client = new ApiClient({
      baseUrl: 'http://api.local',
      email: 'mcp@qara.local',
      password: 'secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const data = await client.get<Array<{ id: string }>>('/api/tasks');
    expect(data).toEqual([{ id: 't2' }]);
    expect(loginCalls).toBe(2); // login inicial + retry após 401
    expect(taskCalls).toBe(2);
  });

  it('não tenta novo login mais de uma vez por chamada (evita loop infinito)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/api/auth/login')) {
        return jsonResponse(200, { success: true, data: { token: 'tok-x', user: { id: 'u1' } } });
      }
      return jsonResponse(401, { success: false, error: 'Session revoked or expired' });
    });

    const client = new ApiClient({
      baseUrl: 'http://api.local',
      email: 'mcp@qara.local',
      password: 'secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.get('/api/tasks')).rejects.toThrow(ApiError);
    // 1 login inicial + 1a tentativa (401) + 1 novo login + 2a tentativa (401) = 4
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('lança ApiError com a mensagem do envelope quando success=false', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/api/auth/login')) {
        return jsonResponse(200, { success: true, data: { token: 'tok-1', user: { id: 'u1' } } });
      }
      return jsonResponse(400, { success: false, error: 'title required' });
    });

    const client = new ApiClient({
      baseUrl: 'http://api.local',
      email: 'mcp@qara.local',
      password: 'secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.post('/api/tasks', {})).rejects.toThrow(/title required/);
  });

  it('lança erro claro quando MCP_EMAIL/MCP_PASSWORD não estão definidos', () => {
    const prevEmail = process.env.MCP_EMAIL;
    const prevPassword = process.env.MCP_PASSWORD;
    delete process.env.MCP_EMAIL;
    delete process.env.MCP_PASSWORD;
    try {
      expect(() => new ApiClient({ fetchImpl: vi.fn() as unknown as typeof fetch })).toThrow(
        /MCP_EMAIL e MCP_PASSWORD/,
      );
    } finally {
      if (prevEmail !== undefined) process.env.MCP_EMAIL = prevEmail;
      if (prevPassword !== undefined) process.env.MCP_PASSWORD = prevPassword;
    }
  });
});
