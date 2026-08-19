-- Bind CSF staff access to the chapter's current school year.
--
-- `csf_staff_positions.school_year` was recorded but never consulted by any
-- permission predicate: a prior-year row with `status = 'active'` kept granting
-- officer access indefinitely, and the roster UI's "current year vs earlier
-- years" split was purely presentational. This migration makes the year
-- real:
--
--   1. A staff seat only satisfies `csf_actor_can_manage_staff` (and only
--      counts toward the recovery floor) when its `school_year` matches the
--      chapter's current school year.
--   2. `csf_assign_staff_position` only accepts a school year that matches at
--      least one of the chapter's `csf_terms` rows — the year is no longer
--      free text detached from the term system.
--
-- Recovery-floor interaction, considered deliberately: at rollover every
-- prior-year seat stops counting, so the floor reads zero. The existing
-- "not made worse" guards in `csf_revoke_staff_position` and
-- `csf_update_role` (both compare against the pre-write count) therefore keep
-- permitting cleanup of old rows, and the year-independent branches of
-- `csf_actor_can_manage_staff` — org admins and the chapter mailbox — can
-- always seed the new year's first recovery seat. A chapter cannot lock
-- itself out by the year changing.
--
-- The current school year is the `is_current` term's `school_year`, with a
-- Pacific-calendar fallback (Jul-Dec -> Y-(Y+1), Jan-Jun -> (Y-1)-Y) so a
-- chapter between terms does not silently drop every officer.
--
-- Also adds `plugin_data.csf_staff_view_preferences`: a per-user, per-org
-- record of whether an officer last used the member or officer presentation
-- of the CSF workspace. Presentation only — nothing reads it for
-- authorization.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_current_school_year(
  p_organization_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (
      SELECT term.school_year
      FROM plugin_data.csf_terms AS term
      WHERE term.organization_id = p_organization_id
        AND term.is_current = true
      LIMIT 1
    ),
    (
      SELECT CASE
        WHEN extract(month FROM today.value) >= 7
          THEN extract(year FROM today.value)::int::text || '-' || (extract(year FROM today.value)::int + 1)::text
        ELSE (extract(year FROM today.value)::int - 1)::text || '-' || extract(year FROM today.value)::int::text
      END
      FROM (SELECT (pg_catalog.now() AT TIME ZONE 'America/Los_Angeles')::date AS value) AS today
    )
  );
$$;

-- Faithful copy of the `20260716044050_dvhs_csf_staff_access_rbac` definition.
-- The org-admin and chapter-mailbox branches are unchanged (and deliberately
-- year-independent — they are the rollover escape hatch). The staff-seat
-- branch additionally requires the seat's school year to be current.
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
      WHERE position.organization_id = p_organization_id
        AND position.user_id = p_actor_user_id
        AND position.status = 'active'
        AND position.school_year = plugin_data.csf_current_school_year(p_organization_id)
        AND (position.starts_at IS NULL OR position.starts_at <= (now() AT TIME ZONE 'America/Los_Angeles')::date)
        AND (position.ends_at IS NULL OR position.ends_at >= (now() AT TIME ZONE 'America/Los_Angeles')::date)
    );
$$;

-- Faithful copy of the `20260811160000_dvhs_csf_recovery_seat_floor`
-- definition, plus the same current-school-year condition, so the floor keeps
-- mirroring the staff-seat branch of `csf_actor_can_manage_staff` exactly. A
-- prior-year seat cannot recover the chapter today, so it is not counted.
CREATE OR REPLACE FUNCTION plugin_data.csf_count_recovery_staff_seats(
  p_organization_id uuid,
  p_excluded_position_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*)::integer
  FROM plugin_data.csf_staff_positions AS position
  JOIN plugin_data.csf_roles AS role
    ON role.organization_id = position.organization_id
   AND role.id = position.role_id
  JOIN plugin_data.csf_role_permissions AS permission
    ON permission.organization_id = position.organization_id
   AND permission.role_id = position.role_id
   AND permission.permission_key = 'manage_roles'
   AND permission.enabled = true
  WHERE position.organization_id = p_organization_id
    AND (p_excluded_position_id IS NULL OR position.id <> p_excluded_position_id)
    AND position.status = 'active'
    AND position.user_id IS NOT NULL
    AND role.archived_at IS NULL
    AND position.school_year = plugin_data.csf_current_school_year(p_organization_id)
    AND (position.starts_at IS NULL OR position.starts_at <= (pg_catalog.now() AT TIME ZONE 'America/Los_Angeles')::date)
    AND (position.ends_at IS NULL OR position.ends_at >= (pg_catalog.now() AT TIME ZONE 'America/Los_Angeles')::date);
