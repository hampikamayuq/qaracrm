# QARA CRM — Standalone Migration Design

**Date:** 2026-07-05
**Status:** Approved
**Scope:** Full migration of QARA Clinic CRM from Twenty platform to standalone Express + Prisma + Next.js

---

## 1. Objective

Remove the Twenty platform dependency. The QARA CRM must run as a standalone application with:
- `pnpm install` — install all dependencies
- `pnpm prisma migrate dev` — provision the database
- `pnpm dev` — start API + web dev servers

No Twenty server, no `twenty-sdk`, no `twenty-client-sdk`, no `twenty-ui`, no manifest, no workspace.

---

## 2. File Inventory

### Category A — Reuse unchanged (~30 files, ~4000 LOC)

Pure TypeScript business logic. All use `DataApi` as a clean interface — zero Twenty imports.

| File | Purpose |
|------|---------|
| `src/lib/ai-client.ts` | OpenRouter client, `modelWithFallback`, `createAiClient` |
| `src/lib/guards/reply-validator.ts` | Medical safety: price accuracy, keyword blocklist, length cap |
| `src/lib/classification/schema.ts` | Zod schema: `ClassificationResult`, all enums |
| `src/lib/classification/orchestrator.ts` | `classifyMessage` — LLM call → JSON parse → Zod validate → fallback |
| `src/lib/lead-score/heuristic.ts` | `heuristicScore` — temperatura-based scoring (45-65 ambiguous band) |
| `src/lib/lead-score/llm.ts` | `llmScore` — LLM evaluator for ambiguous band |
| `src/lib/lead-score/orchestrator.ts` | `runLeadScorer` — heuristic → LLM escalation |
| `src/lib/leads-novos/matcher.ts` | `matchLeadsNovosRule` — keyword matching for deterministic fallback |
| `src/lib/leads-novos/rules.ts` | `LEADS_NOVOS_RULES` + `LEADS_NOVOS_RISK_KEYWORDS` |
| `src/lib/meta-parse.ts` | WhatsApp/Instagram webhook payload parser |
| `src/lib/meta-signature.ts` | HMAC-SHA256 verification with timing-safe comparison |
| `src/lib/whatsapp-client.ts` | `buildMetaPayload`, `sendViaMeta` (Meta Graph API) |
| `src/lib/prompts.ts` | `TAWANY_PERSONA_PROMPT`, `QARA_KNOWLEDGE_PROMPT`, `QARA_CLASSIFICATION_PROMPT`, `QARA_SCORE_PROMPT` |
| `src/lib/tools/index.ts` | `tawanyTools.schema` (Zod → OpenAI function format), `tawanyTools.execute` |
| `src/lib/tools/readLead.ts` | Tool: read lead by conversationId |
| `src/lib/tools/readPatient.ts` | Tool: read patient (Contact) by leadId |
| `src/lib/tools/readConversationHistory.ts` | Tool: read last 20 messages |
| `src/lib/tools/listProfessionals.ts` | Tool: list professionals with specialties |
| `src/lib/tools/listServices.ts` | Tool: list services with prices |
| `src/lib/tools/searchKnowledge.ts` | Tool: search knowledge base (QARA_KNOWLEDGE_PROMPT) |
| `src/lib/tools/updateLead.ts` | Tool: update lead score, intent, notes |
| `src/lib/tools/updateConversation.ts` | Tool: update conversation stage, tags |
| `src/lib/tools/assignTag.ts` | Tool: assign tag to lead |
| `src/lib/tools/createActivity.ts` | Tool: create timeline note on lead/patient/conversation |
| `src/lib/tools/handoffToHuman.ts` | Tool: set conversation to NEEDS_HUMAN |
| `src/lib/tools/sendWhatsApp.ts` | Tool: send WhatsApp message (internal-only, not exposed to LLM) |
| `src/lib/tawany/prompt-builder.ts` | `buildMessages`, `buildSystemPrompt` |
| `src/lib/tawany/context.ts` | `buildTawanyContext` — loads conversation, lead, messages, prices |
| `src/lib/handoff.ts` | `handoff(conversationId, reason, data)` — sets NEEDS_HUMAN, creates note |
| `src/lib/ai-run-log.ts` | `recordAiRun(data, input)` — best-effort audit logging |
| `src/lib/followup/categorize.ts` | `categorizeTask`, `daysSince` |
| `src/lib/followup/grouping.ts` | Task grouping by category |
| `src/lib/seed/seed.ts` | Seed: units, professionals, services with prices |
| Test files | `heuristic.test.ts`, `llm.test.ts`, `orchestrator.test.ts`, `matcher.test.ts`, `categorize.test.ts`, `tools.test.ts`, `dashboard.test.ts` |

