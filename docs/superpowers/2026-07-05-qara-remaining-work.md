# Qara Clinic — O que falta implementar

**Data:** 2026-07-05
**Base:** `docs/superpowers/2026-07-03-qara-twenty-design.md` (spec completo) + estado real do código em `src/`.

Este documento é um raio-x do roadmap (spec §11) comparado ao que está de fato no repositório. Não repete o que já está pronto em detalhe — só o suficiente para dar contexto — e foca no que falta.

---

## Status por fase

| Fase | Sub-projeto | Status |
|---|---|---|
| 1 | A+B+D1 — modelo de dados + Tawany + UI | ✅ Completo |
| 2 | C — WhatsApp/Instagram | ✅ Completo (código). Falta ativar credenciais reais (ops). |
| 3 | E — Scoring + Follow-ups | ✅ Completo (código). Falta ativação operacional se o deploy não usar `cronTriggerSettings`. |
| 4 | F — Bot determinístico (`leads-novos-flow`) | ✅ Completo (código). Falta sync/deploy. |
| 5 | G — Roles/Permissões (RECEPTION/DOCTOR/FINANCE) | ❌ **Não iniciado** |
| 6 | H — Financeiro | ⏸️ Deferred (fora de escopo, por decisão de design) |
| 7 | I — Webhook universal + CSV import/export | ❌ **Não iniciado** |
| 8 | Nice-to-have (áudio/imagem, multi-clínica, SSO, etc.) | ⏸️ Deferred (explícito no spec §10.2) |

---

## 1. Fase 4 — Bot determinístico (`leads-novos-flow`)

**Spec:** §3.7-3.8. Terceira camada do fallback chain (Tawany → `leads-novos-flow` → handoff humano).

O fallback chain agora tem **3 camadas**: Tawany → `leads-novos-flow` → handoff humano.

**Feito:**
- [x] Regras determinísticas pequenas em `src/lib/leads-novos/rules.ts`
- [x] Matcher puro em `src/lib/leads-novos/matcher.ts`
- [x] `src/logic-functions/leads-novos-flow.ts` — LF que roda quando o catch externo do `tawany-handler` dispara
- [x] Conexão no `catch` de `tawany-handler.ts`
- [x] Testes unitários do matcher e do flow

**Observação:** regras clínicas, foto, pós-operatório, reclamação e urgência seguem sem resposta automática e vão para handoff.

---

## 2. Fase 5 — Roles / Permissões

**Spec:** §8. Hoje existe **1 role só** (`src/default-role.ts`), usado para a app/LFs internas (flag `AI` etc.). Não existem os 4 roles operacionais do spec.

**Falta:**
- [ ] Role `ADMIN` (full + `MANAGE_TEAM`, `MANAGE_SETTINGS`, `VIEW_REPORTS`, `EXPORT_DATA`)
- [ ] Role `RECEPTION` (lead/patient/conversation/message/task read+write + `AI`, custom flags `HANDOFF_CONVERSATION`/`ASSIGN_LEAD`/`CREATE_APPOINTMENT`)
- [ ] Role `DOCTOR` (read-only patient/lead/conversation/message + `VIEW_OWN_SCHEDULE`/`MANAGE_OWN_AVAILABILITY`)
- [ ] Role `FINANCE` (deferred junto com Fase 6 — sem Budget/Payment não tem o que essa role proteger ainda)
- [ ] Row-level security (DOCTOR só vê patients com appointment dele; FINANCE só vê patients com budget/payment)
- [ ] UI Settings → Equipe: lista de usuários, role por usuário, convite, edição

**Por que importa:** hoje qualquer usuário do workspace enxerga e edita tudo. Sem separação de roles não dá pra dar acesso a um médico ou recepcionista com segurança.

---

## 3. Fase 7 — Webhook universal + CSV

**Spec:** §7. Nada implementado — busquei `universal-webhook`, `csv-parser` no código e não existe nada além de um placeholder de nome em `src/constants/universal-identifiers.ts` (não usado).

