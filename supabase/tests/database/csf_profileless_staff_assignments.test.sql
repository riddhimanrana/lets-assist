BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(20);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_assign_staff_position_v2(uuid,uuid,uuid,uuid,text,text,date,date,text,uuid)',
    'EXECUTE'
  ),
  'anonymous callers cannot assign staff identities'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_assign_staff_position_v2(uuid,uuid,uuid,uuid,text,text,date,date,text,uuid)',
    'EXECUTE'
  ),
  'authenticated callers cannot bypass the guarded server action'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_assign_staff_position_v2(uuid,uuid,uuid,uuid,text,text,date,date,text,uuid)',
    'EXECUTE'
  ),
  'the service role can call the guarded assignment RPC'
);
SELECT extensions.ok(
  to_regclass('plugin_data.csf_staff_positions_active_user_role_year_uidx') IS NOT NULL,
  'active account assignments have a concurrency-safe identity key'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@profileless.test', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'adviser@profileless.test', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'outsider@profileless.test', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'student@profileless.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'e1100000-0000-4000-8000-000000000001',
  'CSF Profileless Staff',
  'csf-profileless-staff',
  'school',
  '993101'
);

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES
  ('e1100000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('e1100000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('e1100000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000004', 'member', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  lifecycle_status, is_current
) VALUES (
  'e1200000-0000-4000-8000-000000000001',
  'e1100000-0000-4000-8000-000000000001',
  'F31',
  'Fall 2031',
  '2031-2032',
  'fall',
  'open',
  true
);

SELECT plugin_data.csf_install_default_roles(
  'e1100000-0000-4000-8000-000000000001'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES (
  'e1300000-0000-4000-8000-000000000001',
  'e1100000-0000-4000-8000-000000000001',
  'Student',
  'Officer',
  'student',
  'officer'
);

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary
) VALUES (
  'e1100000-0000-4000-8000-000000000001',
  'e1300000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000004',
  'verified',
  true
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position_v2(
      'e1100000-0000-4000-8000-000000000001',
      NULL,
      'e1000000-0000-4000-8000-000000000002',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'e1100000-0000-4000-8000-000000000001' AND key = 'advisor'),
      '2031-2032',
      'Faculty Adviser',
      '2031-08-01',
      '2032-06-01',
      'Assigned without a CSF student profile.',
      'e1000000-0000-4000-8000-000000000001'
    )
  $$,
  'an active organization account can receive a staff position'
);
SELECT extensions.is(
  (
    SELECT profile_id
    FROM plugin_data.csf_staff_positions
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND user_id = 'e1000000-0000-4000-8000-000000000002'
  ),
  NULL::uuid,
  'the adviser assignment has no synthetic student profile'
);
SELECT extensions.is(
  (
    SELECT user_id
    FROM plugin_data.csf_staff_positions
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND display_title = 'Faculty Adviser'
  ),
  'e1000000-0000-4000-8000-000000000002'::uuid,
  'the adviser assignment targets the selected account'
);
SELECT extensions.is(
  (
    SELECT role
    FROM public.organization_members
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND user_id = 'e1000000-0000-4000-8000-000000000002'
  ),
  'staff',
  'assignment promotes a member account to host staff access'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_staff_position_history
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND after_data ->> 'identityType' = 'organization_account'
  ),
  1,
  'account-only assignment writes immutable position history'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND action = 'staff_position.assign'
      AND after_data ->> 'identityType' = 'organization_account'
  ),
  1,
  'account-only assignment writes a matching admin audit event'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position_v2(
      'e1100000-0000-4000-8000-000000000001', NULL,
      'e1000000-0000-4000-8000-000000000002',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'e1100000-0000-4000-8000-000000000001' AND key = 'advisor'),
      '2031-2032', NULL, NULL, NULL, NULL,
      'e1000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'This account already has that active position for the selected school year.',
  'the same account cannot occupy the same active seat twice'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position_v2(
      'e1100000-0000-4000-8000-000000000001', NULL,
      'e1000000-0000-4000-8000-000000000003',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'e1100000-0000-4000-8000-000000000001' AND key = 'secretary'),
      '2031-2032', NULL, NULL, NULL, NULL,
      'e1000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Add this account as an active organization member before assigning staff access.',
  'an account outside the organization cannot receive CSF access'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position_v2(
      'e1100000-0000-4000-8000-000000000001',
      'e1300000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'e1100000-0000-4000-8000-000000000001' AND key = 'secretary'),
      '2031-2032', NULL, NULL, NULL, NULL,
      'e1000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Choose exactly one CSF member or organization account.',
  'the RPC rejects an ambiguous identity'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position_v2(
      'e1100000-0000-4000-8000-000000000001', NULL, NULL,
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'e1100000-0000-4000-8000-000000000001' AND key = 'secretary'),
      '2031-2032', NULL, NULL, NULL, NULL,
      'e1000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Choose exactly one CSF member or organization account.',
  'the RPC rejects a missing identity'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position_v2(
      'e1100000-0000-4000-8000-000000000001',
      'e1300000-0000-4000-8000-000000000001',
      NULL,
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'e1100000-0000-4000-8000-000000000001' AND key = 'secretary'),
      '2031-2032', NULL, NULL, NULL, NULL,
      'e1000000-0000-4000-8000-000000000001'
    )
  $$,
  'verified CSF profile assignments keep using the established atomic path'
);
SELECT extensions.is(
  (
    SELECT profile_id
    FROM plugin_data.csf_staff_positions
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND user_id = 'e1000000-0000-4000-8000-000000000004'
      AND status = 'active'
  ),
  'e1300000-0000-4000-8000-000000000001'::uuid,
  'the established profile assignment retains its student record'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_revoke_staff_position(
      'e1100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_staff_positions WHERE organization_id = 'e1100000-0000-4000-8000-000000000001' AND user_id = 'e1000000-0000-4000-8000-000000000002' AND status = 'active'),
      '2032-06-01',
      'Faculty adviser assignment ended.',
      'e1000000-0000-4000-8000-000000000001'
    )
  $$,
  'account-only staff access can be revoked by the established recovery path'
);
SELECT extensions.is(
  (
    SELECT role
    FROM public.organization_members
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND user_id = 'e1000000-0000-4000-8000-000000000002'
  ),
  'member',
  'revocation restores a member account that CSF promoted'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_staff_position_history
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
  ),
  3,
  'profile and account assignments plus revocation retain complete history'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND action IN ('staff_position.assign', 'staff_position.revoke')
  ),
  3,
  'profile and account position changes retain matching audit events'
);

SELECT extensions.finish();
ROLLBACK;
