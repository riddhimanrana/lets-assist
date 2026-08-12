-- Follow-up email dispatch ledger: at-most-once enqueue, SKIP LOCKED
-- preparation, a durable dispatch boundary, worker-owned settlement, and
-- phase-aware reaping.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(34);

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT has_function_privilege('authenticated',
    'public.enqueue_project_feedback_requests(uuid,timestamptz)', 'EXECUTE'),
  'clients cannot enqueue feedback requests'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated',
    'public.claim_project_feedback_requests(text,integer,integer)', 'EXECUTE'),
  'clients cannot invoke the legacy compatibility claim'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated',
    'public.claim_project_feedback_requests_for_preparation(text,integer,integer)', 'EXECUTE'),
  'clients cannot claim feedback requests for preparation'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated',
    'public.reap_project_feedback_request_leases()', 'EXECUTE'),
  'clients cannot reap leases'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated',
    'public.begin_project_feedback_request_dispatch(uuid,text,integer)', 'EXECUTE'),
  'clients cannot cross the durable provider boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated',
    'public.settle_project_feedback_request(uuid,text,text,text,text)', 'EXECUTE'),
  'clients cannot settle requests'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.project_feedback_requests', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.project_feedback_requests', 'SELECT'),
  'the ledger is invisible to every client role'
);

-- ---------------------------------------------------------------------------
-- Fixtures: one completed project, three attendees
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('d8000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'flw-creator@local.test', now(), '{}', '{"username":"flw_creator"}', now(), now()),
  ('d8000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'flw-user@local.test', now(), '{}', '{"username":"flw_user"}', now(), now());

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, status
)
VALUES
  ('d8100000-0000-4000-8000-000000000001',
   'd8000000-0000-4000-8000-000000000001',
   'Followup fixture', 'Local', 'Followup fixture', 'oneTime', 'manual',
   jsonb_build_object('oneTime', jsonb_build_object(
     'date', to_char((clock_timestamp() AT TIME ZONE 'America/Los_Angeles') - interval '3 day', 'YYYY-MM-DD'),
     'startTime', '10:00', 'endTime', '12:00', 'volunteers', 10)),
   true, 'upcoming');

INSERT INTO public.anonymous_signups (id, project_id, email, name, confirmed_at)
VALUES
  ('d8200000-0000-4000-8000-000000000001',
   'd8100000-0000-4000-8000-000000000001',
   'flw-anon@local.test', 'Anon Flw', now()),
-- Opted out: must never be enqueued.
  ('d8200000-0000-4000-8000-000000000002',
   'd8100000-0000-4000-8000-000000000001',
   'flw-optout@local.test', 'Optout Flw', now());

UPDATE public.anonymous_signups
SET email_opt_out_at = now()
WHERE id = 'd8200000-0000-4000-8000-000000000002';

INSERT INTO public.project_signups (id, project_id, user_id, anonymous_id, schedule_id, status)
VALUES
  ('d8300000-0000-4000-8000-000000000001',
   'd8100000-0000-4000-8000-000000000001',
   'd8000000-0000-4000-8000-000000000002', NULL, 'oneTime', 'attended'),
  ('d8300000-0000-4000-8000-000000000002',
   'd8100000-0000-4000-8000-000000000001',
   NULL, 'd8200000-0000-4000-8000-000000000001', 'oneTime', 'attended'),
  ('d8300000-0000-4000-8000-000000000003',
   'd8100000-0000-4000-8000-000000000001',
   NULL, 'd8200000-0000-4000-8000-000000000002', 'oneTime', 'attended'),
-- Approved-only: not an attendee, no email.
  ('d8300000-0000-4000-8000-000000000004',
   'd8100000-0000-4000-8000-000000000001',
   'd8000000-0000-4000-8000-000000000001', NULL, 'oneTime', 'approved');

UPDATE public.projects
SET status = 'completed'
WHERE id = 'd8100000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- Enqueue
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  public.enqueue_project_feedback_requests(
    'd8100000-0000-4000-8000-000000000001', now() - interval '1 hour'),
  2,
  'enqueue inserts one row per attendee with an address, skipping opt-outs'
);
SELECT extensions.is(
  public.enqueue_project_feedback_requests(
    'd8100000-0000-4000-8000-000000000001', now() - interval '1 hour'),
  0,
  'a second enqueue inserts nothing (partial unique indexes)'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_feedback_requests
   WHERE anonymous_id = 'd8200000-0000-4000-8000-000000000002'),
  0::bigint,
  'opted-out anonymous recipients are never enqueued'
);
SELECT extensions.ok(
  (SELECT bool_and(requests.recipient_email_hash ~ '^[0-9a-f]{64}$')
   FROM public.project_feedback_requests AS requests),
  'only a sha256 of the address is stored, never the address'
);

