BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(17);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_install_default_roles(uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot install or refresh CSF posting roles'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_install_default_roles(uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot install or refresh CSF posting roles'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_install_default_roles(uuid)',
    'EXECUTE'
  ),
  'the server role can install the canonical CSF role templates'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_install_default_roles_posting_base(uuid)',
    'EXECUTE'
  ),
  'the server role cannot bypass the posting-permission wrapper'
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'e3400000-0000-4000-8000-000000000001',
    'CSF Posting Roles A',
    'csf-posting-roles-a',
    'school',
    '934001'
  ),
  (
    'e3400000-0000-4000-8000-000000000002',
    'CSF Posting Roles B',
    'csf-posting-roles-b',
    'school',
    '934002'
  );

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_install_default_roles(
      'e3400000-0000-4000-8000-000000000001'
    )
  $$,
  'a new chapter installs its posting templates atomically'
);

SELECT extensions.is(
  (
    SELECT pg_catalog.array_agg(role.key ORDER BY role.key)
    FROM plugin_data.csf_role_permissions AS permission
    JOIN plugin_data.csf_roles AS role
      ON role.id = permission.role_id
     AND role.organization_id = permission.organization_id
    WHERE permission.organization_id =
      'e3400000-0000-4000-8000-000000000001'
      AND permission.permission_key = 'manage_posts'
      AND permission.enabled = true
  ),
  ARRAY[
    'advisor',
    'co-president',
    'owner',
    'vice-president-publicity',
    'web-master'
  ]::text[],
  'only the five canonical system roles receive enabled manage_posts authority'
);

SELECT extensions.is(
  (
    SELECT pg_catalog.count(*)::integer
    FROM plugin_data.csf_role_permissions
    WHERE organization_id = 'e3400000-0000-4000-8000-000000000001'
      AND permission_key = 'manage_posts'
  ),
  11,
  'the installer stores one manage_posts matrix row per system role'
);

SELECT extensions.is(
  (
    SELECT pg_catalog.array_agg(role.key ORDER BY role.key)
    FROM plugin_data.csf_role_permissions AS permission
    JOIN plugin_data.csf_roles AS role
      ON role.id = permission.role_id
     AND role.organization_id = permission.organization_id
    WHERE permission.organization_id =
      'e3400000-0000-4000-8000-000000000001'
      AND permission.permission_key = 'manage_review_periods'
      AND permission.enabled = true
  ),
  ARRAY['advisor', 'co-president', 'owner']::text[],
  'only owner, adviser, and co-president receive review-period authority'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_role_permissions AS permission
    JOIN plugin_data.csf_roles AS role
      ON role.id = permission.role_id
     AND role.organization_id = permission.organization_id
    WHERE permission.organization_id =
      'e3400000-0000-4000-8000-000000000001'
      AND role.key IN ('vice-president-publicity', 'web-master')
      AND permission.permission_key = 'manage_settings'
      AND permission.enabled = true
  ),
  'posting templates do not gain the settings-only communications console'
);

INSERT INTO plugin_data.csf_roles (
  id,
  organization_id,
  key,
  display_name,
  role_type,
  is_system
)
VALUES (
  'e3410000-0000-4000-8000-000000000001',
  'e3400000-0000-4000-8000-000000000001',
  'custom-post-helper',
  'Custom Post Helper',
  'custom',
  false
);

INSERT INTO plugin_data.csf_role_permissions (
  organization_id,
  role_id,
  permission_key,
  enabled
)
VALUES (
  'e3400000-0000-4000-8000-000000000001',
  'e3410000-0000-4000-8000-000000000001',
  'manage_posts',
  false
);

UPDATE plugin_data.csf_role_permissions AS permission
SET enabled = false
FROM plugin_data.csf_roles AS role
WHERE permission.organization_id =
    'e3400000-0000-4000-8000-000000000001'
  AND permission.role_id = role.id
  AND role.organization_id = permission.organization_id
  AND role.key = 'vice-president-publicity'
  AND permission.permission_key = 'manage_posts';

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_install_default_roles(
      'e3400000-0000-4000-8000-000000000001'
    )
  $$,
  'retrying installation repairs a disabled canonical posting grant'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_role_permissions AS permission
    JOIN plugin_data.csf_roles AS role
      ON role.id = permission.role_id
     AND role.organization_id = permission.organization_id
    WHERE permission.organization_id =
      'e3400000-0000-4000-8000-000000000001'
      AND role.key = 'vice-president-publicity'
      AND permission.permission_key = 'manage_posts'
      AND permission.enabled = true
  ),
  'retrying installation re-enables Publicity VP posting authority'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_role_permissions
    WHERE organization_id = 'e3400000-0000-4000-8000-000000000001'
      AND role_id = 'e3410000-0000-4000-8000-000000000001'
      AND permission_key = 'manage_posts'
      AND enabled = false
  ),
  'retrying installation preserves a custom role permission decision'
);

SELECT extensions.is(
  (
    SELECT (install_result.value ->> 'permissionCount')::integer
    FROM plugin_data.csf_install_default_roles(
      'e3400000-0000-4000-8000-000000000001'
    ) AS install_result(value)
  ),
  (
    SELECT pg_catalog.count(*)::integer
    FROM plugin_data.csf_role_permissions
    WHERE organization_id = 'e3400000-0000-4000-8000-000000000001'
  ),
  'the installer reports its refreshed permission-row count'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_install_default_roles(
      'e3400000-0000-4000-8000-000000000002'
    )
  $$,
  'a second tenant installs an isolated posting-role matrix'
);

SELECT extensions.is(
  (
    SELECT pg_catalog.count(*)::integer
    FROM plugin_data.csf_role_permissions
    WHERE organization_id = 'e3400000-0000-4000-8000-000000000002'
      AND permission_key = 'manage_posts'
      AND enabled = true
  ),
  5,
  'the second tenant receives its own five canonical enabled posting grants'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_role_permissions AS permission
    JOIN plugin_data.csf_roles AS role ON role.id = permission.role_id
    WHERE permission.organization_id <> role.organization_id
  ),
  'every posting grant preserves the role organization coordinate'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_role_permissions AS permission
    JOIN plugin_data.csf_roles AS role
      ON role.id = permission.role_id
     AND role.organization_id = permission.organization_id
    WHERE permission.permission_key = 'manage_posts'
      AND permission.enabled = true
      AND role.organization_id IN (
        'e3400000-0000-4000-8000-000000000001',
        'e3400000-0000-4000-8000-000000000002'
      )
      AND role.key NOT IN (
        'owner',
        'advisor',
        'co-president',
        'vice-president-publicity',
        'web-master'
      )
  ),
  'unrelated system and custom roles receive no posting grant'
);

SELECT * FROM extensions.finish();

ROLLBACK;
