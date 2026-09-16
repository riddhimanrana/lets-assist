#!/usr/bin/env bash
set -euo pipefail

# Two and three real PostgreSQL sessions against one owned isolated stack,
# because a lock is not proved by grepping for its name and a race is not proved
# by sleeping.
#
# Checks:
#   1. a real sync and a real release of the same term serialize on the term
#      lock, and the state they leave is coherent rather than torn;
#   2. a release whose actor loses `decide_applications` WHILE it is
#      demonstrably blocked on the staff-access lock is refused by the recheck,
#      and publishes nothing;
#   3. two mapping saves that are both inside the function holding version 1 do
#      not both win.
#
# Usage:
#   CSF_ISOLATED_WORK_DIR=<work dir printed by the isolated launcher> \
#     scripts/csf/check-decision-concurrency.sh
#
# This is read-write. It refuses to run against anything but a marker-validated
# CSF isolated stack on loopback, and it refuses before it opens a connection.
# Every fixture identifier is minted per run, so two runs cannot collide and no
# check deletes by organization name.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

# ---------------------------------------------------------------------------
# Refuse a stack this script does not own, before any SQL
#
# `getCsfIsolatedSupabaseEnv` requires CSF_ISOLATED_WORK_DIR, validates the
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
        databasePort: stack.databasePort,
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

# Belt and braces. The validator above already refuses a non-loopback host; this
# is a literal second reading of the string that is about to be handed to psql,
# so a future change to the resolver cannot quietly widen what this script will
# connect to.
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

# ---------------------------------------------------------------------------
# Run-scoped synthetic identities
# ---------------------------------------------------------------------------

RUN_SUFFIX="$(
  node -e 'process.stdout.write(crypto.randomUUID().replace(/-/g, "").slice(0, 12))'
)"
fixture_id() { printf 'fc%s0000-0000-4000-8000-%s' "$1" "${RUN_SUFFIX}"; }

ORG_ID="$(fixture_id 1)"
ACTOR_ID="$(fixture_id 0)"
TERM_ID="$(fixture_id 2)"
PROFILE_ID="$(fixture_id 3)"
SOURCE_ID="$(fixture_id 4)"
COHORT_ID="$(fixture_id 5)"
APPLICATION_ID="$(fixture_id 6)"
ACTOR_EMAIL="csf-concurrency-${RUN_SUFFIX}@local.test"

WORK_DIR="$(mktemp -d)"
KEEP_EVIDENCE=false
failures=0

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
# Teardown by explicit identifier, in dependency order, and it reports failure
#
# Nothing here deletes by organization name: a name is not an identity, and a
# blanket delete would take a fixture some other run owns. Deleting the
# organization cascades the CSF rows, and the auth user is removed by its own
# minted id rather than left behind.
# ---------------------------------------------------------------------------

teardown() {
  local status=0
  if ! psql_quiet \
    -v org_id="${ORG_ID}" -v actor_id="${ACTOR_ID}" <<'SQL'
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

on_exit() {
  local exit_code=$?
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
# Every handshake below polls pg_stat_activity for a named session in a named
# wait state. No step is timed by sleeping, because a sleep proves only that
# time passed.
# ---------------------------------------------------------------------------

await_wait_state() {
  local app_name="$1" wait_type="$2" wait_event="$3" pid_to_watch="${4:-}"
  local attempt observed
  for ((attempt = 0; attempt < 200; attempt += 1)); do
    observed="$(
      psql "${DATABASE_URL}" -X -At -c "
        SELECT EXISTS (
          SELECT 1 FROM pg_catalog.pg_stat_activity
          WHERE application_name = '${app_name}'
            AND wait_event_type = '${wait_type}'
            AND wait_event = '${wait_event}'
            AND xact_start IS NOT NULL
        );" 2>/dev/null || echo "f"
    )"
    [[ "${observed}" == "t" ]] && return 0
    if [[ -n "${pid_to_watch}" ]] && ! kill -0 "${pid_to_watch}" 2>/dev/null; then
      return 1
    fi
    sleep 0.05
  done
  return 1
}

await_advisory_wait() { await_wait_state "$1" Lock advisory "${2:-}"; }

# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------

echo "━━━ CSF decision concurrency ━━━"
echo "stack ${STACK_PROJECT_ID} run ${STACK_RUN_ID}"

psql_quiet \
  -v org_id="${ORG_ID}" -v actor_id="${ACTOR_ID}" -v term_id="${TERM_ID}" \
  -v profile_id="${PROFILE_ID}" -v source_id="${SOURCE_ID}" \
  -v cohort_id="${COHORT_ID}" -v application_id="${APPLICATION_ID}" \
  -v actor_email="${ACTOR_EMAIL}" -v join_code="${RUN_SUFFIX:0:6}" <<'SQL'
BEGIN;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES (:'actor_id'::uuid, 'authenticated', 'authenticated',
  :'actor_email', now(), '{}', '{}', now(), now());
-- The username is derived from the organization id the same way
-- `csf_term_close_serialization` derives its own, so it is unique per run and
-- still a form `lib/organization/username-fixtures.test.ts` can resolve and
-- check against the product schema.
INSERT INTO public.organizations (id, name, username, type, join_code)
SELECT
  fixture.organization_id,
  'CSF Decision Concurrency',
  'csf-decision-conc-' || left(replace(organization_id::text, '-', ''), 12),
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
  'fc-workbook-' || :'join_code', 'fc-workbook-' || :'join_code');
