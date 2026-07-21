BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(46);

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'plugin_data.csf_install_default_roles(uuid)', 'EXECUTE'),
  'anonymous clients cannot install CSF role templates'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_install_default_roles(uuid)', 'EXECUTE'),
  'authenticated clients cannot install CSF role templates'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'plugin_data.csf_create_custom_role(uuid,text,text,text,text[],uuid)', 'EXECUTE'),
  'anonymous clients cannot create CSF roles'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_create_custom_role(uuid,text,text,text,text[],uuid)', 'EXECUTE'),
  'authenticated clients cannot create CSF roles'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'plugin_data.csf_assign_staff_position(uuid,uuid,uuid,text,text,date,date,text,uuid)', 'EXECUTE'),
  'anonymous clients cannot assign CSF staff access'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_assign_staff_position(uuid,uuid,uuid,text,text,date,date,text,uuid)', 'EXECUTE'),
  'authenticated clients cannot assign CSF staff access'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'plugin_data.csf_revoke_staff_position(uuid,uuid,date,text,uuid)', 'EXECUTE'),
  'anonymous clients cannot revoke CSF staff access'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_revoke_staff_position(uuid,uuid,date,text,uuid)', 'EXECUTE'),
  'authenticated clients cannot revoke CSF staff access'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_install_default_roles(uuid)', 'EXECUTE'),
  'the server role can install role templates'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_create_custom_role(uuid,text,text,text,text[],uuid)', 'EXECUTE'),
  'the server role can create a custom role atomically'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_assign_staff_position(uuid,uuid,uuid,text,text,date,date,text,uuid)', 'EXECUTE'),
  'the server role can assign staff access atomically'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_revoke_staff_position(uuid,uuid,date,text,uuid)', 'EXECUTE'),
  'the server role can revoke staff access atomically'
);
SELECT extensions.ok(
  NOT has_function_privilege('service_role', 'plugin_data.csf_install_default_roles_base(uuid)', 'EXECUTE'),
  'the server role cannot bypass the granular role installer'
);
SELECT extensions.ok(
  NOT has_function_privilege('service_role', 'plugin_data.csf_install_default_roles_granular_base(uuid)', 'EXECUTE'),
  'the server role cannot bypass retired-permission cleanup'
);
SELECT extensions.ok(
  to_regclass('plugin_data.csf_staff_positions_active_assignment_uidx') IS NOT NULL,
  'concurrent duplicate active staff assignments are blocked by a unique index'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('cf000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'staff-admin-a@local.test', now(), '{}', '{}', now(), now()),
  ('cf000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'staff-member-a@local.test', now(), '{}', '{}', now(), now()),
  ('cf000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'staff-existing-admin@local.test', now(), '{}', '{}', now(), now()),
  ('cf000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'staff-admin-b@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('cf100000-0000-4000-8000-000000000001', 'CSF Staff Access A', 'csf-staff-access-a', 'school', '988001'),
  ('cf100000-0000-4000-8000-000000000002', 'CSF Staff Access B', 'csf-staff-access-b', 'school', '988002');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('cf100000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('cf100000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('cf100000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000003', 'admin', 'active'),
  ('cf100000-0000-4000-8000-000000000002', 'cf000000-0000-4000-8000-000000000004', 'admin', 'active');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES
  ('cf200000-0000-4000-8000-000000000001', 'cf100000-0000-4000-8000-000000000001', 'Member', 'Officer', 'member', 'officer'),
  ('cf200000-0000-4000-8000-000000000002', 'cf100000-0000-4000-8000-000000000001', 'Admin', 'Officer', 'admin', 'officer'),
  ('cf200000-0000-4000-8000-000000000003', 'cf100000-0000-4000-8000-000000000002', 'Other', 'Tenant', 'other', 'tenant');

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary, linked_by
) VALUES
  ('cf100000-0000-4000-8000-000000000001', 'cf200000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000002', 'verified', true, 'cf000000-0000-4000-8000-000000000001'),
  ('cf100000-0000-4000-8000-000000000001', 'cf200000-0000-4000-8000-000000000002', 'cf000000-0000-4000-8000-000000000003', 'verified', true, 'cf000000-0000-4000-8000-000000000001'),
  ('cf100000-0000-4000-8000-000000000002', 'cf200000-0000-4000-8000-000000000003', 'cf000000-0000-4000-8000-000000000004', 'verified', true, 'cf000000-0000-4000-8000-000000000004');

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_install_default_roles('cf100000-0000-4000-8000-000000000001') $$,
  'a new CSF organization can install its role templates atomically'
);
SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_install_default_roles('cf100000-0000-4000-8000-000000000002') $$,
  'a second tenant can install an isolated role matrix'
);
INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key, enabled
)
SELECT
  'cf100000-0000-4000-8000-000000000001', id, 'edit_public_content', true
FROM plugin_data.csf_roles
WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'
  AND key = 'secretary';
SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_install_default_roles('cf100000-0000-4000-8000-000000000001') $$,
  'retrying installation is idempotent'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_roles WHERE organization_id = 'cf100000-0000-4000-8000-000000000001' AND is_system),
  11,
  'the documented eleven templates are installed, with Co-President supporting multiple assignments'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_role_permissions
    WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'
  ),
  397,
  'retrying installation keeps one canonical eleven-by-thirty-six matrix plus retained legacy provenance'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_role_permissions
    WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'
      AND permission_key = 'edit_public_content'
      AND enabled
  ),
  'retrying installation disables retired system-role capabilities'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_roles
    WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'
      AND key = 'vice-president-membership'
      AND public_title = 'Vice President'
      AND responsibility_label = 'Membership'
  ),
  'public title is stored separately from responsibility'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_roles AS role
    JOIN plugin_data.csf_role_permissions AS dues
      ON dues.role_id = role.id AND dues.permission_key = 'manage_payment_review' AND dues.enabled
    JOIN plugin_data.csf_role_permissions AS view_applications
      ON view_applications.role_id = role.id AND view_applications.permission_key = 'view_applications' AND view_applications.enabled
    LEFT JOIN plugin_data.csf_role_permissions AS decide
      ON decide.role_id = role.id AND decide.permission_key = 'decide_applications' AND decide.enabled
    WHERE role.organization_id = 'cf100000-0000-4000-8000-000000000001'
      AND role.key = 'treasurer'
      AND decide.id IS NULL
  ),
  'Treasurer can review dues but cannot decide applications'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_roles AS role
    JOIN plugin_data.csf_role_permissions AS participation
      ON participation.role_id = role.id AND participation.permission_key = 'verify_participation' AND participation.enabled
    LEFT JOIN plugin_data.csf_role_permissions AS final_points
      ON final_points.role_id = role.id AND final_points.permission_key IN ('verify_submissions', 'process_points') AND final_points.enabled
    WHERE role.organization_id = 'cf100000-0000-4000-8000-000000000001'
      AND role.key = 'activity-coordinator'
      AND final_points.id IS NULL
  ),
  'Activity Coordinator can verify participation without final point authority'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_roles AS role
    JOIN plugin_data.csf_role_permissions AS schedule
      ON schedule.role_id = role.id AND schedule.permission_key = 'manage_schedule' AND schedule.enabled
    JOIN plugin_data.csf_role_permissions AS meetings
      ON meetings.role_id = role.id AND meetings.permission_key = 'manage_meetings' AND meetings.enabled
    JOIN plugin_data.csf_role_permissions AS reconciliation
      ON reconciliation.role_id = role.id AND reconciliation.permission_key = 'reconcile_meeting_attendance' AND reconciliation.enabled
    LEFT JOIN plugin_data.csf_role_permissions AS cohort_admin
      ON cohort_admin.role_id = role.id AND cohort_admin.permission_key = 'manage_cohorts_terms' AND cohort_admin.enabled
    WHERE role.organization_id = 'cf100000-0000-4000-8000-000000000001'
      AND role.key = 'secretary'
      AND cohort_admin.id IS NULL
  ),
  'Secretary can manage schedules and attendance without receiving cohort administration'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_roles AS role
    JOIN plugin_data.csf_role_permissions AS reconciliation
      ON reconciliation.role_id = role.id AND reconciliation.permission_key = 'reconcile_meeting_attendance' AND reconciliation.enabled
    LEFT JOIN plugin_data.csf_role_permissions AS meeting_admin
      ON meeting_admin.role_id = role.id AND meeting_admin.permission_key = 'manage_meetings' AND meeting_admin.enabled
    WHERE role.organization_id = 'cf100000-0000-4000-8000-000000000001'
      AND role.key = 'data-management'
      AND meeting_admin.id IS NULL
  ),
  'Data Management can reconcile attendance without changing the meeting schedule'
);

