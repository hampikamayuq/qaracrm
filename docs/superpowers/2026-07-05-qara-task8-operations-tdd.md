# Task 8 TDD — Operations Routes

Source plan: `docs/superpowers/plans/2026-07-05-qara-crm-standalone.md`, Task 8.

## User Journeys

- As QARA ops, `leads-novos-flow` imports without `twenty-sdk` and remains unit-tested.
- As a receptionist, `/api/operations/follow-up` sends the approved WhatsApp template only for stale open conversations.
- As QARA ops, `/api/operations/classify` manually classifies a lead message through the existing classifier.
- As delivery infrastructure, `sendWhatsAppTemplate` records a template outbound message and sends through Meta when configured.

## Evidence

| # | What is guaranteed | Test file or command | Result | Evidence |
|---|--------------------|----------------------|--------|----------|
| 1 | RED captured remaining Twenty wrapper in `leads-novos-flow` | `pnpm --filter @qara/api exec vitest run src/logic-functions/leads-novos-flow.test.ts` | FAIL as expected | Missing `twenty-sdk/define` |
| 2 | RED captured missing operations route module | `pnpm --filter @qara/api exec vitest run src/routes/operations-routes.test.ts` | FAIL as expected | Missing `./operations-routes` |
| 3 | Leads Novos fallback still replies, hands off, and records activity | `src/logic-functions/leads-novos-flow.test.ts` | PASS | Task 8 green command |
| 4 | Operations routes send stale follow-ups and call manual classifier | `src/routes/operations-routes.test.ts` | PASS | Task 8 green command |
| 5 | Template tool records outbound template and sends Meta template payload when configured | `src/lib/tools/sendWhatsAppTemplate.test.ts` | PASS | Task 8 green command |
| 6 | Focused Tasks 7-8 regression set remains green | focused vitest command | PASS | 16 files, 120 tests passed |
| 7 | Compilation verification was run | `pnpm --filter @qara/api exec tsc --noEmit --pretty false` | FAIL, documented | Existing global Twenty/TSX/NodeNext blockers remain |

Green command:

```bash
pnpm --filter @qara/api exec vitest run src/lib/tools/sendWhatsAppTemplate.test.ts src/routes/operations-routes.test.ts src/logic-functions/leads-novos-flow.test.ts src/lib/whatsapp-client.test.ts src/lib/tools/tools.test.ts
```

Result: 5 files passed, 38 tests passed.

Implementation note:

- The current Prisma `Conversation` model does not have `lastContactedAt`; follow-up uses `updatedAt` as the 24h cutoff and moves contacted conversations to `PENDING_PATIENT` to avoid repeated sends.
- Repo-wide `tsc --noEmit` is still blocked by legacy Twenty app files, old TSX front-component tests, and NodeNext extension requirements. The new operations routes are covered by focused Vitest tests until the Task 9 app/server cleanup addresses global compilation.
