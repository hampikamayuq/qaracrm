import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpServer, isAuthorized, readHttpPort, requireHttpToken } from './http';

describe('requireHttpToken', () => {
  it('lança erro claro quando MCP_HTTP_TOKEN não está definido', () => {
    expect(() => requireHttpToken({})).toThrow(/MCP_HTTP_TOKEN/);
  });

  it('lança erro quando MCP_HTTP_TOKEN é string vazia/só espaços', () => {
    expect(() => requireHttpToken({ MCP_HTTP_TOKEN: '   ' })).toThrow(/MCP_HTTP_TOKEN/);
  });

  it('devolve o token quando definido', () => {
    expect(requireHttpToken({ MCP_HTTP_TOKEN: 'tok-123' })).toBe('tok-123');
  });
});

describe('readHttpPort', () => {
  it('usa o default (8808) quando MCP_HTTP_PORT não está definido', () => {
    expect(readHttpPort({})).toBe(8808);
  });

  it('usa o valor de MCP_HTTP_PORT quando definido e válido', () => {
    expect(readHttpPort({ MCP_HTTP_PORT: '9999' })).toBe(9999);
  });

  it('cai no default quando MCP_HTTP_PORT é inválido', () => {
    expect(readHttpPort({ MCP_HTTP_PORT: 'abc' })).toBe(8808);
    expect(readHttpPort({ MCP_HTTP_PORT: '-1' })).toBe(8808);
  });
});

describe('isAuthorized', () => {
  const expected = 'super-secret-token';

  it('true quando o header bate exatamente com Bearer <token>', () => {
    expect(isAuthorized(`Bearer ${expected}`, expected)).toBe(true);
  });

  it('false quando o header está ausente', () => {
    expect(isAuthorized(undefined, expected)).toBe(false);
  });

  it('false quando o token está errado', () => {
    expect(isAuthorized('Bearer token-errado', expected)).toBe(false);
  });

  it('false quando falta o prefixo Bearer', () => {
    expect(isAuthorized(expected, expected)).toBe(false);
  });

  it('false quando o token tem tamanho diferente do esperado', () => {
    expect(isAuthorized('Bearer curto', expected)).toBe(false);
  });
});

describe('createHttpServer (integração local, sem rede externa)', () => {
  const TOKEN = 'test-token-abc';

  // Servidor MCP fake — evita depender de ApiClient/API real só para exercitar
  // o gate de autenticação e o healthcheck.
  const buildSessionServer = () => new McpServer({ name: 'fake', version: '0.0.0' });

  async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
    const server = createHttpServer({ token: TOKEN, buildSessionServer });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    try {
      return await fn(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it('GET /health responde 200 sem autenticação', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: 'ok' });
    });
  });

  it('POST /mcp sem Authorization retorna 401', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
      });
      expect(res.status).toBe(401);
    });
  });

  it('POST /mcp com token errado retorna 401', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-invalido' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
      });
      expect(res.status).toBe(401);
    });
  });

  it('GET /mcp sem session id (mas com token correto) retorna 400, não 401', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      // Passou pelo gate de autenticação; falha depois por falta de sessão válida.
      expect(res.status).toBe(400);
    });
  });

  it('rota desconhecida retorna 404', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/rota-que-nao-existe`);
      expect(res.status).toBe(404);
    });
  });
});
