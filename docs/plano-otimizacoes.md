# QARA CRM + Tawany — Estado Atual e Roadmap de Otimização

> Fonte única de verdade do sistema. Estado verificado em produção em
> **07/07/2026** (Render API, banco, smoke test). Estrutura: Parte 1 =
> inventário do que existe; Parte 2 = ações imediatas; Parte 3 = roadmap
> de otimização em lotes; Parte 4 = definição mensurável de "perfeito".
> Esforço: P (≤meio dia), M (1–2 dias), G (3+ dias).

---

# PARTE 1 — Estado atual

## 1.1 Arquitetura

| Componente | Stack | Produção |
|---|---|---|
| `apps/api` | Express 5 + Prisma + Postgres (schema `app`) | Render — `https://cliniqara-crm.onrender.com` |
| `apps/web` | Next.js App Router, design system CSS próprio (sem Tailwind) | Vercel — `https://web-indol-ten-37.vercel.app` |
| `packages/shared` | Tipos compartilhados | — |

- **Qualidade**: 423 testes unitários + 10 de integração ponta a ponta
  (webhook assinado → Tawany → aprovação → dashboard), CI no GitHub Actions
  (lint + typecheck + testes + build) verde.
- **Banco**: 10 migrations versionadas e aplicadas em produção; 17 leads
  reais; backup script existe (`scripts/backup-db.sh`), sem agendamento.
- **Deploy**: Render segue a `main` (roda `migrate deploy` no pipeline);
  Vercel tem integração git instável (ver Parte 2).

## 1.2 Telas do CRM

| Tela | O que faz | Estado |
|---|---|---|
| **Dashboard** (`/`) | 5 KPIs com variação vs período anterior + funil de conversão, leads/dia, origens, motivos de perda, atividade da Tawany (handoff, latência, bloqueios), 1ª resposta — tudo agregado no servidor, período 7/30/90d | ✅ |
| **Inbox** | 3 colunas; estado por conversa (violeta "Tawany ativa" / âmbar "Aguardando humano — motivo traduzido" / "Humano assumiu"); botão "Devolver para a Tawany"; feedback 👍/👎 nas respostas da IA; modo teste (nada sai pro WhatsApp); deep-link `?lead=` | ✅ |
| **Pipeline** | Kanban com o funil canônico da clínica (novo-lead → … → atendido + terminais colapsáveis); mover grava histórico (quem/quando/de→para); **motivo de perda obrigatório**; badge "Parado há Xd"; filtros combináveis na URL; botão abrir-conversa no card | ✅ |
| **Agenda** | Mês/semana/dia, filtros por profissional/status, novo agendamento, mudança de status, export .ics | ✅ |
| **Tarefas & Atividades** | Buckets Atrasadas/Hoje/Próximas, concluir otimista, criação rápida; feed da operação 24h/7d | ✅ |
| **Relatórios** | Comercial / Atendimento / Tawany, período custom até 366d, comparativo automático, export CSV | ✅ |
| **Bots** | Editor de fluxos (gatilhos, respostas, reordenar), versionamento com revert, duplicar, teste inline sem envio | ✅ |
| **Conhecimento** (`/settings/knowledge`) | 6 seções editáveis do que a Tawany sabe (valores, unidades, regras) — vale em ≤60s, sem deploy | ✅ |
| **IA** (`/settings/ai`) | Fila de revisão dos 👎, transformar em exemplo aprovado, lista de exemplos, modo atual | ✅ |
| Contatos, Orçamentos | Placeholder honesto "Em breve" | ⏸ decisão pendente |

## 1.3 O agente Tawany — anatomia

**Fluxo de uma mensagem** (WhatsApp → resposta):

```
Meta webhook (assinatura HMAC + dedup 5min + debounce)
  → persiste mensagem → BOTS primeiro (fluxos fixos, risk blocking imutável)
  → gates: opt-out ("parar") · prompt-injection · conversa fechada/handoff
  → TAWANY: system prompt (persona + knowledge do banco + classifier +
    exemplos few-shot) + contexto (10 msgs + summary + lead + preços)
    → loop de tools (máx 6 iterações)
  → guards de saída sobre a resposta
  → envio conforme o modo → registro em ai-run-log
```

**Modos** (`SHADOW_MODE`): `shadow` = observa, nunca envia nem consome a
mensagem · `human_approval` = cria sugestão PENDING, equipe aprova no inbox
e aí envia · `autopilot` = envia direto.

