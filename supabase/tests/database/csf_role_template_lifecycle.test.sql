BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(37);

SELECT extensions.has_column('plugin_data', 'csf_roles', 'archived_at', 'CSF roles have a reversible archive timestamp');
SELECT extensions.has_column('plugin_data', 'csf_roles', 'archived_by', 'CSF roles record who archived them');
SELECT extensions.has_column('plugin_data', 'csf_roles', 'archive_reason', 'CSF roles retain their archive reason');

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'plugin_data.csf_update_role(uuid,uuid,text,text,text,text[],integer,uuid)', 'EXECUTE'),
  'anonymous clients cannot edit CSF role templates'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_update_role(uuid,uuid,text,text,text,text[],integer,uuid)', 'EXECUTE'),
  'authenticated clients cannot edit CSF role templates'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_update_role(uuid,uuid,text,text,text,text[],integer,uuid)', 'EXECUTE'),
  'the server role can edit CSF role templates atomically'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'plugin_data.csf_set_role_archived(uuid,uuid,boolean,text,uuid)', 'EXECUTE'),
  'anonymous clients cannot archive CSF role templates'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_set_role_archived(uuid,uuid,boolean,text,uuid)', 'EXECUTE'),
  'authenticated clients cannot archive CSF role templates'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_set_role_archived(uuid,uuid,boolean,text,uuid)', 'EXECUTE'),
  'the server role can archive and restore custom roles atomically'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'plugin_data.csf_create_custom_role(uuid,text,text,text,text[],integer,uuid)', 'EXECUTE'),
  'anonymous clients cannot use the seat-aware custom-role RPC'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_create_custom_role(uuid,text,text,text,text[],integer,uuid)', 'EXECUTE'),
  'the server role can use the seat-aware custom-role RPC'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('f7000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'role-admin-a@local.test', now(), '{}', '{}', now(), now()),
  ('f7000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'role-admin-b@local.test', now(), '{}', '{}', now(), now()),
  ('f7000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'role-officer-one@local.test', now(), '{}', '{}', now(), now()),
  ('f7000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'role-officer-two@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('f7100000-0000-4000-8000-000000000001', 'CSF Role Lifecycle A', 'csf-role-lifecycle-a', 'school', '997101'),
  ('f7100000-0000-4000-8000-000000000002', 'CSF Role Lifecycle B', 'csf-role-lifecycle-b', 'school', '997102');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('f7100000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('f7100000-0000-4000-8000-000000000002', 'f7000000-0000-4000-8000-000000000002', 'admin', 'active');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES
  ('f7200000-0000-4000-8000-000000000001', 'f7100000-0000-4000-8000-000000000001', 'Role', 'Officer One', 'role', 'officer one'),
  ('f7200000-0000-4000-8000-000000000002', 'f7100000-0000-4000-8000-000000000001', 'Role', 'Officer Two', 'role', 'officer two');

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary
) VALUES
  ('f7100000-0000-4000-8000-000000000001', 'f7200000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000003', 'verified', true),
  ('f7100000-0000-4000-8000-000000000001', 'f7200000-0000-4000-8000-000000000002', 'f7000000-0000-4000-8000-000000000004', 'verified', true);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_install_default_roles('f7100000-0000-4000-8000-000000000001') $$,
  'the tenant installs its chapter role templates'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_create_custom_role(
      'f7100000-0000-4000-8000-000000000001',
      'Community Lead', 'Operations', 'Coordinates community operations.',
      ARRAY['manage_schedule','import_members'], 2,
      'f7000000-0000-4000-8000-000000000001'
    )
  $$,
  'a seat-aware custom role is created atomically'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_roles
    WHERE organization_id = 'f7100000-0000-4000-8000-000000000001'
      AND key = 'community-lead-operations'
      AND public_title = 'Community Lead'
      AND responsibility_label = 'Operations'
      AND role_type = 'custom'
      AND is_system = false
      AND max_active_seats = 2
  ),
  'custom role identity, presentation, type, and seat limit are stored separately'
);
-- Derived from the catalog function rather than a literal: the catalog grows
-- as capabilities are added, and the invariant under test is "a custom role
-- stores one row per catalog permission", not any particular count.
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_role_permissions AS permission
    JOIN plugin_data.csf_roles AS role ON role.id = permission.role_id
    WHERE role.organization_id = 'f7100000-0000-4000-8000-000000000001'
      AND role.key = 'community-lead-operations'
  ),
  array_length(plugin_data.csf_role_permission_catalog(), 1),
  'the custom role stores the exact current permission catalog'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_role_permissions AS permission
    JOIN plugin_data.csf_roles AS role ON role.id = permission.role_id
    WHERE role.organization_id = 'f7100000-0000-4000-8000-000000000001'
      AND role.key = 'community-lead-operations'
      AND permission.enabled
  ),
  2,
  'only requested custom-role permissions are enabled'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_role(
      'f7100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'f7100000-0000-4000-8000-000000000001' AND key = 'community-lead-operations'),
      'Community Lead', 'Operations', NULL, ARRAY['not_a_permission'], 2,
      'f7000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'One or more CSF permissions are invalid.',
  'role editing rejects permissions outside the current catalog'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_update_role(
      'f7100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'f7100000-0000-4000-8000-000000000001' AND key = 'community-lead-operations'),
      'Community Director', 'Programs', 'Directs community programs.',
      ARRAY['manage_opportunities','export_service_reports'], 2,
      'f7000000-0000-4000-8000-000000000001'
    )
  $$,
  'a custom role can be edited atomically'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_roles
    WHERE organization_id = 'f7100000-0000-4000-8000-000000000001'
      AND key = 'community-lead-operations'
      AND role_type = 'custom'
      AND is_system = false
      AND display_name = 'Community Director — Programs'
      AND public_title = 'Community Director'
      AND responsibility_label = 'Programs'
      AND description = 'Directs community programs.'
      AND max_active_seats = 2
  ),
  'editing changes mutable details while preserving the permanent key and type'
);
SELECT extensions.ok(
  (
    SELECT array_agg(permission.permission_key ORDER BY permission.permission_key)
    FROM plugin_data.csf_role_permissions AS permission
    JOIN plugin_data.csf_roles AS role ON role.id = permission.role_id
    WHERE role.organization_id = 'f7100000-0000-4000-8000-000000000001'
      AND role.key = 'community-lead-operations'
      AND permission.enabled
  ) = ARRAY['export_service_reports','manage_opportunities']::text[],
  'editing replaces the enabled permission set instead of accumulating grants'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    JOIN plugin_data.csf_roles AS role ON role.id = audit.target_id
    WHERE role.organization_id = 'f7100000-0000-4000-8000-000000000001'
      AND role.key = 'community-lead-operations'
      AND audit.action = 'role.update'
      AND audit.before_data ->> 'publicTitle' = 'Community Lead'
      AND audit.after_data ->> 'publicTitle' = 'Community Director'
  ),
  'role editing records before and after audit evidence'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_role(
      'f7100000-0000-4000-8000-000000000002',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'f7100000-0000-4000-8000-000000000001' AND key = 'community-lead-operations'),
      'Cross Tenant', NULL, NULL, ARRAY[]::text[], NULL,
      'f7000000-0000-4000-8000-000000000002'
    )
  $$,
  'P0001',
  'CSF position template not found.',
  'role editing cannot cross the organization boundary'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_role_archived(
      'f7100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'f7100000-0000-4000-8000-000000000001' AND key = 'advisor'),
      true, 'Attempt to retire a chapter role.',
      'f7000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Chapter position templates cannot be archived or restored.',
  'system chapter roles can never be archived'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position(
      'f7100000-0000-4000-8000-000000000001',
      'f7200000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'f7100000-0000-4000-8000-000000000001' AND key = 'community-lead-operations'),
      '2031-2032', NULL, NULL, NULL, NULL,
      'f7000000-0000-4000-8000-000000000001'
    )
  $$,
  'the first custom-role seat can be assigned'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position(
      'f7100000-0000-4000-8000-000000000001',
      'f7200000-0000-4000-8000-000000000002',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'f7100000-0000-4000-8000-000000000001' AND key = 'community-lead-operations'),
      '2031-2032', NULL, NULL, NULL, NULL,
      'f7000000-0000-4000-8000-000000000001'
    )
  $$,
  'the second custom-role seat can be assigned'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_role(
      'f7100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'f7100000-0000-4000-8000-000000000001' AND key = 'community-lead-operations'),
      'Community Director', 'Programs', 'Directs community programs.',
      ARRAY['manage_opportunities'], 1,
      'f7000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Seat limit cannot be lower than the 2 active assignment(s) in an existing school year.',
  'seat limits cannot be reduced below active occupancy'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_role_archived(
      'f7100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'f7100000-0000-4000-8000-000000000001' AND key = 'community-lead-operations'),
      true, 'This position is no longer needed.',
      'f7000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Revoke all 2 active assignment(s) before archiving this CSF position.',
  'a role with active assignments cannot be archived'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_revoke_staff_position(
      'f7100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_staff_positions WHERE organization_id = 'f7100000-0000-4000-8000-000000000001' AND profile_id = 'f7200000-0000-4000-8000-000000000001' AND status = 'active'),
      NULL, 'Custom role is being retired.',
      'f7000000-0000-4000-8000-000000000001'
    )
  $$,
  'the first active assignment can be revoked'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_revoke_staff_position(
      'f7100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_staff_positions WHERE organization_id = 'f7100000-0000-4000-8000-000000000001' AND profile_id = 'f7200000-0000-4000-8000-000000000002' AND status = 'active'),
      NULL, 'Custom role is being retired.',
      'f7000000-0000-4000-8000-000000000001'
    )
  $$,
  'the second active assignment can be revoked'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_set_role_archived(
      'f7100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'f7100000-0000-4000-8000-000000000001' AND key = 'community-lead-operations'),
      true, 'This position is no longer needed.',
      'f7000000-0000-4000-8000-000000000001'
    )
  $$,
  'a custom role with no active assignments can be archived'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_roles AS role
    WHERE role.organization_id = 'f7100000-0000-4000-8000-000000000001'
      AND role.key = 'community-lead-operations'
      AND role.archived_at IS NOT NULL
      AND role.archived_by = 'f7000000-0000-4000-8000-000000000001'
      AND role.archive_reason = 'This position is no longer needed.'
  )
  AND (
    SELECT count(*) FROM plugin_data.csf_staff_positions AS position
    JOIN plugin_data.csf_roles AS role ON role.id = position.role_id
    WHERE role.organization_id = 'f7100000-0000-4000-8000-000000000001'
      AND role.key = 'community-lead-operations'
  ) = 2,
  'archiving retains the role and its ended assignment history'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position(
      'f7100000-0000-4000-8000-000000000001',
      'f7200000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'f7100000-0000-4000-8000-000000000001' AND key = 'community-lead-operations'),
      '2032-2033', NULL, NULL, NULL, NULL,
      'f7000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Archived CSF positions cannot receive staff assignments.',
  'archived roles cannot receive new active assignments'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    JOIN plugin_data.csf_roles AS role ON role.id = audit.target_id
    WHERE role.organization_id = 'f7100000-0000-4000-8000-000000000001'
      AND role.key = 'community-lead-operations'
      AND audit.action = 'role.archive'
      AND audit.reason_code = 'custom_role_archived'
  ),
  'role archival writes an immutable audit event'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_set_role_archived(
      'f7100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'f7100000-0000-4000-8000-000000000001' AND key = 'community-lead-operations'),
      false, 'The chapter needs this position again.',
      'f7000000-0000-4000-8000-000000000001'
    )
  $$,
  'an archived custom role can be restored'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_roles AS role
    WHERE role.organization_id = 'f7100000-0000-4000-8000-000000000001'
      AND role.key = 'community-lead-operations'
      AND role.archived_at IS NULL
      AND role.archived_by IS NULL
      AND role.archive_reason IS NULL
  )
  AND EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    JOIN plugin_data.csf_roles AS role ON role.id = audit.target_id
    WHERE role.organization_id = 'f7100000-0000-4000-8000-000000000001'
      AND role.key = 'community-lead-operations'
      AND audit.action = 'role.restore'
      AND audit.after_data ->> 'changeReason' = 'The chapter needs this position again.'
  ),
  'restore clears archive state and records its reason in audit history'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position(
      'f7100000-0000-4000-8000-000000000001',
      'f7200000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'f7100000-0000-4000-8000-000000000001' AND key = 'community-lead-operations'),
      '2032-2033', NULL, NULL, NULL, NULL,
      'f7000000-0000-4000-8000-000000000001'
    )
  $$,
  'a restored role returns to assignment use'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_roles
    WHERE organization_id = 'f7100000-0000-4000-8000-000000000001'
      AND key = 'community-lead-operations'
  )
  AND (
    SELECT count(*) FROM plugin_data.csf_staff_positions AS position
    JOIN plugin_data.csf_roles AS role ON role.id = position.role_id
    WHERE role.organization_id = 'f7100000-0000-4000-8000-000000000001'
      AND role.key = 'community-lead-operations'
  ) = 3,
  'archive and restore never delete the role or its assignment history'
);

SELECT * FROM extensions.finish();
ROLLBACK;
