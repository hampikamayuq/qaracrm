# Integração Kommo → QARA

Mensagens e leads que entram pelo Kommo (ex-amoCRM) fluem para o QARA, onde a
Tawany classifica e responde. O QARA é o sistema operacional principal; o
Kommo segue como porta de entrada (WhatsApp conectado por integração nativa do
Kommo + bots iniciais de lá).

## Arquitetura

```
Kommo ──(webhooks CRM: leads/status/mensagens)──▶ POST /api/webhooks/kommo/<secret>
Kommo ──(salesbot widget_request: mensagem)─────▶ POST /api/webhooks/kommo/<secret>/salesbot
        └▶ WebhookEvent{source:'kommo'} → 200 imediato → processamento async + sweep
           └▶ Lead (vínculo kommoLeadId / dedupe por telefone) → Conversation{channel:'KOMMO'}
              → ChatMessage IN → debounce → bots → Tawany (runTawanyHandler)

Resposta (branch KOMMO do sendWhatsApp):
  custom field do lead ◀── updateKommoLeadTextField
  salesbot de resposta ◀── runKommoSalesbot  → `show` do campo no chat do cliente
```

- **Entrada** espelha os webhooks Meta/Evolution: persist → 200 (<2s, exigência
  do Kommo) → `setImmediate` + sweep `processPendingKommoWebhookEvents` no
  scheduler. Sem HMAC no webhook do Kommo: a autenticação é o segredo no path
  da URL, comparado em tempo constante (fail-closed sem env).
- **Mensagens outgoing do Kommo** (humano ou bot de lá) são espelhadas como
  OUT com human-takeover — a Tawany não disputa a conversa. O eco da própria
  resposta do QARA (entregue via salesbot) é dedupado por corpo idêntico
  recente (10 min).
- **Estágio**: `status_id/pipeline_id` do Kommo → tag `status:<estagio>` via
  `KOMMO_STAGE_MAP`; mudança gera `Activity` STAGE_CHANGE (mesmo formato do
  kanban). Estágio não mapeado não move o lead (vira nota de auditoria).
- **Saída**: não há API pública para mandar mensagem num chat de canal nativo
  do Kommo. O caminho suportado é indireto: gravar a resposta num custom field
  do lead e disparar um salesbot que faz `show` do campo. Sem config
  (`KOMMO_REPLY_*`), o envio falha com erro claro — nada fake.
- **Tawany no canal KOMMO é suggestion-first**: `gateSendModeForChannel` força
  human_approval até `KOMMO_AUTOPILOT=true` (liberar só depois de validar a
  entrega via salesbot em produção). Jobs HSM/D-1/NPS/follow-up continuam
  exclusivos do canal oficial `WHATSAPP`.
- **Reconciliação**: `runKommoReconcileJob` (a cada ~5 min, gated
  `ENABLE_KOMMO_SYNC=true`) pagina `GET /api/v4/leads?filter[updated_at][from]`
  e re-aplica o mapeamento de estágio nos leads já vinculados — rede de
  segurança para webhooks perdidos.

## Variáveis de ambiente (Render)

| Env | Uso |
| --- | --- |
| `KOMMO_SUBDOMAIN` | subdomínio da conta (`https://<sub>.kommo.com`) |
| `KOMMO_ACCESS_TOKEN` | token de longa duração da integração privada (Bearer) |
| `KOMMO_WEBHOOK_SECRET` | segredo do path do webhook (gerar valor longo aleatório) |
| `KOMMO_STAGE_MAP` | JSON `{"<pipelineId>:<statusId>":"<estagio-ui>", "<statusId>":"..."}` |
| `KOMMO_DEFAULT_PIPELINE` | especialidade default do lead novo (slug de `CLINICAL_PIPELINES`) |
| `KOMMO_REPLY_BOT_ID` | id do salesbot "resposta QARA" |
| `KOMMO_REPLY_FIELD_ID` | id do custom field (texto) que o salesbot mostra |
| `KOMMO_AUDIT_NOTES` | `true` = registra nota no lead do Kommo a cada resposta |
| `KOMMO_AUTOPILOT` | `true` = libera auto-envio da Tawany no canal (default: sugestão) |
| `ENABLE_KOMMO_SYNC` | `true` = liga o job de reconciliação (exige scheduler ligado) |

Estágios válidos para o `KOMMO_STAGE_MAP`: `novo-lead`, `qualificado`,
`horario-oferecido`, `agendado`, `confirmado`, `atendido`, `reagendado`,
`perdido` (ou `perdido-<motivo>`), `alta-manutencao`.

## Checklist de setup na conta Kommo

1. **Integração privada**: Settings → Integrations → criar integração privada;
   em *Keys and scopes*, gerar o **long-lived token** (não preencher Redirect
   URL). Copiar subdomínio + token para o Render.
2. **Webhooks de CRM**: Settings → Integrations → Web hooks → adicionar
   `https://cliniqara-crm.onrender.com/api/webhooks/kommo/<KOMMO_WEBHOOK_SECRET>`
   com os eventos: lead adicionado, lead alterado, estágio alterado e (se o
   plano expõe) mensagem recebida/enviada.
3. **Custom field de resposta**: criar um campo de texto no lead (ex.:
   "Resposta QARA") e anotar o `field_id` → `KOMMO_REPLY_FIELD_ID`.
4. **Salesbot "resposta QARA"**: bot com um único passo *Send message* que
   mostra o valor do campo acima; anotar o `bot_id` → `KOMMO_REPLY_BOT_ID`.
5. **Salesbot gatilho (widget_request)** — recomendado para ingestão de
   mensagens (o evento de mensagem nem sempre está disponível nos webhooks):
   bot disparado a cada mensagem recebida, com passo *widget_request* como
   **último passo**, POST para
   `https://cliniqara-crm.onrender.com/api/webhooks/kommo/<secret>/salesbot`
   com o corpo:

   ```json
   {
     "message_id": "{{message.id}}",
     "message_text": "{{message_text}}",
     "lead_id": "{{lead.id}}",
     "talk_id": "{{talk.id}}",
     "contact_name": "{{contact.name}}",
     "contact_phone": "{{contact.phone}}"
   }
   ```

   Importante: use **ou** o webhook de mensagens **ou** o gatilho salesbot
   para ingestão de mensagens — os dois juntos podem duplicar quando o
   `message_id` não vem preenchido.
6. **Modo da Tawany**: começar com `SHADOW_MODE=human_approval` (ou o modo
   salvo em /settings/ai) e validar as sugestões no Inbox antes de considerar
   `KOMMO_AUTOPILOT=true`.

## Teste manual (local)

```bash
KOMMO_WEBHOOK_SECRET=dev-secret pnpm --filter @qara/api dev
# lead novo
curl -s -X POST http://localhost:4000/api/webhooks/kommo/dev-secret \
  --data-urlencode 'leads[add][0][id]=123' \
  --data-urlencode 'leads[add][0][name]=Maria Teste' \
  --data-urlencode 'leads[add][0][price]=350'
# mensagem via hook do salesbot
curl -s -X POST http://localhost:4000/api/webhooks/kommo/dev-secret/salesbot \
  -H 'Content-Type: application/json' \
  -d '{"message_text":"Oi, quero agendar","lead_id":"123","contact_name":"Maria","contact_phone":"+5511999998888"}'
```

Conferir: Lead com `kommoLeadId=123`, Conversation `channel=KOMMO`, ChatMessage
IN e (com IA configurada) `AiSuggestion` PENDING no Inbox.