-- ---------------------------------------------------------------------------
-- Claim
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE claimed AS
SELECT * FROM public.claim_project_feedback_requests_for_preparation('worker-a', 10, 120);

SELECT extensions.is(
  (SELECT count(*) FROM claimed), 2::bigint,
  'the worker claims every eligible queued row'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_feedback_requests
   WHERE state = 'preparing' AND lease_owner = 'worker-a' AND attempts = 0),
  2::bigint,
  'claiming enters preparation without counting a provider attempt'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.claim_project_feedback_requests_for_preparation('worker-b', 10, 120)),
  0::bigint,
  'a second worker cannot claim leased rows'
);

-- ---------------------------------------------------------------------------
-- Settle
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  public.settle_project_feedback_request(
    (SELECT claimed.id FROM claimed LIMIT 1), 'worker-b', 'sent', 'msg-1', NULL),
  'preparing',
  'a non-leaseholder settlement is refused and reports the current state'
);
SELECT extensions.is(
  public.settle_project_feedback_request(
    (SELECT claimed.id FROM claimed LIMIT 1), 'worker-a', 'sent', 'msg-1', NULL),
  'preparing',
  'a send cannot settle before the durable dispatch transition'
);
SELECT extensions.is(
  public.begin_project_feedback_request_dispatch(
    (SELECT claimed.id FROM claimed LIMIT 1), 'worker-a', 120),
  1::smallint,
  'crossing into dispatching durably counts the provider attempt'
);
SELECT extensions.is(
  public.settle_project_feedback_request(
    (SELECT claimed.id FROM claimed LIMIT 1), 'worker-a', 'sent', 'msg-1', NULL),
  'sent',
  'the leaseholder settles a send'
);
SELECT extensions.is(
  public.settle_project_feedback_request(
    (SELECT claimed.id FROM claimed OFFSET 1 LIMIT 1), 'worker-a', 'queued', NULL, 'throttled'),
  'queued',
  'a retryable failure releases the lease back to queued'
);
SELECT extensions.is(
  (SELECT requests.settled_at IS NULL FROM public.project_feedback_requests AS requests
   WHERE requests.id = (SELECT claimed.id FROM claimed OFFSET 1 LIMIT 1)),
  true,
  'a requeued row is not settled'
);

-- ---------------------------------------------------------------------------
-- Reap: preparation is retryable; only dispatch is unknown and terminal
-- ---------------------------------------------------------------------------

-- Re-claim the released row and force its lease into the past.
CREATE TEMP TABLE reclaimed AS
SELECT * FROM public.claim_project_feedback_requests_for_preparation('worker-c', 10, 120);

SELECT extensions.is(
  (SELECT count(*) FROM reclaimed), 1::bigint,
  'the requeued row is claimable again'
);

UPDATE public.project_feedback_requests
SET lease_expires_at = now() - interval '1 minute'
WHERE id = (SELECT reclaimed.id FROM reclaimed);

