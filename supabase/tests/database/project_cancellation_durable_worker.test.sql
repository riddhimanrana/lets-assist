-- Durable project-cancellation worker: exactly-once behavior.
--
-- What this file is actually trying to break: the three ways the previous
-- design could tell a volunteer twice — two workers on one job, an offset page
-- over a mutable signup list, and a crash between the provider call and the
-- cursor write. Each gets an assertion here, alongside the state machine that
-- replaced it.
--
-- The whole file runs inside one transaction and ends in ROLLBACK. True
-- two-session concurrency lives in project_cancellation_worker_concurrency.test.sql,
-- which needs committed rows and a second connection.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

-- An exact plan: no_plan() cannot tell "every assertion passed" apart from
-- "half of them never ran".
SELECT extensions.plan(56);

-- ---------------------------------------------------------------------------
-- A. Privileges: the whole surface is service-only
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT has_function_privilege('authenticated',
    'public.enqueue_project_cancellation_job(uuid,timestamptz,text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public.enqueue_project_cancellation_job(uuid,timestamptz,text,uuid)', 'EXECUTE'),
  'no client role can enqueue a cancellation job'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated',
    'public.claim_project_cancellation_jobs(text,integer,integer)', 'EXECUTE'),
  'clients cannot claim cancellation jobs'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated',
    'public.initialize_project_cancellation_audience(uuid,text)', 'EXECUTE'),
  'clients cannot snapshot a cancellation audience'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated',
    'public.claim_project_cancellation_deliveries(uuid,text,integer,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public.settle_project_cancellation_delivery(uuid,text,text,text,text,text)', 'EXECUTE'),
  'clients can neither claim nor settle a recipient delivery'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated',
    'public.reap_project_cancellation_delivery_leases()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public.reap_project_cancellation_job_leases()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public.finalize_project_cancellation_job(uuid,text)', 'EXECUTE'),
  'clients cannot reap leases or finalize a job'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.project_cancellation_deliveries', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.project_cancellation_deliveries', 'SELECT'),
  'the delivery ledger is invisible to every client role'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.project_cancellation_jobs', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.project_cancellation_jobs', 'UPDATE'),
  'the job table no longer carries the baseline client grants'
);