**Falta:**
- [ ] `src/logic-functions/universal-webhook.ts` — `POST /webhook/lead` com secret no header, cria Lead + Conversation + Message inbound, dispara o fluxo normal via trigger de `message.created`
- [ ] `src/lib/csv-parser.ts` — import de leads via CSV (find-or-create por whatsapp, normalização de telefone p/ E.164, mapeamento de campos)
- [ ] Export CSV (leads/conversations/tasks)
- [ ] UI: Settings → Dados → Importar CSV (upload → preview → confirma → roda)
- [ ] Variável de ambiente `LEAD_WEBHOOK_SECRET`

**Por que importa:** é o único canal de entrada de leads que não depende do WhatsApp/Instagram — necessário para integrar formulários de site, Google Ads lead forms, planilhas legadas, etc.

---

## 4. Fase 3 e 2 — pendências operacionais (não é código, mas falta)

Fases 2 e 3 estão com o código completo e testado, mas **não estão "ao vivo"** ainda:

- [ ] **Fase 2:** configurar `META_ACCESS_TOKEN` / `META_PHONE_NUMBER_ID` / `META_VERIFY_TOKEN` / `META_APP_SECRET` reais nas server variables do workspace; apontar o webhook do Meta App para `https://<render-twenty-service>.onrender.com/s/meta/webhook`
- [ ] **Fase 3:** o `followup-engine` declara `cronTriggerSettings: { pattern: '0 8 * * *' }`, mas isso ainda precisa ser validado no runtime Twenty em Render. Hoje:
  - `lead-scorer` roda inline dentro do `tawany-handler` (então já recalcula a cada mensagem processada pela Tawany) — isso cobre o caso principal
  - `followup-engine` deve rodar pelo scheduler do Twenty às 08:00 depois do sync; se o Render/Twenty atual não executar esse cron, configurar Render Cron com endpoint/auth confirmados

**Falta:**
- [ ] Validar o agendamento do `followup-engine` no Render (ou configurar Render Cron se necessário)
- [ ] Configurar credenciais Meta reais e testar E2E com curl assinado (já documentado no plano da Fase 2, passo 4)

---

## 5. Deploy / Infra (spec §9) — ainda não em produção

O alvo do servidor Twenty pode ser Render. Ainda falta trocar placeholders pelo host real do serviço Render e executar o sync/deploy contra esse ambiente.

**Falta:**
- [ ] Provisionar/confirmar Render Web Service, Postgres, Redis, backup e restore
- [ ] Definir a URL real: `https://<render-twenty-service>.onrender.com`
- [ ] Configurar `TWENTY_DEPLOY_URL` e `TWENTY_DEPLOY_API_KEY` no ambiente local/CI que fará o sync
- [x] Criar `.env.example` sem segredos
- [ ] Configurar server variables de produção: Meta vars, OpenRouter vars, AI fallback/timeout; infraestrutura do servidor (`APP_SECRET`, `DATABASE_URL`, `REDIS_URL`) fica no serviço Render
- [ ] Confirmar backup/DR conforme o plano Render contratado

---

## 6. Deferred — decisões explícitas de fora do escopo (spec §10.2)

Não são bugs nem esquecimento — foram descartados deliberadamente. Só entram se o usuário pedir:

- Financeiro completo (Budget, Payment, relatórios) — Fase 6
- Suporte a áudio/imagem no WhatsApp (Tawany hoje ignora e marca `needsHuman`)
- Multi-clínica (múltiplos workspaces)
- SSO (Google/Microsoft)
- A/B testing de prompts
- Streaming de resposta (Meta API não aceita mesmo)
- Memória de longo prazo entre sessões (além de `lead.notes`)
- Fine-tuning de modelo
- Sync bidirecional com Kommo (`kommoTag` é só placeholder)
- Agendamento real de consultas (calendário, checagem de conflito de horário)
- Alternativa a Meta (Twilio/Nexmo)

---

## Resumo executivo

O **caminho crítico do spec (Fase 1 → 2 → 4)** está implementado e verde (typecheck, lint, 192 testes unitários). O que falta em código são **Fase 5** roles e **Fase 7** webhook+CSV, mais o trabalho de operação (credenciais Meta reais, cron/follow-up conforme deploy, sync/deploy em produção).

O plano consolidado das próximas fases está em `docs/superpowers/plans/2026-07-05-qara-next-phases-plan.md`.
