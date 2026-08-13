-- Keep every meeting mutation on the exact TypeScript capability matrix.
-- Authorization is mutable state, so meeting writes serialize with staff
-- revocation/role edits and pin active host membership before rechecking it.

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

CREATE OR REPLACE FUNCTION plugin_data.csf_import_compatibility_permissions(
  p_source_type text
)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN plugin_data.csf_import_source_permission(p_source_type) IS NULL
      THEN ARRAY[]::text[]
    WHEN p_source_type = 'meeting_attendance'
      THEN ARRAY[]::text[]
    WHEN p_source_type = 'partner_club_audit'
      THEN ARRAY['manage_sheet_sync', 'resolve_imports', 'manage_partner_clubs']
    ELSE ARRAY['manage_sheet_sync', 'resolve_imports']
  END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_import_actor(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_permission text := plugin_data.csf_import_source_permission(p_source_type);
  v_compatibility text[] := plugin_data.csf_import_compatibility_permissions(p_source_type);
  v_today date := plugin_data.csf_chapter_today();
  v_is_member boolean;
  v_is_admin boolean;
BEGIN
  IF p_organization_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'A CSF import action requires an organization and an acting officer.'
      USING ERRCODE = '42501';
  END IF;
  IF v_permission IS NULL THEN
    RAISE EXCEPTION 'CSF source type "%" is not an importable source.', coalesce(p_source_type, '<null>')
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS actor
    WHERE actor.id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'The acting officer for this CSF import is not a known user.'
      USING ERRCODE = '42501';
  END IF;

  IF p_source_type = 'meeting_attendance' THEN
    PERFORM plugin_data.csf_assert_meeting_permission_under_lock(
      p_organization_id, p_actor_user_id, 'import_meetings'
    );
    PERFORM plugin_data.csf_assert_meeting_permission_under_lock(
      p_organization_id, p_actor_user_id, 'reconcile_meeting_attendance'
    );
  END IF;

  SELECT
    count(*) > 0,
    bool_or(member.role = 'admin')
  INTO v_is_member, v_is_admin
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
    AND coalesce(member.status, 'active') = 'active';

  IF NOT coalesce(v_is_member, false) THEN
    RAISE EXCEPTION
      'This officer is not an active member of the organization whose CSF import they are acting on.'
      USING ERRCODE = '42501';
  END IF;

  IF coalesce(v_is_admin, false) THEN
    RETURN pg_catalog.jsonb_build_object(
      'actorUserId', p_actor_user_id,
      'sourceType', p_source_type,
      'permission', v_permission,
      'basis', 'organization_admin'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_staff_positions AS position
    JOIN plugin_data.csf_roles AS role
      ON role.id = position.role_id
     AND role.organization_id = position.organization_id
    WHERE position.organization_id = p_organization_id
      AND position.user_id = p_actor_user_id
      AND position.status = 'active'
      AND (position.starts_at IS NULL OR position.starts_at <= v_today)
      AND (position.ends_at IS NULL OR position.ends_at >= v_today)
      AND (role.role_type = 'owner' OR role.key = 'owner')
  ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'actorUserId', p_actor_user_id,
      'sourceType', p_source_type,
      'permission', v_permission,
      'basis', 'owner_position'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_staff_positions AS position
    JOIN plugin_data.csf_role_permissions AS permission
      ON permission.organization_id = position.organization_id
     AND permission.role_id = position.role_id
     AND permission.enabled = true
     AND (
       permission.permission_key = v_permission
       OR permission.permission_key = ANY (v_compatibility)
     )
    WHERE position.organization_id = p_organization_id
      AND position.user_id = p_actor_user_id
      AND position.status = 'active'
      AND (position.starts_at IS NULL OR position.starts_at <= v_today)
      AND (position.ends_at IS NULL OR position.ends_at >= v_today)
  ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'actorUserId', p_actor_user_id,
      'sourceType', p_source_type,
      'permission', v_permission,
      'basis', 'staff_position'
    );
  END IF;

  RAISE EXCEPTION
    'This officer does not hold the % capability for CSF % imports in this organization.',
    v_permission, p_source_type
    USING ERRCODE = '42501';
END;
$$;

ALTER FUNCTION plugin_data.csf_upsert_term_meeting(
  uuid, uuid, uuid, text, date, timestamptz, text, text,
  boolean, integer, text, uuid, uuid
) RENAME TO csf_upsert_term_meeting_permission_base;

ALTER FUNCTION plugin_data.csf_archive_term_meeting(
  uuid, uuid, uuid, uuid, uuid
) RENAME TO csf_archive_term_meeting_permission_base;

ALTER FUNCTION plugin_data.csf_correct_meeting_attendance(
  uuid, uuid, uuid, text, text, text, uuid, uuid
) RENAME TO csf_correct_meeting_attendance_permission_base;

CREATE FUNCTION plugin_data.csf_upsert_term_meeting(
  p_organization_id uuid,
  p_term_id uuid,
  p_meeting_id uuid,
  p_label text,
  p_meeting_date date,
  p_starts_at timestamptz,
  p_location text,
  p_attendance_source_url text,
  p_required boolean,
  p_sort_order integer,
  p_status text,
  p_request_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing_source_url text;
  v_existing_found boolean := false;
  v_requested_source_url text :=
    nullif(pg_catalog.btrim(coalesce(p_attendance_source_url, '')), '');
BEGIN
  PERFORM plugin_data.csf_assert_meeting_permission_under_lock(
    p_organization_id, p_actor_user_id, 'manage_meetings'
  );

  IF p_meeting_id IS NOT NULL THEN
    SELECT nullif(pg_catalog.btrim(coalesce(meeting.attendance_source_url, '')), '')
    INTO v_existing_source_url
    FROM plugin_data.csf_term_meetings AS meeting
    WHERE meeting.organization_id = p_organization_id
      AND meeting.term_id = p_term_id
      AND meeting.id = p_meeting_id
    FOR UPDATE;
    v_existing_found := FOUND;
  END IF;

  IF p_meeting_id IS NULL AND v_requested_source_url IS NOT NULL THEN
    PERFORM plugin_data.csf_assert_meeting_permission_under_lock(
      p_organization_id, p_actor_user_id, 'import_meetings'
    );
  ELSIF v_existing_found
    AND v_existing_source_url IS NULL
    AND v_requested_source_url IS NOT NULL THEN
    PERFORM plugin_data.csf_assert_meeting_permission_under_lock(
      p_organization_id, p_actor_user_id, 'import_meetings'
    );
  ELSIF v_existing_found
    AND v_existing_source_url IS NOT NULL
    AND v_requested_source_url IS DISTINCT FROM v_existing_source_url THEN
    PERFORM plugin_data.csf_assert_meeting_permission_under_lock(
      p_organization_id, p_actor_user_id, 'import_meetings'
    );
    PERFORM plugin_data.csf_assert_meeting_permission_under_lock(
      p_organization_id, p_actor_user_id, 'reconcile_meeting_attendance'
    );
  END IF;

  RETURN plugin_data.csf_upsert_term_meeting_permission_base(
    p_organization_id, p_term_id, p_meeting_id, p_label, p_meeting_date,
    p_starts_at, p_location, v_requested_source_url, p_required, p_sort_order,
    p_status, p_request_id, p_actor_user_id
  );
END;
$$;

CREATE FUNCTION plugin_data.csf_archive_term_meeting(
  p_organization_id uuid,
  p_term_id uuid,
  p_meeting_id uuid,
  p_request_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM plugin_data.csf_assert_meeting_permission_under_lock(
    p_organization_id, p_actor_user_id, 'manage_meetings'
  );
  RETURN plugin_data.csf_archive_term_meeting_permission_base(
    p_organization_id, p_term_id, p_meeting_id, p_request_id, p_actor_user_id
  );
END;
$$;

CREATE FUNCTION plugin_data.csf_correct_meeting_attendance(
  p_organization_id uuid,
  p_meeting_id uuid,
  p_profile_id uuid,
  p_operation text,
  p_status text,
  p_reason text,
  p_actor_user_id uuid,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM plugin_data.csf_assert_meeting_permission_under_lock(
    p_organization_id, p_actor_user_id, 'reconcile_meeting_attendance'
  );
  RETURN plugin_data.csf_correct_meeting_attendance_permission_base(
    p_organization_id, p_meeting_id, p_profile_id, p_operation, p_status,
    p_reason, p_actor_user_id, p_correlation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_assert_meeting_permission_under_lock(
  uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_import_compatibility_permissions(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_import_actor(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_upsert_term_meeting_permission_base(
  uuid, uuid, uuid, text, date, timestamptz, text, text,
  boolean, integer, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_archive_term_meeting_permission_base(
  uuid, uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_correct_meeting_attendance_permission_base(
  uuid, uuid, uuid, text, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_upsert_term_meeting(
  uuid, uuid, uuid, text, date, timestamptz, text, text,
  boolean, integer, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_upsert_term_meeting(
  uuid, uuid, uuid, text, date, timestamptz, text, text,
  boolean, integer, text, uuid, uuid
) TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_archive_term_meeting(
  uuid, uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_archive_term_meeting(
  uuid, uuid, uuid, uuid, uuid
) TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_correct_meeting_attendance(
  uuid, uuid, uuid, text, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_correct_meeting_attendance(
  uuid, uuid, uuid, text, text, text, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_assert_meeting_permission_under_lock(
  uuid, uuid, text
) IS 'Owner-internal exact CSF meeting permission assertion. Serializes with staff-access mutations, pins active organization membership, and rechecks current admin/owner/role authority under that lock.';
COMMENT ON FUNCTION plugin_data.csf_import_compatibility_permissions(text) IS
  'Enumerated pre-cutover import grants. Meeting attendance deliberately has no broad compatibility grant; it requires exact import_meetings plus reconcile_meeting_attendance through csf_assert_import_actor.';
COMMENT ON FUNCTION plugin_data.csf_assert_import_actor(uuid, uuid, text) IS
  'Tenant-scoped import authorization. Meeting attendance additionally requires exact import_meetings and reconcile_meeting_attendance under the shared staff-access lock; other source compatibility remains unchanged.';

COMMENT ON FUNCTION plugin_data.csf_upsert_term_meeting(
  uuid, uuid, uuid, text, date, timestamptz, text, text,
  boolean, integer, text, uuid, uuid
) IS 'Service-only meeting create/edit. Rechecks manage_meetings under the staff lock; adding a source requires import_meetings, while replacing or removing an existing source also requires reconcile_meeting_attendance.';
COMMENT ON FUNCTION plugin_data.csf_archive_term_meeting(
  uuid, uuid, uuid, uuid, uuid
) IS 'Service-only meeting archive that rechecks active membership and exact manage_meetings authority under the shared staff-access lock before delegating to the atomic projection update.';
COMMENT ON FUNCTION plugin_data.csf_correct_meeting_attendance(
  uuid, uuid, uuid, text, text, text, uuid, uuid
) IS 'Service-only manual attendance correction that rechecks active membership and exact reconcile_meeting_attendance authority under the shared staff-access lock before its atomic write and audit.';

COMMENT ON FUNCTION plugin_data.csf_upsert_term_meeting_permission_base(
  uuid, uuid, uuid, text, date, timestamptz, text, text,
  boolean, integer, text, uuid, uuid
) IS 'Owner-only prior atomic meeting upsert implementation. Direct execution is revoked; call csf_upsert_term_meeting.';
COMMENT ON FUNCTION plugin_data.csf_archive_term_meeting_permission_base(
  uuid, uuid, uuid, uuid, uuid
) IS 'Owner-only prior atomic meeting archive implementation. Direct execution is revoked; call csf_archive_term_meeting.';
COMMENT ON FUNCTION plugin_data.csf_correct_meeting_attendance_permission_base(
  uuid, uuid, uuid, text, text, text, uuid, uuid
) IS 'Owner-only prior atomic attendance-correction implementation. Direct execution is revoked; call csf_correct_meeting_attendance.';

COMMIT;
