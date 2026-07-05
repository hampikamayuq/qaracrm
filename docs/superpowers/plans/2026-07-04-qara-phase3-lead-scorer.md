# Qara Clinic Phase 3 — Lead Scorer Implementation Plan

## Context

Phase 1 (UI scaffolding, tasks 23-30) and Phase 2 (Meta WhatsApp/IG integration) are complete on main. Phase 3 in the design spec §11 splits into two halves:

- **Follow-up engine** + dashboard UI — **DONE this session** (committed `97e46d9c`): 10 new files, 19 entities synced, 18/18 test files / 105 tests green, lint 0/0, deploy clean.
- **Lead Scorer** (§6.1) — **THIS PLAN**.

The lead-scorer LF is what feeds the `score` / `scoreReasons` fields on `lead` (already declared on `lead.object.ts:87-99`: NUMBER `score` default 50, RAW_JSON `scoreReasons`). It runs as a deployable logic-function callable on demand (DB-event trigger or external cron via the Twenty Logic Function REST API) — consistent with how Phase 2's webhook LFs are deployed (no SDK-side cron primitive; scheduling is a deploy concern).

## Validated API facts (do not re-derive)

- `lead` object already has `intent` (SELECT: UNHAS/CIRURGIA/TRICOLOGIA/AUTOIMUNE/DERMATOPEDIATRIA/OUTRO), `source` (SELECT: instagram/google/indicacao/anuncio/organico/whatsapp/outro), `score` (NUMBER, default 50), `scoreReasons` (RAW_JSON array). No object changes needed.
- `message` (chatMessage) object has `body` and `conversationId`. Conversation has `leadId`.
- `DataApi` (`src/lib/data.ts:8-26`): `list/get/create/update` with `filter`, `orderBy`, `limit`, `select` (nested relations supported). Used by every other LF in the project.
- `createAiClient()` (`src/lib/ai-client.ts:54`) returns `{ chat }`; throws if `OPENROUTER_API_KEY` missing. `chat({ model, system, messages, responseFormat: { type: 'json_object' } })` returns `{ content, finishReason, toolCalls, usage }`. 7 unit tests cover retry / non-JSON / empty / tool-call paths.
- Server variables: `OPENROUTER_API_KEY` (required), `DEFAULT_MODEL_INTERNAL` (default model for internal/LLM scoring). Both already declared in `src/application-config.ts:14-30`.
- `tawany-handler` does NOT call the scorer today (it writes its own `assignTag` and `notes`); the scorer is a parallel path the system can invoke via DB-event on lead update or external cron.

## Global Constraints

1. UUIDs: every new entity UUID must be valid v4 (CLAUDE.md).
2. TDD: tests first, then implementation. Every task ships green: typecheck 0, lint 0, all tests pass, smoke 4/4.
3. Direct commits to main per the SDD ledger convention; commit messages follow `<type>(<scope>): <subject>` with body explaining *why*.
4. One task = one commit. Don't bundle.
5. Mark deliberate simplifications with `// ponytail:` comments.
6. YAGNI: don't build a generic scoring framework. Build a scorer for THIS lead, with THIS data, using THESE rules.
7. Reuse `categorizeTask`/`daysSince` style pure-function lib where it makes sense (the heuristic is pure, no Twenty API needed in the function itself — DI it like `runFollowupEngine` does in `src/logic-functions/followup-engine.ts:36`).

## Plan

5 tasks, ~1-2 days of work, TDD per task. Each task produces one commit.

### Task 1: Pure heuristic scoring (no LLM, no Twenty)

