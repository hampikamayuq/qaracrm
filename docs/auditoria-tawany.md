# Auditoria do Agente Tawany — achados e otimizações

> Data: 07/07/2026. Escopo: pipeline completo da Tawany em `apps/api`
> (webhook → handler → tools → guards → sugestão/envio), UI de operação em
> `apps/web` (inbox, settings/ai, settings/knowledge) e mecanismos
> autônomos (scheduler, followup-engine). Complementa
> [plano-otimizacoes.md](plano-otimizacoes.md) — itens já planejados lá
> são referenciados por §, não duplicados.
>
> Visão de produto que orienta esta auditoria: a Tawany deve ser um
> **agente autônomo com dois modos de operação convivendo** — autopilot
> para o que é seguro, recomendações (aprovação humana) para o resto.
> Hoje isso não existe: o modo é binário e global.
>
> Esforço: P (≤meio dia), M (1–2 dias), G (3+ dias).

---

## 1. Sumário executivo

O núcleo está sólido: loop de agente com tools e guards
(`tawany-handler.ts`), handoff em qualquer falha, três modos seguros
(`shadow`/`human_approval`/`autopilot`), knowledge editável com cache de
60s, few-shot com curadoria via 👍/👎, telemetria por run (`AiRunLog`) e
fluxo de aprovação atômico no inbox. A arquitetura "fail-closed" (erro →
humano, nunca silêncio) é o ponto mais forte.

Os problemas se concentram em três frentes:

1. **O autopilot é all-or-nothing.** `SHADOW_MODE` é env var global lida
   por processo — sem toggle em runtime, sem granularidade por intenção
   ou risco. `riskLevel` existe no schema e na UI, mas é gravado
   hardcoded `'low'`: nenhuma lógica de risco governa o envio.
2. **Os mecanismos autônomos furam o modo.** O scheduler envia HSM reais
   ignorando `SHADOW_MODE` e sem filtrar `optedOut` (risco LGPD).
3. **Perda silenciosa de mensagens.** O debounce é leading-edge:
   mensagens consecutivas do paciente em 20s são descartadas sem nunca
   serem processadas.

O item (1) é o gap central para a visão de produto; (2) e (3) são bugs
que precisam ser corrigidos antes de qualquer autopilot em produção.

---

## 2. Arquitetura atual (referência)

```
Meta webhook ──► 200 imediato + setImmediate (meta-webhook-routes.ts:72-93)
                    │
                    ▼
   handleMetaWebhook (dedup, debounce, persiste ChatMessage)
                    │
                    ▼
   runTawanyForProcessedMessages (shadow.ts:91) ── SHADOW_MODE → sendMode
                    │
                    ▼
   runTawanyHandler (tawany-handler.ts:223)
     gates: conversa fechada/needsHuman · opt-out · prompt-injection
                    │
                    ▼
   runTawany (loop ≤6 iterações, 12 tools, validateReply)
     ├─ sendMode 'send'          → envia WhatsApp, aiSuggestion SENT
     ├─ sendMode 'suggest_only'  → aiSuggestion PENDING (inbox aprova)
     └─ sendMode 'test'          → aiSuggestion TEST_SENT (shadow)
                    │
                    ▼
   pós-run (não-fatais): qara-classifier · lead-scorer · summarizer
```

Aprovação humana: `POST /api/tawany/approve` (`tawany-routes.ts:63-111`)
— update atômico `PENDING→APPROVED`, envia via `sendWhatsApp`, marca
`SENT`. Autônomos: `scheduler.ts` (tick 60s, HSM de follow-up 48h e
lembrete D-1) e `followup-engine.ts` (15 min, só cria Task).

---

## 3. Achados da auditoria

### P0 — segurança e corretude 🔴

#### 3.1 Scheduler ignora o modo e o opt-out (P)
`runFollowUpJob` (`scheduler.ts:69-97`) e `runD1ReminderJob`
(`scheduler.ts:36-67`) enviam templates HSM reais **sem consultar
`SHADOW_MODE`**: com `ENABLE_SCHEDULER=true` e modo `shadow` ou
`human_approval`, pacientes recebem WhatsApp de verdade, furando o
gating. Além disso `runFollowUpJob` **não filtra `optedOut`** (o
followup-engine filtra; o scheduler não) — enviar a quem pediu para sair
é risco LGPD. `sendWhatsAppTemplate.ts` também não tem guard de
`testMode` (diferente de `sendWhatsApp.ts:29-41`).
**Correção:** gate de modo no `runSchedulerTick` (ou por job), filtro de
`optedOut` no follow-up, guard de `testMode` no template.

