# Qara Clinic — Twenty CRM Design

**Status:** Draft (awaiting user review)
**Date:** 2026-07-03
**Scope:** Fases 1, 2, 3, 4, 5, 7 (A+B+D1, C, E, F, G, I)

## 1. Visão geral e arquitetura

### 1.1 Propósito

Construir um CRM 100% funcional e intuitivo para a Clínica Qara, baseado em Twenty CRM, com a agente **Tawany** integrada nativamente ao atendimento (WhatsApp + Instagram). Substitui o CRM Qara atual mantendo os dados operacionais (profissionais, serviços, regras, knowledge base) e ganhando escala, multi-canal e UI profissional.

### 1.2 Decisões de alto nível

| Decisão | Escolha | Justificativa |
|---|---|---|
| Forma de customização | **Twenty App (sem fork)** | SDK cobre 100% do escopo. App em repo separado. |
| LLM provider | **OpenRouter (não Twenty AI credits, não OpenAI direto)** | Per-call model choice, multi-provider, sem vendor lock. |
| Modelo para Tawany | `minimax/minimax-m3` | Custo baixo, qualidade boa p/ atendimento multilíngue. |
| Modelo interno | `deepseek/deepseek-chat` | Scoring, summarizer, classifier. 5-10x mais barato. |
| Estratégia LLM | **Direto nas LFs (sem `runAgent`)** | Per-call model, sem model registry. |
| Trigger | `database-event` em `message.created` | Sem polling, async, nativo Twenty. |
| Fallback | 3-camadas (Tawany → leads-novos → humano) | User confirmou. |
| UI | Front-components nativos (não fork Twenty) | App SDK, deploy independente. |
| Auth | Twenty built-in | Padrão. |
| Migração de dados | Sem migração de pacientes/leads. Seed operacional. | User confirmou. |
| Deploy | Render (web + pg + redis) | User confirmou. |
| Idioma | Multilíngue (Tawany responde no idioma do paciente) | User pediu. |
| Contexto | Resumo pré-computado + 3 últimas verbatim + tools sob demanda | User pediu. |
| Fine-tuning | **Não** | Prompt + skills + tools melhor p/ este caso. |
| Idiomas admin | PT-BR | Clínica é BR. |

### 1.3 Arquitetura de componentes

```
┌─────────────────────────────────────────────────────────────┐
│  Meta Cloud (WhatsApp / Instagram)                          │
└──────────────┬──────────────────────────────────────────────┘
               │ webhook (HTTPS, X-Hub-Signature-256)
               ▼
┌─────────────────────────────────────────────────────────────┐
│  LF: meta-webhook (Fase 2)                                  │
│   - Verifica assinatura                                    │
│   - Cria/atualiza Conversation + Message                    │
│   - Dedup por externalId                                   │
│   - Trigger DB: message.created → próxima fase             │
└──────────────┬──────────────────────────────────────────────┘
               ▼
┌─────────────────────────────────────────────────────────────┐
│  LF: summarize-conversation (Fase 1) — async paralelo      │
│   - Lê últimas 30 mensagens                                │
│   - Chama deepseek/deepseek-chat                           │
│   - Salva em conversation.summary                          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  LF: tawany-handler (Fase 1) — trigger DB                  │
│   1. Carrega contexto (summary + 3 verbatim)               │
│   2. Loop agente: OpenRouter minimax/minimax-m3 + tools     │
│   3. Guardrails: schema, price, length, sensitive          │
│   4. Sucesso: send + createActivity + markHandled          │
│   5. Falha: ↓ fallback                                     │
└──────────────┬──────────────────────────────────────────────┘
               │ exception / guard fail
               ▼
┌─────────────────────────────────────────────────────────────┐
│  LF: leads-novos-flow (Fase 4) — determinístico            │
│   - Regras JSON portadas de flows/leads-novos.bot.js        │
│   - Match → resposta fixa + send                           │
│   - No match: ↓                                            │
└──────────────┬──────────────────────────────────────────────┘
               │ no match
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Handoff humano: conversation.needsHuman = true             │
│  + Activity "Tawany: sem resposta automática"              │
│  Recepção vê no Inbox com badge 🔴                          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  LF: lead-scorer (Fase 3) — trigger DB lead.updated        │
│   - Re-calcula score (heurística + LLM se ambíguo)         │
│   - Atualiza lead.score + Activity com reasoning           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  LF: followup-engine (Fase 3) — cron diário 8h            │
│   - Para cada lead ativo sem follow-up: cria Task          │
│   - Categoriza: atrasado / hoje / próximo / sem-data       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  LF: universal-webhook (Fase 7) — POST /webhook/lead      │
│   - Valida secret (header)                                 │
│   - Cria Lead + Conversation + Message (inbound)           │
│   - Trigger message.created → Tawany                       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Front-components (Fase 1) — UI reativa                    │
│  - whatsapp-inbox: lista conversas + thread + reply         │
│  - lead-kanban: drag-and-drop por etapa                    │
│  - tawany-panel: contexto + ações rápidas                  │
│  - command-menu: tawany-ask + quick-actions                │
│  - navigation: Inbox + Pipeline                            │
└─────────────────────────────────────────────────────────────┘
```

### 1.4 Stack e dependências

- **TypeScript** (alinhado com monorepo Twenty)
- **Vite** (build, padrão do SDK)
- **vitest** (testes unitários)
- **`openai` npm package** (OpenAI-compatible client, aponta p/ OpenRouter)
- **Sem dependências runtime fora das que o SDK expõe** (twenty-sdk, twenty-client-sdk)
- **Lint:** oxlint (padrão Twenty), prettier
- **Type check:** tsc strict

### 1.5 Estrutura de arquivos do app

