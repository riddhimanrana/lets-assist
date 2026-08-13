-- Close the remaining project lifecycle authorization and transaction gaps.
-- Consequential status transitions derive and lock the actor's authority,
-- membership-backed operations require an explicitly active row, and ending a
-- recurring series applies the ordinary edit and child cancellations together.

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN recurrence_generation_id uuid;

UPDATE public.projects
SET recurrence_generation_id = extensions.uuid_generate_v4()
WHERE recurrence_rule IS NOT NULL;

CREATE FUNCTION private.assign_project_recurrence_generation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.recurrence_generation_id := CASE
      WHEN NEW.recurrence_rule IS NOT NULL
        THEN extensions.uuid_generate_v4()
      ELSE NULL
    END;
  ELSIF NEW.recurrence_rule IS DISTINCT FROM OLD.recurrence_rule THEN
    NEW.recurrence_generation_id := CASE
      WHEN NEW.recurrence_rule IS NOT NULL
        THEN extensions.uuid_generate_v4()
      ELSE OLD.recurrence_generation_id
    END;
  ELSE
    NEW.recurrence_generation_id := OLD.recurrence_generation_id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.assign_project_recurrence_generation()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.assign_project_recurrence_generation()
  TO postgres;

CREATE TRIGGER projects_assign_recurrence_generation
BEFORE INSERT OR UPDATE OF recurrence_rule, recurrence_generation_id
ON public.projects
FOR EACH ROW
EXECUTE FUNCTION private.assign_project_recurrence_generation();

CREATE TABLE private.project_series_end_receipts (
  project_id uuid NOT NULL
    REFERENCES public.projects(id) ON DELETE CASCADE,
  recurrence_generation_id uuid NOT NULL,
  update_fingerprint text NOT NULL
    CHECK (update_fingerprint ~ '^[0-9a-f]{64}$'),
  calendar_cleanup_project_ids jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (
      pg_catalog.jsonb_typeof(calendar_cleanup_project_ids) = 'array'
    ),
  cancelled_occurrences integer NOT NULL
    CHECK (cancelled_occurrences >= 0),
  ended_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  PRIMARY KEY (project_id, recurrence_generation_id)
);

REVOKE ALL ON TABLE private.project_series_end_receipts
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE
  ON TABLE private.project_series_end_receipts
  TO postgres;

COMMENT ON TABLE private.project_series_end_receipts IS
  'Immutable generation-and-edit-bound replay marker for atomic recurring-series endings, including series that had no eligible child occurrences.';
COMMENT ON COLUMN private.project_series_end_receipts.update_fingerprint IS
  'SHA-256 digest of the canonical ordinary parent edit bound to this recurrence generation.';

CREATE FUNCTION private.reject_project_series_end_receipt_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'project series end receipts are immutable'
    USING ERRCODE = '55000';
END;
$$;

REVOKE ALL ON FUNCTION private.reject_project_series_end_receipt_update()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.reject_project_series_end_receipt_update()
  TO postgres;

CREATE TRIGGER project_series_end_receipts_reject_update
BEFORE UPDATE ON private.project_series_end_receipts
FOR EACH ROW
EXECUTE FUNCTION private.reject_project_series_end_receipt_update();

-- Keep the mature cancellation implementation intact behind an exact-active
-- authorization wrapper. The wrapper and delegated transaction hold the same
-- project lock, so membership deactivation cannot race the consequential write.
ALTER FUNCTION private.cancel_project_transactional(uuid, text)
  RENAME TO cancel_project_transactional_legacy_status_fallback;

