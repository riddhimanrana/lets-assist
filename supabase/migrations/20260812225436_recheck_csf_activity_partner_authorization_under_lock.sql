-- AUD-036: close the whole CSF activity and partner-club authority class.
--
-- A staff-only actor could pass an activity or partner-club permission check,
-- wait behind a later request, business, or row lock, and then commit after a
-- concurrent role edit, staff-position revocation, or membership deactivation
-- removed that permission. Five activity/partner transactions and two further
-- transactions carrying the same `manage_partner_clubs` authority
-- (`csf_set_partner_club_term_status` and `csf_upsert_partner_club_policy`)
-- shared the defect; the latter two also serialized only on their own
-- per-club-term or per-organization advisory keys, so neither ordered against
-- staff-access mutations at all.
--
-- Keep the seven existing transactions byte-for-byte intact behind owner-only
-- implementations and put the stable service signatures behind one identical
-- wrapper. The wrapper's lock order is the same for all seven: authorization
-- first, the shared organization staff-access lock second, the actor's active
-- host membership row `FOR SHARE` third, the authorization recheck fourth, and
-- only then the implementation's own request and business locks.
--
-- Intentional behavior change: an exact committed request replayed by an actor
-- who has since lost the permission is denied instead of returning the prior
-- idempotent receipt. Replay lookup happens inside the implementation, so it is
-- now unreachable without current authority. The committed outcome is durable
-- and untouched; only the ability to re-read it through this boundary is lost.

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

ALTER FUNCTION plugin_data.csf_set_partner_club_term_status(
  uuid, uuid, text, text, uuid, uuid
)
RENAME TO csf_set_partner_club_term_status_locked_impl;

ALTER FUNCTION plugin_data.csf_upsert_partner_club_policy(
  uuid, uuid, uuid, jsonb
)
RENAME TO csf_upsert_partner_club_policy_locked_impl;

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