**Tools disponíveis**: `sendWhatsApp` (circuit breaker na Meta),
`listProfessionals`/`listServices` (preços reais de `Service.priceCents`),
`readLead`/`readPatient`/`readConversationHistory`, `searchKnowledge`,
`checkBotFaq` (reusa resposta aprovada de bot), `updateLead` (score/intent),
`assignTag`, `createActivity` (nota na timeline), `handoffToHuman`,
`sendWhatsAppTemplate` (HSM).

**Guards de saída** (qualquer bloqueio → handoff com motivo visível no
inbox): preço fora da tabela conhecida · tópicos clínicos sensíveis ·
afirmação sobre Mohs/câncer · promessa de horário sem agenda confirmada ·
promessa de resultado ("garantido", "100%") · comprimento máximo.

**Conhecimento vivo**: 6 seções em `KnowledgeSection` (banco, editável em
/settings/knowledge, cache 60s, fallback para o prompt hardcoded se vazio)
+ até 10 exemplos aprovados injetados como few-shot — alimentados pelo ciclo
👎 → fila de revisão → "transformar em exemplo".

**Resiliência**: falha da IA → fallback leads-novos → handoff; erro de tool →
handoff; sem API key → handoff (nunca crash); tudo logado em `AiRunLog`
(modelo, fallback, latência, motivo) — é a fonte do painel da Tawany.

**Camadas auxiliares**: `qara-classifier` (JSON estruturado: intenção,
temperatura, prioridade P1-P4, pipeline → vira tags), `lead-scorer`
(0-100 + razões), `summarize-conversation` (summary automático).

## 1.4 Automação

- **Follow-up**: scheduler interno a cada 15 min (`FOLLOWUP_INTERVAL_MS`),
  cria task para lead parado ≥3 dias, dedup por task aberta e `nextActionAt`.
- **Lembrete D-1**: implementado (`lib/scheduler.ts` + templates HSM +
  `reminderD1Sent`) — **desligado** (`ENABLE_SCHEDULER=false`).
- **Bots**: respondem antes da Tawany; termos de risco SEMPRE vão para
  humano (constante do engine, não editável).

## 1.5 Estado de produção (verificado 07/07/2026)

| Item | Estado |
|---|---|
| Migrations (10) e seed do knowledge (6 seções) | ✅ aplicados |
| API Render live com a `main` mergeada | ✅ |
| 17 leads reais preservados | ✅ |
| Webhook de lead exige secret (401 sem) | ✅ |
| `SHADOW_MODE` | ⚠️ **não definido** → default `shadow`: a Tawany só observa, não sugere nem envia |
| Credenciais Meta | ⚠️ só `META_VERIFY_TOKEN`; **faltam** `META_APP_SECRET`, `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID` — sem envio real |
| Webhook Meta sem `META_APP_SECRET` | 🚨 aceitava POST anônimo — **corrigido no PR #4** (fail-closed), aguarda merge |
| Web na Vercel | ⚠️ presa no commit de 06/07 — integração git não disparou nos merges |
| `LEAD_WEBHOOK_SECRET` | ⚠️ ausente (webhook público de leads rejeita tudo — seguro, mas inoperante) |
| `ENABLE_SCHEDULER` | `false` (D-1 desligado, deliberado até templates aprovados) |
| Backup agendado | ❌ script existe, nada o executa |
| PRs abertos | #3 (docs pós-migração) e #4 (segurança webhook) |

---

# PARTE 2 — Ações imediatas (destravar produção)

Ordem exata. 👤 = você (dashboard/1 clique) · 🤖 = agente (automatizável).

1. 👤 **Merge do PR #4** (fail-closed do webhook — segurança) e do **PR #3**
   (docs). O Render redeploya sozinho.
2. 👤 **Render → serviço `qaracrm` → Environment**: adicionar
   `SHADOW_MODE=human_approval` (Tawany passa a sugerir; nada sai sem
   aprovação humana no inbox).
3. 👤 **Vercel → projeto `web`**: Redeploy do branch `main` + conferir
   **Settings → Git** (reconectar `hampikamayuq/qaracrm` para os próximos
   merges deployarem sozinhos).
4. 👤 **Rotacionar a API key do Render** que circulou no chat
   (Account Settings → API Keys).
