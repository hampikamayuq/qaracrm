# Canal WEB — chat ao vivo no site

## Contexto
Adicionar um terceiro canal (`WEB`) ao CRM: um widget de chat ao vivo no site da
clínica (Astro, repo `site-biopsia`). O visitante informa **nome + WhatsApp** ao
abrir, conversa em tempo real com a Tawany/atendente, e a conversa entra no
**mesmo inbox** passando por toda a máquina existente (Tawany, guard de preço,
handoff humano). Como o telefone é capturado no início, o lead já nasce com
WhatsApp — então a ponte pós-chat reaproveita os fluxos existentes.

Decisões do usuário: chat **ao vivo**; identidade por **nome+telefone no início**;
widget no **site Astro atual**; WABA do qaracrm é a **mesma** onde o template HSM
já está aprovado (reuso direto por env).

## Reuso (sem mexer)
- Núcleo de ingestão: findOrCreateLead (por telefone), upsert de Conversation,
  create de ChatMessage, dedup por `externalId`, debounce, dispatch Tawany.
  Referência: `apps/api/src/logic-functions/meta-webhook.ts`.
- Dispatch de envio por canal: `apps/api/src/lib/tools/sendWhatsApp.ts` (switch em
  `conversation.channel`).
- SSE interno + `emitInboundMessage`: `apps/api/src/routes/events-routes.ts`,
  `apps/api/src/lib/events.ts`.
- Ponte WhatsApp: template HSM via `sendWhatsAppTemplate` + `reactivation.ts`
  (canal oficial Meta; template por env `REACTIVATION_TEMPLATE`).

## MVP (Fase 1) — chat ao vivo + lead + booking. NÃO depende de template.

### Backend (`apps/api`)
1. **Canal `WEB`**: `channel` já é `String?` — sem migração de enum. Aceitar 'WEB'
   nos pontos que fazem switch (display, guards). NÃO habilitar HSM/reativação
   automática no canal WEB (a conversa WEB não recebe template; a ponte WhatsApp é
   Fase 2 via telefone do lead).
2. **Ingestão WEB** — novo `apps/api/src/logic-functions/web-chat.ts` (copiar o
   núcleo de meta-webhook, trocar a chave de identidade):
   - Lead: findOrCreate por **telefone** (reusar util existente).
   - Conversation: chave `(channel='WEB', externalId=<webSessionId>)`. O índice
     composto `@@index([channel, externalId, instanceId])` já serve.
   - ChatMessage IN: `externalId = web-<webSessionId>-<clientMsgId>` (dedup).
   - debounce + `runBotsForInbound`/Tawany: reusar sem alteração.
   - emitir evento de inbound (reusar `emitInboundMessage`) para o inbox do CRM.
3. **Endpoint público de entrada** — `apps/api/src/routes/web-chat-routes.ts`:
   - `POST /api/web-chat/message` — body `{ webSessionId, name, phone, text, clientMsgId }`.
     Auth: token de widget (`WEB_WIDGET_TOKEN`, header `x-widget-token`,
     comparação **timing-safe** — reusar o padrão de `meta-signature.ts`), CORS
     restrito a `WEB_WIDGET_ORIGIN`, rate limit por IP (reusar o limiter existente
     em auth-routes). Validar body com zod (nome/phone obrigatórios só na 1ª msg
     da sessão). Fail-closed sem token.
   - `POST /api/web-chat/start` (opcional) — cria a sessão/valida nome+telefone.
4. **SSE público por sessão** — `GET /api/web-chat/stream/:webSessionId`:
   - Sem JWT; `webSessionId` é UUID opaco. Emitter keyed `Map<webSessionId,Set<res>>`
     (novo `apps/api/src/lib/web-chat-events.ts`). Heartbeat 25s (padrão de
     events-routes). Rate limit de conexões por IP/sessão. CORS pro origin do site.
5. **Envio para o widget** — branch `channel === 'WEB'` em `sendWhatsApp.ts` →
   `sendViaWeb(webSessionId, text)` (novo `apps/api/src/lib/web-chat-send.ts`) que
   faz push no SSE da sessão e persiste ChatMessage OUT (externalId UUID). Novo
   `webBreaker` (mesmo threshold dos outros). Rate limit por conversa já se aplica.