CREATE TEMP TABLE csf_staff_results (
  kind text PRIMARY KEY,
  payload jsonb NOT NULL
) ON COMMIT DROP;

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_staff_results (kind, payload)
    SELECT 'member-assignment', plugin_data.csf_assign_staff_position(
      'cf100000-0000-4000-8000-000000000001',
      'cf200000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'cf100000-0000-4000-8000-000000000001' AND key = 'secretary'),
      '2026-2027', NULL, '2026-08-01', '2027-06-01', 'Initial secretary assignment',
      'cf000000-0000-4000-8000-000000000001'
    )
  $$,
  'an organization admin can assign a linked member to a documented position'
);
SELECT extensions.is(
  (SELECT role::text FROM public.organization_members WHERE organization_id = 'cf100000-0000-4000-8000-000000000001' AND user_id = 'cf000000-0000-4000-8000-000000000002'),
  'staff',
  'assignment promotes the verified host member to staff in the same transaction'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM csf_staff_results AS result
    JOIN plugin_data.csf_staff_positions AS position ON position.id = (result.payload->>'positionId')::uuid
    JOIN plugin_data.csf_roles AS role ON role.id = position.role_id
    WHERE result.kind = 'member-assignment'
      AND position.organization_id = 'cf100000-0000-4000-8000-000000000001'
      AND position.display_title = 'Secretary'
      AND position.starts_at = '2026-08-01'
      AND position.ends_at = '2027-06-01'
      AND role.responsibility_label = 'Meetings and records'
  ),
  'assignment stores its public title, responsibility, school year, and effective window'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM csf_staff_results AS result
    JOIN plugin_data.csf_staff_position_history AS history
      ON history.staff_position_id = (result.payload->>'positionId')::uuid
     AND history.correlation_id = (result.payload->>'correlationId')::uuid
    JOIN plugin_data.csf_admin_audit_events AS audit
      ON audit.target_id = history.staff_position_id
     AND audit.correlation_id = history.correlation_id
    WHERE result.kind = 'member-assignment'
      AND history.action = 'assign'
      AND history.reason_code = 'position_assigned'
      AND audit.action = 'staff_position.assign'
  ),
  'assignment history and immutable audit share one correlation ID'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position(
      'cf100000-0000-4000-8000-000000000001',
      'cf200000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'cf100000-0000-4000-8000-000000000002' AND key = 'secretary'),
      '2026-2027', NULL, NULL, NULL, NULL,
      'cf000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'CSF position template not found.',
  'assignment cannot use another tenant role'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position(
      'cf100000-0000-4000-8000-000000000001',
      'cf200000-0000-4000-8000-000000000002',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'cf100000-0000-4000-8000-000000000001' AND key = 'treasurer'),
      '2026-2027', NULL, NULL, NULL, NULL,
      'cf000000-0000-4000-8000-000000000004'
    )
  $$,
  'P0001',
  'Not authorized to manage CSF staff access.',
  'an administrator from another tenant cannot assign staff'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_staff_results (kind, payload)
    SELECT 'admin-assignment', plugin_data.csf_assign_staff_position(
      'cf100000-0000-4000-8000-000000000001',
      'cf200000-0000-4000-8000-000000000002',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'cf100000-0000-4000-8000-000000000001' AND key = 'treasurer'),
      '2026-2027', NULL, NULL, NULL, 'Treasurer assignment for existing admin',
      'cf000000-0000-4000-8000-000000000001'
    )
  $$,
  'an existing organization admin can receive a CSF position'
);
SELECT extensions.is(
  (SELECT role::text FROM public.organization_members WHERE organization_id = 'cf100000-0000-4000-8000-000000000001' AND user_id = 'cf000000-0000-4000-8000-000000000003'),
  'admin',
  'staff assignment never downgrades an organization admin'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position(
      'cf100000-0000-4000-8000-000000000001',
      'cf200000-0000-4000-8000-000000000002',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'cf100000-0000-4000-8000-000000000001' AND key = 'treasurer'),
      '2026-2027', NULL, NULL, NULL, NULL,
      'cf000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'This member already has that active position for the selected school year.',
  'duplicate active assignments are rejected'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_staff_results (kind, payload)
    SELECT 'custom-role', plugin_data.csf_create_custom_role(
      'cf100000-0000-4000-8000-000000000001',
      'Vice President', 'Community Partnerships', 'Leads chapter partnerships.',
      ARRAY['manage_partner_clubs','reconcile_meeting_attendance','export_reports'],
      'cf000000-0000-4000-8000-000000000001'
    )
  $$,
  'a custom role and its permissions are created atomically'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM csf_staff_results AS result
    JOIN plugin_data.csf_roles AS role ON role.id = (result.payload->>'roleId')::uuid
    WHERE result.kind = 'custom-role'
      AND role.public_title = 'Vice President'
      AND role.responsibility_label = 'Community Partnerships'
      AND role.display_name = 'Vice President — Community Partnerships'
      AND (
        SELECT count(*) FROM plugin_data.csf_role_permissions AS permission
        WHERE permission.role_id = role.id AND permission.enabled
      ) = 3
  ),
  'custom role keeps its public title, responsibility, and requested capabilities'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM csf_staff_results AS result
    JOIN plugin_data.csf_admin_audit_events AS audit
      ON audit.target_id = (result.payload->>'roleId')::uuid
     AND audit.correlation_id = (result.payload->>'correlationId')::uuid
    WHERE result.kind = 'custom-role'
      AND audit.action = 'role.create'
      AND audit.reason_code = 'custom_role_created'
  ),
  'custom role creation writes its audit in the same transaction'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_custom_role(
      'cf100000-0000-4000-8000-000000000001',
      'Unsafe Role', NULL, NULL, ARRAY['not_a_real_permission'],
      'cf000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'One or more CSF permissions are invalid.',
  'custom role creation rejects unknown capabilities'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_staff_results (kind, payload)
    SELECT 'member-revocation', plugin_data.csf_revoke_staff_position(
      'cf100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'positionId')::uuid FROM csf_staff_results WHERE kind = 'member-assignment'),
      '2027-05-31', 'Officer term ended normally',
      'cf000000-0000-4000-8000-000000000001'
    )
  $$,
  'an authorized administrator can revoke a position with a reason'
);
SELECT extensions.ok(
  (SELECT role = 'member' FROM public.organization_members WHERE organization_id = 'cf100000-0000-4000-8000-000000000001' AND user_id = 'cf000000-0000-4000-8000-000000000002')
  AND EXISTS (
    SELECT 1
    FROM csf_staff_results AS result
    JOIN plugin_data.csf_staff_positions AS position ON position.id = (result.payload->>'positionId')::uuid
    WHERE result.kind = 'member-assignment'
      AND position.status = 'ended'
      AND position.ends_at = '2027-05-31'
      AND position.revocation_reason = 'Officer term ended normally'
  ),
  'final revocation restores a CSF-managed member role and records the effective end'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM csf_staff_results AS assignment
    JOIN csf_staff_results AS revocation ON revocation.kind = 'member-revocation'
    JOIN plugin_data.csf_staff_position_history AS history
      ON history.staff_position_id = (assignment.payload->>'positionId')::uuid
     AND history.correlation_id = (revocation.payload->>'correlationId')::uuid
    JOIN plugin_data.csf_admin_audit_events AS audit
      ON audit.target_id = history.staff_position_id
     AND audit.correlation_id = history.correlation_id
    WHERE assignment.kind = 'member-assignment'
      AND history.action = 'revoke'
      AND audit.action = 'staff_position.revoke'
  ),
  'revocation history and audit share one correlation ID'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_staff_position_history
    SET action = 'changed'
    WHERE staff_position_id = (
      SELECT (payload->>'positionId')::uuid FROM csf_staff_results WHERE kind = 'member-assignment'
    )
  $$,
  'P0001',
  'CSF staff position history is immutable.',
  'staff position history cannot be updated'
);
SELECT extensions.throws_ok(
  $$
    DELETE FROM plugin_data.csf_staff_position_history
    WHERE staff_position_id = (
      SELECT (payload->>'positionId')::uuid FROM csf_staff_results WHERE kind = 'member-assignment'
    )
  $$,
  'P0001',
  'CSF staff position history is immutable.',
  'staff position history cannot be deleted'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_revoke_staff_position(
      'cf100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'positionId')::uuid FROM csf_staff_results WHERE kind = 'admin-assignment'),
      NULL, 'Administrative officer assignment ended',
      'cf000000-0000-4000-8000-000000000001'
    )
  $$,
  'an existing admin CSF assignment can be revoked'
);
SELECT extensions.is(
  (SELECT role::text FROM public.organization_members WHERE organization_id = 'cf100000-0000-4000-8000-000000000001' AND user_id = 'cf000000-0000-4000-8000-000000000003'),
  'admin',
  'revocation never downgrades an organization admin'
);

SELECT * FROM extensions.finish();
ROLLBACK;
