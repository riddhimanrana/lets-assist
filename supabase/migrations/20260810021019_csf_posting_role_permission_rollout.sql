-- `manage_review_periods` and `manage_posts` entered the permission catalog
-- after the default system-role matrix was installed. Bring existing chapters
-- and future installs onto the canonical role-template contract without
-- widening custom roles or the settings-only communications console.

BEGIN;

ALTER FUNCTION plugin_data.csf_install_default_roles(uuid)
  RENAME TO csf_install_default_roles_posting_base;

CREATE FUNCTION plugin_data.csf_install_default_roles(
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
  v_base_result :=
    plugin_data.csf_install_default_roles_posting_base(p_organization_id);

  INSERT INTO plugin_data.csf_role_permissions AS existing_permission (
    organization_id,
    role_id,
    permission_key,
    enabled,
    updated_at
  )
  SELECT
    role.organization_id,
    role.id,
    capability.permission_key,
    CASE capability.permission_key
      WHEN 'manage_posts' THEN role.key IN (
        'owner',
        'advisor',
        'co-president',
        'vice-president-publicity',
        'web-master'
      )
      WHEN 'manage_review_periods' THEN role.key IN (
        'owner',
        'advisor',
        'co-president'
      )
      ELSE false
    END,
    pg_catalog.now()
  FROM plugin_data.csf_roles AS role
  CROSS JOIN (
    VALUES ('manage_posts'), ('manage_review_periods')
  ) AS capability(permission_key)
  WHERE role.organization_id = p_organization_id
    AND role.is_system = true
    AND role.role_type IN ('owner', 'officer_template')
  ON CONFLICT (role_id, permission_key) DO UPDATE
  SET
    enabled = EXCLUDED.enabled,
    updated_at = pg_catalog.now()
  WHERE existing_permission.organization_id = EXCLUDED.organization_id;

  SELECT pg_catalog.count(*)::integer
  INTO v_permission_count
  FROM plugin_data.csf_role_permissions AS permission
  WHERE permission.organization_id = p_organization_id;

  RETURN pg_catalog.jsonb_set(
    coalesce(v_base_result, '{}'::jsonb),
    '{permissionCount}',
    pg_catalog.to_jsonb(v_permission_count),
    true
  );
END;
$$;

-- One-time rollout for chapters whose CSF install or entitlement predates the
-- capabilities. A disabled install receives the inert role permissions too: CSF
-- has no onEnable hook that could safely repair it later, and the permission
-- remains unusable until the plugin itself is accessible. Non-system roles
-- retain their existing state; the installer wrapper handles future installs.
INSERT INTO plugin_data.csf_role_permissions AS existing_permission (
  organization_id,
  role_id,
  permission_key,
  enabled,
  updated_at
)
SELECT
  role.organization_id,
  role.id,
  capability.permission_key,
  CASE capability.permission_key
    WHEN 'manage_posts' THEN role.key IN (
      'owner',
      'advisor',
      'co-president',
      'vice-president-publicity',
      'web-master'
    )
    WHEN 'manage_review_periods' THEN role.key IN (
      'owner',
      'advisor',
      'co-president'
    )
    ELSE false
  END,
  pg_catalog.now()
FROM plugin_data.csf_roles AS role
CROSS JOIN (
  VALUES ('manage_posts'), ('manage_review_periods')
) AS capability(permission_key)
JOIN public.organization_plugin_access AS access
  ON access.organization_id = role.organization_id
 AND access.plugin_key = 'dvhs-csf'
WHERE role.is_system = true
  AND role.role_type IN ('owner', 'officer_template')
ON CONFLICT (role_id, permission_key) DO UPDATE
SET
  enabled = EXCLUDED.enabled,
  updated_at = pg_catalog.now()
WHERE existing_permission.organization_id = EXCLUDED.organization_id;

REVOKE ALL ON FUNCTION
  plugin_data.csf_install_default_roles_posting_base(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_install_default_roles(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_install_default_roles(uuid)
  TO service_role;

COMMENT ON FUNCTION
  plugin_data.csf_install_default_roles_posting_base(uuid) IS
  'Internal pre-posting role installer retained for migration-safe composition; no API role may execute it directly.';
COMMENT ON FUNCTION plugin_data.csf_install_default_roles(uuid) IS
  'Installs the canonical CSF positions and idempotently completes the current system-role permission matrix, including review-period and posting authority.';

NOTIFY pgrst, 'reload schema';

COMMIT;
