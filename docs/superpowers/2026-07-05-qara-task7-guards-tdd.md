# Task 7 TDD — Tawany Guards + Circuit Breaker Slices

Source plan: `docs/superpowers/plans/2026-07-05-qara-crm-standalone.md`, Task 7.

## User Journeys

- As QARA ops, the standalone API can import Tawany, Qara classifier, and lead scorer without `twenty-sdk`.
- As a patient, sending an opt-out phrase stops AI handling before any LLM call.
- As QARA ops, prompt-injection attempts are blocked before model exposure and recorded as an AI run failure.
- As compliance, affirmative Mohs or skin-cancer statements are blocked unless framed as a future hypothesis.
- As QARA ops, repeated Meta Graph API failures open a circuit and short-circuit later sends without another outbound `fetch`.
- As QARA ops, every OpenRouter request carries a bounded `max_tokens` value and long input content is truncated before leaving the process.
- As QARA ops, Tawany sends only a bounded recent message window to the model while preserving the newest context.
- As QARA ops, every valid Tawany reply is captured as an `AiSuggestion` with prompt version before sending and is marked `SENT` after successful send.
- As product/compliance, AiSuggestion stores human-edit metadata for future prompt tuning.
- As a receptionist, pending Tawany suggestions can be listed, approved with an edited body, sent, or rejected through authenticated routes.

## Evidence

| # | What is guaranteed | Test file or command | Result | Evidence |
|---|--------------------|----------------------|--------|----------|
| 1 | RED captured missing prompt-injection guard, missing Mohs guard, and remaining Twenty wrapper in Tawany handler | `pnpm --filter @qara/api exec vitest run src/lib/guards/prompt-injection.test.ts src/lib/guards/reply-validator.test.ts src/logic-functions/tawany-handler.test.ts` | FAIL as expected | Missing `./prompt-injection`, Mohs assertions failed, `twenty-sdk/define` import failed |
| 2 | Prompt-injection regex blocks common EN/PT override attempts and allows normal patient messages | `src/lib/guards/prompt-injection.test.ts` | PASS | Same green command below |
| 3 | Tawany opt-out and prompt-injection guards run before any AI call and mark conversation for human handling | `src/logic-functions/tawany-handler.test.ts` | PASS | Same green command below |
| 4 | Reply validator rejects affirmative Mohs and skin-cancer statements while allowing future-hypothesis wording | `src/lib/guards/reply-validator.test.ts` | PASS | Same green command below |
| 5 | Wrapper removal did not regress classifier or scorer logic-function tests | `src/logic-functions/qara-classifier.test.ts`, `src/logic-functions/lead-scorer.test.ts` | PASS | `pnpm --filter @qara/api exec vitest run src/logic-functions/qara-classifier.test.ts src/logic-functions/lead-scorer.test.ts` |
| 6 | RED captured missing circuit breaker module | `pnpm --filter @qara/api exec vitest run src/lib/resilience/circuit-breaker.test.ts` | FAIL as expected | Missing `./circuit-breaker` |
| 7 | Circuit breaker opens after threshold, short-circuits, half-opens after cooldown, and supports reset | `src/lib/resilience/circuit-breaker.test.ts` | PASS | `pnpm --filter @qara/api exec vitest run src/lib/resilience/circuit-breaker.test.ts src/lib/tools/tools.test.ts` |
| 8 | `sendWhatsApp` wraps Meta sends and stops calling `fetch` after the breaker opens | `src/lib/tools/tools.test.ts` | PASS | Same circuit green command |
| 9 | RED captured missing `max_tokens` and missing truncation in OpenRouter request body | `pnpm --filter @qara/api exec vitest run src/lib/ai-client.test.ts` | FAIL as expected | 3 cap tests failed |
| 10 | `ai-client` sends env/default `max_tokens` and truncates oversized input content | `src/lib/ai-client.test.ts` | PASS | `pnpm --filter @qara/api exec vitest run src/lib/ai-client.test.ts` |
| 11 | RED captured missing context-window helper | `pnpm --filter @qara/api exec vitest run src/lib/ai/context-window.test.ts` | FAIL as expected | Missing `./context-window` |
| 12 | Context-window keeps system + newest messages, drops older middle, and respects char budget | `src/lib/ai/context-window.test.ts` | PASS | `pnpm --filter @qara/api exec vitest run src/lib/ai/context-window.test.ts src/logic-functions/tawany-handler.test.ts` |
| 13 | Tawany handler sends the truncated recent window to `ai.chat` | `src/logic-functions/tawany-handler.test.ts` | PASS | Same context-window green command |
| 14 | RED captured missing AiSuggestion creation before send | `pnpm --filter @qara/api exec vitest run src/logic-functions/tawany-handler.test.ts` | FAIL as expected | Expected `data.create('aiSuggestion', ...)`, received only `chatMessage` |
| 15 | Tawany creates AiSuggestion with `promptVersion`, sends, then marks it `SENT` | `src/logic-functions/tawany-handler.test.ts` | PASS | `pnpm --filter @qara/api exec vitest run src/logic-functions/tawany-handler.test.ts` |
| 16 | Prisma schema accepts `humanEdited`, `originalBody`, and `updatedAt` additions | `pnpm --filter @qara/api exec prisma validate` | PASS | Schema valid |
| 17 | RED captured missing Tawany route module | `pnpm --filter @qara/api exec vitest run src/routes/tawany-routes.test.ts` | FAIL as expected | Missing `./tawany-routes` |
| 18 | Tawany routes run handler, list pending suggestions, approve with human edit capture, reject, and optimistic-lock 409 | `src/routes/tawany-routes.test.ts` | PASS | `pnpm --filter @qara/api exec vitest run src/routes/tawany-routes.test.ts src/routes/meta-webhook-routes.test.ts src/middleware/auth-middleware.test.ts` |
| 19 | Task 7 focused regression set remains green | focused Task 7 tests | PASS | 9 files, 86 tests passed |
| 20 | Compilation verification was run | `pnpm --filter @qara/api exec tsc --noEmit --pretty false` | FAIL, documented | Existing global Twenty/TSX/NodeNext blockers remain |

