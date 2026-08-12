-- Atomic cancellation and owed-channel ledger semantics. Authored for the
-- isolated pgTAP gate; intentionally not executed in this worktree.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(51);

-- ACL and empty-search-path boundary.
SELECT extensions.ok(
  to_regprocedure('public.cancel_project_transactional(uuid,text)') IS NOT NULL
  AND has_function_privilege(
    'authenticated', 'public.cancel_project_transactional(uuid,text)', 'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon', 'public.cancel_project_transactional(uuid,text)', 'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role', 'public.cancel_project_transactional(uuid,text)', 'EXECUTE'
  ),
  'the old public signature remains executable only by authenticated callers'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated', 'public.claim_project_cancellation_jobs(text,integer,integer)', 'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated', 'public.settle_project_cancellation_delivery(uuid,text,text,text,text,text)', 'EXECUTE'
  ),
  'worker mutation RPCs remain service-only'
);

SELECT extensions.ok(
  (
    SELECT NOT public_proc.prosecdef
      AND public_proc.proconfig = ARRAY['search_path=""']::text[]
      AND private_proc.prosecdef
      AND private_proc.proconfig = ARRAY['search_path=""']::text[]
    FROM pg_catalog.pg_proc AS public_proc
    CROSS JOIN pg_catalog.pg_proc AS private_proc
    WHERE public_proc.oid =
        'public.cancel_project_transactional(uuid,text)'::regprocedure
      AND private_proc.oid =
        to_regprocedure('private.cancel_project_transactional(uuid,text)')
  )
  AND has_function_privilege(
    'authenticated',
    to_regprocedure('private.cancel_project_transactional(uuid,text)'),
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    to_regprocedure('private.cancel_project_transactional(uuid,text)'),
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    to_regprocedure('private.cancel_project_transactional(uuid,text)'),
    'EXECUTE'
  ),
  'the public invoker and authenticated-only private definer both use an empty search_path'
);

