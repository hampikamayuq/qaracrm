# @qara/mcp

Servidor MCP que expõe o CRM da Clínica QARA como copiloto para o Claude
(Desktop ou Code), em dois modos de transporte:

- **stdio** (`src/index.ts`) — modo local original: o cliente MCP sobe o
  processo na própria máquina.
- **HTTP remoto** (`src/http.ts`, LEVA 4B) — mesmo servidor, exposto como
  serviço HTTP (ex.: um worker no Render), para conectar o Claude de qualquer
  lugar. Ver [Modo remoto (HTTP)](#modo-remoto-http) abaixo.

Os dois modos reaproveitam a mesma construção do servidor (`buildServer()` em
`src/server.ts`, que registra as 15 tools) — nenhuma diferença de
comportamento das tools entre um modo e outro.

Ao contrário do protótipo original (`crm-clinica-qara-main/mcp-server.js`),
este servidor **não acessa o Prisma diretamente** — todas as tools chamam a
API Express (`apps/api`) via HTTP, porque as rotas encapsulam regras de
negócio e gravação de Activity/AuditLog, e a autenticação exige uma `Session`
viva no banco.

## Build

```bash
pnpm install               # na raiz do monorepo, uma vez
pnpm --filter @qara/mcp build
```

Gera `packages/mcp/dist/index.js` (entrypoint stdio) e `packages/mcp/dist/http.js`
(entrypoint HTTP remoto, ver [Modo remoto (HTTP)](#modo-remoto-http)).

## Usuário de serviço

O MCP autentica como um usuário comum da API (login + token, igual ao
front-end). Crie/atualize o usuário de serviço a partir de `apps/api`:

```bash
cd apps/api
MCP_USER_EMAIL=mcp@qara.local MCP_USER_PASSWORD='senha-forte-aqui' pnpm mcp:user
```

Por padrão o script cria o usuário com `role: "agente_ia"` (o menos
privilegiado o suficiente para as rotas usadas pelas tools — nenhuma delas
exige `admin`). Veja `apps/api/src/scripts/create-mcp-user.ts` para as opções.

## Variáveis de ambiente

| Variável | Obrigatória | Default | Descrição |
| --- | --- | --- | --- |
| `MCP_API_URL` | não | `http://localhost:4000` | Base URL da API (`apps/api`) |
| `MCP_EMAIL` | sim | — | Email do usuário de serviço |
| `MCP_PASSWORD` | sim | — | Senha do usuário de serviço |
| `MCP_HTTP_TOKEN` | sim, **só no modo HTTP** | — | Token Bearer exigido em `/mcp` no modo remoto (ver abaixo) |
| `MCP_HTTP_PORT` | não | `8808` | Porta do servidor HTTP (só no modo remoto) |

## Configuração no cliente MCP

Exemplo de `.mcp.json` (Claude Code) ou `claude_desktop_config.json`
(Claude Desktop):

```json
{
  "mcpServers": {
    "qara-crm": {
      "command": "node",
      "args": ["/CAMINHO/ABSOLUTO/packages/mcp/dist/index.js"],
      "env": {
        "MCP_API_URL": "http://localhost:4000",
        "MCP_EMAIL": "mcp@qara.local",
        "MCP_PASSWORD": "senha-forte-aqui"
      }
    }
  }
}
```

A API (`apps/api`) precisa estar rodando e acessível em `MCP_API_URL`.

## Modo remoto (HTTP)

Além do stdio local, o servidor pode rodar como um serviço HTTP usando o
transporte "Streamable HTTP" do próprio SDK do MCP
(`StreamableHTTPServerTransport`, de `@modelcontextprotocol/sdk/server/streamableHttp.js`).
Essa classe já é feita para receber `http.IncomingMessage`/`http.ServerResponse`
puros do Node — por isso o entrypoint (`src/http.ts`) não depende de Express
nem de nenhum framework HTTP novo, só de `node:http`.

Endpoints:

- `POST /mcp`, `GET /mcp`, `DELETE /mcp` — protocolo MCP Streamable HTTP.
  Sessões são identificadas pelo header `mcp-session-id` (o servidor gera o
  id na resposta da inicialização; o cliente deve reenviá-lo nas chamadas
  seguintes da mesma sessão). Exigem `Authorization: Bearer <MCP_HTTP_TOKEN>`.
- `GET /health` — sempre `200 { "status": "ok" }`, **sem autenticação**
  (para o healthcheck do Render).

Se `MCP_HTTP_TOKEN` não estiver definido no ambiente, o processo **recusa
iniciar** com um erro claro (em vez de subir um servidor sem autenticação).

### Rodando localmente

```bash
pnpm --filter @qara/mcp build
MCP_HTTP_TOKEN=um-token-bem-forte \
MCP_API_URL=http://localhost:4000 \
MCP_EMAIL=mcp@qara.local \
MCP_PASSWORD=senha-forte-aqui \
pnpm --filter @qara/mcp start:http
# ou, sem build, direto do TS:
# MCP_HTTP_TOKEN=... MCP_API_URL=... MCP_EMAIL=... MCP_PASSWORD=... pnpm --filter @qara/mcp dev:http
```

Por padrão sobe em `:8808`; troque com `MCP_HTTP_PORT`.

### Configuração no Claude (cliente remoto)

Aponte o cliente MCP para a URL pública do serviço, enviando o Bearer token
no header `Authorization`. Exemplo (`.mcp.json` do Claude Code) usando um
servidor MCP do tipo `http`:

```json
{
  "mcpServers": {
    "qara-crm-remoto": {
      "type": "http",
      "url": "https://SEU-SERVICO.onrender.com/mcp",
      "headers": {
        "Authorization": "Bearer SEU_MCP_HTTP_TOKEN_AQUI"
      }
    }
  }
}
```

(Ajuste a chave conforme o cliente MCP usado — o essencial é enviar a URL
terminando em `/mcp` e o header `Authorization: Bearer <token>`.)

### Deploy no Render (Web Service)

1. Crie um **Web Service** apontando para este monorepo.
2. **Build Command**: `pnpm --filter @qara/mcp build`
3. **Start Command**: `pnpm --filter @qara/mcp start:http`
4. **Environment Variables**:
   - `MCP_API_URL` — URL pública/interna da API (`apps/api`) já em produção.
   - `MCP_EMAIL` / `MCP_PASSWORD` — credenciais do usuário de serviço (ver
     [Usuário de serviço](#usuário-de-serviço) acima).
   - `MCP_HTTP_TOKEN` — token forte só para este serviço (ex.: gerado com
     `openssl rand -hex 32`).
   - `MCP_HTTP_PORT` — opcional; se não setar, o Render normalmente injeta
     `PORT` próprio — nesse caso, defina `MCP_HTTP_PORT` igual ao `PORT` do
     Render (ou ajuste conforme a convenção do seu plano).
5. **Health Check Path**: `/health`.

### Aviso de segurança

- Use um `MCP_HTTP_TOKEN` **forte e único** por ambiente (não reuse o mesmo
  token entre dev/staging/produção) — ele é a única barreira de autenticação
  do endpoint `/mcp` neste modo (não há OAuth nem mTLS aqui).
- **Só exponha via HTTPS.** O Render já termina TLS na borda para Web
  Services; nunca aponte um cliente para uma URL `http://` pública — o token
  Bearer trafegaria em texto claro.
- Trate esse token como uma credencial de produção: guarde em um secret
  manager/variável de ambiente do Render, nunca em código ou committed no
  repo.
- Todas as regras de segurança das tools (nenhum envio direto de mensagem,
  nenhuma exclusão, nenhuma rota financeira) valem igualmente no modo HTTP —
  são as mesmas tools, só muda o transporte.

## Tools expostas

Leitura:

- `list_leads` — GET `/api/pipeline/leads` (filtros `pipeline` no servidor;
  `stage`/`search`/`limit` aplicados no próprio MCP, pois a rota atual não
  os recebe).
- `lead_timeline` — GET `/api/pipeline/leads/:id/timeline`.
- `list_conversations` — GET `/api/inbox/list`.
- `conversation_messages` — GET `/api/inbox/:id` (detalhe da conversa,
  inclui mensagens).
- `list_tasks` — GET `/api/tasks` (filtros extras aplicados no MCP).
- `review_queue` — GET `/api/tawany/review-queue`.
- `get_reports` — GET `/api/reports/comercial|atendimento|tawany`.
- `list_quick_replies` — GET `/api/quick-replies` (respostas rápidas
  cadastradas; `search` filtra por atalho/título/conteúdo, `active`
  default `true`).
- `list_patients` — GET `/api/patients` (pacientes cadastrados; `search`
  filtra por nome/telefone, com paginação `page`/`pageSize`).
- `patient_timeline` — GET `/api/patients/:id` (detalhe do paciente com
  dados cadastrais, lead de origem, consultas, orçamentos e a timeline
  unificada).

Escritas seguras:

- `create_task` — POST `/api/tasks` (sempre atribuída ao usuário de
  serviço autenticado — a API ignora `assignedToId` do body).
- `draft_reply` — cria uma Task "Rascunho de resposta" (POST `/api/tasks`)
  vinculada à conversa, com o texto do rascunho na descrição. **Não envia
  nada ao paciente** — só deixa o rascunho registrado para revisão humana
  no inbox (mesmo espírito do `draft_reply` do protótipo original, mas
  aqui vira tarefa em vez de só texto devolvido pela tool).
- `add_note` — POST `/api/pipeline/leads/:id/notes`.
- `move_lead_stage` — PATCH `/api/pipeline/leads/:id/move`.
- `approve_suggestion` — POST `/api/tawany/approve` (única tool que pode
  fazer uma mensagem chegar ao paciente, e só mediante aprovação humana
  explícita da chamada).
- `reject_suggestion` — POST `/api/tawany/reject` (+ feedback opcional).

## Nota de segurança

Nenhuma tool deste servidor:

- envia mensagem a paciente diretamente (não expomos
  `POST /api/inbox/:id/reply`; a única forma de uma mensagem sair é via
  `approve_suggestion`, que exige uma sugestão pendente da Tawany e uma
  chamada explícita);
- deleta registros;
- toca rotas de pagamento/financeiro.

## Testes

```bash
pnpm --filter @qara/mcp test
```

Cobre `api-client.ts` (login antes da primeira chamada, reenvio do header
`Authorization`, retry único de login em 401 e propagação de erro legível
quando a API responde `success: false`) e `http.ts` (recusa de boot sem
`MCP_HTTP_TOKEN`, checagem do header `Authorization: Bearer`, `GET /health`
sem autenticação, `401` em `/mcp` sem/com token errado, subindo o servidor
numa porta efêmera local — sem rede externa nem API real).
