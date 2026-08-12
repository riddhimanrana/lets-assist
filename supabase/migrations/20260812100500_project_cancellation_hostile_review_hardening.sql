-- Hostile-review hardening for the project-cancellation outbox.
--
-- This is intentionally a forward migration. The first durable-worker migration
-- remains immutable even though its split cancellation/enqueue/snapshot boundary
-- was not strong enough. The order below is part of the safety argument:
--
--   1. remove service execution from the old split RPCs;
--   2. turn every active pre-upgrade job into review (including cursor = 0);
--   3. preserve any in-flight provider ambiguity as unknown_outcome;
--   4. install the atomic cancellation boundary and the replacement worker RPCs.

-- ---------------------------------------------------------------------------
-- 1. Quiesce and park every pre-upgrade active job before any new claim shape
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.enqueue_project_cancellation_job(uuid, timestamptz, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.initialize_project_cancellation_audience(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_project_cancellation_jobs(text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_project_cancellation_deliveries(uuid, text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.settle_project_cancellation_delivery(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reap_project_cancellation_delivery_leases()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reap_project_cancellation_job_leases()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_project_cancellation_job(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- A delivery lease crossed application code that may already have entered the
-- provider. Upgrading can never turn that uncertainty back into queued work.
UPDATE public.project_cancellation_deliveries
SET email_state = 'unknown_outcome',
    lease_owner = NULL,
    lease_expires_at = NULL,
    failure_code = 'upgrade_inflight_outcome_unknown',
    settled_at = COALESCE(settled_at, pg_catalog.clock_timestamp()),
    updated_at = pg_catalog.clock_timestamp()
WHERE email_state = 'leased';

-- Every pending/processing row predates the atomic cancellation instant. That
-- includes pending cursor 0: the old worker advanced its cursor only after a
-- batch, so zero never proved that no provider request had begun.
UPDATE public.project_cancellation_jobs
SET status = 'needs_review',
    lease_owner = NULL,
    lease_expires_at = NULL,
    processing_started_at = NULL,
    last_error = 'legacy_job_parked_before_atomic_claims',
    updated_at = pg_catalog.clock_timestamp()
WHERE status IN ('pending', 'processing');

-- A legacy row could also have been marked completed without ever acquiring an
-- audience snapshot. Preserve it, but do not let that unproved terminal state
-- pass the replacement finalizer invariant.
UPDATE public.project_cancellation_jobs
SET status = 'needs_review',
    completed_at = COALESCE(completed_at, pg_catalog.clock_timestamp()),
    last_error = 'legacy_completed_job_without_audience_snapshot',
    updated_at = pg_catalog.clock_timestamp()
WHERE status = 'completed'
  AND audience_snapshot_at IS NULL;

DROP FUNCTION public.enqueue_project_cancellation_job(uuid, timestamptz, text, uuid);
DROP FUNCTION public.initialize_project_cancellation_audience(uuid, text);
DROP FUNCTION public.claim_project_cancellation_jobs(text, integer, integer);
DROP FUNCTION public.claim_project_cancellation_deliveries(uuid, text, integer, integer);
DROP FUNCTION public.settle_project_cancellation_delivery(uuid, text, text, text, text, text);
DROP FUNCTION public.reap_project_cancellation_delivery_leases();
DROP FUNCTION public.reap_project_cancellation_job_leases();
DROP FUNCTION public.finalize_project_cancellation_job(uuid, text);

-- ---------------------------------------------------------------------------
-- 2. Tenant coordinates and approval/cancellation serialization
-- ---------------------------------------------------------------------------

ALTER TABLE public.project_signups
  ADD COLUMN organization_id uuid;

UPDATE public.project_signups AS signups
SET organization_id = projects.organization_id
FROM public.projects AS projects
WHERE projects.id = signups.project_id;

ALTER TABLE public.projects
  ADD COLUMN cancellation_tenant_id uuid
    GENERATED ALWAYS AS (COALESCE(organization_id, id)) STORED;
ALTER TABLE public.project_signups
  ADD COLUMN cancellation_tenant_id uuid
    GENERATED ALWAYS AS (COALESCE(organization_id, project_id)) STORED;

CREATE UNIQUE INDEX projects_id_organization_id_uidx
  ON public.projects (id, organization_id);
CREATE UNIQUE INDEX projects_id_cancellation_tenant_uidx
  ON public.projects (id, cancellation_tenant_id);
CREATE UNIQUE INDEX project_signups_id_project_organization_uidx
  ON public.project_signups (id, project_id, organization_id);
CREATE INDEX project_signups_organization_id_idx
  ON public.project_signups (organization_id)
  WHERE organization_id IS NOT NULL;
CREATE INDEX project_signups_cancellation_audience_idx
  ON public.project_signups (project_id, created_at, id)
  WHERE status = 'approved';

ALTER TABLE public.project_signups
  ADD CONSTRAINT project_signups_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT project_signups_project_organization_fkey
    FOREIGN KEY (project_id, organization_id)
    REFERENCES public.projects(id, organization_id)
    MATCH SIMPLE ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT project_signups_project_tenant_fkey
    FOREIGN KEY (project_id, cancellation_tenant_id)
    REFERENCES public.projects(id, cancellation_tenant_id)
    ON DELETE CASCADE NOT VALID;

CREATE OR REPLACE FUNCTION app_private.enforce_project_signup_cancellation_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_organization_id uuid;
  v_project_status text;
  v_approving boolean :=
    NEW.status = 'approved'
    AND (
      TG_OP = 'INSERT'
      OR OLD.status IS DISTINCT FROM 'approved'
      OR OLD.project_id IS DISTINCT FROM NEW.project_id
    );
BEGIN
  IF NEW.project_id IS NULL THEN
    NEW.organization_id := NULL;
    RETURN NEW;
  END IF;

  -- Approval and cancellation share this project-row lock. Whichever commits
  -- first defines the cancellation audience; an approval that loses the race
  -- observes cancelled and is denied rather than landing outside the snapshot.
  IF v_approving THEN
    SELECT projects.organization_id, projects.status
    INTO v_organization_id, v_project_status
    FROM public.projects AS projects
    WHERE projects.id = NEW.project_id
    FOR UPDATE;
  ELSE
    SELECT projects.organization_id, projects.status
    INTO v_organization_id, v_project_status
    FROM public.projects AS projects
    WHERE projects.id = NEW.project_id;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project signup references a missing project'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.organization_id IS NOT NULL
    AND NEW.organization_id IS DISTINCT FROM v_organization_id
  THEN
    RAISE EXCEPTION 'project signup organization does not match project'
      USING ERRCODE = '23514';
  END IF;

  NEW.organization_id := v_organization_id;

  IF v_approving AND v_project_status IS DISTINCT FROM 'upcoming' THEN
    RAISE EXCEPTION 'signups can only be approved for upcoming projects'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.enforce_project_signup_cancellation_boundary()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.enforce_project_signup_cancellation_boundary()
  TO postgres;

CREATE TRIGGER enforce_project_signup_cancellation_boundary
  BEFORE INSERT OR UPDATE OF project_id, organization_id, status
  ON public.project_signups
  FOR EACH ROW
  EXECUTE FUNCTION app_private.enforce_project_signup_cancellation_boundary();

-- ---------------------------------------------------------------------------
-- 3. Frozen job and delivery evidence
-- ---------------------------------------------------------------------------

ALTER TABLE public.project_cancellation_jobs
  ADD COLUMN organization_id uuid,
  ADD COLUMN project_title text,
  ADD COLUMN cancellation_tenant_id uuid
    GENERATED ALWAYS AS (COALESCE(organization_id, project_id)) STORED;

UPDATE public.project_cancellation_jobs AS jobs
SET organization_id = projects.organization_id,
    project_title = COALESCE(projects.title, 'Unavailable project')
FROM public.projects AS projects
WHERE projects.id = jobs.project_id;

UPDATE public.project_cancellation_jobs
SET project_title = 'Unavailable project'
WHERE project_title IS NULL;

ALTER TABLE public.project_cancellation_jobs
  ALTER COLUMN project_title SET NOT NULL;

ALTER TABLE public.project_cancellation_jobs
  DROP CONSTRAINT project_cancellation_jobs_project_id_fkey,
  DROP CONSTRAINT project_cancellation_jobs_lease_shape;

ALTER TABLE public.project_cancellation_jobs
  ADD CONSTRAINT project_cancellation_jobs_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES public.projects(id)
    ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT project_cancellation_jobs_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
    ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT project_cancellation_jobs_project_organization_fkey
    FOREIGN KEY (project_id, organization_id)
    REFERENCES public.projects(id, organization_id)
    MATCH SIMPLE ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT project_cancellation_jobs_project_tenant_fkey
    FOREIGN KEY (project_id, cancellation_tenant_id)
    REFERENCES public.projects(id, cancellation_tenant_id)
    ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT project_cancellation_jobs_lease_shape CHECK (
    (lease_owner IS NULL) = (lease_expires_at IS NULL)
    AND (status = 'processing') = (lease_owner IS NOT NULL)
    AND (status = 'processing') = (processing_started_at IS NOT NULL)
  ),
  ADD CONSTRAINT project_cancellation_jobs_snapshot_shape CHECK (
    (audience_snapshot_at IS NULL) = (recipient_count IS NULL)
    AND (recipient_count IS NULL OR recipient_count >= 0)
    AND (
      status NOT IN ('pending', 'processing', 'completed')
      OR audience_snapshot_at IS NOT NULL
    )
  );

CREATE UNIQUE INDEX project_cancellation_jobs_id_project_org_uidx
  ON public.project_cancellation_jobs (id, project_id, organization_id);
CREATE UNIQUE INDEX project_cancellation_jobs_id_project_tenant_uidx
  ON public.project_cancellation_jobs (id, project_id, cancellation_tenant_id);
CREATE INDEX project_cancellation_jobs_organization_id_idx
  ON public.project_cancellation_jobs (organization_id, created_at, id)
  WHERE organization_id IS NOT NULL;

DROP INDEX project_cancellation_jobs_claimable_idx;
DROP INDEX project_cancellation_jobs_lease_idx;

CREATE INDEX project_cancellation_jobs_claimable_idx
  ON public.project_cancellation_jobs (
    cancellation_tenant_id, last_attempted_at NULLS FIRST, created_at, id
  )
  WHERE status = 'pending' AND attempts < 5;
CREATE INDEX project_cancellation_jobs_lease_idx
  ON public.project_cancellation_jobs (lease_expires_at, id)
  WHERE status = 'processing';
CREATE INDEX project_cancellation_jobs_exhausted_idx
  ON public.project_cancellation_jobs (
    last_attempted_at NULLS FIRST, created_at, id
  )
  WHERE status = 'pending' AND attempts >= 5;

ALTER TABLE public.project_cancellation_deliveries
  ADD COLUMN organization_id uuid,
  ADD COLUMN cancellation_tenant_id uuid
    GENERATED ALWAYS AS (COALESCE(organization_id, project_id)) STORED,
  ADD COLUMN signup_id_snapshot uuid,
  ADD COLUMN recipient_kind text,
  ADD COLUMN recipient_identity_hash text,
  ADD COLUMN recipient_email text,
  ADD COLUMN email_owed boolean,
  ADD COLUMN notification_owed boolean,
  ADD COLUMN work_state text NOT NULL DEFAULT 'idle',
  ADD COLUMN email_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN notification_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN redact_after timestamptz,
  ADD COLUMN redacted_at timestamptz;

-- The replacement channel vocabulary must be installed before old rows can be
-- mapped into it. Foreign keys remain in force until their safe deletion
-- actions are replaced below.
ALTER TABLE public.project_cancellation_deliveries
  DROP CONSTRAINT project_cancellation_deliveries_email_state_check,
  DROP CONSTRAINT project_cancellation_deliveries_notification_state_check,
  DROP CONSTRAINT project_cancellation_deliveries_attempts_bound,
  DROP CONSTRAINT project_cancellation_deliveries_identity,
  DROP CONSTRAINT project_cancellation_deliveries_notification_applicability,
  DROP CONSTRAINT project_cancellation_deliveries_lease_shape,
  DROP CONSTRAINT project_cancellation_deliveries_settlement_shape;

WITH frozen AS (
  SELECT
    deliveries.id,
    projects.organization_id,
    deliveries.signup_id,
    CASE WHEN deliveries.user_id IS NOT NULL THEN 'registered' ELSE 'anonymous' END AS recipient_kind,
    CASE
      WHEN deliveries.user_id IS NOT NULL
        THEN 'registered:' || deliveries.user_id::text
      ELSE 'anonymous:' || deliveries.anonymous_id::text
    END AS identity_source,
    NULLIF(btrim(COALESCE(profiles.email, anonymous.email, '')), '') AS recipient_email,
    jobs.cancelled_at
  FROM public.project_cancellation_deliveries AS deliveries
  JOIN public.project_cancellation_jobs AS jobs ON jobs.id = deliveries.job_id
  JOIN public.projects AS projects ON projects.id = deliveries.project_id
  LEFT JOIN public.profiles AS profiles ON profiles.id = deliveries.user_id
  LEFT JOIN public.anonymous_signups AS anonymous ON anonymous.id = deliveries.anonymous_id
)
UPDATE public.project_cancellation_deliveries AS deliveries
SET organization_id = frozen.organization_id,
    signup_id_snapshot = frozen.signup_id,
    recipient_kind = frozen.recipient_kind,
    recipient_identity_hash = pg_catalog.encode(
      extensions.digest(frozen.identity_source, 'sha256'), 'hex'
    ),
    recipient_email = frozen.recipient_email,
    recipient_email_hash = CASE
      WHEN frozen.recipient_email IS NULL THEN deliveries.recipient_email_hash
      ELSE pg_catalog.encode(
        extensions.digest(lower(frozen.recipient_email), 'sha256'), 'hex'
      )
    END,
    email_owed = frozen.recipient_email IS NOT NULL,
    notification_owed = frozen.recipient_kind = 'registered',
    email_state = CASE
      WHEN frozen.recipient_email IS NULL THEN 'not_owed'
      WHEN deliveries.email_state = 'sent' THEN 'accepted'
      WHEN deliveries.email_state = 'unknown_outcome' THEN 'unknown_outcome'
      WHEN deliveries.email_state = 'queued' THEN 'queued'
      ELSE 'failed'
    END,
    notification_state = CASE
      WHEN frozen.recipient_kind <> 'registered' THEN 'not_owed'
      WHEN deliveries.notification_state = 'delivered' THEN 'delivered'
      WHEN deliveries.notification_state = 'replayed' THEN 'replayed'
      WHEN deliveries.notification_state = 'pending' THEN 'queued'
      ELSE 'failed'
    END,
    work_state = 'idle',
    email_attempts = LEAST(deliveries.attempts, 3),
    notification_attempts = CASE
      WHEN frozen.recipient_kind = 'registered'
        AND deliveries.notification_state <> 'pending' THEN 1
      ELSE 0
    END,
    lease_owner = NULL,
    lease_expires_at = NULL,
    redact_after = frozen.cancelled_at + interval '90 days',
    settled_at = CASE
      WHEN deliveries.email_state IN ('queued', 'leased')
        OR deliveries.notification_state = 'pending' THEN NULL
      ELSE COALESCE(deliveries.settled_at, pg_catalog.clock_timestamp())
    END,
    updated_at = pg_catalog.clock_timestamp()
FROM frozen
WHERE frozen.id = deliveries.id;

-- Old queued rows may already have consumed the full retry allowance. They are
-- failed rather than made claimable for a fourth pre-send attempt.
UPDATE public.project_cancellation_deliveries
SET email_state = 'failed',
    failure_code = 'upgrade_attempts_exhausted',
    updated_at = pg_catalog.clock_timestamp()
WHERE email_state = 'queued'
  AND email_attempts >= 3;

-- Recompute settlement from the replacement two-channel truth, not from the
-- predecessor's email-only state machine.
UPDATE public.project_cancellation_deliveries
SET settled_at = CASE
      WHEN email_state NOT IN ('queued', 'sending')
        AND notification_state <> 'queued'
        THEN COALESCE(settled_at, pg_catalog.clock_timestamp())
      ELSE NULL
    END,
    updated_at = pg_catalog.clock_timestamp();

ALTER TABLE public.project_cancellation_deliveries
  ALTER COLUMN signup_id DROP NOT NULL,
  ALTER COLUMN signup_id_snapshot SET NOT NULL,
  ALTER COLUMN recipient_kind SET NOT NULL,
  ALTER COLUMN recipient_identity_hash SET NOT NULL,
  ALTER COLUMN email_owed SET NOT NULL,
  ALTER COLUMN notification_owed SET NOT NULL,
  ALTER COLUMN redact_after SET NOT NULL;

DROP INDEX project_cancellation_deliveries_job_signup_uidx;
DROP INDEX project_cancellation_deliveries_job_user_uidx;
DROP INDEX project_cancellation_deliveries_job_anon_uidx;
DROP INDEX project_cancellation_deliveries_claimable_idx;
DROP INDEX project_cancellation_deliveries_lease_idx;
DROP INDEX project_cancellation_deliveries_open_idx;

ALTER TABLE public.project_cancellation_deliveries
  DROP CONSTRAINT project_cancellation_deliveries_job_id_fkey,
  DROP CONSTRAINT project_cancellation_deliveries_project_id_fkey,
  DROP CONSTRAINT project_cancellation_deliveries_signup_id_fkey,
  DROP CONSTRAINT project_cancellation_deliveries_user_id_fkey,
  DROP CONSTRAINT project_cancellation_deliveries_anonymous_id_fkey;

ALTER TABLE public.project_cancellation_deliveries
  ADD CONSTRAINT project_cancellation_deliveries_job_id_fkey
    FOREIGN KEY (job_id) REFERENCES public.project_cancellation_jobs(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT project_cancellation_deliveries_job_project_org_fkey
    FOREIGN KEY (job_id, project_id, organization_id)
    REFERENCES public.project_cancellation_jobs(id, project_id, organization_id)
    MATCH SIMPLE ON DELETE RESTRICT,
  ADD CONSTRAINT project_cancellation_deliveries_job_project_tenant_fkey
    FOREIGN KEY (job_id, project_id, cancellation_tenant_id)
    REFERENCES public.project_cancellation_jobs(id, project_id, cancellation_tenant_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT project_cancellation_deliveries_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES public.projects(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT project_cancellation_deliveries_project_organization_fkey
    FOREIGN KEY (project_id, organization_id)
    REFERENCES public.projects(id, organization_id)
    MATCH SIMPLE ON DELETE RESTRICT,
  ADD CONSTRAINT project_cancellation_deliveries_project_tenant_fkey
    FOREIGN KEY (project_id, cancellation_tenant_id)
    REFERENCES public.projects(id, cancellation_tenant_id)
    ON DELETE RESTRICT,
  -- PostgreSQL 17 rejects SET NULL on a foreign key whose referencing columns
  -- include a generated column, even when a column list would only clear
  -- signup_id. These two ordinary-column keys are sufficient: project_id is
  -- always checked, organization_id is additionally checked when non-null, and
  -- cancellation_tenant_id is derived from those immutable coordinates on both
  -- rows. Deleting the live signup may therefore clear only signup_id without
  -- weakening project or tenant consistency.
  ADD CONSTRAINT project_cancellation_deliveries_signup_project_fkey
    FOREIGN KEY (signup_id, project_id)
    REFERENCES public.project_signups(id, project_id)
    ON DELETE SET NULL (signup_id),
  ADD CONSTRAINT project_cancellation_deliveries_signup_tenant_fkey
    FOREIGN KEY (signup_id, project_id, organization_id)
    REFERENCES public.project_signups(id, project_id, organization_id)
    MATCH SIMPLE ON DELETE SET NULL (signup_id),
  ADD CONSTRAINT project_cancellation_deliveries_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT project_cancellation_deliveries_anonymous_id_fkey
    FOREIGN KEY (anonymous_id) REFERENCES public.anonymous_signups(id) ON DELETE SET NULL,
  ADD CONSTRAINT project_cancellation_deliveries_recipient_kind_check CHECK (
    recipient_kind IN ('registered', 'anonymous')
    AND (recipient_kind <> 'registered' OR anonymous_id IS NULL)
    AND (recipient_kind <> 'anonymous' OR user_id IS NULL)
  ),
  ADD CONSTRAINT project_cancellation_deliveries_email_state_check CHECK (
    email_state IN ('not_owed', 'queued', 'sending', 'accepted', 'failed', 'unknown_outcome')
  ),
  ADD CONSTRAINT project_cancellation_deliveries_notification_state_check CHECK (
    notification_state IN ('not_owed', 'queued', 'delivered', 'replayed', 'failed')
  ),
  ADD CONSTRAINT project_cancellation_deliveries_work_state_check CHECK (
    work_state IN ('idle', 'leased')
  ),
  ADD CONSTRAINT project_cancellation_deliveries_attempts_bound CHECK (
    email_attempts BETWEEN 0 AND 3
    AND notification_attempts BETWEEN 0 AND 3
  ),
  ADD CONSTRAINT project_cancellation_deliveries_owed_channel_shape CHECK (
    email_owed = (email_state <> 'not_owed')
    AND notification_owed = (notification_state <> 'not_owed')
    AND notification_owed = (recipient_kind = 'registered')
  ),
  ADD CONSTRAINT project_cancellation_deliveries_destination_shape CHECK (
    (NOT email_owed AND recipient_email IS NULL)
    OR (
      email_owed
      AND recipient_email_hash IS NOT NULL
      AND (recipient_email IS NOT NULL OR redacted_at IS NOT NULL)
    )
  ),
  ADD CONSTRAINT project_cancellation_deliveries_identity_hash_shape CHECK (
    recipient_identity_hash ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT project_cancellation_deliveries_lease_shape CHECK (
    (lease_owner IS NULL) = (lease_expires_at IS NULL)
    AND (work_state = 'leased') = (lease_owner IS NOT NULL)
    AND (email_state <> 'sending' OR work_state = 'leased')
  ),
  ADD CONSTRAINT project_cancellation_deliveries_settlement_shape CHECK (
    (settled_at IS NOT NULL) = (
      work_state = 'idle'
      AND email_state NOT IN ('queued', 'sending')
      AND notification_state <> 'queued'
    )
  ),
  ADD CONSTRAINT project_cancellation_deliveries_failure_code_bounded CHECK (
    failure_code IS NULL OR failure_code ~ '^[a-z0-9_]{1,64}$'
  ),
  ADD CONSTRAINT project_cancellation_deliveries_provider_id_bounded CHECK (
    provider_message_id IS NULL
    OR char_length(provider_message_id) BETWEEN 1 AND 200
  );

CREATE UNIQUE INDEX project_cancellation_deliveries_job_identity_uidx
  ON public.project_cancellation_deliveries (job_id, recipient_identity_hash);
CREATE UNIQUE INDEX project_cancellation_deliveries_job_signup_snapshot_uidx
  ON public.project_cancellation_deliveries (job_id, signup_id_snapshot);
CREATE INDEX project_cancellation_deliveries_job_id_idx
  ON public.project_cancellation_deliveries (job_id);
CREATE INDEX project_cancellation_deliveries_project_id_idx
  ON public.project_cancellation_deliveries (project_id);
CREATE INDEX project_cancellation_deliveries_organization_id_idx
  ON public.project_cancellation_deliveries (organization_id, job_id)
  WHERE organization_id IS NOT NULL;
CREATE INDEX project_cancellation_deliveries_signup_id_idx
  ON public.project_cancellation_deliveries (signup_id)
  WHERE signup_id IS NOT NULL;
CREATE INDEX project_cancellation_deliveries_user_id_idx
  ON public.project_cancellation_deliveries (user_id)
  WHERE user_id IS NOT NULL;
CREATE INDEX project_cancellation_deliveries_anonymous_id_idx
  ON public.project_cancellation_deliveries (anonymous_id)
  WHERE anonymous_id IS NOT NULL;
CREATE INDEX project_cancellation_deliveries_claimable_idx
  ON public.project_cancellation_deliveries (job_id, created_at, id)
  WHERE work_state = 'idle'
    AND (email_state = 'queued' OR notification_state = 'queued');
CREATE INDEX project_cancellation_deliveries_lease_idx
  ON public.project_cancellation_deliveries (lease_expires_at, id)
  WHERE work_state = 'leased';
CREATE INDEX project_cancellation_deliveries_retention_idx
  ON public.project_cancellation_deliveries (redact_after, id)
  WHERE recipient_email IS NOT NULL AND redacted_at IS NULL;

COMMENT ON COLUMN public.project_cancellation_deliveries.recipient_email IS
  'Exact trimmed destination frozen at cancellation. Service-only PII, automatically redacted after 90 days once both owed channels are terminal.';
COMMENT ON COLUMN public.project_cancellation_deliveries.recipient_identity_hash IS
  'Pseudonymous frozen recipient identity evidence that survives deletion of the live signup/account row.';
COMMENT ON COLUMN public.project_cancellation_deliveries.signup_id_snapshot IS
  'Immutable signup evidence. signup_id is the nullable live reference and may be cleared by deletion.';

-- Frozen facts never change after insertion. Live nullable references may be
-- cleared by their SET NULL foreign keys, and recipient_email has one reviewed
-- privacy transition through the retention RPC below.
CREATE OR REPLACE FUNCTION app_private.guard_project_cancellation_job_frozen_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.organization_id IS DISTINCT FROM NEW.organization_id
    OR OLD.project_title IS DISTINCT FROM NEW.project_title
    OR OLD.cancelled_at IS DISTINCT FROM NEW.cancelled_at
    OR OLD.cancellation_reason IS DISTINCT FROM NEW.cancellation_reason
    OR OLD.created_by IS DISTINCT FROM NEW.created_by
    OR OLD.audience_snapshot_at IS DISTINCT FROM NEW.audience_snapshot_at
    OR OLD.recipient_count IS DISTINCT FROM NEW.recipient_count
  THEN
    RAISE EXCEPTION 'project cancellation job frozen fields are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.guard_project_cancellation_job_frozen_fields()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.guard_project_cancellation_job_frozen_fields()
  TO postgres;

CREATE TRIGGER guard_project_cancellation_job_frozen_fields
  BEFORE UPDATE ON public.project_cancellation_jobs
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_project_cancellation_job_frozen_fields();

CREATE OR REPLACE FUNCTION app_private.guard_project_cancellation_delivery_frozen_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.job_id IS DISTINCT FROM NEW.job_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.organization_id IS DISTINCT FROM NEW.organization_id
    OR OLD.signup_id_snapshot IS DISTINCT FROM NEW.signup_id_snapshot
    OR OLD.recipient_kind IS DISTINCT FROM NEW.recipient_kind
    OR OLD.recipient_identity_hash IS DISTINCT FROM NEW.recipient_identity_hash
    OR OLD.recipient_email_hash IS DISTINCT FROM NEW.recipient_email_hash
    OR OLD.email_owed IS DISTINCT FROM NEW.email_owed
    OR OLD.notification_owed IS DISTINCT FROM NEW.notification_owed
    OR OLD.notification_dedupe_key IS DISTINCT FROM NEW.notification_dedupe_key
    OR OLD.redact_after IS DISTINCT FROM NEW.redact_after
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'project cancellation delivery frozen fields are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.recipient_email IS DISTINCT FROM NEW.recipient_email
    AND NOT (
      OLD.recipient_email IS NOT NULL
      AND NEW.recipient_email IS NULL
      AND OLD.redacted_at IS NULL
      AND NEW.redacted_at IS NOT NULL
    )
  THEN
    RAISE EXCEPTION 'project cancellation destination is immutable except for retention redaction'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.redacted_at IS DISTINCT FROM NEW.redacted_at
    AND NOT (
      OLD.redacted_at IS NULL
      AND NEW.redacted_at IS NOT NULL
      AND OLD.recipient_email IS NOT NULL
      AND NEW.recipient_email IS NULL
    )
  THEN
    RAISE EXCEPTION 'project cancellation redaction marker is append-only'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.guard_project_cancellation_delivery_frozen_fields()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.guard_project_cancellation_delivery_frozen_fields()
  TO postgres;

CREATE TRIGGER guard_project_cancellation_delivery_frozen_fields
  BEFORE UPDATE ON public.project_cancellation_deliveries
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_project_cancellation_delivery_frozen_fields();

-- ---------------------------------------------------------------------------
-- 4. One authenticated transaction: permission, transition, audience, outbox
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.cancel_project_transactional(
  p_project_id uuid,
  p_cancellation_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_project public.projects%ROWTYPE;
  v_job_id uuid;
  v_existing_status text;
  v_existing_snapshot timestamptz;
  v_existing_requires_review boolean;
  v_transition_count integer := 0;
  v_recipient_count integer := 0;
  v_permitted boolean := false;
BEGIN
  IF v_actor_id IS NULL
    OR p_project_id IS NULL
    OR NULLIF(btrim(COALESCE(p_cancellation_reason, '')), '') IS NULL
    OR char_length(btrim(p_cancellation_reason)) > 2000
  THEN
    RAISE EXCEPTION 'cancel_project_transactional: invalid input'
      USING ERRCODE = '22023';
  END IF;

  SELECT projects.* INTO v_project
  FROM public.projects AS projects
  WHERE projects.id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'P0002';
  END IF;

  v_permitted := v_project.creator_id = v_actor_id;
  IF NOT v_permitted AND v_project.organization_id IS NOT NULL THEN
    PERFORM members.user_id
    FROM public.organization_members AS members
    WHERE members.organization_id = v_project.organization_id
      AND members.user_id = v_actor_id
      AND COALESCE(members.status, 'active') = 'active'
      AND (
        members.role = 'admin'
        OR (members.role = 'staff' AND v_project.can_be_managed_by_staff IS TRUE)
      )
    FOR SHARE OF members;

    v_permitted := FOUND;
  END IF;

  IF NOT v_permitted THEN
    RAISE EXCEPTION 'project cancellation permission denied'
      USING ERRCODE = '42501';
  END IF;

  IF v_project.status = 'cancelled' THEN
    SELECT jobs.status, jobs.audience_snapshot_at
    INTO v_existing_status, v_existing_snapshot
    FROM public.project_cancellation_jobs AS jobs
    WHERE jobs.project_id = p_project_id;

    v_existing_requires_review :=
      v_existing_snapshot IS NULL
      OR v_existing_status IS NULL
      OR v_existing_status IN ('failed', 'needs_review');

    RETURN pg_catalog.jsonb_build_object(
      'outcome', CASE
        WHEN v_existing_requires_review THEN 'already_cancelled_review_required'
        ELSE 'already_cancelled'
      END,
      'jobStatus', COALESCE(v_existing_status, 'missing'),
      'accepted', NOT v_existing_requires_review
    );
  END IF;

  IF v_project.status IS DISTINCT FROM 'upcoming' THEN
    RAISE EXCEPTION 'only an upcoming project can be cancelled'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.project_cancellation_jobs AS jobs
    WHERE jobs.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'a cancellation ledger already exists for this project'
      USING ERRCODE = '55000';
  END IF;

  v_job_id := gen_random_uuid();

  -- Transition, approved-audience read, job insert, and delivery inserts are one
  -- SQL statement and therefore one visibility snapshot. A concurrent approval
  -- waits on the project lock; a concurrent withdrawal is either wholly before
  -- this statement or wholly after its frozen audience.
  WITH instant AS MATERIALIZED (
    SELECT pg_catalog.clock_timestamp() AS cancelled_at
  ),
  transitioned AS (
    UPDATE public.projects AS projects
    SET status = 'cancelled',
        cancelled_at = instant.cancelled_at,
        cancellation_reason = btrim(p_cancellation_reason)
    FROM instant
    WHERE projects.id = p_project_id
      AND projects.status = 'upcoming'
    RETURNING projects.id, instant.cancelled_at
  ),
  deduped_audience AS MATERIALIZED (
    SELECT DISTINCT ON (
      CASE
        WHEN signups.user_id IS NOT NULL THEN 'registered:' || signups.user_id::text
        ELSE 'anonymous:' || signups.anonymous_id::text
      END
    )
      signups.id AS signup_id,
      signups.user_id,
      signups.anonymous_id,
      CASE WHEN signups.user_id IS NOT NULL THEN 'registered' ELSE 'anonymous' END AS recipient_kind,
      CASE
        WHEN signups.user_id IS NOT NULL THEN 'registered:' || signups.user_id::text
        ELSE 'anonymous:' || signups.anonymous_id::text
      END AS identity_source,
      NULLIF(btrim(COALESCE(profiles.email, anonymous.email, '')), '') AS recipient_email
    FROM public.project_signups AS signups
    CROSS JOIN transitioned
    LEFT JOIN public.profiles AS profiles ON profiles.id = signups.user_id
    LEFT JOIN public.anonymous_signups AS anonymous ON anonymous.id = signups.anonymous_id
    WHERE signups.project_id = p_project_id
      AND signups.organization_id IS NOT DISTINCT FROM v_project.organization_id
      AND signups.status = 'approved'
    ORDER BY
      CASE
        WHEN signups.user_id IS NOT NULL THEN 'registered:' || signups.user_id::text
        ELSE 'anonymous:' || signups.anonymous_id::text
      END,
      signups.created_at,
      signups.id
  ),
  audience AS MATERIALIZED (
    SELECT deduped.*
    FROM deduped_audience AS deduped
    WHERE deduped.recipient_kind = 'registered'
       OR deduped.recipient_email IS NOT NULL
  ),
  inserted_job AS (
    INSERT INTO public.project_cancellation_jobs (
      id, project_id, organization_id, project_title,
      cancelled_at, cancellation_reason, created_by,
      status, audience_snapshot_at, recipient_count
    )
    SELECT
      v_job_id, p_project_id, v_project.organization_id, v_project.title,
      transitioned.cancelled_at, btrim(p_cancellation_reason), v_actor_id,
      'pending', transitioned.cancelled_at,
      (SELECT count(*)::integer FROM audience)
    FROM transitioned
    RETURNING id, audience_snapshot_at
  ),
  inserted_deliveries AS (
    INSERT INTO public.project_cancellation_deliveries (
      job_id, project_id, organization_id,
      signup_id, signup_id_snapshot, user_id, anonymous_id,
      recipient_kind, recipient_identity_hash,
      recipient_email, recipient_email_hash,
      email_owed, notification_owed,
      notification_dedupe_key, email_state, notification_state,
      work_state, email_attempts, notification_attempts,
      redact_after, settled_at
    )
    SELECT
      inserted_job.id,
      p_project_id,
      v_project.organization_id,
      audience.signup_id,
      audience.signup_id,
      audience.user_id,
      audience.anonymous_id,
      audience.recipient_kind,
      pg_catalog.encode(extensions.digest(audience.identity_source, 'sha256'), 'hex'),
      audience.recipient_email,
      CASE
        WHEN audience.recipient_email IS NULL THEN NULL
        ELSE pg_catalog.encode(
          extensions.digest(lower(audience.recipient_email), 'sha256'), 'hex'
        )
      END,
      audience.recipient_email IS NOT NULL,
      audience.recipient_kind = 'registered',
      'project-cancelled:' || p_project_id::text,
      CASE WHEN audience.recipient_email IS NULL THEN 'not_owed' ELSE 'queued' END,
      CASE WHEN audience.recipient_kind = 'registered' THEN 'queued' ELSE 'not_owed' END,
      'idle',
      0,
      0,
      inserted_job.audience_snapshot_at + interval '90 days',
      NULL
    FROM audience
    CROSS JOIN inserted_job
    RETURNING id
  )
  SELECT
    (SELECT count(*)::integer FROM transitioned),
    count(*)::integer
  INTO v_transition_count, v_recipient_count
  FROM inserted_deliveries;

  IF v_transition_count <> 1 THEN
    RAISE EXCEPTION 'project cancellation transition lost'
      USING ERRCODE = '40001';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'cancelled',
    'jobStatus', 'pending',
    'accepted', true
  );
END;
$$;

COMMENT ON FUNCTION public.cancel_project_transactional(uuid, text) IS
  'Authenticated authority for an upcoming-to-cancelled transition. Rechecks management permission under the project lock and atomically freezes the exact approved recipient/channel ledger.';

REVOKE ALL ON FUNCTION public.cancel_project_transactional(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_project_transactional(uuid, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Fair, bounded claims and channel-aware settlement
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.claim_project_cancellation_jobs(
  p_worker_id text,
  p_limit integer,
  p_lease_seconds integer
)
RETURNS TABLE (
  id uuid,
  project_id uuid,
  organization_id uuid,
  project_title text,
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
    OR COALESCE(p_limit, 0) < 1 OR p_limit > c_max_limit
    OR COALESCE(p_lease_seconds, 0) < 1 OR p_lease_seconds > 900
  THEN
    RAISE EXCEPTION 'claim_project_cancellation_jobs: invalid input'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH tenant_activity AS MATERIALIZED (
    SELECT jobs.cancellation_tenant_id AS tenant_key,
           pg_catalog.max(jobs.last_attempted_at) AS tenant_last_attempted
    FROM public.project_cancellation_jobs AS jobs
    GROUP BY jobs.cancellation_tenant_id
  ),
  ranked AS MATERIALIZED (
    SELECT
      jobs.id,
      jobs.cancellation_tenant_id AS tenant_key,
      pg_catalog.row_number() OVER (
        PARTITION BY jobs.cancellation_tenant_id
        ORDER BY jobs.last_attempted_at ASC NULLS FIRST, jobs.created_at, jobs.id
      ) AS tenant_round,
      tenant_activity.tenant_last_attempted,
      jobs.last_attempted_at,
      jobs.created_at
    FROM public.project_cancellation_jobs AS jobs
    JOIN tenant_activity
      ON tenant_activity.tenant_key = jobs.cancellation_tenant_id
    WHERE jobs.status = 'pending'
      AND jobs.attempts < c_max_attempts
      AND jobs.audience_snapshot_at IS NOT NULL
      AND jobs.recipient_count IS NOT NULL
  ),
  candidates AS (
    SELECT jobs.id
    FROM public.project_cancellation_jobs AS jobs
    JOIN ranked ON ranked.id = jobs.id
    ORDER BY ranked.tenant_round,
             ranked.tenant_last_attempted ASC NULLS FIRST,
             ranked.tenant_key,
             ranked.last_attempted_at ASC NULLS FIRST,
             ranked.created_at,
             jobs.id
    LIMIT p_limit
    FOR UPDATE OF jobs SKIP LOCKED
  )
  UPDATE public.project_cancellation_jobs AS jobs
  SET status = 'processing',
      lease_owner = p_worker_id,
      lease_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
      attempts = jobs.attempts + 1,
      last_attempted_at = v_now,
      processing_started_at = v_now,
      updated_at = v_now
  FROM candidates
  WHERE jobs.id = candidates.id
  RETURNING jobs.id, jobs.project_id, jobs.organization_id, jobs.project_title,
            jobs.cancelled_at, jobs.cancellation_reason, jobs.attempts,
            jobs.audience_snapshot_at, jobs.recipient_count;
END;
$$;

CREATE FUNCTION public.claim_project_cancellation_deliveries(
  p_job_id uuid,
  p_worker_id text,
  p_limit integer,
  p_lease_seconds integer
)
RETURNS TABLE (
  id uuid,
  project_id uuid,
  organization_id uuid,
  signup_id_snapshot uuid,
  user_id uuid,
  recipient_kind text,
  recipient_email text,
  notification_dedupe_key text,
  email_state text,
  notification_state text,
  email_attempts smallint,
  notification_attempts smallint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_max_limit constant integer := 50;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_job_id IS NULL
    OR NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL
    OR COALESCE(p_limit, 0) < 1 OR p_limit > c_max_limit
    OR COALESCE(p_lease_seconds, 0) < 1 OR p_lease_seconds > 900
  THEN
    RAISE EXCEPTION 'claim_project_cancellation_deliveries: invalid input'
      USING ERRCODE = '22023';
  END IF;

  -- Any path touching both tables takes the job first, then deliveries.
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
  WITH candidates AS (
    SELECT deliveries.id
    FROM public.project_cancellation_deliveries AS deliveries
    WHERE deliveries.job_id = p_job_id
      AND deliveries.work_state = 'idle'
      AND (
        (deliveries.email_state = 'queued' AND deliveries.email_attempts < 3)
        OR (
          deliveries.notification_state = 'queued'
          AND deliveries.notification_attempts < 3
        )
      )
    ORDER BY deliveries.created_at, deliveries.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.project_cancellation_deliveries AS deliveries
  SET work_state = 'leased',
      lease_owner = p_worker_id,
      lease_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
      email_attempts = CASE
        WHEN deliveries.email_state = 'queued' THEN deliveries.email_attempts + 1
        ELSE deliveries.email_attempts
      END,
      notification_attempts = CASE
        WHEN deliveries.notification_state = 'queued'
          THEN deliveries.notification_attempts + 1
        ELSE deliveries.notification_attempts
      END,
      settled_at = NULL,
      updated_at = v_now
  FROM candidates
  WHERE deliveries.id = candidates.id
  RETURNING deliveries.id, deliveries.project_id, deliveries.organization_id,
            deliveries.signup_id_snapshot, deliveries.user_id,
            deliveries.recipient_kind, deliveries.recipient_email,
            deliveries.notification_dedupe_key, deliveries.email_state,
            deliveries.notification_state, deliveries.email_attempts,
            deliveries.notification_attempts;
END;
$$;

CREATE FUNCTION public.mark_project_cancellation_email_sending(
  p_delivery_id uuid,
  p_worker_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_state text;
BEGIN
  IF p_delivery_id IS NULL
    OR NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL
  THEN
    RAISE EXCEPTION 'mark_project_cancellation_email_sending: invalid input'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.project_cancellation_deliveries AS deliveries
  SET email_state = 'sending',
      updated_at = pg_catalog.clock_timestamp()
  WHERE deliveries.id = p_delivery_id
    AND deliveries.work_state = 'leased'
    AND deliveries.lease_owner = p_worker_id
    AND deliveries.lease_expires_at > pg_catalog.clock_timestamp()
    AND deliveries.email_state = 'queued'
  RETURNING deliveries.email_state INTO v_state;

  RETURN pg_catalog.jsonb_build_object(
    'started', v_state = 'sending',
    'emailState', v_state
  );
END;
$$;

CREATE FUNCTION public.settle_project_cancellation_delivery(
  p_delivery_id uuid,
  p_worker_id text,
  p_email_outcome text DEFAULT NULL,
  p_notification_outcome text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL,
  p_failure_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_delivery public.project_cancellation_deliveries%ROWTYPE;
  v_email_state text;
  v_notification_state text;
  v_settled_at timestamptz;
BEGIN
  IF p_delivery_id IS NULL
    OR NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL
    OR (p_email_outcome IS NOT NULL
        AND p_email_outcome NOT IN ('accepted', 'retryable_pre_send', 'failed', 'unknown_outcome'))
    OR (p_notification_outcome IS NOT NULL
        AND p_notification_outcome NOT IN ('delivered', 'replayed', 'retryable', 'failed'))
    OR (p_failure_code IS NOT NULL AND p_failure_code !~ '^[a-z0-9_]{1,64}$')
  THEN
    RAISE EXCEPTION 'settle_project_cancellation_delivery: invalid input'
      USING ERRCODE = '22023';
  END IF;

  SELECT deliveries.* INTO v_delivery
  FROM public.project_cancellation_deliveries AS deliveries
  WHERE deliveries.id = p_delivery_id
    AND deliveries.work_state = 'leased'
    AND deliveries.lease_owner = p_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('settled', false, 'reason', 'lease_lost');
  END IF;

  v_email_state := v_delivery.email_state;
  v_notification_state := v_delivery.notification_state;

  IF p_email_outcome IS NOT NULL THEN
    IF v_delivery.email_state <> 'sending' THEN
      RAISE EXCEPTION 'email outcome requires a sending delivery'
        USING ERRCODE = '55000';
    END IF;
    IF p_email_outcome = 'accepted' AND NULLIF(btrim(COALESCE(p_provider_message_id, '')), '') IS NULL THEN
      RAISE EXCEPTION 'accepted email requires provider message id'
        USING ERRCODE = '22023';
    END IF;
    v_email_state := CASE
      WHEN p_email_outcome = 'retryable_pre_send' AND v_delivery.email_attempts < 3 THEN 'queued'
      WHEN p_email_outcome = 'retryable_pre_send' THEN 'failed'
      ELSE p_email_outcome
    END;
  ELSIF v_delivery.email_state = 'sending' THEN
    RAISE EXCEPTION 'sending delivery requires an email outcome'
      USING ERRCODE = '55000';
  END IF;

  IF p_notification_outcome IS NOT NULL THEN
    IF v_delivery.notification_state <> 'queued' THEN
      RAISE EXCEPTION 'notification outcome requires queued notification work'
        USING ERRCODE = '55000';
    END IF;
    v_notification_state := CASE
      WHEN p_notification_outcome = 'retryable'
        AND v_delivery.notification_attempts < 3 THEN 'queued'
      WHEN p_notification_outcome = 'retryable' THEN 'failed'
      ELSE p_notification_outcome
    END;
  END IF;

  v_settled_at := CASE
    WHEN v_email_state NOT IN ('queued', 'sending')
      AND v_notification_state <> 'queued'
      THEN pg_catalog.clock_timestamp()
    ELSE NULL
  END;

  UPDATE public.project_cancellation_deliveries AS deliveries
  SET email_state = v_email_state,
      notification_state = v_notification_state,
      work_state = 'idle',
      lease_owner = NULL,
      lease_expires_at = NULL,
      provider_message_id = CASE
        WHEN p_email_outcome = 'accepted' THEN p_provider_message_id
        ELSE deliveries.provider_message_id
      END,
      failure_code = p_failure_code,
      settled_at = v_settled_at,
      updated_at = pg_catalog.clock_timestamp()
  WHERE deliveries.id = p_delivery_id;

  RETURN pg_catalog.jsonb_build_object(
    'settled', true,
    'emailState', v_email_state,
    'notificationState', v_notification_state,
    'terminal', v_settled_at IS NOT NULL
  );
END;
$$;

CREATE FUNCTION public.release_project_cancellation_delivery(
  p_delivery_id uuid,
  p_worker_id text,
  p_failure_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_delivery public.project_cancellation_deliveries%ROWTYPE;
  v_email_state text;
  v_notification_state text;
  v_settled_at timestamptz;
BEGIN
  IF p_delivery_id IS NULL
    OR NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL
    OR p_failure_code !~ '^[a-z0-9_]{1,64}$'
  THEN
    RAISE EXCEPTION 'release_project_cancellation_delivery: invalid input'
      USING ERRCODE = '22023';
  END IF;

  SELECT deliveries.* INTO v_delivery
  FROM public.project_cancellation_deliveries AS deliveries
  WHERE deliveries.id = p_delivery_id
    AND deliveries.work_state = 'leased'
    AND deliveries.lease_owner = p_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('released', false, 'reason', 'lease_lost');
  END IF;

  v_email_state := CASE
    WHEN v_delivery.email_state IN ('queued', 'sending')
      AND v_delivery.email_attempts >= 3 THEN 'failed'
    WHEN v_delivery.email_state = 'sending' THEN 'queued'
    ELSE v_delivery.email_state
  END;
  v_notification_state := CASE
    WHEN v_delivery.notification_state = 'queued'
      AND v_delivery.notification_attempts >= 3 THEN 'failed'
    ELSE v_delivery.notification_state
  END;
  v_settled_at := CASE
    WHEN v_email_state NOT IN ('queued', 'sending')
      AND v_notification_state <> 'queued'
      THEN pg_catalog.clock_timestamp()
    ELSE NULL
  END;

  UPDATE public.project_cancellation_deliveries AS deliveries
  SET email_state = v_email_state,
      notification_state = v_notification_state,
      work_state = 'idle',
      lease_owner = NULL,
      lease_expires_at = NULL,
      failure_code = p_failure_code,
      settled_at = v_settled_at,
      updated_at = pg_catalog.clock_timestamp()
  WHERE deliveries.id = p_delivery_id;

  RETURN pg_catalog.jsonb_build_object(
    'released', v_email_state IS NOT NULL,
    'emailState', v_email_state,
    'notificationState', v_notification_state
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Bounded deterministic reapers and finalizer
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.reap_project_cancellation_delivery_leases(p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_max_limit constant integer := 500;
  v_released integer := 0;
  v_unknown integer := 0;
BEGIN
  IF COALESCE(p_limit, 0) < 1 OR p_limit > c_max_limit THEN
    RAISE EXCEPTION 'reap_project_cancellation_delivery_leases: invalid input'
      USING ERRCODE = '22023';
  END IF;

  WITH candidates AS (
    SELECT deliveries.id
    FROM public.project_cancellation_deliveries AS deliveries
    WHERE deliveries.work_state = 'leased'
      AND deliveries.lease_expires_at < pg_catalog.clock_timestamp()
    ORDER BY deliveries.lease_expires_at, deliveries.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  reaped AS (
    UPDATE public.project_cancellation_deliveries AS deliveries
    SET email_state = CASE
          WHEN deliveries.email_state = 'sending' THEN 'unknown_outcome'
          WHEN deliveries.email_state = 'queued' AND deliveries.email_attempts >= 3
            THEN 'failed'
          ELSE deliveries.email_state
        END,
        notification_state = CASE
          WHEN deliveries.notification_state = 'queued'
            AND deliveries.notification_attempts >= 3 THEN 'failed'
          ELSE deliveries.notification_state
        END,
        work_state = 'idle',
        lease_owner = NULL,
        lease_expires_at = NULL,
        failure_code = CASE
          WHEN deliveries.email_state = 'sending' THEN 'lease_expired_after_send_start'
          ELSE 'lease_expired_before_send_start'
        END,
        settled_at = CASE
          WHEN (CASE
                  WHEN deliveries.email_state = 'sending' THEN 'unknown_outcome'
                  WHEN deliveries.email_state = 'queued' AND deliveries.email_attempts >= 3
                    THEN 'failed'
                  ELSE deliveries.email_state
                END) NOT IN ('queued', 'sending')
            AND (CASE
                   WHEN deliveries.notification_state = 'queued'
                     AND deliveries.notification_attempts >= 3 THEN 'failed'
                   ELSE deliveries.notification_state
                 END) <> 'queued'
            THEN pg_catalog.clock_timestamp()
          ELSE NULL
        END,
        updated_at = pg_catalog.clock_timestamp()
    FROM candidates
    WHERE deliveries.id = candidates.id
    RETURNING deliveries.email_state
  )
  SELECT count(*)::integer,
         count(*) FILTER (WHERE email_state = 'unknown_outcome')::integer
  INTO v_released, v_unknown
  FROM reaped;

  RETURN pg_catalog.jsonb_build_object('released', v_released, 'unknown', v_unknown);
END;
$$;

CREATE FUNCTION public.reap_project_cancellation_job_leases(p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_max_attempts constant integer := 5;
  c_max_limit constant integer := 500;
  v_released integer := 0;
  v_failed integer := 0;
BEGIN
  IF COALESCE(p_limit, 0) < 1 OR p_limit > c_max_limit THEN
    RAISE EXCEPTION 'reap_project_cancellation_job_leases: invalid input'
      USING ERRCODE = '22023';
  END IF;

  WITH candidates AS (
    SELECT jobs.id
    FROM public.project_cancellation_jobs AS jobs
    WHERE (jobs.status = 'processing'
           AND jobs.lease_expires_at < pg_catalog.clock_timestamp())
       OR (jobs.status = 'pending' AND jobs.attempts >= c_max_attempts)
    ORDER BY COALESCE(jobs.lease_expires_at, jobs.last_attempted_at, jobs.created_at), jobs.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  reaped AS (
    UPDATE public.project_cancellation_jobs AS jobs
    SET status = CASE WHEN jobs.attempts >= c_max_attempts THEN 'failed' ELSE 'pending' END,
        lease_owner = NULL,
        lease_expires_at = NULL,
        processing_started_at = NULL,
        last_error = CASE
          WHEN jobs.attempts >= c_max_attempts THEN 'attempts_exhausted'
          ELSE jobs.last_error
        END,
        updated_at = pg_catalog.clock_timestamp()
    FROM candidates
    WHERE jobs.id = candidates.id
    RETURNING jobs.status
  )
  SELECT count(*) FILTER (WHERE status = 'pending')::integer,
         count(*) FILTER (WHERE status = 'failed')::integer
  INTO v_released, v_failed
  FROM reaped;

  RETURN pg_catalog.jsonb_build_object('released', v_released, 'failed', v_failed);
END;
$$;

CREATE FUNCTION public.finalize_project_cancellation_job(
  p_job_id uuid,
  p_worker_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.project_cancellation_jobs%ROWTYPE;
  v_total integer := 0;
  v_open integer := 0;
  v_unknown integer := 0;
  v_failed integer := 0;
  v_status text;
  v_error text;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_job_id IS NULL OR NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'finalize_project_cancellation_job: invalid input'
      USING ERRCODE = '22023';
  END IF;

  SELECT jobs.* INTO v_job
  FROM public.project_cancellation_jobs AS jobs
  WHERE jobs.id = p_job_id
    AND jobs.status = 'processing'
    AND jobs.lease_owner = p_worker_id
    AND jobs.lease_expires_at > v_now
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('finalized', false, 'reason', 'lease_lost');
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE deliveries.work_state = 'leased'
         OR deliveries.email_state IN ('queued', 'sending')
         OR deliveries.notification_state = 'queued'
    )::integer,
    count(*) FILTER (WHERE deliveries.email_state = 'unknown_outcome')::integer,
    count(*) FILTER (
      WHERE deliveries.email_state = 'failed'
         OR deliveries.notification_state = 'failed'
    )::integer
  INTO v_total, v_open, v_unknown, v_failed
  FROM public.project_cancellation_deliveries AS deliveries
  WHERE deliveries.job_id = p_job_id;

  IF v_job.audience_snapshot_at IS NULL THEN
    v_status := 'needs_review';
    v_error := 'audience_snapshot_missing';
  ELSIF v_job.recipient_count IS DISTINCT FROM v_total THEN
    v_status := 'needs_review';
    v_error := 'audience_count_mismatch';
  ELSIF v_open > 0 AND v_job.attempts >= 5 THEN
    v_status := 'failed';
    v_error := 'attempts_exhausted';
  ELSIF v_open > 0 THEN
    v_status := 'pending';
    v_error := NULL;
  ELSIF v_unknown > 0 THEN
    v_status := 'needs_review';
    v_error := 'ambiguous_provider_outcome';
  ELSIF v_failed > 0 THEN
    v_status := 'needs_review';
    v_error := 'owed_channel_failed';
  ELSE
    v_status := 'completed';
    v_error := NULL;
  END IF;

  UPDATE public.project_cancellation_jobs AS jobs
  SET status = v_status,
      lease_owner = NULL,
      lease_expires_at = NULL,
      processing_started_at = NULL,
      completed_at = CASE
        WHEN v_status IN ('completed', 'needs_review', 'failed') THEN v_now
        ELSE NULL
      END,
      last_error = v_error,
      updated_at = v_now
  WHERE jobs.id = p_job_id;

  RETURN pg_catalog.jsonb_build_object(
    'finalized', true,
    'status', v_status,
    'open', v_open,
    'unknown', v_unknown,
    'failed', v_failed
  );
END;
$$;

CREATE FUNCTION public.redact_project_cancellation_destinations(p_limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_max_limit constant integer := 500;
  v_redacted integer := 0;
BEGIN
  IF COALESCE(p_limit, 0) < 1 OR p_limit > c_max_limit THEN
    RAISE EXCEPTION 'redact_project_cancellation_destinations: invalid input'
      USING ERRCODE = '22023';
  END IF;

  WITH candidates AS (
    SELECT deliveries.id
    FROM public.project_cancellation_deliveries AS deliveries
    WHERE deliveries.recipient_email IS NOT NULL
      AND deliveries.redacted_at IS NULL
      AND deliveries.redact_after <= pg_catalog.clock_timestamp()
      AND deliveries.work_state = 'idle'
      AND deliveries.email_state NOT IN ('queued', 'sending')
      AND deliveries.notification_state <> 'queued'
    ORDER BY deliveries.redact_after, deliveries.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.project_cancellation_deliveries AS deliveries
  SET recipient_email = NULL,
      redacted_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  FROM candidates
  WHERE deliveries.id = candidates.id;

  GET DIAGNOSTICS v_redacted = ROW_COUNT;
  RETURN v_redacted;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. RPC-only mutation posture and explicit grants
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE public.project_cancellation_jobs
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.project_cancellation_jobs TO service_role;

REVOKE ALL ON TABLE public.project_cancellation_deliveries
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.project_cancellation_deliveries TO service_role;

REVOKE ALL ON FUNCTION public.claim_project_cancellation_jobs(text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_project_cancellation_jobs(text, integer, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.claim_project_cancellation_deliveries(uuid, text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_project_cancellation_deliveries(uuid, text, integer, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.mark_project_cancellation_email_sending(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_project_cancellation_email_sending(uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.settle_project_cancellation_delivery(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_project_cancellation_delivery(uuid, text, text, text, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.release_project_cancellation_delivery(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_project_cancellation_delivery(uuid, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.reap_project_cancellation_delivery_leases(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reap_project_cancellation_delivery_leases(integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.reap_project_cancellation_job_leases(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reap_project_cancellation_job_leases(integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.finalize_project_cancellation_job(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_project_cancellation_job(uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.redact_project_cancellation_destinations(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.redact_project_cancellation_destinations(integer)
  TO service_role;

COMMENT ON FUNCTION public.reap_project_cancellation_delivery_leases(integer) IS
  'Bounded deterministic delivery reaper. Pre-send leases return to idle; only a lease whose email entered sending becomes terminal unknown_outcome.';
COMMENT ON FUNCTION public.reap_project_cancellation_job_leases(integer) IS
  'Bounded deterministic job reaper using an ordered candidate CTE and FOR UPDATE SKIP LOCKED.';
COMMENT ON FUNCTION public.finalize_project_cancellation_job(uuid, text) IS
  'Completes only exact snapshotted counts whose owed email and notification channels hold successful terminal truth.';
