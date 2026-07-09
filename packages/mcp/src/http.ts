#!/usr/bin/env node
// Entrypoint HTTP (remoto) do servidor MCP do CRM da Clínica QARA — LEVA 4B.
//
// Mesmas 15 tools do modo stdio (src/index.ts), expostas via o transporte
// "Streamable HTTP" do MCP SDK (`StreamableHTTPServerTransport`, em
// '@modelcontextprotocol/sdk/server/streamableHttp.js'). Essa classe já é a
// "Node.js HTTP Streamable HTTP Server Transport" oficial do SDK — ela
// recebe diretamente um `http.IncomingMessage`/`http.ServerResponse` (via
// `transport.handleRequest(req, res, parsedBody?)`), sem exigir Express nem
// nenhum framework HTTP: por baixo dos panos ela usa `@hono/node-server`
// (dependência do próprio SDK) para converter para Web Standard Request e
// falar com `WebStandardStreamableHTTPServerTransport`. Por isso este arquivo
// usa apenas `node:http` puro — nenhuma dependência nova no package.json.
//
// Endpoint: POST/GET/DELETE /mcp (protocolo MCP Streamable HTTP, com sessão
// via header `mcp-session-id`, igual ao exemplo oficial do SDK
// `examples/server/simpleStreamableHttp.ts`: uma sessão nova é criada quando
// chega uma request de inicialização sem `mcp-session-id`; o SDK gera o id
// (via `sessionIdGenerator`) e o devolve no header da resposta; chamadas
// seguintes da mesma sessão devem reenviar esse header).
//
// Autenticação: header `Authorization: Bearer <MCP_HTTP_TOKEN>` obrigatório
// em /mcp — sem token configurado no ambiente, o processo recusa iniciar
// (ver requireHttpToken). `/health` responde 200 sem autenticação, para o
// healthcheck do Render.
//
// Uso local:
//   MCP_HTTP_TOKEN=um-token-forte MCP_API_URL=http://localhost:4000 \
//     MCP_EMAIL=mcp@qara.local MCP_PASSWORD=senha pnpm --filter @qara/mcp dev:http
//
// Deploy (Render, Web Service):
//   build:  pnpm --filter @qara/mcp build
//   start:  pnpm --filter @qara/mcp start:http
//   env:    MCP_API_URL, MCP_EMAIL, MCP_PASSWORD, MCP_HTTP_TOKEN (e opcionalmente MCP_HTTP_PORT)

import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { ApiClient } from './api-client.js';
import { buildServer } from './server.js';

export const DEFAULT_HTTP_PORT = 8808;

/**
 * Lê o token esperado (MCP_HTTP_TOKEN) do ambiente. Lança um erro claro se
 * ausente — o servidor HTTP NÃO deve subir sem um token configurado, já que
 * (ao contrário do stdio) fica exposto na rede.
 */
