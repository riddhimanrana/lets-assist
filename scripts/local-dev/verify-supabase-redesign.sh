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

# ---------------------------------------------------------------------------
# Remote readiness is a separate release gate, and it is currently blocked.
#
# scripts/audit-supabase-remote-readiness.sh is deterministically red while
# `plugin_data` remains in supabase/config.toml api.schemas, and removing that
# schema now would break the server-side service-role PostgREST reads this app
# still depends on. Running it here unconditionally made a truthful local replay
# look like a failing global readiness gate; skipping it silently would have been
# worse. So it is opt-in, validated here before a single container starts, and a
# typo is refused rather than quietly treated as "not requested".
# ---------------------------------------------------------------------------
REQUIRE_REMOTE_READINESS="${CSF_REQUIRE_REMOTE_READINESS:-}"
case "${REQUIRE_REMOTE_READINESS}" in
  "" | 1) ;;
  *)
    echo "CSF_REQUIRE_REMOTE_READINESS must be unset, empty, or exactly 1; received: ${REQUIRE_REMOTE_READINESS}" >&2
    echo "Refusing to start anything under an ambiguous remote-readiness request." >&2
    exit 1
    ;;
esac

OWNED_ISOLATED_STACK=false
CLEANUP_ATTEMPTED=false
GATE_STEPS_PASSED=false

# The final verdict is only ever printed once teardown has been accounted for, so
# a passing gate with a failing cleanup can never look like a pass.
report_outcome() {
  local final_status="$1"
  local cleanup_status="$2"

  echo
  if ((final_status == 0)) && [[ "${GATE_STEPS_PASSED}" == true ]]; then
    # Named for exactly what it covers. This gate replays migrations and SQL
    # seeds on one local isolated stack and checks the local surfaces listed
    # above; it says nothing about Production, the preview project, or remote
    # Data API readiness, so it must never print a global Supabase PASS.
    if [[ "${OWNED_ISOLATED_STACK}" == true ]]; then
      echo "PASS: DVHS CSF local isolated replay gate completed on one generated isolated stack."
    else
      echo "PASS: DVHS CSF local isolated replay gate completed on one caller-owned prepared stack."
    fi
    echo "Scope: local isolated replay only. Not a Supabase, Production, or preview readiness result."
    return 0
  fi

  if [[ "${GATE_STEPS_PASSED}" == true ]] && ((cleanup_status != 0)); then
    echo "FAIL: gate steps passed, but isolated stack cleanup failed." >&2
  else
    echo "FAIL: DVHS CSF local isolated replay gate did not complete." >&2
  fi
}

# One launcher-owned stack and one target identity for the whole gate. Teardown
# failure is never swallowed: capture the primary status, disable recursive
# traps, attempt cleanup exactly once, then choose the final status.
on_exit() {
  local status=$?
  local cleanup_status=0

  trap - EXIT HUP INT TERM

  if [[ "${CLEANUP_ATTEMPTED}" == true ]]; then
    exit "${status}"
  fi
  CLEANUP_ATTEMPTED=true

  # A caller-supplied prepared stack is never stopped, reset, or deleted here.
  if [[ "${OWNED_ISOLATED_STACK}" != true ]]; then
    report_outcome "${status}" 0
    exit "${status}"
  fi

  echo
  echo "Stopping the generated isolated stack this gate created."
  if scripts/local-dev/stop-dvhs-csf-isolated-stack.sh \
    --delete-workdir \
    "${CSF_ISOLATED_WORK_DIR}"; then
    cleanup_status=0
  else
    cleanup_status=$?
    if ((cleanup_status == 0)); then
      cleanup_status=1
    fi
  fi

  if ((cleanup_status != 0)); then
    echo "FAIL: isolated stack teardown failed with status ${cleanup_status}." >&2
    echo "Marker-bounded cleanup evidence is printed above and retained in ${CSF_ISOLATED_WORK_DIR}." >&2
    if ((status != 0)); then
      echo "Preserving the original gate failure status ${status}." >&2
      report_outcome "${status}" "${cleanup_status}"
      exit "${status}"
    fi
    report_outcome "${cleanup_status}" "${cleanup_status}"
    exit "${cleanup_status}"
  fi

  report_outcome "${status}" 0
  exit "${status}"
}
trap on_exit EXIT
trap 'exit 130' HUP INT
trap 'exit 143' TERM

