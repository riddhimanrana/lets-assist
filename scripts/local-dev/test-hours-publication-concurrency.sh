#!/usr/bin/env bash
set -euo pipefail

# Exercise the project row lock with two real PostgreSQL sessions. This script
# accepts loopback Supabase only and uses synthetic, deterministic fixtures.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

DATABASE_URL="$(
  bunx supabase status -o env \
    | sed -n 's/^DB_URL=//p' \
    | tr -d '"' \
    | head -n 1
)"

case "${DATABASE_URL}" in
  postgresql://postgres:*@127.0.0.1:*/*|postgresql://postgres:*@localhost:*/*) ;;
  *)
    echo "Refusing concurrency test: Supabase database is not loopback." >&2
    exit 1
    ;;
esac

OUTPUT_A="$(mktemp)"
OUTPUT_B="$(mktemp)"

cleanup_database() {
  psql "${DATABASE_URL}" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
DELETE FROM public.notifications
WHERE action_url IN (
  SELECT '/certificates/' || id
  FROM public.certificates
  WHERE project_id = 'ac200000-0000-4000-8000-000000000001'
);
DELETE FROM public.hours_publication_email_outbox
WHERE receipt_id IN (
  SELECT id FROM public.hours_publication_receipts
  WHERE project_id = 'ac200000-0000-4000-8000-000000000001'
);
DELETE FROM public.hours_publication_receipts
WHERE project_id = 'ac200000-0000-4000-8000-000000000001';
DELETE FROM public.certificates
WHERE project_id = 'ac200000-0000-4000-8000-000000000001';
DELETE FROM public.project_signups
WHERE project_id = 'ac200000-0000-4000-8000-000000000001';
DELETE FROM public.projects
WHERE id = 'ac200000-0000-4000-8000-000000000001';
DELETE FROM public.organization_members
WHERE organization_id = 'ac100000-0000-4000-8000-000000000001';
DELETE FROM public.organizations
WHERE id = 'ac100000-0000-4000-8000-000000000001';
DELETE FROM auth.users
WHERE id IN (
  'ac000000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000002',
  'ac000000-0000-4000-8000-000000000003',
  'ac000000-0000-4000-8000-000000000004',
  'ac000000-0000-4000-8000-000000000005'
);
SQL
}

cleanup() {
  cleanup_database
  rm -f "${OUTPUT_A}" "${OUTPUT_B}"
}
trap cleanup EXIT

cleanup_database

