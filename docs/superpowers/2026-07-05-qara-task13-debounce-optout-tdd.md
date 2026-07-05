# Task 13 TDD - Message Debounce and Opt-out

Source plan: `docs/superpowers/plans/2026-07-05-qara-crm-standalone.md`, Task 13.

## User Journeys

- As QARA ops, rapid-fire messages from the same conversation do not trigger multiple Tawany runs.
- As a patient, sending an opt-out command marks the lead as opted out and sends a confirmation before any AI processing.
- As support, inbound webhook processing still persists Meta messages and statuses.

## Evidence

| # | What is guaranteed | Test file or command | Result | Evidence |
|---|--------------------|----------------------|--------|----------|
| 1 | RED captured missing debounce module | `pnpm --filter @qara/api exec vitest run src/lib/debounce.test.ts src/logic-functions/meta-webhook.test.ts` | FAIL as expected | Missing `./debounce`; webhook still wrote `agentHandled: false` |
| 2 | Debounce returns process, skip, optout, flushes by timer, and isolates conversations | `src/lib/debounce.test.ts` | PASS | 6 tests passed |
| 3 | Meta ingest marks skipped/optout messages as already handled | `src/logic-functions/meta-webhook.test.ts` | PASS | 7 tests passed |
| 4 | Opt-out updates lead + conversation and sends confirmation without logging PHI body | `src/logic-functions/meta-webhook.test.ts` | PASS | `meta_optout` log contains only IDs |
| 5 | Existing webhook/Tawany/tool behavior remains green | focused vitest command | PASS | 9 files, 77 tests passed |
| 6 | Prisma schema remains valid | `pnpm --filter @qara/api exec prisma validate` | PASS | Schema valid |

Green commands:

```bash
pnpm --filter @qara/api exec vitest run src/lib/debounce.test.ts src/logic-functions/meta-webhook.test.ts
pnpm --filter @qara/api exec vitest run src/lib/debounce.test.ts src/logic-functions/meta-webhook.test.ts src/routes/meta-webhook-routes.test.ts src/logic-functions/tawany-handler.test.ts src/routes/tawany-routes.test.ts src/lib/tools/tools.test.ts src/lib/tools/sendWhatsAppTemplate.test.ts src/lib/whatsapp-client.test.ts src/app.test.ts
pnpm --filter @qara/api exec prisma validate
git diff --check
```

Implementation note:

- Integration is in `logic-functions/meta-webhook.ts`, not `routes/meta-webhook-routes.ts`, because this is where the conversation/message IDs exist.
- `conversation.optedOutAt` does not exist in the Prisma schema; the opt-out timestamp is written to the related lead when `leadId` is available.