if [[ -z "${CSF_ISOLATED_WORK_DIR:-}" ]]; then
  # 16 characters total keeps the launcher's 1-16 contract satisfied, and 56
  # random bits keep the derived Docker project/volume identity unique when
  # concurrent gates run on the same host.
  VERIFY_RUN_ID="vf$(node -e 'process.stdout.write(require("node:crypto").randomBytes(7).toString("hex"));')"
  if [[ ! "${VERIFY_RUN_ID}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$ ]]; then
    echo "Generated verifier run ID does not satisfy the launcher contract: ${VERIFY_RUN_ID}" >&2
    exit 1
  fi
  export CSF_ISOLATED_RUN_ID="${VERIFY_RUN_ID}"
  export CSF_ISOLATED_WORK_DIR="${TMPDIR:-/tmp}/lets-assist-csf-browser-${VERIFY_RUN_ID}"
  if [[ -e "${CSF_ISOLATED_WORK_DIR}" || -L "${CSF_ISOLATED_WORK_DIR}" ]]; then
    echo "Generated isolated work directory already exists: ${CSF_ISOLATED_WORK_DIR}" >&2
    exit 1
  fi
  # A new launcher-owned stack means a new database volume, so the CLI applies
  # the current timestamped migrations and the configured SQL seed paths exactly
  # once. No reset, linked command, shared stack, or nested replay is involved.
  run_step \
    "Start One Generated Isolated Supabase (new volume: migrations + configured SQL seeds)" \
    scripts/local-dev/start-dvhs-csf-isolated-stack.sh
  OWNED_ISOLATED_STACK=true
  ISOLATED_STACK_ORIGIN="generated clean migration replay"
else
  ISOLATED_STACK_ORIGIN="caller-owned prepared stack"
fi

if [[ "${OWNED_ISOLATED_STACK}" == true ]]; then
  APP_ENV_STEP_LABEL="Validate And Load Generated Isolated App Environment (no execution, exact bytes)"
  WORKFLOW_STEP_LABEL="Validate CSF Database Workflows On The Generated Stack (database-only unless CSF_APP_URL is set)"
  TARGET_STEP_LABEL="Validate Live Generated Isolated Target And Marker Identity"
  PGTAP_STEP_LABEL="pgTAP On The Same Running Generated Stack (no reset, no second project)"
else
  APP_ENV_STEP_LABEL="Validate And Load Prepared-Stack App Environment (no execution, exact bytes)"
  WORKFLOW_STEP_LABEL="Validate CSF Database Workflows On The Prepared Stack (database-only unless CSF_APP_URL is set)"
  TARGET_STEP_LABEL="Validate Live Prepared-Stack Target And Marker Identity"
  PGTAP_STEP_LABEL="pgTAP On The Same Running Prepared Stack (no reset, no second project)"
fi
echo
echo "DVHS CSF local isolated replay gate"
echo "Isolated stack origin: ${ISOLATED_STACK_ORIGIN}"
echo "Isolated work directory: ${CSF_ISOLATED_WORK_DIR}"

# Static file/permission/identity validation runs before anything live. The
# loader below never sources, executes, or re-opens the pathname it validated:
# it emits only the exact bytes that passed its own held-descriptor recheck.
load_validated_app_environment() {
  local assignment key value validated
  local expected_keys=""
  expected_keys="${expected_keys} API_URL ANON_KEY SERVICE_ROLE_KEY DB_URL"
  expected_keys="${expected_keys} SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_DB_URL"
  expected_keys="${expected_keys} NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY"
  expected_keys="${expected_keys} NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  expected_keys="${expected_keys} SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY"
  expected_keys="${expected_keys} CSF_PROFILE_CLAIM_SECRET CSF_ISOLATED_WORK_DIR"
  expected_keys="${expected_keys} NEXT_PUBLIC_SITE_URL SITE_URL NEXT_PUBLIC_VERCEL_URL"

  if ! validated="$(node scripts/local-dev/dv-local-env.mjs --print-app-env)"; then
    echo "Generated isolated app environment failed non-executing validation." >&2
    return 1
  fi

  while IFS= read -r assignment; do
    if [[ -z "${assignment}" ]]; then
      continue
    fi
    key="${assignment%%=*}"
    value="${assignment#*=}"
    case " ${expected_keys} " in
      *" ${key} "*) ;;
      *)
        echo "Refusing an unexpected isolated app environment key: ${key}" >&2
        return 1
        ;;
    esac
    export "${key}=${value}"
  done <<EOF
${validated}
EOF
}

