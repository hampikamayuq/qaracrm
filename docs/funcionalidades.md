# Funcionalidades do CRM QARA

Documentação técnica de cada módulo do CRM.

## WhatsApp Direct

Triagem, qualificação e agendamento de pacientes via WhatsApp — núcleo do CRM.

### O que faz

- Recebe mensagens da Cloud API Meta via webhook (`POST /api/webhooks/meta`)
- Processa no agente Tawany (IA + guards + tools de negócio)
- Envia respostas automáticas ou sob aprovação humana (conforme SHADOW_MODE)
- Segue-up automático em leads sem resposta e lembretes D-1 para agendamentos

### Arquivos principais

- `apps/api/src/lib/whatsapp-client.ts` — envio via Cloud API
- `apps/api/src/routes/meta-webhook-routes.ts` — webhook de recebimento
- `apps/api/src/logic-functions/meta-webhook.ts` — processamento da mensagem (parser, guards, Tawany)
- `apps/api/src/lib/scheduler.ts` — scheduler de follow-ups e lembretes D-1

### Rotas HTTP da API

| Rota | Método | Descrição |
| --- | --- | --- |
| `/api/webhooks/meta` | `POST` | Webhook de inbound (recebimento) |
| `/api/inbox/:id/reply` | `POST` | Envio de reply (IA ou aprovado) |
| `/api/inbox/list` | `GET` | Lista de conversas |
| `/api/inbox/:id` | `GET` | Detalhe da conversa com mensagens |

### Variáveis de ambiente

| Nome | Default | Descrição |
| --- | --- | --- |
| `META_ACCESS_TOKEN` | — | Token de acesso da Página WhatsApp (obrigatório) |
| `META_PHONE_NUMBER_ID` | — | ID do número de telefone vinculado (obrigatório) |
| `WHATSAPP_ACCESS_TOKEN` | — | Token para download de mídia (vazio usa META_ACCESS_TOKEN) |
| `META_VERIFY_TOKEN` | `qara-verify-token` | Token de verificação do webhook |
| `META_APP_SECRET` | — | Chave secreta da app (assinatura de webhook) |
| `META_GRAPH_BASE_URL` | `https://graph.facebook.com/v20.0` | Base URL da Graph API |

---

## Instagram Direct

Envio de respostas diretas (DMs) no Instagram via Meta Graph API.

### O que faz

- Recebe mensagens do Instagram no mesmo webhook (`POST /api/webhooks/meta`)
- Identifica o canal (WhatsApp ou Instagram) pelo campo `messaging_product` do JSON Meta
- Envia respostas pelo `instagram-client` (não automático — usa a mesma lógica de aprovação/shadow que WhatsApp)
- Nunca auto-envia em IG; o agente Tawany sugere ou aprova, a mesma lógica de `SHADOW_MODE` governa

### Arquivos principais

- `apps/api/src/lib/instagram-client.ts` — envio via Meta Graph API (`/{INSTAGRAM_SEND_ID}/messages`)
- `apps/api/src/lib/meta-parse.ts` — parser que detecta o canal da mensagem
- `apps/api/src/routes/meta-webhook-routes.ts` — webhook unificado para ambos os canais

### Rotas HTTP da API

Reutiliza as mesmas rotas do WhatsApp; a API detecta automaticamente o canal na conversa.

### Variáveis de ambiente

| Nome | Default | Descrição |
| --- | --- | --- |
| `INSTAGRAM_PAGE_ACCESS_TOKEN` | — | Token de acesso da Página Instagram (obrigatório para envio) |
| `INSTAGRAM_SEND_ID` | `me` | ID usado no path de envio (`/{ID}/messages`); vazio usa "me" (própria Página) |

### Como ativar