psql "${DATABASE_URL}" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('ac000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'concurrency-creator@local.test', now(), '{}', '{"full_name":"Concurrency Creator"}', now(), now()),
  ('ac000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'concurrency-volunteer@local.test', now(), '{}', '{"full_name":"Concurrency Volunteer"}', now(), now()),
  ('ac000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'concurrency-staff@local.test', now(), '{}', '{"full_name":"Concurrency Staff"}', now(), now());

UPDATE public.profiles
SET full_name = CASE id
    WHEN 'ac000000-0000-4000-8000-000000000001' THEN 'Concurrency Creator'
    ELSE 'Concurrency Volunteer'
  END,
  email = CASE id
    WHEN 'ac000000-0000-4000-8000-000000000002' THEN 'concurrency-volunteer@local.test'
    ELSE email
  END
WHERE id IN (
  'ac000000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000002',
  'ac000000-0000-4000-8000-000000000003'
);

INSERT INTO public.organizations (
  id, name, username, type, join_code, verified
) VALUES (
  'ac100000-0000-4000-8000-000000000001',
  'Concurrency Hours Organization',
  'concurrency-hours-organization',
  'school',
  '820001',
  true
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'ac100000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000003',
  'staff',
  'active'
);

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, organization_id,
  can_be_managed_by_staff
)
VALUES (
  'ac200000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000001',
  'Concurrent Hours Project', 'Local', 'Synthetic concurrency fixture',
  'oneTime', 'manual',
  '{"oneTime":{"date":"2031-08-11","startTime":"09:00","endTime":"12:00","volunteers":1}}',
  true,
  'ac100000-0000-4000-8000-000000000001',
  true
);

INSERT INTO public.project_signups (
  id, project_id, user_id, schedule_id, status
)
VALUES (
  'ac300000-0000-4000-8000-000000000001',
  'ac200000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000002',
  'oneTime',
  'approved'
);
SQL

(
  psql "${DATABASE_URL}" -X -At -v ON_ERROR_STOP=1 >"${OUTPUT_A}" <<'SQL'
BEGIN;
SELECT set_config('request.jwt.claim.sub', 'ac000000-0000-4000-8000-000000000001', true);
SELECT id FROM public.projects
WHERE id = 'ac200000-0000-4000-8000-000000000001'
FOR UPDATE;
SELECT pg_sleep(1);
SELECT public.publish_volunteer_hours_transactional(
  'ac200000-0000-4000-8000-000000000001',
  'oneTime',
  '[{"signupId":"ac300000-0000-4000-8000-000000000001","checkIn":"2031-08-11T16:00:00Z","checkOut":"2031-08-11T18:00:00Z"}]'::jsonb,
  'hours-publication:v1:abababababababababababababababababababababababababababababababab'
) ->> 'outcome';
COMMIT;
SQL
) &
SESSION_A_PID=$!

sleep 0.2

psql "${DATABASE_URL}" -X -At -v ON_ERROR_STOP=1 >"${OUTPUT_B}" <<'SQL'
BEGIN;
SELECT set_config('request.jwt.claim.sub', 'ac000000-0000-4000-8000-000000000001', true);
SELECT public.publish_volunteer_hours_transactional(
  'ac200000-0000-4000-8000-000000000001',
  'oneTime',
  '[{"signupId":"ac300000-0000-4000-8000-000000000001","checkIn":"2031-08-11T16:00:00Z","checkOut":"2031-08-11T18:00:00Z"}]'::jsonb,
  'hours-publication:v1:abababababababababababababababababababababababababababababababab'
) ->> 'outcome';
COMMIT;
SQL

wait "${SESSION_A_PID}"

grep -qx 'accepted' "${OUTPUT_A}"
grep -qx 'replayed' "${OUTPUT_B}"

RESULT_COUNTS="$(psql "${DATABASE_URL}" -X -At -v ON_ERROR_STOP=1 <<'SQL'
SELECT
  (SELECT count(*) FROM public.hours_publication_receipts
   WHERE project_id = 'ac200000-0000-4000-8000-000000000001') || ':' ||
  (SELECT count(*) FROM public.certificates
   WHERE project_id = 'ac200000-0000-4000-8000-000000000001' AND type = 'verified') || ':' ||
  (SELECT count(*) FROM public.hours_publication_email_outbox
   WHERE receipt_id IN (
     SELECT id FROM public.hours_publication_receipts
     WHERE project_id = 'ac200000-0000-4000-8000-000000000001'
   ));
SQL
)"

if [[ "${RESULT_COUNTS}" != "1:1:1" ]]; then
  echo "Concurrent publication produced unexpected receipt:certificate:outbox counts: ${RESULT_COUNTS}" >&2
  exit 1
fi

psql "${DATABASE_URL}" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
DELETE FROM public.hours_publication_email_outbox
WHERE receipt_id IN (
  SELECT id FROM public.hours_publication_receipts
  WHERE project_id = 'ac200000-0000-4000-8000-000000000001'
);
DELETE FROM public.hours_publication_receipts
WHERE project_id = 'ac200000-0000-4000-8000-000000000001';
DELETE FROM public.certificates
WHERE project_id = 'ac200000-0000-4000-8000-000000000001';
UPDATE public.projects
SET published = '{}'::jsonb
WHERE id = 'ac200000-0000-4000-8000-000000000001';
UPDATE public.project_signups
SET status = 'approved', check_in_time = NULL, check_out_time = NULL
WHERE id = 'ac300000-0000-4000-8000-000000000001';
SQL

# A status change that already owns the signup lock must settle before the
# publication validates the row. The RPC must then observe rejected, not the
# stale approved snapshot.
(
  psql "${DATABASE_URL}" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
BEGIN;
SELECT id FROM public.project_signups
WHERE id = 'ac300000-0000-4000-8000-000000000001'
FOR UPDATE;
SELECT pg_sleep(1);
UPDATE public.project_signups
SET status = 'rejected'
WHERE id = 'ac300000-0000-4000-8000-000000000001';
COMMIT;
SQL
) &
STATUS_WRITER_PID=$!
sleep 0.2

set +e
psql "${DATABASE_URL}" -X -At -v ON_ERROR_STOP=1 >"${OUTPUT_A}" 2>&1 <<'SQL'
BEGIN;
SELECT set_config('request.jwt.claim.sub', 'ac000000-0000-4000-8000-000000000001', true);
SELECT public.publish_volunteer_hours_transactional(
  'ac200000-0000-4000-8000-000000000001',
  'oneTime',
  '[{"signupId":"ac300000-0000-4000-8000-000000000001","checkIn":"2031-08-11T16:00:00Z","checkOut":"2031-08-11T18:00:00Z"}]'::jsonb,
  'hours-publication:v1:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd'
);
COMMIT;
SQL
STATUS_RACE_EXIT=$?
set -e
wait "${STATUS_WRITER_PID}"

if [[ "${STATUS_RACE_EXIT}" -eq 0 ]] || ! grep -q "one or more signups" "${OUTPUT_A}"; then
  echo "Concurrent signup rejection did not stop publication." >&2
  cat "${OUTPUT_A}" >&2
  exit 1
fi

psql "${DATABASE_URL}" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
UPDATE public.project_signups
SET status = 'approved'
WHERE id = 'ac300000-0000-4000-8000-000000000001';
SQL

# The same serialization guarantee applies to the staff membership used for
# authorization. A revocation that owns the row lock must win before publish.
(
  psql "${DATABASE_URL}" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
BEGIN;
SELECT user_id FROM public.organization_members
WHERE organization_id = 'ac100000-0000-4000-8000-000000000001'
  AND user_id = 'ac000000-0000-4000-8000-000000000003'
FOR UPDATE;
SELECT pg_sleep(1);
DELETE FROM public.organization_members
WHERE organization_id = 'ac100000-0000-4000-8000-000000000001'
  AND user_id = 'ac000000-0000-4000-8000-000000000003';
COMMIT;
SQL
) &
MEMBERSHIP_WRITER_PID=$!
sleep 0.2

set +e
psql "${DATABASE_URL}" -X -At -v ON_ERROR_STOP=1 >"${OUTPUT_B}" 2>&1 <<'SQL'
BEGIN;
SELECT set_config('request.jwt.claim.sub', 'ac000000-0000-4000-8000-000000000003', true);
SELECT public.publish_volunteer_hours_transactional(
  'ac200000-0000-4000-8000-000000000001',
  'oneTime',
  '[{"signupId":"ac300000-0000-4000-8000-000000000001","checkIn":"2031-08-11T16:00:00Z","checkOut":"2031-08-11T18:00:00Z"}]'::jsonb,
  'hours-publication:v1:efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef'
);
COMMIT;
SQL
MEMBERSHIP_RACE_EXIT=$?
set -e
wait "${MEMBERSHIP_WRITER_PID}"

if [[ "${MEMBERSHIP_RACE_EXIT}" -eq 0 ]] || ! grep -q "not authorized" "${OUTPUT_B}"; then
  echo "Concurrent membership revocation did not stop publication." >&2
  cat "${OUTPUT_B}" >&2
  exit 1
fi

psql "${DATABASE_URL}" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('ac000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'concurrency-second@local.test', now(), '{}', '{"full_name":"Concurrency Second"}', now(), now()),
  ('ac000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated',
   'concurrency-third@local.test', now(), '{}', '{"full_name":"Concurrency Third"}', now(), now());

UPDATE public.profiles
SET
  full_name = CASE id
    WHEN 'ac000000-0000-4000-8000-000000000004' THEN 'Concurrency Second'
    ELSE 'Concurrency Third'
  END,
  email = CASE id
    WHEN 'ac000000-0000-4000-8000-000000000004' THEN 'concurrency-second@local.test'
    ELSE 'concurrency-third@local.test'
  END
WHERE id IN (
  'ac000000-0000-4000-8000-000000000004',
  'ac000000-0000-4000-8000-000000000005'
);

UPDATE public.project_signups
SET
  status = 'attended',
  check_in_time = '2031-08-11T16:00:00Z',
  check_out_time = '2031-08-11T18:00:00Z'
WHERE id = 'ac300000-0000-4000-8000-000000000001';

INSERT INTO public.project_signups (
  id, project_id, user_id, schedule_id, status, check_in_time, check_out_time
)
VALUES
  (
    'ac300000-0000-4000-8000-000000000002',
    'ac200000-0000-4000-8000-000000000001',
    'ac000000-0000-4000-8000-000000000004',
    'oneTime', 'attended', '2031-08-11T16:00:00Z', '2031-08-11T18:00:00Z'
  ),
  (
    'ac300000-0000-4000-8000-000000000003',
    'ac200000-0000-4000-8000-000000000001',
    'ac000000-0000-4000-8000-000000000005',
    'oneTime', 'attended', '2031-08-11T16:00:00Z', '2031-08-11T18:00:00Z'
  );
SQL

# Session A keeps the overlapping signup's unique-index entry uncommitted.
# The pg_stat_activity handshakes prove A has completed the insert before B
# starts and that B waits on A's transaction before the commit releases it.
# B must then skip only that conflict and still insert its unrelated signup.
(
  PGAPPNAME=hours_supplemental_session_a \
    psql "${DATABASE_URL}" -X -At -v ON_ERROR_STOP=1 >"${OUTPUT_A}" <<'SQL'
BEGIN;
SELECT count(*)
FROM public.issue_supplemental_verified_certificates(
  'ac200000-0000-4000-8000-000000000001',
  'oneTime',
  ARRAY[
    'ac300000-0000-4000-8000-000000000001',
    'ac300000-0000-4000-8000-000000000002'
  ]::uuid[],
  'ac000000-0000-4000-8000-000000000001'
);
SELECT pg_sleep(5);
COMMIT;
SQL
) &
SUPPLEMENTAL_A_PID=$!

SUPPLEMENTAL_A_READY=false
for ((attempt = 0; attempt < 100; attempt += 1)); do
  SUPPLEMENTAL_A_READY="$(
    psql "${DATABASE_URL}" -X -At -v ON_ERROR_STOP=1 <<'SQL'
SELECT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_stat_activity
  WHERE application_name = 'hours_supplemental_session_a'
    AND state = 'active'
    AND wait_event_type = 'Timeout'
    AND wait_event = 'PgSleep'
    AND xact_start IS NOT NULL
);
SQL
  )"
  [[ "${SUPPLEMENTAL_A_READY}" == "t" ]] && break
  sleep 0.05
