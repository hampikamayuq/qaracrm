# @qara/mcp

Servidor MCP (stdio) que expõe o CRM da Clínica QARA como copiloto para o
Claude (Desktop ou Code). Ao contrário do protótipo original
(`crm-clinica-qara-main/mcp-server.js`), este servidor **não acessa o Prisma
diretamente** — todas as tools chamam a API Express (`apps/api`) via HTTP,
porque as rotas encapsulam regras de negócio e gravação de
Activity/AuditLog, e a autenticação exige uma `Session` viva no banco.

## Build

```bash
pnpm install               # na raiz do monorepo, uma vez
pnpm --filter @qara/mcp build
```

Gera `packages/mcp/dist/index.js`.

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

Cobre `api-client.ts`: login antes da primeira chamada, reenvio do header
`Authorization`, retry único de login em 401 e propagação de erro legível
quando a API responde `success: false`.
