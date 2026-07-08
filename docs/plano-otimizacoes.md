# Plano de Otimizações — QARA CRM + Tawany

> Estado de partida (07/07/2026): Fases 2–9 completas no PR #1
> (`feat/fases-2-6-crm-tawany`) — Tawany com modos seguros, design system,
> funis com histórico e motivo de perda, dashboard, bots editáveis,
> calendário, timeline, reports, knowledge editável, feedback 👍/👎,
> teste de integração ponta a ponta. 422 testes unitários + 10 de
> integração, CI verde.
>
> Como usar: os lotes estão em ordem de execução recomendada. Cada item
> tem passos, arquivos e critério de aceite. Esforço: P (≤meio dia),
> M (1–2 dias), G (3+ dias).

---

## Lote 0 — Antes do merge do PR #1 🔴

### 0.1 Corrigir/remover o workflow de CD (P)
**Por quê:** `.github/workflows/cd.yml` ainda é da era Twenty (deploya em
`localhost:2020`). Vai falhar vermelho em todo push na `main` após o merge.
**Passos:**
1. Se Render/Vercel deployam via integração git (é o caso hoje): remover o
   job de deploy do cd.yml ou substituí-lo por um smoke test pós-deploy
   (curl no `/health` da API e na home da web).
2. Se preferir CD explícito: usar deploy hooks do Render + `vercel deploy`
   com token, em pnpm.
**Aceite:** push na `main` não gera check vermelho.

### 0.2 Checklist do deploy (execução única, no merge)
1. Merge do PR #1.
2. No banco de produção: `pnpm --filter @qara/api db:migrate:deploy`
   (3 migrations aditivas: summary, knowledge, feedback/exemplos).
3. `pnpm --filter @qara/api db:seed:knowledge` (idempotente — popula as
   6 seções editáveis da Tawany).
4. Env novos na API (Render): `FOLLOWUP_INTERVAL_MS` (default 15 min ok),
   conferir `SHADOW_MODE` desejado (`human_approval` recomendado até a
   equipe confiar; `autopilot` depois).
5. Smoke: login, dashboard carrega, webhook responde 401 sem assinatura,
   mover lead persiste, /settings/knowledge lista as 6 seções.

---

## Lote 1 — Ligar o que já existe (custo ~zero) 🟢

### 1.1 Lembrete de consulta D-1 (P)
**Por quê:** reduz falta (no-show) — maior ROI de clínica. JÁ IMPLEMENTADO
em `apps/api/src/lib/scheduler.ts` (`runD1ReminderJob`, templates HSM,
campo `Appointment.reminderD1Sent`). Só está desligado.
**Passos:**
1. Aprovar os templates HSM na Meta (Business Manager → WhatsApp →
   Message Templates) com os textos de
   `src/lib/templates/hsm-messages.ts`.
2. `ENABLE_SCHEDULER=true` na API de produção.
3. Acompanhar 1 semana no feed de atividades / logs (`reminderD1Sent`).
**Aceite:** consulta amanhã → paciente recebe template hoje; sem duplicados.

### 1.2 Backup do banco agendado (P)
**Por quê:** `scripts/backup-db.sh` existe (pg_dump + retenção 30) mas
nada o executa.
**Passos:** agendar no host que enxerga o Postgres (cron do Render ou
job externo), diário, com alerta em falha.
**Aceite:** arquivo novo de backup por dia; restore testado 1x.

### 1.3 Credenciais Meta WhatsApp em produção (P, dependência externa)
**Por quê:** sem elas a Tawany não envia de verdade. O código já está
seguro (shadow não envia; human_approval segura tudo para aprovação).
**Passos:** configurar `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID`,
`META_APP_SECRET`, `META_VERIFY_TOKEN` na API; apontar o webhook do app
Meta para `/api/webhooks/meta`; enviar 1 mensagem real de teste e
acompanhar no inbox.
**Aceite:** mensagem real entra → sugestão da Tawany aparece → aprovação
envia e o paciente recebe.

---

## Lote 2 — Operação sente no primeiro dia 🔥

### 2.1 Notificações no inbox (M)
**Por quê:** a recepção não fica olhando a tela; um "Aguardando humano"
pode ficar minutos sem resposta.
**Passos:**
1. O inbox já faz polling da lista — detectar no cliente: nova conversa,
   nova mensagem IN e novo handoff desde o último poll.
