-- Two real sessions submitting content reports at the same time.
--
-- The single-session file proves the transaction's rules. This one proves the
-- two properties that only exist between sessions: an identical submission
-- arriving while the first is still open replays rather than duplicating, and
-- two reporters sharing one address bucket cannot both spend its last slot.
--
-- This file runs in autocommit so the second connection can observe committed
-- state, following the precedent in `csf_term_close_serialization.test.sql`.
-- Its fixtures are namespaced and removed at the end, because nothing here is
-- protected by an immutable-audit trigger.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(8);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'a3500000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'report-race@local.test', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
);

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login
) VALUES (
  'a3520000-0000-4000-8000-000000000001',
  'a3500000-0000-4000-8000-000000000001',
  'Concurrently Reported Project', 'Local',
  'Synthetic fixture for the content report concurrency window',
  'oneTime', 'manual',
  '{"oneTime":{"date":"2030-09-01","startTime":"09:00","endTime":"12:00","volunteers":20}}',
  true
);

DELETE FROM public.api_rate_limits
WHERE rate_limit_key LIKE 'pgtap:report-race:%';

-- Two connections rather than one reused connection: dblink refuses a new
-- send while an earlier asynchronous result is still outstanding.
SELECT extensions.dblink_connect(
  'report_duplicate_writer',
  -- Use the container interface rather than loopback. Supabase's local pg_hba
  -- trusts loopback, and dblink refuses a non-superuser connection when the
  -- supplied password was not actually used.
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);

SELECT extensions.dblink_connect(
  'report_bucket_writer',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);

-- ---------------------------------------------------------------------------
-- Simultaneous duplicates
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TEMP TABLE report_race_first AS
SELECT * FROM public.submit_content_report(
  repeat('e1', 32),
  'a3500000-0000-4000-8000-000000000001',
  'project',
  'a3520000-0000-4000-8000-000000000001',
  'spam',
  'The same report submitted twice at the same moment.',
  600,
  ARRAY['pgtap:report-race:user', 'pgtap:report-race:ip'],
  ARRAY[5, 1],
  600
);

SELECT extensions.dblink_send_query(
  'report_duplicate_writer',
  $query$
  SELECT submission.outcome || '|' || coalesce(submission.report_id::text, '')
  FROM public.submit_content_report(
    repeat('e1', 32),
    'a3500000-0000-4000-8000-000000000001'::uuid,
    'project',
    'a3520000-0000-4000-8000-000000000001'::uuid,
    'spam',
    'The same report submitted twice at the same moment.',
    600,
    ARRAY['pgtap:report-race:user', 'pgtap:report-race:ip'],
    ARRAY[5, 1],
    600
  ) AS submission
  $query$
);

SELECT pg_sleep(0.25);
SELECT extensions.is(
  extensions.dblink_is_busy('report_duplicate_writer'),
  1,
  'an identical concurrent submission waits on the request advisory lock'
);

COMMIT;

CREATE TEMP TABLE report_race_second AS
SELECT * FROM extensions.dblink_get_result('report_duplicate_writer', false)
  AS result(payload text);

SELECT extensions.is(
  (SELECT second.payload FROM report_race_second AS second),
  (SELECT 'replayed|' || first.report_id::text FROM report_race_first AS first),
  'the waiting submission replays the report the first session committed'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.content_reports
   WHERE request_fingerprint = repeat('e1', 32)),
  1,
  'two simultaneous duplicates leave exactly one report'
);

SELECT extensions.is(
  (SELECT request_count FROM public.api_rate_limits
   WHERE rate_limit_key = 'pgtap:report-race:user'),
  1,
  'two simultaneous duplicates charge stored-report quota once'
);

-- ---------------------------------------------------------------------------
-- A shared address bucket with one slot left
-- ---------------------------------------------------------------------------

-- Reset the buckets so the open session below is the one that takes the single
-- available address slot, and the competing session is the one that has to
-- observe it.
DELETE FROM public.api_rate_limits
WHERE rate_limit_key LIKE 'pgtap:report-race:%';

BEGIN;

SELECT public.submit_content_report(
  repeat('e2', 32),
  'a3500000-0000-4000-8000-000000000001',
  'project',
  'a3520000-0000-4000-8000-000000000001',
  'harassment',
  'A report that holds the shared address bucket row lock.',
  600,
  ARRAY['pgtap:report-race:user', 'pgtap:report-race:ip'],
  ARRAY[5, 1],
  600
);

SELECT extensions.dblink_send_query(
  'report_bucket_writer',
  $query$
  SELECT submission.outcome
  FROM public.submit_content_report(
    repeat('e3', 32),
    'a3500000-0000-4000-8000-000000000001'::uuid,
    'project',
    'a3520000-0000-4000-8000-000000000001'::uuid,
    'misinformation',
    'A different report competing for the same address bucket.',
    600,
    ARRAY['pgtap:report-race:user', 'pgtap:report-race:ip'],
    ARRAY[5, 1],
    600
  ) AS submission
  $query$
);

SELECT pg_sleep(0.25);
SELECT extensions.is(
  extensions.dblink_is_busy('report_bucket_writer'),
  1,
  'a competing submission waits on the shared address bucket row lock'
);

COMMIT;

CREATE TEMP TABLE report_race_shared AS
SELECT * FROM extensions.dblink_get_result('report_bucket_writer', false)
  AS result(outcome text);

SELECT extensions.is(
  (SELECT shared.outcome FROM report_race_shared AS shared),
  'rate_limited',
  'the waiting submission is refused once the shared bucket is exhausted'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.content_reports
   WHERE request_fingerprint = repeat('e3', 32)),
  0,
  'the refused submission stores no evidence'
);

SELECT extensions.is(
  (SELECT request_count FROM public.api_rate_limits
   WHERE rate_limit_key = 'pgtap:report-race:ip'),
  1,
  'the shared address bucket is never charged past its ceiling'
);

SELECT extensions.dblink_disconnect('report_duplicate_writer');
SELECT extensions.dblink_disconnect('report_bucket_writer');

-- ---------------------------------------------------------------------------
-- Cleanup
--
-- The concurrency windows commit on purpose. Evidence rows are removed before
-- the pseudonyms they reference, because a pseudonym still in use cannot be
-- deleted.
-- ---------------------------------------------------------------------------

DELETE FROM public.content_reports
WHERE request_fingerprint IN (repeat('e1', 32), repeat('e2', 32), repeat('e3', 32));
DELETE FROM public.reporter_references
WHERE reporter_id = 'a3500000-0000-4000-8000-000000000001';
DELETE FROM public.api_rate_limits
WHERE rate_limit_key LIKE 'pgtap:report-race:%';
DELETE FROM public.projects
WHERE id = 'a3520000-0000-4000-8000-000000000001';
DELETE FROM auth.users
WHERE id = 'a3500000-0000-4000-8000-000000000001';

SELECT * FROM extensions.finish();
