-- Source-shape invariants for canonical lock order and bounded fairness.
-- Authored for the isolated pgTAP gate; intentionally not executed here.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(12);

SELECT extensions.ok(
  pg_catalog.strpos(
    pg_get_functiondef(
      'public.claim_project_cancellation_deliveries(uuid,text,integer,integer)'::regprocedure
    ),
    'public.project_cancellation_jobs'
  ) < pg_catalog.strpos(
    pg_get_functiondef(
      'public.claim_project_cancellation_deliveries(uuid,text,integer,integer)'::regprocedure
    ),
    'public.project_cancellation_deliveries'
  ),
  'delivery claims lock the job before any delivery candidate'
);

SELECT extensions.ok(
  pg_catalog.strpos(
    pg_get_functiondef(
      'public.finalize_project_cancellation_job(uuid,text)'::regprocedure
    ),
    'public.project_cancellation_jobs'
  ) < pg_catalog.strpos(
    pg_get_functiondef(
      'public.finalize_project_cancellation_job(uuid,text)'::regprocedure
    ),
    'public.project_cancellation_deliveries'
  ),
  'finalization follows the same job-then-delivery lock order'
);

SELECT extensions.ok(
  pg_catalog.strpos(
    pg_get_functiondef(
      'public.settle_project_cancellation_delivery(uuid,text,text,text,text,text)'::regprocedure
    ),
    'project_cancellation_jobs'
  ) = 0,
  'delivery settlement never takes a later job lock'
);

SELECT extensions.ok(
  pg_catalog.strpos(
    pg_get_functiondef(
      'public.reap_project_cancellation_delivery_leases(integer)'::regprocedure
    ),
    'project_cancellation_jobs'
  ) = 0,
  'delivery reaping cannot invert the job-then-delivery order'
);

SELECT extensions.ok(
  pg_catalog.strpos(
    pg_get_functiondef(
      'public.reap_project_cancellation_job_leases(integer)'::regprocedure
    ),
    'project_cancellation_deliveries'
  ) = 0,
  'job reaping takes no delivery lock'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      pg_get_functiondef(routine::regprocedure) LIKE '%FOR UPDATE%SKIP LOCKED%'
    )
    FROM unnest(ARRAY[
      'public.claim_project_cancellation_jobs(text,integer,integer)',
      'public.claim_project_cancellation_deliveries(uuid,text,integer,integer)'
    ]) AS routine
  ),
  'both claim queues use skip-locked candidate acquisition'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      pg_get_functiondef(routine::regprocedure) LIKE '%ORDER BY%LIMIT p_limit%FOR UPDATE SKIP LOCKED%'
    )
    FROM unnest(ARRAY[
      'public.reap_project_cancellation_job_leases(integer)',
      'public.reap_project_cancellation_delivery_leases(integer)'
    ]) AS routine
  ),
  'both reapers use ordered bounded candidate CTEs before skip-locked updates'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'public.claim_project_cancellation_jobs(text,integer,integer)'::regprocedure
  ) LIKE '%PARTITION BY jobs.cancellation_tenant_id%'
  AND pg_get_functiondef(
    'public.claim_project_cancellation_jobs(text,integer,integer)'::regprocedure
  ) LIKE '%max(jobs.last_attempted_at)%'
  AND pg_get_functiondef(
    'public.claim_project_cancellation_jobs(text,integer,integer)'::regprocedure
  ) LIKE '%ranked.tenant_round%ranked.tenant_last_attempted%',
  'job claims interleave tenant rounds and remember organization activity across runs'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'public.reap_project_cancellation_job_leases(integer)'::regprocedure
  ) LIKE '%attempts >= c_max_attempts%failed%'
  AND pg_get_functiondef(
    'public.reap_project_cancellation_job_leases(integer)'::regprocedure
  ) NOT LIKE '%attempts = 0%',
  'exhausted jobs fail without resetting revival evidence'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'public.reap_project_cancellation_delivery_leases(integer)'::regprocedure
  ) LIKE '%email_state = ''sending''%unknown_outcome%'
  AND pg_get_functiondef(
    'public.reap_project_cancellation_delivery_leases(integer)'::regprocedure
  ) LIKE '%email_attempts >= 3%failed%',
  'delivery reaping preserves unknown sends and terminalizes exhausted safe attempts'
);

SELECT extensions.ok(
  (
    SELECT pg_get_constraintdef(oid) LIKE '%(lease_owner IS NULL)%=%(lease_expires_at IS NULL)%'
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.project_cancellation_jobs'::regclass
      AND conname = 'project_cancellation_jobs_lease_shape'
  )
  AND (
    SELECT pg_get_constraintdef(oid) LIKE '%(lease_owner IS NULL)%=%(lease_expires_at IS NULL)%'
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.project_cancellation_deliveries'::regclass
      AND conname = 'project_cancellation_deliveries_lease_shape'
  ),
  'job and delivery leases enforce exact owner/expiry null pairs'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'public.finalize_project_cancellation_job(uuid,text)'::regprocedure
  ) LIKE '%audience_snapshot_at IS NULL%audience_snapshot_missing%'
  AND pg_get_functiondef(
    'public.finalize_project_cancellation_job(uuid,text)'::regprocedure
  ) LIKE '%recipient_count IS DISTINCT FROM v_total%audience_count_mismatch%',
  'finalization refuses a missing or cardinality-drifted audience snapshot'
);

SELECT * FROM extensions.finish();
ROLLBACK;