SELECT extensions.ok(
  has_table_privilege('service_role', 'public.project_cancellation_jobs', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.project_cancellation_jobs', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.project_cancellation_jobs', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.project_cancellation_jobs', 'DELETE')
  AND NOT has_table_privilege('service_role', 'public.project_cancellation_jobs', 'TRUNCATE')
  AND has_table_privilege('service_role', 'public.project_cancellation_deliveries', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.project_cancellation_deliveries', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.project_cancellation_deliveries', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.project_cancellation_deliveries', 'DELETE')
  AND NOT has_table_privilege('service_role', 'public.project_cancellation_deliveries', 'TRUNCATE'),
  'service role can inspect but cannot directly mutate either ledger table'
);

SELECT extensions.ok(
  to_regprocedure('public.enqueue_project_cancellation_job(uuid,timestamptz,text,uuid)') IS NULL
  AND to_regprocedure('public.initialize_project_cancellation_audience(uuid,text)') IS NULL,
  'split enqueue and snapshot RPCs no longer exist'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraints
    JOIN LATERAL unnest(constraints.conkey) AS key_columns(attnum) ON true
    JOIN pg_catalog.pg_attribute AS attributes
      ON attributes.attrelid = constraints.conrelid
     AND attributes.attnum = key_columns.attnum
    WHERE constraints.contype = 'f'
      AND constraints.confdeltype = 'n'
      AND attributes.attgenerated <> ''
  ),
  'SET NULL foreign keys never contain generated referencing columns'
);

SELECT extensions.ok(
  (
    SELECT constraints.conindid =
      'public.projects_id_organization_id_key'::regclass
    FROM pg_catalog.pg_constraint AS constraints
    WHERE constraints.conrelid = 'public.projects'::regclass
      AND constraints.conname = 'projects_id_organization_id_key'
      AND constraints.contype = 'u'
  )
  AND to_regclass('public.projects_id_organization_id_uidx') IS NULL,
  'the canonical constraint owns its index and the redundant standalone duplicate is absent'
);

-- Synthetic identities and projects.
INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('da000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'cancel-owner@local.test', now(), '{}', '{"username":"cancel_owner"}', now(), now()),
  ('da000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'cancel-volunteer@local.test', now(), '{}', '{"username":"cancel_volunteer"}', now(), now()),
  ('da000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'cancel-outsider@local.test', now(), '{}', '{"username":"cancel_outsider"}', now(), now());

UPDATE public.profiles
SET email = CASE id
  WHEN 'da000000-0000-4000-8000-000000000001'::uuid THEN 'owner@local.test'
  WHEN 'da000000-0000-4000-8000-000000000002'::uuid THEN 'frozen-user@local.test'
  ELSE 'outsider@local.test'
END
WHERE id::text LIKE 'da000000-0000-4000-8000-00000000000%';

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('da100000-0000-4000-8000-000000000001', 'Cancellation Org', 'cancel-org', 'nonprofit', '781001');

INSERT INTO public.projects (
  id, creator_id, organization_id, title, location, description, event_type,
  verification_method, schedule, require_login, status
)
VALUES
  ('da200000-0000-4000-8000-000000000001',
   'da000000-0000-4000-8000-000000000001',
   'da100000-0000-4000-8000-000000000001',
   'Atomic cancellation', 'Local', 'Atomic fixture', 'oneTime', 'manual',
   '{"oneTime":{"date":"2030-08-20","startTime":"10:00","endTime":"12:00","volunteers":20}}',
   true, 'upcoming'),
  ('da200000-0000-4000-8000-000000000002',
   'da000000-0000-4000-8000-000000000001',
   'da100000-0000-4000-8000-000000000001',
   'Transition denied', 'Local', 'Transition fixture', 'oneTime', 'manual',
   '{"oneTime":{"date":"2030-08-21","startTime":"10:00","endTime":"12:00","volunteers":20}}',
   true, 'in-progress'),
  ('da200000-0000-4000-8000-000000000003',
   'da000000-0000-4000-8000-000000000001',
   'da100000-0000-4000-8000-000000000001',
   'Permission denied', 'Local', 'Permission fixture', 'oneTime', 'manual',
   '{"oneTime":{"date":"2030-08-22","startTime":"10:00","endTime":"12:00","volunteers":20}}',
   true, 'upcoming');

INSERT INTO public.anonymous_signups (id, project_id, email, name, confirmed_at)
VALUES (
  'da300000-0000-4000-8000-000000000001',
  'da200000-0000-4000-8000-000000000001',
  'frozen-anon@local.test', 'Frozen Anonymous', now()
);

INSERT INTO public.project_signups
  (id, project_id, user_id, anonymous_id, schedule_id, status, created_at)
VALUES
  ('da400000-0000-4000-8000-000000000001',
   'da200000-0000-4000-8000-000000000001',
   'da000000-0000-4000-8000-000000000002', NULL, 'oneTime', 'approved', now() - interval '3 hour'),
  ('da400000-0000-4000-8000-000000000002',
   'da200000-0000-4000-8000-000000000001',
   'da000000-0000-4000-8000-000000000002', NULL, 'second-slot', 'approved', now() - interval '2 hour'),
  ('da400000-0000-4000-8000-000000000003',
   'da200000-0000-4000-8000-000000000001',
   NULL, 'da300000-0000-4000-8000-000000000001', 'oneTime', 'approved', now() - interval '1 hour'),
  ('da400000-0000-4000-8000-000000000004',
   'da200000-0000-4000-8000-000000000001',
   'da000000-0000-4000-8000-000000000003', NULL, 'oneTime', 'pending', now());

SET LOCAL request.jwt.claims =
  '{"sub":"da000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT extensions.is(
  public.cancel_project_transactional(
    'da200000-0000-4000-8000-000000000001', 'Storm warning'
  )->>'outcome',
  'cancelled',
  'one RPC performs the cancellation transition'
);

RESET ROLE;

SELECT extensions.is(
  (SELECT status FROM public.projects WHERE id = 'da200000-0000-4000-8000-000000000001'),
  'cancelled',
  'project is really upcoming-to-cancelled'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.project_cancellation_jobs
   WHERE project_id = 'da200000-0000-4000-8000-000000000001'),
  1::bigint,
  'transaction creates exactly one job'
);

SELECT extensions.is(
  (SELECT recipient_count FROM public.project_cancellation_jobs
   WHERE project_id = 'da200000-0000-4000-8000-000000000001'),
  2,
  'audience dedupes duplicate registered signups and excludes pending signup'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.project_cancellation_deliveries
   WHERE project_id = 'da200000-0000-4000-8000-000000000001'),
  2::bigint,
  'recipient count exactly matches the frozen ledger'
);

SELECT extensions.results_eq(
  $$
    SELECT recipient_kind, recipient_email, email_state, notification_state
    FROM public.project_cancellation_deliveries
    WHERE project_id = 'da200000-0000-4000-8000-000000000001'
    ORDER BY recipient_kind DESC
  $$,
  $$ VALUES
    ('registered'::text, 'frozen-user@local.test'::text, 'queued'::text, 'queued'::text),
    ('anonymous'::text, 'frozen-anon@local.test'::text, 'queued'::text, 'not_owed'::text)
  $$,
  'exact destinations and owed channel states freeze at cancellation'
);

SELECT extensions.ok(
  (SELECT audience_snapshot_at = cancelled_at
   FROM public.project_cancellation_jobs
   WHERE project_id = 'da200000-0000-4000-8000-000000000001'),
  'project transition and audience share one cancellation instant'
);

-- Idempotence never resets a live job.
SET LOCAL ROLE authenticated;
SELECT extensions.is(
  public.cancel_project_transactional(
    'da200000-0000-4000-8000-000000000001', 'Different retry text'
  )->>'outcome',
  'already_cancelled',
  'repeat cancellation is idempotent'
);
RESET ROLE;

SELECT extensions.is(
  (SELECT count(*) FROM public.project_cancellation_deliveries
   WHERE project_id = 'da200000-0000-4000-8000-000000000001'),
  2::bigint,
  'idempotent repeat neither resnapshots nor duplicates deliveries'
);

-- Permission and transition denial live in the same locked RPC.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"da000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$SELECT public.cancel_project_transactional(
    'da200000-0000-4000-8000-000000000003', 'Hostile attempt'
  )$$,
  '42501',
  'project cancellation permission denied',
  'unrelated authenticated user is denied inside the transaction'
);
RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"da000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$SELECT public.cancel_project_transactional(
    'da200000-0000-4000-8000-000000000002', 'Too late'
  )$$,
  '55000',
  'only an upcoming project can be cancelled',
  'non-upcoming transition is denied'
);
RESET ROLE;

