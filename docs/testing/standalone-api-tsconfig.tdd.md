# Standalone API Typecheck TDD

## Source

Derived from the migration note that the product is now standalone rather than a Twenty app.

## User Journey

As a developer, I want the API TypeScript configs to typecheck the standalone runtime and tests without loading legacy Twenty app files, so that IDE and CI feedback reflects the product that currently ships.

## RED

Command:

```bash
pnpm --filter @qara/api exec tsc -p tsconfig.spec.json --noEmit
```

Result: failed because `tsconfig.spec.json` loaded legacy Twenty files and tests, including missing `twenty-sdk`, missing `createDataApi`, JSX front component tests, and NodeNext extension diagnostics.

## GREEN

Commands:

```bash
pnpm --filter @qara/api exec tsc -p tsconfig.spec.json --noEmit
pnpm --filter @qara/api exec tsc -p tsconfig.json --noEmit
pnpm --filter @qara/api exec tsc -p tsconfig.build.json --noEmit
pnpm --filter @qara/api test
```

Result: all typechecks passed. The API test suite passed with 57 files and 422 tests. The test command required running outside the sandbox because Supertest hit `listen EPERM` inside the sandbox.

## Guarantees

| # | What is guaranteed | Command | Result |
|---|--------------------|---------|--------|
| 1 | Standalone API source typechecks without legacy Twenty app files | `pnpm --filter @qara/api exec tsc -p tsconfig.json --noEmit` | PASS |
| 2 | Standalone API tests typecheck without legacy Twenty app files | `pnpm --filter @qara/api exec tsc -p tsconfig.spec.json --noEmit` | PASS |
| 3 | Production API build surface still typechecks | `pnpm --filter @qara/api exec tsc -p tsconfig.build.json --noEmit` | PASS |
| 4 | Existing API unit tests still pass | `pnpm --filter @qara/api test` | PASS |

## Known Gaps

Legacy Twenty files still exist in the repo. This change isolates them from the standalone API typecheck; it does not delete or migrate them.
