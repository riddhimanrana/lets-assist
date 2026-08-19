-- The multi-date meeting migration replaced the permission wrappers added by
-- 20260812220000_csf_meeting_permission_followups.sql. Preserve the new atomic
-- projection logic behind owner-internal base functions and restore the exact
-- staff-lock and attendance-source permission checks on every public RPC.

BEGIN;

ALTER FUNCTION plugin_data.csf_upsert_term_meeting(
  uuid, uuid, uuid, text, date[], timestamptz, text, text,
  boolean, integer, text, uuid, uuid
) RENAME TO csf_upsert_term_meeting_multi_date_permission_base;

ALTER FUNCTION plugin_data.csf_archive_term_meeting(
  uuid, uuid, uuid, uuid, uuid
) RENAME TO csf_archive_term_meeting_multi_date_permission_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_meeting_source_permissions_under_lock(
  p_organization_id uuid,
  p_term_id uuid,
  p_meeting_id uuid,
  p_attendance_source_url text,
  p_actor_user_id uuid
)
RETURNS text
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

  RETURN v_requested_source_url;
END;
$$;

CREATE FUNCTION plugin_data.csf_upsert_term_meeting(
  p_organization_id uuid,
  p_term_id uuid,
  p_meeting_id uuid,
  p_label text,
  p_meeting_dates date[],
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
  v_requested_source_url text;
BEGIN
  PERFORM plugin_data.csf_assert_meeting_permission_under_lock(
    p_organization_id, p_actor_user_id, 'manage_meetings'
  );
  v_requested_source_url :=
    plugin_data.csf_assert_meeting_source_permissions_under_lock(
      p_organization_id,
      p_term_id,
      p_meeting_id,
      p_attendance_source_url,
      p_actor_user_id
    );

  RETURN plugin_data.csf_upsert_term_meeting_multi_date_permission_base(
    p_organization_id, p_term_id, p_meeting_id, p_label, p_meeting_dates,
    p_starts_at, p_location, v_requested_source_url, p_required, p_sort_order,
    p_status, p_request_id, p_actor_user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_upsert_term_meeting(
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
  v_requested_source_url text;
BEGIN
  PERFORM plugin_data.csf_assert_meeting_permission_under_lock(
    p_organization_id, p_actor_user_id, 'manage_meetings'
  );
  v_requested_source_url :=
    plugin_data.csf_assert_meeting_source_permissions_under_lock(
      p_organization_id,
      p_term_id,
      p_meeting_id,
      p_attendance_source_url,
      p_actor_user_id
    );

  RETURN plugin_data.csf_upsert_term_meeting_multi_date_permission_base(
    p_organization_id,
    p_term_id,
    p_meeting_id,
    p_label,
    CASE WHEN p_meeting_date IS NULL THEN '{}'::date[] ELSE ARRAY[p_meeting_date] END,
    p_starts_at,
    p_location,
    v_requested_source_url,
    p_required,
    p_sort_order,
    p_status,
    p_request_id,
    p_actor_user_id
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
  RETURN plugin_data.csf_archive_term_meeting_multi_date_permission_base(
    p_organization_id, p_term_id, p_meeting_id, p_request_id, p_actor_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_assert_meeting_source_permissions_under_lock(
  uuid, uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_upsert_term_meeting_multi_date_permission_base(
  uuid, uuid, uuid, text, date[], timestamptz, text, text,
  boolean, integer, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_archive_term_meeting_multi_date_permission_base(
  uuid, uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_upsert_term_meeting(
  uuid, uuid, uuid, text, date[], timestamptz, text, text,
  boolean, integer, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_upsert_term_meeting(
  uuid, uuid, uuid, text, date[], timestamptz, text, text,
  boolean, integer, text, uuid, uuid
) TO service_role;

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

COMMENT ON FUNCTION plugin_data.csf_assert_meeting_source_permissions_under_lock(
  uuid, uuid, uuid, text, uuid
) IS 'Owner-internal attendance-source authorization. Adding a source requires import_meetings; replacing or removing one also requires reconcile_meeting_attendance under the staff-access lock.';
COMMENT ON FUNCTION plugin_data.csf_upsert_term_meeting_multi_date_permission_base(
  uuid, uuid, uuid, text, date[], timestamptz, text, text,
  boolean, integer, text, uuid, uuid
) IS 'Owner-internal multi-date atomic meeting upsert. Direct execution is revoked; call csf_upsert_term_meeting.';
COMMENT ON FUNCTION plugin_data.csf_archive_term_meeting_multi_date_permission_base(
  uuid, uuid, uuid, uuid, uuid
) IS 'Owner-internal multi-date atomic meeting archive. Direct execution is revoked; call csf_archive_term_meeting.';
COMMENT ON FUNCTION plugin_data.csf_upsert_term_meeting(
  uuid, uuid, uuid, text, date[], timestamptz, text, text,
  boolean, integer, text, uuid, uuid
) IS 'Service-only multi-date meeting create/edit. Rechecks manage_meetings under the staff lock and applies exact attendance-source permissions before the atomic projection update.';
COMMENT ON FUNCTION plugin_data.csf_upsert_term_meeting(
  uuid, uuid, uuid, text, date, timestamptz, text, text,
  boolean, integer, text, uuid, uuid
) IS 'Deprecated service-only single-date meeting wrapper with the same locked authorization guarantees as the date-array API.';
COMMENT ON FUNCTION plugin_data.csf_archive_term_meeting(
  uuid, uuid, uuid, uuid, uuid
) IS 'Service-only meeting archive that rechecks active membership and exact manage_meetings authority under the shared staff-access lock before archiving every meeting projection.';

COMMIT;