INSERT INTO plugin_data.csf_term_applications (id, organization_id, profile_id,
  cohort_id, term_id, source, status, source_file_id, source_sheet_tab,
  source_row_number, google_form_response_id)
VALUES (:'application_id'::uuid, :'org_id'::uuid, :'profile_id'::uuid,
  :'cohort_id'::uuid, :'term_id'::uuid, 'google_form_sheet', 'submitted',
  'fc-workbook-' || :'join_code', 'Form Responses 1', 5,
  'fc-response-' || :'join_code');
INSERT INTO plugin_data.csf_application_decision_stages (organization_id,
  application_id, term_id, profile_id, source_id, staged_decision, observed_color)
VALUES (:'org_id'::uuid, :'application_id'::uuid, :'term_id'::uuid,
  :'profile_id'::uuid, :'source_id'::uuid, 'accepted', '#d9ead3');
COMMIT;
SQL

# ---------------------------------------------------------------------------
# 1. A real sync and a real release of one term serialize
#
# A third session holds the term lock, then the actual staging and release
# functions are started together. Both must be observed waiting on an advisory
# lock before the holder lets go, which is what proves they contend on the same
# key rather than merely finishing in some order.
# ---------------------------------------------------------------------------

SYNC_RUN_ID="$(fixture_id 7)"
RELEASE_REQUEST_ID="$(fixture_id 8)"

(
  PGAPPNAME=csf_term_lock_holder psql "${DATABASE_URL}" -X -q -v ON_ERROR_STOP=1 \
    -v org_id="${ORG_ID}" -v term_id="${TERM_ID}" <<'SQL'
BEGIN;
SELECT pg_advisory_xact_lock(
  plugin_data.csf_sheet_decision_term_lock_key(:'org_id'::uuid, :'term_id'::uuid)
);
SELECT pg_sleep(30);
COMMIT;
SQL
) >"${WORK_DIR}/holder.out" 2>"${WORK_DIR}/holder.err" &
HOLDER_PID=$!

if ! await_wait_state csf_term_lock_holder Timeout PgSleep "${HOLDER_PID}"; then
  echo "The term-lock holder never reached its hold point." >&2
  kill "${HOLDER_PID}" 2>/dev/null || true
  exit 1
fi

(
  PGAPPNAME=csf_decision_sync psql "${DATABASE_URL}" -X -At -v ON_ERROR_STOP=1 \
    -v org_id="${ORG_ID}" -v actor_id="${ACTOR_ID}" -v term_id="${TERM_ID}" \
    -v run_id="${SYNC_RUN_ID}" -v source_id="${SOURCE_ID}" \
    -v application_id="${APPLICATION_ID}" <<'SQL'
SET statement_timeout = '60s';
SELECT plugin_data.csf_stage_sheet_application_decisions(
  :'org_id'::uuid, :'actor_id'::uuid, :'term_id'::uuid, :'run_id'::uuid,
  jsonb_build_array(jsonb_build_object(
    'sourceId', :'source_id',
    'sheetTabName', 'Form Responses 1',
    'readStatus', 'read',
    'spreadsheetFileId', 'fc-workbook',
    'providerVersion', 'fc-v1',
    'requestedRange', 'A1:W600',
    'contentHash', 'fc-hash',
    'mappingVersion', '1'
  )),
  jsonb_build_array(jsonb_build_object(
    'sourceId', :'source_id',
    'sheetTabName', 'Form Responses 1',
    'observedRowNumber', 5,
    'applicationId', :'application_id',
    'responseId', NULL,
    'status', 'accepted',
    'observedColor', '#d9ead3'
  ))
);
SQL
) >"${WORK_DIR}/sync.out" 2>"${WORK_DIR}/sync.err" &
SYNC_PID=$!

(
  PGAPPNAME=csf_decision_release psql "${DATABASE_URL}" -X -At -v ON_ERROR_STOP=1 \
    -v org_id="${ORG_ID}" -v actor_id="${ACTOR_ID}" -v term_id="${TERM_ID}" \
    -v request_id="${RELEASE_REQUEST_ID}" <<'SQL'
SET statement_timeout = '60s';
SELECT plugin_data.csf_release_sheet_application_decisions(
  :'org_id'::uuid, :'actor_id'::uuid, :'term_id'::uuid, :'request_id'::uuid
);
SQL
) >"${WORK_DIR}/release.out" 2>"${WORK_DIR}/release.err" &
RELEASE_PID=$!

