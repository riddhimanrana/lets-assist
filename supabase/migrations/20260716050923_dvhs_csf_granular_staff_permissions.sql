BEGIN;

-- Preserve the first staff-access installer as an internal implementation,
-- then layer the newly separated schedule and attendance capabilities over it.
-- Keeping this as a follow-up migration avoids changing a migration that has
-- already been replayed in local development.
ALTER FUNCTION plugin_data.csf_install_default_roles(uuid)
  RENAME TO csf_install_default_roles_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_install_default_roles(
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_base_result jsonb;
  v_permission_count integer;
BEGIN
  v_base_result := plugin_data.csf_install_default_roles_base(p_organization_id);

  INSERT INTO plugin_data.csf_role_permissions (
    organization_id,
    role_id,
    permission_key,
    enabled,
    updated_at
  )
  SELECT
    p_organization_id,
    role.id,
    permission.permission_key,
    CASE permission.permission_key
      WHEN 'manage_schedule' THEN role.key IN ('owner', 'advisor', 'co-president', 'secretary')
      WHEN 'reconcile_meeting_attendance' THEN role.key IN (
        'owner', 'advisor', 'co-president', 'vice-president-membership',
        'secretary', 'data-management'
      )
      ELSE false
    END,
    now()
  FROM plugin_data.csf_roles AS role
  CROSS JOIN (
    VALUES ('manage_schedule'), ('reconcile_meeting_attendance')
  ) AS permission(permission_key)
  WHERE role.organization_id = p_organization_id
    AND role.key IN (
      'owner', 'advisor', 'co-president', 'vice-president-membership',
      'vice-president-publicity', 'vice-president-clubs', 'treasurer',
      'secretary', 'web-master', 'activity-coordinator', 'data-management'
    )
  ON CONFLICT (role_id, permission_key) DO UPDATE
  SET
    organization_id = EXCLUDED.organization_id,
    enabled = EXCLUDED.enabled,
    updated_at = now();

  -- Schedule ownership does not grant class/semester administration.
  UPDATE plugin_data.csf_role_permissions AS permission
  SET enabled = false, updated_at = now()
  FROM plugin_data.csf_roles AS role
  WHERE permission.organization_id = p_organization_id
    AND permission.role_id = role.id
    AND role.organization_id = p_organization_id
    AND role.key = 'secretary'
    AND permission.permission_key = 'manage_cohorts_terms';

  SELECT count(*)::integer
  INTO v_permission_count
  FROM plugin_data.csf_role_permissions
  WHERE organization_id = p_organization_id;

  RETURN jsonb_build_object(
    'roleCount', coalesce((v_base_result ->> 'roleCount')::integer, 0),
    'permissionCount', v_permission_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_create_custom_role(
  p_organization_id uuid,
  p_public_title text,
  p_responsibility_label text,
  p_description text,
  p_permission_keys text[],
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
  v_display_name text;
  v_key text;
  v_permissions text[] := coalesce(p_permission_keys, ARRAY[]::text[]);
  v_catalog constant text[] := ARRAY[
    'manage_roles','manage_cohorts_terms','manage_schedule','manage_profiles',
    'review_applications','view_applications','review_application_checks',
    'decide_applications','assign_applications','write_application_notes',
    'manage_restrictions','manage_opportunities','manage_partner_clubs',
    'verify_participation','process_points','verify_submissions','manage_meetings',
    'reconcile_meeting_attendance','close_term','reopen_term','edit_point_rules',
    'manage_payment_review','manage_sheet_sync','resolve_imports','manage_settings',
    'export_reports','export_sensitive_reports','view_audit_history'
  ];
BEGIN
  IF NOT plugin_data.csf_actor_can_manage_staff(p_organization_id, p_actor_user_id) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF staff access.';
  END IF;
  IF v_public_title IS NULL THEN
    RAISE EXCEPTION 'Public title is required.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_permissions) AS requested(permission_key)
    WHERE NOT (requested.permission_key = ANY(v_catalog))
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
    responsibility_label, description, role_type, is_system, sort_order
  ) VALUES (
    v_role_id, p_organization_id, v_key, v_display_name, v_public_title,
    v_responsibility_label, nullif(btrim(coalesce(p_description, '')), ''),
    'custom', false, 500
  );

  INSERT INTO plugin_data.csf_role_permissions (
    organization_id, role_id, permission_key, enabled
  )
  SELECT p_organization_id, v_role_id, permission_key, true
  FROM unnest(ARRAY(SELECT DISTINCT unnest(v_permissions))) AS permission_key;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'role.create', 'csf_roles', v_role_id,
    jsonb_build_object(
      'publicTitle', v_public_title,
      'responsibilityLabel', v_responsibility_label,
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

DO $$
DECLARE
  v_organization_id uuid;
BEGIN
  FOR v_organization_id IN
    SELECT DISTINCT organization_id
    FROM plugin_data.csf_roles
  LOOP
    PERFORM plugin_data.csf_install_default_roles(v_organization_id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_install_default_roles_base(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_install_default_roles(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_create_custom_role(uuid, text, text, text, text[], uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_install_default_roles(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_custom_role(uuid, text, text, text, text[], uuid) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_install_default_roles(uuid) IS
  'Installs the canonical CSF positions and their granular permission matrix idempotently.';
COMMENT ON FUNCTION plugin_data.csf_install_default_roles_base(uuid) IS
  'Internal base installer retained for migration-safe composition; not executable by API roles.';

COMMIT;