#### 3.2 Debounce descarta mensagens do paciente (M)
`debounce.ts` é leading-edge: a primeira mensagem processa na hora
(`:36-37`), as consecutivas na janela de 20s retornam `skip` (`:29-34`) e
são marcadas `agentHandled=true` (`meta-webhook.ts:85`) — **nunca são
processadas**. Paciente que manda "oi" e em seguida "quero agendar botox"
tem a segunda mensagem engolida; a Tawany responde só ao "oi".
**Correção:** trailing-edge — segurar a janela, coalescer as mensagens e
rodar a Tawany uma vez sobre o conjunto. Estado é in-memory (`Map`);
aceitável em instância única, documentar o teto.

#### 3.3 Aprovação pode travar em APPROVED (P)
`tawany-routes.ts:87-106` — se `sendWhatsApp.execute` (`:102`) lançar
após o update atômico, a sugestão fica `APPROVED` para sempre (o status
`FAILED` existe no schema mas nunca é escrito), some da fila e não há
retry. Texto editado pelo humano também não re-passa por `validateReply`.
**Correção:** try/catch no envio → reverter para `PENDING` (ou marcar
`FAILED` com botão de retry); opcional re-validar `finalBody` editado.

#### 3.4 Sem timeout default de IA (P)
`ai-client.ts:97-98` — `AI_TIMEOUT_MS` ausente/inválida ⇒
`Number.parseInt('')` = NaN ⇒ nenhum `AbortController` (`:143-148`): a
chamada ao OpenRouter pode pendurar indefinidamente.
**Correção:** default sensato (ex.: 30_000) quando a env não parseia.

#### 3.5 Sem reprocessamento de webhook (P/M)
O webhook responde 200 e processa via `setImmediate`
(`meta-webhook-routes.ts:72-93`). `WebhookEvent` é persistido com
`processed=false`, mas **nenhum worker reprocessa** eventos pendentes —
se o processo cair após o 200, a mensagem se perde. O YAGNI do plano
(sem Redis/Bull) continua válido; basta um sweep no boot ou no tick do
scheduler para eventos `processed=false` com mais de N minutos.

### P1 — o núcleo do pedido: autopilot + recomendações híbrido 🧠

Estado atual:
- Modo global env-only (`shadow.ts:15-19`); `GET /api/settings/ai` é
  read-only (`settings-routes.ts:78-90`); a UI `/settings/ai` exibe o
  modo com a legenda "definido no ambiente da API". Trocar de
  recomendações para autopilot exige redeploy.
- `riskLevel` gravado hardcoded `'low'` (`tawany-handler.ts:135`); o chip
  de risco no inbox (`inbox/page.tsx:503`) sempre mostra "risco baixo".
- O classifier já produz `confidence` em [0,1]
  (`classification/schema.ts:64`) e `intent`/`temperatura`, mas nada
  disso influencia a decisão de envio (`resolveSendMode`,
  `tawany-handler.ts:42-46`).

**Proposta central — modo híbrido com setting no banco (M/G):**

1. **Setting persistido + toggle na UI.** Tabela de settings (linha
   única `aiMode`) com `PUT /api/settings/ai`; `SHADOW_MODE` vira
   default/fallback. Modos: `shadow | recomendacoes | autopilot |
   hibrido`. Toggle em `/settings/ai` (a página já existe), com cache
   curto no backend (mesmo padrão dos 60s do knowledge). Auditar quem
   trocou o modo (campo `updatedById`, como no knowledge).
2. **Risco real por sugestão.** Calcular `riskLevel` a partir de sinais
   já disponíveis: `confidence` e `intent` do classifier, menção a preço
   ou agendamento na resposta (o `extractPrices` do guard já existe),
   near-miss de keywords sensíveis, lead score. Persistir
   `riskLevel` + motivos na `aiSuggestion` — o chip do inbox passa a
   significar algo.
3. **Decisão por mensagem no modo híbrido.** `resolveSendMode` decide por
   resposta: intenção na allowlist (evolução runtime do §3.4
   `AUTOPILOT_INTENTS` — a allowlist mora no mesmo setting, editável na
   UI) **e** risco baixo → envia (autopilot); qualquer outra coisa →
   `PENDING` (recomendação). Isso entrega exatamente "endereço/horário
   saem sozinhos; agendamento e orçamento passam por aprovação", sem
   redeploy para ajustar.

