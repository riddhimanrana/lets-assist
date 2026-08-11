-- Keep at least one account able to manage CSF staff access in every chapter.
--
-- Two separate paths could strand a chapter with nobody able to reach Staff
-- access, so nobody could restore any permission from inside the product:
--
--   1. `csf_revoke_staff_position` ended any active position, including the
--      last seat that still carried `manage_roles`.
--   2. `csf_update_role` rewrote a role's permission set wholesale. Clearing
--      `manage_roles` on the only role whose active seats still held it
--      removed the same recovery access without ending a single assignment.
--
-- Section 8.19 of the product contract states that the last active
-- adviser/owner cannot remove their own recovery access. Recovery access is a
-- capability, not a role name: a chapter that moved `manage_roles` onto a
-- custom position is recoverable through that position, and a chapter whose
-- adviser role lost `manage_roles` is not recoverable through the adviser. So
-- the floor below is expressed as the capability predicate that
-- `csf_actor_can_manage_staff` actually evaluates, not as a hard-coded
-- owner/adviser role-key list.
--
-- Nothing about authorization, the reason requirement, host-membership
-- restoration, seat-limit validation, immutable history, or the audit receipts
-- changes. Both functions gain the same organization-serialized floor check
-- and the same deterministic lock order: one shared advisory organization
-- lock, then the row lock, then the recovery evaluation. Sharing the lock key
-- is what makes the two paths safe against each other; a revoke and a
-- permission strip that each removed the last two recovery seats would
-- otherwise each observe the other's seat as still recovery-capable.

BEGIN;

-- One key for every staff-access mutation in an organization. Both
-- `csf_revoke_staff_position` and `csf_update_role` take this exact key, so a
-- concurrent revoke and role edit serialize against each other.
CREATE OR REPLACE FUNCTION plugin_data.csf_staff_access_lock_key(
  p_organization_id uuid
)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.hashtextextended(
    'plugin_data.csf_staff_access:' || p_organization_id::text,
    0
  );
$$;

-- Recovery capability is the ability to reach Staff access and re-grant
-- permissions. That is exactly an active, currently effective seat, held by a
-- real account, on a role that is not archived and still has `manage_roles`
-- enabled. The predicate mirrors the staff-seat branch of
-- `csf_actor_can_manage_staff` so the floor counts seats that can actually
-- recover the chapter today; a seat whose `starts_at` is still in the future
-- cannot, and is deliberately not counted until it becomes effective.
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
    AND (position.starts_at IS NULL OR position.starts_at <= (pg_catalog.now() AT TIME ZONE 'America/Los_Angeles')::date)
    AND (position.ends_at IS NULL OR position.ends_at >= (pg_catalog.now() AT TIME ZONE 'America/Los_Angeles')::date);
$$;