5. 🤖 **Smoke test pós-cliques** (roteiro fixo):
   - `GET /api/health` → 200
   - `POST /api/webhooks/meta` sem assinatura → **403** (prova o PR #4)
   - `GET /api/dashboard/summary` sem token → 401
   - Login real → dashboard carrega com os 17 leads
   - `/settings/knowledge` lista as 6 seções
   - Web nova: `/pipeline` mostra o kanban canônico e o botão de conversa

---

# PARTE 3 — Roadmap de otimização

## Lote 1 — Ligar o que já existe (custo ~zero) 🟢

### 1.1 Lembrete de consulta D-1 (P)
**Por quê:** reduz falta (no-show) — maior ROI de clínica. Já implementado.

> ✅ **Efeito colateral eliminado (10/07)**: as flags foram separadas —
> `ENABLE_SCHEDULER` liga só o loop; `ENABLE_D1_REMINDERS` e
> `ENABLE_FOLLOWUP_HSM` (ambas default `false`) ligam cada job de envio
> individualmente (gate em `runSchedulerTick`, com testes). Ligar o D-1 não
> dispara mais rajada de follow-ups 48h no backlog.

**Passos:**
1. ✅ ~~Separar as flags (P, código)~~ — feito em 10/07: gate por job em
   `runSchedulerTick` (`ENABLE_D1_REMINDERS` / `ENABLE_FOLLOWUP_HSM`).
2. Aprovar os templates HSM na Meta (Business Manager → WhatsApp →
   Message Templates, textos em `src/lib/templates/hsm-messages.ts`) —
   ambos os templates, se o follow-up HSM também for desejado.
3. Ligar `ENABLE_D1_REMINDERS=true` (o follow-up HSM só quando a operação
   decidir, ciente do comportamento de 48h).
4. Acompanhar 1 semana nos logs/feed.

**Aceite:** consulta amanhã → paciente recebe hoje; sem duplicados
(`reminderD1Sent`); **nenhum follow-up HSM disparado sem decisão explícita**.

### 1.2 Backup agendado (P)
Cron no host com `scripts/backup-db.sh` (pg_dump + retenção 30), diário,
alerta em falha. **Aceite:** arquivo novo por dia; restore testado 1x.

### 1.3 Credenciais Meta completas (P, dependência externa)
`META_APP_SECRET` (segurança do webhook — obrigatório pós PR #4),
`META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID` na API; apontar o webhook do
app Meta para `/api/webhooks/meta`; mensagem real de teste.
**Aceite:** mensagem real entra → sugestão → aprovação → paciente recebe.
Também definir `LEAD_WEBHOOK_SECRET` para o webhook público de leads.

## Lote 2 — Operação sente no primeiro dia 🔥

### 2.1 Notificações no inbox (M) ✅ (10/07)
Badge `(N)` no título da aba + som curto (WebAudio, sem asset) em mensagem
nova; handoff com som distinto (dois tons); toggle persistido em
localStorage; polling silencioso de 15s (lista visível + detecção de deltas
sem filtro). **Arquivos:** `inbox/page.tsx`, `inbox/notifications.ts`.

### 2.2 Áudio do WhatsApp com transcrição (M/G)
Paciente de clínica manda muito áudio; hoje não alimenta a Tawany.
Baixar mídia via Graph (URL expira — na hora), transcrever (Whisper via
OpenRouter) com timeout; falha → handoff "áudio não transcrito"; corpo vira
"[áudio transcrito] …" e segue o fluxo normal (inclusive prompt-injection);
inbox mostra ícone + transcrição.
**Aceite:** áudio → Tawany responde ao conteúdo; falha → handoff visível.

### 2.3 Reativação de perdidos (M) ✅ código (10/07)
Job no scheduler (`lib/reactivation.ts`, gate `ENABLE_REACTIVATION`):
`status:perdido-sem-resposta` há 30/60d (data do stage_change; fallback
`updatedAt`), sem opt-out → template `qara_reativacao` 1x por janela (tag
`reativacao:30d/60d`); resposta reabre como `novo-lead` no pipeline
`reativacao` (hook no ingest do webhook). Falta: aprovar o template na Meta
e ligar a flag (runbook §5b); card de métrica no dashboard (Activity
`type=REACTIVATION` já é a fonte).

### 2.4 NPS automático pós-consulta (M)
Appointment `DONE` → NPS via scheduler; resposta → tags `nps:*`; 9-10 pede
Google, 0-6 → handoff + `alerta:reclamacao`. Card de NPS no dashboard.
(Regras já escritas na knowledge §14.)

### 2.5 Decisão: contatos e orçamentos (decisão de produto)
(a) remover do menu, ou (b) construir: contatos = visão de `Patient`;
orçamentos = `estimatedValue` + serviços. **Recomendação:** remover agora,
construir quando a operação pedir.

## Lote 3 — Tawany ainda melhor 🧠

### 3.1 Variáveis e ações por regra no engine de bots (M)
Engine ganha `{{nome}}` e ação por regra (responder | tawany | humano);
o editor já está desenhado para expor. Testes por ação + interpolação.

### 3.2 Autoria de mensagem (M) ✅ base (10/07)
Migration `ChatMessage.sentById` (nullable, sem FK — padrão `feedbackById`);
reply do inbox grava `req.userId`. Falta: usar nos relatórios ("conversas
por atendente" — agora possível).

### 3.3 Métricas do ciclo de feedback (P)
Card em /settings/ai: % de 👍 por semana, exemplos ativos, tendência de
bloqueios. **Aceite:** a gestora vê se a Tawany está melhorando sem
perguntar a ninguém.

### 3.4 Autopilot gradual por intenção (P + decisão)
Gate no `resolveSendMode` pela classificação: `informacao` com confiança
alta sai sozinha (`AUTOPILOT_INTENTS=informacao`); agendamento/orçamento
continuam com aprovação. **Aceite:** pergunta de endereço sai sozinha;
nada de risco sai sem humano.

## Lote 4 — Dívida técnica e infra 🔧

| Item | O quê | Esforço |
|---|---|---|
| 4.1 | ✅ (10/07) Import circular `shadow ↔ tawany-handler` → extraído `lib/shadow-mode.ts` (re-export em `shadow.ts` preserva consumidores) | P |
| 4.2 | Teto de 500 nos `findMany` dos agregadores → `groupBy` no banco quando leads > ~2k | P |
| 4.3 | Limpeza do legado: arquivos twenty-sdk restantes + `__tests__` antigos (~795 erros de tipo fora do build) + `TWENTY_FORWARD_URL` | P/M |
| 4.4 | Monitoramento: health check do Render + uptime externo + Sentry na API + **alerta conversa aguardando-humano >15 min** (via scheduler) | P/M |
| 4.5 | UX contínuo: drag-and-drop real no kanban (HTML5, sem lib), busca global por lead/telefone, modo escuro (tokens já centralizados), atalho conversa→card do pipeline | P cada |

## Dependências e ordem

```
Parte 2 (cliques) ──► smoke ──► Lote 1.1/1.2 (ligar D-1, backup)
                                   │
     Lote 1.3 (Meta creds) ────────┼──► 2.2 áudio · 2.3 reativação · 2.4 NPS
     Lote 2.1 notificações (independente — pode começar já)
     Lotes 3 e 4: qualquer ordem, intercalar com os anteriores
```

## O que NÃO fazer agora (YAGNI)

- Google Calendar OAuth — calendário interno + .ics cobre; revisitar se a
  equipe pedir sincronização real.
- Multi-clínica/multi-tenant, app mobile nativo, i18n — sem demanda.
- Fila/worker externo (Redis/Bull) — `setImmediate` + scheduler interno dão
  conta no volume atual.

---

# PARTE 4 — Definição de "perfeito" e verificação contínua

"Perfeito" para um agente de atendimento não é acertar 100% — é **nunca
errar caro** (preço, conteúdo clínico, paciente irritado) e **melhorar toda
semana** com o feedback da equipe. Metas mensuráveis nos próprios
dashboards/reports:

## 4.1 Metas da Tawany
- Taxa de handoff **< 30%** das conversas (painel do dashboard)
- **Zero** resposta com preço errado ou conteúdo clínico vazado (bloqueios
  do validator = última linha; vazamento = incidente)
- Latência mediana **< 5s** por resposta
- **≥ 90%** de 👍 entre respostas avaliadas pela equipe

## 4.2 Metas da operação
- Mediana de 1ª resposta **< 5 min** em horário comercial (relatório de
  atendimento)
- **Zero** conversa "aguardando humano" por > 15 min sem alerta (após 4.4)
- No-show em queda após ativar o D-1 (comparar semanas no relatório)
- Nenhum lead sem follow-up: badge "Parado" zerado no fim do dia

## 4.3 Metas do sistema
- CI verde em todo merge; suíte completa + build antes de todo commit
- Toda mudança de schema via migration versionada (nunca `db push` manual)
- Backup diário + **restore testado 1x/mês**
- Uptime monitorado com alerta (API e web)

## 4.4 Rotina de verificação
| Frequência | O quê |
|---|---|
| Por commit | Suíte (423+), typecheck, build — já no CI |
| Por deploy | Smoke fixo da Parte 2.5 |
| Semanal | Fila 👎 em /settings/ai → virar exemplos; revisar bloqueios do validator; conferir taxa de handoff |
| Mensal | Teste de restore do backup; revisar métricas da Parte 4 vs metas |

---

*Documentos relacionados: [PRODUCT.md](../PRODUCT.md) (princípios),
[docs/lgpd.md](lgpd.md), [render-ops](superpowers/2026-07-05-qara-render-ops.md)
(ativação/deploy).*