$$;

-- Faithful copy of the `20260716044050_dvhs_csf_staff_access_rbac` definition.
-- One addition: after the format check, the school year must match at least
-- one of the chapter's terms. The regex stays as a backstop.
CREATE OR REPLACE FUNCTION plugin_data.csf_assign_staff_position(
  p_organization_id uuid,
  p_profile_id uuid,
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
  v_user_id uuid;
  v_existing_host_role text;
  v_previous_host_role text;
  v_membership_managed boolean := false;
  v_correlation_id uuid := gen_random_uuid();
  v_display_title text;
  v_school_year text := nullif(btrim(coalesce(p_school_year, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
BEGIN
  IF NOT plugin_data.csf_actor_can_manage_staff(p_organization_id, p_actor_user_id) THEN
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
  IF p_starts_at IS NOT NULL AND p_ends_at IS NOT NULL AND p_ends_at < p_starts_at THEN
    RAISE EXCEPTION 'Position end date cannot be before its start date.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = p_profile_id
      AND profile.record_status = 'active'
  ) THEN
    RAISE EXCEPTION 'CSF member record not found.';
  END IF;

  SELECT role.*
  INTO v_role
  FROM plugin_data.csf_roles AS role
  WHERE role.organization_id = p_organization_id
    AND role.id = p_role_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF position template not found.';
  END IF;

  SELECT account.user_id
  INTO v_user_id
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.profile_id = p_profile_id
    AND account.status = 'verified'
  ORDER BY account.is_primary DESC, account.linked_at DESC, account.id
  LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Connect a verified Let''s Assist account before assigning staff access.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_staff_positions AS position
    WHERE position.organization_id = p_organization_id
      AND position.profile_id = p_profile_id
      AND position.role_id = p_role_id
      AND position.school_year = v_school_year
      AND position.status = 'active'
  ) THEN
    RAISE EXCEPTION 'This member already has that active position for the selected school year.';
  END IF;

  SELECT member.role
  INTO v_existing_host_role
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = v_user_id
  FOR UPDATE;

  SELECT position.host_membership_previous_role
  INTO v_previous_host_role
  FROM plugin_data.csf_staff_positions AS position
  WHERE position.organization_id = p_organization_id
    AND position.user_id = v_user_id
    AND position.host_membership_managed = true
  ORDER BY position.created_at, position.id
  LIMIT 1;

  IF FOUND THEN
    v_membership_managed := true;
  ELSIF v_existing_host_role IS NULL OR v_existing_host_role = 'member' THEN
    v_previous_host_role := v_existing_host_role;
    v_membership_managed := true;
  END IF;

  INSERT INTO public.organization_members (
    organization_id, user_id, role, joined_at, status
  ) VALUES (
    p_organization_id, v_user_id, 'staff', now(), 'active'
  )
  ON CONFLICT (organization_id, user_id) DO UPDATE
  SET
    role = CASE
      WHEN public.organization_members.role = 'admin' THEN 'admin'
      ELSE 'staff'
    END,
    status = 'active';

  v_display_title := coalesce(
    nullif(btrim(coalesce(p_display_title, '')), ''),
    nullif(btrim(coalesce(v_role.public_title, '')), ''),
    v_role.display_name
  );

  INSERT INTO plugin_data.csf_staff_positions (
    id, organization_id, profile_id, user_id, role_id, school_year,
    display_title, status, starts_at, ends_at, appointed_by, notes,
    host_membership_managed, host_membership_previous_role
  ) VALUES (
    v_position_id, p_organization_id, p_profile_id, v_user_id, p_role_id,
    v_school_year, v_display_title, 'active', p_starts_at, p_ends_at,
    p_actor_user_id, v_notes, v_membership_managed, v_previous_host_role
  );

  INSERT INTO plugin_data.csf_staff_position_history (
    organization_id, staff_position_id, actor_user_id, action,
    before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, v_position_id, p_actor_user_id, 'assign', NULL,
    jsonb_build_object(
      'profileId', p_profile_id,
      'userId', v_user_id,
      'roleId', p_role_id,
      'publicTitle', v_display_title,
      'responsibilityLabel', v_role.responsibility_label,
      'schoolYear', v_school_year,
      'startsAt', p_starts_at,
      'endsAt', p_ends_at,
      'hostRole', CASE WHEN v_existing_host_role = 'admin' THEN 'admin' ELSE 'staff' END
    ),
    v_correlation_id, 'position_assigned'
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'staff_position.assign',
    'csf_staff_positions', v_position_id,
    jsonb_build_object(
      'profileId', p_profile_id,
      'userId', v_user_id,
      'roleId', p_role_id,
      'publicTitle', v_display_title,
      'responsibilityLabel', v_role.responsibility_label,
      'schoolYear', v_school_year,
      'startsAt', p_starts_at,
      'endsAt', p_ends_at
    ),
    v_correlation_id, 'staff_access', v_position_id::text, 'position_assigned'
  );

  RETURN jsonb_build_object(
    'positionId', v_position_id,
    'userId', v_user_id,
    'hostRole', CASE WHEN v_existing_host_role = 'admin' THEN 'admin' ELSE 'staff' END,
    'correlationId', v_correlation_id
  );
END;
$$;

CREATE TABLE IF NOT EXISTS plugin_data.csf_staff_view_preferences (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  view_mode text NOT NULL CHECK (view_mode IN ('member', 'officer')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

ALTER TABLE plugin_data.csf_staff_view_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_staff_view_preferences FROM anon, authenticated;
GRANT ALL ON TABLE plugin_data.csf_staff_view_preferences TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_current_school_year(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_actor_can_manage_staff(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_count_recovery_staff_seats(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_assign_staff_position(uuid, uuid, uuid, text, text, date, date, text, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_current_school_year(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_actor_can_manage_staff(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_count_recovery_staff_seats(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assign_staff_position(uuid, uuid, uuid, text, text, date, date, text, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_current_school_year(uuid) IS
  'The chapter''s current school year: the is_current term''s school_year, falling back to the Pacific-calendar year (Jul-Dec -> Y-(Y+1), Jan-Jun -> (Y-1)-Y) when no term is current.';
COMMENT ON FUNCTION plugin_data.csf_actor_can_manage_staff(uuid, uuid) IS
  'True for active org admins, the chapter mailbox, or a currently effective active staff seat in the current school year whose role has manage_roles enabled. The seat branch is term-bound; the admin and mailbox branches are the year-rollover escape hatch.';
COMMENT ON FUNCTION plugin_data.csf_count_recovery_staff_seats(uuid, uuid) IS
  'Counts active, currently effective, current-school-year CSF seats held by a real account on an unarchived role that still has manage_roles enabled, optionally excluding one position. Prior-year and future-dated seats are excluded.';
COMMENT ON FUNCTION plugin_data.csf_assign_staff_position(uuid, uuid, uuid, text, text, date, date, text, uuid) IS
  'Assigns a CSF staff position for a school year that must match one of the chapter''s terms, upserts host staff membership, and writes immutable history plus audit.';
COMMENT ON TABLE plugin_data.csf_staff_view_preferences IS
  'Per-user, per-organization record of the last chosen CSF workspace presentation (member or officer). Presentation only; never consulted for authorization.';

COMMIT;