run_step "${APP_ENV_STEP_LABEL}" load_validated_app_environment
run_step "${TARGET_STEP_LABEL}" node scripts/local-dev/dv-local-env.mjs --csf-health
run_step "${PGTAP_STEP_LABEL}" supabase test db --workdir "${CSF_ISOLATED_WORK_DIR}"
# The isolated seed script only. It carries PLATFORM_SEED_MODE=csf-isolated-v1,
# which refuses to run at all without a validated CSF_ISOLATED_WORK_DIR, and it
# is the only mode that seeds DVHS CSF data. The shared-local mode is shared
# local, non-CSF only, so neither script can touch the shared 54321 stack's CSF
# tables from here.
run_step "Seed Fictional Platform Fixtures (isolated mode, deterministic synthetic DVHS CSF records)" bun run csf:seed:platform:isolated
run_step "Seed Fictional DV Fixtures (JavaScript-managed records)" bun run dv:fixtures
run_step "${WORKFLOW_STEP_LABEL}" bun run csf:test:workflows
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
# The harness owns its own server on its own claimed port and refuses to adopt
# one, so no base URL is supplied and none may be. Its scope is exactly the five
# selected worker routes: auto-publish-hours, project-cancellations,
# organization-calendar-sync, organization-sheet-sync, and data-exports.
run_step \
  "Cron Auth/Shape Smoke — five selected worker routes (no dispatch, no egress)" \
  bun run dev:test:cron

if [[ "${REQUIRE_REMOTE_READINESS}" == "1" ]]; then
  # Unchanged audit, explicitly requested. Its failure propagates.
  run_step \
    "Supabase Remote Server-Only Readiness Audit (explicitly required)" \
    bun run db:audit:remote-readiness
else
  echo
  echo "Remote readiness: NOT EVALUATED — separate blocked release gate."
fi

GATE_STEPS_PASSED=true
echo
echo "All gate steps completed against ${ISOLATED_STACK_ORIGIN}; accounting for teardown."
echo
echo "This gate does NOT cover:"
echo "  - next build or any production build output"
echo "  - the full private-plugin corpus (only the registry, contract, and strict submodule gates run)"
echo "  - scale (bun run csf:test:scale)"
echo "  - the full CSF E2E suite, the action matrix, or screenshots (bun run csf:test:e2e)"
echo "  - public route proof, unless CSF_APP_URL was supplied to csf:test:workflows"
echo "  - the six cron routes outside the five-route harness: ai-moderation, anonymous-cleanup,"
echo "    csf-communications-dispatch, csf-proof-cleanup, generate-recurring-projects, waiver-cleanup"
echo "  - Production, the preview project, or any provider (Resend, Google, Gmail, Drive, Calendar)"
