CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SELECT extensions.plan(27);

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
SELECT extensions.ok(
  position(
    'pg_advisory_xact_lock'
    IN pg_get_functiondef(
      'plugin_data.csf_assign_staff_position_v2(uuid,uuid,uuid,uuid,text,text,date,date,text,uuid)'::regprocedure
    )
  ) < position(
    'IF (p_profile_id IS NULL) = (p_user_id IS NULL)'
    IN pg_get_functiondef(
      'plugin_data.csf_assign_staff_position_v2(uuid,uuid,uuid,uuid,text,text,date,date,text,uuid)'::regprocedure
    )
  ),
  'assignment takes the shared staff-access lock before inspecting mutation input'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('f5600000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@profileless6.test', now(), '{}', '{}', now(), now()),
  ('f5600000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'adviser@profileless6.test', now(), '{}', '{}', now(), now()),
  ('f5600000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'outsider@profileless6.test', now(), '{}', '{}', now(), now()),
  ('f5600000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'student@profileless6.test', now(), '{}', '{}', now(), now()),
  ('f5600000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'target@profileless6.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'f5610000-0000-4000-8000-000000000001',
  'CSF Profileless Staff',
  'csf-profileless-staff-race-2',
  'school',
  '993106'
);

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES
  ('f5610000-0000-4000-8000-000000000001', 'f5600000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('f5610000-0000-4000-8000-000000000001', 'f5600000-0000-4000-8000-000000000002', 'member', 'active'),
  ('f5610000-0000-4000-8000-000000000001', 'f5600000-0000-4000-8000-000000000004', 'member', 'active'),
  ('f5610000-0000-4000-8000-000000000001', 'f5600000-0000-4000-8000-000000000005', 'member', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  lifecycle_status, is_current
) VALUES (
  'f5620000-0000-4000-8000-000000000001',
  'f5610000-0000-4000-8000-000000000001',
  'F31',
  'Fall 2031',
  '2031-2032',
  'fall',
  'open',
  true
);

SELECT plugin_data.csf_install_default_roles(
  'f5610000-0000-4000-8000-000000000001'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES (
  'f5630000-0000-4000-8000-000000000001',
  'f5610000-0000-4000-8000-000000000001',
  'Student',
  'Officer',
  'student',
  'officer'
);

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary
) VALUES (
  'f5610000-0000-4000-8000-000000000001',
  'f5630000-0000-4000-8000-000000000001',
  'f5600000-0000-4000-8000-000000000004',
  'verified',
  true
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position_v2(
      'f5610000-0000-4000-8000-000000000001',
      NULL,
      'f5600000-0000-4000-8000-000000000002',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'f5610000-0000-4000-8000-000000000001' AND key = 'advisor'),
      '2031-2032',
      'Faculty Adviser',
      NULL,
      NULL,
      'Assigned without a CSF student profile.',
      'f5600000-0000-4000-8000-000000000001'
    )
  $$,
  'an active organization account can receive a staff position'
);
SELECT extensions.is(
  (
    SELECT profile_id
    FROM plugin_data.csf_staff_positions
    WHERE organization_id = 'f5610000-0000-4000-8000-000000000001'
      AND user_id = 'f5600000-0000-4000-8000-000000000002'
  ),
  NULL::uuid,
  'the adviser assignment has no synthetic student profile'
);
SELECT extensions.is(
  (
    SELECT user_id
    FROM plugin_data.csf_staff_positions
    WHERE organization_id = 'f5610000-0000-4000-8000-000000000001'
      AND display_title = 'Faculty Adviser'
  ),
  'f5600000-0000-4000-8000-000000000002'::uuid,
  'the adviser assignment targets the selected account'
);
SELECT extensions.is(
  (
    SELECT role
    FROM public.organization_members
    WHERE organization_id = 'f5610000-0000-4000-8000-000000000001'
      AND user_id = 'f5600000-0000-4000-8000-000000000002'
  ),
  'staff',
  'assignment promotes a member account to host staff access'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_staff_position_history
    WHERE organization_id = 'f5610000-0000-4000-8000-000000000001'
      AND after_data ->> 'identityType' = 'organization_account'
  ),
  1,
  'account-only assignment writes immutable position history'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'f5610000-0000-4000-8000-000000000001'
      AND action = 'staff_position.assign'
      AND after_data ->> 'identityType' = 'organization_account'
  ),
  1,
  'account-only assignment writes a matching admin audit event'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position_v2(
      'f5610000-0000-4000-8000-000000000001', NULL,
      'f5600000-0000-4000-8000-000000000002',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'f5610000-0000-4000-8000-000000000001' AND key = 'advisor'),
      '2031-2032', NULL, NULL, NULL, NULL,
      'f5600000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'This account already has that active position for the selected school year.',
  'the same account cannot occupy the same active seat twice'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position_v2(
      'f5610000-0000-4000-8000-000000000001', NULL,
      'f5600000-0000-4000-8000-000000000003',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'f5610000-0000-4000-8000-000000000001' AND key = 'owner'),
      '2031-2032', NULL, NULL, NULL, NULL,
      'f5600000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Add this account as an active organization member before assigning staff access.',
  'an account outside the organization cannot receive CSF access'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position_v2(
      'f5610000-0000-4000-8000-000000000001',
      'f5630000-0000-4000-8000-000000000001',
      'f5600000-0000-4000-8000-000000000004',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'f5610000-0000-4000-8000-000000000001' AND key = 'owner'),
      '2031-2032', NULL, NULL, NULL, NULL,
      'f5600000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Choose exactly one CSF member or organization account.',
  'the RPC rejects an ambiguous identity'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position_v2(
      'f5610000-0000-4000-8000-000000000001', NULL, NULL,
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'f5610000-0000-4000-8000-000000000001' AND key = 'secretary'),
      '2031-2032', NULL, NULL, NULL, NULL,
      'f5600000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Choose exactly one CSF member or organization account.',
  'the RPC rejects a missing identity'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position_v2(
      'f5610000-0000-4000-8000-000000000001',
      'f5630000-0000-4000-8000-000000000001',
      NULL,
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'f5610000-0000-4000-8000-000000000001' AND key = 'owner'),
      '2031-2032', NULL, NULL, NULL, NULL,
      'f5600000-0000-4000-8000-000000000001'
    )
  $$,
  'verified CSF profile assignments keep using the established atomic path'
);
SELECT extensions.is(
  (
    SELECT profile_id
    FROM plugin_data.csf_staff_positions
    WHERE organization_id = 'f5610000-0000-4000-8000-000000000001'
      AND user_id = 'f5600000-0000-4000-8000-000000000004'
      AND status = 'active'
  ),
  'f5630000-0000-4000-8000-000000000001'::uuid,
  'the established profile assignment retains its student record'
);

SELECT extensions.dblink_connect(
  'profileless_stale_assignment_writer',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);

BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key(
    'f5610000-0000-4000-8000-000000000001'
  )
);
SELECT extensions.dblink_send_query(
  'profileless_stale_assignment_writer',
  format(
    $query$
    SELECT plugin_data.csf_assign_staff_position_v2(
      'f5610000-0000-4000-8000-000000000001'::uuid,
      NULL,
      'f5600000-0000-4000-8000-000000000005'::uuid,
      %L::uuid,
      '2031-2032',
      'Queued Secretary',
      NULL,
      NULL,
      'Must be refused after actor revocation',
      'f5600000-0000-4000-8000-000000000004'::uuid
    )::text
    $query$,
    (SELECT id
     FROM plugin_data.csf_roles
     WHERE organization_id = 'f5610000-0000-4000-8000-000000000001'
       AND key = 'secretary')
  )
);
SELECT pg_sleep(0.25);
SELECT extensions.is(
  extensions.dblink_is_busy('profileless_stale_assignment_writer'),
  1,
  'the staff-only assignment waits behind the organization lock'
);
SELECT plugin_data.csf_revoke_staff_position(
  'f5610000-0000-4000-8000-000000000001',
  (SELECT id
   FROM plugin_data.csf_staff_positions
   WHERE organization_id = 'f5610000-0000-4000-8000-000000000001'
     AND user_id = 'f5600000-0000-4000-8000-000000000004'
     AND status = 'active'),
  NULL,
  'Remove the queued actor staff capability',
  'f5600000-0000-4000-8000-000000000001'
);
COMMIT;