Green command:

```bash
pnpm --filter @qara/api exec vitest run src/lib/guards/prompt-injection.test.ts src/lib/guards/reply-validator.test.ts src/logic-functions/tawany-handler.test.ts
```

Result: 3 files passed, 36 tests passed.

Additional command:

```bash
pnpm --filter @qara/api exec vitest run src/logic-functions/qara-classifier.test.ts src/logic-functions/lead-scorer.test.ts
```

Result: 2 files passed, 10 tests passed.

Circuit breaker command:

```bash
pnpm --filter @qara/api exec vitest run src/lib/resilience/circuit-breaker.test.ts src/lib/tools/tools.test.ts
```

Result: 2 files passed, 24 tests passed.

AI caps command:

```bash
pnpm --filter @qara/api exec vitest run src/lib/ai-client.test.ts
```

Result: 1 file passed, 11 tests passed.

Context-window command:

```bash
pnpm --filter @qara/api exec vitest run src/lib/ai/context-window.test.ts src/logic-functions/tawany-handler.test.ts
```

Result: 2 files passed, 22 tests passed.

AiSuggestion handler/schema commands:

```bash
pnpm --filter @qara/api exec vitest run src/logic-functions/tawany-handler.test.ts
pnpm --filter @qara/api exec prisma validate
```

Result: handler passed 20 tests; Prisma schema valid.

Tawany routes command:

```bash
pnpm --filter @qara/api exec vitest run src/routes/tawany-routes.test.ts src/routes/meta-webhook-routes.test.ts src/middleware/auth-middleware.test.ts
```

Result: 3 files passed, 16 tests passed.

Focused regression command:

```bash
pnpm --filter @qara/api exec vitest run src/lib/ai/context-window.test.ts src/lib/ai-client.test.ts src/lib/guards/prompt-injection.test.ts src/lib/guards/reply-validator.test.ts src/logic-functions/tawany-handler.test.ts src/logic-functions/qara-classifier.test.ts src/logic-functions/lead-scorer.test.ts src/lib/resilience/circuit-breaker.test.ts src/lib/tools/tools.test.ts
```

Result: 9 files passed, 86 tests passed.

Known gaps:

- `pnpm --filter @qara/api exec tsc --noEmit` remains blocked until the remaining legacy Twenty app files are migrated or excluded. The failure includes `twenty-sdk` imports, old TSX front components/tests, and NodeNext extension issues outside this slice.
