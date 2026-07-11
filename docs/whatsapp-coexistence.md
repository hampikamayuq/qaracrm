# WhatsApp Cloud API — modo Coexistence

Coexistence permite usar **o mesmo número** no app WhatsApp Business
(celular da clínica) e na Cloud API (CRM) ao mesmo tempo. A equipe continua
respondendo pelo celular quando quiser, e tudo aparece no Inbox do QARA.

## Como o QARA se comporta com Coexistence ativo

- **Mensagem do paciente** → chega pelo webhook `messages` normalmente
  (bots → Tawany → Inbox). Nada muda.
- **Resposta enviada pelo celular** (app WhatsApp Business) → a Meta espelha
  via webhook `smb_message_echoes`; o QARA grava como mensagem **OUT** na
  conversa e marca **humano assumiu** (`status: PENDING_PATIENT`,
  `needsHuman: false`) — o mesmo efeito de responder manualmente pelo Inbox.
  A Tawany **não fala por cima** de quem respondeu pelo celular; para
  reativá-la, use "Devolver para a Tawany" no Inbox.
- **Mensagem enviada pelo CRM/Tawany** → aparece também no app do celular
  (comportamento da própria Meta). Se a Meta ecoar uma mensagem que nós
  mesmos enviamos, o dedup por `wamid` descarta.
- **Echo duplicado (retry da Meta)** → dedup por `wamid`, idempotente.
- **Revoke/edit de mensagens do app** → ignorados na v1 (a mensagem original
  permanece no Inbox como foi enviada).
- **Áudio/mídia enviados pelo celular** → gravados com placeholder
  (`[áudio]`, `[imagem]`, `[vídeo]`, `[documento]` — com caption quando
  houver). Echo de áudio **não** passa por transcrição (transcrevemos só o
  áudio do paciente).
- **Sync de histórico (`history`) e de contatos (`smb_app_state_sync`)** →
  fora do escopo da v1: os payloads são aceitos (200) e ignorados sem erro.
  Se importar 6 meses de histórico virar necessidade, é um lote próprio no
  `docs/plano-otimizacoes.md`.

## Pré-requisitos (lado Meta)

- App WhatsApp Business **versão ≥ 2.24.17** no celular do número.
- O número atual do app WhatsApp Business (não precisa migrar nem apagar).
- Acesso ao app Meta (developers.facebook.com) e ao Business Manager usados
  pelo QARA.

## Passo a passo da ativação

1. **Embedded Signup com Coexistence**: no fluxo de onboarding
   (Facebook Login for Business / Embedded Signup), o dono do número escolhe
   "conectar conta existente do app WhatsApp Business", informa o número e
   autoriza com o código recebido — o vínculo é feito sem tirar o número do
   celular.
2. **Opt-in do histórico** (opcional, na tela do onboarding): a clínica
   decide se compartilha os últimos 6 meses de conversa. Se aprovar, a Meta
   entrega via webhook `history` em até 24h — o QARA v1 ignora esses
   payloads (ver acima), então esse opt-in é indiferente por enquanto.
3. **Assinar os campos de webhook** no app Meta
   (WhatsApp > Configuration > Webhooks), além dos já assinados
   (`messages`):
   - `smb_message_echoes` — **obrigatório** (espelho das respostas do app);
   - `smb_app_state_sync` e `history` — opcionais na v1 (ignorados);
   - `account_update` — já padrão; sinaliza desconexão/offboarding.
4. **Nada muda nas envs** da API: `META_ACCESS_TOKEN`,
   `META_PHONE_NUMBER_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN` continuam
   os mesmos; o endpoint segue `/api/webhooks/meta` com verificação de
   assinatura.
5. **Teste de fumaça**: responda um paciente pelo celular e confira se a
   mensagem aparece como OUT no Inbox e se o badge muda para
   "humano assumiu".

## Limitações do Coexistence (impostas pela Meta)

- Throughput cai para **~20 msg/s** no número compartilhado.
- No app, ficam desabilitados: mensagens temporárias, visualização única,
  localização ao vivo e listas de transmissão.
- **Grupos não sincronizam** (echo só de conversas 1:1).
- Mensagens enviadas por companion apps não suportados não geram echo.

## Referências

- [smb_message_echoes — referência do webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/smb_message_echoes)
- [Onboarding de usuários do app WhatsApp Business (Coexistence)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
