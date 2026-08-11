BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(14);

SELECT extensions.has_column('plugin_data', 'csf_roles', 'max_active_seats', 'CSF roles declare seat capacity');
SELECT extensions.ok(
  NOT has_function_privilege('service_role', 'plugin_data.csf_install_default_roles_seat_limit_base(uuid)', 'EXECUTE'),
  'the server role cannot bypass seat-limit installation'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('d2000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'seat-admin@local.test', now(), '{}', '{}', now(), now()),
  ('d2000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'seat-one@local.test', now(), '{}', '{}', now(), now()),
  ('d2000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'seat-two@local.test', now(), '{}', '{}', now(), now()),
  ('d2000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'seat-three@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('d2100000-0000-4000-8000-000000000001', 'CSF Seat Limits', 'csf-seat-limits', 'school', '992101');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('d2100000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'admin', 'active');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES
  ('d2200000-0000-4000-8000-000000000002', 'd2100000-0000-4000-8000-000000000001', 'Seat', 'One', 'seat', 'one'),
  ('d2200000-0000-4000-8000-000000000003', 'd2100000-0000-4000-8000-000000000001', 'Seat', 'Two', 'seat', 'two'),
  ('d2200000-0000-4000-8000-000000000004', 'd2100000-0000-4000-8000-000000000001', 'Seat', 'Three', 'seat', 'three');

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary
) VALUES
  ('d2100000-0000-4000-8000-000000000001', 'd2200000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000002', 'verified', true),
  ('d2100000-0000-4000-8000-000000000001', 'd2200000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000003', 'verified', true),
  ('d2100000-0000-4000-8000-000000000001', 'd2200000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-000000000004', 'verified', true);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_install_default_roles('d2100000-0000-4000-8000-000000000001') $$,
  'default role installation includes seat limits'
);
SELECT extensions.is(
  (SELECT max_active_seats FROM plugin_data.csf_roles WHERE organization_id = 'd2100000-0000-4000-8000-000000000001' AND key = 'co-president'),
  2,
  'the chapter has two Co-President seats'
);
SELECT extensions.is(
  (SELECT max_active_seats FROM plugin_data.csf_roles WHERE organization_id = 'd2100000-0000-4000-8000-000000000001' AND key = 'activity-coordinator'),
  5,
  'the chapter has five Activity Coordinator seats'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position(
      'd2100000-0000-4000-8000-000000000001', 'd2200000-0000-4000-8000-000000000002',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'd2100000-0000-4000-8000-000000000001' AND key = 'co-president'),
      '2030-2031', 'Co-President', '2030-08-01', '2031-06-01', NULL,
      'd2000000-0000-4000-8000-000000000001'
    )
  $$,
  'the first Co-President seat can be filled'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position(
      'd2100000-0000-4000-8000-000000000001', 'd2200000-0000-4000-8000-000000000003',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'd2100000-0000-4000-8000-000000000001' AND key = 'co-president'),
      '2030-2031', 'Co-President', '2030-08-01', '2031-06-01', NULL,
      'd2000000-0000-4000-8000-000000000001'
    )
  $$,
  'the second Co-President seat can be filled'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position(
      'd2100000-0000-4000-8000-000000000001', 'd2200000-0000-4000-8000-000000000004',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'd2100000-0000-4000-8000-000000000001' AND key = 'co-president'),
      '2030-2031', 'Co-President', '2030-08-01', '2031-06-01', NULL,
      'd2000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'All 2 seat(s) for this CSF position are already filled for 2030-2031.',
  'a third simultaneous Co-President is rejected'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_staff_positions
    WHERE organization_id = 'd2100000-0000-4000-8000-000000000001'
      AND school_year = '2030-2031' AND status = 'active'
      AND role_id = (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'd2100000-0000-4000-8000-000000000001' AND key = 'co-president')
  ),
  2,
  'a rejected assignment leaves the two valid seats unchanged'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_revoke_staff_position(
      'd2100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_staff_positions WHERE organization_id = 'd2100000-0000-4000-8000-000000000001' AND profile_id = 'd2200000-0000-4000-8000-000000000002' AND status = 'active'),
      '2030-12-01', 'Officer transition completed.',
      'd2000000-0000-4000-8000-000000000001'
    )
  $$,
  'ending an assignment opens its seat'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position(
      'd2100000-0000-4000-8000-000000000001', 'd2200000-0000-4000-8000-000000000004',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'd2100000-0000-4000-8000-000000000001' AND key = 'co-president'),
      '2030-2031', 'Co-President', '2030-12-02', '2031-06-01', NULL,
      'd2000000-0000-4000-8000-000000000001'
    )
  $$,
  'a replacement can fill the newly vacant seat'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_staff_positions
    WHERE organization_id = 'd2100000-0000-4000-8000-000000000001'
      AND school_year = '2030-2031' AND status = 'active'
      AND role_id = (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'd2100000-0000-4000-8000-000000000001' AND key = 'co-president')
  ),
  2,
  'the replacement restores exactly two active Co-President seats'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_staff_position_history
    WHERE organization_id = 'd2100000-0000-4000-8000-000000000001'
  ),
  4,
  'seat changes retain assignment and revocation history'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'd2100000-0000-4000-8000-000000000001'
      AND action IN ('staff_position.assign', 'staff_position.revoke')
  ),
  4,
  'seat changes retain matching immutable audit events'
);

SELECT extensions.finish();
ROLLBACK;