Estende o §3.4 do plano existente (que propunha env-only); o §3.3
(métricas de feedback) vira pré-requisito da rampa automática (item 4.2
abaixo).

### P2 — observabilidade e custo 📊

#### 3.6 Tokens e custo não são persistidos (P)
O OpenRouter já devolve `usage` (`ai-client.ts:187-191`), mas
`recordAiRun` não grava tokens nem custo — hoje é impossível saber
quanto a Tawany custa por conversa/lead ou detectar spike de consumo.
**Correção:** colunas `promptTokens`/`completionTokens` (+ custo estimado
por modelo) no `AiRunLog`; card de custo no dashboard e alerta de
anomalia. Métricas de curadoria (taxa de aprovação/edição, % 👍) já são
o §3.3 — apenas somar custo ao mesmo card.

### P3 — robustez e guards 🔧

- **Guard de preço estreito** (`reply-validator.ts:46-56`): só casa
  formato `R$` e só valida se `knownPrices` não estiver vazio — "500
  reais", "quinhentos" ou KB sem preços passam. Ampliar o regex e tratar
  `knownPrices` vazio como "qualquer preço é violação".
- **Sem guard de PII** na resposta (CPF, dados clínicos de terceiros).
  Um check de padrões básicos no `validateReply` é barato.
- **Injection só regex no texto do paciente**
  (`tawany-handler.ts:272`) — knowledge editável e outputs de tools não
  são checados (injeção indireta via KB editada por usuário autenticado).
- **Janela de 24h do WhatsApp não é tratada**: texto livre fora da
  janela falha na Meta sem fallback para HSM. Detectar
  `lastMessageAt` IN > 24h e rotear para template (ou handoff).
- **Sem rate limit de envio** — só o circuit breaker por falha
  (`sendWhatsApp.ts:6-9`). Um teto simples de envios/minuto protege
  contra loop de agente + autopilot.

---

## 4. Recomendações para o agente "perfeito" (além dos bugs)

### 4.1 Autonomia proativa (hoje ela só reage)
- **Follow-up redigido pela Tawany (M/G).** Hoje o follow-up de 48h é HSM
  fixo (`scheduler.ts:69`) e o followup-engine só cria Task. Evolução: a
  Tawany redige follow-up personalizado com base na conversa; em
  autopilot envia, em recomendações cria **sugestão agendada** (fila
  "envios programados" no inbox). Unifica os dois mecanismos autônomos
  sob o mesmo gating de modo.
- **Cadência de reengajamento por estágio (M).** Lead parado N dias no
  estágio X → sequência configurável, respeitando `optedOut` e janela
  24h (→ HSM). Generaliza o §2.3 (reativação de perdidos).
- **Recuperação de no-show (P).** O D-1 existe; falta o pós-falta:
  appointment `NO_SHOW` → "vi que não conseguiu vir, quer remarcar?"
  como sugestão/autopilot.
- **Agendamento real (G).** O guard hoje *bloqueia* promessa de horário
  porque a Tawany não tem agenda. Tools `checkAvailability` /
  `bookAppointment` sobre a tabela `Appointment` são o maior
  destravamento de valor SDR: transformam "responde dúvidas" em
  "converte lead em consulta marcada". Em recomendações, o booking vira
  sugestão estruturada para o humano confirmar.

### 4.2 Governança de confiança progressiva
- **Rampa automática ("autopilot conquistado, não configurado") (M).**
  Os dados já existem (`humanEdited`, `approvedById`, `feedback`):
  quando uma intenção atinge X% de aprovação-sem-edição em N sugestões,
  o sistema sugere promovê-la ao autopilot com 1 clique em
  `/settings/ai`. O inverso também: taxa de bloqueio/handoff subindo →
  **auto-downgrade** para recomendações (circuit breaker de qualidade,
  análogo ao `CircuitBreaker` da Meta). Depende do §3.3 e do modo
  híbrido (P1).
- **Limites de autonomia (P).** Máx. N auto-envios consecutivos sem
  resposta do paciente (evita a Tawany insistindo sozinha); kill switch
  global na UI (o toggle de modo do P1 já cobre); flag por lead
  "sensível: sempre humano".

