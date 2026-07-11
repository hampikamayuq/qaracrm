# Números extras de WhatsApp via QR code (gateway Evolution API)

O QARA suporta, além do número oficial (Meta Cloud API), **números extras de
WhatsApp conectados por QR code** — pareamento estilo WhatsApp Web, via um
[Evolution API](https://doc.evolution-api.com/v2) self-hosted (integração
Baileys). Gestão em **Admin → Canais** (`/settings/channels`).

## ⚠️ Riscos e limites — leia antes de ativar

- **Não-oficial.** O pareamento por QR usa o protocolo do WhatsApp Web via
  Baileys, **fora dos termos de serviço do WhatsApp**. A Meta pode **banir o
  número** a qualquer momento. Use apenas números secundários; o número
  principal da clínica permanece na Cloud API oficial. Nunca use o canal QR
  para disparo em massa.
- **Atendimento humano apenas (v1).** Conversas de número QR entram no Inbox
  como "Aguardando humano" (`handoffReason: canal_qr`). **Nada automático sai
  por esses números**: sem Tawany, bots, follow-up 48h, lembrete D-1, NPS nem
  confirmação de opt-out. Os fluxos de template/HSM filtram `channel =
  'WHATSAPP'` (canal oficial) — não remova esses guards.
- **Não é multi-tenant.** Continua 1 clínica; são só N números da mesma
  operação (o YAGNI de multi-clínica do `docs/plano-otimizacoes.md` segue
  valendo). O Lead converge por telefone; cada número tem sua conversa.

## Arquitetura

```
paciente ⇄ número QR ⇄ Evolution API (Render, serviço próprio)
                          │  webhook (x-webhook-secret)
                          ▼
              QARA API /api/webhooks/evolution
                          │  ingest (sem IA) → Inbox
                          ▼
        resposta do Inbox → POST /message/sendText/{instância}
```

- Instâncias vivem na tabela `WhatsAppInstance`; conversas do canal QR têm
  `channel = 'WHATSAPP_QR'` + `instanceId` (FK `SET NULL`: remover a instância
  preserva o histórico).
- `fromMe` (resposta pelo celular pareado) vira mensagem OUT + "humano
  assumiu" — mesmo comportamento do Coexistence no canal oficial.
- Dedup por `key.id`; mensagens enviadas pelo CRM não duplicam com o echo.
- Áudio do paciente é transcrito (mesmo gate `TRANSCRIPTION_*` do canal
  oficial) via `getBase64FromMediaMessage`; imagem/vídeo/documento entram como
  placeholder com caption. Grupos, broadcast e JIDs `@lid` são ignorados.
- Opt-out ("parar", "sair"...) marca `lead.optedOut` (bloqueia também as
  automações do canal oficial), mas nenhuma confirmação automática é enviada
  pelo número QR.

## Deploy do Evolution API no Render

1. **Novo Web Service** com a imagem Docker `evoapicloud/evolution-api:latest`
   (v2). Instância Starter (~US$7/mês) atende poucas instâncias.
2. **Banco próprio**: crie um Postgres dedicado (ou um database separado no
   mesmo instance do CRM — nunca o mesmo database/schema do QARA). Envs:
   ```
   AUTHENTICATION_API_KEY=<chave forte — é a "senha root" do gateway>
   DATABASE_ENABLED=true
   DATABASE_PROVIDER=postgresql
   DATABASE_CONNECTION_URI=postgres://...
   CONFIG_SESSION_PHONE_CLIENT=QARA CRM
   ```
   Cache Redis é opcional para o nosso volume.
3. **Persistência de sessão** fica no Postgres do Evolution — reinícios do
   serviço não exigem re-escanear o QR.

## Configuração do QARA (Render da API)

```
EVOLUTION_BASE_URL=https://<evolution>.onrender.com
EVOLUTION_API_KEY=<mesma AUTHENTICATION_API_KEY>
EVOLUTION_WEBHOOK_SECRET=<uuid forte — valida o header x-webhook-secret>
EVOLUTION_WEBHOOK_URL=https://cliniqara-crm.onrender.com/api/webhooks/evolution
```

Sem essas 4 envs a feature fica desligada (a tela de Canais avisa e o webhook
rejeita tudo — fail-closed). O webhook é configurado **por instância** na
criação, com `base64: false` (mídia é baixada sob demanda; payloads grandes
estourariam o limite de 1mb do body parser) e eventos `QRCODE_UPDATED`,
`CONNECTION_UPDATE`, `MESSAGES_UPSERT`.

Migration nova neste lote: `20260711000000_whatsapp_instance` — rodar
`db:migrate:deploy` no deploy (ver README).

## Como parear um número

1. Admin → Canais → **Adicionar número** (nome interno, ex.: "Recepção").
2. **Conectar** → aparece o QR (renova sozinho a cada 30s).
3. No celular do número: WhatsApp → Configurações → Dispositivos conectados →
   Conectar dispositivo → escanear.
4. O chip vira **Conectado** e o telefone aparece no card. Pronto: mensagens
   recebidas caem no Inbox com o rótulo "WhatsApp · <nome>".

Status é reconciliado com o gateway pelo polling da tela e por um job do
scheduler (~5min) — se o celular desconectar, o envio pelo Inbox falha com
"instância desconectada" e o card fica vermelho.

## Teste local (smoke)

```bash
docker run -d --name evolution -p 8080:8080 \
  -e AUTHENTICATION_API_KEY=dev-key \
  -e DATABASE_ENABLED=true -e DATABASE_PROVIDER=postgresql \
  -e DATABASE_CONNECTION_URI=postgres://qara:@host.docker.internal:5432/evolution \
  evoapicloud/evolution-api:latest
```

Na API dev: `EVOLUTION_BASE_URL=http://localhost:8080`,
`EVOLUTION_API_KEY=dev-key`, `EVOLUTION_WEBHOOK_SECRET=<uuid>`,
`EVOLUTION_WEBHOOK_URL=http://host.docker.internal:4000/api/webhooks/evolution`.

Roteiro: criar canal → parear com um número real → mandar texto/áudio/imagem
de outro celular (Inbox: "Aguardando humano", áudio transcrito, nenhuma
resposta automática, nenhum `aiSuggestion`) → responder pelo Inbox (chega no
celular) → responder pelo celular pareado (vira OUT sem duplicar) →
desconectar e tentar responder (erro 409 no Inbox) → com
`ENABLE_SCHEDULER=true`, conferir nos logs que follow-up/D-1/NPS pulam a
conversa QR.

## Fora do escopo do v1

Envio de mídia pelo Inbox, importação de histórico do número, Tawany/bots no
canal QR, revoke/edit de mensagens, grupos. Se algum virar necessidade, é
lote novo no `docs/plano-otimizacoes.md`.
