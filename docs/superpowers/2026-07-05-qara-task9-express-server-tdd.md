# Task 9 TDD — Express Server Assembly

Source plan: `docs/superpowers/plans/2026-07-05-qara-crm-standalone.md`, Task 9.

## User Journeys

- As QARA ops, the API app can be imported without opening a port, so route tests stay cheap.
- As QARA ops, `pnpm --filter @qara/api dev` starts a local server on port `4000`.
- As monitoring, `/api/health` returns the standard JSON envelope.

## Evidence

| # | What is guaranteed | Test file or command | Result | Evidence |
|---|--------------------|----------------------|--------|----------|
| 1 | RED captured missing app assembly module | `pnpm --filter @qara/api exec vitest run src/app.test.ts` | FAIL as expected | Missing `./app` |
| 2 | App exports an Express app with health route and the four mounted API routers from Tasks 5-8 | `src/app.test.ts` | PASS | `pnpm --filter @qara/api exec vitest run src/app.test.ts src/routes/tawany-routes.test.ts src/routes/operations-routes.test.ts src/routes/meta-webhook-routes.test.ts src/middleware/auth-middleware.test.ts` |
| 3 | Focused regression set remains green | focused vitest command | PASS | 17 files, 121 tests passed |
| 4 | Prisma schema remains valid | `pnpm --filter @qara/api exec prisma validate` | PASS | Schema valid |
| 5 | Local dev server starts and health responds | `pnpm --filter @qara/api dev`; `curl -s http://localhost:4000/api/health` | PASS | `{"success":true,"data":{"status":"ok"}}` |

Green commands:

```bash
pnpm --filter @qara/api exec vitest run src/app.test.ts src/routes/tawany-routes.test.ts src/routes/operations-routes.test.ts src/routes/meta-webhook-routes.test.ts src/middleware/auth-middleware.test.ts
pnpm --filter @qara/api exec vitest run src/app.test.ts src/lib/ai/context-window.test.ts src/lib/ai-client.test.ts src/lib/guards/prompt-injection.test.ts src/lib/guards/reply-validator.test.ts src/logic-functions/tawany-handler.test.ts src/logic-functions/qara-classifier.test.ts src/logic-functions/lead-scorer.test.ts src/lib/resilience/circuit-breaker.test.ts src/lib/tools/tools.test.ts src/lib/tools/sendWhatsAppTemplate.test.ts src/routes/tawany-routes.test.ts src/routes/operations-routes.test.ts src/routes/meta-webhook-routes.test.ts src/middleware/auth-middleware.test.ts src/logic-functions/leads-novos-flow.test.ts src/lib/whatsapp-client.test.ts
pnpm --filter @qara/api exec prisma validate
```

Known gap:

- Repo-wide `tsc --noEmit` is still blocked by legacy Twenty app files, old TSX front-component tests, and NodeNext extension requirements. Task 9 makes the runtime server path usable but does not clean the old Twenty surface.
