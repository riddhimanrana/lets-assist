-- Durable project-cancellation worker: real two-session concurrency.
--
-- The behavioral suite proves the state machine inside one transaction, which
-- can only show that a *settled* row is not re-handed-out. It cannot show the
-- thing that actually broke the previous worker: the inline kick fired by the
-- cancelling Server Action and the scheduled cron run reading the same
-- uncommitted row at the same instant.
--
-- That needs two connections, so this file commits its fixtures, holds one
-- transaction open, and drives the second connection through dblink. It cleans
-- its own synthetic rows up at the end.
--
-- The two properties under test are the two halves of FOR UPDATE SKIP LOCKED:
-- the concurrent claim must return NOTHING (not a duplicate), and it must not
-- BLOCK (a queue of workers waiting on one row is a different outage).

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(8);

-- ---------------------------------------------------------------------------
-- Committed fixtures: one cancelled project, three approved recipients
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('cb000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'cxc-creator@local.test', now(), '{}', '{"username":"cxc_creator"}', now(), now()),
  ('cb000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'cxc-vol-one@local.test', now(), '{}', '{"username":"cxc_vol_one"}', now(), now()),
  ('cb000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'cxc-vol-two@local.test', now(), '{}', '{"username":"cxc_vol_two"}', now(), now()),
  ('cb000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'cxc-vol-three@local.test', now(), '{}', '{"username":"cxc_vol_three"}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('cb100000-0000-4000-8000-000000000001', 'Cxc Org', 'cxc-org', 'nonprofit', 'CXC001');

INSERT INTO public.projects (
  id, creator_id, organization_id, title, location, description, event_type,
  verification_method, schedule, require_login, status,
  cancelled_at, cancellation_reason
)
VALUES
  ('cb200000-0000-4000-8000-000000000001',
   'cb000000-0000-4000-8000-000000000001',
   'cb100000-0000-4000-8000-000000000001',
   'Concurrency fixture drive', 'Local', 'Concurrency fixture', 'oneTime', 'manual',
   jsonb_build_object('oneTime', jsonb_build_object(
     'date', to_char((clock_timestamp() AT TIME ZONE 'America/Los_Angeles') + interval '2 day', 'YYYY-MM-DD'),
     'startTime', '10:00', 'endTime', '12:00', 'volunteers', 20)),
   true, 'cancelled', now(), 'Concurrency fixture');

INSERT INTO public.project_signups
  (id, project_id, user_id, anonymous_id, schedule_id, status, created_at)
VALUES
  ('cb400000-0000-4000-8000-000000000001',
   'cb200000-0000-4000-8000-000000000001',
   'cb000000-0000-4000-8000-000000000002', NULL, 'oneTime', 'approved',
   now() - interval '3 hour'),
  ('cb400000-0000-4000-8000-000000000002',
   'cb200000-0000-4000-8000-000000000001',
   'cb000000-0000-4000-8000-000000000003', NULL, 'oneTime', 'approved',
   now() - interval '2 hour'),
  ('cb400000-0000-4000-8000-000000000003',
   'cb200000-0000-4000-8000-000000000001',
   'cb000000-0000-4000-8000-000000000004', NULL, 'oneTime', 'approved',
   now() - interval '1 hour');

SELECT public.enqueue_project_cancellation_job(
  'cb200000-0000-4000-8000-000000000001', now(), 'Concurrency fixture',
  'cb000000-0000-4000-8000-000000000001');

SELECT extensions.dblink_connect(
  'cxc_job_probe',
  -- Use the container interface rather than loopback. Supabase's local pg_hba
  -- trusts loopback, and dblink correctly refuses a non-superuser connection
  -- when the supplied password was not actually used.
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  -- The disposable local Supabase image uses its bootstrap role name as the
  -- bootstrap password, so no credential-shaped fixture is committed here.
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);

-- ---------------------------------------------------------------------------
-- A. Two workers reaching for one job at the same instant
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TEMP TABLE cxc_first_claim AS
SELECT * FROM public.claim_project_cancellation_jobs('cxc-worker-one', 5, 300);

SELECT extensions.is(
  (SELECT count(*) FROM cxc_first_claim), 1::bigint,
  'the first worker claims the cancellation job'
);

-- The claim above is NOT committed. This is the exact window in which the old
-- read-then-mark design handed the same job to the cron run as well.
SELECT extensions.dblink_send_query(
  'cxc_job_probe',
  'SELECT count(*)::bigint FROM public.claim_project_cancellation_jobs(''cxc-worker-two'', 5, 300)'
);

SELECT pg_sleep(0.25);

SELECT extensions.is(
  extensions.dblink_is_busy('cxc_job_probe'), 0,
  'the concurrent claim does not queue behind the row: SKIP LOCKED steps over it'
);

CREATE TEMP TABLE cxc_concurrent_job AS
SELECT * FROM extensions.dblink_get_result('cxc_job_probe') AS result(claimed bigint);

SELECT extensions.is(
  (SELECT cxc_concurrent_job.claimed FROM cxc_concurrent_job), 0::bigint,
  'two workers racing for one job: exactly one of them gets it'
);

-- Snapshot the audience inside the same uncommitted transaction, the way the
-- worker does.
SELECT public.initialize_project_cancellation_audience(
  (SELECT cxc_first_claim.id FROM cxc_first_claim), 'cxc-worker-one');

COMMIT;

SELECT extensions.is(
  (SELECT count(*) FROM public.claim_project_cancellation_jobs('cxc-worker-two', 5, 300)),
  0::bigint,
  'once the lease is committed the loser still gets nothing, rather than a second copy'
);

-- ---------------------------------------------------------------------------
-- B. Two claims reaching for one recipient at the same instant
-- ---------------------------------------------------------------------------

BEGIN;

-- Any transaction holding one ledger row: a settlement in flight, a reclaim
-- after a lease expiry, or a maintenance query. The claim must step over it.
CREATE TEMP TABLE cxc_locked_delivery AS
SELECT deliveries.id
FROM public.project_cancellation_deliveries AS deliveries
WHERE deliveries.job_id = (SELECT cxc_first_claim.id FROM cxc_first_claim)
ORDER BY deliveries.created_at, deliveries.id
LIMIT 1
FOR UPDATE;

SELECT extensions.dblink_send_query(
  'cxc_job_probe',
  format(
    'SELECT count(*)::bigint FROM public.claim_project_cancellation_deliveries(%L::uuid, ''cxc-worker-one'', 10, 300)',
    (SELECT cxc_first_claim.id FROM cxc_first_claim)
  )
);

SELECT pg_sleep(0.25);

SELECT extensions.is(
  extensions.dblink_is_busy('cxc_job_probe'), 0,
  'a concurrent recipient claim does not block on the locked ledger row'
);

CREATE TEMP TABLE cxc_concurrent_deliveries AS
SELECT * FROM extensions.dblink_get_result('cxc_job_probe') AS result(claimed bigint);

SELECT extensions.is(
  (SELECT cxc_concurrent_deliveries.claimed FROM cxc_concurrent_deliveries),
  2::bigint,
  'the concurrent claim takes the two free recipients and skips the locked one'
);

COMMIT;

SELECT extensions.is(
  (SELECT deliveries.email_state || ':' || COALESCE(deliveries.lease_owner, 'none')
   FROM public.project_cancellation_deliveries AS deliveries
   WHERE deliveries.id = (SELECT cxc_locked_delivery.id FROM cxc_locked_delivery)),
  'queued:none',
  'the skipped recipient is left untouched, not half-claimed by both sides'
);

SELECT extensions.is(
  (SELECT count(*) FROM (
     SELECT COALESCE(deliveries.user_id::text, deliveries.anonymous_id::text) AS identity
     FROM public.project_cancellation_deliveries AS deliveries
     WHERE deliveries.job_id = (SELECT cxc_first_claim.id FROM cxc_first_claim)
     GROUP BY 1 HAVING count(*) > 1
   ) AS duplicates),
  0::bigint,
  'after the whole race no recipient holds two ledger rows'
);

SELECT extensions.dblink_disconnect('cxc_job_probe');

-- ---------------------------------------------------------------------------
-- Cleanup: this file commits, so it removes its own synthetic fixtures
-- ---------------------------------------------------------------------------

DELETE FROM public.project_cancellation_deliveries
WHERE project_id = 'cb200000-0000-4000-8000-000000000001';
DELETE FROM public.project_cancellation_jobs
WHERE project_id = 'cb200000-0000-4000-8000-000000000001';
DELETE FROM public.project_signups
WHERE project_id = 'cb200000-0000-4000-8000-000000000001';
DELETE FROM public.projects
WHERE id = 'cb200000-0000-4000-8000-000000000001';
DELETE FROM public.organizations
WHERE id = 'cb100000-0000-4000-8000-000000000001';
DELETE FROM auth.users
WHERE id IN (
  'cb000000-0000-4000-8000-000000000001',
  'cb000000-0000-4000-8000-000000000002',
  'cb000000-0000-4000-8000-000000000003',
  'cb000000-0000-4000-8000-000000000004'
);

SELECT * FROM extensions.finish();