### 4.3 Aprendizado contínuo
- **Edições humanas como sinal de treino (P).** O par
  `originalBody → body` editado já é persistido e hoje é jogado fora —
  é o feedback mais rico que existe. Gerar candidato a exemplo few-shot
  automaticamente a partir do diff, na mesma review queue dos 👎.
- **Few-shot por relevância (P/M).** Hoje entram os 10 exemplos mais
  recentes (`knowledge.ts`, `MAX_FEW_SHOT_EXAMPLES`). Selecionar os 3–5
  mais similares à pergunta atual (keyword match resolve; embeddings só
  se necessário).
- **A/B de prompt (P).** `promptVersion` já é gravado por sugestão;
  falta o relatório comparando handoff/aprovação/edição por versão para
  evoluir o prompt com dados em vez de intuição.
- **LLM-judge periódico (M).** Job semanal avalia conversas resolvidas,
  marca boas respostas como candidatas a exemplo e produz score de
  qualidade — fecha o ciclo de curadoria sem depender de 👍 manual.

### 4.4 Qualidade de conversa
- **Objetivo dinâmico por estágio (P).** A persona é única; injetar no
  prompt o objetivo do estágio do lead (novo → qualificar; qualificado →
  agendar; agendado → confirmar/preparar). O `stage` já está no
  `TawanyContext`.
- **Fatos persistentes do lead (M).** Além do summary: procedimento de
  interesse, objeções, horários preferidos — extraídos pelo classifier e
  injetados no prompt, sobrevivendo à janela de 10 mensagens.
- **Respostas em bolhas (P).** Quebrar respostas longas em 2–3 mensagens
  naturais de WhatsApp em vez de um parágrafo único.
- **Horário comercial (P).** Handoff fora do expediente deve ajustar a
  expectativa ("a equipe responde a partir das 9h") em vez de silêncio.
- **Mídia:** áudio é o §2.2; imagem (foto de pele) → handoff direto com
  contexto, nunca opinião clínica.

### 4.5 Avaliação e regressão
- **Golden set (M).** Hoje uma edição no knowledge entra em produção em
  60s sem nenhum teste. Suíte de conversas-teste (o E2E da Fase 9 é a
  semente) rodada contra mudança de prompt/knowledge, com score antes de
  publicar.

---

## 5. Roadmap priorizado

| # | Item | Esforço | Depende de | Relação c/ plano |
|---|------|---------|-----------|------------------|
| 1 | 3.1 Scheduler: gate de modo + optedOut + testMode | P | — | pré-req do §1.1 |
| 2 | 3.2 Debounce trailing-edge (coalescer mensagens) | M | — | novo |
| 3 | 3.3 Aprovação: FAILED/retry + re-validação | P | — | novo |
| 4 | 3.4 Timeout default de IA | P | — | novo |
| 5 | 3.5 Sweep de WebhookEvent pendente | P/M | — | novo (respeita YAGNI) |
| 6 | P1 Modo híbrido: setting no banco + toggle UI + risco real | M/G | 1–4 | **estende §3.4** |
| 7 | 3.6 Tokens/custo no AiRunLog + dashboard | P | — | soma ao §3.3 |
| 8 | 4.2 Rampa automática + limites de autonomia | M | 6, §3.3 | novo |
| 9 | 4.3 Edições como treino + few-shot por relevância | P/M | — | novo |
| 10 | 4.1 Follow-up redigido pela Tawany + no-show | M/G | 6 | estende §2.3/§2.4 |
| 11 | 4.4 Objetivo por estágio + fatos do lead + bolhas | P/M | — | novo |
| 12 | 4.1 Agendamento real (tools de agenda) | G | 6 | novo — maior valor |
| 13 | P3 Guards: preço/PII/24h/rate limit | P/M | — | novo |
| 14 | 4.5 Golden set de regressão | M | — | novo |

Ordem sugerida: **1–5 antes de ligar qualquer autopilot em produção**
(são os bugs que o autopilot amplificaria); depois 6 (o híbrido é o
coração da visão de produto); 7–9 em paralelo por serem baratos; 10–12
quando a operação confiar no híbrido; 13–14 contínuos.

O que **não** fazer agora continua o mesmo do plano: fila externa
(Redis/Bull), multi-tenant, embeddings sofisticados — o volume atual não
justifica.