```
qara-clinic/                          # repo separado
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── application.ts                # defineApplication()
│   ├── role.ts                       # default role
│   ├── objects/
│   │   ├── lead.ts
│   │   ├── patient.ts
│   │   ├── conversation.ts
│   │   ├── message.ts
│   │   ├── service.ts
│   │   ├── professional.ts
│   │   ├── clinicUnit.ts
│   │   ├── tag.ts
│   │   ├── leadTag.ts
│   │   ├── patientTag.ts
│   │   ├── conversationTag.ts
│   │   └── task.ts
│   ├── fields/                       # campos compartilhados (se houver)
│   ├── skills/
│   │   ├── tawany-persona.ts
│   │   ├── qara-knowledge.ts
│   │   └── qara-classifier.ts
│   ├── agents/
│   │   └── tawany.ts
│   ├── logic-functions/
│   │   ├── meta-webhook.ts
│   │   ├── tawany-handler.ts
│   │   ├── summarize-conversation.ts
│   │   ├── leads-novos-flow.ts
│   │   ├── lead-scorer.ts
│   │   ├── followup-engine.ts
│   │   └── universal-webhook.ts
│   ├── front-components/
│   │   ├── whatsapp-inbox/
│   │   ├── lead-kanban/
│   │   └── tawany-panel/
│   ├── command-menu/
│   │   ├── tawany-ask.ts
│   │   └── quick-actions.ts
│   ├── navigation/
│   │   ├── inbox.ts
│   │   └── pipeline.ts
│   ├── page-layouts/
│   │   ├── lead-detail.ts
│   │   └── conversation-detail.ts
│   ├── connections/
│   │   └── meta.ts
│   ├── lib/
│   │   ├── ai-client.ts              # wrapper OpenRouter
│   │   ├── tools/
│   │   │   ├── tawany-tools.ts       # 12 tools do agente
│   │   │   └── index.ts
│   │   ├── guards/
│   │   │   └── reply-validator.ts    # price, length, sensitive
│   │   ├── prompts/
│   │   │   ├── tawany-persona.md
│   │   │   ├── qara-knowledge.md
│   │   │   └── qara-classification.md
│   │   ├── whatsapp-client.ts        # Meta API
│   │   ├── meta-signature.ts         # X-Hub-Signature-256
│   │   ├── observability.ts
│   │   └── csv-parser.ts
│   ├── seed/
│   │   └── seed.ts                   # clinicUnit + 5 pro + 5 svc + 8 tags
│   └── triggers/
│       ├── message-inbound.ts        # DB trigger
│       ├── lead-updated.ts           # DB trigger
│       └── message-inbound-async.ts  # DB trigger summarizer
├── tests/
│   ├── unit/
│   │   ├── tools/
│   │   ├── guards/
│   │   ├── ai-client.test.ts
│   │   ├── meta-signature.test.ts
│   │   └── csv-parser.test.ts
│   ├── integration/
│   │   ├── tawany-handler.test.ts
│   │   └── meta-webhook.test.ts
│   └── smoke/
│       └── end-to-end.test.ts
└── README.md
```

---

## 2. Modelo de dados (Fase 1 A + Fase 3 E + Fase 7 I)

### 2.1 Visão geral e relações

```
┌─────────────┐ N:1  ┌──────────────┐
│  ClinicUnit │◄─────┤  Lead        │ N:1 ────► User (built-in)
└─────────────┘      │              │ 1:1 (convert)
                      │              │◄──────────┐
                      └──────┬───────┘           │
                             │ 1:N               │
                             ▼                   │
                      ┌──────────────┐           │
                      │ Conversation │           │
                      └──────┬───────┘           │
                             │ 1:N               │
                             ▼                   │
                      ┌──────────────┐           │
                      │   Message    │           │
                      └──────────────┘           │
                                                │
┌─────────────┐ N:1  ┌──────────────┐            │
│  ClinicUnit │◄─────┤  Patient     │ ───────────┘
└─────────────┘      └──────┬───────┘
                             │ 1:N
                             ▼
                      ┌──────────────┐
                      │   Task       │  (follow-ups, atividades)
                      └──────────────┘
```

### 2.2 Custom Objects (8 + 1 da Fase 3)

#### `lead` — leads novos e em funil

| Campo | Tipo | Notas |
|---|---|---|
| `fullName` | FULL_NAME | obrigatório |
| `whatsapp` | PHONES | E.164 (`+55...`), único |
| `email` | EMAILS | opcional |
| `source` | SELECT | `site`, `instagram`, `indicacao`, `google`, `meta-ads`, `outro` |
| `intent` | SELECT | `cirurgia`, `unhas`, `tricologia`, `autoimune`, `dermatopediatria`, `outro` |
| `stage` | SELECT | `novo`, `qualificado`, `agendado`, `compareceu`, `perdido`, `convertido` |
| `score` | NUMBER | 0-100, atualizado por `lead-scorer` |
| `scoreReasons` | RAW_JSON | array de strings explicando o score |
| `notes` | RICH_TEXT | anotações livres (markdown) |
| `assignedToId` | RELATION → User | recepção responsável |
| `clinicUnitId` | RELATION → ClinicUnit | unidade padrão |
| `convertedAt` | DATE_TIME | setado quando `stage = convertido` |
| `convertedPatientId` | RELATION → Patient | link 1:1 p/ patient gerado |
| `lastFollowUpAt` | DATE_TIME | atualizado pelo `followup-engine` |
| `nextFollowUpAt` | DATE_TIME | calculado pelo `followup-engine` |
| `searchVector` | TS_VECTOR | gerado p/ busca textual |

**Indexes:** `whatsapp` (unique), `stage`, `score desc`, `assignedToId`, `nextFollowUpAt`, GIN no `searchVector`.

#### `patient` — pacientes ativos

| Campo | Tipo | Notas |
|---|---|---|
| `fullName` | FULL_NAME | obrigatório |
| `whatsapp` | PHONES | E.164, único |
| `email` | EMAILS | |
| `birthDate` | DATE | |
| `sourceLeadId` | RELATION → Lead | setado se veio de conversão |
| `clinicUnitId` | RELATION → ClinicUnit | |
| `notes` | RICH_TEXT | |
| `searchVector` | TS_VECTOR | |

**Indexes:** `whatsapp` (unique), GIN em `searchVector`.

#### `conversation` — thread WhatsApp/IG

| Campo | Tipo | Notas |
|---|---|---|
| `leadId` | RELATION → Lead | nullable |
| `patientId` | RELATION → Patient | nullable (setado pós-conversão) |
| `channel` | SELECT | `whatsapp`, `instagram` |
| `externalId` | TEXT | phone ou IG-scoped-id, parte da unique key |
| `status` | SELECT | `open`, `needsHuman`, `resolved`, `archived` |
| `needsHuman` | BOOLEAN | handoff: recepção assume |
| `handoffReason` | TEXT | motivo do handoff (Tawany preenche) |
| `lastMessageAt` | DATE_TIME | ordenado desc na view |
| `assignedToId` | RELATION → User | recepção responsável quando handoff |
| `summary` | RICH_TEXT | resumo pré-computado pelo `summarize-conversation` |
| `summaryUpdatedAt` | DATE_TIME | |

**Indexes:** unique `(channel, externalId)`, `needsHuman` (parcial onde `= true`), `lastMessageAt desc`, GIN em `summary`.

#### `message` — mensagem individual

| Campo | Tipo | Notas |
|---|---|---|
| `conversationId` | RELATION → Conversation | obrigatório |
| `direction` | SELECT | `in`, `out` |
| `body` | TEXT | conteúdo textual (markdown em `out`) |
| `sentAt` | DATE_TIME | do Meta, nosso timestamp |
| `agentHandled` | BOOLEAN | `true` se Tawany processou |
| `externalId` | TEXT | Meta message id, **unique** (dedup webhook) |
| `messageType` | SELECT | `text`, `button`, `list`, `template`, `image`, `document` |
| `deliveryStatus` | SELECT | `pending`, `sent`, `delivered`, `read`, `failed` (Fase 2) |

**Indexes:** `externalId` (unique), `(conversationId, sentAt desc)`, parcial `agentHandled = false WHERE direction = 'in'`.

#### `service` — serviços / procedimentos

| Campo | Tipo | Notas |
|---|---|---|
| `name` | TEXT | "Consulta Cirurgia Dermatológica" |
| `description` | TEXT | |
| `durationMin` | NUMBER | p/ checagem de conflito (futuro) |
| `defaultPriceCents` | CURRENCY | em centavos |
| `modality` | SELECT | `presencial`, `teleconsulta`, `ambos` |
| `active` | BOOLEAN | |

