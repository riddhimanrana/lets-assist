#!/usr/bin/env bash
set -euo pipefail

# Real PostgreSQL sessions against one owned isolated stack, because a lock is
# not proved by grepping for its name and a race is not proved by sleeping.
#
# Checks:
#   1. a real sync and a real release of the same term serialize on the term
#      lock, and the state they leave is one a serial order could have produced;
#   2. a rejection correction racing a release of the same acceptance converges
#      on rejected either way, with exactly one receipt;
#   3. a release whose actor loses decide_applications while it is demonstrably
#      blocked on the staff-access lock is refused by the recheck;
#   4. two mapping saves that are both inside the function holding the same
#      version do not both win.
#
# Usage:
#   CSF_ISOLATED_WORK_DIR=<work dir printed by the isolated launcher> \
#     scripts/csf/check-decision-concurrency.sh
#
# This is read-write. It refuses anything but a marker-validated CSF isolated
# stack on loopback, and it refuses before it opens a connection. Every fixture
# identifier and every session name is minted per run, so parallel runs cannot
# see each other's barriers and no check deletes by organization name.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

# ---------------------------------------------------------------------------
# Refuse a stack this script does not own, before any SQL
#
# getCsfIsolatedSupabaseEnv requires CSF_ISOLATED_WORK_DIR, validates the
# generated marker down to its ready state and project id, and refuses a
# non-loopback Postgres URL. A hosted URL, a shared local stack, a missing
# marker, or a marker that disagrees with a provided bundle all throw here,
# which is before the first connection is opened.
# ---------------------------------------------------------------------------

if [[ -z "${CSF_ISOLATED_WORK_DIR:-}" ]]; then
  echo "Refusing to run: set CSF_ISOLATED_WORK_DIR to the work directory the isolated launcher printed." >&2
  exit 2
fi

if ! ISOLATED_JSON="$(
  node --input-type=module -e '
    import {
      getCsfIsolatedSupabaseEnv,
      inspectCsfIsolatedWorkDir,
    } from "./scripts/local-dev/dv-local-env.mjs";
    const stack = inspectCsfIsolatedWorkDir(process.env.CSF_ISOLATED_WORK_DIR);
    const env = getCsfIsolatedSupabaseEnv();
    process.stdout.write(
      JSON.stringify({
        dbUrl: env.dbUrl,
        projectId: stack.projectId,
        runId: stack.runId,
      }),
    );
  ' 2>&1
)"; then
  echo "Refusing to run: the CSF isolated stack did not validate." >&2
  echo "${ISOLATED_JSON}" | sed 's/^/  /' >&2
  exit 2
fi

read_json_field() {
  node --input-type=module -e '
    let raw = "";
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      process.stdout.write(String(JSON.parse(raw)[process.argv[1]] ?? ""));
    });
  ' "$1" <<<"${ISOLATED_JSON}"
}

DATABASE_URL="$(read_json_field dbUrl)"
STACK_PROJECT_ID="$(read_json_field projectId)"
STACK_RUN_ID="$(read_json_field runId)"

# A literal second reading of the string that is about to be handed to psql, so
# a future change to the resolver cannot quietly widen what this connects to.
case "${DATABASE_URL}" in
  postgresql://postgres:*@127.0.0.1:*/*|postgresql://postgres:*@localhost:*/*|postgres://postgres:*@127.0.0.1:*/*|postgres://postgres:*@localhost:*/*) ;;
  *)
    echo "Refusing to run: the resolved database URL is not loopback Postgres." >&2
    exit 2
    ;;
esac

if [[ -z "${STACK_PROJECT_ID}" || -z "${STACK_RUN_ID}" ]]; then
  echo "Refusing to run: the isolated marker carries no project or run identity." >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required." >&2
  exit 2
fi

# Every connection this script opens is bounded, including the probes and the
# teardown. A holder sleeps for at most 120 seconds, so the statement ceiling
# sits above that and still ends a session nothing releases. The lock ceiling is
# well above the time a barrier needs, so it only fires when something is stuck.
export PGOPTIONS='-c statement_timeout=180000 -c lock_timeout=150000 -c idle_in_transaction_session_timeout=180000'

# ---------------------------------------------------------------------------
# Run-scoped synthetic identities
#
# The first group is eight characters: 'fc', one discriminator, five zeros. An
# identifier that is not a valid UUID is rejected by the column type, so the
# shape is checked here rather than discovered mid-run.
# ---------------------------------------------------------------------------