CREATE INDEX IF NOT EXISTS csf_staff_positions_org_role_active_idx
  ON plugin_data.csf_staff_positions (organization_id, role_id, status, starts_at, ends_at)
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION plugin_data.csf_revoke_staff_position(
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
DECLARE
  v_position plugin_data.csf_staff_positions%ROWTYPE;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_effective_end_date date := coalesce(p_effective_end_date, (pg_catalog.now() AT TIME ZONE 'America/Los_Angeles')::date);
  v_correlation_id uuid := pg_catalog.gen_random_uuid();
  v_restored_host_role text;
  v_recovery_seats_before integer;
  v_remaining_recovery_seats integer;
  v_recovery_floor_message constant text :=
    'This is the last active position that can still manage CSF staff access. Give another active position the Staff access capability, or assign someone to a position that already has it, before ending this one.';
BEGIN
  IF NOT plugin_data.csf_actor_can_manage_staff(p_organization_id, p_actor_user_id) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF staff access.';
  END IF;
  IF v_reason IS NULL OR pg_catalog.length(v_reason) < 8 THEN
    RAISE EXCEPTION 'Explain the revocation in at least 8 characters.';
  END IF;

  -- Serialize every staff-access mutation in this organization before touching
  -- any row. Two concurrent revocations of the two remaining recovery seats
  -- would each lock a different position row and each still observe the other
  -- as active; a concurrent `csf_update_role` that strips `manage_roles` would
  -- be invisible for the same reason.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  SELECT position.*
  INTO v_position
  FROM plugin_data.csf_staff_positions AS position
  WHERE position.organization_id = p_organization_id
    AND position.id = p_staff_position_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF staff position not found.';
  END IF;
  IF v_position.status <> 'active' THEN
    RAISE EXCEPTION 'Only an active CSF staff position can be revoked.';
  END IF;
  IF v_position.starts_at IS NOT NULL AND v_effective_end_date < v_position.starts_at THEN
    RAISE EXCEPTION 'Revocation date cannot be before the position start date.';
  END IF;

  v_recovery_seats_before :=
    plugin_data.csf_count_recovery_staff_seats(p_organization_id, NULL);
  v_remaining_recovery_seats :=
    plugin_data.csf_count_recovery_staff_seats(p_organization_id, v_position.id);
  -- Only an actual recovery seat can breach the floor. Ending a Treasurer or
  -- Secretary seat is unaffected, and so is ending one of two recovery seats.
  -- A chapter that already has no recovery seat is not made worse by this
  -- revocation, so it is not blocked here either.
  IF v_recovery_seats_before > v_remaining_recovery_seats
     AND v_remaining_recovery_seats < 1 THEN
    RAISE EXCEPTION USING
      MESSAGE = v_recovery_floor_message,
      ERRCODE = '23514';
  END IF;

  UPDATE plugin_data.csf_staff_positions
  SET
    status = 'ended',
    ends_at = v_effective_end_date,
    revoked_at = pg_catalog.now(),
    revoked_by = p_actor_user_id,
    revocation_reason = v_reason,
    updated_at = pg_catalog.now()
  WHERE id = v_position.id;

  -- Defense in depth. The check above is derived from pre-write state; this one
  -- re-derives the floor from what the transaction has actually written, so a
  -- future change to the update above cannot silently drain the chapter. A
  -- chapter that entered this call with no recovery seat is left as it was.
  IF v_recovery_seats_before >= 1
     AND plugin_data.csf_count_recovery_staff_seats(p_organization_id, NULL) < 1 THEN
    RAISE EXCEPTION USING
      MESSAGE = v_recovery_floor_message,
      ERRCODE = '23514';
  END IF;

  IF v_position.user_id IS NOT NULL
     AND v_position.host_membership_managed
     AND NOT EXISTS (
       SELECT 1
       FROM plugin_data.csf_staff_positions AS remaining
       WHERE remaining.organization_id = p_organization_id
         AND remaining.user_id = v_position.user_id
         AND remaining.id <> v_position.id
         AND remaining.status = 'active'
     ) THEN
    v_restored_host_role := coalesce(v_position.host_membership_previous_role, 'member');
    UPDATE public.organization_members
    SET role = CASE WHEN role = 'admin' THEN 'admin' ELSE v_restored_host_role END
    WHERE organization_id = p_organization_id
      AND user_id = v_position.user_id;
  END IF;

  INSERT INTO plugin_data.csf_staff_position_history (
    organization_id, staff_position_id, actor_user_id, action,
    before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, v_position.id, p_actor_user_id, 'revoke',
    pg_catalog.jsonb_build_object(
      'status', v_position.status,
      'endsAt', v_position.ends_at
    ),
    pg_catalog.jsonb_build_object(
      'status', 'ended',
      'endsAt', v_effective_end_date,
      'reason', v_reason,
      'restoredHostRole', v_restored_host_role
    ),
    v_correlation_id, 'position_revoked'
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'staff_position.revoke',
    'csf_staff_positions', v_position.id,
    pg_catalog.jsonb_build_object('status', v_position.status, 'endsAt', v_position.ends_at),
    pg_catalog.jsonb_build_object(
      'status', 'ended',
      'endsAt', v_effective_end_date,
      'reason', v_reason,
      'restoredHostRole', v_restored_host_role
    ),
    v_correlation_id, 'staff_access', v_position.id::text, 'position_revoked'
  );

  RETURN pg_catalog.jsonb_build_object(
    'positionId', v_position.id,
    'correlationId', v_correlation_id,
    'hostRole', v_restored_host_role
  );
END;
$$;

-- Faithful replacement of the `20260801223711_dvhs_csf_role_template_lifecycle`
-- definition. Signature, authorization, validation order, immutable
-- key/type/system identity, seat-limit rule, catalog upsert, legacy-permission
-- disable, before/after audit shape, reason code, and return value are
-- unchanged. The additions are the shared organization lock and the
-- post-rewrite recovery-floor proof.
CREATE OR REPLACE FUNCTION plugin_data.csf_update_role(
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
DECLARE
  v_role plugin_data.csf_roles%ROWTYPE;
  v_public_title text := nullif(btrim(coalesce(p_public_title, '')), '');
  v_responsibility_label text := nullif(btrim(coalesce(p_responsibility_label, '')), '');
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_display_name text;
  v_permissions text[] := ARRAY(
    SELECT DISTINCT requested.permission_key
    FROM unnest(coalesce(p_permission_keys, ARRAY[]::text[])) AS requested(permission_key)
    ORDER BY requested.permission_key
  );
  v_catalog constant text[] := plugin_data.csf_role_permission_catalog();
  v_active_occupancy integer := 0;
  v_recovery_seats_before integer;
  v_before_data jsonb;
  v_after_data jsonb;
  v_correlation_id uuid := gen_random_uuid();
  v_recovery_floor_message constant text :=
    'This change would leave no active position able to manage CSF staff access. Keep the Staff access capability on at least one position that has a currently effective active assignment.';
BEGIN
  IF NOT plugin_data.csf_actor_can_manage_staff(p_organization_id, p_actor_user_id) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF staff access.';
  END IF;
  IF v_public_title IS NULL THEN
    RAISE EXCEPTION 'Public title is required.';
  END IF;
  IF char_length(v_public_title) > 120
    OR char_length(coalesce(v_responsibility_label, '')) > 120
    OR char_length(coalesce(v_description, '')) > 2000 THEN
    RAISE EXCEPTION 'CSF position details are too long.';
  END IF;
  IF p_max_active_seats IS NOT NULL
    AND (p_max_active_seats < 1 OR p_max_active_seats > 100) THEN
    RAISE EXCEPTION 'Seat limit must be between 1 and 100, or left blank.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(v_permissions) AS requested(permission_key)
    WHERE requested.permission_key IS NULL
      OR NOT (requested.permission_key = ANY(v_catalog))
  ) THEN
    RAISE EXCEPTION 'One or more CSF permissions are invalid.';
  END IF;

  -- Same key as `csf_revoke_staff_position`, taken before the role row lock.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  SELECT role.*
  INTO v_role
  FROM plugin_data.csf_roles AS role
  WHERE role.organization_id = p_organization_id
    AND role.id = p_role_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF position template not found.';
  END IF;

  SELECT coalesce(max(occupancy.active_count), 0)::integer
  INTO v_active_occupancy
  FROM (
    SELECT count(*)::integer AS active_count
    FROM plugin_data.csf_staff_positions AS position
    WHERE position.organization_id = p_organization_id
      AND position.role_id = p_role_id
      AND position.status = 'active'
    GROUP BY position.school_year
  ) AS occupancy;
  IF p_max_active_seats IS NOT NULL AND p_max_active_seats < v_active_occupancy THEN
    RAISE EXCEPTION
      'Seat limit cannot be lower than the % active assignment(s) in an existing school year.',
      v_active_occupancy;
  END IF;

  v_recovery_seats_before :=
    plugin_data.csf_count_recovery_staff_seats(p_organization_id, NULL);

  v_before_data := jsonb_build_object(
    'key', v_role.key,
    'roleType', v_role.role_type,
    'isSystem', v_role.is_system,
    'publicTitle', v_role.public_title,
    'responsibilityLabel', v_role.responsibility_label,
    'description', v_role.description,
    'maxActiveSeats', v_role.max_active_seats,
    'archivedAt', v_role.archived_at,
    'permissions', to_jsonb(ARRAY(
      SELECT permission.permission_key
      FROM plugin_data.csf_role_permissions AS permission
      WHERE permission.organization_id = p_organization_id
        AND permission.role_id = p_role_id
        AND permission.enabled = true
      ORDER BY permission.permission_key
    ))
  );

  v_display_name := concat_ws(' — ', v_public_title, v_responsibility_label);
  UPDATE plugin_data.csf_roles
  SET
    display_name = v_display_name,
    public_title = v_public_title,
    responsibility_label = v_responsibility_label,
    description = v_description,
    max_active_seats = p_max_active_seats,
    updated_at = now()
  WHERE organization_id = p_organization_id
    AND id = p_role_id
  RETURNING * INTO v_role;

  INSERT INTO plugin_data.csf_role_permissions (
    organization_id, role_id, permission_key, enabled, updated_at
  )
  SELECT
    p_organization_id,
    p_role_id,
    permission_key,
    permission_key = ANY(v_permissions),
    now()
  FROM unnest(v_catalog) AS permission_key
  ON CONFLICT (role_id, permission_key) DO UPDATE
  SET
    organization_id = EXCLUDED.organization_id,
    enabled = EXCLUDED.enabled,
    updated_at = EXCLUDED.updated_at;

  -- Unsupported legacy permission rows remain as provenance, but can never be
  -- an active grant after the role is edited.
  UPDATE plugin_data.csf_role_permissions
  SET enabled = false, updated_at = now()
  WHERE organization_id = p_organization_id
    AND role_id = p_role_id
    AND enabled = true
    AND NOT (permission_key = ANY(v_catalog));

  -- The rewrite is committed to this transaction, so the floor is proved
  -- against the permissions the chapter would actually keep, not against the
  -- requested array. A chapter that had no recovery seat before this edit is
  -- not blocked from editing an unrelated role.
  IF v_recovery_seats_before >= 1
     AND plugin_data.csf_count_recovery_staff_seats(p_organization_id, NULL) < 1 THEN
    RAISE EXCEPTION USING
      MESSAGE = v_recovery_floor_message,
      ERRCODE = '23514';
  END IF;

  v_after_data := jsonb_build_object(
    'key', v_role.key,
    'roleType', v_role.role_type,
    'isSystem', v_role.is_system,
    'publicTitle', v_role.public_title,
    'responsibilityLabel', v_role.responsibility_label,
    'description', v_role.description,
    'maxActiveSeats', v_role.max_active_seats,
    'archivedAt', v_role.archived_at,
    'permissions', to_jsonb(v_permissions)
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'role.update', 'csf_roles', p_role_id,
    v_before_data, v_after_data, v_correlation_id,
    'staff_access', p_role_id::text, 'role_template_updated'
  );

  RETURN jsonb_build_object(
    'roleId', p_role_id,
    'correlationId', v_correlation_id,
    'displayName', v_display_name,
    'activeOccupancy', v_active_occupancy
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_staff_access_lock_key(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_count_recovery_staff_seats(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_revoke_staff_position(uuid, uuid, date, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_update_role(uuid, uuid, text, text, text, text[], integer, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_staff_access_lock_key(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_count_recovery_staff_seats(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_revoke_staff_position(uuid, uuid, date, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_update_role(uuid, uuid, text, text, text, text[], integer, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_staff_access_lock_key(uuid) IS
  'Advisory transaction lock key shared by every CSF staff-access mutation in one organization, so revoke and role-permission edits serialize against each other.';
COMMENT ON FUNCTION plugin_data.csf_count_recovery_staff_seats(uuid, uuid) IS
  'Counts active, currently effective CSF seats held by a real account on an unarchived role that still has manage_roles enabled, optionally excluding one position. Future-dated seats are excluded until effective.';
COMMENT ON FUNCTION plugin_data.csf_revoke_staff_position(uuid, uuid, date, text, uuid) IS
  'Atomically revokes a CSF position with a reason, refuses to remove the last seat that can still manage CSF staff access under the shared organization lock, restores CSF-managed host membership when safe, and writes immutable history plus audit.';
COMMENT ON FUNCTION plugin_data.csf_update_role(uuid, uuid, text, text, text, text[], integer, uuid) IS
  'Server-only, tenant-scoped and audited role-template edit. Immutable role key/type/system identity is never accepted as input. Under the shared organization lock, the rewritten permission set must leave at least one currently effective active seat able to manage CSF staff access.';

COMMIT;