- New: `src/lib/lead-score/heuristic.ts` — pure function `heuristicScore(lead, recentMessages) -> { score, reasons[] }`.
- New: `src/lib/lead-score/heuristic.test.ts` — cover:
  - base = 50 with no signals
  - `intent !== 'OUTRO'` → +15
  - recent message matches `(agendar|marcar|consulta|horário)` → +20
  - `source === 'indicacao'` → +10
  - recent message matches `(caro|desisti|talvez|não sei)` → -15
  - clamp to [0, 100]
  - cap at 1 message match per category (don't double-count)
- New: `src/lib/lead-score/index.ts` — re-export `heuristicScore`.
- Why pure: matches the codebase pattern (`src/lib/followup/categorize.ts`), trivially testable without mocks, and the LF handler just calls it. Per `src/lib/followup/categorize.test.ts` style.

Commit: `feat(lib): pure heuristic lead scorer` (+/- test + lib).

### Task 2: Score-only LLM prompt (no schema invented, reuse json_object + narrow prompt)

- New: `src/lib/lead-score/llm.ts` — `llmScore(lead, recentMessages, ai) -> { score, reasons[] }`.
- The LLM path is only used when the heuristic lands in the ambiguous 45-65 band (per spec §6.1). On `ambiguous`, call `ai.chat({ model, system: SCORE_PROMPT, messages, responseFormat: { type: 'json_object' } })`, parse `{ score: number, reasons: string[] }`, clamp to [0, 100]. Throw on non-JSON / missing keys — caller catches and falls back to the heuristic score with `['LLM error; using heuristic']` appended to reasons.
- New: `src/lib/lead-score/llm.test.ts` — mocks `ai.chat`, covers:
  - parses `{ score, reasons }` and returns them
  - clamps out-of-range scores (e.g. 150 → 100, -10 → 0)
  - on throw, the LF caller falls back (Task 3 will exercise the fallback path with the real orchestrator; here we just assert `llmScore` propagates the error)
- New: `src/lib/prompts.ts` — add `QARA_SCORE_PROMPT` constant. Cite the existing `QARA_CLASSIFICATION_PROMPT` definitions (intent / source / temperature) so the model is grounded in the same vocabulary. Ask for JSON only: `{"score": 0-100, "reasons": ["…"]}`. ≤ 30 lines.

Commit: `feat(lib): LLM-assisted lead scorer with heuristic fallback` (+/- lib + test + prompts).

### Task 3: Orchestrator + DB-event LF wrapper

- New: `src/lib/lead-score/orchestrator.ts` — `runLeadScorer(leadId, now, deps) -> { score, reasons, path: 'heuristic' | 'llm' | 'fallback' }`. Wires:
  1. fetch lead (no select — need intent/source/score)
  2. fetch last 10 chatMessages via conversation relation
  3. compute `heuristicScore`
  4. if `heuristicScore >= 45 && heuristicScore <= 65` and `ai` is provided: try `llmScore`, on any error fall back to heuristic
  5. return final `{ score, reasons, path }`
- New: `src/lib/lead-score/orchestrator.test.ts` — covers:
  - clear hot (intent = CIRURGIA + "quero agendar") → path `'heuristic'`, no LLM call
  - clear cold (only "qual o endereço?") → path `'heuristic'`, no LLM call
  - ambiguous baseline (intent = CIRURGIA, no message match) → calls LLM, path `'llm'`
  - LLM throws → path `'fallback'`, returns heuristic score + extra reason
  - `ai` undefined → always `'heuristic'`
- Inject `createDataApi()` and `createAiClient()` so the test can pass mocks (mirrors `runFollowupEngine(now, data)` in `src/logic-functions/followup-engine.ts:36`).
- New: `src/logic-functions/lead-scorer.ts` — `defineLogicFunction` that:
  1. takes `{ leadId: string }` payload
  2. calls `runLeadScorer(leadId)`
  3. updates the lead: `update('lead', leadId, { score, scoreReasons: reasons })`
  4. returns `{ ok, path, score, reasons }`
- New: `src/constants/universal-identifiers.ts` — `LEAD_SCORER_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER = '<new v4>'`.
- New: `src/logic-functions/lead-scorer.test.ts` — covers:
  - updates lead with computed score + reasons
  - returns `{ ok: false, error }` if `leadId` is missing (LF trust boundary)
  - returns `{ ok: true, path: 'fallback' }` if update succeeds after LLM error

Commit: `feat(lf): lead-scorer logic function (heuristic + LLM escalation + fallback)`.

### Task 4: Surface score in `lead-kanban` (the front-component)

The kanban already reads leads; we add a small score chip in each card so the scoring work is visible without leaving the funnel. Minimal diff: read `score` in the existing lead select, render a colored chip (red <40, amber 40-65, green >65) next to the name.

- Modify: `src/front-components/lead-kanban.front-component.tsx` — add `score: true` to the lead `select`, add a `<ScoreChip score={lead.score ?? 50} />` next to the name in the card.
- Modify: `src/__tests__/lead-kanban.test.tsx` — assert the chip renders the correct color band for three scores (20, 55, 80).
- Commit: `feat(ui): score chip on lead-kanban cards`.

### Task 5: Sync + smoke + docs

- `yarn twenty dev --once` — confirm 1 new LF synced.
- `bash scripts/smoke.sh` — typecheck + 108+ tests + lint 0/0 + build + smoke 4/4.
- Update `docs/superpowers/2026-07-03-qara-twenty-design.md` — flip Phase 3 row from "Mês 1-2" to "complete" in the roadmap table.
- Append entry to `.superpowers/sdd/progress.md` matching the Phase 2 ledger style (5 commits, final state, post-Phase-3 trust-boundary notes if any).
- Commit: `docs(phase3): mark lead-scorer complete in roadmap`.

## What this plan deliberately does NOT include (YAGNI)

- **A real cron scheduler.** Phase 2 established the pattern: ship the LF, let the deployer wire the schedule (Render cron, k8s CronJob, twenty-sdk's `cronTriggers` if it lands). The LF is callable via REST immediately, so a user/ops decision wires it to a schedule.
- **Score trend tracking** (delta vs previous, history view). Spec §6.1 doesn't require it; the followup engine + dashboard already surface actionable follow-ups regardless of score history.
- **DB-event trigger on `lead.update` to auto-rescore.** Out of scope: spec §6.1 shows a single on-demand `leadScorer({ leadId })` signature. Triggering is a deploy decision, same as cron. Add when there's a real need (e.g. nightly bulk rescore from a cron).
- **Bulk rescore.** The `runLeadScorer` is per-lead; a `runLeadScorerBatch(leadIds[])` is a one-liner addition when needed. Don't build it.
- **Score-based auto-assignment / auto-tagging.** The kanban already sorts by stage; score is a *signal* in the chip, not an automation. The classifier prompt's existing tag rules (`LEAD_QUENTE` for 75-100) are the right home for that — Tawany's `assignTag` is already wired.

## Risks / what could go wrong

- **LLM latency in the ambiguous band**: ~1-2s per call. For a batch rescore this matters; for on-demand it's fine. Mitigation: future bulk rescore runs in a single LF with `Promise.all`, and a timeout on the ai-client call (add when bulk lands).
- **Heuristic weights**: the spec's +15 / +20 / +10 / -15 are first-pass. They're wrong for some edge cases. Mitigation: weights are in one pure function (`heuristic.ts`) — easy to tune, easy to test. Re-tuning does not require touching the LF.
- **scoreReasons schema**: spec uses `RAW_JSON` with `string[]` shape. If Twenty complains at write time, fall back to `string` (JSON-encoded array). Verify during Task 3 by writing a real lead and reading it back.
- **No existing scorer test fixtures**: Task 3 needs mock chatMessages. The repo has no fixtures directory; we write inline `[{ body, sentAt }]` objects in the test. Matches the style in `src/lib/handoff.test.ts`.

## Files added / modified (summary)

| Status | Path | Purpose |
|---|---|---|
| A | `src/lib/lead-score/heuristic.ts` | Pure scoring function |
| A | `src/lib/lead-score/heuristic.test.ts` | Heuristic unit tests |
| A | `src/lib/lead-score/llm.ts` | LLM scoring with fallback |
| A | `src/lib/lead-score/llm.test.ts` | LLM path tests |
| A | `src/lib/lead-score/orchestrator.ts` | Wires heuristic + LLM |
| A | `src/lib/lead-score/orchestrator.test.ts` | End-to-end orchestrator |
| A | `src/lib/lead-score/index.ts` | Barrel export |
| A | `src/logic-functions/lead-scorer.ts` | `defineLogicFunction` |
| A | `src/logic-functions/lead-scorer.test.ts` | LF trust boundary |
| M | `src/lib/prompts.ts` | Add `QARA_SCORE_PROMPT` |
| M | `src/constants/universal-identifiers.ts` | Add `LEAD_SCORER_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER` |
| M | `src/front-components/lead-kanban.front-component.tsx` | Score chip |
| M | `src/__tests__/lead-kanban.test.tsx` | Chip color tests |
| M | `docs/superpowers/2026-07-03-qara-twenty-design.md` | Phase 3 row flip |
| M | `.superpowers/sdd/progress.md` | Phase 3 entry |

## Verification

End-to-end, after Task 5:
1. `yarn typecheck` — 0 errors.
2. `yarn test:unit` — 21+ test files (was 18), 120+ tests (was 105), all green.
3. `yarn lint` — 0/0.
4. `bash scripts/smoke.sh` — all 4 checks pass, exit 0.
5. `yarn twenty dev --once` — 1 new LF synced (`lead-scorer`).
6. Live: `curl -X POST /s/lead-scorer -d '{"leadId":"<some-id>"}'` returns `{ ok, path, score, reasons }`. Lead's `score` field is updated.

## Acceptance

Plan is shippable when:
- All 5 tasks committed to main.
- Each commit message tells the *why* in 1-2 lines.
- Each task's test count is justified: Task 1 = ~7, Task 2 = ~3, Task 3 = ~5, Task 4 = ~3 (new), so total +18 new tests, suite 105 → ~123.
- The dashboard work (`97e46d9c`) is already on main, no need to re-touch.
- Phase 3 row in design spec reads "complete (2026-07-04)".
