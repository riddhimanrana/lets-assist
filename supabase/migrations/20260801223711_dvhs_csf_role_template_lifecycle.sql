BEGIN;

-- Role templates are durable records. They may be retired from future use, but
-- they are never deleted because staff assignments and audit history continue
-- to refer to them.
ALTER TABLE plugin_data.csf_roles
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason text;

ALTER TABLE plugin_data.csf_roles
  DROP CONSTRAINT IF EXISTS csf_roles_archive_shape_check,
  ADD CONSTRAINT csf_roles_archive_shape_check CHECK (
    (
      archived_at IS NULL
      AND archived_by IS NULL
      AND archive_reason IS NULL
    )
    OR
    (
      archived_at IS NOT NULL
      AND is_system = false
      AND nullif(btrim(archive_reason), '') IS NOT NULL
    )
  );

CREATE INDEX IF NOT EXISTS csf_roles_org_archived_sort_idx
  ON plugin_data.csf_roles (organization_id, archived_at, sort_order, display_name);

-- One catalog is shared by both custom-role entry points and role editing. The
-- earlier six-argument creation RPC remains as a compatibility wrapper, but it
-- can no longer carry an older permission list than the current UI.
CREATE OR REPLACE FUNCTION plugin_data.csf_role_permission_catalog()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY[
    'manage_roles','manage_cohorts_terms','manage_schedule','manage_profiles',
    'review_applications','view_applications','review_application_checks',
    'decide_applications','assign_applications','write_application_notes',
    'manage_restrictions','manage_opportunities','manage_partner_clubs',
    'verify_participation','process_points','verify_submissions','manage_review_periods',
    'manage_meetings',
    'reconcile_meeting_attendance','close_term','reopen_term','edit_point_rules',
    'manage_payment_review','import_applications','import_members','import_meetings',
    'import_partner_clubs','manage_sheet_sync','resolve_imports','manage_settings',
    'export_membership_reports','export_dues_reports','export_service_reports',
    'export_club_reports','export_reports','export_sensitive_reports','view_audit_history'
  ]::text[];
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_create_custom_role(
  p_organization_id uuid,
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
  v_role_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_public_title text := nullif(btrim(coalesce(p_public_title, '')), '');
  v_responsibility_label text := nullif(btrim(coalesce(p_responsibility_label, '')), '');
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_display_name text;
  v_key text;
  v_permissions text[] := ARRAY(
    SELECT DISTINCT requested.permission_key
    FROM unnest(coalesce(p_permission_keys, ARRAY[]::text[])) AS requested(permission_key)
    ORDER BY requested.permission_key
  );
  v_catalog constant text[] := plugin_data.csf_role_permission_catalog();
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

  v_display_name := concat_ws(' — ', v_public_title, v_responsibility_label);
  v_key := left(trim(both '-' FROM regexp_replace(lower(v_display_name), '[^a-z0-9]+', '-', 'g')), 64);
  IF v_key = '' THEN
    RAISE EXCEPTION 'Use letters or numbers in the position name.';
  END IF;

  INSERT INTO plugin_data.csf_roles (
    id, organization_id, key, display_name, public_title,
    responsibility_label, description, role_type, is_system, sort_order,
    max_active_seats
  ) VALUES (
    v_role_id, p_organization_id, v_key, v_display_name, v_public_title,
    v_responsibility_label, v_description, 'custom', false, 500,
    p_max_active_seats
  );

  INSERT INTO plugin_data.csf_role_permissions (
    organization_id, role_id, permission_key, enabled
  )
  SELECT
    p_organization_id,
    v_role_id,
    permission_key,
    permission_key = ANY(v_permissions)
  FROM unnest(v_catalog) AS permission_key;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'role.create', 'csf_roles', v_role_id,
    jsonb_build_object(
      'key', v_key,
      'roleType', 'custom',
      'publicTitle', v_public_title,
      'responsibilityLabel', v_responsibility_label,
      'description', v_description,
      'maxActiveSeats', p_max_active_seats,
      'archivedAt', NULL,
      'permissions', to_jsonb(v_permissions)
    ),
    v_correlation_id, 'staff_access', v_role_id::text, 'custom_role_created'
  );

  RETURN jsonb_build_object(
    'roleId', v_role_id,
    'correlationId', v_correlation_id,
    'displayName', v_display_name
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'A CSF position with this title and responsibility already exists.';
END;
$$;

-- Keep callers deployed against the former RPC contract working while routing
-- them through the same authoritative catalog and audit path.
CREATE OR REPLACE FUNCTION plugin_data.csf_create_custom_role(
  p_organization_id uuid,
  p_public_title text,
  p_responsibility_label text,
  p_description text,
  p_permission_keys text[],
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT plugin_data.csf_create_custom_role(
    p_organization_id,
    p_public_title,
    p_responsibility_label,
    p_description,
    p_permission_keys,
    NULL::integer,
    p_actor_user_id
  );
$$;

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
  v_before_data jsonb;
  v_after_data jsonb;
  v_correlation_id uuid := gen_random_uuid();
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

CREATE OR REPLACE FUNCTION plugin_data.csf_set_role_archived(
  p_organization_id uuid,
  p_role_id uuid,
  p_archived boolean,
  p_reason text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role plugin_data.csf_roles%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_active_assignments integer := 0;
  v_before_data jsonb;
  v_after_data jsonb;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF NOT plugin_data.csf_actor_can_manage_staff(p_organization_id, p_actor_user_id) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF staff access.';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 8 OR char_length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'Explain the position change in 8 to 1000 characters.';
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
  IF v_role.is_system OR v_role.role_type <> 'custom' THEN
    RAISE EXCEPTION 'Chapter position templates cannot be archived or restored.';
  END IF;

  IF p_archived = (v_role.archived_at IS NOT NULL) THEN
    RETURN jsonb_build_object(
      'roleId', p_role_id,
      'changed', false,
      'archived', p_archived
    );
  END IF;

  SELECT count(*)::integer
  INTO v_active_assignments
  FROM plugin_data.csf_staff_positions AS position
  WHERE position.organization_id = p_organization_id
    AND position.role_id = p_role_id
    AND position.status = 'active';
  IF p_archived AND v_active_assignments > 0 THEN
    RAISE EXCEPTION
      'Revoke all % active assignment(s) before archiving this CSF position.',
      v_active_assignments;
  END IF;

  v_before_data := jsonb_build_object(
    'key', v_role.key,
    'roleType', v_role.role_type,
    'isSystem', v_role.is_system,
    'publicTitle', v_role.public_title,
    'responsibilityLabel', v_role.responsibility_label,
    'description', v_role.description,
    'maxActiveSeats', v_role.max_active_seats,
    'archivedAt', v_role.archived_at,
    'archiveReason', v_role.archive_reason
  );

  UPDATE plugin_data.csf_roles
  SET
    archived_at = CASE WHEN p_archived THEN now() ELSE NULL END,
    archived_by = CASE WHEN p_archived THEN p_actor_user_id ELSE NULL END,
    archive_reason = CASE WHEN p_archived THEN v_reason ELSE NULL END,
    updated_at = now()
  WHERE organization_id = p_organization_id
    AND id = p_role_id
  RETURNING * INTO v_role;

  v_after_data := jsonb_build_object(
    'key', v_role.key,
    'roleType', v_role.role_type,
    'isSystem', v_role.is_system,
    'publicTitle', v_role.public_title,
    'responsibilityLabel', v_role.responsibility_label,
    'description', v_role.description,
    'maxActiveSeats', v_role.max_active_seats,
    'archivedAt', v_role.archived_at,
    'archiveReason', v_role.archive_reason,
    'changeReason', v_reason
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    CASE WHEN p_archived THEN 'role.archive' ELSE 'role.restore' END,
    'csf_roles',
    p_role_id,
    v_before_data,
    v_after_data,
    v_correlation_id,
    'staff_access',
    p_role_id::text,
    CASE WHEN p_archived THEN 'custom_role_archived' ELSE 'custom_role_restored' END
  );

  RETURN jsonb_build_object(
    'roleId', p_role_id,
    'correlationId', v_correlation_id,
    'changed', true,
    'archived', p_archived
  );
END;
$$;

-- Any path that activates a staff assignment must share-lock its role first.
-- Role edits/archive operations take a row update lock, so assignment and
-- lifecycle decisions cannot race past each other.
CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_assignable_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_archived_at timestamptz;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  SELECT role.archived_at
  INTO v_archived_at
  FROM plugin_data.csf_roles AS role
  WHERE role.organization_id = NEW.organization_id
    AND role.id = NEW.role_id
  FOR SHARE;
  IF NOT FOUND THEN
    -- Preserve the table's tenant-aware foreign-key contract and SQLSTATE for
    -- missing or cross-tenant role IDs. The trigger only adds lifecycle logic.
    RETURN NEW;
  END IF;
  IF v_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Archived CSF positions cannot receive staff assignments.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS csf_staff_positions_assignable_role_trigger
  ON plugin_data.csf_staff_positions;
CREATE TRIGGER csf_staff_positions_assignable_role_trigger
BEFORE INSERT OR UPDATE OF organization_id, role_id, status
ON plugin_data.csf_staff_positions
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_enforce_assignable_role();

-- Retain unsupported custom-role rows for provenance, but never keep an old
-- capability enabled merely because an earlier RPC knew a different catalog.
UPDATE plugin_data.csf_role_permissions AS permission
SET enabled = false, updated_at = now()
FROM plugin_data.csf_roles AS role
WHERE permission.organization_id = role.organization_id
  AND permission.role_id = role.id
  AND role.role_type = 'custom'
  AND permission.enabled = true
  AND NOT (permission.permission_key = ANY(plugin_data.csf_role_permission_catalog()));

REVOKE ALL ON FUNCTION plugin_data.csf_role_permission_catalog()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_create_custom_role(uuid, text, text, text, text[], integer, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_create_custom_role(uuid, text, text, text, text[], uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_update_role(uuid, uuid, text, text, text, text[], integer, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_set_role_archived(uuid, uuid, boolean, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_enforce_assignable_role()
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION plugin_data.csf_create_custom_role(uuid, text, text, text, text[], integer, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_custom_role(uuid, text, text, text, text[], uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_update_role(uuid, uuid, text, text, text, text[], integer, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_role_archived(uuid, uuid, boolean, text, uuid)
  TO service_role;

COMMENT ON COLUMN plugin_data.csf_roles.archived_at IS
  'When set, this custom role remains visible for history but cannot receive new active assignments.';
COMMENT ON FUNCTION plugin_data.csf_update_role(uuid, uuid, text, text, text, text[], integer, uuid) IS
  'Server-only, tenant-scoped and audited role-template edit. Immutable role key/type/system identity is never accepted as input.';
COMMENT ON FUNCTION plugin_data.csf_set_role_archived(uuid, uuid, boolean, text, uuid) IS
  'Server-only reversible custom-role archive/restore. System roles and roles with active assignments cannot be archived.';

COMMIT;