SELECT extensions.is(
  public.reap_project_feedback_request_leases(), 1,
  'the reaper handles the expired preparation lease'
);
SELECT extensions.is(
  (SELECT requests.state || ':' || requests.failure_code
   FROM public.project_feedback_requests AS requests
   WHERE requests.id = (SELECT reclaimed.id FROM reclaimed)),
  'queued:preparation_lease_expired',
  'expired preparation is safely requeued because the provider was not reached'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.claim_project_feedback_requests_for_preparation('worker-d', 10, 120)),
  1::bigint,
  'the requeued preparation is claimable again'
);
SELECT extensions.is(
  public.begin_project_feedback_request_dispatch(
    (SELECT reclaimed.id FROM reclaimed), 'worker-d', 120),
  1::smallint,
  'the retried preparation crosses into dispatching exactly once'
);

UPDATE public.project_feedback_requests
SET lease_expires_at = now() - interval '1 minute'
WHERE id = (SELECT reclaimed.id FROM reclaimed);

SELECT extensions.is(
  public.reap_project_feedback_request_leases(), 1,
  'the reaper settles the expired dispatch'
);
SELECT extensions.is(
  (SELECT requests.state || ':' || requests.failure_code
   FROM public.project_feedback_requests AS requests
   WHERE requests.id = (SELECT reclaimed.id FROM reclaimed)),
  'unknown_outcome:dispatch_lease_expired',
  'only an expired dispatch is terminal and reviewable as unknown_outcome'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.claim_project_feedback_requests_for_preparation('worker-e', 10, 120)),
  0::bigint,
  'unknown_outcome dispatches are never re-claimed: at-most-once holds'
);

-- ---------------------------------------------------------------------------
-- Mixed-version upgrade: the previous worker's RPC stays conservative
-- ---------------------------------------------------------------------------

UPDATE public.project_feedback_requests
SET state = 'queued', attempts = 0, lease_owner = NULL,
    lease_expires_at = NULL, provider_message_id = NULL,
    failure_code = NULL, settled_at = NULL
WHERE id = (SELECT claimed.id FROM claimed LIMIT 1);

CREATE TEMP TABLE legacy_claimed AS
SELECT * FROM public.claim_project_feedback_requests('legacy-worker', 10, 120);

SELECT extensions.is(
  (SELECT count(*) FROM legacy_claimed), 1::bigint,
  'a worker from the preceding deployment can still claim through the old RPC'
);
SELECT extensions.is(
  (SELECT requests.state || ':' || requests.attempts::text
   FROM public.project_feedback_requests AS requests
   WHERE requests.id = (SELECT legacy_claimed.id FROM legacy_claimed)),
  'dispatching:1',
  'a legacy claim is conservatively durable dispatch, never retryable preparation'
);
SELECT extensions.is(
  public.settle_project_feedback_request(
    (SELECT legacy_claimed.id FROM legacy_claimed),
    'legacy-worker', 'sent', 'legacy-msg', NULL),
  'sent',
  'the preceding worker can settle its migration-overlap send without a resend'
);

UPDATE public.project_feedback_requests
SET state = 'queued', attempts = 2, lease_owner = NULL,
    lease_expires_at = NULL, provider_message_id = NULL,
    failure_code = NULL, settled_at = NULL
WHERE id = (SELECT legacy_claimed.id FROM legacy_claimed);

CREATE TEMP TABLE exhausted_claim AS
SELECT * FROM public.claim_project_feedback_requests('legacy-worker-final', 10, 120);

SELECT extensions.is(
  (SELECT exhausted_claim.attempts FROM exhausted_claim), 3::smallint,
  'the compatibility claim records the final provider attempt'
);
SELECT extensions.is(
  public.settle_project_feedback_request(
    (SELECT exhausted_claim.id FROM exhausted_claim),
    'legacy-worker-final', 'queued', NULL, 'rate_limited'),
  'failed',
  'a final retryable response is canonicalized to a terminal failure'
);
SELECT extensions.is(
  (SELECT requests.state || ':' || requests.failure_code
   FROM public.project_feedback_requests AS requests
   WHERE requests.id = (SELECT exhausted_claim.id FROM exhausted_claim)),
  'failed:attempts_exhausted',
  'attempt exhaustion cannot leave a permanently unclaimable queued row'
);

SELECT * FROM extensions.finish();

ROLLBACK;
