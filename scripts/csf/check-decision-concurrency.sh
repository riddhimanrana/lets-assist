#!/usr/bin/env bash
# Two real sessions against one database, because a lock is not proved by
# grepping for its name.
#
# Checks, each on its own fixture organization:
#   1. sync versus release on one term serialize instead of interleaving;
#   2. a release whose actor loses `decide_applications` while it waits for the
#      lock is refused, and publishes nothing;
#   3. two mapping saves holding the same version do not both win.
#
# Usage:
#   SUPABASE_DB_URL=postgresql://... scripts/csf/check-decision-concurrency.sh
#
# Read-write against the target database, so point it at an isolated replay,
# never a shared or hosted one. Every fixture is namespaced `fc…` and the
# script drops its organizations on the way out.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB_URL="${SUPABASE_DB_URL:-}"

if [[ -z "$DB_URL" ]]; then
  if [[ -f "$ROOT_DIR/scripts/local-dev/dv-local-env.mjs" ]]; then
    DB_URL="$(node "$ROOT_DIR/scripts/local-dev/dv-local-env.mjs" --db-url)"
  fi
fi
if [[ -z "$DB_URL" ]]; then
  echo "Set SUPABASE_DB_URL to the isolated replay database." >&2
  exit 2
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required." >&2
  exit 2
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

failures=0

report() {
  local outcome="$1" title="$2"
  if [[ "$outcome" == "pass" ]]; then
    echo "PASS: $title"
  else
    echo "FAIL: $title"
    failures=$((failures + 1))
  fi
}

run_sql() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -At -f "$1"
}

# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------

cat >"$WORK_DIR/fixture.sql" <<'SQL'
BEGIN;
DELETE FROM public.organizations WHERE username = 'csf-decision-concurrency';
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('fc000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'csf-concurrency-officer@local.test', now(), '{}', '{}', now(), now())
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('fc100000-0000-4000-8000-000000000001', 'CSF Decision Concurrency',
  'csf-decision-concurrency', 'school', '740044');
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('fc100000-0000-4000-8000-000000000001',
  'fc000000-0000-4000-8000-000000000001', 'admin', 'active');
INSERT INTO plugin_data.csf_terms (id, organization_id, code, label,
  school_year, semester, is_current, application_review_source)
VALUES ('fc200000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001', 'F33', 'Fall 2033', '2033-2034',
  'fall', true, 'sheet');
INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label, status)
VALUES ('fc500000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001', 2037, 'c/o 2037', 'active');
INSERT INTO plugin_data.csf_profiles (id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name)
VALUES ('fc300000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001', 'Concurrent', 'Applicant',
  'concurrent', 'applicant');
INSERT INTO plugin_data.csf_sheet_sources (id, organization_id, title, provider,
  source_type, drive_file_id, spreadsheet_id)
VALUES ('fc400000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001', 'Fall 2033 applications',
  'google_sheets', 'application_responses', 'fc-workbook', 'fc-workbook');
INSERT INTO plugin_data.csf_term_applications (id, organization_id, profile_id,
  cohort_id, term_id, source, status, source_file_id, source_sheet_tab,
  source_row_number, google_form_response_id)
VALUES ('fc600000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001', 'fc300000-0000-4000-8000-000000000001',
  'fc500000-0000-4000-8000-000000000001', 'fc200000-0000-4000-8000-000000000001',
  'google_form_sheet', 'submitted', 'fc-workbook', 'Form Responses 1', 5,
  'fc-response-1');
INSERT INTO plugin_data.csf_application_decision_stages (organization_id,
  application_id, term_id, profile_id, source_id, staged_decision, observed_color)
VALUES ('fc100000-0000-4000-8000-000000000001',
  'fc600000-0000-4000-8000-000000000001', 'fc200000-0000-4000-8000-000000000001',
  'fc300000-0000-4000-8000-000000000001', 'fc400000-0000-4000-8000-000000000001',
  'accepted', '#d9ead3');
COMMIT;
SQL

cat >"$WORK_DIR/teardown.sql" <<'SQL'
DELETE FROM public.organizations WHERE username = 'csf-decision-concurrency';
SQL

echo "━━━ CSF decision concurrency ━━━"
run_sql "$WORK_DIR/fixture.sql" >/dev/null
trap 'psql "$DB_URL" -q -f "$WORK_DIR/teardown.sql" >/dev/null 2>&1 || true; rm -rf "$WORK_DIR"' EXIT

# ---------------------------------------------------------------------------
# 1. Sync and release on one term serialize
#
# Session A takes the term lock and holds it. Session B's release must wait,
# so a short statement_timeout makes it fail loudly rather than interleave.
# ---------------------------------------------------------------------------

cat >"$WORK_DIR/hold-term-lock.sql" <<'SQL'
BEGIN;
SELECT pg_advisory_xact_lock(
  plugin_data.csf_sheet_decision_term_lock_key(
    'fc100000-0000-4000-8000-000000000001',
    'fc200000-0000-4000-8000-000000000001'
  )
);
SELECT pg_sleep(4);
COMMIT;
SQL

cat >"$WORK_DIR/release-while-locked.sql" <<'SQL'
SET statement_timeout = '2s';
SELECT plugin_data.csf_release_sheet_application_decisions(
  'fc100000-0000-4000-8000-000000000001',
  'fc000000-0000-4000-8000-000000000001',
  'fc200000-0000-4000-8000-000000000001',
  'fca00000-0000-4000-8000-000000000001'
);
SQL

psql "$DB_URL" -q -f "$WORK_DIR/hold-term-lock.sql" >/dev/null 2>&1 &
holder_pid=$!
sleep 1