#### `professional` — médicos (seed migra `careTeam`)

| Campo | Tipo | Notas |
|---|---|---|
| `fullName` | FULL_NAME | "Dr. Diego Galvez" |
| `specialty` | SELECT | `cirurgia`, `unhas`, `tricologia`, `autoimune`, `dermatopediatria` |
| `defaultPriceCents` | CURRENCY | preço base |
| `modality` | SELECT | `presencial`, `teleconsulta`, `ambos` |
| `rjPriceCents` | CURRENCY | preço RJ (nullable) |
| `spPriceCents` | CURRENCY | preço SP (nullable) |
| `telePriceCents` | CURRENCY | preço tele (nullable) |
| `kommoTag` | TEXT | placeholder p/ migração futura |
| `active` | BOOLEAN | |

#### `clinicUnit` — unidades

| Campo | Tipo | Notas |
|---|---|---|
| `name` | TEXT | "Copacabana" |
| `address` | ADDRESS | rua, número, cidade, estado, cep |
| `phone` | PHONES | |
| `active` | BOOLEAN | |

#### `tag` — etiquetas coloridas

| Campo | Tipo | Notas |
|---|---|---|
| `name` | TEXT | "lead-quente" |
| `color` | TEXT | hex (`#FF6B35`) |
| `scope` | SELECT | `lead`, `patient`, `conversation`, `all` |

Associação N:M via `leadTag`, `patientTag`, `conversationTag` (records intermediários, padrão Twenty).

#### `task` — follow-ups (Fase 3)

| Campo | Tipo | Notas |
|---|---|---|
| `title` | TEXT | "Follow-up: Maria Silva" |
| `description` | TEXT | |
| `dueAt` | DATE_TIME | categorização (atrasado/hoje/próximo) |
| `category` | SELECT | `overdue`, `today`, `upcoming`, `no-date` |
| `status` | SELECT | `pending`, `done`, `cancelled` |
| `assignedToId` | RELATION → User | |
| `leadId` | RELATION → Lead | nullable |
| `patientId` | RELATION → Patient | nullable |
| `conversationId` | RELATION → Conversation | nullable (origem do follow-up) |

**Indexes:** `(status, dueAt)`, `category`, `assignedToId`.

### 2.3 Seed data (instalação do app)

Carga inicial via `src/seed/seed.ts`:

```ts
// 1 ClinicUnit
{ name: 'Copacabana', address: { city: 'Rio de Janeiro', state: 'RJ' }, active: true }

// 5 Professionals (literal do careTeam Qara)
{ fullName: 'Dr. Diego',     specialty: 'cirurgia',         rjPriceCents: 45000 }
{ fullName: 'Dr. Miguel',    specialty: 'unhas',            rjPriceCents: 65000, spPriceCents: 80000, telePriceCents: 65000 }
{ fullName: 'Dra. Diana',    specialty: 'tricologia',       defaultPriceCents: 55000 }
{ fullName: 'Dra. Manuela',  specialty: 'autoimune',        defaultPriceCents: 55000 }
{ fullName: 'Dr. Fabricio',  specialty: 'dermatopediatria', defaultPriceCents: 55000 }

// 5 Services
{ name: 'Consulta Cirurgia Dermatológica', durationMin: 30, defaultPriceCents: 45000, modality: 'presencial' }
{ name: 'Consulta Unhas',                  durationMin: 30, defaultPriceCents: 65000, modality: 'ambos' }
{ name: 'Consulta Tricologia',             durationMin: 45, defaultPriceCents: 55000, modality: 'presencial' }
{ name: 'Consulta Autoimune',              durationMin: 45, defaultPriceCents: 55000, modality: 'presencial' }
{ name: 'Consulta Dermatopediatria',       durationMin: 30, defaultPriceCents: 55000, modality: 'presencial' }

// 8 Tags
{ name: 'lead-quente', color: '#FF6B35', scope: 'lead' }
{ name: 'lead-frio',   color: '#4A90E2', scope: 'lead' }
{ name: 'novo',        color: '#50E3C2', scope: 'lead' }
{ name: 'agendar',     color: '#9013FE', scope: 'conversation' }
{ name: 'follow-up',   color: '#F5A623', scope: 'conversation' }
{ name: 'no-show',     color: '#D0021B', scope: 'patient' }
{ name: 'vip',         color: '#BD10E0', scope: 'patient' }
{ name: 'humano',      color: '#7ED321', scope: 'conversation' }
```

### 2.4 Built-in Twenty objects aproveitados

| Object | Como usamos |
|---|---|
| **User** | `assignedToId` em Lead/Patient/Conversation/Task. Twenty já tem auth, roles. |
| **Activity** | Tawany cria anotações via `createActivity`. Aparece no timeline nativo. |
| **Workspace** | Isolamento multi-tenant. Cada clínica = 1 workspace. |
| **Attachment** | (futuro) para áudios/imagens transcritos. |

---

## 3. Agente Tawany (Fase 1 B + Fase 4 F)

### 3.1 Tools (12)

**Read (6)** — contexto para raciocinar:

| Tool | Parâmetros | Retorna |
|---|---|---|
| `readLead` | `leadId: uuid` | Lead completo ou `null` |
| `readPatient` | `patientId: uuid` | Patient completo ou `null` |
| `readConversationHistory` | `conversationId, limit=10` | Mensagens recentes (mais antiga → mais nova) |
| `listProfessionals` | `specialty?: string` | Ativos, opcionalmente filtrados |
| `listServices` | `activeOnly=true` | Serviços ativos |
| `searchKnowledge` | `query: string` | Top-3 chunks do `qara-knowledge` skill |

**Write (3)** — atualizar estado:

| Tool | Restrição | Efeito |
|---|---|---|
| `updateLead` | só `score`, `intent`, `notes` (whitelist) | Atualiza lead |
| `updateConversation` | só `status` | Marca `open` / `resolved` |
| `assignTag` | valida tag existe e `scope` bate | N:M via `leadTag`/`conversationTag` |

**Side-effect (2):**

| Tool | Validação | Efeito |
|---|---|---|
| `createActivity` | `body` ≤ 2000 chars | Nota no timeline do registro |
| `sendWhatsApp` | ver guardrails | Chama Meta API |

**Handoff (1, "early stop"):**

| Tool | Efeito |
|---|---|
| `handoffToHuman` | Seta `conversation.needsHuman = true`, registra `handoffReason`, encerra loop |

### 3.2 Skills (3)

