# Task 10 TDD - Inbox and Pipeline UI

Source plan: `docs/superpowers/plans/2026-07-05-qara-crm-standalone.md`, Task 10.

## User Journeys

- As QARA ops, I can open `/inbox`, search/filter conversations, and review pending AI suggestions before sending.
- As QARA ops, I can open `/pipeline` and see stages with their leads.
- As the API, inbox and pipeline data endpoints require the existing bearer session auth.

## Evidence

| # | What is guaranteed | Test file or command | Result | Evidence |
|---|--------------------|----------------------|--------|----------|
| 1 | RED captured missing inbox route | `pnpm --filter @qara/api exec vitest run src/routes/inbox-routes.test.ts` | FAIL as expected | Missing `./inbox-routes` |
| 2 | Inbox list applies search, status, human flag, pagination, latest message, and pending suggestion projection | `src/routes/inbox-routes.test.ts` | PASS | 3 tests passed |
| 3 | RED captured missing pipeline route handler | `pnpm --filter @qara/api exec vitest run src/routes/operations-routes.test.ts` | FAIL as expected | `pipelineRoute is not a function` |
| 4 | Pipeline endpoint returns stages with leads | `src/routes/operations-routes.test.ts` | PASS | 4 tests passed |
| 5 | Express app mounts inbox router with existing routers | `src/app.test.ts` | PASS | 5 mounted routers |
| 6 | Web app compiles and builds | `pnpm --filter @qara/web exec tsc --noEmit --pretty false`; `pnpm --filter @qara/web build` | PASS | `/inbox`, `/login`, `/pipeline` generated |
| 7 | Local smoke responds | `curl -s http://localhost:4000/api/health`; `curl -s http://localhost:3000/inbox`; `/pipeline`; `/login` | PASS | API health OK; web pages HTTP 200 |
| 8 | New data endpoints are protected without token | `curl -s http://localhost:4000/api/inbox/list`; `/api/operations/pipeline` | PASS | Both return missing Authorization error |

Green commands:

```bash
pnpm --filter @qara/api exec vitest run src/routes/inbox-routes.test.ts src/routes/operations-routes.test.ts src/app.test.ts src/routes/tawany-routes.test.ts src/routes/meta-webhook-routes.test.ts src/middleware/auth-middleware.test.ts
pnpm --filter @qara/web exec tsc --noEmit --pretty false
pnpm --filter @qara/web build
pnpm --filter @qara/api exec prisma validate
git diff --check
```

Implementation notes:

- shadcn codegen was skipped; local CSS + lucide covered the needed UI with fewer generated files.
- The API still uses bearer tokens because that is the current backend contract. The web stores the token in `sessionStorage` and only reads `localStorage` for compatibility.
- Repo-wide API `tsc --noEmit` remains blocked by older Twenty/NodeNext issues outside Task 10; focused API route tests and web build are green.
