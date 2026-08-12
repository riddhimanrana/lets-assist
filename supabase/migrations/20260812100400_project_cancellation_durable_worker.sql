-- Durable, exactly-once project cancellation notices.
--
-- The replaced design had three ways to notify a volunteer twice, or not at
-- all:
--
--   1. Work was discovered with a plain SELECT on status = 'pending' and the
--      row was flipped to 'processing' afterwards, best-effort. The inline kick
--      fired by the cancelling Server Action and the scheduled cron run
--      overlapped by construction, so both could read the same job and both
--      could fan it out.
--   2. Recipients were paged with .range(cursor, cursor + n) over
--      project_signups filtered on a MUTABLE status. An approval or withdrawal
--      between two batches shifts every later row by one, so the window either
--      skipped a volunteer or mailed one twice.
--   3. There was no per-recipient record at all. A crash anywhere between the
--      provider call and the cursor write meant the next run re-sent the whole
--      batch, and the in-app notification insert carried no dedupe key.
--
-- This migration moves the guarantee into the database, modelled on
-- public.project_feedback_requests and the durable CSF communications ledger:
--
--   * job claims are atomic and bounded (FOR UPDATE SKIP LOCKED), owner-stamped,
--     lease-expiring, attempt-counted, and fair;
--   * the audience is SNAPSHOTTED once, under the job lock, into a
--     per-recipient ledger whose unique indexes are the at-most-once guarantee;
--   * recipients are drained by keyset over (created_at, id) — never by offset;
--   * an expired DELIVERY lease settles as unknown_outcome and is never
--     re-sent, because the worker died around the provider call and cannot
--     prove the mail was not accepted.
--
-- THE ONE DISTINCTION THIS FILE EXISTS TO KEEP: a job lease and a delivery
-- lease expire into different states on purpose. A job never talks to a
-- provider — it only selects work — so releasing an expired job lease back to
-- 'pending' cannot duplicate a send. A delivery lease is held ACROSS the
-- provider call, so releasing one would. Jobs recover automatically; deliveries
-- become durable review.
--
-- Canonical lock order, everywhere, for every worker:
--
--   1. bounded, unlocked candidate discovery
--   2. the job row (FOR UPDATE)
--   3. the delivery rows (FOR UPDATE SKIP LOCKED)
--
-- Nothing here ever locks project_signups: the audience is the statement-level
-- snapshot taken by the initialization SELECT, so a signup lock would buy no
-- consistency and would insert volunteer-facing signup writes into a worker's
-- lock graph.

-- ---------------------------------------------------------------------------
-- 1. Legacy rows: refuse to guess what the cursor already mailed
-- ---------------------------------------------------------------------------

-- A pre-existing job carries no delivery ledger, so which recipients it already
-- reached is unknowable. `cursor` only advanced after a whole batch finished,
-- so even cursor = 0 does not mean "nothing was sent". Anything not already
-- terminal is therefore parked for review rather than re-driven: re-driving is
-- exactly how the old design mailed people twice.
UPDATE public.project_cancellation_jobs
SET status = 'needs_review',
    last_error = 'legacy_job_without_delivery_ledger',
    updated_at = now()
WHERE status = 'processing'
   OR (status = 'pending' AND "cursor" > 0);

-- Attempt counters predate any bound; clamp before the bound is declared.
UPDATE public.project_cancellation_jobs
SET attempts = LEAST(attempts, 5)
WHERE attempts > 5;

-- ---------------------------------------------------------------------------
-- 2. Job table: explicit states, worker ownership, leases, fairness
-- ---------------------------------------------------------------------------

ALTER TABLE public.project_cancellation_jobs
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS audience_snapshot_at timestamptz,
  ADD COLUMN IF NOT EXISTS recipient_count integer;

COMMENT ON COLUMN public.project_cancellation_jobs.lease_owner IS
  'Worker instance that currently owns this job. Only the owner may initialize, claim deliveries for, or finalize it.';
COMMENT ON COLUMN public.project_cancellation_jobs.lease_expires_at IS
  'When this job lease stops being authoritative. An expired job lease is released back to pending — a job never reaches a provider, so re-claiming it cannot duplicate a send.';