-- ---------------------------------------------------------------------------
-- B. Fixtures: two organizations, one cancelled project each
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('ca000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'cxl-creator@local.test', now(), '{}', '{"username":"cxl_creator"}', now(), now()),
  ('ca000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'cxl-vol-one@local.test', now(), '{}', '{"username":"cxl_vol_one"}', now(), now()),
  ('ca000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'cxl-vol-two@local.test', now(), '{}', '{"username":"cxl_vol_two"}', now(), now()),
  ('ca000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'cxl-late@local.test', now(), '{}', '{"username":"cxl_late"}', now(), now()),
  ('ca000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated',
   'cxl-other-org@local.test', now(), '{}', '{"username":"cxl_other_org"}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('ca100000-0000-4000-8000-000000000001', 'Cxl Org A', 'cxl-org-a', 'nonprofit', 'CXLA01'),
  ('ca100000-0000-4000-8000-000000000002', 'Cxl Org B', 'cxl-org-b', 'nonprofit', 'CXLB01');

INSERT INTO public.projects (
  id, creator_id, organization_id, title, location, description, event_type,
  verification_method, schedule, require_login, status,
  cancelled_at, cancellation_reason
)
VALUES
  ('ca200000-0000-4000-8000-000000000001',
   'ca000000-0000-4000-8000-000000000001',
   'ca100000-0000-4000-8000-000000000001',
   'Cancelled beach cleanup', 'Local', 'Cancellation fixture', 'oneTime', 'manual',
   jsonb_build_object('oneTime', jsonb_build_object(
     'date', to_char((clock_timestamp() AT TIME ZONE 'America/Los_Angeles') + interval '2 day', 'YYYY-MM-DD'),
     'startTime', '10:00', 'endTime', '12:00', 'volunteers', 20)),
   true, 'cancelled', now(), 'Storm warning'),
  ('ca200000-0000-4000-8000-000000000002',
   'ca000000-0000-4000-8000-000000000001',
   'ca100000-0000-4000-8000-000000000002',
   'Other org cancelled drive', 'Local', 'Isolation fixture', 'oneTime', 'manual',
   jsonb_build_object('oneTime', jsonb_build_object(
     'date', to_char((clock_timestamp() AT TIME ZONE 'America/Los_Angeles') + interval '3 day', 'YYYY-MM-DD'),
     'startTime', '10:00', 'endTime', '12:00', 'volunteers', 20)),
   true, 'cancelled', now(), 'Venue withdrew');

INSERT INTO public.anonymous_signups (id, project_id, email, name, confirmed_at)
VALUES
  ('ca300000-0000-4000-8000-000000000001',
   'ca200000-0000-4000-8000-000000000001',
   'cxl-anon@local.test', 'Anon Cxl', now()),
-- Deliberately contactless: it must still be snapshotted, with a NULL hash, so
-- the run can account for it instead of silently dropping a person.
  ('ca300000-0000-4000-8000-000000000002',
   'ca200000-0000-4000-8000-000000000001',
   NULL, 'Addressless Cxl', now());

INSERT INTO public.project_signups
  (id, project_id, user_id, anonymous_id, schedule_id, status, created_at)
VALUES
-- One volunteer, two approved slots: exactly one logical recipient.
  ('ca400000-0000-4000-8000-000000000001',
   'ca200000-0000-4000-8000-000000000001',
   'ca000000-0000-4000-8000-000000000002', NULL, 'oneTime', 'approved',
   now() - interval '5 hour'),
  ('ca400000-0000-4000-8000-000000000002',
   'ca200000-0000-4000-8000-000000000001',
   'ca000000-0000-4000-8000-000000000002', NULL, 'oneTime-second', 'approved',
   now() - interval '4 hour'),
  ('ca400000-0000-4000-8000-000000000003',
   'ca200000-0000-4000-8000-000000000001',
   'ca000000-0000-4000-8000-000000000003', NULL, 'oneTime', 'approved',
   now() - interval '3 hour'),
  ('ca400000-0000-4000-8000-000000000004',
   'ca200000-0000-4000-8000-000000000001',
   NULL, 'ca300000-0000-4000-8000-000000000001', 'oneTime', 'approved',
   now() - interval '2 hour'),
  ('ca400000-0000-4000-8000-000000000005',
   'ca200000-0000-4000-8000-000000000001',
   NULL, 'ca300000-0000-4000-8000-000000000002', 'oneTime', 'approved',
   now() - interval '1 hour'),
-- Never approved: not part of the audience.
  ('ca400000-0000-4000-8000-000000000006',
   'ca200000-0000-4000-8000-000000000001',
   'ca000000-0000-4000-8000-000000000004', NULL, 'oneTime', 'pending', now()),
-- Another organization's project entirely.
  ('ca400000-0000-4000-8000-000000000007',
   'ca200000-0000-4000-8000-000000000002',
   'ca000000-0000-4000-8000-000000000005', NULL, 'oneTime', 'approved', now());

-- ---------------------------------------------------------------------------
-- C. Enqueue is idempotent and never resets a live job
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (public.enqueue_project_cancellation_job(
    'ca200000-0000-4000-8000-000000000001', now(), 'Storm warning',
    'ca000000-0000-4000-8000-000000000001') ->> 'activated')::boolean,
  true,
  'the first enqueue registers the job'
);
SELECT extensions.is(
  (public.enqueue_project_cancellation_job(
    'ca200000-0000-4000-8000-000000000001', now(), 'Storm warning again',
    'ca000000-0000-4000-8000-000000000001') ->> 'activated')::boolean,
  false,
  'a repeated cancellation does not re-activate the existing job'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_cancellation_jobs
   WHERE project_id = 'ca200000-0000-4000-8000-000000000001'),
  1::bigint,
  'one project has exactly one cancellation job'
);

SELECT public.enqueue_project_cancellation_job(
  'ca200000-0000-4000-8000-000000000002', now(), 'Venue withdrew',
  'ca000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------
-- D. Job claims are mutually exclusive
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE claimed_a AS
SELECT * FROM public.claim_project_cancellation_jobs('worker-a', 1, 120);

SELECT extensions.is(
  (SELECT count(*) FROM claimed_a), 1::bigint,
  'a bounded claim returns exactly the requested number of jobs'
);
SELECT extensions.is(
  (SELECT claimed_a.project_id FROM claimed_a),
  'ca200000-0000-4000-8000-000000000001'::uuid,
  'the oldest unattempted job is claimed first'
);
SELECT extensions.is(
  (SELECT jobs.status || ':' || jobs.lease_owner || ':' || jobs.attempts
   FROM public.project_cancellation_jobs AS jobs
   WHERE jobs.id = (SELECT claimed_a.id FROM claimed_a)),
  'processing:worker-a:1',
  'claiming leases the job to its owner and counts the attempt'
);

CREATE TEMP TABLE claimed_b AS
SELECT * FROM public.claim_project_cancellation_jobs('worker-b', 10, 120);

SELECT extensions.is(
  (SELECT count(*) FROM claimed_b WHERE claimed_b.id = (SELECT claimed_a.id FROM claimed_a)),
  0::bigint,
  'a second worker can never receive a job that is already leased'
);
SELECT extensions.is(
  (SELECT claimed_b.project_id FROM claimed_b),
  'ca200000-0000-4000-8000-000000000002'::uuid,
  'the second worker gets the other tenant''s job instead of waiting'
);

-- ---------------------------------------------------------------------------
-- E. The audience is snapshotted once, per identity, and stays inside its org
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (public.initialize_project_cancellation_audience(
    (SELECT claimed_a.id FROM claimed_a), 'worker-a') ->> 'recipients')::integer,
  4,
  'the snapshot holds one row per identity: two members, two anonymous signups'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_cancellation_deliveries AS d
   WHERE d.user_id = 'ca000000-0000-4000-8000-000000000002'),
  1::bigint,
  'a volunteer approved for two slots is one recipient, not two'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_cancellation_deliveries AS d
   WHERE d.user_id = 'ca000000-0000-4000-8000-000000000004'),
  0::bigint,
  'a signup that was never approved is not in the audience'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_cancellation_deliveries AS d
   WHERE d.project_id <> 'ca200000-0000-4000-8000-000000000001'),
  0::bigint,
  'cross-organization isolation: no other tenant''s recipient is ever snapshotted'
);
SELECT extensions.is(
  (SELECT count(DISTINCT d.notification_dedupe_key)
   FROM public.project_cancellation_deliveries AS d),
  1::bigint,
  'every recipient of one project shares one deterministic dedupe key'
);
SELECT extensions.is(
  (SELECT DISTINCT d.notification_dedupe_key
   FROM public.project_cancellation_deliveries AS d),
  'project-cancelled:ca200000-0000-4000-8000-000000000001',
  'the dedupe key is derived from the project, so a replay is a no-op forever'
);
SELECT extensions.ok(
  (SELECT bool_and(d.recipient_email_hash IS NULL
                   OR d.recipient_email_hash ~ '^[0-9a-f]{64}$')
   FROM public.project_cancellation_deliveries AS d),
  'the ledger stores only a sha256 of the address, never the address itself'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_cancellation_deliveries AS d
   WHERE d.anonymous_id = 'ca300000-0000-4000-8000-000000000002'
     AND d.recipient_email_hash IS NULL
     AND d.notification_state = 'not_applicable'),
  1::bigint,
  'a contactless anonymous recipient is recorded, not silently dropped'
);
SELECT extensions.is(
  public.initialize_project_cancellation_audience(
    (SELECT claimed_a.id FROM claimed_a), 'worker-a') ->> 'reason',
  'already_snapshotted',
  'a second initialization is a no-op, so a repeat scheduler cannot re-fan-out'
);