SELECT extensions.throws_ok(
  $$UPDATE public.project_signups
    SET status = 'approved'
    WHERE id = 'da400000-0000-4000-8000-000000000004'$$,
  '55000',
  'signups can only be approved for active projects',
  'approval after cancellation cannot escape the frozen audience'
);

SELECT extensions.throws_ok(
  $$UPDATE public.project_signups
    SET organization_id = 'da100000-0000-4000-8000-000000000099'
    WHERE id = 'da400000-0000-4000-8000-000000000004'$$,
  '23514',
  'project signup organization does not match project',
  'signup tenant coordinates cannot drift from their project'
);

SELECT extensions.throws_ok(
  $$INSERT INTO public.project_cancellation_jobs (
      project_id, organization_id, project_title, cancelled_at,
      cancellation_reason, status, cursor
    ) VALUES (
      'da200000-0000-4000-8000-000000000002',
      'da100000-0000-4000-8000-000000000001',
      'Legacy cursor zero', now(), 'Legacy', 'pending', 0
    )$$,
  '23514',
  NULL,
  'legacy-shaped pending cursor zero job cannot become claimable after upgrade'
);

SET LOCAL ROLE service_role;
SELECT extensions.throws_ok(
  $$UPDATE public.project_cancellation_jobs SET status = 'completed'$$,
  '42501',
  'permission denied for table project_cancellation_jobs',
  'service role cannot mutate job state outside an RPC'
);
RESET ROLE;

