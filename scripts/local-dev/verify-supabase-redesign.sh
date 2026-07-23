#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

run_step() {
  local label="$1"
  shift

  echo
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  $label"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  "$@"
}

: "${DV_LOCAL_TEST_PASSWORD:?Set DV_LOCAL_TEST_PASSWORD to a run-scoped fixture password}"
export DV_LOCAL_TEST_PASSWORD
: "${CSF_LOCAL_TEST_PASSWORD:=${DV_LOCAL_TEST_PASSWORD}}"
export CSF_LOCAL_TEST_PASSWORD

OWNED_ISOLATED_STACK=false
if [[ -z "${CSF_ISOLATED_WORK_DIR:-}" ]]; then
  VERIFY_RUN_ID="verify-$(date +%Y%m%d%H%M%S)-$$"
  export CSF_ISOLATED_RUN_ID="${VERIFY_RUN_ID}"
  export CSF_ISOLATED_WORK_DIR="${TMPDIR:-/tmp}/lets-assist-csf-browser-${VERIFY_RUN_ID}"
  run_step \
    "Start Generated Isolated Supabase" \
    scripts/local-dev/start-dvhs-csf-isolated-stack.sh
  OWNED_ISOLATED_STACK=true
fi

cleanup() {
  if [[ "${OWNED_ISOLATED_STACK}" == true ]]; then
    scripts/local-dev/stop-dvhs-csf-isolated-stack.sh \
      --delete-workdir \
      "${CSF_ISOLATED_WORK_DIR}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

APP_ENV_FILE="${CSF_ISOLATED_WORK_DIR}/lets-assist-browser.sh"
if [[ ! -f "${APP_ENV_FILE}" ]]; then
  echo "Missing generated isolated app environment: ${APP_ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${APP_ENV_FILE}"
set +a

run_step \
  "Validate Generated Isolated Supabase Target" \
  node scripts/local-dev/dv-local-env.mjs --health
run_step "Clean Isolated Migration Replay + DB Tests" bun run csf:test:db:isolated
run_step \
  "Reset Generated Isolated Supabase" \
  supabase db reset --local --yes --workdir "${CSF_ISOLATED_WORK_DIR}"
run_step "Seed Fictional Platform Fixtures" bun run supabase:seed:local-dev
run_step "Seed Fictional DV Fixtures" bun run dv:fixtures
run_step \
  "Supabase Advisors" \
  supabase db advisors --local --output-format json --fail-on error --workdir "${CSF_ISOLATED_WORK_DIR}"
run_step "Supabase Architecture Audit" bun run db:audit:architecture
run_step "Plugin Data Isolation Audit" bun run db:audit:plugin-isolation
run_step "Plugin Data Access Audit" bun run plugin:audit:data-access
run_step "Plugin Registry Gates" bun run plugin:test:registry
run_step "Plugin Runtime Contracts" bun run plugin:test:contracts
run_step "Private Plugin Submodule Strict Check" bun run plugin:submodules:check:strict
run_step "Typecheck" bun run typecheck
run_step "Lint" bun run lint
run_step "Plugin Login/API Isolation Browser Smoke" bun run plugin:test:isolation
run_step \
  "Cron Route Smoke" \
  env CRON_TEST_BASE_URL=http://127.0.0.1:3009 bun run dev:test:cron
run_step "Supabase Remote Server-Only Readiness Audit" bun run db:audit:remote-readiness

echo
echo "PASS: Supabase redesign verification gate completed."
