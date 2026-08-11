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
DELETE FROM auth.users
WHERE id IN (
  'ac000000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000002'
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
   'concurrency-volunteer@local.test', now(), '{}', '{"full_name":"Concurrency Volunteer"}', now(), now());

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
  'ac000000-0000-4000-8000-000000000002'
);

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login
)
VALUES (
  'ac200000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000001',
  'Concurrent Hours Project', 'Local', 'Synthetic concurrency fixture',
  'oneTime', 'manual',
  '{"oneTime":{"date":"2031-08-11","startTime":"09:00","endTime":"12:00","volunteers":1}}',
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

echo "Concurrent publication serialized to accepted/replayed with one receipt, certificate, and outbox row."