-- Channel state is independent: notification retry cannot resend accepted mail.
CREATE TEMP TABLE claimed_job AS
SELECT * FROM public.claim_project_cancellation_jobs('worker-a', 1, 120);

CREATE TEMP TABLE first_claim AS
SELECT * FROM public.claim_project_cancellation_deliveries(
  (SELECT id FROM claimed_job), 'worker-a', 10, 120
);

SELECT public.mark_project_cancellation_email_sending(
  (SELECT id FROM first_claim WHERE recipient_kind = 'registered'), 'worker-a'
);

SELECT public.settle_project_cancellation_delivery(
  (SELECT id FROM first_claim WHERE recipient_kind = 'registered'),
  'worker-a', 'accepted', 'retryable', 'provider-user-1', 'notification_transient'
);

SELECT extensions.is(
  (SELECT email_state || ':' || notification_state
   FROM public.project_cancellation_deliveries
   WHERE id = (SELECT id FROM first_claim WHERE recipient_kind = 'registered')),
  'accepted:queued',
  'notification failure leaves accepted email terminal and notification retryable'
);

CREATE TEMP TABLE notification_retry AS
SELECT * FROM public.claim_project_cancellation_deliveries(
  (SELECT id FROM claimed_job), 'worker-a', 10, 120
);

SELECT extensions.is(
  (SELECT email_state FROM notification_retry WHERE recipient_kind = 'registered'),
  'accepted',
  'notification retry claim cannot turn accepted email back into send work'
);

SELECT public.settle_project_cancellation_delivery(
  (SELECT id FROM notification_retry WHERE recipient_kind = 'registered'),
  'worker-a', NULL, 'replayed', NULL, NULL
);

SELECT public.mark_project_cancellation_email_sending(
  (SELECT id FROM first_claim WHERE recipient_kind = 'anonymous'), 'worker-a'
);
SELECT public.settle_project_cancellation_delivery(
  (SELECT id FROM first_claim WHERE recipient_kind = 'anonymous'),
  'worker-a', 'accepted', NULL, 'provider-anon-1', NULL
);

SELECT extensions.is(
  public.finalize_project_cancellation_job(
    (SELECT id FROM claimed_job), 'worker-a'
  )->>'status',
  'completed',
  'job completes only after every owed channel has successful terminal truth'
);

-- Live references may disappear after dispatch; immutable evidence survives.
DELETE FROM auth.users
WHERE id = 'da000000-0000-4000-8000-000000000002';

SELECT extensions.is(
  (SELECT count(*) FROM public.project_cancellation_deliveries
   WHERE recipient_kind = 'registered'
     AND project_id = 'da200000-0000-4000-8000-000000000001'),
  1::bigint,
  'registered-user deletion preserves the delivery ledger row'
);

SELECT extensions.ok(
  (SELECT user_id IS NULL AND signup_id IS NULL
          AND signup_id_snapshot IS NOT NULL
          AND project_id = 'da200000-0000-4000-8000-000000000001'
          AND organization_id = 'da100000-0000-4000-8000-000000000001'
          AND cancellation_tenant_id = 'da100000-0000-4000-8000-000000000001'
          AND recipient_email = 'frozen-user@local.test'
          AND recipient_identity_hash ~ '^[0-9a-f]{64}$'
   FROM public.project_cancellation_deliveries
   WHERE recipient_kind = 'registered'
     AND project_id = 'da200000-0000-4000-8000-000000000001'),
  'registered live references null while frozen destination/evidence survive'
);

DELETE FROM public.project_signups
WHERE id = 'da400000-0000-4000-8000-000000000003';
DELETE FROM public.anonymous_signups
WHERE id = 'da300000-0000-4000-8000-000000000001';