RUN_SUFFIX="$(
  node -e 'process.stdout.write(crypto.randomUUID().replace(/-/g, "").slice(0, 12))'
)"
fixture_id() { printf 'fc%s00000-0000-4000-8000-%s' "$1" "${RUN_SUFFIX}"; }

# A named session, unique to this run. Two runs against one stack must not see
# each other waiting and call it their own barrier.
session_name() { printf 'csf_%s_%s' "$1" "${RUN_SUFFIX}"; }

ORG_ID="$(fixture_id 1)"
ACTOR_ID="$(fixture_id 0)"
TERM_ID="$(fixture_id 2)"
PROFILE_ID="$(fixture_id 3)"
SOURCE_ID="$(fixture_id 4)"
COHORT_ID="$(fixture_id 5)"
APPLICATION_ID="$(fixture_id 6)"
ACTOR_EMAIL="csf-concurrency-${RUN_SUFFIX}@local.test"

# The provenance the sync has to match. The application records this workbook
# and this response id, and the stage function accepts a fallback match only
# when both agree with the evidence it is given.
WORKBOOK_FILE_ID="fc-workbook-${RUN_SUFFIX}"
RESPONSE_ID="fc-response-${RUN_SUFFIX}"

for candidate in "${ORG_ID}" "${ACTOR_ID}" "${TERM_ID}" "${PROFILE_ID}" \
  "${SOURCE_ID}" "${COHORT_ID}" "${APPLICATION_ID}"; do
  if [[ ! "${candidate}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    echo "Refusing to run: minted identifier is not a UUID: ${candidate}" >&2
    exit 2
  fi
done

WORK_DIR="$(mktemp -d)"
KEEP_EVIDENCE=false
failures=0

# Sessions that hold a lock on purpose. A barrier that fails exits early, and a
# holder left running would keep its lock while teardown tried to delete the
# rows underneath it, so the trap releases every registered holder first.
HELD_SESSIONS=()

report() {
  local outcome="$1" title="$2"
  if [[ "${outcome}" == "pass" ]]; then
    echo "PASS: ${title}"
  else
    echo "FAIL: ${title}"
    failures=$((failures + 1))
    KEEP_EVIDENCE=true
  fi
}

psql_quiet() { psql "${DATABASE_URL}" -X -q -v ON_ERROR_STOP=1 "$@"; }
psql_value() { psql "${DATABASE_URL}" -X -At -v ON_ERROR_STOP=1 "$@"; }

# ---------------------------------------------------------------------------
# Teardown by explicit identifier, and it reports failure
#
# Nothing deletes by organization name: a name is not an identity, and a blanket
# delete would take a fixture some other run owns. Deleting the organization
# cascades the CSF rows, and the auth user is removed by its own minted id.
# ---------------------------------------------------------------------------

teardown() {
  local status=0
  if ! psql_quiet -v org_id="${ORG_ID}" -v actor_id="${ACTOR_ID}" <<'SQL'
DELETE FROM public.organizations WHERE id = :'org_id'::uuid;
DELETE FROM auth.users WHERE id = :'actor_id'::uuid;
SQL
  then
    status=1
  fi

  local leftover
  leftover="$(
    psql "${DATABASE_URL}" -X -At \
      -c "SELECT
            (SELECT count(*) FROM public.organizations WHERE id = '${ORG_ID}')
          + (SELECT count(*) FROM auth.users WHERE id = '${ACTOR_ID}');" \
      2>/dev/null || echo "unknown"
  )"
  if [[ "${leftover}" != "0" ]]; then
    echo "Teardown did not remove every fixture row (remaining: ${leftover})." >&2
    status=1
  fi
  return "${status}"
}

release_all_holders() {
  local entry app_name shell_pid
  for entry in "${HELD_SESSIONS[@]+"${HELD_SESSIONS[@]}"}"; do
    app_name="${entry%%:*}"
    shell_pid="${entry##*:}"
    release_holder "${app_name}" "${shell_pid}" >/dev/null 2>&1 || true
  done
  HELD_SESSIONS=()
}

on_exit() {
  local exit_code=$?
  release_all_holders
  if ! teardown; then
    echo "FAIL: the fixture could not be torn down cleanly." >&2
    KEEP_EVIDENCE=true
    [[ "${exit_code}" -eq 0 ]] && exit_code=1
  fi
  if [[ "${KEEP_EVIDENCE}" == "true" ]]; then
    echo "Session output kept for inspection: ${WORK_DIR}" >&2
  else
    rm -rf "${WORK_DIR}"
  fi
  exit "${exit_code}"
}
trap on_exit EXIT

# ---------------------------------------------------------------------------
# Barriers
#
# Every handshake polls pg_stat_activity for this run's named sessions. Waiting
# on a lock can surface as more than one wait event, so the allowed set is
# passed in rather than guessed: a second waiter for a row may report either
# transactionid or tuple depending on which queue it joined.
#
# `await_all_waiting` counts the whole group in ONE query. Polling each session
# in turn would accept a sequential wake, where the first finished before the
# second arrived, and report it as a simultaneous barrier.
# ---------------------------------------------------------------------------

quote_sql_list() {
  local joined=""
  for value in "$@"; do
    joined+="${joined:+, }'${value}'"
  done
  printf '%s' "${joined}"
}

await_all_waiting() {
  local expected_count="$1" wait_types="$2" wait_events="$3"
  shift 3
  local names_list
  names_list="$(quote_sql_list "$@")"
  local attempt observed
  for ((attempt = 0; attempt < 300; attempt += 1)); do
    observed="$(
      psql "${DATABASE_URL}" -X -At -c "
        SELECT count(DISTINCT application_name)
        FROM pg_catalog.pg_stat_activity
        WHERE application_name IN (${names_list})
          AND wait_event_type IN (${wait_types})
          AND wait_event IN (${wait_events})
          AND xact_start IS NOT NULL;" 2>/dev/null || echo "0"
    )"
    [[ "${observed}" == "${expected_count}" ]] && return 0
    sleep 0.05
  done
  return 1
}