REVOKE ALL ON FUNCTION
  private.cancel_project_transactional_legacy_status_fallback(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  private.cancel_project_transactional_legacy_status_fallback(uuid, text)
  TO postgres;

COMMENT ON FUNCTION
  private.cancel_project_transactional_legacy_status_fallback(uuid, text) IS
  'Delegated cancellation implementation retained behind the exact-active authorization wrapper; executable only by its postgres-owned wrapper.';

CREATE OR REPLACE FUNCTION private.cancel_project_transactional(
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
BEGIN
  IF v_actor_id IS NULL
    OR p_project_id IS NULL
    OR NULLIF(pg_catalog.btrim(COALESCE(p_cancellation_reason, '')), '') IS NULL
    OR pg_catalog.char_length(pg_catalog.btrim(p_cancellation_reason)) > 2000
  THEN
    RAISE EXCEPTION 'cancel_project_transactional: invalid input'
      USING ERRCODE = '22023';
  END IF;

  SELECT projects.*
  INTO v_project
  FROM public.projects AS projects
  WHERE projects.id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_project.creator_id IS DISTINCT FROM v_actor_id THEN
    PERFORM members.user_id
    FROM public.organization_members AS members
    WHERE members.organization_id = v_project.organization_id
      AND members.user_id = v_actor_id
      AND members.status = 'active'
      AND (
        members.role = 'admin'
        OR (
          members.role = 'staff'
          AND v_project.can_be_managed_by_staff IS TRUE
        )
      )
    FOR SHARE OF members;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'project cancellation permission denied'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN private.cancel_project_transactional_legacy_status_fallback(
    p_project_id,
    p_cancellation_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION private.cancel_project_transactional(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.cancel_project_transactional(uuid, text)
  TO authenticated;

COMMENT ON FUNCTION private.cancel_project_transactional(uuid, text) IS
  'Private cancellation transaction that derives the actor and locks exact active management authority before delegating the frozen audience and outbox write.';

-- Preserve the canonical advisory -> project -> signup lock order while
-- replacing null-tolerant membership authorization for signup unrejection.
ALTER FUNCTION private.unreject_project_signup_with_capacity(uuid)
  RENAME TO unreject_project_signup_with_capacity_legacy_status_fallback;

REVOKE ALL ON FUNCTION
  private.unreject_project_signup_with_capacity_legacy_status_fallback(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  private.unreject_project_signup_with_capacity_legacy_status_fallback(uuid)
  TO postgres;

COMMENT ON FUNCTION
  private.unreject_project_signup_with_capacity_legacy_status_fallback(uuid) IS
  'Delegated capacity-safe unrejection implementation retained behind the exact-active authorization wrapper; executable only by its postgres-owned wrapper.';

CREATE OR REPLACE FUNCTION private.unreject_project_signup_with_capacity(
  p_signup_id uuid
)
RETURNS TABLE (
  outcome text,
  project_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_signup_snapshot record;
  v_signup record;
  v_project record;
BEGIN
  outcome := 'refused';
  project_id := NULL;

  IF p_signup_id IS NULL OR v_actor_id IS NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT
    signups.project_id,
    signups.schedule_id
  INTO v_signup_snapshot
  FROM public.project_signups AS signups
  WHERE signups.id = p_signup_id;

  IF NOT FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;

  IF NULLIF(pg_catalog.btrim(v_signup_snapshot.schedule_id), '') IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'lets-assist-project-signup:'
          || v_signup_snapshot.project_id::text
          || ':'
          || v_signup_snapshot.schedule_id,
        0
      )
    );
  END IF;

  SELECT
    projects.creator_id,
    projects.organization_id,
    projects.can_be_managed_by_staff
  INTO v_project
  FROM public.projects AS projects
  WHERE projects.id = v_signup_snapshot.project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT
    signups.project_id,
    signups.schedule_id
  INTO v_signup
  FROM public.project_signups AS signups
  WHERE signups.id = p_signup_id
    AND signups.project_id = v_signup_snapshot.project_id
    AND signups.schedule_id IS NOT DISTINCT FROM v_signup_snapshot.schedule_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_project.creator_id IS DISTINCT FROM v_actor_id THEN
    PERFORM members.user_id
    FROM public.organization_members AS members
    WHERE members.organization_id = v_project.organization_id
      AND members.user_id = v_actor_id
      AND members.status = 'active'
      AND (
        members.role = 'admin'
        OR (
          members.role = 'staff'
          AND v_project.can_be_managed_by_staff IS TRUE
        )
      )
    FOR SHARE OF members;

    IF NOT FOUND THEN
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  SELECT delegated.outcome, delegated.project_id
  FROM private.unreject_project_signup_with_capacity_legacy_status_fallback(
    p_signup_id
  ) AS delegated;
END;
$$;

REVOKE ALL ON FUNCTION private.unreject_project_signup_with_capacity(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.unreject_project_signup_with_capacity(uuid)
  TO authenticated;

COMMENT ON FUNCTION private.unreject_project_signup_with_capacity(uuid) IS
  'Private capacity-safe unrejection transaction that preserves canonical lock order and requires an exact active management membership before delegation.';

-- The service-only publication transaction also used a null-tolerant status
-- fallback. Lock exact active authority before entering the mature replay-safe
-- receipt, certificate, notification, and email-outbox implementation.
ALTER FUNCTION
  private.publish_volunteer_hours_transactional(uuid, uuid, text, jsonb, text)
  RENAME TO publish_volunteer_hours_transactional_legacy_status_fallback;

REVOKE ALL ON FUNCTION
  private.publish_volunteer_hours_transactional_legacy_status_fallback(
    uuid, uuid, text, jsonb, text
  )
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  private.publish_volunteer_hours_transactional_legacy_status_fallback(
    uuid, uuid, text, jsonb, text
  )
  TO postgres;

COMMENT ON FUNCTION
  private.publish_volunteer_hours_transactional_legacy_status_fallback(
    uuid, uuid, text, jsonb, text
  ) IS
  'Delegated replay-safe publication implementation retained behind the exact-active authorization wrapper; executable only by its postgres-owned wrapper.';

CREATE OR REPLACE FUNCTION private.publish_volunteer_hours_transactional(
  p_actor_id uuid,
  p_project_id uuid,
  p_schedule_id text,
  p_entries jsonb,
  p_request_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := p_actor_id;
  v_project public.projects%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'authentication required';
  END IF;

  SELECT projects.*
  INTO v_project
  FROM public.projects AS projects
  WHERE projects.id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'project not found';
  END IF;

  IF v_project.creator_id IS DISTINCT FROM v_actor_id THEN
    PERFORM members.user_id
    FROM public.organization_members AS members
    WHERE members.organization_id = v_project.organization_id
      AND members.user_id = v_actor_id
      AND members.status = 'active'
      AND (
        members.role = 'admin'
        OR (
          members.role = 'staff'
          AND v_project.can_be_managed_by_staff IS TRUE
        )
      )
    FOR UPDATE OF members;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'not authorized to publish project hours';
    END IF;
  END IF;

  RETURN private.publish_volunteer_hours_transactional_legacy_status_fallback(
    v_actor_id,
    p_project_id,
    p_schedule_id,
    p_entries,
    p_request_key
  );
END;
$$;

REVOKE ALL ON FUNCTION
  private.publish_volunteer_hours_transactional(uuid, uuid, text, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  private.publish_volunteer_hours_transactional(uuid, uuid, text, jsonb, text)
  TO service_role;

COMMENT ON FUNCTION
  private.publish_volunteer_hours_transactional(uuid, uuid, text, jsonb, text) IS
  'Private replay-safe hours publication transaction that locks exact active management authority before delegating receipt and certificate creation.';

-- All browser-direct project status changes and recurrence endings are denied.
-- The private functions below derive auth.uid(), lock the project and
-- membership, validate the transition, and perform the write as the privileged
-- owner.
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

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'project status transitions require a reviewed lifecycle RPC'
        USING ERRCODE = '42501';
    END IF;

    IF OLD.recurrence_rule IS NOT NULL
      AND NEW.recurrence_rule IS NULL
    THEN
      RAISE EXCEPTION 'ending project recurrence requires a generation-bound lifecycle RPC'
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
  'Protects project ownership and denies browser-direct project status transitions or recurrence endings; reviewed privileged transactions own consequential lifecycle writes.';

CREATE OR REPLACE FUNCTION private.transition_project_status_transactional(
  p_project_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_project public.projects%ROWTYPE;
  v_previous_status text;
BEGIN
  IF v_actor_id IS NULL
    OR p_project_id IS NULL
    OR p_status IS NULL
    OR p_status NOT IN ('in-progress', 'completed')
  THEN
    RAISE EXCEPTION 'transition_project_status_transactional: invalid input'
      USING ERRCODE = '22023';
  END IF;

  SELECT projects.*
  INTO v_project
  FROM public.projects AS projects
  WHERE projects.id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_project.creator_id IS DISTINCT FROM v_actor_id THEN
    PERFORM members.user_id
    FROM public.organization_members AS members
    WHERE members.organization_id = v_project.organization_id
      AND members.user_id = v_actor_id
      AND members.status = 'active'
      AND (
        members.role = 'admin'
        OR (
          members.role = 'staff'
          AND v_project.can_be_managed_by_staff IS TRUE
        )
      )
    FOR SHARE OF members;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'project status transition permission denied'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_previous_status := v_project.status;

  IF v_previous_status = p_status THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'replayed',
      'projectId', p_project_id,
      'previousStatus', v_previous_status,
      'status', p_status
    );
  END IF;

  IF (
    (v_previous_status = 'upcoming' AND p_status IN ('in-progress', 'completed'))
    OR (v_previous_status = 'in-progress' AND p_status = 'completed')
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'project status transition is not allowed'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.projects AS projects
  SET status = p_status
  WHERE projects.id = p_project_id
    AND projects.status IS NOT DISTINCT FROM v_previous_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project status transition lost'
      USING ERRCODE = '40001';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'transitioned',
    'projectId', p_project_id,
    'previousStatus', v_previous_status,
    'status', p_status
  );
END;
$$;

REVOKE ALL ON FUNCTION
  private.transition_project_status_transactional(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  private.transition_project_status_transactional(uuid, text)
  TO authenticated;

COMMENT ON FUNCTION
  private.transition_project_status_transactional(uuid, text) IS
  'Private actor-derived project status transition that locks project and exact active management authority before enforcing the reviewed transition graph.';

CREATE OR REPLACE FUNCTION public.transition_project_status_transactional(
  p_project_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.transition_project_status_transactional(
    p_project_id,
    p_status
  );
$$;

REVOKE ALL ON FUNCTION
  public.transition_project_status_transactional(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.transition_project_status_transactional(uuid, text)
  TO authenticated;

COMMENT ON FUNCTION
  public.transition_project_status_transactional(uuid, text) IS
  'Authenticated SECURITY INVOKER wrapper for the locked actor-derived project status transition.';

-- Reapply the union of approval, attendance, and PR #152 rejection hardening.
-- Whichever branch lands first, this ledger tail preserves all three guards.
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
  'Combined client signup guard preserving transactional approval, attendance, and rejection boundaries while allowing only participant self-cancellation.';

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

REVOKE ALL ON FUNCTION
  app_private.enforce_project_signup_cancellation_boundary()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  app_private.enforce_project_signup_cancellation_boundary()
  TO postgres;

COMMENT ON FUNCTION
  app_private.enforce_project_signup_cancellation_boundary() IS
  'Serializes signup approval and attendance with cancellation while preserving the transactional signup rejection boundary.';

-- Apply a strictly allowlisted ordinary edit and end the recurrence in one
-- transaction. Child rows are locked before eligibility and cleanup IDs are
-- decided; every actual cancellation still delegates to the canonical ledger.
CREATE OR REPLACE FUNCTION private.end_recurring_project_series_transactional(
  p_project_id uuid,
  p_updates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_parent public.projects%ROWTYPE;
  v_edited public.projects%ROWTYPE;
  v_child_id uuid;
  v_receipt jsonb;
  v_cleanup_ids jsonb := '[]'::jsonb;
  v_cancelled_count integer := 0;
  v_unknown_fields text[];
  v_outcome text;
  v_ended_recurring_series boolean := true;
  v_prior_receipt private.project_series_end_receipts%ROWTYPE;
  v_generation_id uuid;
  v_generation_supplied boolean := false;
  v_expect_ordinary boolean := false;
  v_compatibility_current boolean := false;
  v_update_fingerprint text;
BEGIN
  IF v_actor_id IS NULL
    OR p_project_id IS NULL
    OR pg_catalog.jsonb_typeof(p_updates) IS DISTINCT FROM 'object'
  THEN
    RAISE EXCEPTION 'end_recurring_project_series_transactional: invalid input'
      USING ERRCODE = '22023';
  END IF;

  IF NOT p_updates ? 'recurrence_rule'
    OR p_updates->'recurrence_rule' IS DISTINCT FROM 'null'::jsonb
  THEN
    RAISE EXCEPTION 'series edit must explicitly clear recurrence_rule'
      USING ERRCODE = '22023';
  END IF;

  IF p_updates ? 'series_end_generation' THEN
    IF pg_catalog.jsonb_typeof(p_updates->'series_end_generation')
      IS DISTINCT FROM 'string'
    THEN
      RAISE EXCEPTION 'series end generation must be a UUID string'
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_generation_id := (p_updates->>'series_end_generation')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'series end generation must be a UUID string'
          USING ERRCODE = '22023';
    END;
    v_generation_supplied := true;
  END IF;

  v_expect_ordinary :=
    p_updates->'series_end_expect_ordinary' IS NOT DISTINCT FROM 'true'::jsonb;
  v_compatibility_current :=
    p_updates->'series_end_compatibility_current'
      IS NOT DISTINCT FROM 'true'::jsonb;

  IF (
    v_generation_supplied::integer
    + v_expect_ordinary::integer
    + v_compatibility_current::integer
  ) <> 1
  THEN
    RAISE EXCEPTION 'series edit requires exactly one generation mode'
      USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.array_agg(fields.key ORDER BY fields.key)
  INTO v_unknown_fields
  FROM pg_catalog.jsonb_object_keys(p_updates) AS fields(key)
  WHERE NOT (
    fields.key = ANY (ARRAY[
      'title',
      'description',
      'location',
      'location_data',
      'verification_method',
      'schedule',
      'require_login',
      'cover_image_url',
      'documents',
      'pause_signups',
      'project_timezone',
      'restrict_to_org_domains',
      'visibility',
      'can_be_managed_by_staff',
      'enable_volunteer_comments',
      'show_attendees_publicly',
      'waiver_required',
      'waiver_allow_upload',
      'waiver_disable_esignature',
      'signup_form_schema',
      'recurrence_rule',
      'series_end_generation',
      'series_end_expect_ordinary',
      'series_end_compatibility_current'
    ]::text[])
  );

  IF v_unknown_fields IS NOT NULL THEN
    RAISE EXCEPTION 'series edit contains unsupported fields: %',
      pg_catalog.array_to_string(v_unknown_fields, ',')
      USING ERRCODE = '22023';
  END IF;

  v_update_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        (
          p_updates
            - 'series_end_generation'
            - 'series_end_expect_ordinary'
            - 'series_end_compatibility_current'
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  SELECT parents.*
  INTO v_parent
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

  IF v_compatibility_current THEN
    IF v_parent.recurrence_rule IS NOT NULL THEN
      RAISE EXCEPTION 'series end generation required; refresh required'
        USING ERRCODE = '40001';
    END IF;

    v_generation_id := v_parent.recurrence_generation_id;
  ELSIF v_expect_ordinary AND v_parent.recurrence_rule IS NOT NULL THEN
    RAISE EXCEPTION 'project recurrence generation changed; refresh required'
      USING ERRCODE = '40001';
  ELSIF v_generation_supplied
    AND v_parent.recurrence_rule IS NOT NULL
    AND v_parent.recurrence_generation_id IS DISTINCT FROM v_generation_id
  THEN
    RAISE EXCEPTION 'project recurrence generation changed; refresh required'
      USING ERRCODE = '40001';
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

  IF v_parent.recurrence_rule IS NULL
    AND v_generation_id IS NOT NULL
    AND NOT v_expect_ordinary
  THEN
    SELECT receipts.*
    INTO v_prior_receipt
    FROM private.project_series_end_receipts AS receipts
    WHERE receipts.project_id = p_project_id
      AND receipts.recurrence_generation_id = v_generation_id
    FOR SHARE;

    IF FOUND THEN
      IF NOT v_compatibility_current
        AND v_prior_receipt.update_fingerprint
          IS DISTINCT FROM v_update_fingerprint
      THEN
        RAISE EXCEPTION 'project series end request does not match committed edit'
          USING ERRCODE = '40001';
      END IF;

      RETURN pg_catalog.jsonb_build_object(
        'outcome', 'replayed',
        'endedRecurringSeries', true,
        'cancelledOccurrences', 0,
        'calendarCleanupProjectIds',
          v_prior_receipt.calendar_cleanup_project_ids
      );
    END IF;

    IF v_generation_supplied THEN
      RAISE EXCEPTION 'project recurrence generation is stale'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  v_edited := pg_catalog.jsonb_populate_record(
    v_parent,
    p_updates
      - 'recurrence_rule'
      - 'series_end_generation'
      - 'series_end_expect_ordinary'
      - 'series_end_compatibility_current'
  );

  IF v_edited.title IS NULL THEN
    RAISE EXCEPTION 'series edit field title cannot be null'
      USING ERRCODE = '22023';
  END IF;
  IF v_edited.description IS NULL
    OR v_edited.location IS NULL
    OR v_edited.verification_method IS NULL
    OR v_edited.schedule IS NULL
    OR v_edited.require_login IS NULL
    OR v_edited.pause_signups IS NULL
    OR v_edited.enable_volunteer_comments IS NULL
    OR v_edited.show_attendees_publicly IS NULL
    OR v_edited.waiver_disable_esignature IS NULL
  THEN
    RAISE EXCEPTION 'series edit cannot clear required project fields'
      USING ERRCODE = '22023';
  END IF;

  IF v_edited.visibility = 'public'
    AND NOT app_private.can_keep_or_set_public_visibility(
      p_project_id,
      v_actor_id
    )
  THEN
    RAISE EXCEPTION 'trusted membership is required for public visibility'
      USING ERRCODE = '42501';
  END IF;

  IF v_parent.recurrence_rule IS NULL THEN
    IF v_expect_ordinary THEN
      v_cleanup_ids := '[]'::jsonb;
      v_outcome := 'unchanged';
      v_ended_recurring_series := false;
    ELSIF v_compatibility_current AND v_generation_id IS NULL THEN
      SELECT COALESCE(
        pg_catalog.jsonb_agg(children.id ORDER BY children.id),
        '[]'::jsonb
      )
      INTO v_cleanup_ids
      FROM public.projects AS children
      WHERE children.recurrence_parent_id = p_project_id
        AND children.status = 'cancelled';

      IF pg_catalog.jsonb_array_length(v_cleanup_ids) > 0 THEN
        RETURN pg_catalog.jsonb_build_object(
          'outcome', 'replayed',
          'endedRecurringSeries', true,
          'cancelledOccurrences', 0,
          'calendarCleanupProjectIds', v_cleanup_ids
        );
      ELSE
        RETURN pg_catalog.jsonb_build_object(
          'outcome', 'unchanged',
          'endedRecurringSeries', false,
          'cancelledOccurrences', 0,
          'calendarCleanupProjectIds', '[]'::jsonb
        );
      END IF;
    ELSE
      v_cleanup_ids := '[]'::jsonb;
      v_outcome := 'unchanged';
      v_ended_recurring_series := false;
    END IF;
  ELSE
    IF v_generation_id IS NULL
      OR v_parent.recurrence_generation_id IS DISTINCT FROM v_generation_id
    THEN
      RAISE EXCEPTION 'project recurrence generation changed; refresh required'
        USING ERRCODE = '40001';
    END IF;

    SELECT
      COALESCE(
        pg_catalog.jsonb_agg(locked_children.id ORDER BY locked_children.id),
        '[]'::jsonb
      ),
      pg_catalog.count(*)::integer
    INTO v_cleanup_ids, v_cancelled_count
    FROM (
      SELECT children.id
      FROM public.projects AS children
      WHERE children.recurrence_parent_id = p_project_id
        AND children.status = 'upcoming'
      ORDER BY children.id
      FOR UPDATE
    ) AS locked_children;

    FOR v_child_id IN
      SELECT child_id::uuid
      FROM pg_catalog.jsonb_array_elements_text(v_cleanup_ids)
        AS child_ids(child_id)
    LOOP
      v_receipt := private.cancel_project_transactional(
        v_child_id,
        'Recurring series ended by organizer'
      );

      IF v_receipt->>'outcome' IS DISTINCT FROM 'cancelled'
        OR v_receipt->>'accepted' IS DISTINCT FROM 'true'
      THEN
        RAISE EXCEPTION 'recurring occurrence cancellation was not accepted'
          USING ERRCODE = '40001';
      END IF;
    END LOOP;

    INSERT INTO private.project_series_end_receipts (
      project_id,
      recurrence_generation_id,
      update_fingerprint,
      calendar_cleanup_project_ids,
      cancelled_occurrences,
      ended_at
    )
    VALUES (
      p_project_id,
      v_generation_id,
      v_update_fingerprint,
      v_cleanup_ids,
      v_cancelled_count,
      pg_catalog.statement_timestamp()
    );

    v_outcome := 'ended';
  END IF;

  UPDATE public.projects AS parents
  SET
    title = v_edited.title,
    description = v_edited.description,
    location = v_edited.location,
    location_data = v_edited.location_data,
    verification_method = v_edited.verification_method,
    schedule = v_edited.schedule,
    require_login = v_edited.require_login,
    cover_image_url = v_edited.cover_image_url,
    documents = v_edited.documents,
    pause_signups = v_edited.pause_signups,
    project_timezone = v_edited.project_timezone,
    restrict_to_org_domains = v_edited.restrict_to_org_domains,
    visibility = v_edited.visibility,
    can_be_managed_by_staff = v_edited.can_be_managed_by_staff,
    enable_volunteer_comments = v_edited.enable_volunteer_comments,
    show_attendees_publicly = v_edited.show_attendees_publicly,
    waiver_required = v_edited.waiver_required,
    waiver_allow_upload = v_edited.waiver_allow_upload,
    waiver_disable_esignature = v_edited.waiver_disable_esignature,
    signup_form_schema = v_edited.signup_form_schema,
    recurrence_rule = NULL
  WHERE parents.id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'recurrence parent transition lost'
      USING ERRCODE = '40001';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'outcome', v_outcome,
    'endedRecurringSeries', v_ended_recurring_series,
    'cancelledOccurrences', v_cancelled_count,
    'calendarCleanupProjectIds', v_cleanup_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION
  private.end_recurring_project_series_transactional(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  private.end_recurring_project_series_transactional(uuid, jsonb)
  TO authenticated;

COMMENT ON FUNCTION
  private.end_recurring_project_series_transactional(uuid, jsonb) IS
  'Private actor-derived transaction that locks the recurrence parent and eligible children, applies an allowlisted ordinary edit, delegates canonical child cancellation, and clears recurrence atomically.';

CREATE OR REPLACE FUNCTION public.end_recurring_project_series_transactional(
  p_project_id uuid,
  p_updates jsonb
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.end_recurring_project_series_transactional(
    p_project_id,
    p_updates
  );
$$;

REVOKE ALL ON FUNCTION
  public.end_recurring_project_series_transactional(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.end_recurring_project_series_transactional(uuid, jsonb)
  TO authenticated;

COMMENT ON FUNCTION
  public.end_recurring_project_series_transactional(uuid, jsonb) IS
  'Authenticated SECURITY INVOKER atomic recurring-series edit wrapper with a strict project-field allowlist.';

CREATE OR REPLACE FUNCTION public.end_recurring_project_series_transactional(
  p_project_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.end_recurring_project_series_transactional(
    p_project_id,
    '{
      "recurrence_rule": null,
      "series_end_compatibility_current": true
    }'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION
  public.end_recurring_project_series_transactional(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.end_recurring_project_series_transactional(uuid)
  TO authenticated;

COMMENT ON FUNCTION
  public.end_recurring_project_series_transactional(uuid) IS
  'Compatibility wrapper for legacy ended-series cleanup replay; active recurrence requires the generation-bound atomic edit overload.';

COMMIT;