```ts
// src/skills/tawany-persona.ts
export default defineSkill({
  universalIdentifier: 'a1b2c3d4-1111-4000-8000-000000000001',
  name: 'tawany-persona',
  label: 'Tawany — Persona',
  icon: 'IconRobot',
  content: readFileSync(join(__dirname, 'prompts/tawany-persona.md'), 'utf8'),
});
// conteúdo: agent-system-prompt-tawany.md do Qara, com ajustes:
// - "Use a função getServices()" → "use a tool listServices()"
// - Adicionar bloco multilíngue: responda no idioma da mensagem
// - Adicionar bloco guardrails: se não souber valor, devolva action: handoff

// src/skills/qara-knowledge.ts
export default defineSkill({
  universalIdentifier: 'b2c3d4e5-1111-4000-8000-000000000002',
  name: 'qara-knowledge',
  label: 'Qara — Knowledge Base',
  icon: 'IconBook',
  content: readFileSync(join(__dirname, 'prompts/qara-knowledge.md'), 'utf8'),
});
// conteúdo estático:流程 de agendamento, gatilhos de handoff, etapas Kommo,
// políticas de pagamento, observações LGPD. NÃO inclui careTeam (vira dados).

// src/skills/qara-classifier.ts
export default defineSkill({
  universalIdentifier: 'c3d4e5f6-1111-4000-8000-000000000003',
  name: 'qara-classifier',
  label: 'Qara — Regras de Classificação',
  icon: 'IconBrain',
  content: readFileSync(join(__dirname, 'prompts/qara-classification.md'), 'utf8'),
});
// conteúdo: regras de funil, prioridade, temperatura, NPS, segurança. ~150 linhas.
```

### 3.3 Agent nativo Twenty (sidebar AI)

```ts
// src/agents/tawany.ts
export default defineAgent({
  universalIdentifier: 'd4e5f6a7-1111-4000-8000-000000000004',
  name: 'tawany',
  label: 'Tawany — Secretaria Virtual',
  icon: 'IconRobot',
  prompt: TAWANY_PERSONA,  // referência ao skill content
  responseFormat: { type: 'json', schema: TAWANY_RESPONSE_SCHEMA },
});
```

Visível no sidebar AI nativo do Twenty. Clicar abre chat onde admin pode fazer perguntas tipo "Quantos leads quentes temos hoje?" — Tawany responde usando o mesmo prompt + tools.

### 3.4 Execution flow (`tawany-handler`)

```ts
// src/logic-functions/tawany-handler.ts (pseudocódigo)
export default async function tawanyHandler({ messageId }: { messageId: string }) {
  const run = startRun(messageId);
  try {
    const msg = await record('message', messageId);
    if (msg.direction !== 'in' || msg.agentHandled) return;

    const conversation = await record('conversation', msg.conversationId);
    const lead = conversation.leadId ? await record('lead', conversation.leadId) : null;
    const history = await records('message', {
      filter: { conversationId: msg.conversationId, id: { neq: messageId } },
      orderBy: { sentAt: 'desc' },
      limit: 3,  // verbatim, complementado pelo summary
    });

    const systemPrompt = buildSystemPrompt({ lead, conversation, history });
    const messages = [{ role: 'user', content: msg.body }];

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const r = await chat({
        model: process.env.DEFAULT_MODEL_PATIENT,  // minimax/minimax-m3
        system: systemPrompt,
        messages,
        tools: tawanyTools.schema,
      });

      const choice = r.choices[0];

      if (choice.finish_reason === 'tool_calls') {
        messages.push(choice.message);
        for (const call of choice.message.tool_calls) {
          try {
            const result = await executeTool(call.function.name, JSON.parse(call.function.arguments), { messageId });
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
          } catch (e) {
            await setNeedsHuman(conversation.id, `tool_error: ${call.function.name}`);
            await createActivity(conversation.id, `Tawany falhou na tool ${call.function.name}: ${e.message}`);
            return run.finish({ status: 'handoff', reason: 'tool_error' });
          }
        }
        continue;
      }

      const reply = JSON.parse(choice.message.content);

      if (reply.action === 'handoff') {
        await setNeedsHuman(conversation.id, reply.reason || 'agent_requested');
        await createActivity(conversation.id, `Tawany: handoff (${reply.reason})`);
        return run.finish({ status: 'handoff', reason: reply.reason });
      }

      if (reply.action === 'update_lead' && lead) {
        await updateLead(lead.id, reply.leadUpdate);
      }

      const guard = await validateReply(reply.text, lead);
      if (!guard.ok) {
        await setNeedsHuman(conversation.id, `guard_failed: ${guard.reason}`);
        await createActivity(conversation.id, `Tawany: reply bloqueado (${guard.reason})`);
        return run.finish({ status: 'handoff', reason: guard.reason });
      }

      await sendWhatsApp(conversation.id, reply.text);
      await createActivity(conversation.id, `Tawany: ${reply.text.slice(0, 200)}`);
      return run.finish({ status: 'replied', model: MODEL, tokens: r.usage });
    }

    await setNeedsHuman(conversation.id, 'max_iterations');
    return run.finish({ status: 'handoff', reason: 'max_iterations' });

  } catch (e) {
    await runLeadsNovosFlow({ messageId, originalError: e.message });
    return run.finish({ status: 'fallback', error: e.message });
  } finally {
    await markAgentHandled(messageId);
  }
}
```

### 3.5 Schema de resposta

```ts
const TAWANY_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['reply', 'update_lead', 'handoff', 'none'],
      description: 'O que Tawany quer fazer',
    },
    text: { type: 'string', description: 'Mensagem a enviar (apenas se action=reply)' },
    leadUpdate: {
      type: 'object',
      properties: {
        score: { type: 'number', minimum: 0, maximum: 100 },
        intent: { type: 'string' },
        notes: { type: 'string' },
      },
      description: 'Atualização parcial do lead (apenas se action=update_lead)',
    },
    reason: { type: 'string', description: 'Se action=handoff, motivo' },
  },
  required: ['action'],
  additionalProperties: false,
};
```

### 3.6 Guardrails

| Camada | O que faz | Quando dispara |
|---|---|---|
| Schema JSON estrito | Força `action` válida | Toda chamada |
| Tool whitelist | `updateLead` só aceita `score/intent/notes` | Quando LLM tenta escrever |
| Price validator | Regex扫 reply por `R$\s?\d+`, compara com `professional.*PriceCents` | Antes de `sendWhatsApp` |
| Length cap | Reply > 1024 chars → handoff | Antes de `sendWhatsApp` |
| Sensitive topic | Skill persona proíbe diagnóstico, prescrição, promessa | Validado no `validateReply` |
| Tool error catch | Qualquer tool joga → handoff imediato | Em loop |
| Iteration cap | 6 iterações sem convergir → handoff | Fim do loop |
| Fallback determinístico | Se LLM/JSON/timeout falha → `leads-novos-flow` | Catch externo |

### 3.7 Fallback chain (3 camadas)

```
1. Tawany (LLM + tools)
   ├── sucesso: sendWhatsApp + createActivity + markHandled
   ├── guard_failed: needsHuman + createActivity + markHandled
   ├── tool_error: needsHuman + createActivity + markHandled
   └── exception: ↓
2. leads-novos-flow (LF determinística, Fase 4)
   ├── match: sendWhatsApp (resposta do flow) + markHandled
   └── no_match: ↓
3. needsHuman = true + createActivity "Tawany: sem resposta automática"
   Recepção vê no filtro `needsHuman = true` e assume.
```

### 3.8 Bot determinístico (Fase 4 F)

Porta `flows/leads-novos.bot.js` como LF:

```ts
// src/logic-functions/leads-novos-flow.ts
import leadsNovosRules from '@/lib/prompts/leads-novos-rules.json';  // regras portadas

export default async function leadsNovosFlow({ messageId, originalError }: { messageId: string; originalError?: string }) {
  const msg = await record('message', messageId);
  const conversation = await record('conversation', msg.conversationId);
  const lead = conversation.leadId ? await record('lead', conversation.leadId) : null;

  // Match regras por keywords/intent
  for (const rule of leadsNovosRules) {
    if (rule.match(msg.body, lead)) {
      await sendWhatsApp(conversation.id, rule.response, rule.messageType);
      await createActivity(conversation.id, `leads-novos-flow: ${rule.name}`);
      return;
    }
  }

  // Sem match → handoff
  await setNeedsHuman(conversation.id, `leads-novos no-match (tawany: ${originalError || 'unknown'})`);
  await createActivity(conversation.id, 'Tawany: sem resposta automática');
}
```

Regras JSON portadas de `flows/leads-novos.bot.js` (estrutura atual do Qara — keywords → resposta, messageType, action).

### 3.9 Triggers

```ts
// src/triggers/message-inbound.ts (Fase 1)
export default defineDatabaseEventTrigger({
  name: 'message-inbound-tawany',
  operation: 'created',
  objectName: 'message',
  filter: { direction: 'in', agentHandled: false },
  logicFunctionUniversalIdentifier: '...tawany-handler-uuid...',
});

// src/triggers/message-inbound-async.ts (Fase 1, summarizer paralelo)
export default defineDatabaseEventTrigger({
  name: 'message-inbound-summarizer',
  operation: 'created',
  objectName: 'message',
  filter: { direction: 'in' },
  logicFunctionUniversalIdentifier: '...summarize-conversation-uuid...',
});

// src/triggers/lead-updated.ts (Fase 3)
export default defineDatabaseEventTrigger({
  name: 'lead-updated-scorer',
  operation: 'updated',
  objectName: 'lead',
  filter: { /* re-score quando stage/intent/notes mudam */ },
  logicFunctionUniversalIdentifier: '...lead-scorer-uuid...',
});
```

### 3.10 Observabilidade

- **Activity no record da conversation**: `Tawany respondeu (minimax-m3) • 1.2s • 432 tokens`
- **LF run history** (nativo Twenty): input/output, latência, status, error stack
- **Logs estruturados** (stdout, indexados pelo Render):
  ```json
  {"event": "tawany_run", "messageId": "...", "model": "minimax/minimax-m3", "iterations": 3, "tokens": 1001, "duration_ms": 1234, "status": "replied"}
  ```

---

## 4. UI Integration (Fase 1 D1)

### 4.1 Front-components

#### `whatsapp-inbox` (Fase 1)

Substitui a view nativa de tabela de Conversation por UI chat-style.

**Layout:**
```
┌──────────────┬────────────────────────────────────┐
│ Conversations│ Thread (Maria Silva)               │
│ ──────────── │                                    │
│ 🔴 Maria S.  │ 14:32 Maria: Oi, quero agendar    │
│   há 2min    │ 14:32 🤖 Tawany: Olá! Sou a Tawany│
│ ⚪ João P.   │ 14:33 Maria: Cirurgia de melasma  │
│   há 1h      │ 14:33 🤖 Tawany: Para cirurgia... │
│ 🟢 Carla R.  │ ──────────────────────────────── │
│   ontem      │ [ Reply box: type here... ]        │
│              │ [ Enviar ]                          │
└──────────────┴────────────────────────────────────┘
```

**Features:**
- Sidebar com lista de conversas, filtros (channel, status, needsHuman, assignedTo)
- Thread com bolhas, timestamps, badge "Tawany" / "Humano"
- Reply box com autocomplete de QuickReply (Fase futura)
- Indicador "Tawany digitando..." quando LF rodando
- Botão "Assumir" quando needsHuman=true
- Subscription GraphQL para tempo real

#### `lead-kanban` (Fase 1)

Kanban drag-and-drop do funil.

**Colunas:** novo → qualificado → agendado → compareceu → perdido → convertido
**Card:** nome, whatsapp, score (chip), intent (chip), tags, último contato
**Drag:** atualiza `stage` via mutation; trigger `lead.updated` dispara scorer

#### `tawany-panel` (Fase 1)

Painel lateral direito, abre auto em handoff.

**Conteúdo:** contexto da conversa, última ação Tawany, ações rápidas (Assumir, Cadastrar preço, Ver serviços, Perguntar à Tawany), resumo da conversa.

### 4.2 Command menu items

| Item | Atalho | Contexto | Ação |
|---|---|---|---|
| `tawany-ask` | `Cmd+K` → "Tawany: ..." | Global ou com registro selecionado | Prompt livre p/ Tawany (chat no modal) |
| `quick-actions: convert-lead` | `Cmd+K` → "Converter em paciente" | Lead selecionado | Mutation converte |
| `quick-actions: assign-tag` | `Cmd+K` → "Adicionar tag..." | Lead/Patient/Conversation | Modal de seleção |
| `quick-actions: handoff` | `Cmd+K` → "Marcar p/ humano" | Conversation | Seta needsHuman |
| `quick-actions: resolve` | `Cmd+K` → "Marcar como resolvida" | Conversation | Seta status=resolved |
| `quick-actions: reschedule` | `Cmd+K` → "Reagendar" | Conversation/Patient | (futuro) |

### 4.3 Navigation

| Item | Posição | Abre |
|---|---|---|
| `inbox` | Sidebar principal | `whatsapp-inbox` |
| `pipeline` | Sidebar principal | `lead-kanban` |

### 4.4 Page layouts

| Layout | Aplicado em | Customizações |
|---|---|---|
| `lead-detail` | Record page de Lead | Painel Tawany lateral (resumo + ações), timeline integrado com Activity |
| `conversation-detail` | Record page de Conversation | Thread chat, status badges, handoff actions |

---

## 5. Integração WhatsApp/Instagram (Fase 2 C)

### 5.1 Connection Provider

```ts
// src/connections/meta.ts
export default defineConnectionProvider({
  name: 'meta',
  label: 'Meta (WhatsApp + Instagram)',
  icon: 'IconBrandMeta',
  fields: [
    { name: 'accessToken', type: 'secret', required: true, label: 'WhatsApp Access Token' },
    { name: 'phoneNumberId', type: 'string', required: true, label: 'Phone Number ID' },
    { name: 'verifyToken', type: 'secret', required: true, label: 'Webhook Verify Token' },
    { name: 'appSecret', type: 'secret', required: true, label: 'App Secret (signature)' },
    { name: 'instagramPageAccessToken', type: 'secret', required: false, label: 'Instagram Page Access Token' },
  ],
});
```

### 5.2 Webhook handler (Fase 2)