# The backend behind one of this run's named sessions. Killing the shell wrapper
# does not necessarily end the backend, so a holder is released by cancelling
# the backend it owns rather than by signalling psql.
backend_pid_for() {
  psql "${DATABASE_URL}" -X -At -c "
    SELECT pid FROM pg_catalog.pg_stat_activity
    WHERE application_name = '$1' AND xact_start IS NOT NULL
    ORDER BY backend_start LIMIT 1;" 2>/dev/null || true
}

# Cancel the holder's own backend, then confirm it is gone. A holder that is
# still there has not released its lock, and every wait after that would be
# measuring the wrong thing.
release_holder() {
  local app_name="$1" shell_pid="$2"
  local pid attempt still
  pid="$(backend_pid_for "${app_name}")"
  if [[ -z "${pid}" ]]; then
    echo "Could not find the backend for ${app_name}." >&2
    return 1
  fi
  psql "${DATABASE_URL}" -X -At \
    -c "SELECT pg_catalog.pg_cancel_backend(${pid});" >/dev/null 2>&1 || true
  for ((attempt = 0; attempt < 200; attempt += 1)); do
    still="$(
      psql "${DATABASE_URL}" -X -At \
        -c "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE pid = ${pid};" \
        2>/dev/null || echo "1"
    )"
    [[ "${still}" == "0" ]] && break
    if [[ "${attempt}" -eq 100 ]]; then
      psql "${DATABASE_URL}" -X -At \
        -c "SELECT pg_catalog.pg_terminate_backend(${pid});" >/dev/null 2>&1 || true
    fi
    sleep 0.05
  done
  wait "${shell_pid}" 2>/dev/null || true
  local remaining=() entry
  for entry in "${HELD_SESSIONS[@]+"${HELD_SESSIONS[@]}"}"; do
    [[ "${entry}" == "${app_name}:${shell_pid}" ]] || remaining+=("${entry}")
  done
  HELD_SESSIONS=("${remaining[@]+"${remaining[@]}"}")
  [[ "${still}" == "0" ]]
}

# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------

echo "CSF decision concurrency"
echo "stack ${STACK_PROJECT_ID} run ${STACK_RUN_ID}"

psql_quiet \
  -v org_id="${ORG_ID}" -v actor_id="${ACTOR_ID}" -v term_id="${TERM_ID}" \
  -v profile_id="${PROFILE_ID}" -v source_id="${SOURCE_ID}" \
  -v cohort_id="${COHORT_ID}" -v application_id="${APPLICATION_ID}" \
  -v actor_email="${ACTOR_EMAIL}" -v join_code="${RUN_SUFFIX:0:6}" \
  -v workbook_file_id="${WORKBOOK_FILE_ID}" -v response_id="${RESPONSE_ID}" <<'SQL'
BEGIN;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES (:'actor_id'::uuid, 'authenticated', 'authenticated',
  :'actor_email', now(), '{}', '{}', now(), now());
