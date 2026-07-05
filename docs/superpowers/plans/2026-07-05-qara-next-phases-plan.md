# Qara Clinic — Avaliação da proposta Tawany + plano das próximas fases

**Data:** 2026-07-05
**Proposta avaliada:** `/home/diegog/Downloads/proposta_arquitetura_agente_tawany_crm_qara(1).md`
**Base real do repo:** `docs/superpowers/2026-07-05-qara-remaining-work.md` + `src/`

## Veredito

A proposta está correta como direção: separar resposta ao paciente, operações internas, guardrails médicos, fallback e auditoria. Mas ela não deve ser implementada literalmente neste repo.

Este projeto já é um **Twenty app**, não um backend Prisma/Express do zero. Já existem objetos, logic functions, Meta webhook, Tawany, tools, classifier, scorer, follow-up engine e UI. O próximo plano deve completar as lacunas reais, não criar uma segunda arquitetura paralela em `src/services`.

## O que aproveitar da proposta

- Modelo por função: `DEFAULT_MODEL_PATIENT` para Tawany e `DEFAULT_MODEL_INTERNAL` para classificação/scoring/resumo.
- Fallback conversacional: MiniMax M3 primário e GLM como fallback via OpenRouter.
- Tawany não executa ação crítica sozinha; backend valida tools, guardrails e handoff.
- Mensagem deve ser persistida antes de chamar IA. O Meta webhook atual já segue isso.
- Validador médico/legal antes do envio ao paciente.
- Logs de IA persistentes antes de produção real.
- DeepSeek/LLM interno como camada operacional, mas sem duplicar o que classifier, scorer e summarizer já fazem.

## O que adaptar

- **Não criar schema Prisma.** Usar os objetos Twenty existentes: `lead`, `patient`, `conversation`, `chatMessage`, `service`, `professional`, `clinicUnit`.
- **Não trocar Tawany inteira para JSON agora.** O fluxo atual usa tool calling estruturado e resposta final em texto puro. Se for obrigatório, criar um wrapper pequeno que valide metadados, sem reescrever o handler.
- **Não criar `src/services/ai/ai-router.ts` como árvore nova.** Estender `src/lib/ai-client.ts` com fallback/timeout pequeno, ou criar `src/lib/ai-router.ts` só se o diff ficar mais limpo.
- **Não criar Operational Agent genérico.** A camada operacional já existe em partes: `qara-classifier`, `summarize-conversation`, `lead-scorer`, `followup-engine`. Completar logs e tarefas faltantes.
- **RAG vetorial fica fora.** A knowledge base atual em prompt + `searchKnowledge` cobre MVP. Index vetorial entra só se houver evidência de custo/latência/qualidade ruim.

## Findings

### High — Falta fallback técnico real no LLM

`createAiClient()` chama um modelo único. `tawany-handler` usa `DEFAULT_MODEL_PATIENT ?? 'minimax/minimax-m3'`; se esse modelo falha, o catch vai para handoff. A proposta pede MiniMax → GLM. Esse é o menor ajuste de arquitetura que entrega valor real.

**Fix:** adicionar helper com lista de modelos e fallback técnico, com teste unitário cobrindo erro do primeiro modelo.

### High — Falta log persistente de IA

Hoje há `console.log` de eventos e campos como `scoreReasons`, mas não há objeto persistente para registrar modelo usado, fallback, latência, guard result e erro. Para saúde/LGPD, isso é uma lacuna antes de produção.

**Fix:** criar `aiRunLog` como objeto de auditoria com view própria ou, se o custo de UI for alto, começar como objeto técnico e expor view depois. Não logar corpo completo de mensagem por padrão.

### Medium — Fallback determinístico ainda não existe

O documento de pendências já identifica a Fase 4: `leads-novos-flow`. O comentário no catch de `tawany-handler.ts` confirma o ponto exato de encaixe.

**Fix:** portar regras mínimas para JSON, rodar matcher no catch externo da Tawany, responder apenas em casos administrativos seguros e handoff quando não houver match.

### Medium — Roles operacionais não existem

