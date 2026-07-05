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

Known gaps:

- Task 7 still needs AiSuggestion creation, routes, approval flow, and Prisma additions.
- `pnpm --filter @qara/api exec tsc --noEmit` remains blocked until the remaining legacy Twenty app files are migrated or excluded. The failure includes `twenty-sdk` imports, old TSX front components/tests, and NodeNext extension issues outside this slice.