SELECT extensions.ok(
  (SELECT anonymous_id IS NULL AND signup_id IS NULL
          AND signup_id_snapshot = 'da400000-0000-4000-8000-000000000003'
          AND project_id = 'da200000-0000-4000-8000-000000000001'
          AND organization_id = 'da100000-0000-4000-8000-000000000001'
          AND cancellation_tenant_id = 'da100000-0000-4000-8000-000000000001'
          AND recipient_email = 'frozen-anon@local.test'
   FROM public.project_cancellation_deliveries
   WHERE recipient_kind = 'anonymous'
     AND project_id = 'da200000-0000-4000-8000-000000000001'),
  'anonymous/signup deletion preserves frozen destination and ledger row'
);

-- Exact lease null-pair and tenant consistency constraints are enforced.
SELECT extensions.throws_ok(
  $$UPDATE public.project_cancellation_deliveries
    SET lease_owner = 'partial-lease'
    WHERE id = (SELECT id FROM first_claim LIMIT 1)$$,
  '23514',
  NULL,
  'delivery lease owner cannot exist without its expiry/state pair'
);

SELECT extensions.throws_ok(
  $$INSERT INTO public.project_cancellation_deliveries (
      job_id, project_id, organization_id, signup_id_snapshot,
      recipient_kind, recipient_identity_hash, recipient_email,
      recipient_email_hash, email_owed, notification_owed,
      notification_dedupe_key, email_state, notification_state, redact_after
    ) VALUES (
      (SELECT id FROM claimed_job),
      'da200000-0000-4000-8000-000000000002',
      'da100000-0000-4000-8000-000000000001',
      gen_random_uuid(), 'anonymous', repeat('a', 64), 'cross@local.test',
      repeat('b', 64), true, false, 'cross-tenant', 'queued', 'not_owed',
      now() + interval '90 days'
    )$$,
  '23503',
  NULL,
  'composite job/project tenant foreign key rejects cross-project delivery'
);

INSERT INTO public.project_signups
  (id, project_id, user_id, schedule_id, status, created_at)
VALUES (
  'da400000-0000-4000-8000-000000000005',
  'da200000-0000-4000-8000-000000000002',
  'da000000-0000-4000-8000-000000000003',
  'oneTime', 'pending', now()
);

SELECT extensions.throws_ok(
  $$INSERT INTO public.project_cancellation_deliveries (
      job_id, project_id, organization_id, signup_id, signup_id_snapshot,
      user_id, recipient_kind, recipient_identity_hash, recipient_email,
      recipient_email_hash, email_owed, notification_owed,
      notification_dedupe_key, email_state, notification_state, redact_after
    ) VALUES (
      (SELECT id FROM claimed_job),
      'da200000-0000-4000-8000-000000000001',
      'da100000-0000-4000-8000-000000000001',
      'da400000-0000-4000-8000-000000000005', gen_random_uuid(),
      'da000000-0000-4000-8000-000000000003',
      'registered', repeat('c', 64), 'cross-signup@local.test', repeat('d', 64),
      true, true, 'cross-signup', 'queued', 'queued', now() + interval '90 days'
    )$$,
  '23503',
  NULL,
  'composite signup/project tenant foreign key rejects a cross-project signup'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'project_cancellation_deliveries_signup_id_idx'
  )
  AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'project_cancellation_deliveries_project_id_idx'
  ),
  'delivery FK lookup paths have leading indexes'
);

-- A bounded claim cannot let one organization consume the first round.
INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('da100000-0000-4000-8000-000000000002',
        'Fair Cancellation Org', 'fair-cancel-org', 'nonprofit', '781002');

