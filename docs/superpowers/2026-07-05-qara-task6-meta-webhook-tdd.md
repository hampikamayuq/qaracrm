# Task 6 TDD — Meta Webhook

Source plan: `docs/superpowers/plans/2026-07-05-qara-crm-standalone.md`, Task 6.

## User Journeys

- As Meta, I can verify the webhook with the configured verify token.
- As Meta, I can POST WhatsApp events and receive `200` immediately after the payload is persisted.
- As QARA ops, duplicate Meta retries with the same signature do not create duplicate processing.
- As QARA ops, signed webhooks fail closed when `META_APP_SECRET` is configured.

## Evidence

| # | What is guaranteed | Test file or command | Result | Evidence |
|---|--------------------|----------------------|--------|----------|
| 1 | GET verification accepts the correct token and rejects the wrong token | `src/routes/meta-webhook-routes.test.ts` | PASS | `pnpm --filter @qara/api exec vitest run src/lib/webhook-dedup.test.ts src/routes/meta-webhook-routes.test.ts src/logic-functions/meta-webhook.test.ts` |
| 2 | POST persists `WebhookEvent` before async processing and returns `{ success: true }` | `src/routes/meta-webhook-routes.test.ts` | PASS | same command |
| 3 | Signature-based dedup checks `source + signature` inside a 5-minute window and skips persistence | `src/lib/webhook-dedup.test.ts`, `src/routes/meta-webhook-routes.test.ts` | PASS | same command |
| 4 | `META_APP_SECRET` rejects missing or invalid signatures before persistence | `src/routes/meta-webhook-routes.test.ts` | PASS | same command |
| 5 | Event processing still creates inbound messages and applies delivery statuses | `src/logic-functions/meta-webhook.test.ts` | PASS | same command |

RED note: the existing route tests initially failed because `supertest` tried to bind a socket and the sandbox rejected `listen EPERM`. The test was rewritten to call exported route handlers directly, then extended to cover dedup and fail-closed signature behavior.

Known gaps:

- `pnpm --filter @qara/api build` still fails because the migration tree still includes legacy Twenty-specific files in `apps/api/src/**`; this is outside Task 6 and must be handled by the standalone cleanup tasks.
- `pnpm --filter @qara/api lint` cannot run yet because `oxlint` is not installed in the current pnpm workspace.