6. **UI do CRM**: rótulo do canal WEB em `apps/web/src/app/inbox/page.tsx`
   (`channelLabel`) e ícone no command-palette. Sem mudança de fluxo.

### Widget (repo `site-biopsia`, Astro)
- Componente de chat (bolha) — vanilla JS/Web Component, sem framework, embutido no
  layout Astro. localStorage guarda `webSessionId` (UUID). Form inicial nome+telefone.
- Conexão: `EventSource` em `/api/web-chat/stream/:webSessionId` (adaptar o padrão de
  `use-live-events.ts`), reconexão automática. Envio: `fetch` POST em
  `/api/web-chat/message` com `x-widget-token`.
- Config via env do site: `PUBLIC_QARA_API_URL`, `PUBLIC_QARA_WIDGET_TOKEN`.

### Contrato da API (fonte da verdade p/ backend e widget)
```
POST /api/web-chat/message
  headers: { x-widget-token: <WEB_WIDGET_TOKEN> }
  body: { webSessionId: uuid, name?: string, phone?: string(E.164/BR),
          text: string, clientMsgId: string }
  200: { ok: true, conversationId, messageId }
  401 token inválido | 429 rate limit | 400 body inválido

GET /api/web-chat/stream/:webSessionId   (text/event-stream)
  events: { type:'message', direction:'OUT', text, at, messageId }
          : ping   (heartbeat)

GET /api/web-chat/history/:webSessionId
  headers: { x-widget-token: <WEB_WIDGET_TOKEN> }   (mesma auth timing-safe do POST)
  200: { ok: true, messages: [ { direction:'IN'|'OUT', text, at, messageId } ] }
       - ordem cronológica (mais antiga → mais recente), últimas 50.
       - sessão fresca sem conversa → { ok:true, messages:[] } (200, não 404).
       - messageId = id do ChatMessage (mesmo id do evento OUT do SSE), então o
         widget deduplica histórico ↔ ao vivo pelo messageId.
  401 token inválido/ausente | 400 webSessionId inválido | 429 rate limit
```

### Testes (vitest, padrões existentes)
- web-chat ingest: 1ª msg cria lead(por phone)+conversa(WEB)+dispatch Tawany;
  dedup por externalId; msg sem nome/phone na sessão nova → 400.
- token errado→401, válido→aceito; rate limit.
- sendWhatsApp branch WEB → push no SSE + ChatMessage OUT; sem listener não quebra.
- SSE stream: conecta, recebe OUT, heartbeat.

## Fase 2 — ponte WhatsApp (config + pequeno código)
- **Confirmação ao marcar**: ao criar Appointment para lead de origem WEB, enviar
  template de confirmação no WhatsApp (canal oficial) via `sendWhatsAppTemplate`,
  apontando env pro template aprovado. Reusar o disparo de confirmação existente.
- **Lembrete se não marcar**: leads WEB sem booking entram no fluxo de "consulta
  não marcada"/reativação — como `reactivation.ts` exige canal WHATSAPP, criar/usar
  uma conversa WHATSAPP para o telefone do lead e disparar o template lá
  (business-initiated, permitido por ser template aprovado). Envs:
  `REACTIVATION_TEMPLATE` / novo `WEB_CONFIRMATION_TEMPLATE`.
- Nenhuma aprovação de template nova (mesma WABA).

## Envs novas
- API: `WEB_WIDGET_TOKEN`, `WEB_WIDGET_ORIGIN`, (`WEB_CONFIRMATION_TEMPLATE` na Fase 2).
- Site: `PUBLIC_QARA_API_URL`, `PUBLIC_QARA_WIDGET_TOKEN`.

## Verificação e2e
1. `pnpm --filter @qara/api test` + typecheck; `pnpm --filter @qara/web build`.
2. Subir API local, `curl` no `/api/web-chat/message` com token → conversa aparece
   no inbox, Tawany responde, resposta chega no SSE (`curl -N` no stream).
3. Widget no site: abrir, preencher nome+telefone, trocar mensagens ao vivo.
```
