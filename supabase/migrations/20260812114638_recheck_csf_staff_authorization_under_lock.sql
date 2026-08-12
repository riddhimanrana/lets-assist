-- A staff-only actor could pass the authorization predicate, wait behind the
-- organization staff-access lock, and then continue after a concurrent role
-- edit or position revocation removed the capability. Keep the established
-- business logic intact behind owner-only implementations and put the stable
-- RPC signatures behind lock-then-reauthorize wrappers.

BEGIN;

ALTER FUNCTION plugin_data.csf_revoke_staff_position(
  uuid, uuid, date, text, uuid
)
RENAME TO csf_revoke_staff_position_locked_impl;

ALTER FUNCTION plugin_data.csf_update_role(
  uuid, uuid, text, text, text, text[], integer, uuid
)
RENAME TO csf_update_role_locked_impl;

REVOKE ALL ON FUNCTION plugin_data.csf_revoke_staff_position_locked_impl(
  uuid, uuid, date, text, uuid
)
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_update_role_locked_impl(
  uuid, uuid, text, text, text, text[], integer, uuid
)
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION plugin_data.csf_revoke_staff_position(
  p_organization_id uuid,
  p_staff_position_id uuid,
  p_effective_end_date date,
  p_reason text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Preserve the auth-first boundary before inspecting caller-controlled
  -- mutation input.
  IF NOT plugin_data.csf_actor_can_manage_staff(
    p_organization_id,
    p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF staff access.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  -- Authorization is mutable state. Re-read it only after this request owns
  -- the lock shared by staff-position revocation and role-permission edits.
  IF NOT plugin_data.csf_actor_can_manage_staff(
    p_organization_id,
    p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF staff access.';
  END IF;

  RETURN plugin_data.csf_revoke_staff_position_locked_impl(
    p_organization_id,
    p_staff_position_id,
    p_effective_end_date,
    p_reason,
    p_actor_user_id
  );
END;
$$;

CREATE FUNCTION plugin_data.csf_update_role(
  p_organization_id uuid,
  p_role_id uuid,
  p_public_title text,
  p_responsibility_label text,
  p_description text,
  p_permission_keys text[],
  p_max_active_seats integer,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Preserve the auth-first boundary before inspecting caller-controlled
  -- mutation input.
  IF NOT plugin_data.csf_actor_can_manage_staff(
    p_organization_id,
    p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF staff access.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  IF NOT plugin_data.csf_actor_can_manage_staff(
    p_organization_id,
    p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF staff access.';
  END IF;

  RETURN plugin_data.csf_update_role_locked_impl(
    p_organization_id,
    p_role_id,
    p_public_title,
    p_responsibility_label,
    p_description,
    p_permission_keys,
    p_max_active_seats,
    p_actor_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_revoke_staff_position(
  uuid, uuid, date, text, uuid
)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION plugin_data.csf_update_role(
  uuid, uuid, text, text, text, text[], integer, uuid
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_revoke_staff_position(
  uuid, uuid, date, text, uuid
)
TO service_role;

GRANT EXECUTE ON FUNCTION plugin_data.csf_update_role(
  uuid, uuid, text, text, text, text[], integer, uuid
)
TO service_role;

COMMENT ON FUNCTION plugin_data.csf_revoke_staff_position(
  uuid, uuid, date, text, uuid
) IS
  'Server-only staff-position revocation. Authorization is checked before input processing and rechecked after acquiring the organization staff-access lock.';

COMMENT ON FUNCTION plugin_data.csf_update_role(
  uuid, uuid, text, text, text, text[], integer, uuid
) IS
  'Server-only role-template edit. Authorization is checked before input processing and rechecked after acquiring the organization staff-access lock.';

COMMENT ON FUNCTION plugin_data.csf_revoke_staff_position_locked_impl(
  uuid, uuid, date, text, uuid
) IS
  'Owner-only implementation retained behind csf_revoke_staff_position; direct client and service-role execution is revoked.';

COMMENT ON FUNCTION plugin_data.csf_update_role_locked_impl(
  uuid, uuid, text, text, text, text[], integer, uuid
) IS
  'Owner-only implementation retained behind csf_update_role; direct client and service-role execution is revoked.';

COMMIT;