Só existe `default-role.ts` para a role do app. Não há `src/roles/` com `ADMIN`, `RECEPTION`, `DOCTOR` e `FINANCE`.

**Fix:** começar por roles com object/field permissions. Row-level security só entra quando houver campo confiável para "meu paciente/minha agenda".

### Medium — Fase 2/3 estão completas em código, mas não em operação

Meta precisa de credenciais reais e `followup-engine` precisa de scheduler. Twenty suporta `cronTriggerSettings`; se o ambiente alvo ainda preferir Render Cron, manter como deploy decision.

**Fix:** transformar isso em fase operacional separada, antes de expandir escopo.

## Plano de fases

### Fase 4A — AI fallback + auditoria mínima

**Objetivo:** tornar Tawany operável em produção sem perder rastreabilidade.

**Status:** concluída em 2026-07-05.

Tarefas:

- [x] Adicionar server variables opcionais: `DEFAULT_MODEL_PATIENT_FALLBACK`, `DEFAULT_MODEL_INTERNAL_FALLBACK`, `AI_TIMEOUT_MS`, `AI_LOG_FULL_PROMPTS=false`.
- [x] Criar teste para fallback: primeiro modelo falha, segundo responde, resultado expõe `modelUsed` e `fallbackUsed`.
- [x] Estender `ai-client` ou criar `ai-router` pequeno para tentar modelos em ordem.
- [x] Criar `aiRunLog` com campos mínimos: `layer`, `model`, `fallbackUsed`, `latencyMs`, `success`, `validationPass`, `reason`, `conversationId`, `messageId`, `createdAt`.
- [x] Logar Tawany, classifier e scorer sem salvar prompt/mensagem completa por padrão.

Aceite:

- `yarn test:unit src/lib/ai-client.test.ts`
- `yarn test:unit src/logic-functions/tawany-handler.test.ts`
- `yarn typecheck && yarn test:unit && yarn lint`

Skipped: custo estimado/token tracking detalhado. Adicionar quando houver billing real.

### Fase 4B — Bot determinístico `leads-novos-flow`

**Objetivo:** completar o fallback chain: Tawany → regras simples → humano.

**Status:** concluída em 2026-07-05.

Tarefas:

- [x] Criar `src/lib/leads-novos/rules.ts` ou `.json` com regras pequenas: saudação, valor consulta, endereço, horário, convênio/reembolso, estacionamento, "quero agendar".
- [x] Criar matcher puro com normalização simples de acento/case.
- [x] Criar `src/logic-functions/leads-novos-flow.ts` callable, testável com `DataApi` fake.
- [x] Alterar só o catch externo de `runTawany()` para tentar essa LF antes de `handoff`.
- [x] Garantir que regras clínicas, foto, pós-op, reclamação e urgência nunca respondam automaticamente.

Aceite:

- Sem match seguro: handoff igual hoje.
- Match seguro: envia WhatsApp, cria outbound `chatMessage`, atualiza conversa, registra atividade curta.
- Testes cobrem match, no-match, risco clínico e erro do envio.

Skipped: construtor visual de fluxo. Adicionar só se a equipe precisar editar regras pela UI.

### Fase Ops-1 — Ativar o que já está pronto

**Objetivo:** colocar Fases 2 e 3 em modo vivo antes de criar novos módulos.

Tarefas:

- [x] Confirmar Render como alvo aceitável para a URL do servidor Twenty: `https://<render-twenty-service>.onrender.com`.
- [ ] Configurar server variables reais do Meta e OpenRouter no workspace.
- [ ] Apontar Meta App para `https://<render-twenty-service>.onrender.com/s/meta/webhook`.
- [ ] Rodar teste E2E com payload assinado do Meta.
- [x] Declarar `followup-engine` com `cronTriggerSettings` diário às 08:00.
- [ ] Validar que o runtime Twenty em Render executa o cron; se não executar, configurar Render Cron com endpoint/auth confirmados.
- [x] Criar `.env.example` sem segredos, alinhado com `src/application-config.ts`.
- [x] Documentar checklist Render em `docs/superpowers/2026-07-05-qara-render-ops.md`.

Aceite:

