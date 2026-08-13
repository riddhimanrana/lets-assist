-- Reconcile the project-lifecycle hostile-review findings after the integrated
-- Development ledger and the atomic signup-rejection boundary. This migration
-- deliberately does not replace app_private.is_project_organizer or
-- app_private.can_manage_project: 20260812101100 owns their stronger active-
-- membership and Storage-aware definitions.

BEGIN;

-- Every shared organization helper must require an explicitly active
-- membership. These helpers feed organization-member RLS as well as plugin
-- policies, so a deactivated actor must not use their own row to reactivate
-- tenant authority or cross into another organization.
CREATE OR REPLACE FUNCTION private.get_user_org_role(p_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT members.role
  FROM public.organization_members AS members
  WHERE members.organization_id = p_org_id
    AND members.user_id = auth.uid()
    AND members.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members AS members
    WHERE members.organization_id = p_org_id
      AND members.user_id = auth.uid()
      AND members.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION private.is_org_staff_or_admin(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members AS members
    WHERE members.organization_id = p_org_id
      AND members.user_id = auth.uid()
      AND members.status = 'active'
      AND members.role IN ('admin', 'staff')
  );
$$;

CREATE OR REPLACE FUNCTION private.is_org_admin(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members AS members
    WHERE members.organization_id = p_org_id
      AND members.user_id = auth.uid()
      AND members.status = 'active'
      AND members.role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION private.get_user_org_role(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.is_org_member(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.is_org_staff_or_admin(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.is_org_admin(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.get_user_org_role(uuid),
  private.is_org_member(uuid),
  private.is_org_staff_or_admin(uuid),
  private.is_org_admin(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION private.get_user_org_role(uuid) IS
  'Returns the current user role only for an explicitly active membership in the exact organization.';
COMMENT ON FUNCTION private.is_org_member(uuid) IS
  'Returns true only for an explicitly active current-user membership in the exact organization.';
COMMENT ON FUNCTION private.is_org_staff_or_admin(uuid) IS
  'Returns true only for explicitly active staff or admin membership in the exact organization.';
COMMENT ON FUNCTION private.is_org_admin(uuid) IS
  'Returns true only for explicitly active admin membership in the exact organization.';

-- Ordinary authenticated project edits remain RLS-authorized, but cancellation
-- owns a frozen audience/outbox transaction and cancelled projects have no
-- browser-direct revival path. SECURITY DEFINER cancellation runs as postgres,
-- so the reviewed transaction remains permitted.
CREATE OR REPLACE FUNCTION private.protect_project_ownership_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    IF NEW.creator_id IS DISTINCT FROM OLD.creator_id
      OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    THEN
      RAISE EXCEPTION 'project ownership and organization association are immutable'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.status = 'cancelled'
      AND NEW.status IS DISTINCT FROM OLD.status
    THEN
      RAISE EXCEPTION 'project cancellation requires cancel_project_transactional'
        USING ERRCODE = '42501';
    END IF;

    IF OLD.status = 'cancelled'
      AND NEW.status IS DISTINCT FROM OLD.status
    THEN
      RAISE EXCEPTION 'cancelled projects cannot be reopened directly'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_project_ownership_columns()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.protect_project_ownership_columns()
  TO postgres;

COMMENT ON FUNCTION private.protect_project_ownership_columns() IS
  'Protects project ownership and prevents browser-direct cancellation or revival while permitting reviewed privileged transactions.';

-- This is the full union of the approval, attendance, and rejection browser
-- guards. Consequential status transitions use their reviewed server/RPC paths;
-- only a participant's own pending/approved cancellation remains client-direct.
CREATE OR REPLACE FUNCTION private.protect_project_signup_client_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_is_manager boolean := false;
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  v_is_manager := COALESCE(
    public.is_project_organizer(OLD.project_id, v_actor_id),
    false
  ) OR COALESCE(public.is_super_admin(), false);

  IF NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.schedule_id IS DISTINCT FROM OLD.schedule_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.anonymous_id IS DISTINCT FROM OLD.anonymous_id
  THEN
    RAISE EXCEPTION 'project signup identity fields are immutable for client roles'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.check_in_time IS DISTINCT FROM OLD.check_in_time
    OR NEW.check_out_time IS DISTINCT FROM OLD.check_out_time
  THEN
    RAISE EXCEPTION 'attendance timestamps require a server-authorized operation'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.volunteer_comment IS DISTINCT FROM OLD.volunteer_comment
    OR NEW.response_data IS DISTINCT FROM OLD.response_data
  THEN
    RAISE EXCEPTION 'client signup updates are limited to status and calendar metadata'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'approved' THEN
      RAISE EXCEPTION 'signup approval requires a capacity-safe transactional RPC'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.status = 'attended' THEN
      RAISE EXCEPTION 'attendance requires a server-authorized operation'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.status = 'rejected' THEN
      RAISE EXCEPTION 'signup rejection requires the server-authorized operation'
        USING ERRCODE = '42501';
    END IF;

    IF NOT v_is_manager
      AND NOT (
        OLD.user_id IS NOT DISTINCT FROM v_actor_id
        AND OLD.status IN ('pending', 'approved')
        AND NEW.status = 'cancelled'
      )
    THEN
      RAISE EXCEPTION 'participants may only cancel their own signup'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NOT v_is_manager
    AND OLD.user_id IS DISTINCT FROM v_actor_id
  THEN
    RAISE EXCEPTION 'signup update access denied'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_project_signup_client_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.protect_project_signup_client_mutation()
  TO service_role;

COMMENT ON FUNCTION private.protect_project_signup_client_mutation() IS
  'Restricts browser signup edits and routes approval, attendance, and rejection through reviewed transactional or server-authorized paths.';

-- Approval and first attendance both change the audience truth observed by
-- cancellation. They therefore share the project-row lock and fail closed after
-- the project becomes inactive or cancelled.
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
  v_attending boolean :=
    TG_OP = 'UPDATE'
    AND NEW.status = 'attended'
    AND OLD.status IS DISTINCT FROM 'attended';
BEGIN
  IF NEW.project_id IS NULL THEN
    NEW.organization_id := NULL;
    RETURN NEW;
  END IF;

  IF v_approving OR v_attending THEN
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

  IF v_approving
    AND (
      v_project_status IS NULL
      OR v_project_status NOT IN ('upcoming', 'in-progress')
    )
  THEN
    RAISE EXCEPTION 'signups can only be approved for active projects'
      USING ERRCODE = '55000';
  END IF;

  IF v_attending
    AND (
      v_project_status IS NULL
      OR v_project_status IN ('inactive', 'cancelled')
    )
  THEN
    RAISE EXCEPTION 'attendance requires an active project'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.enforce_project_signup_cancellation_boundary()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.enforce_project_signup_cancellation_boundary()
  TO postgres;

COMMENT ON FUNCTION app_private.enforce_project_signup_cancellation_boundary() IS
  'Serializes signup approval and attendance with project cancellation and rejects inactive or cancelled attendance.';

-- A stale recurrence generator must lock and recheck the exact parent before it
-- can materialize a child. Series ending holds the same parent lock while it
-- cancels every upcoming occurrence and then clears the recurrence rule.
CREATE OR REPLACE FUNCTION private.enforce_active_recurrence_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rule jsonb;
  v_status text;
BEGIN
  IF NEW.recurrence_parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT parents.recurrence_rule, parents.status
  INTO v_rule, v_status
  FROM public.projects AS parents
  WHERE parents.id = NEW.recurrence_parent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'recurrence parent not found' USING ERRCODE = '23503';
  END IF;

  IF v_rule IS NULL OR v_status IN ('inactive', 'cancelled') THEN
    RAISE EXCEPTION 'recurrence parent is no longer active'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_active_recurrence_parent()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.enforce_active_recurrence_parent()
  TO postgres;

DROP TRIGGER IF EXISTS projects_active_recurrence_parent_guard
  ON public.projects;
CREATE TRIGGER projects_active_recurrence_parent_guard
BEFORE INSERT OR UPDATE OF recurrence_parent_id ON public.projects
FOR EACH ROW
WHEN (NEW.recurrence_parent_id IS NOT NULL)
EXECUTE FUNCTION private.enforce_active_recurrence_parent();

CREATE OR REPLACE FUNCTION private.end_recurring_project_series_transactional()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_child record;
  v_receipt jsonb;
BEGIN
  IF OLD.recurrence_rule IS NULL
    OR NEW.recurrence_rule IS NOT NULL
    OR NEW.recurrence_parent_id IS NOT NULL
  THEN
    RETURN NEW;
  END IF;

  FOR v_child IN
    SELECT children.id
    FROM public.projects AS children
    WHERE children.recurrence_parent_id = OLD.id
      AND children.status = 'upcoming'
    ORDER BY children.id
    FOR UPDATE
  LOOP
    v_receipt := private.cancel_project_transactional(
      v_child.id,
      'Recurring series ended by organizer'
    );

    IF COALESCE(v_receipt->>'outcome', '') NOT IN ('cancelled', 'already_cancelled') THEN
      RAISE EXCEPTION 'recurring occurrence cancellation was not accepted'
        USING ERRCODE = '40001';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.end_recurring_project_series_transactional()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.end_recurring_project_series_transactional() IS
  'Ungranted fixed-path trigger helper that atomically cancels upcoming children while the invoker-authorized parent update holds the recurrence serialization lock.';

DROP TRIGGER IF EXISTS projects_end_recurring_series_transactional
  ON public.projects;
CREATE TRIGGER projects_end_recurring_series_transactional
BEFORE UPDATE OF recurrence_rule ON public.projects
FOR EACH ROW
WHEN (
  OLD.recurrence_rule IS NOT NULL
  AND NEW.recurrence_rule IS NULL
  AND NEW.recurrence_parent_id IS NULL
)
EXECUTE FUNCTION private.end_recurring_project_series_transactional();

CREATE OR REPLACE FUNCTION public.end_recurring_project_series_transactional(
  p_project_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_parent public.projects%ROWTYPE;
  v_cancelled_ids jsonb := '[]'::jsonb;
  v_cancelled_count integer := 0;
BEGIN
  IF v_actor_id IS NULL OR p_project_id IS NULL THEN
    RAISE EXCEPTION 'end_recurring_project_series_transactional: invalid input'
      USING ERRCODE = '22023';
  END IF;

  SELECT parents.* INTO v_parent
  FROM public.projects AS parents
  WHERE parents.id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_parent.recurrence_parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'only a recurrence parent can end a series'
      USING ERRCODE = '22023';
  END IF;

  IF v_parent.creator_id IS DISTINCT FROM v_actor_id THEN
    PERFORM members.user_id
    FROM public.organization_members AS members
    WHERE members.organization_id = v_parent.organization_id
      AND members.user_id = v_actor_id
      AND members.status = 'active'
      AND (
        members.role = 'admin'
        OR (
          members.role = 'staff'
          AND v_parent.can_be_managed_by_staff IS TRUE
        )
      )
    FOR SHARE OF members;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'recurring project permission denied'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_parent.recurrence_rule IS NULL THEN
    SELECT COALESCE(jsonb_agg(children.id ORDER BY children.id), '[]'::jsonb)
    INTO v_cancelled_ids
    FROM public.projects AS children
    WHERE children.recurrence_parent_id = p_project_id
      AND children.status = 'cancelled';

    RETURN jsonb_build_object(
      'outcome', 'replayed',
      'endedRecurringSeries', true,
      'cancelledOccurrences', 0,
      'calendarCleanupProjectIds', v_cancelled_ids
    );
  END IF;

  SELECT
    COALESCE(jsonb_agg(children.id ORDER BY children.id), '[]'::jsonb),
    count(*)::integer
  INTO v_cancelled_ids, v_cancelled_count
  FROM public.projects AS children
  WHERE children.recurrence_parent_id = p_project_id
    AND children.status = 'upcoming';

  UPDATE public.projects AS parents
  SET recurrence_rule = NULL
  WHERE parents.id = p_project_id
    AND parents.recurrence_rule IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'recurrence parent transition lost'
      USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'ended',
    'endedRecurringSeries', true,
    'cancelledOccurrences', v_cancelled_count,
    'calendarCleanupProjectIds', v_cancelled_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.end_recurring_project_series_transactional(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.end_recurring_project_series_transactional(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.end_recurring_project_series_transactional(uuid) IS
  'Authenticated SECURITY INVOKER transaction that locks and authorizes the recurrence parent before its ungranted private trigger atomically cancels upcoming children.';

-- A job claim is a provisional lease attempt. Reaching the owned, unexpired
-- finalizer proves a healthy bounded pass, including a paginated pass that
-- returns open work to pending. Only abandoned leases retain an attempt.
REVOKE ALL ON FUNCTION public.finalize_project_cancellation_job(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

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
      attempts = GREATEST(v_job.attempts - 1, 0),
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

REVOKE ALL ON FUNCTION public.finalize_project_cancellation_job(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_project_cancellation_job(uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.finalize_project_cancellation_job(uuid, text) IS
  'Finalizes an owned cancellation-job lease and refunds its provisional attempt so only abandoned leases consume the bounded failure budget.';

COMMIT;