if psql "$DB_URL" -v ON_ERROR_STOP=1 -At -f "$WORK_DIR/release-while-locked.sql" \
  >"$WORK_DIR/release.out" 2>"$WORK_DIR/release.err"; then
  report fail "a release runs while a sync holds the same term lock"
else
  if grep -q "statement timeout\|canceling statement" "$WORK_DIR/release.err"; then
    report pass "a release waits for the term lock instead of interleaving"
  else
    echo "  unexpected error:"; sed 's/^/  /' "$WORK_DIR/release.err"
    report fail "a release waits for the term lock instead of interleaving"
  fi
fi
wait "$holder_pid" 2>/dev/null || true

released_after_block="$(psql "$DB_URL" -At -c "
  SELECT count(*) FROM plugin_data.csf_application_decision_stages
  WHERE organization_id = 'fc100000-0000-4000-8000-000000000001'
    AND release_state = 'released';")"
if [[ "$released_after_block" == "0" ]]; then
  report pass "the blocked release published nothing"
else
  report fail "the blocked release published nothing"
fi

# ---------------------------------------------------------------------------
# 2. Losing the permission while waiting refuses the release
#
# Session A holds the staff-access lock and revokes the actor's membership.
# Session B's release is already past its first permission read and blocks on
# that same lock, so it has to recheck and refuse.
# ---------------------------------------------------------------------------

cat >"$WORK_DIR/revoke-while-waiting.sql" <<'SQL'
BEGIN;
SELECT pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key('fc100000-0000-4000-8000-000000000001')
);
SELECT pg_sleep(1);
UPDATE public.organization_members SET status = 'inactive'
WHERE organization_id = 'fc100000-0000-4000-8000-000000000001'
  AND user_id = 'fc000000-0000-4000-8000-000000000001';
COMMIT;
SQL

cat >"$WORK_DIR/release-after-revoke.sql" <<'SQL'
SET statement_timeout = '8s';
SELECT plugin_data.csf_release_sheet_application_decisions(
  'fc100000-0000-4000-8000-000000000001',
  'fc000000-0000-4000-8000-000000000001',
  'fc200000-0000-4000-8000-000000000001',
  'fca00000-0000-4000-8000-000000000002'
);
SQL

psql "$DB_URL" -q -f "$WORK_DIR/revoke-while-waiting.sql" >/dev/null 2>&1 &
revoker_pid=$!
sleep 1

if psql "$DB_URL" -v ON_ERROR_STOP=1 -At -f "$WORK_DIR/release-after-revoke.sql" \
  >"$WORK_DIR/revoked.out" 2>"$WORK_DIR/revoked.err"; then
  report fail "a release by a de-privileged actor is refused"
else
  if grep -q "Not authorized to release" "$WORK_DIR/revoked.err"; then
    report pass "a release by a de-privileged actor is refused"
  else
    echo "  unexpected error:"; sed 's/^/  /' "$WORK_DIR/revoked.err"
    report fail "a release by a de-privileged actor is refused"
  fi
fi
wait "$revoker_pid" 2>/dev/null || true

published="$(psql "$DB_URL" -At -c "
  SELECT count(*) FROM plugin_data.csf_term_applications
  WHERE organization_id = 'fc100000-0000-4000-8000-000000000001'
    AND status <> 'submitted';")"
if [[ "$published" == "0" ]]; then
  report pass "the refused release left every application undecided"
else
  report fail "the refused release left every application undecided"
fi

psql "$DB_URL" -q -c "
  UPDATE public.organization_members SET status = 'active'
  WHERE organization_id = 'fc100000-0000-4000-8000-000000000001'
    AND user_id = 'fc000000-0000-4000-8000-000000000001';" >/dev/null

# ---------------------------------------------------------------------------
# 3. Two mapping saves on the same version: exactly one wins
# ---------------------------------------------------------------------------

psql "$DB_URL" -q -c "
  SELECT plugin_data.csf_set_application_decision_mapping(
    'fc100000-0000-4000-8000-000000000001',
    'fc000000-0000-4000-8000-000000000001',
    'fc400000-0000-4000-8000-000000000001',
    '{\"decisionColumns\":[7]}'::jsonb, NULL);" >/dev/null

cat >"$WORK_DIR/mapping-save.sql" <<'SQL'
SET statement_timeout = '8s';
SELECT plugin_data.csf_set_application_decision_mapping(
  'fc100000-0000-4000-8000-000000000001',
  'fc000000-0000-4000-8000-000000000001',
  'fc400000-0000-4000-8000-000000000001',
  jsonb_build_object('decisionColumns', jsonb_build_array(
    (current_setting('application_name')::text ~ 'two')::integer + 8
  )),
  1
);
SQL

winners=0
for name in mapping-one mapping-two; do
  if PGAPPNAME="$name" psql "$DB_URL" -v ON_ERROR_STOP=1 -At \
    -f "$WORK_DIR/mapping-save.sql" >/dev/null 2>&1; then
    winners=$((winners + 1))
  fi
done

if [[ "$winners" == "1" ]]; then
  report pass "exactly one of two saves holding version 1 is accepted"
else
  report fail "exactly one of two saves holding version 1 is accepted (accepted $winners)"
fi

final_version="$(psql "$DB_URL" -At -c "
  SELECT mapping_version FROM plugin_data.csf_application_decision_mappings
  WHERE source_id = 'fc400000-0000-4000-8000-000000000001';")"
if [[ "$final_version" == "2" ]]; then
  report pass "the mapping version advanced exactly once"
else
  report fail "the mapping version advanced exactly once (is $final_version)"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ "$failures" -gt 0 ]]; then
  echo "$failures check(s) failed."
  exit 1
fi
echo "All decision concurrency checks passed."
