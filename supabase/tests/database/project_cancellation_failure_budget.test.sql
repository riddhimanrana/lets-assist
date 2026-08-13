BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(4);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  'fa000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'failure-budget-owner@local.test',
  now(),
  '{}',
  '{}',
  now(),
  now()
);

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, status
)
VALUES
  (
    'fa100000-0000-4000-8000-000000000001',
    'fa000000-0000-4000-8000-000000000001',
    'Healthy bounded cancellation',
    'Local',
    'Failure budget fixture',
    'oneTime',
    'manual',
    '{"oneTime":{"date":"2032-08-12","startTime":"10:00","endTime":"11:00","volunteers":5}}',
    true,
    'cancelled'
  ),
  (
    'fa100000-0000-4000-8000-000000000002',
    'fa000000-0000-4000-8000-000000000001',
    'Abandoned cancellation',
    'Local',
    'Failure budget fixture',
    'oneTime',
    'manual',
    '{"oneTime":{"date":"2032-08-13","startTime":"10:00","endTime":"11:00","volunteers":5}}',
    true,
    'cancelled'
  );

INSERT INTO public.project_cancellation_jobs (
  id, project_id, project_title, cancelled_at, cancellation_reason,
  status, audience_snapshot_at, recipient_count
)
VALUES (
  'fa200000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  'Healthy bounded cancellation',
  now(),
  'Fixture',
  'pending',
  now(),
  1
);

INSERT INTO public.project_cancellation_deliveries (
  job_id, project_id, signup_id_snapshot, recipient_kind,
  recipient_identity_hash, recipient_email, recipient_email_hash,
  email_owed, notification_owed, notification_dedupe_key,
  email_state, notification_state, redact_after
)
VALUES (
  'fa200000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000001',
  'anonymous',
  repeat('a', 64),
  'healthy-pass@local.test',
  repeat('b', 64),
  true,
  false,
  'healthy-bounded-pass',
  'queued',
  'not_owed',
  now() + interval '90 days'
);

CREATE TEMP TABLE healthy_pass_receipts (
  pass integer NOT NULL,
  status text NOT NULL
);

DO $$
DECLARE
  v_pass integer;
BEGIN
  FOR v_pass IN 1..6 LOOP
    INSERT INTO healthy_pass_receipts (pass, status)
    SELECT
      v_pass,
      public.finalize_project_cancellation_job(
        claimed.id,
        'healthy-budget-worker'
      )->>'status'
    FROM public.claim_project_cancellation_jobs(
      'healthy-budget-worker',
      1,
      120
    ) AS claimed;
  END LOOP;
END;
$$;

SELECT extensions.is(
  (SELECT count(*) FROM healthy_pass_receipts),
  6::bigint,
  'more than five healthy bounded passes remain claimable'
);

SELECT extensions.is(
  (SELECT count(*) FROM healthy_pass_receipts WHERE status = 'pending'),
  6::bigint,
  'every healthy bounded pass returns open work to pending'
);

SELECT extensions.is(
  (
    SELECT attempts
    FROM public.project_cancellation_jobs
    WHERE id = 'fa200000-0000-4000-8000-000000000001'
  ),
  0,
  'healthy finalized leases do not consume the failure budget'
);

DELETE FROM public.project_cancellation_deliveries
WHERE job_id = 'fa200000-0000-4000-8000-000000000001';
DELETE FROM public.project_cancellation_jobs
WHERE id = 'fa200000-0000-4000-8000-000000000001';

INSERT INTO public.project_cancellation_jobs (
  id, project_id, project_title, cancelled_at, cancellation_reason,
  status, audience_snapshot_at, recipient_count
)
VALUES (
  'fa200000-0000-4000-8000-000000000002',
  'fa100000-0000-4000-8000-000000000002',
  'Abandoned cancellation',
  now(),
  'Fixture',
  'pending',
  now(),
  1
);

INSERT INTO public.project_cancellation_deliveries (
  job_id, project_id, signup_id_snapshot, recipient_kind,
  recipient_identity_hash, recipient_email, recipient_email_hash,
  email_owed, notification_owed, notification_dedupe_key,
  email_state, notification_state, redact_after
)
VALUES (
  'fa200000-0000-4000-8000-000000000002',
  'fa100000-0000-4000-8000-000000000002',
  'fa300000-0000-4000-8000-000000000002',
  'anonymous',
  repeat('c', 64),
  'abandoned-pass@local.test',
  repeat('d', 64),
  true,
  false,
  'abandoned-bounded-pass',
  'queued',
  'not_owed',
  now() + interval '90 days'
);

DO $$
DECLARE
  v_attempt integer;
BEGIN
  FOR v_attempt IN 1..5 LOOP
    PERFORM *
    FROM public.claim_project_cancellation_jobs(
      'abandoned-budget-worker',
      1,
      120
    );

    UPDATE public.project_cancellation_jobs
    SET lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
    WHERE id = 'fa200000-0000-4000-8000-000000000002'
      AND status = 'processing';

    PERFORM public.reap_project_cancellation_job_leases(10);
  END LOOP;
END;
$$;

SELECT extensions.is(
  (
    SELECT status || ':' || attempts::text
    FROM public.project_cancellation_jobs
    WHERE id = 'fa200000-0000-4000-8000-000000000002'
  ),
  'failed:5',
  'five actually expired leases still exhaust the failure budget'
);

SELECT * FROM extensions.finish();
ROLLBACK;
