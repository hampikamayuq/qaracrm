#!/usr/bin/env node
// Servidor MCP (stdio) do CRM da Clínica QARA — Fase 3.
//
// A construção do servidor (registro das 15 tools) mora em src/server.ts
// (buildServer()), reaproveitada também pelo entrypoint HTTP remoto
// (src/http.ts, LEVA 4B). Este arquivo só conecta o transporte stdio —
// nenhuma mudança de comportamento em relação à versão anterior.
//
// Uso no cliente MCP (.mcp.json / claude_desktop_config.json):
//   { "command": "node", "args": ["/CAMINHO/packages/mcp/dist/index.js"],
//     "env": { "MCP_API_URL": "http://localhost:4000", "MCP_EMAIL": "...", "MCP_PASSWORD": "..." } }

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './server.js';

const server = buildServer();

await server.connect(new StdioServerTransport());
console.error('[qara-mcp] stdio pronto');