2. Badge no título da aba (`(3) QARA CRM`) + som curto (respeitando
   permissão/config do navegador) + destaque na linha.
3. Toggle "Notificações" no header do inbox (persistir em localStorage).
4. Handoff (aguardando humano) tem som/realce distinto do resto.
**Arquivos:** `apps/web/src/app/inbox/page.tsx`, `globals.css`.
**Aceite:** mensagem nova em outra aba → título muda e som toca; handoff
se distingue visualmente e sonoramente.

### 2.2 Áudio do WhatsApp com transcrição (M/G)
**Por quê:** paciente de clínica manda muito áudio; hoje mensagens
não-texto não alimentam a Tawany.
**Passos:**
1. `meta-webhook`: ao receber `type: audio`, baixar a mídia via Graph API
   (URL curta expira — baixar na hora) e salvar `messageType: AUDIO`.
2. Transcrever (Whisper via OpenRouter/OpenAI) com timeout + fallback:
   falha de transcrição → handoff com motivo "áudio não transcrito".
3. Corpo da mensagem vira a transcrição com prefixo (ex.:
   "[áudio transcrito] ..."); o fluxo normal (bots → Tawany) segue igual.
4. Inbox mostra ícone de áudio + transcrição na bolha.
5. Guard: transcrição também passa pelo prompt-injection.
**Arquivos:** `logic-functions/meta-webhook.ts`, novo
`lib/transcribe.ts`, `inbox-routes.ts`, inbox UI.
**Aceite:** áudio de teste → transcrição na conversa → Tawany responde ao
conteúdo; falha de transcrição → handoff visível.

### 2.3 Reativação de leads perdidos (M)
**Por quê:** `perdido-sem-resposta` é recuperável; hoje morre no funil.
**Passos:**
1. Job no scheduler existente: leads com tag `status:perdido-sem-resposta`
   há 30/60 dias, sem opt-out → enviar template HSM de reativação
   (1x por janela, marcar tag `reativacao:30d`/`60d`).
2. Resposta do paciente → conversa reabre e lead volta para `novo-lead`
   no pipeline `9-reativacao` (regra da knowledge §4).
3. Métrica no dashboard: reativados no período.
**Aceite:** lead perdido há 30d recebe 1 template; resposta reabre o funil.

### 2.4 NPS automático pós-consulta (M)
**Por quê:** knowledge §14 já define todo o fluxo; falta a automação.
**Passos:**
1. Trigger: appointment vira `DONE` → agenda envio do NPS (mesmo dia à
   noite ou D+1) via scheduler.
2. Resposta numérica classificada (0–6/7–8/9–10) → tags `nps:*`;
   9–10 dispara pedido de avaliação Google; 0–6 → handoff + `alerta:reclamacao`.
3. Card de NPS médio no dashboard.
**Aceite:** consulta concluída gera NPS; notas alimentam tags e dashboard.

### 2.5 Decidir contacts e quotes (decisão de produto, P)
As 2 últimas telas placeholder. Opções: (a) remover do menu (menos
fachada, PRODUCT.md agradece); (b) construir contacts como visão de
pacientes (model Patient já existe) e quotes como orçamentos ligados a
`estimatedValue`/serviços. Recomendação: remover agora, construir quando
a operação pedir.

---

## Lote 3 — Tawany ainda melhor 🧠

### 3.1 Variáveis e ações por regra no engine de bots (M)
**Por quê:** o editor (Fase 5) já está pronto para expor; o engine só faz
primeira-regra-responde.
**Passos:**
1. Engine: suporte a `{{nome}}` (interpolar do lead) e ação por regra
   (`responder` | `tawany` | `humano`).
2. Testes de engine para cada ação + interpolação com lead sem nome.
3. Editor: destravar os campos (já desenhados, hoje ocultos por "nada fake").
**Aceite:** bot com "Oi {{nome}}!" personaliza; regra com ação humano
transfere direto.