done

if [[ "${SUPPLEMENTAL_A_READY}" != "t" ]]; then
  wait "${SUPPLEMENTAL_A_PID}" || true
  echo "Supplemental session A never reached its uncommitted hold point." >&2
  exit 1
fi

(
  PGAPPNAME=hours_supplemental_session_b \
    psql "${DATABASE_URL}" -X -At -v ON_ERROR_STOP=1 >"${OUTPUT_B}" <<'SQL'
SELECT count(*)
FROM public.issue_supplemental_verified_certificates(
  'ac200000-0000-4000-8000-000000000001',
  'oneTime',
  ARRAY[
    'ac300000-0000-4000-8000-000000000001',
    'ac300000-0000-4000-8000-000000000003'
  ]::uuid[],
  'ac000000-0000-4000-8000-000000000001'
);
SQL
) &
SUPPLEMENTAL_B_PID=$!

SUPPLEMENTAL_B_BLOCKED=false
for ((attempt = 0; attempt < 100; attempt += 1)); do
  SUPPLEMENTAL_B_BLOCKED="$(
    psql "${DATABASE_URL}" -X -At -v ON_ERROR_STOP=1 <<'SQL'
SELECT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_stat_activity
  WHERE application_name = 'hours_supplemental_session_b'
    AND wait_event_type = 'Lock'
    AND wait_event = 'transactionid'
);
SQL
  )"
  [[ "${SUPPLEMENTAL_B_BLOCKED}" == "t" ]] && break
  if ! kill -0 "${SUPPLEMENTAL_B_PID}" 2>/dev/null; then
    break
  fi
  sleep 0.05
