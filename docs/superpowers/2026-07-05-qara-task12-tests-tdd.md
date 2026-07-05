# Task 12 TDD Report - Test Guard And Integration Harness

Date: 2026-07-05

## Scope

Implemented the remaining test infrastructure without disrupting the existing unit suite:

- `.env.test` with safe test values.
- `vitest.integration.config.ts` and `vitest.integration.setup.ts`.
- DB guard requiring `DATABASE_URL` to contain `test`.
- `test:integration` script.
- `server.integration.test.ts` that imports the Express app without opening a listener.
- Unit Vitest configs exclude `*.integration.test.ts` so the DB guard is enforced only through the integration script.
- `auth-routes.test.ts` covering missing credentials, invalid credentials, and valid session creation.
- `loginRoute` exported from `auth-routes.ts` without changing the mounted route behavior.

Existing tests already covered reply-validator, leads-novos matcher, classification schema, Tawany routes, and operations pipeline route.

## RED

Integration config missing:

```bash
DATABASE_URL=postgresql://localhost:5432/qara-crm-test JWT_SECRET=test-secret-key-at-least-32-bytes-long pnpm --filter @qara/api exec vitest run --config vitest.integration.config.ts
```

Expected failure:

- `Could not resolve .../apps/api/vitest.integration.config.ts`.

Auth route handler missing:

```bash
pnpm --filter @qara/api exec vitest run src/routes/auth-routes.test.ts
```

Expected failure:

- `loginRoute is not a function`.

## GREEN

Auth tests:

```bash
pnpm --filter @qara/api exec vitest run src/routes/auth-routes.test.ts
```

Result:

- PASS: 1 file, 3 tests.

Existing unit coverage requested by the plan:

```bash
pnpm --filter @qara/api exec vitest run src/lib/guards/reply-validator.test.ts src/lib/leads-novos/matcher.test.ts src/lib/classification/schema.test.ts
```

Result:

- PASS: 3 files, 22 tests.

Integration guard and harness:

```bash
DATABASE_URL=postgresql://localhost:5432/qara-crm-prod JWT_SECRET=test-secret-key-at-least-32-bytes-long pnpm --filter @qara/api exec vitest run --config vitest.integration.config.ts
pnpm --filter @qara/api run test:integration
```

Results:

- Guard blocks the non-test database URL.
- PASS: 1 integration file, 1 test.

## Focused Regression

Command:

```bash
pnpm --filter @qara/api exec vitest run src/lib/shadow.test.ts src/lib/production.test.ts src/lib/lgpd.test.ts src/routes/lgpd-routes.test.ts src/lib/scheduler.test.ts src/routes/appointment-routes.test.ts src/lib/debounce.test.ts src/logic-functions/meta-webhook.test.ts src/routes/meta-webhook-routes.test.ts src/routes/operations-routes.test.ts src/routes/inbox-routes.test.ts src/routes/tawany-routes.test.ts src/routes/auth-routes.test.ts src/lib/guards/reply-validator.test.ts src/lib/leads-novos/matcher.test.ts src/lib/classification/schema.test.ts src/middleware/auth-middleware.test.ts src/app.test.ts src/lib/tools/sendWhatsAppTemplate.test.ts src/lib/tools/tools.test.ts src/lib/whatsapp-client.test.ts
```

Result:

- PASS: 21 files, 113 tests.

## Notes

- `supertest` was not used because the sandbox blocks opening a local listener.
- Integration tests therefore validate app assembly without network binding.
- Repo-wide `tsc` remains blocked by existing TypeScript issues outside this task.
