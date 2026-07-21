BEGIN;

ALTER FUNCTION plugin_data.csf_install_default_roles(uuid)
  RENAME TO csf_install_default_roles_granular_base;

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
  v_base_result := plugin_data.csf_install_default_roles_granular_base(p_organization_id);

  -- Earlier CSF prototypes stored capabilities that no longer map to a route
  -- or Server Action. Keep their rows for provenance, but never grant them.
  UPDATE plugin_data.csf_role_permissions AS permission
  SET enabled = false, updated_at = now()
  FROM plugin_data.csf_roles AS role
  WHERE permission.organization_id = p_organization_id
    AND permission.role_id = role.id
    AND role.organization_id = p_organization_id
    AND role.is_system = true
    AND NOT (
      permission.permission_key = ANY(ARRAY[
        'manage_roles','manage_cohorts_terms','manage_schedule','manage_profiles',
        'review_applications','view_applications','review_application_checks',
        'decide_applications','assign_applications','write_application_notes',
        'manage_restrictions','manage_opportunities','manage_partner_clubs',
        'verify_participation','process_points','verify_submissions','manage_meetings',
        'reconcile_meeting_attendance','close_term','reopen_term','edit_point_rules',
        'manage_payment_review','manage_sheet_sync','resolve_imports','manage_settings',
        'export_reports','export_sensitive_reports','view_audit_history'
      ]::text[])
    );

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

REVOKE ALL ON FUNCTION plugin_data.csf_install_default_roles_granular_base(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_install_default_roles(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_install_default_roles(uuid) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_install_default_roles(uuid) IS
  'Installs the canonical CSF positions, grants only supported granular capabilities, and disables retired system-role permissions.';
COMMENT ON FUNCTION plugin_data.csf_install_default_roles_granular_base(uuid) IS
  'Internal granular installer retained for migration-safe composition; not executable by API roles.';

COMMIT;