```ts
// src/logic-functions/meta-webhook.ts
import { verifySignature } from '@/lib/meta-signature';

export default async function metaWebhook(req, res) {
  // 1. Verificar assinatura (X-Hub-Signature-256)
  if (!verifySignature(req.rawBody, req.headers['x-hub-signature-256'], META_APP_SECRET)) {
    return res.status(401).send('Invalid signature');
  }

  // 2. Parse event (WhatsApp ou Instagram)
  const events = parseMetaEvent(req.body);
  for (const event of events) {
    // 3. Dedup por externalId
    const existing = await records('message', { filter: { externalId: event.messageId } });
    if (existing.length > 0) continue;

    // 4. Find or create Conversation
    const conversation = await findOrCreateConversation({
      channel: event.channel,
      externalId: event.from,  // phone ou IG-scoped-id
    });

    // 5. Create Message (inbound)
    await createRecord('message', {
      conversationId: conversation.id,
      direction: 'in',
      body: event.text,
      sentAt: new Date(event.timestamp * 1000),
      externalId: event.messageId,
      messageType: event.type,  // text, button, list, etc
      agentHandled: false,
    });

    // 6. Update conversation.lastMessageAt
    await updateRecord('conversation', conversation.id, {
      lastMessageAt: new Date(),
    });
  }

  res.status(200).send('OK');
}
```

### 5.3 Send client (Fase 2)

```ts
// src/lib/whatsapp-client.ts
import { metaClient } from '@/lib/connections';

export async function sendWhatsApp(conversationId: string, text: string, options?: {
  messageType?: 'text' | 'buttons' | 'list' | 'template';
  buttons?: Array<{ id: string; title: string }>;
  templateName?: string;
  languageCode?: string;
  parameters?: string[];
}) {
  const conv = await record('conversation', conversationId);
  const meta = getConnection('meta');

  const payload = buildMetaPayload(conv, text, options);

  const result = await fetch(`https://graph.facebook.com/v20.0/${meta.phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${meta.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!result.ok) throw new Error(`Meta API error: ${result.status}`);

  const { messages } = await result.json();

  // Cria record outbound
  await createRecord('message', {
    conversationId,
    direction: 'out',
    body: text,
    sentAt: new Date(),
    externalId: messages[0].id,
    messageType: options?.messageType || 'text',
    deliveryStatus: 'sent',
  });

  return messages[0].id;
}
```

### 5.4 Tipos de mensagem suportados

| Tipo | Quando |
|---|---|
| `text` | Default. Texto simples. |
| `buttons` | Até 3 botões de resposta rápida. |
| `list` | Lista de opções (até 10 itens). |
| `template` | Modelo aprovado no WhatsApp Manager. |

### 5.5 Delivery/Read status (Fase 2)

Webhook Meta envia status updates. Handler atualiza `message.deliveryStatus`:

```ts
// No meta-webhook.ts, antes do parse de mensagens:
if (req.body.entry[0].changes[0].value.statuses) {
  for (const status of req.body.entry[0].changes[0].value.statuses) {
    const msg = await records('message', { filter: { externalId: status.id } });
    if (msg[0]) {
      await updateRecord('message', msg[0].id, { deliveryStatus: status.status });
    }
  }
}
```

### 5.6 Multi-canal

Mesmo `conversation` aceita `channel: 'whatsapp' | 'instagram'`. UI mostra ícone por canal. Mesma inbox, threads separadas por canal (mas agregado por lead/patient).

---

## 6. Funil + Scoring + Follow-ups (Fase 3 E)

### 6.1 Lead Scorer

```ts
// src/logic-functions/lead-scorer.ts
const SCORING_RULES = {
  // Heurística determinística primeiro
  heuristic: (lead: Lead, recentMessages: Message[]): number => {
    let score = 50;
    if (lead.intent && lead.intent !== 'outro') score += 15;
    if (recentMessages.some(m => m.body.match(/(agendar|marcar|consulta|horário)/i))) score += 20;
    if (lead.source === 'indicacao') score += 10;
    if (recentMessages.some(m => m.body.match(/(caro|desisti|talvez|não sei)/i))) score -= 15;
    return Math.max(0, Math.min(100, score));
  },

  // Se heurística ambígua (45-65), LLM decide
  llm: async (lead: Lead, recentMessages: Message[]): Promise<{ score: number; reasons: string[] }> => {
    const r = await chat({
      model: process.env.DEFAULT_MODEL_INTERNAL,
      system: CLASSIFIER_PROMPT,
      messages: [{ role: 'user', content: buildScoringPrompt(lead, recentMessages) }],
      responseFormat: { type: 'json', schema: SCORING_SCHEMA },
    });
    return JSON.parse(r.choices[0].message.content);
  },
};

export default async function leadScorer({ leadId }: { leadId: string }) {
  const lead = await record('lead', leadId);
  const convs = await records('conversation', { filter: { leadId } });
  const recentMessages = await records('message', {
    filter: { conversationId: { in: convs.map(c => c.id) } },
    orderBy: { sentAt: 'desc' },
    limit: 10,
  });

  const heuristicScore = SCORING_RULES.heuristic(lead, recentMessages);
  const ambiguous = heuristicScore >= 45 && heuristicScore <= 65;

  let finalScore: number;
  let reasons: string[];

  if (ambiguous) {
    const llmResult = await SCORING_RULES.llm(lead, recentMessages);
    finalScore = llmResult.score;
    reasons = llmResult.reasons;
  } else {
    finalScore = heuristicScore;
    reasons = [`Heurística: ${heuristicScore}`];
  }

  await updateRecord('lead', leadId, {
    score: finalScore,
    scoreReasons: reasons,
  });

  await createActivity(leadId, `Score atualizado: ${finalScore} (${reasons.join(', ')})`);
}
```

### 6.2 Follow-up Engine (cron diário)

```ts
// src/logic-functions/followup-engine.ts
const FOLLOWUP_CATEGORIES = {
  overdue: (task: Task) => task.dueAt && task.dueAt < startOfDay() && task.status === 'pending',
  today:   (task: Task) => task.dueAt && isToday(task.dueAt) && task.status === 'pending',
  upcoming: (task: Task) => task.dueAt && isAfter(task.dueAt, endOfDay()) && isBefore(task.dueAt, addDays(endOfDay(), 7)) && task.status === 'pending',
  noDate:  (task: Task) => !task.dueAt && task.status === 'pending',
};

export default async function followupEngine() {
  // 1. Para cada lead ativo (não convertido, não perdido), determina se precisa follow-up
  const leads = await records('lead', { filter: { stage: { notIn: ['convertido', 'perdido'] } } });
  const today = new Date();

  for (const lead of leads) {
    const daysSinceLastContact = daysBetween(lead.lastContactAt, today);
    const needsFollowUp = daysSinceLastContact >= 3;  // threshold configurável

    if (needsFollowUp && !lead.nextFollowUpAt) {
      // Cria task de follow-up
      const task = await createRecord('task', {
        title: `Follow-up: ${lead.fullName}`,
        description: `Sem contato há ${daysSinceLastContact} dias`,
        dueAt: today,
        category: daysSinceLastContact >= 7 ? 'overdue' : 'today',
        status: 'pending',
        leadId: lead.id,
        assignedToId: lead.assignedToId,
      });

      await updateRecord('lead', lead.id, { nextFollowUpAt: today });
      await createActivity(lead.id, `Follow-up criado: ${task.title}`);
    }
  }

  // 2. Recategoriza tasks existentes
  const tasks = await records('task', { filter: { status: 'pending' } });
  for (const task of tasks) {
    let category: string | null = null;
    for (const [cat, predicate] of Object.entries(FOLLOWUP_CATEGORIES)) {
      if (predicate(task)) { category = cat; break; }
    }
    if (category && task.category !== category) {
      await updateRecord('task', task.id, { category });
    }
  }
}
```

Trigger: cron job (via Render cron ou BullMQ scheduled job) 1x/dia às 8h.

### 6.3 View "Follow-ups" (UI nativa)

View de tabela do `task` object com filtro padrão:
- `status = 'pending'`
- Ordenado por `category` (overdue > today > upcoming > noDate) e `dueAt`
- Colunas: título, lead, categoria (chip colorido), assignedTo, dueAt

Acessível via `Cmd+K` "Ver follow-ups" ou sidebar.

---

## 7. Webhook universal + CSV (Fase 7 I)

### 7.1 Universal webhook

```ts
// src/logic-functions/universal-webhook.ts
// POST /webhook/lead?secret=xxx
// Headers: x-webhook-secret: <LEAD_WEBHOOK_SECRET>
// Body: { nome, whatsapp, email?, origem, mensagem, customFields? }