-- ---------------------------------------------------------------------------
-- F. Membership changes mid-run do not move the frozen audience
-- ---------------------------------------------------------------------------

-- One volunteer withdraws and a late one is approved, both after the snapshot.
UPDATE public.project_signups
SET status = 'rejected'
WHERE id = 'ca400000-0000-4000-8000-000000000003';
UPDATE public.project_signups
SET status = 'approved'
WHERE id = 'ca400000-0000-4000-8000-000000000006';

SELECT extensions.is(
  public.initialize_project_cancellation_audience(
    (SELECT claimed_a.id FROM claimed_a), 'worker-a') ->> 'reason',
  'already_snapshotted',
  'a late approval cannot slip into an audience that is already frozen'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_cancellation_deliveries), 4::bigint,
  'the frozen audience is unchanged by both the withdrawal and the late approval'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_cancellation_deliveries AS d
   WHERE d.user_id = 'ca000000-0000-4000-8000-000000000003'),
  1::bigint,
  'the volunteer who withdrew after cancellation is still owed the notice'
);

-- ---------------------------------------------------------------------------
-- G. Recipients are drained by keyset, with no skips and no repeats
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE page_one AS
SELECT * FROM public.claim_project_cancellation_deliveries(
  (SELECT claimed_a.id FROM claimed_a), 'worker-a', 2, 120);

CREATE TEMP TABLE page_two AS
SELECT * FROM public.claim_project_cancellation_deliveries(
  (SELECT claimed_a.id FROM claimed_a), 'worker-a', 2, 120);