REVOKE ALL ON FUNCTION plugin_data.csf_set_partner_club_term_status_locked_impl(
  uuid, uuid, text, text, uuid, uuid
)
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_upsert_partner_club_policy_locked_impl(
  uuid, uuid, uuid, jsonb
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
  -- Preserve the auth-first boundary before inspecting caller-controlled input.
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

  -- Hold the host membership row so it cannot be deactivated or deleted
  -- between the recheck below and this transaction's commit.
  SELECT member.user_id
  INTO v_actor_membership_user_id
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
    AND member.status = 'active'
  FOR SHARE;

  IF NOT FOUND OR v_actor_membership_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;

  -- Authorization is mutable state. Re-read it only after this request owns
  -- the shared staff-access lock and the actor's membership row.
  IF plugin_data.csf_actor_has_permission(
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

  IF NOT FOUND OR v_actor_membership_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;

  IF plugin_data.csf_actor_has_permission(
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

  IF NOT FOUND OR v_actor_membership_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;

  IF plugin_data.csf_actor_has_permission(
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

  IF NOT FOUND OR v_actor_membership_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;

  IF plugin_data.csf_actor_has_permission(
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

  IF NOT FOUND OR v_actor_membership_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;

  IF plugin_data.csf_actor_has_permission(
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

CREATE FUNCTION plugin_data.csf_set_partner_club_term_status(
  p_organization_id uuid,
  p_partner_club_term_id uuid,
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

  -- The implementation's per-club-term advisory key does not order against
  -- staff-access mutations. Take the shared organization lock first so this
  -- transaction uses the same order as every other CSF staff-authority write.
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

  IF NOT FOUND OR v_actor_membership_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;

  IF plugin_data.csf_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    'manage_partner_clubs'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;

  RETURN plugin_data.csf_set_partner_club_term_status_locked_impl(
    p_organization_id,
    p_partner_club_term_id,
    p_status,
    p_reason,
    p_actor_user_id,
    p_correlation_id
  );
END;
$$;

CREATE FUNCTION plugin_data.csf_upsert_partner_club_policy(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_request jsonb
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

  -- The implementation's per-organization policy key does not order against
  -- staff-access mutations either. Same lock order as the other six.
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

  IF NOT FOUND OR v_actor_membership_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;

  IF plugin_data.csf_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    'manage_partner_clubs'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;

  RETURN plugin_data.csf_upsert_partner_club_policy_locked_impl(
    p_organization_id,
    p_actor_user_id,
    p_request_id,
    p_request
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

REVOKE ALL ON FUNCTION plugin_data.csf_set_partner_club_term_status(
  uuid, uuid, text, text, uuid, uuid
)
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_upsert_partner_club_policy(
  uuid, uuid, uuid, jsonb
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

GRANT EXECUTE ON FUNCTION plugin_data.csf_set_partner_club_term_status(
  uuid, uuid, text, text, uuid, uuid
)
TO service_role;

GRANT EXECUTE ON FUNCTION plugin_data.csf_upsert_partner_club_policy(
  uuid, uuid, uuid, jsonb
)
TO service_role;

COMMENT ON FUNCTION plugin_data.csf_create_activity(
  uuid, uuid, uuid, jsonb, uuid, uuid
) IS
  'Server-only creation of one tenant-scoped CSF activity and immutable replay receipt. Authorization is checked before input processing and rechecked after the organization staff-access lock and the actor active-membership share lock.';

COMMENT ON FUNCTION plugin_data.csf_update_activity(
  uuid, uuid, uuid, uuid, jsonb, uuid, uuid
) IS
  'Server-only update of one tenant-scoped CSF activity and immutable replay receipt. Authorization is checked before input processing and rechecked after the organization staff-access lock and the actor active-membership share lock.';

COMMENT ON FUNCTION plugin_data.csf_set_activity_status(
  uuid, uuid, text, text, uuid, uuid
) IS
  'Server-only transition of one tenant-scoped CSF activity with its replay-safe audit receipt. Authorization is checked before input processing and rechecked after the organization staff-access lock and the actor active-membership share lock.';

COMMENT ON FUNCTION plugin_data.csf_link_activity_project(
  uuid, uuid, uuid, uuid, uuid
) IS
  'Server-only link of an exact-tenant activity and public project with atomic audit. Authorization is checked before input processing and rechecked after the organization staff-access lock and the actor active-membership share lock.';

COMMENT ON FUNCTION plugin_data.csf_set_partner_club_status(
  uuid, uuid, text, uuid, uuid
) IS
  'Server-only archive, deactivation, or restoration of one tenant-scoped partner club with replay-safe atomic audit. Authorization is checked before input processing and rechecked after the organization staff-access lock and the actor active-membership share lock.';

COMMENT ON FUNCTION plugin_data.csf_set_partner_club_term_status(
  uuid, uuid, text, text, uuid, uuid
) IS
  'Server-only, replay-safe partner-club semester standing transition whose current projection, immutable lifecycle receipt, and staff audit commit atomically. Authorization is checked before input processing and rechecked after the organization staff-access lock and the actor active-membership share lock.';

COMMENT ON FUNCTION plugin_data.csf_upsert_partner_club_policy(
  uuid, uuid, uuid, jsonb
) IS
  'Server-only, replay-safe partner-club policy review that atomically commits canonical club identity, aliases, source facts, current term policy, immutable lifecycle history, and staff audit. Authorization is checked before input processing and rechecked after the organization staff-access lock and the actor active-membership share lock.';

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

COMMENT ON FUNCTION plugin_data.csf_set_partner_club_term_status_locked_impl(
  uuid, uuid, text, text, uuid, uuid
) IS
  'Owner-only partner-club standing implementation retained behind csf_set_partner_club_term_status; direct client and service-role execution is revoked.';

COMMENT ON FUNCTION plugin_data.csf_upsert_partner_club_policy_locked_impl(
  uuid, uuid, uuid, jsonb
) IS
  'Owner-only partner-club policy implementation retained behind csf_upsert_partner_club_policy; direct client and service-role execution is revoked.';

COMMIT;
