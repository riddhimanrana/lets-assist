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

export DV_LOCAL_TEST_PASSWORD="${DV_LOCAL_TEST_PASSWORD:-robo6737}"

run_step "Local Supabase Replay + Fixtures" bun run supabase
run_step "Supabase Advisors" bun run db:advisors
run_step "Supabase Architecture Audit" bun run db:audit:architecture
run_step "Plugin Data Isolation Audit" bun run db:audit:plugin-isolation
run_step "Plugin Data Access Audit" bun run plugin:audit:data-access
run_step "Plugin Registry Gates" bun run plugin:test:registry
run_step "Plugin Runtime Contracts" bun run plugin:test:contracts
run_step "Private Plugin Submodule Strict Check" bun run plugin:submodules:check:strict
run_step "Typecheck" bun run typecheck
run_step "Lint" bun run lint
run_step "Stop Existing Next Dev Server" node scripts/local-dev/stop-next-dev.mjs
run_step "Plugin Login/API Isolation Browser Smoke" bun run plugin:test:isolation
run_step "Stop Existing Next Dev Server" node scripts/local-dev/stop-next-dev.mjs
run_step "Cron Route Smoke" bun run dev:test:cron
run_step "Supabase Remote Server-Only Readiness Audit" bun run db:audit:remote-readiness

echo
echo "PASS: Supabase redesign verification gate completed."