export function requireHttpToken(env: NodeJS.ProcessEnv = process.env): string {
  const token = env.MCP_HTTP_TOKEN;
  if (!token || !token.trim()) {
    throw new Error(
      'MCP_HTTP_TOKEN é obrigatório para rodar o servidor MCP em modo HTTP (remoto). ' +
        "Defina um token forte (ex.: `node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"`) " +
        'na variável de ambiente MCP_HTTP_TOKEN antes de iniciar.',
    );
  }
  return token;
}

/** Lê a porta HTTP (MCP_HTTP_PORT), com default DEFAULT_HTTP_PORT. */
export function readHttpPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MCP_HTTP_PORT;
  if (!raw) return DEFAULT_HTTP_PORT;
  const port = Number(raw);
  return Number.isFinite(port) && port > 0 ? port : DEFAULT_HTTP_PORT;
}

/** Compara em tempo constante (evita timing attack) o token recebido com o esperado. */
function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Tamanhos diferentes não podem ir para timingSafeEqual — isso vaza só o
  // comprimento do token recebido, não seu conteúdo, o que é aceitável.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** true se o header `Authorization: Bearer <token>` bate com o token esperado. */
export function isAuthorized(authorizationHeader: string | string[] | undefined, expectedToken: string): boolean {
  const header = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
  if (!header) return false;
  const match = /^Bearer\s+(.+)$/.exec(header);
  if (!match) return false;
  return timingSafeEqualString(match[1], expectedToken);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Lê e concatena o corpo bruto da request. Devolve string vazia se não houver corpo. */
async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Lê e faz JSON.parse do corpo. Devolve `undefined` para corpo vazio; lança em JSON inválido. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = await readRawBody(req);
  if (!raw) return undefined;
  return JSON.parse(raw);
}

export type CreateHttpServerOptions = {
  /** Token esperado no header Authorization (Bearer). Obtenha via requireHttpToken(). */
  token: string;
  /**
   * Fábrica do McpServer por sessão (uma sessão MCP = uma conexão lógica, identificada
   * pelo header mcp-session-id). Default: buildServer() com um ApiClient compartilhado
   * entre todas as sessões (evita login repetido). Injetável em testes.
   */
  buildSessionServer?: () => ReturnType<typeof buildServer>;
};

/**
 * Monta um `http.Server` (sem chamar `.listen`) com:
 *   GET  /health — 200 sem autenticação (healthcheck)
 *   POST/GET/DELETE /mcp — protocolo MCP Streamable HTTP, exige Bearer token
 *
 * Separado de startHttpServer() para permitir testes de unidade: o teste sobe
 * este servidor numa porta efêmera local (`.listen(0)`) — sem subir a API real
 * nem depender de rede externa.
 */
export function createHttpServer(options: CreateHttpServerOptions): Server {
  const { token, buildSessionServer } = options;
  // ApiClient só é construído (e só then faz login, na primeira chamada) se
  // for realmente necessário — evita exigir MCP_EMAIL/MCP_PASSWORD quando um
  // buildSessionServer alternativo é injetado (ex.: nos testes de unidade).
  let sharedApi: ApiClient | undefined;
  const makeSessionServer =
    buildSessionServer ??
    (() => {
      sharedApi ??= new ApiClient();
      return buildServer(sharedApi);
    });

  // Sessões ativas do transporte Streamable HTTP, por session id (igual ao
  // padrão do exemplo oficial do SDK: um McpServer + transport por sessão).
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const handleMcpPost = async (req: IncomingMessage, res: ServerResponse) => {
    const sessionIdHeader = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

    let parsedBody: unknown;
    try {
      parsedBody = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: Invalid JSON' }, id: null });
      return;
    }

    let transport: StreamableHTTPServerTransport;
    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId)!;
    } else if (!sessionId && isInitializeRequest(parsedBody)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports.set(sid, transport);
        },
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) transports.delete(sid);
      };

      const mcpServer = makeSessionServer();
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, parsedBody);
      return;
    } else {
      sendJson(res, 400, {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, parsedBody);
  };

  const handleMcpSession = async (req: IncomingMessage, res: ServerResponse) => {
    const sessionIdHeader = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid or missing session ID');
      return;
    }
    await transport.handleRequest(req, res);
  };

  return createServer((req, res) => {
    void (async () => {
      try {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

        if (pathname === '/health' && req.method === 'GET') {
          sendJson(res, 200, { status: 'ok' });
          return;
        }

        if (pathname === '/mcp') {
          if (!isAuthorized(req.headers.authorization, token)) {
            sendJson(res, 401, { error: 'Unauthorized' });
            return;
          }
          if (req.method === 'POST') return handleMcpPost(req, res);
          if (req.method === 'GET' || req.method === 'DELETE') return handleMcpSession(req, res);
          res.writeHead(405, { Allow: 'GET, POST, DELETE' });
          res.end();
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      } catch (err) {
        console.error('[qara-mcp-http] erro ao tratar request:', err);
        if (!res.headersSent) {
          sendJson(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
        }
      }
    })();
  });
}

/** Sobe o servidor HTTP de verdade. Chamado apenas quando http.ts roda como entrypoint (não em testes). */
export function startHttpServer(): void {
  const token = requireHttpToken();
  const port = readHttpPort();
  const server = createHttpServer({ token });

  server.listen(port, () => {
    console.error(`[qara-mcp] HTTP pronto em :${port} (POST/GET/DELETE /mcp, healthcheck GET /health)`);
  });
}

// Só inicia o listener quando o arquivo é executado diretamente (node dist/http.js),
// nunca ao ser importado por testes.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  startHttpServer();
}