- Webhook recebe mensagem real e cria `chatMessage` inbound.
- Tawany responde ou faz handoff sem erro.
- Follow-ups aparecem sem execução manual.

Skipped: CI/CD final para marketplace. Adicionar depois que a URL Render real e a chave de deploy estiverem definidas.

### Fase 5 — Roles e permissões

**Objetivo:** deixar o CRM seguro para recepção, médico e financeiro.

Tarefas:

- [ ] Criar `src/roles/admin.role.ts`, `reception.role.ts`, `doctor.role.ts`.
- [ ] `ADMIN`: full operacional e settings.
- [ ] `RECEPTION`: leitura/escrita em lead, patient, conversation, chatMessage e task; sem destroy.
- [ ] `DOCTOR`: leitura inicial em patient/lead/conversation/chatMessage; escrita só em campos clínico-operacionais explicitamente necessários depois.
- [ ] `FINANCE`: deixar deferred até existir orçamento/pagamento.
- [ ] Adicionar testes de manifesto para roles e permissões críticas.
- [ ] Só adicionar row-level security quando houver `appointment/professional/workspaceMember` suficiente para expressar "meus pacientes".

Aceite:

- Manifest sync sem erro.
- Nenhuma role operacional tem destroy.
- App default function role continua separada das roles de usuários.

Skipped: tela custom Settings → Equipe. Twenty já tem gestão de usuários/roles; criar UI própria só se a nativa não cobrir.

### Fase 7 — Webhook universal + CSV

**Objetivo:** aceitar leads fora de Meta: site, Google Ads lead forms, planilhas e integrações legadas.

Tarefas:

- [ ] Criar server variable `LEAD_WEBHOOK_SECRET`.
- [ ] Criar `src/logic-functions/universal-webhook.ts` em `/s/webhook/lead`, com secret em header e sem auth de usuário.
- [ ] Normalizar telefone para BR/E.164 no helper puro.
- [ ] Find-or-create `lead`, `conversation`, `chatMessage`; deixar `chatMessage.created` disparar Tawany.
- [ ] Criar import CSV mínimo para colunas aceitas: `name`, `whatsapp`, `email`, `source`, `intent`, `notes`.
- [ ] Criar export CSV simples para leads e conversas, sem PHI além do necessário.
- [ ] UI só depois do endpoint/helper verde.

Aceite:

- Webhook inválido retorna 401/403 sem side effect.
- Payload válido cria registros e deduplica por telefone/externalId.
- CSV com linha inválida retorna relatório de erros, não aborta tudo.

Skipped: importador genérico com mapeamento visual. Adicionar quando houver planilhas reais diferentes.

### Fase Deploy-1 — Produção

**Objetivo:** sair de app local/dev e ter ambiente recuperável.

Tarefas:

- [x] Definir servidor Twenty alvo: Render.
- [ ] Definir URL real do serviço Render.
- [ ] Configurar `TWENTY_DEPLOY_URL=https://<render-twenty-service>.onrender.com` e `TWENTY_DEPLOY_API_KEY`.
- [ ] Provisionar Postgres/Redis/backups conforme Render.
- [ ] Rodar `yarn twenty dev --once` ou fluxo de deploy equivalente.
- [ ] Rodar smoke pós-deploy: Meta webhook, Tawany, handoff, followup, lead scorer.

Aceite:

- Deploy reproduzível.
- Server variables preenchidas no workspace.
- Backup/restore documentado.

## Fora do próximo bloco

- Financeiro completo, orçamento, agenda médica, BI, portal do paciente e campanhas.
- Vetor/RAG avançado.
- Agente operacional genérico novo.
- Diagnóstico por imagem, prescrição, telemedicina própria.

## Ordem recomendada

1. Fase 4A — fallback de modelo + audit log.
2. Fase 4B — `leads-novos-flow`.
3. Fase Ops-1 — Meta real + cron follow-up + `.env.example`.
4. Fase 5 — roles.
5. Fase 7 — webhook universal + CSV.
6. Fase Deploy-1 — produção, se ainda não tiver sido feito durante Ops-1.

Esta ordem fecha confiabilidade antes de expandir entrada de leads e antes de abrir acesso a usuários com perfis diferentes.
