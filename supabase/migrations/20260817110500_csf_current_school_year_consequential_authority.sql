-- Complete the current-school-year fence for consequential staff operations
-- whose authorizers predate csf_actor_has_permission(). Organization admins
-- and the explicit chapter recovery identity retain their existing behavior.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_meeting_permission_under_lock(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_permission_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_admin boolean;
  v_today date := plugin_data.csf_chapter_today();
BEGIN
  IF p_organization_id IS NULL
    OR p_actor_user_id IS NULL
    OR nullif(pg_catalog.btrim(coalesce(p_permission_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A CSF meeting authorization requires an organization, actor, and permission.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  SELECT member.role = 'admin'
  INTO v_is_admin
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
    AND member.status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized for the requested CSF meeting operation.'
      USING ERRCODE = '42501';
  END IF;

  IF coalesce(v_is_admin, false)
    OR EXISTS (
      SELECT 1
      FROM plugin_data.csf_staff_positions AS position
      JOIN plugin_data.csf_roles AS role
        ON role.organization_id = position.organization_id
       AND role.id = position.role_id
      JOIN plugin_data.csf_terms AS current_term
        ON current_term.organization_id = position.organization_id
       AND current_term.school_year = position.school_year
       AND current_term.is_current = true
      WHERE position.organization_id = p_organization_id
        AND position.user_id = p_actor_user_id
        AND position.status = 'active'
        AND (position.starts_at IS NULL OR position.starts_at <= v_today)
        AND (position.ends_at IS NULL OR position.ends_at >= v_today)
        AND (role.role_type = 'owner' OR role.key = 'owner')
    )
    OR EXISTS (
      SELECT 1
      FROM plugin_data.csf_staff_positions AS position
      JOIN plugin_data.csf_role_permissions AS permission
        ON permission.organization_id = position.organization_id
       AND permission.role_id = position.role_id
       AND permission.permission_key = p_permission_key
       AND permission.enabled = true
      JOIN plugin_data.csf_terms AS current_term
        ON current_term.organization_id = position.organization_id
       AND current_term.school_year = position.school_year
       AND current_term.is_current = true
      WHERE position.organization_id = p_organization_id
        AND position.user_id = p_actor_user_id
        AND position.status = 'active'
        AND (position.starts_at IS NULL OR position.starts_at <= v_today)
        AND (position.ends_at IS NULL OR position.ends_at >= v_today)
    ) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'Not authorized for the requested CSF meeting operation.'
    USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_actor_can_manage_staff(
  p_organization_id uuid,
  p_actor_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.organization_members AS member
      WHERE member.organization_id = p_organization_id
        AND member.user_id = p_actor_user_id
        AND member.role = 'admin'
        AND coalesce(member.status, 'active') = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM auth.users AS actor
      WHERE actor.id = p_actor_user_id
        AND lower(actor.email) = 'dvhighcsf@gmail.com'
    )
    OR EXISTS (
      SELECT 1
      FROM plugin_data.csf_staff_positions AS position
      JOIN plugin_data.csf_role_permissions AS permission
        ON permission.organization_id = position.organization_id
       AND permission.role_id = position.role_id
       AND permission.permission_key = 'manage_roles'
       AND permission.enabled = true
      JOIN plugin_data.csf_terms AS current_term
        ON current_term.organization_id = position.organization_id
       AND current_term.school_year = position.school_year
       AND current_term.is_current = true
      WHERE position.organization_id = p_organization_id
        AND position.user_id = p_actor_user_id
        AND position.status = 'active'
        AND (position.starts_at IS NULL OR position.starts_at <= plugin_data.csf_chapter_today())
        AND (position.ends_at IS NULL OR position.ends_at >= plugin_data.csf_chapter_today())
    );
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_actor_can_edit_term_policy_draft(
  p_organization_id uuid,
  p_actor_user_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.organization_members AS membership
      WHERE membership.organization_id = p_organization_id
        AND membership.user_id = p_actor_user_id
        AND membership.role = 'admin'
        AND coalesce(membership.status, 'active') = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM plugin_data.csf_staff_positions AS position
      JOIN plugin_data.csf_role_permissions AS permission
        ON permission.organization_id = position.organization_id
       AND permission.role_id = position.role_id
       AND permission.permission_key = 'manage_settings'
       AND permission.enabled = true
      JOIN plugin_data.csf_terms AS current_term
        ON current_term.organization_id = position.organization_id
       AND current_term.school_year = position.school_year
       AND current_term.is_current = true
      JOIN public.organization_members AS membership
        ON membership.organization_id = position.organization_id
       AND membership.user_id = position.user_id
       AND membership.role IN ('staff', 'admin')
       AND coalesce(membership.status, 'active') = 'active'
      WHERE position.organization_id = p_organization_id
        AND position.user_id = p_actor_user_id
        AND position.status = 'active'
        AND (position.starts_at IS NULL OR position.starts_at <= plugin_data.csf_chapter_today())
        AND (position.ends_at IS NULL OR position.ends_at >= plugin_data.csf_chapter_today())
    );
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_actor_can_publish_term_policy(
  p_organization_id uuid,
  p_actor_user_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.organization_members AS membership
      WHERE membership.organization_id = p_organization_id
        AND membership.user_id = p_actor_user_id
        AND membership.role = 'admin'
        AND coalesce(membership.status, 'active') = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM plugin_data.csf_staff_positions AS position
      JOIN plugin_data.csf_roles AS role
        ON role.organization_id = position.organization_id
       AND role.id = position.role_id
       AND role.is_system = true
      JOIN plugin_data.csf_terms AS current_term
        ON current_term.organization_id = position.organization_id
       AND current_term.school_year = position.school_year
       AND current_term.is_current = true
      JOIN public.organization_members AS membership
        ON membership.organization_id = position.organization_id
       AND membership.user_id = position.user_id
       AND membership.role IN ('staff', 'admin')
       AND coalesce(membership.status, 'active') = 'active'
      WHERE position.organization_id = p_organization_id
        AND position.user_id = p_actor_user_id
        AND position.status = 'active'
        AND (position.starts_at IS NULL OR position.starts_at <= plugin_data.csf_chapter_today())
        AND (position.ends_at IS NULL OR position.ends_at >= plugin_data.csf_chapter_today())
        AND role.key IN ('advisor', 'owner')
    );
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_assign_application(
  p_organization_id uuid,
  p_application_id uuid,
  p_assignee_user_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := now();
BEGIN
  SELECT application.*
  INTO v_application
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF application not found.';
  END IF;

  IF p_assignee_user_id IS NOT NULL AND NOT (
    EXISTS (
      SELECT 1
      FROM plugin_data.csf_staff_positions AS position
      JOIN plugin_data.csf_terms AS current_term
        ON current_term.organization_id = position.organization_id
       AND current_term.school_year = position.school_year
       AND current_term.is_current = true
      JOIN public.organization_members AS member
        ON member.organization_id = position.organization_id
       AND member.user_id = position.user_id
       AND member.status = 'active'
       AND member.role IN ('staff', 'admin')
      WHERE position.organization_id = p_organization_id
        AND position.user_id = p_assignee_user_id
        AND position.status = 'active'
        AND (position.starts_at IS NULL OR position.starts_at <= plugin_data.csf_chapter_today())
        AND (position.ends_at IS NULL OR position.ends_at >= plugin_data.csf_chapter_today())
    )
    OR EXISTS (
      SELECT 1
      FROM public.organization_members AS member
      WHERE member.organization_id = p_organization_id
        AND member.user_id = p_assignee_user_id
        AND member.status = 'active'
        AND member.role = 'admin'
    )
    OR EXISTS (
      SELECT 1 FROM auth.users AS actor
      WHERE actor.id = p_assignee_user_id
        AND lower(actor.email) = 'dvhighcsf@gmail.com'
    )
  ) THEN
    RAISE EXCEPTION 'The assignee is not active CSF staff for this organization.';
  END IF;

  UPDATE plugin_data.csf_term_applications
  SET
    assigned_to = p_assignee_user_id,
    assigned_by = p_actor_user_id,
    assigned_at = CASE WHEN p_assignee_user_id IS NULL THEN NULL ELSE v_now END,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_application_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'application.assign',
    'csf_term_applications', p_application_id, v_application.term_id,
    jsonb_build_object('assignedTo', v_application.assigned_to),
    jsonb_build_object('assignedTo', p_assignee_user_id),
    v_correlation_id, 'application_review', p_application_id::text,
    CASE WHEN p_assignee_user_id IS NULL THEN 'unassigned' ELSE 'assigned' END
  );

  RETURN jsonb_build_object(
    'applicationId', p_application_id,
    'assignedTo', p_assignee_user_id,
    'correlationId', v_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_validate_application_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_is_adviser boolean := false;
BEGIN
  IF NEW.status = 'waived' THEN
    IF NEW.overridden_by IS NULL OR nullif(pg_catalog.btrim(coalesce(NEW.override_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Waived application checks require an actor and reason.';
    END IF;
    NEW.overridden_at := coalesce(NEW.overridden_at, now());

    IF NEW.check_type = 'academic_eligibility' THEN
      SELECT EXISTS (
        SELECT 1
        FROM plugin_data.csf_staff_positions AS position
        JOIN plugin_data.csf_roles AS role
          ON role.id = position.role_id
         AND role.organization_id = position.organization_id
        JOIN plugin_data.csf_terms AS current_term
          ON current_term.organization_id = position.organization_id
         AND current_term.school_year = position.school_year
         AND current_term.is_current = true
        WHERE position.organization_id = NEW.organization_id
          AND position.user_id = NEW.overridden_by
          AND position.status = 'active'
          AND (position.starts_at IS NULL OR position.starts_at <= plugin_data.csf_chapter_today())
          AND (position.ends_at IS NULL OR position.ends_at >= plugin_data.csf_chapter_today())
          AND role.key IN ('advisor', 'owner')
      ) OR EXISTS (
        SELECT 1
        FROM auth.users AS actor
        WHERE actor.id = NEW.overridden_by
          AND lower(actor.email) = 'dvhighcsf@gmail.com'
      )
      INTO v_is_adviser;

      IF NOT v_is_adviser THEN
        RAISE EXCEPTION 'Academic eligibility may only be overridden by a CSF adviser.';
      END IF;
    END IF;
  ELSIF NEW.overridden_by IS NOT NULL OR NEW.override_reason IS NOT NULL OR NEW.overridden_at IS NOT NULL THEN
    RAISE EXCEPTION 'Override metadata is only valid for a waived application check.';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_assert_meeting_permission_under_lock(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_actor_can_manage_staff(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_actor_can_edit_term_policy_draft(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_actor_can_edit_term_policy_draft(uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_actor_can_publish_term_policy(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_actor_can_publish_term_policy(uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_assign_application(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assign_application(uuid, uuid, uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_validate_application_check()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION plugin_data.csf_assert_meeting_permission_under_lock(uuid, uuid, text) IS
  'Owner-internal meeting authorization under the shared staff lock. Staff positions must belong to the configured current school year; organization admins remain authorized.';
COMMENT ON FUNCTION plugin_data.csf_actor_can_manage_staff(uuid, uuid) IS
  'Staff-access authorizer. Permission-bearing positions must belong to the configured current school year; organization admins and the explicit chapter recovery identity retain their prior authority.';
COMMENT ON FUNCTION plugin_data.csf_actor_can_edit_term_policy_draft(uuid, uuid) IS
  'Term-policy draft authorizer. Permission-bearing positions must belong to the configured current school year and an active host membership.';
COMMENT ON FUNCTION plugin_data.csf_actor_can_publish_term_policy(uuid, uuid) IS
  'Term-policy publication authorizer. Adviser and owner positions must belong to the configured current school year and an active host membership.';
COMMENT ON FUNCTION plugin_data.csf_assign_application(uuid, uuid, uuid, uuid) IS
  'Assigns an application to a current-school-year CSF staff member, organization admin, or the explicit chapter recovery identity and records the change in immutable audit history.';
COMMENT ON FUNCTION plugin_data.csf_validate_application_check() IS
  'Application-check trigger. Academic waivers require an adviser or owner position in the configured current school year, or the explicit chapter recovery identity.';

COMMIT;
