-- A staff-only actor could pass an activity or partner-club permission check,
-- wait behind later request/business locks, and then commit after a concurrent
-- role edit or position revocation removed that permission. Keep the existing
-- transactions intact behind owner-only implementations and put the stable
-- service signatures behind the shared staff-access lock and reauthorization.

BEGIN;

ALTER FUNCTION plugin_data.csf_create_activity(
  uuid, uuid, uuid, jsonb, uuid, uuid
)
RENAME TO csf_create_activity_locked_impl;

ALTER FUNCTION plugin_data.csf_update_activity(
  uuid, uuid, uuid, uuid, jsonb, uuid, uuid
)
RENAME TO csf_update_activity_locked_impl;

ALTER FUNCTION plugin_data.csf_set_activity_status(
  uuid, uuid, text, text, uuid, uuid
)
RENAME TO csf_set_activity_status_locked_impl;

ALTER FUNCTION plugin_data.csf_link_activity_project(
  uuid, uuid, uuid, uuid, uuid
)
RENAME TO csf_link_activity_project_locked_impl;

ALTER FUNCTION plugin_data.csf_set_partner_club_status(
  uuid, uuid, text, uuid, uuid
)
RENAME TO csf_set_partner_club_status_locked_impl;

REVOKE ALL ON FUNCTION plugin_data.csf_create_activity_locked_impl(
  uuid, uuid, uuid, jsonb, uuid, uuid
)
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_update_activity_locked_impl(
  uuid, uuid, uuid, uuid, jsonb, uuid, uuid
)
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_set_activity_status_locked_impl(
  uuid, uuid, text, text, uuid, uuid
)
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_link_activity_project_locked_impl(
  uuid, uuid, uuid, uuid, uuid
)
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_set_partner_club_status_locked_impl(
  uuid, uuid, text, uuid, uuid
)
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION plugin_data.csf_create_activity(
  p_organization_id uuid,
  p_term_id uuid,
  p_cohort_id uuid,
  p_activity jsonb,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_membership_user_id uuid;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_opportunities'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  SELECT member.user_id
  INTO v_actor_membership_user_id
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
    AND member.status = 'active'
  FOR SHARE;

  IF NOT FOUND
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_opportunities'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;

  RETURN plugin_data.csf_create_activity_locked_impl(
    p_organization_id,
    p_term_id,
    p_cohort_id,
    p_activity,
    p_actor_user_id,
    p_request_id
  );
END;
$$;

CREATE FUNCTION plugin_data.csf_update_activity(
  p_organization_id uuid,
  p_activity_id uuid,
  p_term_id uuid,
  p_cohort_id uuid,
  p_activity jsonb,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_membership_user_id uuid;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_opportunities'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  SELECT member.user_id
  INTO v_actor_membership_user_id
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
    AND member.status = 'active'
  FOR SHARE;

  IF NOT FOUND
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_opportunities'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;

  RETURN plugin_data.csf_update_activity_locked_impl(
    p_organization_id,
    p_activity_id,
    p_term_id,
    p_cohort_id,
    p_activity,
    p_actor_user_id,
    p_request_id
  );
END;
$$;

CREATE FUNCTION plugin_data.csf_set_activity_status(
  p_organization_id uuid,
  p_activity_id uuid,
  p_status text,
  p_reason text,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_membership_user_id uuid;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_opportunities'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  SELECT member.user_id
  INTO v_actor_membership_user_id
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
    AND member.status = 'active'
  FOR SHARE;

  IF NOT FOUND
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_opportunities'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;

  RETURN plugin_data.csf_set_activity_status_locked_impl(
    p_organization_id,
    p_activity_id,
    p_status,
    p_reason,
    p_actor_user_id,
    p_request_id
  );
END;
$$;

CREATE FUNCTION plugin_data.csf_link_activity_project(
  p_organization_id uuid,
  p_activity_id uuid,
  p_project_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_membership_user_id uuid;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_opportunities'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  SELECT member.user_id
  INTO v_actor_membership_user_id
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
    AND member.status = 'active'
  FOR SHARE;

  IF NOT FOUND
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_opportunities'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;

  RETURN plugin_data.csf_link_activity_project_locked_impl(
    p_organization_id,
    p_activity_id,
    p_project_id,
    p_actor_user_id,
    p_request_id
  );
END;
$$;

CREATE FUNCTION plugin_data.csf_set_partner_club_status(
  p_organization_id uuid,
  p_partner_club_id uuid,
  p_status text,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_membership_user_id uuid;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_partner_clubs'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  SELECT member.user_id
  INTO v_actor_membership_user_id
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
    AND member.status = 'active'
  FOR SHARE;

  IF NOT FOUND
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_partner_clubs'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;

  RETURN plugin_data.csf_set_partner_club_status_locked_impl(
    p_organization_id,
    p_partner_club_id,
    p_status,
    p_actor_user_id,
    p_request_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_create_activity(
  uuid, uuid, uuid, jsonb, uuid, uuid
)
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_update_activity(
  uuid, uuid, uuid, uuid, jsonb, uuid, uuid
)
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_set_activity_status(
  uuid, uuid, text, text, uuid, uuid
)
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_link_activity_project(
  uuid, uuid, uuid, uuid, uuid
)
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_set_partner_club_status(
  uuid, uuid, text, uuid, uuid
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION plugin_data.csf_create_activity(
  uuid, uuid, uuid, jsonb, uuid, uuid
)
TO service_role;

GRANT EXECUTE ON FUNCTION plugin_data.csf_update_activity(
  uuid, uuid, uuid, uuid, jsonb, uuid, uuid
)
TO service_role;

GRANT EXECUTE ON FUNCTION plugin_data.csf_set_activity_status(
  uuid, uuid, text, text, uuid, uuid
)
TO service_role;

GRANT EXECUTE ON FUNCTION plugin_data.csf_link_activity_project(
  uuid, uuid, uuid, uuid, uuid
)
TO service_role;

GRANT EXECUTE ON FUNCTION plugin_data.csf_set_partner_club_status(
  uuid, uuid, text, uuid, uuid
)
TO service_role;

COMMENT ON FUNCTION plugin_data.csf_create_activity(
  uuid, uuid, uuid, jsonb, uuid, uuid
) IS
  'Server-only creation of one tenant-scoped CSF activity and immutable replay receipt after checking manage_opportunities before and after the organization staff-access lock.';

COMMENT ON FUNCTION plugin_data.csf_update_activity(
  uuid, uuid, uuid, uuid, jsonb, uuid, uuid
) IS
  'Server-only update of one tenant-scoped CSF activity and immutable replay receipt after checking manage_opportunities before and after the organization staff-access lock.';

COMMENT ON FUNCTION plugin_data.csf_set_activity_status(
  uuid, uuid, text, text, uuid, uuid
) IS
  'Server-only transition of one tenant-scoped CSF activity with its replay-safe audit receipt after checking manage_opportunities before and after the organization staff-access lock.';

COMMENT ON FUNCTION plugin_data.csf_link_activity_project(
  uuid, uuid, uuid, uuid, uuid
) IS
  'Server-only link of an exact-tenant activity and public project with atomic audit after checking manage_opportunities before and after the organization staff-access lock.';

COMMENT ON FUNCTION plugin_data.csf_set_partner_club_status(
  uuid, uuid, text, uuid, uuid
) IS
  'Server-only archive, deactivation, or restoration of one tenant-scoped partner club with replay-safe atomic audit after checking manage_partner_clubs before and after the organization staff-access lock.';

COMMENT ON FUNCTION plugin_data.csf_create_activity_locked_impl(
  uuid, uuid, uuid, jsonb, uuid, uuid
) IS
  'Owner-only activity-create implementation retained behind csf_create_activity; direct client and service-role execution is revoked.';

COMMENT ON FUNCTION plugin_data.csf_update_activity_locked_impl(
  uuid, uuid, uuid, uuid, jsonb, uuid, uuid
) IS
  'Owner-only activity-update implementation retained behind csf_update_activity; direct client and service-role execution is revoked.';

COMMENT ON FUNCTION plugin_data.csf_set_activity_status_locked_impl(
  uuid, uuid, text, text, uuid, uuid
) IS
  'Owner-only activity-status implementation retained behind csf_set_activity_status; direct client and service-role execution is revoked.';

COMMENT ON FUNCTION plugin_data.csf_link_activity_project_locked_impl(
  uuid, uuid, uuid, uuid, uuid
) IS
  'Owner-only activity-project implementation retained behind csf_link_activity_project; direct client and service-role execution is revoked.';

COMMENT ON FUNCTION plugin_data.csf_set_partner_club_status_locked_impl(
  uuid, uuid, text, uuid, uuid
) IS
  'Owner-only partner-club status implementation retained behind csf_set_partner_club_status; direct client and service-role execution is revoked.';

COMMIT;