### Category B — Reuse with Twenty dep removal (~150 LOC across 6 files)

| File | Change |
|------|--------|
| `src/lib/data.ts` | **REPLACE.** Swap `CoreApiClient` for Prisma implementation of `DataApi` |
| `src/logic-functions/tawany-handler.ts` | Remove `defineLogicFunction` wrapper (lines 323-336). `runTawany` + `runTawanyHandler` already exported |
| `src/logic-functions/meta-webhook.ts` | Remove `defineLogicFunction` wrapper. Extract `handleMetaWebhook` |
| `src/logic-functions/leads-novos-flow.ts` | Remove `defineLogicFunction` wrapper. `runLeadsNovosFlow` already exported |
| `src/logic-functions/qara-classifier.ts` | Remove `defineLogicFunction` wrapper. Extract `runQaraClassifier` |
| `src/logic-functions/lead-scorer.ts` | Remove `defineLogicFunction` wrapper. Extract handler |

### Category C — Reference only

| Source | Informs |
|--------|---------|
| `src/objects/*.ts` | Prisma model fields, enums, relations |
| `src/fields/*.ts` | Prisma field types, validations |
| `src/views/*.ts` | UI layout, columns, filters |
| `src/navigation-menu-items/*.ts` | Next.js routing structure |
| `src/page-layouts/*.ts` | UI page layout patterns |
| `src/front-components/*.tsx` | UI component patterns (Twenty-specific, don't reuse code) |
| `src/skills/*.ts` | AI prompts are reusable |
| `src/agents/tawany.agent.ts` | Agent config, prompts reusable |

### Category D — Discard

| Directory | Reason |
|-----------|--------|
| `src/application-config.ts` | Twenty app manifest |
| `src/default-role.ts` | Twenty role definition |
| `src/command-menu-items/*.ts` | Twenty command palette |
| `src/__tests__/*` | Twenty-specific test harness |

---

## 3. Architecture

### Monorepo Structure

```
qara-crm/
├── apps/
│   ├── api/                        # Express + TypeScript + Prisma
│   │   ├── src/
│   │   │   ├── lib/
│   │   │   │   ├── data.ts             # Prisma DataApi implementation
│   │   │   │   ├── ai-client.ts        # → copy from qara-clinic
│   │   │   │   ├── guards/             # → copy from qara-clinic
│   │   │   │   ├── classification/     # → copy from qara-clinic
│   │   │   │   ├── lead-score/         # → copy from qara-clinic
│   │   │   │   ├── leads-novos/        # → copy from qara-clinic
│   │   │   │   ├── meta-parse.ts       # → copy from qara-clinic
│   │   │   │   ├── meta-signature.ts   # → copy from qara-clinic
│   │   │   │   ├── whatsapp-client.ts  # → copy from qara-clinic
│   │   │   │   ├── prompts.ts          # → copy from qara-clinic
│   │   │   │   ├── tools/              # → copy from qara-clinic
│   │   │   │   ├── tawany/             # → copy from qara-clinic
│   │   │   │   ├── handoff.ts          # → copy from qara-clinic
│   │   │   │   ├── ai-run-log.ts       # → copy from qara-clinic
│   │   │   │   ├── followup/           # → copy from qara-clinic
│   │   │   ├── routes/
│   │   │   │   ├── webhooks/
│   │   │   │   │   ├── meta.ts             # GET (verify) + POST (handle)
│   │   │   │   ├── messages.ts             # Tawany handler integration
│   │   │   │   ├── pipeline.ts             # Pipeline CRUD
│   │   │   │   ├── contacts.ts             # Contact CRUD
│   │   │   ├── agents/
│   │   │   │   ├── operational.ts          # Task 6: OperationalAgent
│   │   │   ├── seed.ts                     # → copy from qara-clinic
│   │   │   ├── index.ts                    # Express app setup
│   │   ├── prisma/
│   │   │   ├── schema.prisma               # Task 3
│   │   │   ├── migrations/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   ├── web/                        # Next.js + shadcn/ui + Tailwind
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── page.tsx               # Redirect to /inbox
│   │   │   │   ├── inbox/
│   │   │   │   │   ├── page.tsx           # Task 7: Inbox
│   │   │   │   ├── pipeline/
│   │   │   │   │   ├── page.tsx           # Task 8: Kanban
│   │   │   │   ├── api/                   # Next.js API routes (proxy to API)
│   │   │   ├── components/
│   │   │   │   ├── inbox/
│   │   │   │   │   ├── ConversationList.tsx
│   │   │   │   │   ├── MessageThread.tsx
│   │   │   │   │   ├── ReplyBox.tsx
│   │   │   │   │   ├── TawanySuggestion.tsx
│   │   │   │   │   ├── ContactSidebar.tsx
│   │   │   │   ├── pipeline/
│   │   │   │   │   ├── KanbanBoard.tsx
│   │   │   │   │   ├── StageColumn.tsx
│   │   │   │   │   ├── LeadCard.tsx
│   │   │   │   │   ├── LeadDrawer.tsx
│   │   │   │   ├── ui/                    # shadcn/ui components
│   │   │   ├── hooks/
│   │   │   │   ├── use-conversations.ts
│   │   │   │   ├── use-messages.ts
│   │   │   │   ├── use-pipeline.ts
│   │   │   │   ├── use-contacts.ts
│   │   │   ├── lib/
│   │   │   │   ├── api-client.ts          # Fetch wrapper for API calls
│   │   ├── package.json
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   ├── package.json                # Root workspace config
├── packages/
│   ├── shared/                     # Shared types and utilities
│   │   ├── src/
│   │   │   ├── types.ts            # ClassificationResult, PipelineStage, etc.
│   │   │   ├── constants.ts        # Pipeline stages, tag enums, etc.
│   │   ├── package.json
├── pnpm-workspace.yaml
├── package.json                    # Root: scripts only
```

### Data Flow

```
Meta WhatsApp → POST /webhooks/meta
  → verifyMetaSignature()
  → parseMetaEvent()
  → upsert Contact (by phone)
  → findOrCreate Conversation
  → create ChatMessage (direction: IN, externalId: wamid)
  → await runTawanyHandler(message, { data })
    → gate: conversation OPEN? not NEEDS_HUMAN?
    → runTawany → AI chat loop → guard
    → AiSuggestion.create (riskLevel, body)
    → if riskLevel=low AND autopilot: sendWhatsApp, AiSuggestion.approved=true
    → if riskLevel=medium/high: handoff → NEEDS_HUMAN
    → runQaraClassifier → write tags to Lead
    → runLeadScorer → write score to Lead
  → return 200 OK

UI → GET /api/conversations → TanStack Query → Inbox list
UI → POST /api/messages/suggest → runTawany → AiSuggestion
UI → POST /api/messages/suggest/:id/approve → sendWhatsApp → ChatMessage (OUT)
UI → POST /api/messages/reply → sendWhatsApp → ChatMessage (OUT)
```

### DataApi Interface (unchanged)

```typescript
type DataApi = {
  get(object: string, id: string, select?: Record<string, boolean>): Promise<Record<string, unknown> | null>;
  list(object: string, options?: { filter?: Record<string, unknown>; orderBy?: Record<string, string>; limit?: number; select?: Record<string, boolean> }): Promise<Record<string, unknown>[]>;
  create(object: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  update(object: string, id: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
};
```

The Prisma implementation maps `object` names to Prisma models:
- `contact` → `prisma.contact`
- `conversation` → `prisma.conversation`
- `chatMessage` → `prisma.chatMessage`
- `leadPipelineState` → `prisma.leadPipelineState`
- `task` → `prisma.task`
- `appointment` → `prisma.appointment`
- `quote` → `prisma.quote`
- `internalNote` → `prisma.internalNote`
- `auditLog` → `prisma.auditLog`
- `aiRunLog` → `prisma.aiRunLog`

---

## 4. Prisma Models (Task 3)

```prisma
model User {
  id        String   @id @default(uuid())
  name      String
  email     String   @unique
  role      String   // "admin" | "recepcao" | "medico" | "financeiro" | "marketing" | "agente_ia"
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  tasks     Task[]
}

model Session {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  token     String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())
}

model Contact {
  id          String   @id @default(uuid())
  name        String
  phone       String   @unique
  email       String?
  type        String   @default("lead")   // "lead" | "patient"
  status      String   @default("active") // "active" | "inactive" | "archived"
  source      String?                      // "pagina-site" | "anuncio" | "instagram" | "doctoralia" | "indicacao" | "retorno-direto"
  tags        String[] @default([])
  notes       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  conversations Conversation[]
  leads          LeadPipelineState[]
}

model Conversation {
  id              String   @id @default(uuid())
  contactId       String
  contact         Contact  @relation(fields: [contactId], references: [id])
  channel         String   @default("whatsapp")   // "whatsapp" | "instagram"
  externalId      String?                         // WhatsApp phone number
  status          String   @default("OPEN")        // "OPEN" | "PENDING_PATIENT" | "PENDING_HUMAN" | "NEEDS_HUMAN" | "RESOLVED" | "CLOSED"
  needsHuman      Boolean  @default(false)         // Convenience flag, kept for backward compat
  currentStage    String?                          // "novo-lead" | "qualificado" | "horario-oferecido" | "agendado" | "confirmado" | "atendido" | "reagendado" | "perdido" | "alta-manutencao"
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  messages       ChatMessage[]
  leadPipeline   LeadPipelineState[]
  internalNotes  InternalNote[]
  aiSuggestions  AiSuggestion[]
}

model ChatMessage {
  id              String   @id @default(uuid())
  conversationId  String
  conversation    Conversation @relation(fields: [conversationId], references: [id])
  direction       String       // "IN" | "OUT"
  body            String
  externalId      String?      // WhatsApp message ID (dedup)
  agentHandled    Boolean  @default(false)
  metadata        Json?        // delivery status, media info, etc.
  sentAt          DateTime @default(now())
  createdAt       DateTime @default(now())

  @@unique([conversationId, externalId])
  @@index([conversationId, sentAt])
}

model AiSuggestion {
  id              String   @id @default(uuid())
  conversationId  String
  conversation    Conversation @relation(fields: [conversationId], references: [id])
  messageId       String?      // ChatMessage.id that triggered this suggestion
  model           String?
  body            String
  riskLevel       String?      // "low" | "medium" | "high"
  approved        Boolean  @default(false)
  sent            Boolean  @default(false)
  createdAt       DateTime @default(now())
}

model PipelineStage {
  id     String @id
  name   String
  order  Int
}

model LeadPipelineState {
  id              String   @id @default(uuid())
  contactId       String
  contact         Contact  @relation(fields: [contactId], references: [id])
  conversationId  String?
  conversation    Conversation? @relation(fields: [conversationId], references: [id])
  pipeline        String   @default("6-dermatologia-clinica")
  stage           String   @default("novo-lead")
  score           Int      @default(50)
  scoreReasons    String[] @default([])
  intent          String?
  temperatura     String?  // "COLD" | "WARM" | "HOT"
  prioridade      String?  // "P1" | "P2" | "P3" | "P4"
  medicoIndicado  String?
  unidade         String?
  tags            String[] @default([])
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model Task {
  id            String   @id @default(uuid())
  title         String
  description   String?
  status        String   @default("TODO") // "TODO" | "pending" | "DONE" | "CANCELLED"
  priority      String   @default("P3")   // "P1" | "P2" | "P3" | "P4"
  contactId     String?
  contact       Contact? @relation(fields: [contactId], references: [id])
  leadId        String?
  lead          LeadPipelineState? @relation(fields: [leadId], references: [id])
  dueAt         DateTime?
  assignedToId  String?
  assignedTo    User?    @relation(fields: [assignedToId], references: [id])
  tags          String[] @default([])
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model Appointment {
  id          String   @id @default(uuid())
  contactId   String
  contact     Contact  @relation(fields: [contactId], references: [id])
  leadId      String?
  lead        LeadPipelineState? @relation(fields: [leadId], references: [id])
  date        DateTime
  duration    Int      @default(30) // minutes
  type        String   @default("presencial") // "presencial" | "teleconsulta"
  status      String   @default("scheduled") // "scheduled" | "confirmed" | "completed" | "cancelled" | "no-show"
  professional String?
  unit        String?
  notes       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model Quote {
  id          String   @id @default(uuid())
  contactId   String
  contact     Contact  @relation(fields: [contactId], references: [id])
  leadId      String?
  lead        LeadPipelineState? @relation(fields: [leadId], references: [id])
  amount      Int               // cents
  procedure   String
  status      String   @default("pending") // "pending" | "sent" | "approved" | "rejected"
  notes       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model InternalNote {
  id              String   @id @default(uuid())
  conversationId  String?
  conversation    Conversation? @relation(fields: [conversationId], references: [id])
  contactId       String?
  contact         Contact? @relation(fields: [contactId], references: [id])
  body            String
  createdAt       DateTime @default(now())
}

model AuditLog {
  id          String   @id @default(uuid())
  entity      String   // "lead" | "conversation" | "contact" | "task"
  entityId    String
  action      String   // "created" | "updated" | "deleted" | "scored" | "classified" | "handoff" | "agent_action"
  agent       String?  // "tawany" | "operational-agent" | "human"
  details     Json?
  createdAt   DateTime @default(now())
}

model AiRunLog {
  id              String   @id @default(uuid())
  layer           String   // "tawany" | "qara-classifier" | "lead-scorer" | "operational-agent"
  model           String?
  fallbackUsed    Boolean  @default(false)
  latencyMs       Int?
  success         Boolean
  validationPass  Boolean?
  reason          String?
  conversationId  String?
  messageId       String?
  createdAt       DateTime @default(now())
}
```

---

## 5. Meta Webhook (Task 4)

**Route:** `GET /webhooks/meta` — hub challenge verification
**Route:** `POST /webhooks/meta` — event processing

```typescript
// apps/api/src/routes/webhooks/meta.ts
// Flow:
// 1. verifyMetaSignature(rawBody, x-hub-signature-256, META_APP_SECRET)
// 2. parseMetaEvent(body) → normalized event
// 3. If status event (SENT/DELIVERED/READ): update chatMessage metadata
// 4. If message event:
//    a. upsert Contact by phone (create if new, update if existing)
//    b. findOrCreate Conversation by channel + externalId
//    c. create ChatMessage (direction: IN, externalId: wamid)
//    d. await runTawanyHandler(message, { data })
// 5. Return 200 OK
```

Handler functions from `meta-webhook.ts` are reused directly. Only the `defineLogicFunction` wrapper is removed.

---

## 6. Tawany Handler (Task 5)

**Route:** `POST /api/messages/suggest` — generate AI suggestion (default)
**Route:** `POST /api/messages/reply` — human sends a reply (from UI)
**Internal:** Triggered after webhook message creation

### Human Approval Flow (default)

```
Patient message → runTawanyHandler()
  → runTawany() → AI chat loop → guard → AiSuggestion.create (NOT sent)
  → runQaraClassifier → write tags to Lead
  → runLeadScorer → write score to Lead
  → set agentHandled = true

Human reviews AiSuggestion in Inbox UI
  → "Approve & Send" → sendWhatsApp → ChatMessage.create (OUT) → AiSuggestion.approved=true, sent=true
  → "Edit & Send" → edit body → sendWhatsApp → ChatMessage.create (OUT) → AiSuggestion.approved=true, sent=true
  → "Skip" → human writes own reply → ChatMessage.create (OUT)
```

### Autopilot (future, risk-gated)

When autopilot is enabled AND `riskLevel = "low"`:
```
Patient message → runTawanyHandler()
  → runTawany() → AI chat loop → guard (riskLevel=low)
  → sendWhatsApp → ChatMessage.create (OUT)
  → AiSuggestion.create (approved=true, sent=true)
```

When `riskLevel = "medium"` or `"high"`:
```
  → handoff → Conversation.status = NEEDS_HUMAN
  → AiSuggestion.create (riskLevel, approved=false)
```

### Code

```typescript
// apps/api/src/routes/messages.ts
// POST /api/messages/suggest — generate AI suggestion for a conversation
//   → runTawany() → guard → AiSuggestion.create → return suggestion
//
// POST /api/messages/suggest/:id/approve — approve and send an AiSuggestion
//   → sendViaMeta → ChatMessage.create (OUT) → AiSuggestion update
//
// POST /api/messages/reply — human sends a reply
//   → create ChatMessage (direction: OUT)
//   → sendViaMeta (WhatsApp Cloud API)
//   → return 200

// apps/api/src/lib/tawany-handler.ts (adapted from qara-clinic)
// runTawany(params, deps) — agent loop (unchanged)
// runTawanyHandler(message, deps) — handler wrapper (unchanged)
//   → gate: conversation OPEN + not NEEDS_HUMAN
//   → runTawany → reply → guard → AiSuggestion.create (or sendWhatsApp if autopilot)
//   → runQaraClassifier → write tags
//   → runLeadScorer → write score
//   → set agentHandled = true
```

All Category A files are copied into `apps/api/src/lib/`. The `DataApi` is the Prisma implementation. The agent loop, classification, scoring, guard, tools, prompts — all unchanged.

---

## 7. Operational Agent (Task 6)

**New file:** `apps/api/src/agents/operational.ts`

```typescript
// Runs as a cron job or manual trigger.
// Model: DeepSeek V4 Pro via OpenRouter, fallback to OpenRouter's default.
//
// Input: list of conversations with status OPEN, sorted by last activity.
// For each conversation:
//   1. Summarize recent messages (last 50)
//   2. Check for missed opportunities (hot lead, no reply in 24h)
//   3. Check for operational risks (overdue tasks, stale pipeline)
//   4. Suggest pipeline stage changes
//   5. Suggest tasks to create
//   6. Suggest tags to add/remove
//   7. Log all actions to AuditLog
//
// MUST NOT: send messages to patients, change conversation status,
//           modify lead scores directly (only suggest).
//
// Each action is logged as: { entity, entityId, action, agent, details }
```

---

## 8. Inbox UI (Task 7)

**Route:** `/inbox`

Components:
- `ConversationList` — left panel, sorted by last activity, filter by status/stage
- `MessageThread` — center panel, scrollable message history
- `ReplyBox` — textarea + send button
- `TawanySuggestion` — AI-generated reply preview, approve/send button
- `ContactSidebar` — right panel, contact info, tags, score, pipeline stage
- Handoff button — sets conversation to NEEDS_HUMAN

Data flow:
- `useConversations()` — TanStack Query → `GET /api/conversations`
- `useMessages(conversationId)` — TanStack Query → `GET /api/conversations/:id/messages`
- Reply → `POST /api/messages/reply`
- Tawany suggestion → `POST /api/messages/suggest`
- Handoff → `POST /api/conversations/:id/handoff`

---

## 9. Pipeline UI (Task 8)

**Route:** `/pipeline`

Components:
- `KanbanBoard` — horizontal scroll of stage columns
- `StageColumn` — droppable column, lead cards
- `LeadCard` — draggable card, name, last message, score, temperature badge, tags
- `LeadDrawer` — slide-over drawer with full lead details, message history, actions

Data flow:
- `usePipeline()` — TanStack Query → `GET /api/pipeline`
- Drag-and-drop → `PATCH /api/pipeline/:id` (update stage)
- Click card → `LeadDrawer` loads full lead data

---

## 10. Twenty Call Replacement (Task 9)

Single point of change: `apps/api/src/lib/data.ts`.

The Prisma `DataApi` implementation:

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MODEL_MAP: Record<string, keyof PrismaClient> = {
  contact: 'contact',
  conversation: 'conversation',
  chatMessage: 'chatMessage',
  leadPipelineState: 'leadPipelineState',
  task: 'task',
  appointment: 'appointment',
  quote: 'quote',
  internalNote: 'internalNote',
  auditLog: 'auditLog',
  aiRunLog: 'aiRunLog',
  aiSuggestion: 'aiSuggestion',
  user: 'user',
  note: 'internalNote',     // Twenty compat: "note" → InternalNote
  noteTarget: 'internalNote', // Twenty compat: note targets are embedded in InternalNote
};

export const createDataApi = (): DataApi => ({
  async get(object, id, select) {
    const model = MODEL_MAP[object];
    if (!model) throw new Error(`Unknown object: ${object}`);
    const record = await (prisma[model] as any).findUnique({
      where: { id },
      select: select ?? undefined,
    });
    return record ?? null;
  },
  async list(object, options) {
    const model = MODEL_MAP[object];
    if (!model) throw new Error(`Unknown object: ${object}`);
    return (prisma[model] as any).findMany({
      where: options?.filter ?? undefined,
      orderBy: options?.orderBy ?? undefined,
      take: options?.limit ?? undefined,
      select: options?.select ?? undefined,
    });
  },
  async create(object, data) {
    const model = MODEL_MAP[object];
    if (!model) throw new Error(`Unknown object: ${object}`);
    return (prisma[model] as any).create({ data });
  },
  async update(object, id, data) {
    const model = MODEL_MAP[object];
    if (!model) throw new Error(`Unknown object: ${object}`);
    return (prisma[model] as any).update({ where: { id }, data });
  },
});
```

All Category A files use this interface. No changes needed to business logic.

### Phase 2: Typed Repositories

The `MODEL_MAP` with `(prisma[model] as any)` is a migration accelerator, not a long-term pattern. After Phase 1 migration is stable, replace critical data access points with typed repositories:

```typescript
// apps/api/src/lib/repositories/contact.ts
export const contactRepo = {
  findByPhone: (phone: string) => prisma.contact.findUnique({ where: { phone } }),
  upsertByPhone: (phone: string, data: Partial<Contact>) =>
    prisma.contact.upsert({ where: { phone }, create: { phone, ...data }, update: data }),
  findById: (id: string) => prisma.contact.findUnique({ where: { id } }),
  // ...
}

// apps/api/src/lib/repositories/conversation.ts
// apps/api/src/lib/repositories/message.ts
// apps/api/src/lib/repositories/pipeline.ts
// apps/api/src/lib/repositories/task.ts
```

This eliminates silent bugs from wrong field names, enables IDE autocompletion, and makes the Prisma schema the single source of truth for field names.

---

## 11. Tests (Task 10)

Minimal tests, focused on the critical paths:

```typescript
// apps/api/src/__tests__/webhook.test.ts
// - verifyMetaSignature with valid/invalid signatures
// - parseMetaEvent with text/button/interactive/image messages
// - Contact upsert by phone
// - Conversation findOrCreate

// apps/api/src/__tests__/tawany.test.ts
// - Tawany response JSON structure
// - reply-validator: passes safe replies, blocks dangerous ones
// - Guard: price validation, keyword blocking, length limit

// apps/api/src/__tests__/lead-scorer.test.ts
// - heuristicScore: HOT → high score, COLD → low score
// - runLeadScorer: heuristic path for clear scores, LLM path for ambiguous

// apps/api/src/__tests__/operational.test.ts
// - OperationalAgent action generation structure
// - Action types: suggest_stage, create_task, add_tag, flag_risk
// - AuditLog entries created for each action
```

---

## 12. Execution Order

| # | Task | Depends on | Verifiable by |
|---|------|-----------|---------------|
| 1 | Inventory | — | ✅ Done |
| 2 | Scaffold monorepo | 1 | `pnpm install` succeeds |
| 3 | Prisma models + migrate | 2 | `pnpm prisma migrate dev` creates tables |
| 4 | DataApi Prisma impl | 3 | `createDataApi().get('contact', id)` works |
| 5 | Auth (User, Session, JWT) | 3 | Login → token → access protected route |
| 6 | Meta webhook route | 4 | `curl POST /webhooks/meta` with test payload |
| 7 | Tawany handler + AiSuggestion | 4, 6 | Send WhatsApp → AiSuggestion created |
| 8 | Operational agent | 4 | Manual trigger → audit log entries |
| 9 | Inbox UI | 5, 7 | Login → see conversations, approve suggestion |
| 10 | Pipeline UI | 5 | Drag-and-drop cards between stages |
| 11 | Shadow mode activation | 6-9 | CRM novo gera respostas sem enviar (3 dias) |
| 12 | Tests | 6-10 | `pnpm test` passes

---

## 13. Commands

```bash
# Install
pnpm install

# Database
pnpm prisma migrate dev
pnpm prisma generate

# Dev
pnpm dev                    # Starts API (port 3001) + Web (port 3000)

# Test
pnpm test

# Seed
pnpm --filter @qara/api seed
```

---

## 14. Environment Variables

```env
# Database
DATABASE_URL="postgresql://localhost:5432/qara-crm"

# OpenRouter
OPENROUTER_API_KEY="sk-or-..."
OPENROUTER_BASE_URL="https://openrouter.ai/api/v1"

# Models
DEFAULT_MODEL_PATIENT="minimax/minimax-m3"
DEFAULT_MODEL_PATIENT_FALLBACK="z-ai/glm-5.2"
DEFAULT_MODEL_INTERNAL="deepseek/deepseek-v4-pro"
DEFAULT_MODEL_INTERNAL_FALLBACK="openrouter/auto"

# Meta
META_APP_SECRET="..."
META_ACCESS_TOKEN="..."
META_PHONE_NUMBER_ID="..."
META_VERIFY_TOKEN="qara-verify-token"

# App
API_PORT=3001
WEB_URL="http://localhost:3000"

# Auth
JWT_SECRET="..."
SESSION_EXPIRY_HOURS=24
```

---

## 15. Corrections Applied (Post-Review)

### 15.1 Model IDs OpenRouter — Corrigido

```env
DEFAULT_MODEL_PATIENT="minimax/minimax-m3"
DEFAULT_MODEL_PATIENT_FALLBACK="z-ai/glm-5.2"
DEFAULT_MODEL_INTERNAL="deepseek/deepseek-v4-pro"
DEFAULT_MODEL_INTERNAL_FALLBACK="openrouter/auto"
```

Fonte: [OpenRouter](https://openrouter.ai/minimax/minimax-m3)

### 15.2 Autenticação e Permissões — Adicionado

Modelos criados: `User`, `Session`. Perfis mínimos:

| Perfil | Acesso |
|--------|--------|
| `admin` | Tudo |
| `recepcao` | Inbox, Pipeline, Contatos, Agendamentos |
| `medico` | Pipeline (próprio), Contatos, Agendamentos |
| `financeiro` | Quotes, Pipeline |
| `marketing` | Inbox, Pipeline, Contatos (leitura) |
| `agente_ia` | Conversations, Messages, Leads (API only) |

Nenhum dado de paciente, conversa ou financeiro é acessível sem autenticação.

### 15.3 Human Approval Mode — Adicionado

Modelo `AiSuggestion` criado. Fluxo padrão:

1. Paciente envia mensagem
2. Tawany gera sugestão → `AiSuggestion.create`
3. Safety validator classifica risco (`low` | `medium` | `high`)
4. Se `low` + autopilot habilitado → enviar direto
5. Se autopilot desabilitado → aguardar aprovação humana na UI
6. Se `medium`/`high` → `NEEDS_HUMAN`

### 15.4 Deduplicação de Webhook — Adicionado

Em `ChatMessage`:
```prisma
@@unique([conversationId, externalId])
@@index([conversationId, sentAt])
```

Evita mensagem duplicada quando a Meta reenviar webhook.

### 15.5 Postgres Obrigatório — Mantido

Postgres é o único banco suportado. Motivo: mensagens em alto volume, arrays, JSON, auditoria, múltiplos usuários, filtros, relatórios, integrações futuras.

### 15.6 User com Relação Formal — Adicionado

`Task.assignedToId` → relação `User` (substitui `assignedTo: String?`). Modelo `User` com `role`, `active`, relações.

---

## 16. Shadow Mode (Migração Segura)

Antes do corte final do Twenty, executar em shadow mode por 3-7 dias:

```
Fase A — Shadow (dias 1-3):
  - Twenty continua funcionando normalmente
  - CRM novo recebe cópia das mensagens (webhook duplicado ou forward)
  - CRM novo gera resposta, mas NÃO envia
  - Comparar comportamento: Tawany resposta, classificação, score
  - Logar divergências

Fase B — Human Approval (dias 4-7):
  - Twenty ainda ativo
  - CRM novo com AiSuggestion + human approval
  - Equipe aprova/envia pelo CRM novo (não pelo Twenty)
  - Validar fluxo completo: webhook → Tawany → sugestão → aprovação → envio

Fase C — Corte (dia 8+):
  - Desativar webhook do Twenty
  - Ativar autopilot parcial (riskLevel=low apenas)
  - Monitorar 48h antes de expandir autopilot
```

---

## 17. Execution Order (Updated)

| # | Task | Depends on | Verifiable by |
|---|------|-----------|---------------|
| 1 | Inventory | — | ✅ Done |
| 2 | Scaffold monorepo + pnpm workspace + TS configs | 1 | `pnpm install` succeeds |
| 3 | Prisma models + migrate | 2 | `pnpm prisma migrate dev` creates all tables |
| 4 | DataApi Prisma implementation | 3 | `createDataApi().get('contact', id)` works |
| 5 | Auth (User, Session, JWT, middleware) | 3 | Login → token → access protected route |
| 6 | Meta webhook route | 4, 5 | `curl POST /webhooks/meta` with test payload |
| 7 | Tawany handler + AiSuggestion + human approval | 4, 6 | Send WhatsApp → AiSuggestion created |
| 8 | Operational agent | 4 | Manual trigger → audit log entries |
| 9 | Inbox UI | 5, 7 | Login → see conversations, approve suggestion |
| 10 | Pipeline UI | 5 | Drag-and-drop cards between stages |
| 11 | Shadow mode activation | 6-9 | CRM novo generates replies without sending (3 days) |
| 12 | Tests | 6-10 | `pnpm test` passes |

## 18. Final Hardening Before Implementation

### 18.1 Contact identity

`Contact.phone` works for WhatsApp, but the CRM must support Instagram, Doctoralia, website forms and email. Add `ContactIdentity`:

```prisma
model ContactIdentity {
  id          String   @id @default(uuid())
  contactId   String
  contact     Contact  @relation(fields: [contactId], references: [id])
  channel     String
  externalId  String
  createdAt   DateTime @default(now())

  @@unique([channel, externalId])
}