### 3.2 Autoria de mensagem (M)
**Por quê:** destrava "conversas por atendente" nos relatórios (hoje
impossível: `ChatMessage` não tem autor).
**Passos:**
1. Migration: `ChatMessage.sentById` (nullable) + backfill nulo.
2. `inbox-routes` reply grava `req.userId`; `sendWhatsApp` da Tawany deixa
   nulo (agentHandled já distingue).
3. Reports/atendimento: quebra por atendente (Tawany | humano X | humano Y).
**Aceite:** relatório de atendimento mostra volume por pessoa.

### 3.3 Métricas do ciclo de feedback (P)
**Por quê:** medir se os exemplos aprovados (Fase 8) melhoram a Tawany.
**Passos:** card em /settings/ai: % de 👍 sobre respostas avaliadas por
semana; nº de exemplos ativos; bloqueios por semana (tendência).
**Aceite:** gestora vê a tendência sem consultar ninguém.

### 3.4 Autopilot gradual (decisão + P)
**Por quê:** `human_approval` é seguro mas dá trabalho; autopilot total é
arriscado. Meio-termo: autopilot só para intenções de baixo risco
(`informacao` com confiança alta do classificador), sugestão para o resto.
**Passos:** gate no `resolveSendMode` usando a classificação; env
`AUTOPILOT_INTENTS=informacao`. Métrica de acompanhamento no dashboard.
**Aceite:** perguntas de endereço/horário saem sozinhas; agendamento e
orçamento continuam passando por aprovação.

---

## Lote 4 — Dívida técnica e infra 🔧

### 4.1 Import circular shadow ↔ tawany-handler (P)
Extrair `getShadowMode`/`isAutopilotMode` para `lib/shadow-mode.ts` sem
dependências; os dois importam de lá. Testes existentes cobrem.

### 4.2 Paginação/teto nos agregadores (P)
`dashboard/aggregate` e rotas de pipeline fazem `findMany` com teto 500.
Com a base atual (dezenas de leads) não dói; marcar limite explícito e
mover contagens para `groupBy` no banco quando os leads passarem de ~2k.

### 4.3 Limpeza do legado (P/M)
1. Concluir a remoção do twenty-sdk (sessão separada já iniciada):
   `post-install-seed.ts`, `universal-webhook.ts`, `meta-webhook-verify.ts`,
   diretórios `objects/ views/ front-components/` etc. se não referenciados.
2. `__tests__` antigos fora do build com ~795 erros de tipo no
   tsconfig.spec: apagar ou consertar (hoje só poluem).
3. Remover `TWENTY_FORWARD_URL`/forward do webhook quando o Twenty for
   desligado de vez (ver `lib/shadow.ts` e ops doc).

### 4.4 Monitoramento e alertas (P/M)
1. Health check do Render apontando para `/health` (nativo).
2. Uptime externo (UptimeRobot ou similar) na API e na web.
3. Erros: Sentry na API (1 linha no server + env) — opcional mas barato.
4. Alerta de fila: conversas `aguardando_humano` > 15 min → notificação
   (e-mail/WhatsApp da gestora) — pode usar o scheduler existente.

### 4.5 UX contínuo (P cada)
- Drag-and-drop real no kanban (hoje move via select) — HTML5 DnD sem lib.
- Busca global (lead/telefone) no topbar.
- Modo escuro (tokens já centralizados — é mapear a paleta).
- Link reverso: conversa do inbox → card no pipeline (o drawer já tem;
  falta atalho no header da conversa).

---

## Dependências e ordem sugerida

```
0.1 cd.yml ──► merge PR #1 ──► 0.2 deploy
                                  │
              1.1 D-1 ◄── 1.3 Meta creds ──► 2.2 áudio
              1.2 backup          │
                                  ▼
              2.1 notificações (independente, pode antes)
              2.3 reativação / 2.4 NPS (dependem de 1.3 + scheduler)
              3.x e 4.x: qualquer ordem, encaixar entre os lotes
```

## O que NÃO fazer agora (YAGNI)
- Google Calendar OAuth — o calendário interno + .ics cobre; revisitar se
  a equipe pedir sincronização de verdade.
- Multi-clínica/multi-tenant, app mobile nativo, i18n — sem demanda.
- Fila/worker externo (Redis/Bull) — o volume atual não justifica;
  `setImmediate` + scheduler interno dão conta.