export default async function universalWebhook(req, res) {
  // 1. Valida secret
  if (req.headers['x-webhook-secret'] !== process.env.LEAD_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid secret' });
  }

  const { nome, whatsapp, email, origem, mensagem, customFields } = req.body;

  // 2. Valida campos obrigatórios
  if (!nome || !whatsapp) {
    return res.status(400).json({ error: 'nome e whatsapp obrigatórios' });
  }

  // 3. Find or create Lead
  let lead = (await records('lead', { filter: { whatsapp } }))[0];
  if (!lead) {
    lead = await createRecord('lead', {
      fullName: nome,
      whatsapp,
      email,
      source: origem || 'outro',
      stage: 'novo',
      ...customFields,
    });
  }

  // 4. Find or create Conversation
  const conv = await findOrCreateConversation({
    channel: 'whatsapp',  // assume WhatsApp; expandir depois
    externalId: whatsapp,
    leadId: lead.id,
  });

  // 5. Create Message (inbound)
  await createRecord('message', {
    conversationId: conv.id,
    direction: 'in',
    body: mensagem || '(sem mensagem)',
    sentAt: new Date(),
    externalId: `webhook-${Date.now()}-${whatsapp}`,
    messageType: 'text',
    agentHandled: false,
  });

  await updateRecord('conversation', conv.id, { lastMessageAt: new Date() });

  // 6. Tawany processa via trigger
  res.status(200).json({ ok: true, leadId: lead.id, conversationId: conv.id });
}
```

### 7.2 CSV Import

```ts
// src/lib/csv-parser.ts
import { parse } from 'csv-parse/sync';

export async function importLeadsCSV(csvBuffer: Buffer): Promise<{ created: number; updated: number; errors: string[] }> {
  const records = parse(csvBuffer, { columns: true, skip_empty_lines: true, trim: true });
  const errors: string[] = [];
  let created = 0;
  let updated = 0;

  for (const [i, row] of records.entries()) {
    try {
      // Validação
      if (!row.Nome || !row.Telefone) {
        errors.push(`Linha ${i + 2}: Nome e Telefone obrigatórios`);
        continue;
      }

      // Normaliza telefone para E.164
      const whatsapp = normalizePhone(row.Telefone);

      // Find or create
      const existing = (await records('lead', { filter: { whatsapp } }))[0];
      if (existing) {
        await updateRecord('lead', existing.id, {
          fullName: row.Nome,
          email: row.Email,
          source: row.Origem || existing.source,
          intent: mapIntent(row.Interesse),
        });
        updated++;
      } else {
        await createRecord('lead', {
          fullName: row.Nome,
          whatsapp,
          email: row.Email,
          source: row.Origem || 'outro',
          intent: mapIntent(row.Interesse),
          stage: 'novo',
        });
        created++;
      }
    } catch (e) {
      errors.push(`Linha ${i + 2}: ${e.message}`);
    }
  }

  return { created, updated, errors };
}
```

UI: Settings → Dados → Importar CSV (upload file → preview → confirma → roda).

### 7.3 CSV Export

Similar, mas reverse. Exporta leads, conversations, tasks, ou appointments para CSV.

---

## 8. Roles/Permissões (Fase 5 G)

### 8.1 Roles

| Role | SystemPermissionFlags | Custom flags |
|---|---|---|
| `ADMIN` | ALL | `MANAGE_TEAM`, `MANAGE_SETTINGS`, `VIEW_REPORTS`, `EXPORT_DATA` |
| `RECEPTION` | `READ_LEAD`, `WRITE_LEAD`, `READ_PATIENT`, `WRITE_PATIENT`, `READ_CONVERSATION`, `WRITE_CONVERSATION`, `READ_MESSAGE`, `WRITE_MESSAGE`, `READ_TASK`, `WRITE_TASK`, `AI` | `HANDOFF_CONVERSATION`, `ASSIGN_LEAD`, `CREATE_APPOINTMENT` |
| `DOCTOR` | `READ_PATIENT`, `READ_LEAD`, `READ_CONVERSATION`, `READ_MESSAGE` | `VIEW_OWN_SCHEDULE`, `MANAGE_OWN_AVAILABILITY` |
| `FINANCE` | `READ_BUDGET`, `WRITE_BUDGET`, `READ_PAYMENT`, `WRITE_PAYMENT`, `READ_PATIENT` | `VIEW_FINANCIAL_REPORTS`, `EXPORT_FINANCIAL` |

Roles de LFs (para tools internas): default role do app com `AI` flag (p/ runAgent).

### 8.2 Row-level security

Twenty suporta via permission flags. Regras:
- DOCTOR só vê patients que têm appointment com ele
- FINANCE só vê patients que têm budget/payment
- RECEPTION vê tudo exceto relatórios financeiros sensíveis
- ADMIN vê tudo

### 8.3 UI Settings → Equipe (Fase 5)

Front-component ou view nativa de User com:
- Lista de usuários
- Role por usuário
- Convite (gera link de signup)
- Edição de role

---

## 9. Deployment & custos

### 9.1 Arquitetura de produção

```
┌─────────────────────────────────────────────────────────────────┐
│                        RENDER (Oregon)                          │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Web Service: twenty-server + twenty-front               │   │
│  │  Plan: Starter ($7/mo) • 1GB RAM • 0.5 CPU              │   │
│  └─────────────────────────────────────────────────────────┘   │
│              │              │              │                    │
│              ▼              ▼              ▼                    │
│  ┌────────────────┐ ┌────────────┐ ┌────────────────┐         │
│  │  Postgres      │ │  Redis     │ │  Disk ephemeral │         │
│  │  Basic 1GB $7  │ │  $7        │ │  (logs)         │         │
│  └────────────────┘ └────────────┘ └────────────────┘         │
└─────────────────────────────────────────────────────────────────┘
              │                               │
              ▼                               ▼
    ┌──────────────────┐            ┌──────────────────┐
    │  OpenRouter API  │            │  Meta Cloud API  │
    │  ~$5-20/mo       │            │  $0-10/mo        │
    └──────────────────┘            └──────────────────┘
