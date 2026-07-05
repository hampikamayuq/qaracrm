# Task 14 TDD Report - Scheduler + D-1 Reminder

Date: 2026-07-05

## Scope

Implemented an in-process scheduler for:

- D-1 appointment reminders through approved WhatsApp template `qara_appointment_reminder_d1`.
- Follow-up for stale open conversations through approved WhatsApp template `qara_followup_48h`.
- Minimal appointment CRUD routes under `/api/appointments`.
- `ENABLE_SCHEDULER=false` default in `.env.example`.

No `node-cron` dependency was added. This phase uses native `setInterval`, gated by `ENABLE_SCHEDULER=true`, with duplicate prevention through appointment/conversation state updates.

## RED

Command:

```bash
pnpm --filter @qara/api exec vitest run src/lib/scheduler.test.ts src/routes/appointment-routes.test.ts src/app.test.ts
```

Expected failures before implementation:

- `Cannot find module './scheduler'`.
- `Cannot find module './appointment-routes'`.
- App router count still expected 5 registered routers.

## GREEN

Command:

```bash
pnpm --filter @qara/api exec vitest run src/lib/scheduler.test.ts src/routes/appointment-routes.test.ts src/app.test.ts
```

Result:

- PASS: 3 files, 7 tests.

## Focused Regression

Command:

```bash
pnpm --filter @qara/api exec vitest run src/lib/scheduler.test.ts src/routes/appointment-routes.test.ts src/lib/debounce.test.ts src/logic-functions/meta-webhook.test.ts src/routes/meta-webhook-routes.test.ts src/routes/operations-routes.test.ts src/routes/inbox-routes.test.ts src/routes/tawany-routes.test.ts src/middleware/auth-middleware.test.ts src/app.test.ts src/lib/tools/sendWhatsAppTemplate.test.ts src/lib/tools/tools.test.ts src/lib/whatsapp-client.test.ts
```

Result:

- PASS: 13 files, 74 tests.

## Schema And Diff Checks

Commands:

```bash
pnpm --filter @qara/api exec prisma validate
git diff --check
```

Results:

- Prisma schema valid.
- No whitespace errors.

## Typecheck Note

Command:

```bash
pnpm --filter @qara/api exec tsc --noEmit --pretty false
```

Result:

- FAILS on existing repo-wide TypeScript issues, including missing `twenty-sdk` / `twenty-client-sdk`, TSX test JSX config gaps, NodeNext explicit-extension errors, and pre-existing route typing issues.
- This task did not attempt a broad TypeScript cleanup.

## Security And PHI Notes

- Appointment routes are protected by `authMiddleware`.
- List responses expose IDs, status, dates, and relationship IDs only.
- Scheduler logs aggregate counts only, not names, phones, or message bodies.
- WhatsApp messages use template names, keeping approved HSM content outside code.
