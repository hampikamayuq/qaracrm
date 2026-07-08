# QARA CRM

CRM próprio da Clínica QARA (dermatologia, RJ/SP) com a **Tawany** — agente
de IA que atende pacientes pelo WhatsApp: triagem, qualificação,
direcionamento e agendamento, sempre sob controle humano.

Monorepo standalone (o projeto migrou do Twenty em 05/07/2026 — nada aqui
depende do runtime Twenty).

## Arquitetura

| App | Stack | Produção |
| --- | --- | --- |
| `apps/api` | Express 5 + Prisma + Postgres, agente via OpenRouter | Render — `https://cliniqara-crm.onrender.com` |
| `apps/web` | Next.js (App Router) + design system próprio em CSS (sem Tailwind) | Vercel — `https://web-indol-ten-37.vercel.app` |
| `packages/shared` | Tipos compartilhados | — |

### Mapa do backend (`apps/api/src`)

| Área | Caminho | O que faz |
| --- | --- | --- |
| Fluxo da Tawany | `logic-functions/tawany-handler.ts` | Gates (opt-out, injection, conversa fechada) → loop de tools → guards → envio conforme o modo |
| Modos de operação | `lib/shadow.ts` (`SHADOW_MODE`) | `shadow` (observa, nunca envia) · `human_approval` (sugere → aprovação) · `autopilot` (envia) |
| Prompt e contexto | `lib/tawany/` + `lib/prompts.ts` | Persona + knowledge do banco (`KnowledgeSection`, cache 60s, fallback hardcoded) + exemplos few-shot |
| Guards | `lib/guards/` | Prompt-injection na entrada; preço fora da tabela, conteúdo clínico, promessa de horário/resultado na saída |
| Tools do agente | `lib/tools/` | sendWhatsApp, listProfessionals/Services, readLead, checkBotFaq, handoffToHuman etc. |
| Bots (fluxos fixos) | `lib/bots/` + `routes/bot-routes.ts` | Respostas automáticas por palavra-chave, editáveis pela UI, com risk blocking imutável |
| Rotas HTTP | `routes/` | auth, inbox, pipeline, dashboard, reports, appointments, tasks, tags, bots, settings, lgpd, webhooks |
| Scheduler | `src/server.ts` + `lib/scheduler.ts` | Follow-up (`FOLLOWUP_INTERVAL_MS`) e lembrete D-1 (`ENABLE_SCHEDULER`) |

### Telas (`apps/web/src/app`)

Dashboard (`/`) · Inbox (3 colunas, estados Tawany/humano, feedback 👍/👎,
modo teste) · Pipeline (kanban canônico com histórico e motivo de perda) ·
Agenda (mês/semana/dia + .ics) · Tarefas & Atividades · Relatórios (export
CSV) · Bots (editor com versionamento) · Conhecimento (`/settings/knowledge`)
· IA (`/settings/ai`).

## Desenvolvimento

Requisitos: Node 24 (`.nvmrc`), pnpm, Docker (para o Postgres).

```bash
pnpm install

# Banco local (dev usa apps/api/.env → postgresql://postgres@localhost:5432/qara-crm)
docker run -d --name qara-pg -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_DB=qara-crm -p 5432:5432 postgres:16
pnpm --filter @qara/api db:migrate:deploy
pnpm --filter @qara/api db:seed             # admin@qara.local / ADMIN_PASSWORD (default admin123)
pnpm --filter @qara/api db:seed:knowledge   # 6 seções de knowledge da Tawany

pnpm --filter @qara/api dev                 # API em :4000
pnpm --filter @qara/web dev                 # web em :3000
```

Variáveis: copie `apps/api/.env.example` e `apps/web/.env.example`. Sem
`OPENROUTER_API_KEY` a Tawany faz handoff em vez de quebrar.

## Testes

```bash
pnpm --filter @qara/api test               # unitários (vitest)
pnpm --filter @qara/api test:integration   # ponta a ponta com Postgres real
                                           # (banco qara-crm-test — ver flow.integration.test.ts)
pnpm --filter @qara/api lint               # oxlint
pnpm --filter @qara/web build              # build de produção da web
```

CI (`.github/workflows/ci.yml`): lint + typecheck + testes da API + build
da web em todo push/PR.

## Deploy

Render (API) e Vercel (web) deployam a `main` via integração git.
**Após merges com migration**, rodar no shell do Render:

```bash
pnpm --filter @qara/api db:migrate:deploy
pnpm --filter @qara/api db:seed:knowledge   # idempotente
```

Webhook da Meta: `https://cliniqara-crm.onrender.com/api/webhooks/meta`
(verify token = `META_VERIFY_TOKEN`). Checklist completo de ativação em
[docs/superpowers/2026-07-05-qara-render-ops.md](docs/superpowers/2026-07-05-qara-render-ops.md).

## Documentos

- [PRODUCT.md](PRODUCT.md) — princípios de produto (operação primeiro, nada fake, IA sob controle humano)
- [docs/plano-otimizacoes.md](docs/plano-otimizacoes.md) — roadmap de otimizações em lotes
- [docs/lgpd.md](docs/lgpd.md) — export/anonimização de dados do paciente