sync_blocked=false
release_blocked=false
await_advisory_wait csf_decision_sync "${SYNC_PID}" && sync_blocked=true
await_advisory_wait csf_decision_release "${RELEASE_PID}" && release_blocked=true

if [[ "${sync_blocked}" == "true" && "${release_blocked}" == "true" ]]; then
  report pass "a real sync and a real release both wait on the same term lock"
else
  report fail "a real sync and a real release both wait on the same term lock"
fi

# Let the holder go so the two contenders run for real.
kill "${HOLDER_PID}" 2>/dev/null || true
wait "${HOLDER_PID}" 2>/dev/null || true

sync_status=0
release_status=0
wait "${SYNC_PID}" || sync_status=$?
wait "${RELEASE_PID}" || release_status=$?

if [[ "${sync_status}" -eq 0 && "${release_status}" -eq 0 ]]; then
  report pass "both serialized statements completed once the lock was free"
else
  echo "  sync exit ${sync_status}, release exit ${release_status}" >&2
  sed 's/^/  sync: /' "${WORK_DIR}/sync.err" >&2 || true
  sed 's/^/  release: /' "${WORK_DIR}/release.err" >&2 || true
  report fail "both serialized statements completed once the lock was free"
fi

# The point of serializing is that the end state is coherent. One release
# receipt exists, and the stage, the application, and the membership agree with
# each other rather than showing a half-applied publication.
coherent="$(
  psql_value -v org_id="${ORG_ID}" -v term_id="${TERM_ID}" \
    -v application_id="${APPLICATION_ID}" <<'SQL'
WITH receipts AS (
  SELECT count(*) AS n FROM plugin_data.csf_application_decision_releases
  WHERE organization_id = :'org_id'::uuid AND term_id = :'term_id'::uuid
), stage AS (
  SELECT release_state, released_decision
  FROM plugin_data.csf_application_decision_stages
  WHERE organization_id = :'org_id'::uuid AND application_id = :'application_id'::uuid
), app AS (
  SELECT status FROM plugin_data.csf_term_applications
  WHERE organization_id = :'org_id'::uuid AND id = :'application_id'::uuid
), membership AS (
  SELECT count(*) FILTER (WHERE status = 'active') AS active
  FROM plugin_data.csf_term_memberships
  WHERE organization_id = :'org_id'::uuid AND term_id = :'term_id'::uuid
)
SELECT
  receipts.n = 1
  AND (
    (stage.release_state = 'released' AND stage.released_decision = 'accepted'
      AND app.status = 'accepted' AND membership.active = 1)
    OR
    (stage.release_state = 'staged' AND app.status = 'submitted'
      AND membership.active = 0)
  )
FROM receipts, stage, app, membership;
SQL
)"
if [[ "${coherent}" == "t" ]]; then
  report pass "the released decision, application, and membership agree"
else
  report fail "the released decision, application, and membership agree"
fi

# ---------------------------------------------------------------------------
# 2. Losing the permission while a real release is demonstrably waiting
#
# The release passes its first permission read, then blocks on the staff-access
# lock. Only once it is observed blocked is the membership revoked, so this
# proves the recheck after the lock rather than ordinary denial at the door.
# ---------------------------------------------------------------------------

REVOKE_REQUEST_ID="$(fixture_id 9)"

(
  PGAPPNAME=csf_staff_lock_holder psql "${DATABASE_URL}" -X -q -v ON_ERROR_STOP=1 \
    -v org_id="${ORG_ID}" <<'SQL'
BEGIN;
SELECT pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key(:'org_id'::uuid)
);
SELECT pg_sleep(30);
COMMIT;
SQL
) >"${WORK_DIR}/staff-holder.out" 2>"${WORK_DIR}/staff-holder.err" &
STAFF_HOLDER_PID=$!

if ! await_wait_state csf_staff_lock_holder Timeout PgSleep "${STAFF_HOLDER_PID}"; then
  echo "The staff-access lock holder never reached its hold point." >&2
  kill "${STAFF_HOLDER_PID}" 2>/dev/null || true
  exit 1
fi

(
  PGAPPNAME=csf_release_deprivileged psql "${DATABASE_URL}" -X -At -v ON_ERROR_STOP=1 \
    -v org_id="${ORG_ID}" -v actor_id="${ACTOR_ID}" -v term_id="${TERM_ID}" \
    -v request_id="${REVOKE_REQUEST_ID}" <<'SQL'
SET statement_timeout = '60s';
SELECT plugin_data.csf_release_sheet_application_decisions(
  :'org_id'::uuid, :'actor_id'::uuid, :'term_id'::uuid, :'request_id'::uuid
);
SQL
) >"${WORK_DIR}/revoked.out" 2>"${WORK_DIR}/revoked.err" &
DEPRIVILEGED_PID=$!