done

if [[ "${SUPPLEMENTAL_B_BLOCKED}" != "t" ]] \
  || ! kill -0 "${SUPPLEMENTAL_B_PID}" 2>/dev/null; then
  wait "${SUPPLEMENTAL_A_PID}" || true
  wait "${SUPPLEMENTAL_B_PID}" || true
  echo "Supplemental session B did not block on session A's uncommitted certificate." >&2
  exit 1
fi

wait "${SUPPLEMENTAL_A_PID}"
wait "${SUPPLEMENTAL_B_PID}"
grep -qx '2' "${OUTPUT_A}"
grep -qx '1' "${OUTPUT_B}"

SUPPLEMENTAL_COUNT="$(
  psql "${DATABASE_URL}" -X -At -v ON_ERROR_STOP=1 <<'SQL'
SELECT count(*)
FROM public.certificates
WHERE project_id = 'ac200000-0000-4000-8000-000000000001'
  AND type = 'verified';
SQL
)"

if [[ "${SUPPLEMENTAL_COUNT}" != "3" ]]; then
  echo "Concurrent supplemental issuance produced ${SUPPLEMENTAL_COUNT} certificates instead of 3." >&2
  exit 1
fi

echo "Concurrent publication replay, signup-status locking, membership-revocation locking, and conflict-tolerant supplemental issuance passed."