SELECT extensions.is(
  (SELECT count(*) FROM page_one), 2::bigint,
  'a page smaller than the audience returns exactly one page'
);
SELECT extensions.is(
  (SELECT count(*) FROM page_two), 2::bigint,
  'the next page returns the remainder'
);
SELECT extensions.is(
  (SELECT count(*) FROM page_one JOIN page_two USING (id)), 0::bigint,
  'the pages do not overlap: the offset-paging duplicate is gone'
);
SELECT extensions.is(
  (SELECT count(DISTINCT combined.id) FROM (
     SELECT page_one.id FROM page_one UNION ALL SELECT page_two.id FROM page_two
   ) AS combined),
  4::bigint,
  'the pages cover the whole audience: the offset-paging skip is gone'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.claim_project_cancellation_deliveries(
     (SELECT claimed_a.id FROM claimed_a), 'worker-a', 10, 120)),
  0::bigint,
  'a drained ledger yields nothing, so a repeat run sends nothing'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.claim_project_cancellation_deliveries(
     (SELECT claimed_a.id FROM claimed_a), 'worker-b', 10, 120)),
  0::bigint,
  'a worker without the job lease cannot claim its recipients at all'
);

-- ---------------------------------------------------------------------------
-- H. Settlement belongs to the leaseholder alone
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  public.settle_project_cancellation_delivery(
    (SELECT page_one.id FROM page_one LIMIT 1), 'worker-b', 'sent', NULL, 'msg-1', NULL),
  'leased',
  'a non-leaseholder settlement is refused and reports the current state'
);
SELECT extensions.is(
  public.settle_project_cancellation_delivery(
    (SELECT page_one.id FROM page_one LIMIT 1), 'worker-a', 'sent', 'delivered', 'msg-1', NULL),
  'sent',
  'the leaseholder records the send'
);
SELECT extensions.is(
  public.settle_project_cancellation_delivery(
    (SELECT page_one.id FROM page_one OFFSET 1 LIMIT 1), 'worker-a', 'queued', NULL, NULL, 'transport_setup_failed'),
  'queued',
  'a provable pre-send failure releases the lease for a later attempt'
);
SELECT extensions.is(
  (SELECT d.settled_at IS NULL FROM public.project_cancellation_deliveries AS d
   WHERE d.id = (SELECT page_one.id FROM page_one OFFSET 1 LIMIT 1)),
  true,
  'a released recipient is not settled'
);

-- ---------------------------------------------------------------------------
-- I. A crash around the provider call becomes durable review, never a re-send
-- ---------------------------------------------------------------------------

-- Both remaining leases are forced into the past: one worker that died before
-- calling the provider and one that died after the provider accepted it. The
-- database cannot tell those two apart, and refusing to guess is the point.
UPDATE public.project_cancellation_deliveries
SET lease_expires_at = now() - interval '1 minute'
WHERE email_state = 'leased';

SELECT extensions.is(
  public.reap_project_cancellation_delivery_leases(), 2,
  'the reaper settles every expired recipient lease'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_cancellation_deliveries AS d
   WHERE d.email_state = 'unknown_outcome'
     AND d.failure_code = 'lease_expired'
     AND d.settled_at IS NOT NULL),
  2::bigint,
  'an expired recipient lease is unknown_outcome: terminal and reviewable'
);

-- Three recipients are not 'sent': two ambiguous and one released before its
-- send. Exactly one of the three may be picked up again.
CREATE TEMP TABLE recovery_page AS
SELECT * FROM public.claim_project_cancellation_deliveries(
  (SELECT claimed_a.id FROM claimed_a), 'worker-a', 10, 120);

SELECT extensions.is(
  (SELECT count(*) FROM recovery_page), 1::bigint,
  'only the pre-send release is re-claimable; an ambiguous recipient never is'
);

-- ---------------------------------------------------------------------------
-- J. The job lease is the safe half: it recovers instead of turning ambiguous
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (public.finalize_project_cancellation_job(
    (SELECT claimed_a.id FROM claimed_a), 'worker-a') ->> 'status'),
  'pending',
  'a job with a recipient still open is released rather than declared done'
);

SELECT extensions.is(
  public.settle_project_cancellation_delivery(
    (SELECT recovery_page.id FROM recovery_page), 'worker-a', 'sent', 'delivered', 'msg-2', NULL),
  'sent',
  'a worker that lost the job lease can still record what the provider told it'
);

UPDATE public.project_cancellation_jobs
SET status = 'processing',
    lease_owner = 'worker-dead',
    lease_expires_at = now() - interval '1 minute'
