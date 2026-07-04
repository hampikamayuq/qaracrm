#!/usr/bin/env bash
# Smoke test for the Qara Clinic Twenty app.
# Runs the canonical pre-commit / pre-PR checks: typecheck, unit tests, lint, build.
# Exits 1 if any required check fails, 0 otherwise.

set -euo pipefail

cd "$(dirname "$0")/.."

readonly TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# ANSI colors (auto-disabled if not a TTY).
if [[ -t 1 ]]; then
  readonly C_RESET=$'\033[0m'
  readonly C_BOLD=$'\033[1m'
  readonly C_GREEN=$'\033[32m'
  readonly C_RED=$'\033[31m'
  readonly C_YELLOW=$'\033[33m'
  readonly C_BLUE=$'\033[34m'
else
  readonly C_RESET="" C_BOLD="" C_GREEN="" C_RED="" C_YELLOW="" C_BLUE=""
fi

section() {
  printf "\n${C_BOLD}${C_BLUE}==> %s${C_RESET}\n" "$1"
}

ok() {
  printf "${C_GREEN}✓ %s${C_RESET}\n" "$1"
}

warn() {
  printf "${C_YELLOW}⚠ %s${C_RESET}\n" "$1"
}

fail() {
  printf "${C_RED}✗ %s${C_RESET}\n" "$1"
  FAILED+=("$1")
}

declare -a FAILED=()

printf "${C_BOLD}Qara Clinic smoke test${C_RESET}  ${C_YELLOW}(%s)${C_RESET}\n" "$TIMESTAMP"

# 1. Typecheck
section "1/4  Typecheck (yarn typecheck)"
if yarn typecheck; then
  ok "typecheck"
else
  fail "typecheck"
fi

# 2. Unit tests
section "2/4  Unit tests (yarn test:unit)"
if yarn test:unit; then
  ok "unit tests"
else
  fail "unit tests"
fi

# 3. Lint
section "3/4  Lint (yarn lint)"
if yarn lint; then
  ok "lint"
else
  fail "lint"
fi

# 4. Build (Twenty manifest bundler)
section "4/4  Build (yarn twenty dev:build)"
if yarn twenty dev:build; then
  ok "build"
else
  fail "build"
fi

# Informational: Docker status (does NOT fail the script)
section "Docker status (informational, non-fatal)"
if yarn twenty docker:status; then
  ok "docker:status"
else
  warn "docker:status unavailable (this is OK if you haven't started the dev server)"
fi

# Manual checklist — what the automated checks DO NOT cover
section "Manual checklist (not automated)"

cat <<'EOF'
Before opening a PR, verify these manually against a running dev server
(yarn twenty docker:start && yarn twenty dev):

  [ ] App appears in workspace's installed-apps list
  [ ] Left sidebar shows 3 items: Qara Clinic (main), Inbox WhatsApp, Funil de Leads
  [ ] Clicking Inbox WhatsApp loads the WhatsApp Inbox front-component
  [ ] Clicking Funil de Leads loads the Lead Kanban front-component
  [ ] Cmd+K command palette shows "Abrir Inbox WhatsApp" and "Abrir Funil de Leads"
  [ ] Server Variables visible in workspace settings:
        OPENROUTER_API_KEY (secret, required)
        OPENROUTER_BASE_URL
        DEFAULT_MODEL_PATIENT
        DEFAULT_MODEL_INTERNAL
  [ ] A patient conversation triggers the tawany-handler LF
        (check yarn twenty dev:function:logs)
  [ ] Summarize-conversation LF runs without unhandled promise rejection
        (check yarn twenty dev:function:logs)
EOF

# Summary
section "Summary"
if (( ${#FAILED[@]} == 0 )); then
  printf "${C_BOLD}${C_GREEN}ALL CHECKS PASSED${C_RESET}\n"
  exit 0
else
  printf "${C_BOLD}${C_RED}%d CHECK(S) FAILED:${C_RESET}\n" "${#FAILED[@]}"
  for name in "${FAILED[@]}"; do
    printf "  ${C_RED}✗ %s${C_RESET}\n" "$name"
  done
  exit 1
fi