1. No [Graph API Explorer](https://developers.facebook.com/tools/explorer) (Meta Developers):
   - Selecionar a app do CRM
   - Executar `GET /me/accounts` com token de user (pessoal com permissão de admin da Página)
   - Copiar o `id` e `access_token` da Página Instagram
2. Estender o token (30 dias → 60 dias) no [Depurador](https://developers.facebook.com/tools/debug/accesstoken/)
3. No Render (produção), setar:
   ```
   INSTAGRAM_PAGE_ACCESS_TOKEN=<token_estendido>
   INSTAGRAM_SEND_ID=<id_da_pagina>  # ou deixar vazio para "me"
   ```

---

## Servidor MCP

Copiloto Claude integrado — expõe o CRM como tools para Claude Desktop ou Code.

### O que faz

- Autentica no CRM via HTTP (`apps/api`)
- Oferece tools de leitura (leads, pacientes, conversas, tarefas, relatórios)
- Oferece tools de escrita segura (criar tarefas, notas, aprovar sugestões Tawany)
- Nunca envia mensagens direto; apenas a tool `approve_suggestion` pode fazer com aprovação explícita

### Documentação completa

Ver [packages/mcp/README.md](../packages/mcp) para lista de tools, variáveis de ambiente e setup do cliente.

### Como ativar em produção

1. Criar usuário de serviço na API (de `apps/api`):
   ```bash
   MCP_USER_EMAIL=mcp@qara.local MCP_USER_PASSWORD='senha-forte' pnpm mcp:user
   ```
2. No cliente MCP (Claude Code `.mcp.json` ou Claude Desktop `claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "qara-crm": {
         "command": "node",
         "args": ["/caminho/absoluto/packages/mcp/dist/index.js"],
         "env": {
           "MCP_API_URL": "https://cliniqara-crm.onrender.com",
           "MCP_EMAIL": "mcp@qara.local",
           "MCP_PASSWORD": "senha-forte"
         }
       }
     }
   }
   ```

---

## Respostas Rápidas (Quick Replies)

Gabarito de textos com placeholders, disponível no inbox para envio rápido.

### O que faz

- CRUD de respostas rápidas (shortcut/title/content)
- Disponível no picker do inbox durante a composição
- Suporta placeholders: `{{nome}}`, `{{telefone}}`, etc. (preenchidos com dados do lead/paciente)
- Ativo/inativo para organização

### Arquivos principais

- `apps/api/src/routes/quick-reply-routes.ts` — rotas CRUD
- `apps/web/src/app/(authenticated)/inbox/...` — picker no inbox (front-end)

### Rotas HTTP da API

| Rota | Método | Descrição |
| --- | --- | --- |
| `/api/quick-replies` | `GET` | Lista com busca por shortcut/título/conteúdo |
| `/api/quick-replies` | `POST` | Criar (admin) |
| `/api/quick-replies/:id` | `PATCH` | Atualizar (admin) |
| `/api/quick-replies/:id` | `DELETE` | Deletar (admin) |

### Variáveis de ambiente

Nenhuma (dados no banco).

---

## Orçamentos (Budgets)

Máquina de estados para propostas de tratamento com follow-up automático.

### O que faz

- Criar orçamento vinculado a lead + serviço
- Ciclo de vida: DRAFT → SENT → ACCEPTED | REJECTED | EXPIRED
- Follow-up automático (task + HSM template `qara_budget_followup`) em orçamentos SENT sem resposta
- Saldo derivado: valor total − pagamentos liquidados (PAID/PARTIALLY_PAID)
- Integra com Pagamentos: orçamento vinculado recebe pagamentos

### Arquivos principais

- `apps/api/src/routes/budget-routes.ts` — CRUD e transições de estado
- `apps/api/src/logic-functions/` — follow-up engine (scheduler)

### Rotas HTTP da API

| Rota | Método | Descrição |
| --- | --- | --- |
| `/api/budgets` | `GET` | Lista com filtros de status, lead, paciente |
| `/api/budgets` | `POST` | Criar (rascunho) |
| `/api/budgets/:id` | `GET` | Detalhe com saldo calculado |
| `/api/budgets/:id` | `PATCH` | Atualizar (title, value) ou transicionar status |
| `/api/budgets/:id/send` | `POST` | DRAFT → SENT (envia HSM template ao paciente) |
| `/api/budgets/:id/accept` | `POST` | SENT → ACCEPTED |
| `/api/budgets/:id/reject` | `POST` | SENT → REJECTED |
| `/api/budgets/:id/archive` | `POST` | Qualquer → ARCHIVED (histórico) |

### Variáveis de ambiente

| Nome | Default | Descrição |
| --- | --- | --- |
| `BUDGET_FOLLOWUP_DAYS` | `3` | Dias sem resposta (status SENT) até gerar task de cobrança + HSM |
| `WHATSAPP_FOLLOWUP_TEMPLATE` | `qara_budget_followup` | Template HSM de follow-up aprovado na Meta |

### Como ativar em produção

1. Aprovar template HSM `qara_budget_followup` no Business Manager (Meta)
   - Corpo: "Olá {{name}}, você recebeu um orçamento em 📎. Acesse ou responda para mais info!"
   - Parâmetros: `name` (opcional)
2. Ligar `ENABLE_SCHEDULER=true` na API para ativar o scheduler de follow-ups

---

## Pagamentos (Payments)

Registro de recebimentos com vários métodos, vinculado a orçamentos.

### O que faz

- Registrar pagamentos: dinheiro, PIX, débito, crédito, transferência, outro
- Estados: PENDING, PAID, PARTIALLY_PAID, CANCELED, REFUNDED
- Vincular a orçamento (obrigatório) — orçamento só recebe pagamento se status SENT/ACCEPTED
- Saldo do orçamento = valor total − pagamentos liquidados (PAID/PARTIALLY_PAID)
- Drawer na tela de Orçamentos (`/quotes`) para visualizar histórico e adicionar pagamento

### Arquivos principais

- `apps/api/src/routes/payment-routes.ts` — CRUD e transições de status
- `apps/web/src/app/(authenticated)/quotes/...` — drawer de pagamentos (front-end)

### Rotas HTTP da API

| Rota | Método | Descrição |
| --- | --- | --- |
| `/api/payments` | `GET` | Lista com filtros de budget, status |
| `/api/payments` | `POST` | Criar pagamento (PENDING ou PAID por padrão) |
| `/api/payments/:id` | `GET` | Detalhe |
| `/api/payments/:id` | `PATCH` | Transicionar status (marcar como PAID ou CANCELED) |

### Variáveis de ambiente

Nenhuma.

---

## Pacientes (Patients)

Conversão automática de leads em pacientes, histórico unificado.

### O que faz

- Criar/atualizar perfil de paciente (nome, telefone, email, CPF, data de nascimento, etc.)
- Conversão lead→paciente: lead com presença em consulta ativa é movido para estágio `atendido` (terminal)
- Histórico unificado: consultas, orçamentos, pagamentos na timeline de paciente
- Filtro por canal preferido (WhatsApp, Instagram)

### Arquivos principais

- `apps/api/src/routes/patient-routes.ts` — CRUD e conversão
- `apps/api/src/lib/patient-profile.ts` — lógica de perfil

### Rotas HTTP da API

| Rota | Método | Descrição |
| --- | --- | --- |
| `/api/patients` | `GET` | Lista com busca por nome/telefone, paginação |
| `/api/patients` | `POST` | Criar paciente |
| `/api/patients/:id` | `GET` | Detalhe com dados cadastrais, lead de origem, timeline |
| `/api/patients/:id` | `PATCH` | Atualizar perfil (name, email, cpf, birthDate, etc.) |
| `/api/patients/:leadId/convert` | `POST` | Converter lead em paciente (DRAFT no schema → cria Patient com leadId) |

### Variáveis de ambiente

Nenhuma.

### Como ativar em produção

Automático — pacientes são criados e convertidos do lead conforme consultas e interações.

---

## Confirmação D-1 com Botões

Lembrete automático no dia anterior ao agendamento, com Confirmar/Remarcar em um toque.

### O que faz

- Scheduler envia template HSM `qara_appointment_reminder_d1` no dia anterior (D-1)
- Template traz 2 botões: "Confirmar ✓" e "Remarcar 📅"
- Clique em Confirmar: muda status do agendamento para CONFIRMED, responde ao paciente
- Clique em Remarcar: cria task "Remarcar consulta" e sinaliza para a recepção (needsHuman=true)
- Interceptação determinística (sem IA): bypassa bots e Tawany, processa antes

### Arquivos principais

- `apps/api/src/logic-functions/appointment-confirmation.ts` — lógica de interceptação e transição
- `apps/api/src/lib/scheduler.ts` — envio do template no scheduler
- `apps/api/src/lib/templates/hsm-messages.ts` — templates HSM (qara_appointment_reminder_d1, etc.)

### Rotas HTTP da API

Nenhuma direta; acionado pelo scheduler e webhook Meta (interceptação de button.payload).

### Variáveis de ambiente

| Nome | Default | Descrição |
| --- | --- | --- |
| `APPOINTMENT_CONFIRM_BUTTONS` | `false` | Habilita envio do template com botões; desligado envia sem botões (compatibilidade) |
| `ENABLE_SCHEDULER` | `false` | Ativa scheduler (inclui D-1, follow-ups, NPS) |

### Como ativar em produção

1. Aprovar template HSM `qara_appointment_reminder_d1` no Business Manager (Meta)
   - Com 2 botões quick-reply: "Confirmar" (payload=confirm_apt_{appointmentId}), "Remarcar" (payload=reschedule_apt_{appointmentId})
2. No Render, setar:
   ```
   ENABLE_SCHEDULER=true
   APPOINTMENT_CONFIRM_BUTTONS=true
   ```

---

## NPS pós-consulta

Pesquisa de satisfação 0-10 via WhatsApp, captura automática e categorização.

### O que faz

- No dia seguinte a uma consulta com status DONE, envia template HSM perguntando nota (0 a 10)
- Captura resposta determinística: número puro (0-10) é interceptado como NPS, não passa pela IA
- Categorização automática:
  - **Detrator (0-6)**: sinaliza conversa para recepção (needsHuman=true), cria task
  - **Passivo (7-8)**: responde com agradecimento
  - **Promotor (9-10)**: agradece e pede review no Google
- Fora da janela de captura (NPS_CAPTURE_WINDOW_HOURS): mensagem segue fluxo normal (bots/Tawany)

### Arquivos principais

- `apps/api/src/logic-functions/nps-capture.ts` — lógica de interceptação e captura
- `apps/api/src/lib/scheduler.ts` — scheduler que envia template
- `apps/api/src/lib/templates/hsm-messages.ts` — templates HSM (qara_nps_pos_consulta)

### Rotas HTTP da API

Nenhuma direta; acionado pelo scheduler e webhook Meta.

### Variáveis de ambiente

| Nome | Default | Descrição |
| --- | --- | --- |
| `NPS_ENABLED` | `false` | Habilita scheduler de NPS (desligado por padrão) |
| `NPS_TEMPLATE` | `qara_nps_pos_consulta` | Nome do template HSM aprovado na Meta |
| `NPS_CAPTURE_WINDOW_HOURS` | `48` | Janela (em horas) após envio em que resposta numérica é capturada como NPS |
| `ENABLE_SCHEDULER` | `false` | Ativa scheduler (inclui D-1, follow-ups, NPS) |

### Como ativar em produção

1. Aprovar template HSM `qara_nps_pos_consulta` no Business Manager (Meta)
   - Corpo: "Olá {{name}}, como foi sua experiência na consulta? Sua nota (0-10) nos ajuda a melhorar! 🙏"
   - Parâmetros: `name`
2. No Render, setar:
   ```
   ENABLE_SCHEDULER=true
   NPS_ENABLED=true
   ```

---

## Transcrição de Áudios

Notas de voz e anexos de áudio convertidos para texto (português do Brasil).

### O que faz

- Quando paciente envia nota de voz (WhatsApp) ou áudio (Instagram), o áudio é baixado automaticamente
- Transcrição via OpenRouter (modelo multimodal que aceita áudio em base64)
- Corpo da mensagem vira: "🎤 (áudio transcrito): <texto>"
- Processado normalmente pela Tawany e Inbox (sem distinção de áudio vs. texto)
- Nunca lança; se transcription falhar, mantém o placeholder `[áudio]`
- Timeout configurável; limite de tamanho (default 16 MB)

### Arquivos principais

- `apps/api/src/lib/transcription-client.ts` — chamada ao OpenRouter
- `apps/api/src/lib/media-client.ts` — download de mídia da Graph API (WhatsApp/Instagram)
- `apps/api/src/logic-functions/meta-webhook.ts` — integração no pipeline de inbound

### Rotas HTTP da API

Nenhuma direta; acionado automaticamente no webhook Meta ao receber áudio.

### Variáveis de ambiente

| Nome | Default | Descrição |
| --- | --- | --- |
| `AUDIO_TRANSCRIPTION_ENABLED` | `false` | Habilita transcrição (desligado por padrão) |
| `TRANSCRIPTION_MODEL` | `google/gemini-2.5-flash` | Modelo multimodal do OpenRouter |
| `TRANSCRIPTION_MODEL_FALLBACK` | — | Fallback opcional se modelo primário falhar |
| `AUDIO_MAX_BYTES` | `16777216` (16 MB) | Tamanho máximo do áudio baixado |
| `AUDIO_DOWNLOAD_TIMEOUT_MS` | `20000` (20s) | Timeout do download da mídia |
| `OPENROUTER_API_KEY` | — | Token para chamar OpenRouter (obrigatório se enabled) |
| `WHATSAPP_ACCESS_TOKEN` | — | Token para download do WhatsApp (vazio usa META_ACCESS_TOKEN) |

### Como ativar em produção

1. No Render, setar:
   ```
   AUDIO_TRANSCRIPTION_ENABLED=true
   TRANSCRIPTION_MODEL=google/gemini-2.5-flash
   OPENROUTER_API_KEY=<seu_token>
   ```
2. Para WhatsApp: garantir que `WHATSAPP_ACCESS_TOKEN` ou `META_ACCESS_TOKEN` estão presentes
3. Instagram: webhook já inclui URLs de mídia diretas (sem auth extra)

---

## Tabela Consolidada de Variáveis de Ambiente (Novos Módulos)

Leia em `apps/api/.env.example` para valores e descrições exatas.

| Nome | Default | Descrição | Módulo |
| --- | --- | --- | --- |
| `INSTAGRAM_PAGE_ACCESS_TOKEN` | — | Token de acesso da Página Instagram | Instagram Direct |
| `INSTAGRAM_SEND_ID` | `me` | ID do remetente (path do envio) | Instagram Direct |
| `BUDGET_FOLLOWUP_DAYS` | `3` | Dias sem resposta até follow-up | Orçamentos |
| `APPOINTMENT_CONFIRM_BUTTONS` | `false` | Ativa botões D-1 (Confirmar/Remarcar) | Confirmação D-1 |
| `NPS_ENABLED` | `false` | Ativa NPS pós-consulta | NPS |
| `NPS_TEMPLATE` | `qara_nps_pos_consulta` | Nome do template HSM de NPS | NPS |
| `NPS_CAPTURE_WINDOW_HOURS` | `48` | Janela de captura (horas) | NPS |
| `AUDIO_TRANSCRIPTION_ENABLED` | `false` | Ativa transcrição de áudios | Transcrição |
| `TRANSCRIPTION_MODEL` | `google/gemini-2.5-flash` | Modelo de transcrição | Transcrição |
| `TRANSCRIPTION_MODEL_FALLBACK` | — | Fallback de modelo | Transcrição |
| `AUDIO_MAX_BYTES` | `16777216` | Tamanho máximo do áudio | Transcrição |