-- The username takes the last twelve characters of the flattened organization
-- id, which is where the minted run suffix lives. The leading twelve are the
-- discriminator and the fixed version and variant nibbles, so `left` would have
-- produced the same username on every run and the second run would collide.
-- lib/organization/username-fixtures.test.ts resolves both ends.
INSERT INTO public.organizations (id, name, username, type, join_code)
SELECT
  organization_id,
  'CSF Decision Concurrency',
  'csf-decision-conc-' || right(replace(organization_id::text, '-', ''), 12),
  'school',
  :'join_code'
FROM (SELECT :'org_id'::uuid AS organization_id) AS fixture;
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (:'org_id'::uuid, :'actor_id'::uuid, 'admin', 'active');
INSERT INTO plugin_data.csf_terms (id, organization_id, code, label,
  school_year, semester, is_current, application_review_source)
VALUES (:'term_id'::uuid, :'org_id'::uuid, 'F33', 'Fall 2033', '2033-2034',
  'fall', true, 'sheet');
INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label, status)
VALUES (:'cohort_id'::uuid, :'org_id'::uuid, 2037, 'c/o 2037', 'active');
INSERT INTO plugin_data.csf_profiles (id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name)
VALUES (:'profile_id'::uuid, :'org_id'::uuid, 'Concurrent', 'Applicant',
  'concurrent', 'applicant');
INSERT INTO plugin_data.csf_sheet_sources (id, organization_id, title, provider,
  source_type, drive_file_id, spreadsheet_id)
VALUES (:'source_id'::uuid, :'org_id'::uuid, 'Fall 2033 applications',
  'google_sheets', 'application_responses',
  :'workbook_file_id', :'workbook_file_id');
-- source_file_id and google_form_response_id are the provenance the stage
-- function verifies. They must agree with the evidence the sync sends or the
-- row is stored unmatched and no decision moves.
INSERT INTO plugin_data.csf_term_applications (id, organization_id, profile_id,
  cohort_id, term_id, source, status, source_file_id, source_sheet_tab,
  source_row_number, google_form_response_id)
VALUES (:'application_id'::uuid, :'org_id'::uuid, :'profile_id'::uuid,
  :'cohort_id'::uuid, :'term_id'::uuid, 'google_form_sheet', 'submitted',
  :'workbook_file_id', 'Form Responses 1', 5, :'response_id');
COMMIT;
SQL

# The mapping shape the private parser actually reads, not the shape the root
# SQL happens to tolerate. `csf_set_application_decision_mapping` only checks
# that identityColumns, scope, and colors are objects, so a malformed mapping is
# stored without complaint and only fails later when a reader wants a field that
# is not there. `parseCsfSheetDecisionMapping` in
# services/sheet-decision-colors.ts is the contract: scope carries sheetTabName,
# rangeA1, and headerRow; identityColumns carries email, submittedAt, and
# responseId; colors carries the four explicit fill lists including the fills
# that mean nothing. The version the caller believes it is replacing goes last.
psql_quiet -v org_id="${ORG_ID}" -v actor_id="${ACTOR_ID}" -v source_id="${SOURCE_ID}" <<'SQL'
SELECT plugin_data.csf_set_application_decision_mapping(
  :'org_id'::uuid, :'actor_id'::uuid, :'source_id'::uuid,
  jsonb_build_object(
    'decisionColumns', jsonb_build_array(7),
    'reasonColumns', jsonb_build_array(8),
    'readsCellNote', true,
    'identityColumns', jsonb_build_object(
      'email', 2, 'submittedAt', 1, 'responseId', 3
    ),
    'scope', jsonb_build_object(
      'sheetTabName', 'Form Responses 1',
      'rangeA1', 'A1:W600',
      'headerRow', 1
    ),
    'colors', jsonb_build_object(
      'accepted', jsonb_build_array('#d9ead3', '#b6d7a8'),
      'rejected', jsonb_build_array('#f4cccc', '#ea9999'),
      'rejectedWithExplanation', jsonb_build_array('#fff2cc', '#ffe599'),
      'ignoredFills', jsonb_build_array('#ffffff', '#f8f9fa', '#f3f3f3')
    )
  ),
  NULL
);
SQL

# The evidence has to carry the mapping version the database currently holds.
# A stale one blocks every row of that source, which would make the checks below
# measure nothing.
MAPPING_VERSION="$(
  psql_value -v org_id="${ORG_ID}" -v source_id="${SOURCE_ID}" <<'SQL'
SELECT mapping_version FROM plugin_data.csf_application_decision_mappings
WHERE organization_id = :'org_id'::uuid AND source_id = :'source_id'::uuid;
SQL
)"
if [[ -z "${MAPPING_VERSION}" ]]; then
  echo "The fixture source has no decision mapping version." >&2
  exit 1
