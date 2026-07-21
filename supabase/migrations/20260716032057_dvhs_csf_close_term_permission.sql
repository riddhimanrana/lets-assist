BEGIN;

-- Semester closure is intentionally separate from point processing. Existing
-- system templates receive an explicit row so only owner/adviser roles gain
-- closure authority by default; custom roles remain delegable through Staff
-- access without being silently elevated by this migration.
INSERT INTO plugin_data.csf_role_permissions (
  organization_id,
  role_id,
  permission_key,
  enabled,
  created_at,
  updated_at
)
SELECT
  role.organization_id,
  role.id,
  'close_term',
  role.key IN ('owner', 'advisor'),
  now(),
  now()
FROM plugin_data.csf_roles AS role
WHERE role.is_system = true
ON CONFLICT (role_id, permission_key) DO UPDATE
SET
  organization_id = EXCLUDED.organization_id,
  enabled = EXCLUDED.enabled,
  updated_at = EXCLUDED.updated_at;

COMMIT;