SELECT *
FROM extensions.dblink_get_result(
  'profileless_stale_assignment_writer',
  false
) AS result(payload text);
SELECT extensions.ok(
  position(
    'Not authorized to manage CSF staff access.'
    IN extensions.dblink_error_message('profileless_stale_assignment_writer')
  ) > 0,
  'the queued assignment rechecks authorization after acquiring the lock'
);
SELECT extensions.dblink_disconnect('profileless_stale_assignment_writer');
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_staff_positions
   WHERE organization_id = 'f5610000-0000-4000-8000-000000000001'
     AND user_id = 'f5600000-0000-4000-8000-000000000005'
     AND status = 'active'),
  0,
  'the stale staff actor creates no target position'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'f5610000-0000-4000-8000-000000000001'
     AND actor_user_id = 'f5600000-0000-4000-8000-000000000004'
     AND action = 'staff_position.assign'),
  0,
  'the refused stale assignment writes no audit event'
);
SELECT extensions.is(
  (SELECT status
   FROM plugin_data.csf_staff_positions
   WHERE organization_id = 'f5610000-0000-4000-8000-000000000001'
     AND user_id = 'f5600000-0000-4000-8000-000000000004'),
  'ended',
  'the actor revocation commits before the queued assignment resumes'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_assign_staff_position_v2(
      'f5610000-0000-4000-8000-000000000001',
      NULL,
      'f5600000-0000-4000-8000-000000000005',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'f5610000-0000-4000-8000-000000000001' AND key = 'secretary'),
      '2031-2032',
      'Faculty Secretary',
      NULL,
      NULL,
      'Account-only revocation proof',
      'f5600000-0000-4000-8000-000000000001'
    )
  $$,
  'a non-recovery account position can be assigned after the stale write is refused'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_revoke_staff_position(
      'f5610000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_staff_positions WHERE organization_id = 'f5610000-0000-4000-8000-000000000001' AND user_id = 'f5600000-0000-4000-8000-000000000005' AND status = 'active'),
      NULL,
      'Faculty secretary assignment ended.',
      'f5600000-0000-4000-8000-000000000001'
    )
  $$,
  'account-only staff access can be revoked by the established recovery path'
);

SELECT extensions.is(
  (
    SELECT role
    FROM public.organization_members
    WHERE organization_id = 'f5610000-0000-4000-8000-000000000001'
      AND user_id = 'f5600000-0000-4000-8000-000000000005'
  ),
  'member',
  'revocation restores a member account that CSF promoted'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_staff_position_history
    WHERE organization_id = 'f5610000-0000-4000-8000-000000000001'
  ),
  5,
  'profile and account assignments plus revocation retain complete history'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'f5610000-0000-4000-8000-000000000001'
      AND action IN ('staff_position.assign', 'staff_position.revoke')
  ),
  5,
  'profile and account position changes retain matching audit events'
);

SELECT extensions.finish();