```

App em repo separado `qara-clinic` (GitHub), deploy via `yarn twenty sync`.

### 9.2 Variáveis de ambiente

```bash
# Runtime Twenty
APP_SECRET=<openssl rand -hex 32>
NODE_ENV=production
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
LOG_LEVEL=info

# Meta
META_VERIFY_TOKEN=<random>
META_APP_SECRET=<from-dashboard>
WHATSAPP_ACCESS_TOKEN=<permanent>
WHATSAPP_PHONE_NUMBER_ID=<id>
INSTAGRAM_PAGE_ACCESS_TOKEN=<optional>
LEAD_WEBHOOK_SECRET=<openssl rand -hex 32>

# OpenRouter
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_HTTP_REFERER=https://app.qara.com.br
OPENROUTER_APP_NAME=qara-clinic
DEFAULT_MODEL_PATIENT=minimax/minimax-m3
DEFAULT_MODEL_INTERNAL=deepseek/deepseek-chat

# Clínica
CLINIC_NAME=Clínica Qara
CLINIC_UNIT=Copacabana - RJ
DEFAULT_CONSULT_VALUE_CENTS=55000
```

### 9.3 Custo mensal (produção)

| Item | Custo/mês | Notas |
|---|---|---|
| Render Web Service (Starter) | $7 | 1 instância. Upgrade quando > 70% CPU sustentado. |
| Render Postgres Basic 1GB | $7 | Daily backups + PITR. |
| Render Redis Starter | $7 | Sessions + BullMQ. |
| OpenRouter (Tawany) | $5-12 | 500 conversas/mês × 5 msgs × minimax-m3 |
| OpenRouter (Interno) | $3-8 | Scorer diário + summarizer + classifier |
| Meta Cloud API | $0-10 | Free 1k msgs, depois pay-per-message |
| **Total** | **$29-51/mo** | |
| **Com folga 2x** | **$40-75/mo** | |

### 9.4 Comparação com Qara atual

| Item | Qara atual | Twenty + Render |
|---|---|---|
| Servidor | $20-40 (VPS) | $7 (managed) |
| Postgres | $0-15 | $7 (managed, backups) |
| LLM (GPT-4o) | $50-150 | $5-20 (modelos menores) |
| **Total** | **$75-210/mo** | **$29-55/mo** |
| **Economia** | — | **60-75%** |

### 9.5 Backup & DR

| Camada | Como |
|---|---|
| Postgres | Render: daily snapshots + PITR 7 dias. `render pg:backup` manual. |
| Redis | Não persistente. Recriável. |
| Código | GitHub (source of truth). `yarn twenty sync` idempotente. |
| Secrets | Render Dashboard. Rotação a cada 90 dias. |
| RPO/RTO | RPO: 24h. RTO: ~10 min. |

### 9.6 CI/CD (opcional)

```yaml
# .github/workflows/deploy.yml
on: { push: { branches: [main] } }
jobs:
  validate:
    steps: [lint, typecheck, test]
  sync:
    needs: validate
    steps: [yarn twenty sync --remote production]
  smoke:
    needs: sync
    steps: [curl health, bun run test:smoke]
```

---

## 10. Riscos & decisões deferred

### 10.1 Riscos operacionais

| # | Risco | Prob | Imp | Mitigação |
|---|---|---|---|---|
| 1 | OpenRouter outage | Baixa | Alto | Fallback: leads-novos-flow + handoff. Backup opcional: ANTHROPIC_API_KEY. |
| 2 | Tawany alucina info crítica | Média | Alto | Guardrails (schema + price + length + sensitive). Weekly review. |
| 3 | Meta rate limit | Baixa | Médio | BullMQ queue + retry exponencial. |
| 4 | Schema migration quebra workspace | Baixa | Alto | `yarn twenty sync --dry-run` antes. Versionamento. |
| 5 | Webhook sem assinatura (dev) | Alta (dev) | Baixo | ALLOW_UNSIGNED_WEBHOOKS=true em dev. |
| 6 | Custo OpenRouter dispara | Baixa | Médio | Alert se 429 ou custo diário > threshold. LF timeout 10s. |
| 7 | Prompt injection via mensagem | Média | Médio | Skill persona reforça ignorar instruções contrárias. Tool results validados. |
| 8 | LGPD | Baixa | Alto | Sem dado clínico. Workspace isolado por tenant. |
| 9 | Áudio/imagem WhatsApp | Alta | Médio | Tawany ignora, marca needsHuman. (Fase futura) |
| 10 | Resumo desatualizado (summarizer lento) | Baixa | Médio | Summarizer async paralelo. Aceitável ter 1 iteração de atraso. |

### 10.2 Decisões deferred (explícitas, fora do escopo)

- ❌ Financeiro completo (Budget, Payment, relatórios) — Fase 6
- ❌ Audio/image support — Fase 8
- ❌ Multi-clínica (workspaces múltiplos) — quando precisar
- ❌ SSO (Google/Microsoft) — quando precisar
- ❌ A/B testing de prompts — versionamento via git
- ❌ Streaming de resposta — Meta API não aceita
- ❌ Memória跨会话 de longo prazo — só `lead.notes` carrega
- ❌ Fine-tuning — prompt + skills + tools melhor
- ❌ Kommo sync bidirecional — `kommoTag` placeholder
- ❌ Appointment scheduling real (calendário, conflito) — sub-projeto futuro
- ❌ Twilio/Nexmo alternativo ao Meta — fora

---

## 11. Roadmap de implementação

| Fase | Sub-projeto | Depende de | Esforço | Status |
|---|---|---|---|---|
| **1** | A+B+D1 (modelo + Tawany + UI) | — | 3-4 sem | **Esta** |
| **2** | C (WhatsApp/IG) | 1 | 2 sem | Mês 1 |
| **3** | E (Scoring + Follow-ups) | 1, 2 | 2 sem | complete (2026-07-04) |
| **4** | F (Bot determinístico) | 1 | 1 sem | Mês 2 |
| **5** | G (Roles) | 1 | 1 sem | Mês 2 |
| **6** | ~~H (Financeiro)~~ | 1 | 2 sem | Deferred |
| **7** | I (Webhook + CSV) | 1 | 1 sem | Mês 3 |
| **8** | Nice-to-have | vários | contínuo | Deferred |

**Path crítico:** 1 → 2 → 3. Fases 4, 5, 7 paralelizam após 1 estável.

---

## 12. Anexo: glossário

- **Tawany**: persona de secretaria virtual da Clínica Qara, agora agente Twenty.
- **Handoff**: transferência de uma conversa de Tawany para recepção humana.
- **Fallback chain**: Tawany → leads-novos-flow → handoff.
- **Skill**: conteúdo de texto reutilizável (persona, knowledge, classifier).
- **Tool**: função que Tawany pode invocar (read, write, send, handoff).
- **LF (Logic Function)**: função serverless do app que roda em trigger ou cron.
- **Front-component**: componente React rodando dentro do workspace Twenty.
- **OpenRouter**: gateway unificado para 200+ LLMs (OpenAI-compat).
- **Twenty App**: extensão via SDK, vive dentro do workspace, sem fork.

---

**Próximo passo:** self-review do spec → user review → `superpowers:writing-plans`.