INSERT INTO public.projects (
  id, creator_id, organization_id, title, location, description, event_type,
  verification_method, schedule, require_login, status
)
VALUES
  ('da200000-0000-4000-8000-000000000004',
   'da000000-0000-4000-8000-000000000001',
   'da100000-0000-4000-8000-000000000002',
   'Fair B one', 'Local', 'Fairness', 'oneTime', 'manual',
   '{"oneTime":{"date":"2030-08-23","startTime":"10:00","endTime":"12:00","volunteers":20}}',
   true, 'upcoming'),
  ('da200000-0000-4000-8000-000000000005',
   'da000000-0000-4000-8000-000000000001',
   'da100000-0000-4000-8000-000000000002',
   'Fair B two', 'Local', 'Fairness', 'oneTime', 'manual',
   '{"oneTime":{"date":"2030-08-24","startTime":"10:00","endTime":"12:00","volunteers":20}}',
   true, 'upcoming');

INSERT INTO public.project_cancellation_jobs (
  project_id, organization_id, project_title, cancelled_at,
  cancellation_reason, status, audience_snapshot_at, recipient_count
)
VALUES
  ('da200000-0000-4000-8000-000000000002',
   'da100000-0000-4000-8000-000000000001', 'Fair A one', now(),
   'Fairness', 'pending', now(), 0),
  ('da200000-0000-4000-8000-000000000003',
   'da100000-0000-4000-8000-000000000001', 'Fair A two', now(),
   'Fairness', 'pending', now(), 0),
  ('da200000-0000-4000-8000-000000000004',
   'da100000-0000-4000-8000-000000000002', 'Fair B one', now(),
   'Fairness', 'pending', now(), 0),
  ('da200000-0000-4000-8000-000000000005',
   'da100000-0000-4000-8000-000000000002', 'Fair B two', now(),
   'Fairness', 'pending', now(), 0);

CREATE TEMP TABLE fair_job_claim AS
SELECT * FROM public.claim_project_cancellation_jobs('fair-worker', 2, 120);

SELECT extensions.is(
  (SELECT count(DISTINCT organization_id) FROM fair_job_claim),
  2::bigint,
  'the first bounded claim round includes work from both organizations'
);

DELETE FROM public.project_cancellation_jobs
WHERE project_id IN (
  'da200000-0000-4000-8000-000000000002',
  'da200000-0000-4000-8000-000000000003',
  'da200000-0000-4000-8000-000000000004',
  'da200000-0000-4000-8000-000000000005'
);

-- Finalizer refuses missing snapshots and count mismatch rather than completing.
ALTER TABLE public.project_cancellation_jobs
  DROP CONSTRAINT project_cancellation_jobs_snapshot_shape;

INSERT INTO public.project_cancellation_jobs (
  id, project_id, organization_id, project_title, cancelled_at,
  cancellation_reason, status, lease_owner, lease_expires_at,
  processing_started_at, audience_snapshot_at, recipient_count
) VALUES (
  'da500000-0000-4000-8000-000000000001',
  'da200000-0000-4000-8000-000000000002',
  'da100000-0000-4000-8000-000000000001',
  'Missing snapshot', now(), 'Fixture', 'processing', 'worker-missing',
  now() + interval '5 minute', now(), NULL, NULL
);

SELECT extensions.is(
  public.finalize_project_cancellation_job(
    'da500000-0000-4000-8000-000000000001', 'worker-missing'
  )->>'status',
  'needs_review',
  'finalizer refuses a null audience snapshot'
);

INSERT INTO public.project_cancellation_jobs (
  id, project_id, organization_id, project_title, cancelled_at,
  cancellation_reason, status, lease_owner, lease_expires_at,
  processing_started_at, audience_snapshot_at, recipient_count
) VALUES (
  'da500000-0000-4000-8000-000000000002',
  'da200000-0000-4000-8000-000000000003',
  'da100000-0000-4000-8000-000000000001',
  'Count mismatch', now(), 'Fixture', 'processing', 'worker-mismatch',
  now() + interval '5 minute', now(), now(), 1
);

SELECT extensions.is(
  public.finalize_project_cancellation_job(
    'da500000-0000-4000-8000-000000000002', 'worker-mismatch'
  )->>'status',
  'needs_review',
  'finalizer refuses recipient-count mismatch'
);