if await_advisory_wait csf_release_deprivileged "${DEPRIVILEGED_PID}"; then
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

kill "${STAFF_HOLDER_PID}" 2>/dev/null || true
wait "${STAFF_HOLDER_PID}" 2>/dev/null || true

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
# 3. Two mapping saves, both inside the function holding version 1
#
# A third session holds the mapping row, so both savers block on it and are
# observed blocked before either can proceed. They are genuinely simultaneous:
# neither has read the version when the other starts.
# ---------------------------------------------------------------------------

psql_quiet -v org_id="${ORG_ID}" -v actor_id="${ACTOR_ID}" -v source_id="${SOURCE_ID}" <<'SQL'
SELECT plugin_data.csf_set_application_decision_mapping(
  :'org_id'::uuid, :'actor_id'::uuid, :'source_id'::uuid,
  jsonb_build_object('decisionColumns', jsonb_build_array(7)), NULL
);
SQL

(
  PGAPPNAME=csf_mapping_row_holder psql "${DATABASE_URL}" -X -q -v ON_ERROR_STOP=1 \
    -v org_id="${ORG_ID}" -v source_id="${SOURCE_ID}" <<'SQL'
BEGIN;
SELECT 1 FROM plugin_data.csf_application_decision_mappings
WHERE organization_id = :'org_id'::uuid AND source_id = :'source_id'::uuid
FOR UPDATE;
SELECT pg_sleep(30);
COMMIT;
SQL
) >"${WORK_DIR}/mapping-holder.out" 2>"${WORK_DIR}/mapping-holder.err" &
MAPPING_HOLDER_PID=$!

if ! await_wait_state csf_mapping_row_holder Timeout PgSleep "${MAPPING_HOLDER_PID}"; then
  echo "The mapping row holder never reached its hold point." >&2
  kill "${MAPPING_HOLDER_PID}" 2>/dev/null || true
  exit 1
fi

declare -a SAVER_PIDS=()
saver_index=0
for column in 8 9; do
  (
    PGAPPNAME="csf_mapping_saver_${column}" psql "${DATABASE_URL}" -X -At \
      -v ON_ERROR_STOP=1 -v org_id="${ORG_ID}" -v actor_id="${ACTOR_ID}" \
      -v source_id="${SOURCE_ID}" -v column_number="${column}" <<'SQL'
SET statement_timeout = '60s';
SELECT plugin_data.csf_set_application_decision_mapping(
  :'org_id'::uuid, :'actor_id'::uuid, :'source_id'::uuid,
  jsonb_build_object(
    'decisionColumns', jsonb_build_array(:'column_number'::integer)
  ),
  1
);
SQL
  ) >"${WORK_DIR}/mapping-${column}.out" 2>"${WORK_DIR}/mapping-${column}.err" &
  SAVER_PIDS[saver_index]=$!
  saver_index=$((saver_index + 1))
done

both_waiting=true
saver_index=0
for column in 8 9; do
  if ! await_wait_state "csf_mapping_saver_${column}" Lock transactionid \
    "${SAVER_PIDS[saver_index]}"; then
    both_waiting=false
  fi
  saver_index=$((saver_index + 1))
done

if [[ "${both_waiting}" == "true" ]]; then
  report pass "both mapping saves are inside the function at the same time"
else
  report fail "both mapping saves are inside the function at the same time"
fi

kill "${MAPPING_HOLDER_PID}" 2>/dev/null || true
wait "${MAPPING_HOLDER_PID}" 2>/dev/null || true

winners=0
saver_index=0
for column in 8 9; do
  if wait "${SAVER_PIDS[saver_index]}"; then
    winners=$((winners + 1))
  fi
  saver_index=$((saver_index + 1))
done

if [[ "${winners}" -eq 1 ]]; then
  report pass "exactly one save holding version 1 is accepted"
else
  report fail "exactly one save holding version 1 is accepted (accepted ${winners})"
fi

final_version="$(
  psql_value -v org_id="${ORG_ID}" -v source_id="${SOURCE_ID}" <<'SQL'
SELECT mapping_version FROM plugin_data.csf_application_decision_mappings
WHERE organization_id = :'org_id'::uuid AND source_id = :'source_id'::uuid;
SQL
)"
if [[ "${final_version}" == "2" ]]; then
  report pass "the mapping version advanced exactly once"
else
  report fail "the mapping version advanced exactly once (is ${final_version})"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ "${failures}" -gt 0 ]]; then
  echo "${failures} check(s) failed."
  exit 1
fi
echo "All decision concurrency checks passed."