fi

# One staged decision to release, written through the real sync so its
# provenance is the one the database verified rather than one inserted by hand.
stage_sql() {
  local decision="$1" color="$2"
  cat <<SQL
SET statement_timeout = '60s';
SELECT plugin_data.csf_stage_sheet_application_decisions(
  :'org_id'::uuid, :'actor_id'::uuid, :'term_id'::uuid, :'run_id'::uuid,
  jsonb_build_array(jsonb_build_object(
    'sourceId', :'source_id',
    'sheetTabName', 'Form Responses 1',
    'readStatus', 'read',
    'spreadsheetFileId', :'workbook_file_id',
    'providerVersion', 'fc-v1',
    'requestedRange', 'A1:W600',
    'contentHash', 'fc-hash-${decision}',
    'mappingVersion', :'mapping_version'
  )),
  jsonb_build_array(jsonb_build_object(
    'sourceId', :'source_id',
    'sheetTabName', 'Form Responses 1',
    'observedRowNumber', 5,
    'applicationId', :'application_id',
    'responseId', :'response_id',
    'status', '${decision}',
    'observedColor', '${color}'
  ))
);
SQL
}

stage_args=(
  -v org_id="${ORG_ID}" -v actor_id="${ACTOR_ID}" -v term_id="${TERM_ID}"
  -v source_id="${SOURCE_ID}" -v application_id="${APPLICATION_ID}"
  -v workbook_file_id="${WORKBOOK_FILE_ID}" -v response_id="${RESPONSE_ID}"
  -v mapping_version="${MAPPING_VERSION}"
)

# ---------------------------------------------------------------------------
# 0. The sync actually matches and changes something
#
# Every check below rests on this. A payload whose workbook id or response id
# disagreed with the application would be stored unmatched, and a suite of
# concurrency checks over a no-op proves nothing.
# ---------------------------------------------------------------------------

SEED_RUN_ID="$(fixture_id 7)"
seed_result="$(
  psql_value "${stage_args[@]}" -v run_id="${SEED_RUN_ID}" \
    -f <(stage_sql accepted '#d9ead3')
)"

seed_changed="$(
  psql_value -v org_id="${ORG_ID}" -v run_id="${SEED_RUN_ID}" <<'SQL'
SELECT changed_count FROM plugin_data.csf_application_decision_sync_runs
WHERE organization_id = :'org_id'::uuid AND request_id = :'run_id'::uuid;
SQL
)"
seed_basis="$(
  psql_value -v org_id="${ORG_ID}" -v application_id="${APPLICATION_ID}" <<'SQL'
SELECT staged_decision FROM plugin_data.csf_application_decision_stages
WHERE organization_id = :'org_id'::uuid AND application_id = :'application_id'::uuid;
SQL
)"

if [[ "${seed_changed}" == "1" && "${seed_basis}" == "accepted" ]]; then
  report pass "the sync matched the application by recorded provenance and staged it"
else
  echo "  changed=${seed_changed} staged=${seed_basis}" >&2
  echo "${seed_result}" | sed 's/^/  /' >&2
  report fail "the sync matched the application by recorded provenance and staged it"
fi

# ---------------------------------------------------------------------------
# 1. A rejection correction racing a release of the same acceptance
#
# A third session holds the term lock. The real sync correcting the row to
# rejected and the real release publishing the acceptance both start, and both
# must be observed waiting on that lock at the same moment before it is freed.
#
# Either serial order is allowed and both end rejected: release first publishes
# the acceptance and the correction then revokes it; correction first restages
# rejected and the release publishes that. What is not allowed is a published
# acceptance sitting under a staged rejection, or two receipts.
# ---------------------------------------------------------------------------

TERM_HOLDER="$(session_name term_lock_holder)"
SYNC_SESSION="$(session_name decision_sync)"
RELEASE_SESSION="$(session_name decision_release)"
CORRECTION_RUN_ID="$(fixture_id 8)"
RELEASE_REQUEST_ID="$(fixture_id 9)"

(
  PGAPPNAME="${TERM_HOLDER}" psql "${DATABASE_URL}" -X -q -v ON_ERROR_STOP=1 \
    -v org_id="${ORG_ID}" -v term_id="${TERM_ID}" <<'SQL'
BEGIN;
SELECT pg_advisory_xact_lock(
  plugin_data.csf_sheet_decision_term_lock_key(:'org_id'::uuid, :'term_id'::uuid)
);
SELECT pg_sleep(120);
COMMIT;
SQL
) >"${WORK_DIR}/holder.out" 2>"${WORK_DIR}/holder.err" &
HOLDER_PID=$!
HELD_SESSIONS+=("${TERM_HOLDER}:${HOLDER_PID}")