COMMENT ON COLUMN public.project_cancellation_jobs.last_attempted_at IS
  'Fairness coordinate. Claims order by this NULLS FIRST so one repeatedly-releasing job cannot starve every later cancellation.';
COMMENT ON COLUMN public.project_cancellation_jobs.audience_snapshot_at IS
  'When the canonical recipient set was frozen into project_cancellation_deliveries. Set exactly once; a later approval is deliberately not added, and a later withdrawal is deliberately not removed.';
COMMENT ON COLUMN public.project_cancellation_jobs."cursor" IS
  'Retained legacy offset column. It is no longer read: recipients are drained by keyset over the delivery ledger, because an offset over a mutable signup list skips and duplicates.';

ALTER TABLE public.project_cancellation_jobs
  ADD CONSTRAINT project_cancellation_jobs_status_check CHECK (
    status IN ('pending', 'processing', 'completed', 'failed', 'needs_review')
  );

ALTER TABLE public.project_cancellation_jobs
  ADD CONSTRAINT project_cancellation_jobs_attempts_bound
    CHECK (attempts BETWEEN 0 AND 5);

-- 'processing' means exactly "leased". The two cannot drift apart.
ALTER TABLE public.project_cancellation_jobs
  ADD CONSTRAINT project_cancellation_jobs_lease_shape CHECK (
    (status = 'processing')
      = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
  );

-- The baseline never constrained project_id, so orphaned jobs may exist. NOT
-- VALID enforces every future row without a destructive backfill deletion.
ALTER TABLE public.project_cancellation_jobs
  ADD CONSTRAINT project_cancellation_jobs_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE
    NOT VALID;

CREATE INDEX project_cancellation_jobs_claimable_idx
  ON public.project_cancellation_jobs (last_attempted_at NULLS FIRST, created_at, id)
  WHERE status = 'pending';

CREATE INDEX project_cancellation_jobs_lease_idx
  ON public.project_cancellation_jobs (lease_expires_at)
  WHERE status = 'processing';

-- RLS already blocks every client, but the baseline still hands anon and
-- authenticated full table privileges. A worker ledger is service-only.
REVOKE ALL ON TABLE public.project_cancellation_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.project_cancellation_jobs TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Per-recipient delivery ledger
-- ---------------------------------------------------------------------------

