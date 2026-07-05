# Task 11 TDD Report - Shadow Mode

Date: 2026-07-05

## Scope

Implemented shadow mode for Meta webhook migration:

- `SHADOW_MODE` helpers for `shadow`, `human_approval`, and `autopilot`.
- Raw webhook forwarding to Twenty through `TWENTY_FORWARD_URL`, preserving original request bytes and Meta signature.
- `handleMetaWebhook` now returns processed inbound message IDs for downstream shadow execution.
- Shadow Tawany execution records `Activity` entries without sending messages.
- Shadow comparison script for matching Tawany output against later `OUT` messages.
- Shadow mode runbook with rollout and rollback steps.

## RED

Command:

```bash
pnpm --filter @qara/api exec vitest run src/lib/shadow.test.ts src/logic-functions/meta-webhook.test.ts src/routes/meta-webhook-routes.test.ts
```

Expected failures before implementation:

- `Cannot find module './shadow'`.
- `handleMetaWebhook` returned `undefined` instead of `processedMessages`.
- Webhook route did not call raw forwarding helper.

## GREEN

Command:

```bash
pnpm --filter @qara/api exec vitest run src/lib/shadow.test.ts src/logic-functions/meta-webhook.test.ts src/routes/meta-webhook-routes.test.ts
```

Result:

- PASS: 3 files, 18 tests.

## Implementation Notes

- `Activity.body` is a string in the current Prisma schema, so shadow runs are stored as JSON strings.
- The comparison script searches for `"type":"shadow_run"` and safely parses each activity body.
- The webhook route creates the AI client lazily only when there are processed messages and shadow execution is needed.
- Forwarding runs after `WebhookEvent` persistence and before async processing, so Meta can keep receiving immediate `200` responses.

## Security And PHI Notes

- Raw webhook forwarding preserves bytes for Twenty signature validation but does not log raw payloads.
- Shadow activities store truncated Tawany/Twenty text at 500 characters.
- Operational logs contain event names and IDs only.
- Rollback remains operational: repoint Meta callback URL back to Twenty.
