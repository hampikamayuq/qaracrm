# Runbook de Ativação — Módulos Novos em Produção

Checklist prático do que falta ativar no Render (produção) para cada funcionalidade nova.

## 0. Pré-requisito: Setup Inicial

```bash
# 1. Fazer deploy de `main` no Render
# 2. Rodar migrations (shell do Render)
pnpm --filter @qara/api db:migrate:deploy
pnpm --filter @qara/api db:seed:knowledge  # idempotente

# 3. Verificar se servidor está saudável
curl https://cliniqara-crm.onrender.com/api/health
```

---

## 1. Instagram Direct

### Passo 1: Obter Token e ID da Página Instagram

1. Ir ao [Graph API Explorer](https://developers.facebook.com/tools/explorer) (Meta Developers)
2. No dropdown "Select an app", escolher a app do CRM QARA
3. No dropdown "Select a token", escolher um **User Token** com permissão de admin da Página Instagram
4. Clicar em "GET" do lado de "me/accounts"
5. Na resposta JSON, encontrar a **Página Instagram** e copiar:
   - `id` → valor de `INSTAGRAM_SEND_ID`
   - `access_token` → valor de `INSTAGRAM_PAGE_ACCESS_TOKEN` (ANTES de estender)

### Passo 2: Estender Token (30 → 60 dias)

1. Ir ao [Depurador de Access Token](https://developers.facebook.com/tools/debug/accesstoken/)
2. Colar o token copiado acima
3. Clicar em "Estender Token"
4. Copiar o novo token (válido por 60 dias)

### Passo 3: Setar no Render

No dashboard do Render (variáveis de ambiente da API):

```
INSTAGRAM_PAGE_ACCESS_TOKEN=<token_estendido_60_dias>
INSTAGRAM_SEND_ID=<id_da_pagina>
```

### Validação

```bash
# No shell do Render, testar envio (com um lead real ou teste)
# O agente Tawany agora enviará para Instagram se o lead tiver
# channel=instagram no banco (detectado automaticamente do webhook)
```

---

## 2. Servidor MCP (Claude Copiloto)

### Passo 1: Criar Usuário de Serviço na API

```bash
# No local (dev) OU no shell do Render (produção)
cd apps/api
MCP_USER_EMAIL=mcp@qara.local MCP_USER_PASSWORD='senha-forte-min-8-chars' pnpm mcp:user
```

Vai criar um usuário com `role: agente_ia` (role mínimo necessário).

### Passo 2: Build do MCP Server

```bash
# Na raiz do monorepo
pnpm --filter @qara/mcp build
# Gera packages/mcp/dist/index.js
```

### Passo 3: Configurar Cliente MCP

#### Claude Code (`.mcp.json`)

```json
{
  "mcpServers": {
    "qara-crm": {
      "command": "node",
      "args": ["/caminho/absoluto/packages/mcp/dist/index.js"],
      "env": {
        "MCP_API_URL": "https://cliniqara-crm.onrender.com",
        "MCP_EMAIL": "mcp@qara.local",
        "MCP_PASSWORD": "senha-forte-min-8-chars"
      }
    }
  }
}
```

#### Claude Desktop (em `%APPDATA%\Claude\claude_desktop_config.json`)

Mesma estrutura JSON acima.

### Passo 4: Validação

```bash
# No Claude Code/Desktop, digitar:
# @qara-crm list_leads
# Deve retornar lista de leads do CRM
```

---

## 3. Orçamentos & Follow-up Automático

### Passo 1: Aprovar Template HSM (Business Manager Meta)

1. Ir ao [Business Manager](https://business.facebook.com)
2. Expandir "Acuratidade da Mensagem" → "Modelos de Mensagem"
3. Criar novo template com nome `qara_budget_followup`:
   - **Categoria**: Marketing
   - **Corpo**: "Olá {{1}}, você recebeu um orçamento em 📎. Acesse ou responda para mais info!"
   - **Parâmetros**: `{{1}}` = name (opcional)
4. Aguardar aprovação Meta (geralmente 2-4 horas)

### Passo 2: Setar Variáveis no Render

```
WHATSAPP_FOLLOWUP_TEMPLATE=qara_budget_followup
BUDGET_FOLLOWUP_DAYS=3
ENABLE_SCHEDULER=true
```

### Passo 3: Validação

```bash
# No shell do Render, criar um orçamento via API
curl -X POST https://cliniqara-crm.onrender.com/api/budgets \
  -H "Authorization: Bearer <token_admin>" \
  -H "Content-Type: application/json" \
  -d '{
    "leadId": "<id_lead>",
    "serviceId": "<id_service>",
    "amount": 500.00,
    "status": "SENT"
  }'

# Após 3 dias sem resposta, scheduler deve criar task + enviar template
# Verificar logs: grep "budget_followup"
```

---

## 4. Confirmação D-1 com Botões

### Passo 1: Aprovar Template HSM com Botões

1. Business Manager → Modelos de Mensagem
2. Criar novo template `qara_appointment_reminder_d1`:
   - **Categoria**: Transactional
   - **Corpo**: "Olá {{1}}, você tem uma consulta amanhã às {{2}}. Confirma aí? 👇"
   - **Parâmetros**: `{{1}}` = name, `{{2}}` = time
   - **Botões Quick-reply** (2):
     - "✓ Confirmar" → payload: `confirm_apt_<appointmentId>`
     - "📅 Remarcar" → payload: `reschedule_apt_<appointmentId>`
3. Aguardar aprovação Meta

### Passo 2: Setar Variáveis no Render

```
ENABLE_SCHEDULER=true
APPOINTMENT_CONFIRM_BUTTONS=true
```

### Passo 3: Validação

```bash
# Agendar uma consulta para amanhã
# No dia anterior, às 09h (horário padrão), o scheduler enviará o template
# Clicar em "Confirmar" → agendamento muda para CONFIRMED
# Clicar em "Remarcar" → cria task + sinaliza para recepção
```

---

## 5. NPS pós-consulta

### Passo 1: Aprovar Template HSM de NPS

1. Business Manager → Modelos de Mensagem
2. Criar novo template `qara_nps_pos_consulta`:
   - **Categoria**: Transactional
   - **Corpo**: "Olá {{1}}, como foi sua experiência na consulta? Sua nota (0-10) nos ajuda a melhorar! 🙏"
   - **Parâmetros**: `{{1}}` = name
3. Aguardar aprovação Meta

### Passo 2: Setar Variáveis no Render

```
ENABLE_SCHEDULER=true
NPS_ENABLED=true
NPS_TEMPLATE=qara_nps_pos_consulta
NPS_CAPTURE_WINDOW_HOURS=48
```

### Passo 3: Validação

```bash
# Marcar uma consulta como DONE (concluded)
# No dia seguinte, o scheduler envia template de NPS
# Responder com um número (0-10) dentro de 48h → interceptado como NPS
# Verificar no banco: select * from Activity where type='NPS_CAPTURE'
```

---

## 6. Transcrição de Áudios

### Passo 1: Verificar Credenciais OpenRouter

```bash
# Obter/verificar OPENROUTER_API_KEY em https://openrouter.ai/keys
# Manter seguro (senhas não logam; tokens sim)
```

### Passo 2: Setar Variáveis no Render

```
AUDIO_TRANSCRIPTION_ENABLED=true
TRANSCRIPTION_MODEL=google/gemini-2.5-flash
TRANSCRIPTION_MODEL_FALLBACK=deepseek/deepseek-v3  # opcional
AUDIO_MAX_BYTES=16777216
OPENROUTER_API_KEY=<seu_token>
WHATSAPP_ACCESS_TOKEN=  # deixar vazio → usa META_ACCESS_TOKEN
```

### Passo 3: Validação

```bash
# Enviar nota de voz para o número WhatsApp do CRM
# Verificar logs da API: grep "transcription"
# Mensagem deve aparecer como "🎤 (áudio transcrito): <texto>"
```

---

## 7. Resumo de Checklist — O Que Falta Fazer

### Antes de Ativar Qualquer Módulo

- [ ] Deploy de `main` no Render
- [ ] Migrations rodadas (`db:migrate:deploy`)
- [ ] Seeds de conhecimento (`db:seed:knowledge`)

### Instagram Direct

- [ ] Obter token estendido e ID da Página (Graph API Explorer + Depurador)
- [ ] Setar `INSTAGRAM_PAGE_ACCESS_TOKEN` e `INSTAGRAM_SEND_ID` no Render

### MCP Server (Claude Copiloto)

- [ ] Criar usuário `mcp@qara.local` via `pnpm mcp:user`
- [ ] Build: `pnpm --filter @qara/mcp build`
- [ ] Configurar `.mcp.json` (Claude Code) ou `claude_desktop_config.json` (Desktop) com caminho absoluto do `dist/index.js`

### Orçamentos + Follow-up

- [ ] Aprovar template `qara_budget_followup` no Business Manager
- [ ] Setar `ENABLE_SCHEDULER=true`, `BUDGET_FOLLOWUP_DAYS=3`, `WHATSAPP_FOLLOWUP_TEMPLATE=qara_budget_followup`

### Confirmação D-1 com Botões

- [ ] Aprovar template `qara_appointment_reminder_d1` com botões no Business Manager
- [ ] Setar `ENABLE_SCHEDULER=true`, `APPOINTMENT_CONFIRM_BUTTONS=true`

### NPS pós-consulta

- [ ] Aprovar template `qara_nps_pos_consulta` no Business Manager
- [ ] Setar `ENABLE_SCHEDULER=true`, `NPS_ENABLED=true`, `NPS_TEMPLATE=qara_nps_pos_consulta`

### Transcrição de Áudios

- [ ] Obter `OPENROUTER_API_KEY`
- [ ] Setar `AUDIO_TRANSCRIPTION_ENABLED=true`, modelo e chave no Render

---

## 8. Ordem Recomendada de Ativação

1. **Instagram Direct** — sem dependências, isola canais
2. **Servidor MCP** — operacional, não afeta pacientes
3. **Transcrição de Áudios** — melhora UX, não quebra nada (fallback para `[áudio]`)
4. **Orçamentos + Follow-up** — habilita financeiro
5. **NPS pós-consulta** — melhora dados de satisfação
6. **Confirmação D-1 com Botões** — última, agrega confirmação automática

Cada uma pode ser ativada independentemente (gates separados). Scheduler (`ENABLE_SCHEDULER`) é compartilhado — ligar uma vez para ativar todas as jobs que precisam dele.

---

## 9. Rollback de Segurança

Se algo der errado:

```bash
# Shell do Render

# Desligar scheduler (desativa D-1, NPS, follow-up)
ENABLE_SCHEDULER=false

# Desligar módulos específicos (sem afetar scheduler)
AUDIO_TRANSCRIPTION_ENABLED=false
NPS_ENABLED=false
APPOINTMENT_CONFIRM_BUTTONS=false

# Limpar credencial Instagram
INSTAGRAM_PAGE_ACCESS_TOKEN=

# Verificar logs
pnpm --filter @qara/api logs:tail
```

---

## 10. Referências

- **Documentação técnica**: [docs/funcionalidades.md](funcionalidades.md)
- **Variáveis exatas**: [apps/api/.env.example](../apps/api/.env.example)
- **MCP Server**: [packages/mcp/README.md](../packages/mcp)
- **Meta Business Manager**: https://business.facebook.com
- **Graph API Explorer**: https://developers.facebook.com/tools/explorer
- **Render Dashboard**: https://dashboard.render.com
