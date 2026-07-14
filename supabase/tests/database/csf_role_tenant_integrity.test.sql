BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(6);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'plugin_data.csf_roles'::regclass
      AND conname = 'csf_roles_id_organization_id_key'
      AND contype = 'u'
  ),
  'CSF roles expose a unique tenant-aware reference key'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'plugin_data.csf_staff_positions'::regclass
      AND conname = 'csf_staff_positions_role_organization_fkey'
      AND contype = 'f'
      AND convalidated
  ),
  'staff-position role links use a validated tenant-aware foreign key'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'plugin_data.csf_role_permissions'::regclass
      AND conname = 'csf_role_permissions_role_organization_fkey'
      AND contype = 'f'
      AND convalidated
  ),
  'role-permission links use a validated tenant-aware foreign key'
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'fc100000-0000-4000-8000-000000000001',
    'CSF Tenant Integrity A',
    'csf-tenant-integrity-a',
    'school',
    '710001'
  ),
  (
    'fc100000-0000-4000-8000-000000000002',
    'CSF Tenant Integrity B',
    'csf-tenant-integrity-b',
    'school',
    '710002'
  );

INSERT INTO plugin_data.csf_profiles (
  id,
  organization_id,
  first_name,
  last_name,
  normalized_first_name,
  normalized_last_name
)
VALUES (
  'fc200000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001',
  'Tenant',
  'Member',
  'tenant',
  'member'
);

INSERT INTO plugin_data.csf_roles (
  id,
  organization_id,
  key,
  display_name
)
VALUES
  (
    'fc300000-0000-4000-8000-000000000001',
    'fc100000-0000-4000-8000-000000000001',
    'tenant-a-role',
    'Tenant A Role'
  ),
  (
    'fc300000-0000-4000-8000-000000000002',
    'fc100000-0000-4000-8000-000000000002',
    'tenant-b-role',
    'Tenant B Role'
  );

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_staff_positions (
      organization_id,
      profile_id,
      role_id,
      school_year,
      display_title
    )
    VALUES (
      'fc100000-0000-4000-8000-000000000001',
      'fc200000-0000-4000-8000-000000000001',
      'fc300000-0000-4000-8000-000000000002',
      '2026-2027',
      'Cross-tenant role'
    )
  $$,
  '23503',
  'insert or update on table "csf_staff_positions" violates foreign key constraint "csf_staff_positions_role_organization_fkey"',
  'organization A cannot assign an organization B role to its profile'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_role_permissions (
      organization_id,
      role_id,
      permission_key
    )
    VALUES (
      'fc100000-0000-4000-8000-000000000001',
      'fc300000-0000-4000-8000-000000000002',
      'manage_roles'
    )
  $$,
  '23503',
  'insert or update on table "csf_role_permissions" violates foreign key constraint "csf_role_permissions_role_organization_fkey"',
  'organization A cannot attach permissions to an organization B role'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_staff_positions (
      organization_id,
      profile_id,
      role_id,
      school_year,
      display_title
    )
    VALUES (
      'fc100000-0000-4000-8000-000000000001',
      'fc200000-0000-4000-8000-000000000001',
      'fc300000-0000-4000-8000-000000000001',
      '2026-2027',
      'Same-tenant role'
    )
  $$,
  'same-organization staff role assignment remains valid'
);

SELECT * FROM extensions.finish();

ROLLBACK;
