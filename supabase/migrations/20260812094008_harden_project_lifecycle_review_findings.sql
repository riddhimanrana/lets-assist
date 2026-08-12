-- Close the four project-lifecycle Data API gaps found during review without
-- changing the reviewed RPC signatures or service-role mutation paths.

-- Organization management authority requires a currently active membership.
-- Project creation remains an independent source of authority.
CREATE OR REPLACE FUNCTION app_private.is_project_organizer(
  p_project_id uuid,
  p_user uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    p_user IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.projects AS projects
      WHERE projects.id = p_project_id
        AND (
          projects.creator_id = p_user
          OR EXISTS (
            SELECT 1
            FROM public.organization_members AS members
            WHERE members.organization_id = projects.organization_id
              AND members.user_id = p_user
              AND members.status = 'active'
              AND (
                members.role = 'admin'
                OR (
                  members.role = 'staff'
                  AND projects.can_be_managed_by_staff = true
                )
              )
          )
        )
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION app_private.is_project_organizer(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.is_project_organizer(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION app_private.is_project_organizer(uuid, uuid) IS
  'Returns creator authority, active admin authority, or active staff authority for staff-manageable projects.';

-- All shared membership helpers must agree that only an explicitly active row
-- grants tenant authority. Otherwise an inactive actor can use the member-row
-- UPDATE policy to reactivate themselves before reaching project RLS.
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

-- The authenticated projects UPDATE policy is intentionally broad enough for
-- ordinary project editing. Keep cancellation behind the SECURITY DEFINER RPC,
-- whose owner context bypasses this client guard while it atomically writes the
-- status transition, audience snapshot, and outbox.
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
  'Protects project ownership coordinates and requires client cancellation to use the atomic cancellation RPC.';

-- Managers retain direct moderation for non-capacity-consuming transitions,
-- but pending/rejected approval must use the canonical slot advisory lock.
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
    IF NEW.status = 'approved'
      AND OLD.status IS DISTINCT FROM 'approved'
    THEN
      RAISE EXCEPTION 'signup approval requires a capacity-safe transactional RPC'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.status = 'attended'
      AND OLD.status IS DISTINCT FROM 'attended'
      AND OLD.status IS DISTINCT FROM 'approved'
    THEN
      RAISE EXCEPTION 'attendance requires an approved signup'
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
  'Restricts client signup edits and routes capacity-consuming approvals through their transactional RPCs.';

-- Approval and first attendance both change cancellation-audience state. They
-- therefore take the same project row lock as cancellation and fail closed
-- after the project becomes inactive.
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
  'Serializes signup approval and approved-to-attended transitions with project cancellation and rejects inactive or cancelled attendance.';

-- A stale recurrence worker must serialize with series ending before inserting
-- a child. Once the parent rule is cleared, no later child may be materialized.
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

CREATE OR REPLACE FUNCTION public.end_recurring_project_series_transactional(
  p_project_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_parent public.projects%ROWTYPE;
  v_child record;
  v_receipt jsonb;
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

  IF NOT (
    v_parent.creator_id = v_actor_id
    OR EXISTS (
      SELECT 1
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
    )
  ) THEN
    RAISE EXCEPTION 'recurring project permission denied'
      USING ERRCODE = '42501';
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

  FOR v_child IN
    SELECT children.id
    FROM public.projects AS children
    WHERE children.recurrence_parent_id = p_project_id
      AND children.status = 'upcoming'
    ORDER BY children.id
    FOR UPDATE
  LOOP
    v_receipt := public.cancel_project_transactional(
      v_child.id,
      'Recurring series ended by organizer'
    );

    IF COALESCE(v_receipt->>'outcome', '') NOT IN ('cancelled', 'already_cancelled') THEN
      RAISE EXCEPTION 'recurring occurrence cancellation was not accepted'
        USING ERRCODE = '40001';
    END IF;

    v_cancelled_count := v_cancelled_count + 1;
    v_cancelled_ids := v_cancelled_ids || jsonb_build_array(v_child.id);
  END LOOP;

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
  TO authenticated, service_role;

COMMENT ON FUNCTION public.end_recurring_project_series_transactional(uuid) IS
  'Permission-rechecks, serializes recurrence generation, cancels every upcoming child, and clears the parent rule atomically.';