-- Parent deletion detaches only live references. Snapshot identifiers and the
-- delivery-to-job evidence chain remain immutable.
SELECT extensions.throws_ok(
  $$UPDATE public.project_cancellation_jobs
    SET project_id_snapshot = 'da200000-0000-4000-8000-000000000099'
    WHERE project_id = 'da200000-0000-4000-8000-000000000001'$$,
  '23514',
  NULL,
  'an immutable project snapshot cannot be rewritten'
);

SELECT extensions.throws_ok(
  $$UPDATE public.project_cancellation_jobs
    SET live_project_id = NULL
    WHERE project_id = 'da200000-0000-4000-8000-000000000001'$$,
  '55000',
  'project cancellation live project reference may only detach after parent deletion',
  'a live parent reference cannot be cleared before parent deletion'
);

SELECT extensions.lives_ok(
  $$DELETE FROM public.projects
    WHERE id = 'da200000-0000-4000-8000-000000000001'$$,
  'a cancelled project can be deleted without deleting cancellation evidence'
);

SELECT extensions.ok(
  (SELECT live_project_id IS NULL
          AND project_id = 'da200000-0000-4000-8000-000000000001'
          AND project_id_snapshot = 'da200000-0000-4000-8000-000000000001'
          AND live_organization_id = 'da100000-0000-4000-8000-000000000001'
   FROM public.project_cancellation_jobs
   WHERE project_id = 'da200000-0000-4000-8000-000000000001'),
  'project deletion nulls only the job live reference'
);

SELECT extensions.ok(
  (SELECT count(*) = 2
          AND bool_and(live_project_id IS NULL)
          AND bool_and(project_id_snapshot = project_id)
   FROM public.project_cancellation_deliveries
   WHERE project_id = 'da200000-0000-4000-8000-000000000001'),
  'project deletion retains every delivery and its immutable project identifier'
);

SELECT extensions.lives_ok(
  $$DELETE FROM public.organizations
    WHERE id = 'da100000-0000-4000-8000-000000000001'$$,
  'organization deletion can cascade projects while retaining cancellation evidence'
);

SELECT extensions.ok(
  (SELECT live_organization_id IS NULL
          AND organization_id = 'da100000-0000-4000-8000-000000000001'
          AND organization_id_snapshot = 'da100000-0000-4000-8000-000000000001'
          AND cancellation_tenant_id = organization_id_snapshot
   FROM public.project_cancellation_jobs
   WHERE project_id = 'da200000-0000-4000-8000-000000000001'),
  'organization deletion nulls only the job live tenant reference'
);

SELECT extensions.ok(
  (SELECT count(*) = 2
          AND bool_and(live_organization_id IS NULL)
          AND bool_and(organization_id_snapshot = organization_id)
   FROM public.project_cancellation_deliveries
   WHERE project_id = 'da200000-0000-4000-8000-000000000001'),
  'organization deletion retains deliveries while detaching their live tenant'
);

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, status
) VALUES (
  'da200000-0000-4000-8000-000000000006',
  'da000000-0000-4000-8000-000000000001',
  'Account cascade cancellation', 'Local', 'Account fixture', 'oneTime',
  'manual',
  '{"oneTime":{"date":"2030-08-25","startTime":"10:00","endTime":"12:00","volunteers":20}}',
  true, 'upcoming'
);

INSERT INTO public.project_signups
  (id, project_id, user_id, schedule_id, status, created_at)