WHERE id = (SELECT claimed_a.id FROM claimed_a);

SELECT extensions.is(
  (public.reap_project_cancellation_job_leases() ->> 'released')::integer,
  1,
  'an expired job lease is released, not settled as ambiguous'
);
SELECT extensions.is(
  (SELECT jobs.status FROM public.project_cancellation_jobs AS jobs
   WHERE jobs.id = (SELECT claimed_a.id FROM claimed_a)),
  'pending',
  'the released job is claimable again: only deliveries carry provider ambiguity'
);

-- ---------------------------------------------------------------------------
-- K. Finalization tells the truth about what happened
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE reclaimed_job AS
SELECT * FROM public.claim_project_cancellation_jobs('worker-c', 5, 120);

SELECT extensions.is(
  (SELECT count(*) FROM reclaimed_job
   WHERE reclaimed_job.id = (SELECT claimed_a.id FROM claimed_a)),
  1::bigint,
  'the recovered job is picked up by the next worker'
);
SELECT extensions.is(
  (public.finalize_project_cancellation_job(
    (SELECT claimed_a.id FROM claimed_a), 'worker-c') ->> 'status'),
  'needs_review',
  'one unaccountable send makes the whole job a review item, not a success'
);
SELECT extensions.is(
  (SELECT jobs.last_error FROM public.project_cancellation_jobs AS jobs
   WHERE jobs.id = (SELECT claimed_a.id FROM claimed_a)),
  'ambiguous_provider_outcome',
  'the review reason is recorded on the job rather than inferred later'
);

-- The other tenant's job runs its own clean lifecycle end to end.
SELECT extensions.is(
  (public.initialize_project_cancellation_audience(
    (SELECT claimed_b.id FROM claimed_b), 'worker-b') ->> 'recipients')::integer,
  1,
  'the other organization snapshots only its own approved volunteer'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_cancellation_deliveries AS d
   WHERE d.job_id = (SELECT claimed_b.id FROM claimed_b)
     AND (d.project_id <> 'ca200000-0000-4000-8000-000000000002'
          OR d.signup_id <> 'ca400000-0000-4000-8000-000000000007')),
  0::bigint,
  'cross-organization isolation holds in both directions'
);

CREATE TEMP TABLE org_b_page AS
SELECT * FROM public.claim_project_cancellation_deliveries(
  (SELECT claimed_b.id FROM claimed_b), 'worker-b', 10, 120);

SELECT extensions.is(
  public.settle_project_cancellation_delivery(
    (SELECT org_b_page.id FROM org_b_page), 'worker-b', 'sent', 'delivered', 'msg-3', NULL),
  'sent',
  'the other tenant''s single recipient settles normally'
);
SELECT extensions.is(
  (public.finalize_project_cancellation_job(
    (SELECT claimed_b.id FROM claimed_b), 'worker-b') ->> 'status'),
  'completed',
  'a job whose recipients are all accounted for completes'
);

-- ---------------------------------------------------------------------------
-- L. A repeat scheduler run changes nothing
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (SELECT count(*) FROM public.claim_project_cancellation_jobs('worker-d', 10, 120)),
  0::bigint,
  'both jobs are terminal, so the next scheduler tick claims nothing'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_cancellation_deliveries AS d
   WHERE d.project_id = 'ca200000-0000-4000-8000-000000000001'),
  4::bigint,
  'the ledger still holds exactly one row per recipient after the whole run'
);
SELECT extensions.is(
  (SELECT count(*) FROM (
     SELECT d.job_id, COALESCE(d.user_id::text, d.anonymous_id::text) AS identity
     FROM public.project_cancellation_deliveries AS d
     GROUP BY 1, 2 HAVING count(*) > 1
   ) AS duplicates),
  0::bigint,
  'zero duplicates: no identity holds two notices for one cancellation'
);

-- ---------------------------------------------------------------------------
-- M. An exhausted job is terminalized rather than left spinning
-- ---------------------------------------------------------------------------

UPDATE public.project_cancellation_jobs
SET status = 'pending',
    lease_owner = NULL,
    lease_expires_at = NULL,
    attempts = 5
WHERE id = (SELECT claimed_a.id FROM claimed_a);

SELECT extensions.is(
  (public.reap_project_cancellation_job_leases() ->> 'failed')::integer,
  1,
  'a job that used every attempt is failed rather than left pending forever'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.claim_project_cancellation_jobs('worker-e', 10, 120)),
  0::bigint,
  'an exhausted job is no longer claimable by anyone'
);

SELECT * FROM extensions.finish();

ROLLBACK;
