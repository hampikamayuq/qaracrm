# Patient, Follow-up, Scheduling and Golden Set TDD Evidence

Date: 2026-07-08

Scope:
- Safe patient data capture from explicit inbound messages only.
- Intelligent follow-up suggestion with Tawany validation and mode/risk gating.
- Real scheduling tools: `checkAvailability` and `bookAppointment`.
- Golden set runner for prompt/knowledge regression checks.
- Publication gate command: `pnpm --filter @qara/api test:golden`.
- Online publication gate endpoint: `POST /api/operations/golden-set`, admin-only.

Red tests added first:
- `apps/api/src/lib/patient-profile.test.ts`
- `apps/api/src/logic-functions/followup-engine.test.ts`
- `apps/api/src/lib/tools/appointmentTools.test.ts`
- `apps/api/src/lib/tawany/golden-set.test.ts`
- `apps/api/src/scripts/run-golden-set.test.ts`
- `apps/api/src/routes/operations-routes.test.ts`

Golden gate fixtures:
- `apps/api/src/lib/tawany/golden-cases.json`
- Current cases cover address, price no-invention, diagnosis no-claim, and scheduling no fake confirmation.

Verification:
- Golden set RED:
  `pnpm --filter @qara/api exec vitest run src/lib/tawany/golden-set.test.ts`
  Result: failed as expected before implementation with `loadGoldenCases is not a function`.
- Golden command RED:
  `pnpm --filter @qara/api exec vitest run src/scripts/run-golden-set.test.ts`
  Result: failed as expected before implementation because `test:golden` was not defined.
- Golden set GREEN:
  `pnpm --filter @qara/api exec vitest run src/lib/tawany/golden-set.test.ts src/scripts/run-golden-set.test.ts`
  Result: 2 files, 3 tests passed.
- Online endpoint RED:
  `pnpm --filter @qara/api exec vitest run src/routes/operations-routes.test.ts`
  Result: failed as expected before implementation with `goldenSetRoute is not a function`.
- Online endpoint GREEN:
  `pnpm --filter @qara/api exec vitest run src/routes/operations-routes.test.ts`
  Result after implementation: 1 file, 5 tests passed.
- Focused regression:
  `pnpm --filter @qara/api exec vitest run src/lib/patient-profile.test.ts src/lib/tools/appointmentTools.test.ts src/lib/tawany/golden-set.test.ts src/logic-functions/followup-engine.test.ts src/lib/tools/tools.test.ts src/logic-functions/tawany-handler.test.ts`
  Result: 6 files, 65 tests passed.
- TypeScript build:
  `pnpm --filter @qara/api build`
  Result: passed.
- Full API suite:
  `pnpm --filter @qara/api test`
  Result after online golden gate endpoint: 61 files, 449 tests passed.
- Lint:
  `pnpm --filter @qara/api lint`
  Result: passed with pre-existing unused-variable warnings.
- Live golden gate:
  `pnpm --filter @qara/api test:golden`
  Not run in this shell because `OPENROUTER_API_KEY` is not configured. The command is now available and will fail closed when the key is missing or any golden case fails.
- Render online check:
  `curl -sS -m 30 https://cliniqara-crm.onrender.com/api/health`
  Result: `{"success":true,"data":{"status":"ok"}}`.
  `POST https://cliniqara-crm.onrender.com/api/operations/golden-set`
  Result before deploy of this change: HTTP 404, confirming the current Render instance does not yet include the online golden gate endpoint.
