-- Durable project-cancellation worker: lock order, fairness, and the one
-- asymmetry the whole design rests on.
--
-- These are SOURCE assertions on purpose. A deadlock needs two sessions
-- interleaved at one instruction and a starved queue needs weeks of production
-- traffic; neither reproduces on demand. Pinning the shape in the source is
-- what makes a regression visible at review time instead of at 400 concurrent
-- cancellations.
--
-- The whole file runs inside one transaction and ends in ROLLBACK.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(10);

-- ---------------------------------------------------------------------------
-- A. CANONICAL LOCK ORDER: THE JOB ROW, THEN THE DELIVERY ROWS
--
-- Any function that took a delivery before its job would deadlock against one
-- that took them the documented way round.
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  (
    SELECT bool_and(
      pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        'public.project_cancellation_jobs'
      ) < pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        'public.project_cancellation_deliveries'
      )
    )
    FROM unnest(ARRAY[
      'public.initialize_project_cancellation_audience(uuid,text)',
      'public.claim_project_cancellation_deliveries(uuid,text,integer,integer)',
      'public.finalize_project_cancellation_job(uuid,text)'
    ]) AS routine_name
  ),
  'every job-scoped mutator reaches the job table before the delivery table'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure), 'FOR UPDATE'
      ) > 0
    )
    FROM unnest(ARRAY[
      'public.initialize_project_cancellation_audience(uuid,text)',
      'public.claim_project_cancellation_deliveries(uuid,text,integer,integer)',
      'public.finalize_project_cancellation_job(uuid,text)'
    ]) AS routine_name
  ),
  'each of them takes the job row lock rather than trusting a bare read'
);

-- A settlement deliberately owns nothing but its own delivery row. The worker
-- may have lost the job lease while the provider call was in flight, and it is
-- still the only party that knows what the provider said.
SELECT extensions.ok(
  pg_catalog.strpos(
    pg_get_functiondef(
      'public.settle_project_cancellation_delivery(uuid,text,text,text,text,text)'::regprocedure
    ),
    'project_cancellation_jobs'
  ) = 0,
  'settling a delivery takes no job lock, so a lost job lease cannot lose an outcome'
);

-- ---------------------------------------------------------------------------
-- B. BOTH QUEUES ARE SKIP LOCKED, NOT LOCK-WAITING
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  (
    SELECT bool_and(
      pg_get_functiondef(routine_name::regprocedure) LIKE '%FOR UPDATE SKIP LOCKED%'
    )
    FROM unnest(ARRAY[
      'public.claim_project_cancellation_jobs(text,integer,integer)',
      'public.claim_project_cancellation_deliveries(uuid,text,integer,integer)'
    ]) AS routine_name
  ),
  'both claims use FOR UPDATE SKIP LOCKED: concurrent workers step over, never queue'
);

-- ---------------------------------------------------------------------------
-- C. THE ASYMMETRY: A JOB LEASE RECOVERS, A DELIVERY LEASE DOES NOT
--
-- This is the single most load-bearing pair of facts in the subsystem. A job
-- never reaches the provider, so reclaiming it is free. A delivery lease spans
-- the provider call, so reclaiming it re-sends a real email.
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  pg_get_functiondef(
    'public.claim_project_cancellation_jobs(text,integer,integer)'::regprocedure
  ) LIKE '%lease_expires_at < v_now%',
  'the job claim deliberately reclaims expired leases, which is how a job self-heals'
);

SELECT extensions.ok(
  pg_catalog.strpos(
    pg_get_functiondef(
      'public.claim_project_cancellation_deliveries(uuid,text,integer,integer)'::regprocedure
    ),
    'candidates.lease_expires_at'
  ) = 0,
  'the delivery claim never considers a lease at all: only queued rows are claimable'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'public.reap_project_cancellation_delivery_leases()'::regprocedure
  ) LIKE '%unknown_outcome%'
  AND pg_get_functiondef(
    'public.reap_project_cancellation_delivery_leases()'::regprocedure
  ) NOT LIKE '%= ''queued''%',
  'the delivery reaper settles ambiguity terminally and can never requeue a send'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'public.reap_project_cancellation_job_leases()'::regprocedure
  ) LIKE '%status = ''pending''%'
  AND pg_get_functiondef(
    'public.reap_project_cancellation_job_leases()'::regprocedure
  ) NOT LIKE '%unknown_outcome%',
  'the job reaper releases rather than terminalizing: a job carries no provider ambiguity'
);

-- ---------------------------------------------------------------------------
-- D. FAIRNESS AND KEYSET DISCOVERY
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  pg_get_functiondef(
    'public.claim_project_cancellation_jobs(text,integer,integer)'::regprocedure
  ) LIKE '%last_attempted_at ASC NULLS FIRST%',
  'jobs are claimed least-recently-attempted first, so one bad job cannot starve the rest'
);

-- The predecessor paged recipients with an offset over a mutable signup list.
-- The replacement orders by an immutable pair and never offsets anything.
SELECT extensions.ok(
  pg_get_functiondef(
    'public.claim_project_cancellation_deliveries(uuid,text,integer,integer)'::regprocedure
  ) LIKE '%ORDER BY candidates.created_at ASC, candidates.id ASC%'
  AND pg_get_functiondef(
    'public.claim_project_cancellation_deliveries(uuid,text,integer,integer)'::regprocedure
  ) NOT LIKE '%OFFSET%',
  'recipients are drained by keyset over (created_at, id), with no offset anywhere'
);

SELECT * FROM extensions.finish();

ROLLBACK;