VALUES (
  'da400000-0000-4000-8000-000000000006',
  'da200000-0000-4000-8000-000000000006',
  'da000000-0000-4000-8000-000000000003',
  'oneTime', 'approved', now()
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"da000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
SELECT public.cancel_project_transactional(
  'da200000-0000-4000-8000-000000000006', 'Account removal'
);
RESET ROLE;

SELECT extensions.lives_ok(
  $$DELETE FROM auth.users
    WHERE id = 'da000000-0000-4000-8000-000000000001'$$,
  'creator account deletion can cascade a cancelled project without losing its ledger'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = 'da200000-0000-4000-8000-000000000006'
  )
  AND EXISTS (
    SELECT 1 FROM public.project_cancellation_jobs
    WHERE project_id = 'da200000-0000-4000-8000-000000000006'
      AND project_id_snapshot = project_id
      AND live_project_id IS NULL
      AND organization_id_snapshot IS NULL
      AND cancellation_tenant_id = project_id_snapshot
  )
  AND EXISTS (
    SELECT 1 FROM public.project_cancellation_deliveries
    WHERE project_id = 'da200000-0000-4000-8000-000000000006'
      AND project_id_snapshot = project_id
      AND live_project_id IS NULL
      AND signup_id IS NULL
      AND user_id = 'da000000-0000-4000-8000-000000000003'
  ),
  'account deletion removes its project but preserves personal-project cancellation truth'
);

CREATE TEMP TABLE deleted_parent_job_claim AS
SELECT *
FROM public.claim_project_cancellation_jobs('deleted-parent-worker', 1, 120);

SELECT extensions.is(
  (SELECT project_id
   FROM deleted_parent_job_claim
   WHERE project_id = 'da200000-0000-4000-8000-000000000006'),
  'da200000-0000-4000-8000-000000000006'::uuid,
  'a retained pending job remains claimable by its immutable project identifier'
);

CREATE TEMP TABLE deleted_parent_delivery_claim AS
SELECT *
FROM public.claim_project_cancellation_deliveries(
  (SELECT id FROM deleted_parent_job_claim),
  'deleted-parent-worker',
  10,
  120
);

SELECT extensions.is(
  (SELECT count(*) FROM deleted_parent_delivery_claim),
  1::bigint,
  'retained delivery work remains claimable after creator-account deletion'
);

SELECT public.mark_project_cancellation_email_sending(
  (SELECT id FROM deleted_parent_delivery_claim), 'deleted-parent-worker'
);
SELECT public.settle_project_cancellation_delivery(
  (SELECT id FROM deleted_parent_delivery_claim),
  'deleted-parent-worker', 'accepted', 'delivered', 'deleted-parent-provider', NULL
);

SELECT extensions.is(
  public.finalize_project_cancellation_job(
    (SELECT id FROM deleted_parent_job_claim), 'deleted-parent-worker'
  )->>'status',
  'completed',
  'retained delivery work can settle and finalize after creator-account deletion'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM public.project_cancellation_deliveries
    WHERE project_id = 'da200000-0000-4000-8000-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.project_cancellation_deliveries AS deliveries
    LEFT JOIN public.project_cancellation_jobs AS jobs
      ON jobs.id = deliveries.job_id
     AND jobs.project_id_snapshot = deliveries.project_id_snapshot
     AND jobs.cancellation_tenant_id = deliveries.cancellation_tenant_id
    WHERE jobs.id IS NULL
       OR deliveries.project_id_snapshot IS DISTINCT FROM deliveries.project_id
       OR deliveries.organization_id_snapshot
          IS DISTINCT FROM deliveries.organization_id
  ),
  'retained deliveries have no orphaned or cross-tenant snapshot evidence'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'public.reap_project_cancellation_delivery_leases(integer)'::regprocedure
  ) LIKE '%ORDER BY deliveries.lease_expires_at, deliveries.id%'
  AND pg_get_functiondef(
    'public.reap_project_cancellation_delivery_leases(integer)'::regprocedure
  ) LIKE '%FOR UPDATE SKIP LOCKED%',
  'delivery reaper is bounded, deterministic, and skip-locked'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'public.claim_project_cancellation_jobs(text,integer,integer)'::regprocedure
  ) LIKE '%PARTITION BY jobs.cancellation_tenant_id%'
  AND pg_get_functiondef(
    'public.claim_project_cancellation_jobs(text,integer,integer)'::regprocedure
  ) LIKE '%tenant_round%',
  'job claims round-robin across organization tenant partitions'
);

SELECT * FROM extensions.finish();
ROLLBACK;