if ! await_all_waiting 1 "'Timeout'" "'PgSleep'" "${TERM_HOLDER}"; then
  echo "The term-lock holder never reached its hold point." >&2
  exit 1
fi

(
  PGAPPNAME="${SYNC_SESSION}" psql "${DATABASE_URL}" -X -At -v ON_ERROR_STOP=1 \
    "${stage_args[@]}" -v run_id="${CORRECTION_RUN_ID}" \
    -f <(stage_sql rejected '#f4cccc')
) >"${WORK_DIR}/sync.out" 2>"${WORK_DIR}/sync.err" &
SYNC_PID=$!

(
  PGAPPNAME="${RELEASE_SESSION}" psql "${DATABASE_URL}" -X -At -v ON_ERROR_STOP=1 \
    -v org_id="${ORG_ID}" -v actor_id="${ACTOR_ID}" -v term_id="${TERM_ID}" \
    -v request_id="${RELEASE_REQUEST_ID}" <<'SQL'
SET statement_timeout = '60s';
SELECT plugin_data.csf_release_sheet_application_decisions(
  :'org_id'::uuid, :'actor_id'::uuid, :'term_id'::uuid, :'request_id'::uuid
);
SQL
) >"${WORK_DIR}/release.out" 2>"${WORK_DIR}/release.err" &
RELEASE_PID=$!

if await_all_waiting 2 "'Lock'" "'advisory'" "${SYNC_SESSION}" "${RELEASE_SESSION}"; then
  report pass "the correction and the release wait on the term lock together"
else
  report fail "the correction and the release wait on the term lock together"
fi

if ! release_holder "${TERM_HOLDER}" "${HOLDER_PID}"; then
  echo "The term-lock holder did not release." >&2
  exit 1
fi

sync_status=0
release_status=0
wait "${SYNC_PID}" || sync_status=$?
wait "${RELEASE_PID}" || release_status=$?

if [[ "${sync_status}" -eq 0 && "${release_status}" -eq 0 ]]; then
  report pass "both contenders completed once the lock was free"
else
  echo "  sync exit ${sync_status}, release exit ${release_status}" >&2
  sed 's/^/  sync: /' "${WORK_DIR}/sync.err" >&2 || true
  sed 's/^/  release: /' "${WORK_DIR}/release.err" >&2 || true
  report fail "both contenders completed once the lock was free"
fi

# Only a state a serial order could have produced is acceptable. Both orders
# end rejected, with no active membership and exactly one receipt.
serially_valid="$(
  psql_value -v org_id="${ORG_ID}" -v term_id="${TERM_ID}" \
    -v application_id="${APPLICATION_ID}" -v profile_id="${PROFILE_ID}" <<'SQL'
WITH receipts AS (
  SELECT count(*) AS n FROM plugin_data.csf_application_decision_releases
  WHERE organization_id = :'org_id'::uuid AND term_id = :'term_id'::uuid
), stage AS (
  SELECT staged_decision, release_state, released_decision
  FROM plugin_data.csf_application_decision_stages
  WHERE organization_id = :'org_id'::uuid AND application_id = :'application_id'::uuid
), app AS (
  SELECT status FROM plugin_data.csf_term_applications
  WHERE organization_id = :'org_id'::uuid AND id = :'application_id'::uuid
), membership AS (
  SELECT count(*) FILTER (WHERE status = 'active') AS active
  FROM plugin_data.csf_term_memberships
  WHERE organization_id = :'org_id'::uuid AND term_id = :'term_id'::uuid
    AND profile_id = :'profile_id'::uuid
)
SELECT
  receipts.n = 1
  AND stage.staged_decision = 'rejected'
  AND app.status = 'rejected'
  AND membership.active = 0
  AND (stage.release_state = 'staged' OR stage.released_decision = 'rejected')
FROM receipts, stage, app, membership;
SQL
)"
if [[ "${serially_valid}" == "t" ]]; then
  report pass "the race converged on rejected with exactly one receipt"
else
  report fail "the race converged on rejected with exactly one receipt"
fi

# ---------------------------------------------------------------------------
# 2. Losing the permission while a real release is demonstrably waiting
#
# The release passes its first permission read, then blocks on the staff-access
# lock. Only once it is observed blocked is the membership revoked, so this
# proves the recheck after the lock rather than ordinary denial at the door.
# ---------------------------------------------------------------------------

