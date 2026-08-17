BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(8);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('ca000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'current-officer@local.test', now(), '{}', '{}', now(), now()),
  ('ca000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'former-officer@local.test', now(), '{}', '{}', now(), now()),
  ('ca000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'chapter-admin@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ca100000-0000-4000-8000-000000000001',
  'Current School Year Authority',
  'csf-current-year-authority',
  'school',
  '803117'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'member', 'active'),
  ('ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000003', 'admin', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES (
  'ca200000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  'F26', 'Fall 2026', '2026-2027', 'fall', true
);

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, role_type
) VALUES (
  'ca300000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  'data-management', 'Data Management', 'officer_template'
);

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key, enabled
) VALUES (
  'ca100000-0000-4000-8000-000000000001',
  'ca300000-0000-4000-8000-000000000001',
  'import_members', true
);

INSERT INTO plugin_data.csf_staff_positions (
  organization_id, user_id, role_id, school_year, display_title,
  status, starts_at, ends_at
) VALUES
  ('ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'ca300000-0000-4000-8000-000000000001', '2026-2027', 'Data Management', 'active', NULL, NULL),
  ('ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002', 'ca300000-0000-4000-8000-000000000001', '2025-2026', 'Former Data Management', 'active', NULL, NULL);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_actor_has_permission(uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated users cannot probe staff permissions directly'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_actor_has_permission(uuid,uuid,text)',
    'EXECUTE'
  ),
  'the server can evaluate staff permissions'
);

SELECT extensions.ok(
  plugin_data.csf_actor_has_permission(
    'ca100000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000001',
    'import_members'
  ),
  'a position in the configured current school year grants its permission'
);

SELECT extensions.ok(
  NOT plugin_data.csf_actor_has_permission(
    'ca100000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000002',
    'import_members'
  ),
  'an open-ended prior-year position grants no current permission'
);

SELECT extensions.is(
  plugin_data.csf_assert_import_actor(
    'ca100000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000001',
    'class_history'
  )->>'basis',
  'staff_position',
  'current-year import authority is recorded as a staff-position grant'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_assert_import_actor(
    'ca100000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000002',
    'class_history'
  )$$,
  '42501',
  'This officer does not hold the import_members capability for CSF class_history imports in this organization.',
  'a prior-year position cannot authorize a historical import'
);

UPDATE plugin_data.csf_terms
SET is_current = false
WHERE id = 'ca200000-0000-4000-8000-000000000001';

SELECT extensions.ok(
  NOT plugin_data.csf_actor_has_permission(
    'ca100000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000001',
    'import_members'
  ),
  'staff authority fails closed when no current term is configured'
);

SELECT extensions.ok(
  plugin_data.csf_actor_has_permission(
    'ca100000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000003',
    'import_members'
  ),
  'organization-admin authority remains available without a current term'
);

SELECT * FROM extensions.finish();

ROLLBACK;