CREATE TABLE public.project_cancellation_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL
    REFERENCES public.project_cancellation_jobs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  signup_id uuid NOT NULL
    REFERENCES public.project_signups(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  anonymous_id uuid
    REFERENCES public.anonymous_signups(id) ON DELETE CASCADE,
  -- sha256(lower(trim(address))) as it stood at snapshot time, for evidence and
  -- address-change detection only. The address itself is resolved live at send
  -- time and never stored here.
  recipient_email_hash text,
  -- Deterministic and stable for the life of the project. The worker passes
  -- this straight to the notification service, whose (user_id, dedupe_key)
  -- unique index turns any replay into a no-op.
  notification_dedupe_key text NOT NULL,
  email_state text NOT NULL DEFAULT 'queued',
  notification_state text NOT NULL DEFAULT 'pending',
  attempts smallint NOT NULL DEFAULT 0,
  lease_owner text,
  lease_expires_at timestamptz,
  provider_message_id text,
  failure_code text,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_cancellation_deliveries_email_state_check CHECK (
    email_state IN ('queued', 'leased', 'sent', 'skipped', 'failed', 'unknown_outcome')
  ),
  CONSTRAINT project_cancellation_deliveries_notification_state_check CHECK (
    notification_state IN ('pending', 'delivered', 'replayed', 'skipped', 'failed', 'not_applicable')
  ),
  CONSTRAINT project_cancellation_deliveries_attempts_bound
    CHECK (attempts BETWEEN 0 AND 3),
  CONSTRAINT project_cancellation_deliveries_identity CHECK (
    (user_id IS NOT NULL AND anonymous_id IS NULL)
    OR (user_id IS NULL AND anonymous_id IS NOT NULL)
  ),
  -- An anonymous signup has no account, so it can never receive an in-app
  -- notification; saying so explicitly keeps 'pending' from meaning two things.
  CONSTRAINT project_cancellation_deliveries_notification_applicability CHECK (
    (anonymous_id IS NULL) OR (notification_state = 'not_applicable')
  ),
  CONSTRAINT project_cancellation_deliveries_lease_shape CHECK (
    (email_state = 'leased')
      = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT project_cancellation_deliveries_settlement_shape CHECK (
    (email_state IN ('sent', 'skipped', 'failed', 'unknown_outcome'))
      = (settled_at IS NOT NULL)
  ),
  -- Structural proof that no address, name, or provider text lands here.
  CONSTRAINT project_cancellation_deliveries_hash_shape CHECK (
    recipient_email_hash IS NULL OR recipient_email_hash ~ '^[0-9a-f]{64}$'
  ),
  -- Mirrors public.notifications' own dedupe-key bound so a key that the
  -- ledger accepts can never be rejected by the notification insert.
  CONSTRAINT project_cancellation_deliveries_dedupe_key_bounded CHECK (
    notification_dedupe_key = btrim(notification_dedupe_key)
    AND char_length(notification_dedupe_key) BETWEEN 1 AND 200
  )
);

COMMENT ON TABLE public.project_cancellation_deliveries IS
  'Service-only per-recipient ledger for project cancellation notices. The unique indexes are the at-most-once guarantee; unknown_outcome is terminal and is never re-sent.';
COMMENT ON COLUMN public.project_cancellation_deliveries.email_state IS
  'queued -> leased -> sent | skipped | failed | unknown_outcome. Only queued is claimable, and only a pre-send failure may be released back to it.';
COMMENT ON COLUMN public.project_cancellation_deliveries.notification_state IS
  'In-app notice outcome. Idempotent by construction: replayed means the deterministic dedupe key already existed for this recipient.';

-- One ledger row per signup, and — because a volunteer may hold several
-- approved signups across a project's schedule slots — at most one per
-- identity per job. That is what makes "exactly one logical notice per
-- recipient" a database guarantee rather than a query convention.
CREATE UNIQUE INDEX project_cancellation_deliveries_job_signup_uidx
  ON public.project_cancellation_deliveries (job_id, signup_id);
CREATE UNIQUE INDEX project_cancellation_deliveries_job_user_uidx
  ON public.project_cancellation_deliveries (job_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX project_cancellation_deliveries_job_anon_uidx
  ON public.project_cancellation_deliveries (job_id, anonymous_id)
  WHERE anonymous_id IS NOT NULL;

-- The keyset drain order. (created_at, id) is stable because a ledger row is
-- immutable in those two columns once snapshotted.
CREATE INDEX project_cancellation_deliveries_claimable_idx
  ON public.project_cancellation_deliveries (job_id, created_at, id)
  WHERE email_state = 'queued';
CREATE INDEX project_cancellation_deliveries_lease_idx
  ON public.project_cancellation_deliveries (lease_expires_at)
  WHERE email_state = 'leased';
CREATE INDEX project_cancellation_deliveries_open_idx
  ON public.project_cancellation_deliveries (job_id)
  WHERE email_state IN ('queued', 'leased');

ALTER TABLE public.project_cancellation_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.project_cancellation_deliveries
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.project_cancellation_deliveries TO service_role;

CREATE POLICY "Block all client access to cancellation deliveries"
  ON public.project_cancellation_deliveries
  USING (false)
  WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- 4. Enqueue — one job per project, and never over a live one
-- ---------------------------------------------------------------------------

-- The Server Action used to upsert this row directly, resetting status, cursor,
-- attempts, and the timestamps on every conflict. That could stomp a live lease
-- and re-drive an audience mid-flight. Enqueue is now a single statement whose
-- only revival path is a job that provably sent nothing more.
CREATE OR REPLACE FUNCTION public.enqueue_project_cancellation_job(
  p_project_id uuid,
  p_cancelled_at timestamptz,
  p_cancellation_reason text,
  p_created_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job_id uuid;
  v_status text;
  v_activated boolean := false;
BEGIN
  IF p_project_id IS NULL
    OR p_cancelled_at IS NULL
    OR NULLIF(btrim(COALESCE(p_cancellation_reason, '')), '') IS NULL
  THEN
    RAISE EXCEPTION 'enqueue_project_cancellation_job: invalid input'
      USING ERRCODE = '22004';
  END IF;

  INSERT INTO public.project_cancellation_jobs AS jobs (
    project_id, cancelled_at, cancellation_reason, created_by, status
  )
  VALUES (p_project_id, p_cancelled_at, p_cancellation_reason, p_created_by, 'pending')
  ON CONFLICT (project_id) DO UPDATE
    SET status = 'pending',
        attempts = 0,
        last_error = NULL,
        updated_at = now()
    -- Only a job that exhausted its attempts with nothing in flight is
    -- revived. 'completed' needs nothing, 'needs_review' is a human's call,
    -- and 'pending'/'processing' are already live. Terminal delivery rows keep
    -- their state either way, so a revival can only drain what was never sent.
    WHERE jobs.status = 'failed'
  RETURNING jobs.id, jobs.status INTO v_job_id, v_status;

  IF v_job_id IS NULL THEN
    SELECT jobs.id, jobs.status INTO v_job_id, v_status
    FROM public.project_cancellation_jobs AS jobs
    WHERE jobs.project_id = p_project_id;
  ELSE
    -- Either a fresh insert or the one permitted revival; both leave the job
    -- claimable, which is the only thing the caller can act on.
    v_activated := true;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'jobId', v_job_id,
    'status', v_status,
    'accepted', v_job_id IS NOT NULL,
    'activated', v_activated
  );
END;
$$;

COMMENT ON FUNCTION public.enqueue_project_cancellation_job(uuid, timestamptz, text, uuid) IS
  'Idempotently registers one cancellation job per project. Never resets a live or already-reviewed job.';

-- ---------------------------------------------------------------------------
-- 5. Claim jobs — atomic, bounded, fair, and self-recovering
-- ---------------------------------------------------------------------------

-- Deliberately ALSO claims a 'processing' job whose lease has expired. That is
-- the difference from the delivery claim below, and it is safe for exactly one
-- reason: selecting work touches no provider. It also means job recovery is
-- discoverable from an ordinary worker pass with zero pending rows.
CREATE OR REPLACE FUNCTION public.claim_project_cancellation_jobs(
  p_worker_id text,
  p_limit integer,
  p_lease_seconds integer
)
RETURNS TABLE (
  id uuid,
  project_id uuid,
  cancelled_at timestamptz,
  cancellation_reason text,
  attempts integer,
  audience_snapshot_at timestamptz,
  recipient_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_max_attempts constant integer := 5;
  c_max_limit constant integer := 10;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL
    OR COALESCE(p_limit, 0) < 1
    OR p_limit > c_max_limit
    OR COALESCE(p_lease_seconds, 0) < 1
    OR p_lease_seconds > 900
  THEN
    RAISE EXCEPTION 'claim_project_cancellation_jobs: invalid input'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.project_cancellation_jobs AS jobs
  SET status = 'processing',
      lease_owner = p_worker_id,
      lease_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
      attempts = jobs.attempts + 1,
      last_attempted_at = v_now,
      processing_started_at = v_now,
      updated_at = v_now
  WHERE jobs.id IN (
    SELECT candidates.id
    FROM public.project_cancellation_jobs AS candidates
    WHERE candidates.attempts < c_max_attempts
      AND (
        candidates.status = 'pending'
        OR (candidates.status = 'processing'
            AND candidates.lease_expires_at < v_now)
      )
    ORDER BY candidates.last_attempted_at ASC NULLS FIRST,
             candidates.created_at ASC,
             candidates.id ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING jobs.id, jobs.project_id, jobs.cancelled_at,
            jobs.cancellation_reason, jobs.attempts,
            jobs.audience_snapshot_at, jobs.recipient_count;
END;
$$;

COMMENT ON FUNCTION public.claim_project_cancellation_jobs(text, integer, integer) IS
  'Atomically leases up to p_limit cancellation jobs with FOR UPDATE SKIP LOCKED. Two concurrent workers can never receive the same job.';

-- ---------------------------------------------------------------------------
-- 6. Snapshot the canonical audience, exactly once, under the job lock
-- ---------------------------------------------------------------------------

-- The audience is every signup APPROVED AT THE INSTANT THIS STATEMENT RUNS,
-- deduplicated to one row per identity. Two consequences are deliberate and
-- neither is silent:
--
--   * an approval recorded after the snapshot is NOT added. That volunteer
--     joined after the project was already cancelled; the freeze is what makes
--     the recipient set finite and the run's progress meaningful.
--   * a withdrawal recorded after the snapshot does NOT remove the row. The
--     person was approved when the organizer cancelled and is owed the notice.
--     Send-time revalidation still re-checks address and consent — it just does
--     not re-open the membership question mid-run.
--
-- project_signups is read, not locked: READ COMMITTED already gives this SELECT
-- a single consistent view, so a lock would add nothing but a path from a
-- volunteer's signup write into a worker's lock graph.
CREATE OR REPLACE FUNCTION public.initialize_project_cancellation_audience(
  p_job_id uuid,
  p_worker_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project_id uuid;
  v_snapshot_at timestamptz;
  v_recipients integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_job_id IS NULL OR NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'initialize_project_cancellation_audience: invalid input'
      USING ERRCODE = '22004';
  END IF;

  -- Lock order step 2: the job row, before any delivery row exists.
  SELECT jobs.project_id, jobs.audience_snapshot_at, jobs.recipient_count
  INTO v_project_id, v_snapshot_at, v_recipients
  FROM public.project_cancellation_jobs AS jobs
  WHERE jobs.id = p_job_id
    AND jobs.status = 'processing'
    AND jobs.lease_owner = p_worker_id
    AND jobs.lease_expires_at > v_now
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'initialized', false, 'reason', 'lease_lost', 'recipients', 0
    );
  END IF;

  IF v_snapshot_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'initialized', false,
      'reason', 'already_snapshotted',
      'recipients', COALESCE(v_recipients, 0)
    );
  END IF;

  WITH audience AS (
    SELECT DISTINCT ON (COALESCE(signups.user_id::text, signups.anonymous_id::text))
      signups.id AS signup_id,
      signups.user_id,
      signups.anonymous_id,
      COALESCE(profiles.email, anon.email) AS email
    FROM public.project_signups AS signups
    LEFT JOIN public.profiles AS profiles ON profiles.id = signups.user_id
    LEFT JOIN public.anonymous_signups AS anon ON anon.id = signups.anonymous_id
    WHERE signups.project_id = v_project_id
      AND signups.status = 'approved'
    ORDER BY COALESCE(signups.user_id::text, signups.anonymous_id::text),
             signups.created_at ASC,
             signups.id ASC
  ),
  inserted AS (
    INSERT INTO public.project_cancellation_deliveries (
      job_id, project_id, signup_id, user_id, anonymous_id,
      recipient_email_hash, notification_dedupe_key, notification_state
    )
    SELECT
      p_job_id,
      v_project_id,
      audience.signup_id,
      audience.user_id,
      audience.anonymous_id,
      CASE
        WHEN NULLIF(btrim(COALESCE(audience.email, '')), '') IS NULL THEN NULL
        ELSE encode(
          extensions.digest(lower(btrim(audience.email)), 'sha256'), 'hex')
      END,
      'project-cancelled:' || v_project_id::text,
      CASE WHEN audience.user_id IS NULL THEN 'not_applicable' ELSE 'pending' END
    FROM audience
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*)::integer INTO v_recipients FROM inserted;

  UPDATE public.project_cancellation_jobs AS jobs
  SET audience_snapshot_at = v_now,
      recipient_count = v_recipients,
      updated_at = v_now
  WHERE jobs.id = p_job_id;

  RETURN pg_catalog.jsonb_build_object(
    'initialized', true, 'reason', NULL, 'recipients', v_recipients
  );
END;
$$;

COMMENT ON FUNCTION public.initialize_project_cancellation_audience(uuid, text) IS
  'Freezes the canonical cancellation audience into the delivery ledger exactly once, under the job lock, deduplicated to one row per recipient identity.';

-- ---------------------------------------------------------------------------
-- 7. Claim deliveries — keyset, bounded, and never over an expired lease
-- ---------------------------------------------------------------------------

-- The mirror of the job claim. This one refuses expired leases on purpose: an
-- expired delivery lease means the worker died around the provider call, which
-- is precisely the case where re-claiming re-sends. The reaper settles those.
CREATE OR REPLACE FUNCTION public.claim_project_cancellation_deliveries(
  p_job_id uuid,
  p_worker_id text,
  p_limit integer,
  p_lease_seconds integer
)
RETURNS TABLE (
  id uuid,
  project_id uuid,
  signup_id uuid,
  user_id uuid,
  anonymous_id uuid,
  notification_dedupe_key text,
  notification_state text,
  attempts smallint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_max_attempts constant integer := 3;
  c_max_limit constant integer := 100;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_job_id IS NULL
    OR NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL
    OR COALESCE(p_limit, 0) < 1
    OR p_limit > c_max_limit
    OR COALESCE(p_lease_seconds, 0) < 1
    OR p_lease_seconds > 900
  THEN
    RAISE EXCEPTION 'claim_project_cancellation_deliveries: invalid input'
      USING ERRCODE = '22023';
  END IF;

  -- Lock order step 2 before step 3. Holding the job lease is also the
  -- authorization check: a worker that lost its lease stops mid-drain instead
  -- of racing the worker that took over.
  PERFORM 1
  FROM public.project_cancellation_jobs AS jobs
  WHERE jobs.id = p_job_id
    AND jobs.status = 'processing'
    AND jobs.lease_owner = p_worker_id
    AND jobs.lease_expires_at > v_now
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.project_cancellation_deliveries AS deliveries
  SET email_state = 'leased',
      lease_owner = p_worker_id,
      lease_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
      attempts = deliveries.attempts + 1,
      updated_at = v_now
  WHERE deliveries.id IN (
    SELECT candidates.id
    FROM public.project_cancellation_deliveries AS candidates
    WHERE candidates.job_id = p_job_id
      AND candidates.email_state = 'queued'
      AND candidates.attempts < c_max_attempts
    -- Keyset over an immutable, stable pair. The predecessor paged with
    -- .range() over a mutable signup list, which is what skipped and
    -- duplicated recipients.
    ORDER BY candidates.created_at ASC, candidates.id ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING deliveries.id, deliveries.project_id, deliveries.signup_id,
            deliveries.user_id, deliveries.anonymous_id,
            deliveries.notification_dedupe_key, deliveries.notification_state,
            deliveries.attempts;
END;
$$;

COMMENT ON FUNCTION public.claim_project_cancellation_deliveries(uuid, text, integer, integer) IS
  'Leases the next keyset page of queued recipients for a job the caller already owns. Never re-claims an expired lease, because that lease spanned a provider call.';

-- ---------------------------------------------------------------------------
-- 8. Settle a delivery — only the leaseholder, only from leased
-- ---------------------------------------------------------------------------

-- Takes no job lock: the delivery row is the only state a settlement owns, and
-- the settling worker may legitimately have lost the job lease while the
-- provider call was in flight. It alone knows what the provider said, so it
-- must always be able to record it.
CREATE OR REPLACE FUNCTION public.settle_project_cancellation_delivery(
  p_id uuid,
  p_worker_id text,
  p_email_state text,
  p_notification_state text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL,
  p_failure_code text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_state text;
BEGIN
  IF p_id IS NULL
    OR NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL
    -- 'queued' is the ONLY non-terminal settlement, and the application may
    -- only choose it for a failure that provably preceded the provider request.
    OR p_email_state NOT IN ('sent', 'skipped', 'failed', 'unknown_outcome', 'queued')
    OR (p_notification_state IS NOT NULL
        AND p_notification_state NOT IN
          ('pending', 'delivered', 'replayed', 'skipped', 'failed', 'not_applicable'))
  THEN
    RAISE EXCEPTION 'settle_project_cancellation_delivery: invalid input'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.project_cancellation_deliveries AS deliveries
  SET email_state = p_email_state,
      notification_state =
        COALESCE(p_notification_state, deliveries.notification_state),
      lease_owner = NULL,
      lease_expires_at = NULL,
      provider_message_id =
        COALESCE(p_provider_message_id, deliveries.provider_message_id),
      failure_code = p_failure_code,
      settled_at = CASE
        WHEN p_email_state = 'queued' THEN NULL
        ELSE pg_catalog.clock_timestamp()
      END,
      updated_at = pg_catalog.clock_timestamp()
  WHERE deliveries.id = p_id
    AND deliveries.email_state = 'leased'
    AND deliveries.lease_owner = p_worker_id
  RETURNING deliveries.email_state INTO v_state;

  -- A superseded settlement (reaped, or re-owned) is reported rather than
  -- raised, so the caller can count it without aborting its batch.
  IF v_state IS NULL THEN
    SELECT deliveries.email_state INTO v_state
    FROM public.project_cancellation_deliveries AS deliveries
    WHERE deliveries.id = p_id;
  END IF;

  RETURN COALESCE(v_state, 'missing');
END;
$$;

COMMENT ON FUNCTION public.settle_project_cancellation_delivery(uuid, text, text, text, text, text) IS
  'Records one recipient outcome. Only the leaseholder may settle, and only queued may be re-entered — never from an ambiguous provider interaction.';

-- ---------------------------------------------------------------------------
-- 9. Reapers — the two halves of lease recovery, kept apart
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reap_project_cancellation_delivery_leases()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reaped integer := 0;
BEGIN
  -- Terminal, and never re-sent. The worker vanished somewhere around the
  -- provider request, so the honest statement is "this may have been
  -- delivered", not "try again".
  UPDATE public.project_cancellation_deliveries AS deliveries
  SET email_state = 'unknown_outcome',
      lease_owner = NULL,
      lease_expires_at = NULL,
      failure_code = 'lease_expired',
      settled_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  WHERE deliveries.email_state = 'leased'
    AND deliveries.lease_expires_at < pg_catalog.clock_timestamp();

  GET DIAGNOSTICS v_reaped = ROW_COUNT;
  RETURN v_reaped;
END;
$$;

COMMENT ON FUNCTION public.reap_project_cancellation_delivery_leases() IS
  'Settles expired recipient leases as unknown_outcome. Terminal by design: an expired lease spanned a provider call and re-sending would duplicate a real email.';

CREATE OR REPLACE FUNCTION public.reap_project_cancellation_job_leases()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_max_attempts constant integer := 5;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_released integer := 0;
  v_failed integer := 0;
BEGIN
  -- Safe, unlike the delivery reaper above, because a job holds no provider
  -- interaction. Its in-flight recipients each carry their own lease and are
  -- settled by reap_project_cancellation_delivery_leases().
  UPDATE public.project_cancellation_jobs AS jobs
  SET status = 'pending',
      lease_owner = NULL,
      lease_expires_at = NULL,
      processing_started_at = NULL,
      updated_at = v_now
  WHERE jobs.status = 'processing'
    AND jobs.lease_expires_at < v_now
    AND jobs.attempts < c_max_attempts;

  GET DIAGNOSTICS v_released = ROW_COUNT;

  -- Terminalize what the claim can no longer pick up, so an exhausted job is
  -- visible as failed instead of sitting pending forever. Its unsent
  -- recipients stay 'queued' in the ledger and remain reviewable.
  UPDATE public.project_cancellation_jobs AS jobs
  SET status = 'failed',
      lease_owner = NULL,
      lease_expires_at = NULL,
      processing_started_at = NULL,
      last_error = 'attempts_exhausted',
      updated_at = v_now
  WHERE jobs.attempts >= c_max_attempts
    AND (
      jobs.status = 'pending'
      OR (jobs.status = 'processing' AND jobs.lease_expires_at < v_now)
    );

  GET DIAGNOSTICS v_failed = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object('released', v_released, 'failed', v_failed);
END;
$$;

COMMENT ON FUNCTION public.reap_project_cancellation_job_leases() IS
  'Releases expired job leases back to pending and terminalizes attempt-exhausted jobs. Safe because a job lease never spans a provider call.';

-- ---------------------------------------------------------------------------
-- 10. Finalize — the only writer of a terminal job state
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.finalize_project_cancellation_job(
  p_job_id uuid,
  p_worker_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_open integer := 0;
  v_unknown integer := 0;
  v_status text;
BEGIN
  IF p_job_id IS NULL OR NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'finalize_project_cancellation_job: invalid input'
      USING ERRCODE = '22004';
  END IF;

  -- Lock order step 2, then step 3 via the aggregate below.
  PERFORM 1
  FROM public.project_cancellation_jobs AS jobs
  WHERE jobs.id = p_job_id
    AND jobs.status = 'processing'
    AND jobs.lease_owner = p_worker_id
    AND jobs.lease_expires_at > v_now
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('finalized', false, 'status', NULL);
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE deliveries.email_state IN ('queued', 'leased')),
    COUNT(*) FILTER (WHERE deliveries.email_state = 'unknown_outcome')
  INTO v_open, v_unknown
  FROM public.project_cancellation_deliveries AS deliveries
  WHERE deliveries.job_id = p_job_id;

  IF v_open > 0 THEN
    -- More work, or another worker's in-flight recipient. Release the job so
    -- the next pass (this worker's or another's) can continue; the ledger, not
    -- the job, is where progress lives.
    v_status := 'pending';
    UPDATE public.project_cancellation_jobs AS jobs
    SET status = 'pending',
        lease_owner = NULL,
        lease_expires_at = NULL,
        processing_started_at = NULL,
        updated_at = v_now
    WHERE jobs.id = p_job_id;
  ELSE
    -- Every recipient is terminal. An ambiguous one makes the whole job a
    -- review item rather than a success: nobody may claim this project was
    -- cleanly notified when one send cannot be accounted for.
    v_status := CASE WHEN v_unknown > 0 THEN 'needs_review' ELSE 'completed' END;
    UPDATE public.project_cancellation_jobs AS jobs
    SET status = v_status,
        lease_owner = NULL,
        lease_expires_at = NULL,
        processing_started_at = NULL,
        completed_at = v_now,
        last_error = CASE
          WHEN v_unknown > 0 THEN 'ambiguous_provider_outcome'
          ELSE NULL
        END,
        updated_at = v_now
    WHERE jobs.id = p_job_id;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'finalized', true,
    'status', v_status,
    'open', v_open,
    'unknown', v_unknown
  );
END;
$$;

COMMENT ON FUNCTION public.finalize_project_cancellation_job(uuid, text) IS
  'Settles a job once its ledger is drained: completed when every recipient is accounted for, needs_review when any provider outcome is ambiguous.';

-- ---------------------------------------------------------------------------
-- 11. Grants — service_role only, matching the architecture audit gate
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.enqueue_project_cancellation_job(uuid, timestamptz, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_project_cancellation_job(uuid, timestamptz, text, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.claim_project_cancellation_jobs(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_project_cancellation_jobs(text, integer, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.initialize_project_cancellation_audience(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_project_cancellation_audience(uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.claim_project_cancellation_deliveries(uuid, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_project_cancellation_deliveries(uuid, text, integer, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.settle_project_cancellation_delivery(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_project_cancellation_delivery(uuid, text, text, text, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.reap_project_cancellation_delivery_leases()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_project_cancellation_delivery_leases()
  TO service_role;

REVOKE ALL ON FUNCTION public.reap_project_cancellation_job_leases()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_project_cancellation_job_leases()
  TO service_role;

REVOKE ALL ON FUNCTION public.finalize_project_cancellation_job(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_project_cancellation_job(uuid, text)
  TO service_role;