STAFF_HOLDER="$(session_name staff_lock_holder)"
DEPRIVILEGED_SESSION="$(session_name release_deprivileged)"
REVOKE_REQUEST_ID="$(fixture_id a)"

(
  PGAPPNAME="${STAFF_HOLDER}" psql "${DATABASE_URL}" -X -q -v ON_ERROR_STOP=1 \
    -v org_id="${ORG_ID}" <<'SQL'
BEGIN;
SELECT pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key(:'org_id'::uuid)
);
SELECT pg_sleep(120);
COMMIT;
SQL
) >"${WORK_DIR}/staff-holder.out" 2>"${WORK_DIR}/staff-holder.err" &
STAFF_HOLDER_PID=$!
HELD_SESSIONS+=("${STAFF_HOLDER}:${STAFF_HOLDER_PID}")

if ! await_all_waiting 1 "'Timeout'" "'PgSleep'" "${STAFF_HOLDER}"; then
  echo "The staff-access lock holder never reached its hold point." >&2
  exit 1
fi

(
  PGAPPNAME="${DEPRIVILEGED_SESSION}" psql "${DATABASE_URL}" -X -At -v ON_ERROR_STOP=1 \
    -v org_id="${ORG_ID}" -v actor_id="${ACTOR_ID}" -v term_id="${TERM_ID}" \
    -v request_id="${REVOKE_REQUEST_ID}" <<'SQL'
SET statement_timeout = '60s';
SELECT plugin_data.csf_release_sheet_application_decisions(
  :'org_id'::uuid, :'actor_id'::uuid, :'term_id'::uuid, :'request_id'::uuid
);
SQL
) >"${WORK_DIR}/revoked.out" 2>"${WORK_DIR}/revoked.err" &
DEPRIVILEGED_PID=$!

if await_all_waiting 1 "'Lock'" "'advisory'" "${DEPRIVILEGED_SESSION}"; then
  report pass "the release reached the staff-access lock before the revocation"
else
  report fail "the release reached the staff-access lock before the revocation"
fi

# The waiter has not taken the membership row FOR SHARE yet, because it is
# still blocked on the lock that precedes that read.
psql_quiet -v org_id="${ORG_ID}" -v actor_id="${ACTOR_ID}" <<'SQL'
UPDATE public.organization_members SET status = 'inactive'
WHERE organization_id = :'org_id'::uuid AND user_id = :'actor_id'::uuid;
SQL

if ! release_holder "${STAFF_HOLDER}" "${STAFF_HOLDER_PID}"; then
  echo "The staff-access lock holder did not release." >&2
  exit 1
fi

deprivileged_status=0
wait "${DEPRIVILEGED_PID}" || deprivileged_status=$?

if [[ "${deprivileged_status}" -ne 0 ]] \
  && grep -q "Not authorized to release" "${WORK_DIR}/revoked.err"; then
  report pass "the recheck refuses a release whose actor lost the permission"
else
  echo "  exit ${deprivileged_status}" >&2
  sed 's/^/  /' "${WORK_DIR}/revoked.err" >&2 || true
  report fail "the recheck refuses a release whose actor lost the permission"
fi

no_second_receipt="$(
  psql_value -v org_id="${ORG_ID}" -v request_id="${REVOKE_REQUEST_ID}" <<'SQL'
SELECT count(*) = 0 FROM plugin_data.csf_application_decision_releases
WHERE organization_id = :'org_id'::uuid AND request_id = :'request_id'::uuid;
SQL
)"
if [[ "${no_second_receipt}" == "t" ]]; then
  report pass "the refused release wrote no receipt"
else
  report fail "the refused release wrote no receipt"
fi

psql_quiet -v org_id="${ORG_ID}" -v actor_id="${ACTOR_ID}" <<'SQL'
UPDATE public.organization_members SET status = 'active'
WHERE organization_id = :'org_id'::uuid AND user_id = :'actor_id'::uuid;
SQL

# ---------------------------------------------------------------------------
# 3. Two mapping saves, both inside the function holding the same version
#
# A third session holds the mapping row. Both savers block on it and both must
# be observed blocked in one reading before the row is freed. A second waiter
# for a row may report transactionid or tuple depending on the queue it joined,
# so both are accepted.
# ---------------------------------------------------------------------------

MAPPING_HOLDER="$(session_name mapping_row_holder)"
SAVER_ONE="$(session_name mapping_saver_one)"
SAVER_TWO="$(session_name mapping_saver_two)"

