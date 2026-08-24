BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS csf_staff_positions_active_user_role_year_uidx
  ON plugin_data.csf_staff_positions (
    organization_id,
    user_id,
    role_id,
    school_year
  )
  WHERE status = 'active' AND user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION plugin_data.csf_assign_staff_position_v2(
  p_organization_id uuid,
  p_profile_id uuid,
  p_user_id uuid,
  p_role_id uuid,
  p_school_year text,
  p_display_title text,
  p_starts_at date,
  p_ends_at date,
  p_notes text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role plugin_data.csf_roles%ROWTYPE;
  v_position_id uuid := gen_random_uuid();
  v_existing_host_role text;
  v_previous_host_role text;
  v_membership_managed boolean := false;
  v_correlation_id uuid := gen_random_uuid();
  v_display_title text;
  v_school_year text := nullif(btrim(coalesce(p_school_year, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
BEGIN
  IF (p_profile_id IS NULL) = (p_user_id IS NULL) THEN
    RAISE EXCEPTION 'Choose exactly one CSF member or organization account.';
  END IF;

  IF p_profile_id IS NOT NULL THEN
    RETURN plugin_data.csf_assign_staff_position(
      p_organization_id,
      p_profile_id,
      p_role_id,
      p_school_year,
      p_display_title,
      p_starts_at,
      p_ends_at,
      p_notes,
      p_actor_user_id
    );
  END IF;

  IF NOT plugin_data.csf_actor_can_manage_staff(
    p_organization_id,
    p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF staff access.';
  END IF;
  IF v_school_year IS NULL OR v_school_year !~ '^20[0-9]{2}-20[0-9]{2}$' THEN
    RAISE EXCEPTION 'School year must use YYYY-YYYY.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id
      AND term.school_year = v_school_year
  ) THEN
    RAISE EXCEPTION 'School year must match one of the chapter''s terms.';
  END IF;
  IF p_starts_at IS NOT NULL
     AND p_ends_at IS NOT NULL
     AND p_ends_at < p_starts_at THEN
    RAISE EXCEPTION 'Position end date cannot be before its start date.';
  END IF;

  SELECT member.role
  INTO v_existing_host_role
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_user_id
    AND member.status = 'active'
    AND member.role IN ('admin', 'staff', 'member')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Add this account as an active organization member before assigning staff access.';
  END IF;

  SELECT role.*
  INTO v_role
  FROM plugin_data.csf_roles AS role
  WHERE role.organization_id = p_organization_id
    AND role.id = p_role_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF position template not found.';
  END IF;
  IF v_role.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Restore this CSF position before assigning it.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_staff_positions AS position
    WHERE position.organization_id = p_organization_id
      AND position.user_id = p_user_id
      AND position.role_id = p_role_id
      AND position.school_year = v_school_year
      AND position.status = 'active'
  ) THEN
    RAISE EXCEPTION 'This account already has that active position for the selected school year.';
  END IF;

  SELECT position.host_membership_previous_role
  INTO v_previous_host_role
  FROM plugin_data.csf_staff_positions AS position
  WHERE position.organization_id = p_organization_id
    AND position.user_id = p_user_id
    AND position.host_membership_managed = true
  ORDER BY position.created_at, position.id
  LIMIT 1;

  IF FOUND THEN
    v_membership_managed := true;
  ELSIF v_existing_host_role = 'member' THEN
    v_previous_host_role := v_existing_host_role;
    v_membership_managed := true;
  END IF;

  UPDATE public.organization_members
  SET
    role = CASE
      WHEN role = 'admin' THEN 'admin'
      ELSE 'staff'
    END,
    status = 'active'
  WHERE organization_id = p_organization_id
    AND user_id = p_user_id;

  v_display_title := coalesce(
    nullif(btrim(coalesce(p_display_title, '')), ''),
    nullif(btrim(coalesce(v_role.public_title, '')), ''),
    v_role.display_name
  );

  INSERT INTO plugin_data.csf_staff_positions (
    id,
    organization_id,
    profile_id,
    user_id,
    role_id,
    school_year,
    display_title,
    status,
    starts_at,
    ends_at,
    appointed_by,
    notes,
    host_membership_managed,
    host_membership_previous_role
  ) VALUES (
    v_position_id,
    p_organization_id,
    NULL,
    p_user_id,
    p_role_id,
    v_school_year,
    v_display_title,
    'active',
    p_starts_at,
    p_ends_at,
    p_actor_user_id,
    v_notes,
    v_membership_managed,
    v_previous_host_role
  );

  INSERT INTO plugin_data.csf_staff_position_history (
    organization_id,
    staff_position_id,
    actor_user_id,
    action,
    before_data,
    after_data,
    correlation_id,
    reason_code
  ) VALUES (
    p_organization_id,
    v_position_id,
    p_actor_user_id,
    'assign',
    NULL,
    jsonb_build_object(
      'identityType', 'organization_account',
      'profileId', NULL,
      'userId', p_user_id,
      'roleId', p_role_id,
      'publicTitle', v_display_title,
      'responsibilityLabel', v_role.responsibility_label,
      'schoolYear', v_school_year,
      'startsAt', p_starts_at,
      'endsAt', p_ends_at,
      'hostRole', CASE
        WHEN v_existing_host_role = 'admin' THEN 'admin'
        ELSE 'staff'
      END
    ),
    v_correlation_id,
    'position_assigned'
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'staff_position.assign',
    'csf_staff_positions',
    v_position_id,
    jsonb_build_object(
      'identityType', 'organization_account',
      'profileId', NULL,
      'userId', p_user_id,
      'roleId', p_role_id,
      'publicTitle', v_display_title,
      'responsibilityLabel', v_role.responsibility_label,
      'schoolYear', v_school_year,
      'startsAt', p_starts_at,
      'endsAt', p_ends_at
    ),
    v_correlation_id,
    'staff_access',
    v_position_id::text,
    'position_assigned'
  );

  RETURN jsonb_build_object(
    'positionId', v_position_id,
    'userId', p_user_id,
    'hostRole', CASE
      WHEN v_existing_host_role = 'admin' THEN 'admin'
      ELSE 'staff'
    END,
    'correlationId', v_correlation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_assign_staff_position_v2(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  date,
  date,
  text,
  uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_assign_staff_position_v2(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  date,
  date,
  text,
  uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_assign_staff_position_v2(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  date,
  date,
  text,
  uuid
) IS
  'Assigns a CSF staff position to either a verified CSF profile or an active organization account, then records immutable history and audit data.';

COMMIT;
