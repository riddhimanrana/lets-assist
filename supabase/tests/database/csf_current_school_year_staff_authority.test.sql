BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(16);

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
  ('ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'staff', 'active'),
  ('ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002', 'staff', 'active'),
  ('ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000003', 'admin', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES (
  'ca200000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  'F26', 'Fall 2026', '2026-2027', 'fall', true
);

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, role_type, is_system
) VALUES (
  'ca300000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  'owner', 'CSF Owner', 'owner', true
);

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key, enabled
) VALUES
  (
  'ca100000-0000-4000-8000-000000000001',
  'ca300000-0000-4000-8000-000000000001',
  'import_members', true
  ),
  ('ca100000-0000-4000-8000-000000000001', 'ca300000-0000-4000-8000-000000000001', 'manage_roles', true),
  ('ca100000-0000-4000-8000-000000000001', 'ca300000-0000-4000-8000-000000000001', 'manage_settings', true),
  ('ca100000-0000-4000-8000-000000000001', 'ca300000-0000-4000-8000-000000000001', 'manage_meetings', true);

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
  'owner_position',
  'current-year owner import authority is recorded as an owner-position grant'
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

SELECT extensions.ok(
  plugin_data.csf_actor_can_manage_staff(
    'ca100000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000001'
  ),
  'a current-year role manager can administer staff access'
);

SELECT extensions.ok(
  NOT plugin_data.csf_actor_can_manage_staff(
    'ca100000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000002'
  ),
  'a prior-year role manager cannot administer staff access'
);

SELECT extensions.ok(
  plugin_data.csf_actor_can_edit_term_policy_draft(
    'ca100000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000001'
  ),
  'a current-year settings manager can edit the term policy draft'
);

SELECT extensions.ok(
  NOT plugin_data.csf_actor_can_edit_term_policy_draft(
    'ca100000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000002'
  ),
  'a prior-year settings manager cannot edit the term policy draft'
);

SELECT extensions.ok(
  plugin_data.csf_actor_can_publish_term_policy(
    'ca100000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000001'
  ),
  'a current-year owner can publish the term policy'
);

SELECT extensions.ok(
  NOT plugin_data.csf_actor_can_publish_term_policy(
    'ca100000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000002'
  ),
  'a prior-year owner cannot publish the term policy'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_assert_meeting_permission_under_lock(
    'ca100000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000001',
    'manage_meetings'
  )$$,
  'a current-year meeting manager passes the locked authorization'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_assert_meeting_permission_under_lock(
    'ca100000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000002',
    'manage_meetings'
  )$$,
  '42501',
  'Not authorized for the requested CSF meeting operation.',
  'a prior-year meeting manager fails the locked authorization'
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