(
  PGAPPNAME="${MAPPING_HOLDER}" psql "${DATABASE_URL}" -X -q -v ON_ERROR_STOP=1 \
    -v org_id="${ORG_ID}" -v source_id="${SOURCE_ID}" <<'SQL'
BEGIN;
SELECT 1 FROM plugin_data.csf_application_decision_mappings
WHERE organization_id = :'org_id'::uuid AND source_id = :'source_id'::uuid
FOR UPDATE;
SELECT pg_sleep(120);
COMMIT;
SQL
) >"${WORK_DIR}/mapping-holder.out" 2>"${WORK_DIR}/mapping-holder.err" &
MAPPING_HOLDER_PID=$!
HELD_SESSIONS+=("${MAPPING_HOLDER}:${MAPPING_HOLDER_PID}")

if ! await_all_waiting 1 "'Timeout'" "'PgSleep'" "${MAPPING_HOLDER}"; then
  echo "The mapping row holder never reached its hold point." >&2
  exit 1
fi

mapping_save_sql() {
  cat <<'SQL'
SET statement_timeout = '60s';
SELECT plugin_data.csf_set_application_decision_mapping(
  :'org_id'::uuid, :'actor_id'::uuid, :'source_id'::uuid,
  jsonb_build_object(
    'decisionColumns', jsonb_build_array(:'column_number'::integer),
    'reasonColumns', jsonb_build_array(8),
    'readsCellNote', true,
    'identityColumns', jsonb_build_object(
      'email', 2, 'submittedAt', 1, 'responseId', 3
    ),
    'scope', jsonb_build_object(
      'sheetTabName', 'Form Responses 1',
      'rangeA1', 'A1:W600',
      'headerRow', 1
    ),
    'colors', jsonb_build_object(
      'accepted', jsonb_build_array('#d9ead3', '#b6d7a8'),
      'rejected', jsonb_build_array('#f4cccc', '#ea9999'),
      'rejectedWithExplanation', jsonb_build_array('#fff2cc', '#ffe599'),
      'ignoredFills', jsonb_build_array('#ffffff', '#f8f9fa', '#f3f3f3')
    )
  ),
  :'expected_version'::integer
);
SQL
}

SAVER_PIDS=()
saver_names=("${SAVER_ONE}" "${SAVER_TWO}")
saver_columns=(9 10)
for index in 0 1; do
  (
    PGAPPNAME="${saver_names[index]}" psql "${DATABASE_URL}" -X -At \
      -v ON_ERROR_STOP=1 -v org_id="${ORG_ID}" -v actor_id="${ACTOR_ID}" \
      -v source_id="${SOURCE_ID}" -v column_number="${saver_columns[index]}" \
      -v expected_version="${MAPPING_VERSION}" \
      -f <(mapping_save_sql)
  ) >"${WORK_DIR}/mapping-${index}.out" 2>"${WORK_DIR}/mapping-${index}.err" &
  SAVER_PIDS+=("$!")
done

if await_all_waiting 2 "'Lock'" "'transactionid', 'tuple'" \
  "${SAVER_ONE}" "${SAVER_TWO}"; then
  report pass "both mapping saves are inside the function at the same time"
else
  report fail "both mapping saves are inside the function at the same time"
fi

if ! release_holder "${MAPPING_HOLDER}" "${MAPPING_HOLDER_PID}"; then
  echo "The mapping row holder did not release." >&2
  exit 1
fi

winners=0
for pid in "${SAVER_PIDS[@]}"; do
  if wait "${pid}"; then
    winners=$((winners + 1))
  fi
done

if [[ "${winners}" -eq 1 ]]; then
  report pass "exactly one save holding the same version is accepted"
else
  report fail "exactly one save holding the same version is accepted (accepted ${winners})"
fi

final_version="$(
  psql_value -v org_id="${ORG_ID}" -v source_id="${SOURCE_ID}" <<'SQL'
SELECT mapping_version FROM plugin_data.csf_application_decision_mappings
WHERE organization_id = :'org_id'::uuid AND source_id = :'source_id'::uuid;
SQL
)"
if [[ "${final_version}" == "$((MAPPING_VERSION + 1))" ]]; then
  report pass "the mapping version advanced exactly once"
else
  report fail "the mapping version advanced exactly once (is ${final_version})"
fi

if [[ "${failures}" -gt 0 ]]; then
  echo "${failures} check(s) failed."
  exit 1
fi
echo "All decision concurrency checks passed."
