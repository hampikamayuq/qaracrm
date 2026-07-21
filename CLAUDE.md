# QARA CRM — instruções para agentes

Monorepo standalone: `apps/api` (Express 5 + Prisma + Postgres),
`apps/web` (Next.js App Router), `packages/shared`. O projeto **migrou do
Twenty em 05/07/2026** — não use `twenty-sdk`, `yarn twenty`, docs do
Twenty nem os padrões de objects/views/logic-functions do Twenty.
Gerenciador de pacotes: **pnpm**.

Leia `PRODUCT.md` antes de mudanças de produto/UI. Princípios: operação
primeiro, densidade com clareza, português operacional em toda a UI,
IA sob controle humano, **nada fake** (botão sem endpoint fica fora ou
visivelmente desabilitado).

## Comandos

```bash
pnpm --filter @qara/api test                # unitários — TODOS devem passar antes de commitar
pnpm --filter @qara/api test:integration    # precisa de Postgres local (banco *-test)
cd apps/api && npx tsc -p tsconfig.build.json --noEmit   # typecheck
pnpm --filter @qara/api lint                # oxlint
pnpm --filter @qara/web build               # build da web — deve passar antes de commitar
pnpm --filter @qara/api dev                 # API :4000
pnpm --filter @qara/web dev                 # web :3000
```

Postgres de dev/teste via Docker (imagem `postgres:16`, auth trust) — ver
README. Migrations: escreva o SQL à mão em `prisma/migrations/<ts>_<nome>/`
no padrão das existentes + `prisma generate`; use `db:migrate:deploy`
(nunca `migrate dev` em produção).

## Convenções que quebram se ignoradas

- **Estágio e especialidade do lead vivem como TAGS prefixadas**
  (`status:<estagio>`, `pipeline:<especialidade>`) — não como colunas.
  Helpers canônicos exportados de `apps/api/src/routes/pipeline-routes.ts`
  (`tagsOf`, `stageFromTags`, `valueByPrefix`). Motivo de perda =
  `status:perdido-<motivo>`.
- **Modos da Tawany** (`SHADOW_MODE` env): `shadow` observa e NUNCA envia
  nem consome a mensagem; `human_approval` cria `aiSuggestion` PENDING e
  espera aprovação; `autopilot` envia. Tudo passa por `runTawanyHandler`
  (gates de opt-out/injection/conversa fechada) — não chame `runTawany`
  direto.
- **Knowledge da Tawany vem do banco** (`KnowledgeSection`, cache 60s em
  `lib/tawany/knowledge.ts`, fallback para `lib/prompts.ts` se vazio).
  Dados operacionais novos vão no banco/seed, não hardcoded no prompt.
- **Risk blocking dos bots é imutável** — termos de risco vivem no engine
  (`lib/bots/engine.ts`) e são aplicados antes de qualquer matching;
  nunca torná-los editáveis pela UI/API.
- **Histórico/versionamento reusa o modelo `Activity`** (stage_change,
  versões de bot, notas) — não crie tabela nova para histórico.
- **IA/automação são exclusivas do canal oficial (`channel === 'WHATSAPP'`)**:
  Tawany, bots, templates HSM e jobs do scheduler nunca tocam conversas
  `WHATSAPP_QR` (números extras via gateway Evolution, atendimento humano
  apenas) nem `INSTAGRAM` (templates). Ver `docs/whatsapp-qr-numeros.md`.
  Exceção: no canal `KOMMO` (leads/mensagens que entram pelo Kommo) a Tawany
  atende em modo suggestion-first (`gateSendModeForChannel`; auto-envio só
  com `KOMMO_AUTOPILOT=true`), mas HSM/D-1/NPS/follow-up continuam só no
  oficial. Resposta sai via salesbot do Kommo — ver `docs/kommo-integration.md`.
- **Web sem Tailwind**: design system próprio em
  `apps/web/src/app/globals.css` (tokens em `:root`, cor semântica:
  Tawany = violeta `--ai`, urgência = vermelho, follow-up/teste = âmbar).
  Não introduza classes Tailwind.
- Respostas de API no envelope `{ success, data }` / `{ success, error }`;
  toda rota de escrita com `authMiddleware` + validação; rotas públicas
  só com verificação (assinatura Meta / `LEAD_WEBHOOK_SECRET`).
- UUIDs gerados devem ser UUID v4 válidos.

## Fluxo de trabalho

- Suíte completa + typecheck + build da web verdes antes de qualquer
  commit. Commits convencionais (`feat:`, `fix:`, ...) em português.
- Push direto na `main` é bloqueado — trabalhe em branch e abra PR.
- **Deploy**: Render (API) e Vercel (web) seguem a `main`. NUNCA deploye
  sem aprovação explícita do usuário. Merge com migration nova exige
  `db:migrate:deploy` (+ `db:seed:knowledge` se aplicável) no banco de
  produção — está documentado no README.
- Produção: API `https://cliniqara-crm.onrender.com`, web
  `https://web-indol-ten-37.vercel.app`. Webhook Meta:
  `/api/webhooks/meta`.

## Documentos vivos

- `docs/plano-otimizacoes.md` — roadmap em lotes (o que fazer a seguir)
- `docs/superpowers/2026-07-05-qara-render-ops.md` — ops/ativação
- `docs/lgpd.md` — export/anonimização
