-- A chapter can never be left with nobody able to manage CSF staff access.
-- Product contract section 8.19. Recovery access is a capability, not a role
-- name, and it can be removed two ways: by ending the last recovery-capable
-- assignment, or by editing that role's permissions. Both paths are covered
-- here, including a real two-connection race between them.
--
-- This file runs in autocommit so the concurrency section can observe
-- committed state from a second real connection, following the precedent in
-- `csf_term_close_serialization.test.sql`.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(54);

-- 1-10: privileged boundary, shared lock key, and locking-order contract.
SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_staff_access_lock_key(uuid)') IS NOT NULL,
  'the shared staff-access lock key exists'
);
SELECT extensions.ok(
  pg_get_functiondef('plugin_data.csf_revoke_staff_position(uuid,uuid,date,text,uuid)'::regprocedure)
    LIKE '%csf_staff_access_lock_key(p_organization_id)%'
  AND pg_get_functiondef('plugin_data.csf_update_role(uuid,uuid,text,text,text,text[],integer,uuid)'::regprocedure)
    LIKE '%csf_staff_access_lock_key(p_organization_id)%',
  'revoke and role edit serialize on the same organization lock key'
);
SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_count_recovery_staff_seats(uuid,uuid)') IS NOT NULL,
  'the recovery-seat counter exists'
);
SELECT extensions.ok(
  NOT has_function_privilege('public', 'plugin_data.csf_count_recovery_staff_seats(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'plugin_data.csf_count_recovery_staff_seats(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'plugin_data.csf_count_recovery_staff_seats(uuid,uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'plugin_data.csf_count_recovery_staff_seats(uuid,uuid)', 'EXECUTE'),
  'only the server role can count recovery seats'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'plugin_data.csf_revoke_staff_position(uuid,uuid,date,text,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'plugin_data.csf_revoke_staff_position(uuid,uuid,date,text,uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'plugin_data.csf_revoke_staff_position(uuid,uuid,date,text,uuid)', 'EXECUTE'),
  'the replaced revoke function keeps its reviewed grants'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'plugin_data.csf_update_role(uuid,uuid,text,text,text,text[],integer,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'plugin_data.csf_update_role(uuid,uuid,text,text,text,text[],integer,uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'plugin_data.csf_update_role(uuid,uuid,text,text,text,text[],integer,uuid)', 'EXECUTE'),
  'the replaced role-edit function keeps its reviewed grants'
);
SELECT extensions.ok(
  pg_get_functiondef('plugin_data.csf_revoke_staff_position(uuid,uuid,date,text,uuid)'::regprocedure)
    LIKE '%SECURITY DEFINER%SET search_path TO ''''%',
  'the replaced revoke function pins an empty search path'
);
SELECT extensions.ok(
  pg_get_functiondef('plugin_data.csf_update_role(uuid,uuid,text,text,text,text[],integer,uuid)'::regprocedure)
    LIKE '%SECURITY DEFINER%SET search_path TO ''''%',
  'the replaced role-edit function pins an empty search path'
);
SELECT extensions.ok(
  -- The stable wrapper owns the organization lock and completes its second
  -- authorization check before delegating to the owner-only implementation.
  position(
    'pg_advisory_xact_lock'
    IN pg_get_functiondef('plugin_data.csf_revoke_staff_position(uuid,uuid,date,text,uuid)'::regprocedure)
  ) < position(
    'csf_revoke_staff_position_locked_impl'
    IN pg_get_functiondef('plugin_data.csf_revoke_staff_position(uuid,uuid,date,text,uuid)'::regprocedure)
  )
  AND pg_get_functiondef(
    'plugin_data.csf_revoke_staff_position_locked_impl(uuid,uuid,date,text,uuid)'::regprocedure
  ) LIKE '%FOR UPDATE%',
  'the organization lock and reauthorization precede the position-row implementation'
);
SELECT extensions.ok(
  position(
    'pg_advisory_xact_lock'
    IN pg_get_functiondef('plugin_data.csf_update_role(uuid,uuid,text,text,text,text[],integer,uuid)'::regprocedure)
  ) < position(
    'csf_update_role_locked_impl'
    IN pg_get_functiondef('plugin_data.csf_update_role(uuid,uuid,text,text,text,text[],integer,uuid)'::regprocedure)
  )
  AND pg_get_functiondef(
    'plugin_data.csf_update_role_locked_impl(uuid,uuid,text,text,text,text[],integer,uuid)'::regprocedure
  ) LIKE '%FOR UPDATE%',
  'the organization lock and reauthorization precede the role-row implementation'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('e8000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'recovery-admin@local.test', now(), '{}', '{}', now(), now()),
  ('e8000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'recovery-adviser@local.test', now(), '{}', '{}', now(), now()),
  ('e8000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'recovery-owner@local.test', now(), '{}', '{}', now(), now()),
  ('e8000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'recovery-treasurer@local.test', now(), '{}', '{}', now(), now()),
  ('e8000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'recovery-deputy@local.test', now(), '{}', '{}', now(), now()),
  ('e8000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'recovery-successor@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('e8100000-0000-4000-8000-000000000001', 'CSF Recovery Seat Floor', 'csf-recovery-seat-floor', 'school', '996301');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, lifecycle_status, is_current
) VALUES (
  'e8300000-0000-4000-8000-000000000001',
  'e8100000-0000-4000-8000-000000000001',
  'F26', 'Fall 2026', '2026-2027', 'fall', 'open', true
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('e8100000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001', 'admin', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES (
  'e8150000-0000-4000-8000-000000000001',
  'e8100000-0000-4000-8000-000000000001',
  'F26', 'Fall 2026', '2026-2027', 'fall', true
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES
  ('e8200000-0000-4000-8000-000000000002', 'e8100000-0000-4000-8000-000000000001', 'Recovery', 'Adviser', 'recovery', 'adviser'),
  ('e8200000-0000-4000-8000-000000000003', 'e8100000-0000-4000-8000-000000000001', 'Recovery', 'Owner', 'recovery', 'owner'),
  ('e8200000-0000-4000-8000-000000000004', 'e8100000-0000-4000-8000-000000000001', 'Recovery', 'Treasurer', 'recovery', 'treasurer'),
  ('e8200000-0000-4000-8000-000000000005', 'e8100000-0000-4000-8000-000000000001', 'Recovery', 'Deputy', 'recovery', 'deputy'),
  ('e8200000-0000-4000-8000-000000000006', 'e8100000-0000-4000-8000-000000000001', 'Recovery', 'Successor', 'recovery', 'successor');

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary
) VALUES
  ('e8100000-0000-4000-8000-000000000001', 'e8200000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-000000000002', 'verified', true),
  ('e8100000-0000-4000-8000-000000000001', 'e8200000-0000-4000-8000-000000000003', 'e8000000-0000-4000-8000-000000000003', 'verified', true),
  ('e8100000-0000-4000-8000-000000000001', 'e8200000-0000-4000-8000-000000000004', 'e8000000-0000-4000-8000-000000000004', 'verified', true),
  ('e8100000-0000-4000-8000-000000000001', 'e8200000-0000-4000-8000-000000000005', 'e8000000-0000-4000-8000-000000000005', 'verified', true),
  ('e8100000-0000-4000-8000-000000000001', 'e8200000-0000-4000-8000-000000000006', 'e8000000-0000-4000-8000-000000000006', 'verified', true);

SELECT plugin_data.csf_install_default_roles('e8100000-0000-4000-8000-000000000001');

CREATE TEMP TABLE csf_recovery_seat_results (
  kind text PRIMARY KEY,
  payload jsonb NOT NULL
) ON COMMIT PRESERVE ROWS;

INSERT INTO csf_recovery_seat_results (kind, payload)
SELECT 'adviser', plugin_data.csf_assign_staff_position(
  'e8100000-0000-4000-8000-000000000001',
  'e8200000-0000-4000-8000-000000000002',
  (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'e8100000-0000-4000-8000-000000000001' AND key = 'advisor'),
  '2026-2027', NULL, NULL, NULL, 'Chapter adviser',
  'e8000000-0000-4000-8000-000000000001'
);
INSERT INTO csf_recovery_seat_results (kind, payload)
SELECT 'owner', plugin_data.csf_assign_staff_position(
  'e8100000-0000-4000-8000-000000000001',
  'e8200000-0000-4000-8000-000000000003',
  (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'e8100000-0000-4000-8000-000000000001' AND key = 'owner'),
  '2026-2027', NULL, NULL, NULL, 'Chapter owner',
  'e8000000-0000-4000-8000-000000000001'
);
INSERT INTO csf_recovery_seat_results (kind, payload)
SELECT 'treasurer', plugin_data.csf_assign_staff_position(
  'e8100000-0000-4000-8000-000000000001',
  'e8200000-0000-4000-8000-000000000004',
  (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'e8100000-0000-4000-8000-000000000001' AND key = 'treasurer'),
  '2026-2027', NULL, NULL, NULL, 'Chapter treasurer',
  'e8000000-0000-4000-8000-000000000001'
);

-- 11-12: the counter recognizes exactly the two recovery-capable seats.
SELECT extensions.is(
  plugin_data.csf_count_recovery_staff_seats('e8100000-0000-4000-8000-000000000001', NULL),
  2,
  'the chapter starts with two seats that can manage staff access'
);
SELECT extensions.is(
  plugin_data.csf_count_recovery_staff_seats(
    'e8100000-0000-4000-8000-000000000001',
    (SELECT (payload->>'positionId')::uuid FROM csf_recovery_seat_results WHERE kind = 'treasurer')
  ),
  2,
  'a Treasurer seat is not recovery access'
);

-- 13-15: revoking one of two recovery seats stays legitimate and audited.
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_revoke_staff_position(
      'e8100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'positionId')::uuid FROM csf_recovery_seat_results WHERE kind = 'owner'),
      NULL, 'Owner seat handed back to the adviser',
      'e8000000-0000-4000-8000-000000000001'
    )
  $$,
  'a recovery seat can still be revoked while another recovery seat remains'
);
SELECT extensions.is(
  plugin_data.csf_count_recovery_staff_seats('e8100000-0000-4000-8000-000000000001', NULL),
  1,
  'exactly one recovery seat remains after the legitimate revocation'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM csf_recovery_seat_results AS result
    JOIN plugin_data.csf_staff_position_history AS history
      ON history.staff_position_id = (result.payload->>'positionId')::uuid
     AND history.action = 'revoke'
    JOIN plugin_data.csf_admin_audit_events AS audit
      ON audit.target_id = history.staff_position_id
     AND audit.correlation_id = history.correlation_id
     AND audit.action = 'staff_position.revoke'
    WHERE result.kind = 'owner'
      AND history.reason_code = 'position_revoked'
      AND audit.reason_code = 'position_revoked'
  ),
  'the permitted revocation still writes immutable history plus its audit receipt'
);

-- 16-19: the last recovery seat is refused, unchanged, and unaudited.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_revoke_staff_position(
      'e8100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'positionId')::uuid FROM csf_recovery_seat_results WHERE kind = 'adviser'),
      NULL, 'Attempting to end the final adviser seat',
      'e8000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'This is the last active position that can still manage CSF staff access. Give another active position the Staff access capability, or assign someone to a position that already has it, before ending this one.',
  'the last seat that can manage staff access cannot be revoked'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM csf_recovery_seat_results AS result
    JOIN plugin_data.csf_staff_positions AS position
      ON position.id = (result.payload->>'positionId')::uuid
    WHERE result.kind = 'adviser'
      AND position.status = 'active'
      AND position.ends_at IS NULL
      AND position.revoked_at IS NULL
      AND position.revoked_by IS NULL
      AND position.revocation_reason IS NULL
  ),
  'the refused position row is completely unchanged'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM csf_recovery_seat_results AS result
    JOIN plugin_data.csf_staff_position_history AS history
      ON history.staff_position_id = (result.payload->>'positionId')::uuid
     AND history.action = 'revoke'
    WHERE result.kind = 'adviser'
  ),
  0,
  'a refused revocation writes no revoke history'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM csf_recovery_seat_results AS result
    JOIN plugin_data.csf_admin_audit_events AS audit
      ON audit.target_id = (result.payload->>'positionId')::uuid
     AND audit.action = 'staff_position.revoke'
    WHERE result.kind = 'adviser'
  ),
  0,
  'a refused revocation writes no audit receipt'
);

-- 20: unrelated seats are unaffected by the floor.
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_revoke_staff_position(
      'e8100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'positionId')::uuid FROM csf_recovery_seat_results WHERE kind = 'treasurer'),
      NULL, 'Treasurer term ended normally',
      'e8000000-0000-4000-8000-000000000001'
    )
  $$,
  'a non-recovery seat is unaffected by the floor'
);

-- 21-22: a seat that has not started yet cannot be counted as recovery access.
INSERT INTO csf_recovery_seat_results (kind, payload)
SELECT 'future-owner', plugin_data.csf_assign_staff_position(
  'e8100000-0000-4000-8000-000000000001',
  'e8200000-0000-4000-8000-000000000006',
  (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'e8100000-0000-4000-8000-000000000001' AND key = 'owner'),
  '2026-2027', NULL,
  ((now() AT TIME ZONE 'America/Los_Angeles')::date + 30),
  NULL, 'Next year owner seat',
  'e8000000-0000-4000-8000-000000000001'
);
SELECT extensions.is(
  plugin_data.csf_count_recovery_staff_seats('e8100000-0000-4000-8000-000000000001', NULL),
  1,
  'a future-dated seat is excluded until it becomes effective'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_revoke_staff_position(
      'e8100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'positionId')::uuid FROM csf_recovery_seat_results WHERE kind = 'adviser'),
      NULL, 'A seat that starts next month is not recovery access today',
      'e8000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'This is the last active position that can still manage CSF staff access. Give another active position the Staff access capability, or assign someone to a position that already has it, before ending this one.',
  'a future-dated successor seat does not unlock the last effective recovery seat'
);

-- 23-25: a seat with no linked account cannot be counted as recovery access
-- either. `user_id` goes to NULL through `ON DELETE SET NULL` when the linked
-- account is removed; the position row is mutated directly here so the
-- predicate's own branch is exercised without deleting an auth.users row.
-- A dedicated custom role carries this seat instead of the single-seat owner
-- role: the owner role's one seat for 2026-2027 is still held by the active
-- future-owner assignment above, and this check has nothing to do with which
-- role is attached, only with the missing account link.
INSERT INTO csf_recovery_seat_results (kind, payload)
SELECT 'unlinked-role', plugin_data.csf_create_custom_role(
  'e8100000-0000-4000-8000-000000000001',
  'Temporary Unlinked Seat Role',
  'Unlinked-seat check',
  'A chapter position used to exercise the unlinked-account branch without competing for the single owner seat.',
  ARRAY['manage_roles'],
  'e8000000-0000-4000-8000-000000000001'
);
INSERT INTO csf_recovery_seat_results (kind, payload)
SELECT 'unlinked-seat', plugin_data.csf_assign_staff_position(
  'e8100000-0000-4000-8000-000000000001',
  'e8200000-0000-4000-8000-000000000004',
  (SELECT (payload->>'roleId')::uuid FROM csf_recovery_seat_results WHERE kind = 'unlinked-role'),
  '2026-2027', NULL, NULL, NULL, 'Temporary custom seat for the unlinked-seat check',
  'e8000000-0000-4000-8000-000000000001'
);
SELECT extensions.is(
  plugin_data.csf_count_recovery_staff_seats('e8100000-0000-4000-8000-000000000001', NULL),
  2,
  'a newly linked custom seat is recognized as recovery access'
);
UPDATE plugin_data.csf_staff_positions
SET user_id = NULL
WHERE id = (SELECT (payload->>'positionId')::uuid FROM csf_recovery_seat_results WHERE kind = 'unlinked-seat');
SELECT extensions.is(
  plugin_data.csf_count_recovery_staff_seats('e8100000-0000-4000-8000-000000000001', NULL),
  1,
  'a seat with no linked account is not counted as recovery access'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_revoke_staff_position(
      'e8100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'positionId')::uuid FROM csf_recovery_seat_results WHERE kind = 'adviser'),
      NULL, 'An unlinked seat is not recovery access today',
      'e8000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'This is the last active position that can still manage CSF staff access. Give another active position the Staff access capability, or assign someone to a position that already has it, before ending this one.',
  'an unlinked custom seat does not unlock the last effective recovery seat'
);

-- The unlinked-seat check above only needed the position's user_id nulled; it
-- never ended the position itself, so profile ...004 is still holding it as
-- 'active'. Retire it through the reviewed revoke RPC now, before profile
-- ...004 is reused below, so the fixture never puts one profile in two
-- active positions at once.
SELECT plugin_data.csf_revoke_staff_position(
  'e8100000-0000-4000-8000-000000000001',
  (SELECT (payload->>'positionId')::uuid FROM csf_recovery_seat_results WHERE kind = 'unlinked-seat'),
  NULL, 'Retiring the synthetic unlinked seat before profile reuse',
  'e8000000-0000-4000-8000-000000000001'
);

-- 26-28: a seat on an archived role cannot be counted as recovery access
-- either. `csf_set_role_archived` refuses to archive a role with active
-- assignments, so the role is archived directly here to exercise the
-- predicate's defense-in-depth branch on its own.
INSERT INTO csf_recovery_seat_results (kind, payload)
SELECT 'archived-role', plugin_data.csf_create_custom_role(
  'e8100000-0000-4000-8000-000000000001',
  'Temporary Archived Role',
  'Archived-seat check',
  'A chapter position archived out from under an active assignment.',
  ARRAY['manage_roles'],
  'e8000000-0000-4000-8000-000000000001'
);
INSERT INTO csf_recovery_seat_results (kind, payload)
SELECT 'archived-role-seat', plugin_data.csf_assign_staff_position(
  'e8100000-0000-4000-8000-000000000001',
  'e8200000-0000-4000-8000-000000000004',
  (SELECT (payload->>'roleId')::uuid FROM csf_recovery_seat_results WHERE kind = 'archived-role'),
  '2026-2027', NULL, NULL, NULL, 'Temporary seat for the archived-role check',
  'e8000000-0000-4000-8000-000000000001'
);
SELECT extensions.is(
  plugin_data.csf_count_recovery_staff_seats('e8100000-0000-4000-8000-000000000001', NULL),
  2,
  'a seat on an unarchived custom role is recognized as recovery access'
);
UPDATE plugin_data.csf_roles
SET archived_at = now(),
    archived_by = 'e8000000-0000-4000-8000-000000000001',
    archive_reason = 'Synthetic defense-in-depth check for an archived active role'
WHERE id = (SELECT (payload->>'roleId')::uuid FROM csf_recovery_seat_results WHERE kind = 'archived-role');
SELECT extensions.is(
  plugin_data.csf_count_recovery_staff_seats('e8100000-0000-4000-8000-000000000001', NULL),
  1,
  'a seat on an archived role is not counted as recovery access'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_revoke_staff_position(
      'e8100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'positionId')::uuid FROM csf_recovery_seat_results WHERE kind = 'adviser'),
      NULL, 'A seat on an archived role is not recovery access today',
      'e8000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'This is the last active position that can still manage CSF staff access. Give another active position the Staff access capability, or assign someone to a position that already has it, before ending this one.',
  'a seat on an archived role does not unlock the last effective recovery seat'
);

-- 29-31: a permission edit cannot remove the last recovery access either.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_role(
      'e8100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'e8100000-0000-4000-8000-000000000001' AND key = 'advisor'),
      'Adviser renamed by the stripping edit',
      'Chapter oversight',
      NULL,
      ARRAY['manage_profiles', 'view_applications'],
      NULL,
      'e8000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'This change would leave no active position able to manage CSF staff access. Keep the Staff access capability on at least one position that has a currently effective active assignment.',
  'stripping manage_roles from the only recovery-capable role is refused'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_role_permissions AS permission
    JOIN plugin_data.csf_roles AS role
      ON role.organization_id = permission.organization_id
     AND role.id = permission.role_id
    WHERE permission.organization_id = 'e8100000-0000-4000-8000-000000000001'
      AND role.key = 'advisor'
      AND permission.permission_key = 'manage_roles'
      AND permission.enabled
  ),
  'the refused permission edit leaves the recovery capability enabled'
);
SELECT extensions.ok(
  (
    SELECT public_title = 'Adviser'
    FROM plugin_data.csf_roles
    WHERE organization_id = 'e8100000-0000-4000-8000-000000000001'
      AND key = 'advisor'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    JOIN plugin_data.csf_roles AS role
      ON role.organization_id = audit.organization_id
     AND role.id = audit.target_id
    WHERE audit.organization_id = 'e8100000-0000-4000-8000-000000000001'
      AND audit.action = 'role.update'
      AND role.key = 'advisor'
  ),
  'the refused permission edit rolls back the title change and writes no audit receipt'
);

-- 32-33: an edit that keeps recovery access still commits and audits.
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_update_role(
      'e8100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_roles WHERE organization_id = 'e8100000-0000-4000-8000-000000000001' AND key = 'advisor'),
      'Adviser',
      'Chapter oversight',
      'Keeps staff access while narrowing everything else.',
      ARRAY['manage_roles', 'manage_profiles'],
      NULL,
      'e8000000-0000-4000-8000-000000000001'
    )
  $$,
  'an edit that keeps the recovery capability is still allowed'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events AS audit
    JOIN plugin_data.csf_roles AS role
      ON role.organization_id = audit.organization_id
     AND role.id = audit.target_id
    WHERE audit.organization_id = 'e8100000-0000-4000-8000-000000000001'
      AND audit.action = 'role.update'
      AND role.key = 'advisor'
  ),
  1,
  'the permitted permission edit writes exactly one audit receipt'
);

-- 34-36: recovery access is the capability, not the adviser/owner role key.
INSERT INTO csf_recovery_seat_results (kind, payload)
SELECT 'deputy-role', plugin_data.csf_create_custom_role(
  'e8100000-0000-4000-8000-000000000001',
  'Deputy Adviser',
  'Recovery backup',
  'A chapter position that carries staff access without being adviser or owner.',
  ARRAY['manage_roles'],
  'e8000000-0000-4000-8000-000000000001'
);
INSERT INTO csf_recovery_seat_results (kind, payload)
SELECT 'deputy', plugin_data.csf_assign_staff_position(
  'e8100000-0000-4000-8000-000000000001',
  'e8200000-0000-4000-8000-000000000005',
  (SELECT (payload->>'roleId')::uuid FROM csf_recovery_seat_results WHERE kind = 'deputy-role'),
  '2026-2027', NULL, NULL, NULL, 'Deputy adviser',
  'e8000000-0000-4000-8000-000000000001'
);
SELECT extensions.is(
  plugin_data.csf_count_recovery_staff_seats('e8100000-0000-4000-8000-000000000001', NULL),
  2,
  'a custom position holding manage_roles counts as recovery access'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_revoke_staff_position(
      'e8100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'positionId')::uuid FROM csf_recovery_seat_results WHERE kind = 'adviser'),
      NULL, 'The deputy position now carries staff access',
      'e8000000-0000-4000-8000-000000000001'
    )
  $$,
  'the last adviser seat can be ended once another position actually carries the capability'
);
SELECT extensions.is(
  plugin_data.csf_count_recovery_staff_seats('e8100000-0000-4000-8000-000000000001', NULL),
  1,
  'the chapter is left with exactly the deputy recovery seat'
);

-- 37-41: a revoke and a permission strip cannot drain the floor together.
-- This seat is placed on its own custom role rather than the single-seat
-- owner role: the owner role's one seat for 2026-2027 is still held by the
-- active future-owner assignment above, and the race below only needs a
-- second revocable recovery-capable seat, not specifically the owner role.
INSERT INTO csf_recovery_seat_results (kind, payload)
SELECT 'restored-role', plugin_data.csf_create_custom_role(
  'e8100000-0000-4000-8000-000000000001',
  'Interim Recovery Successor',
  'Race setup seat',
  'A chapter position used to restore a second recovery-capable seat for the revoke-versus-permission-strip race.',
  ARRAY['manage_roles'],
  'e8000000-0000-4000-8000-000000000001'
);
INSERT INTO csf_recovery_seat_results (kind, payload)
SELECT 'restored-seat', plugin_data.csf_assign_staff_position(
  'e8100000-0000-4000-8000-000000000001',
  'e8200000-0000-4000-8000-000000000003',
  (SELECT (payload->>'roleId')::uuid FROM csf_recovery_seat_results WHERE kind = 'restored-role'),
  '2026-2027', NULL, NULL, NULL, 'Successor recovery seat for the race setup',
  'e8000000-0000-4000-8000-000000000001'
);
SELECT extensions.is(
  plugin_data.csf_count_recovery_staff_seats('e8100000-0000-4000-8000-000000000001', NULL),
  2,
  'assigning a successor restores the two-seat state the race needs'
);

SELECT extensions.dblink_connect(
  'recovery_seat_writer',
  -- Use the container interface rather than loopback. Supabase's local pg_hba
  -- trusts loopback, and dblink refuses a non-superuser connection when the
  -- supplied password was not actually used.
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);

BEGIN;

-- Session one strips staff access from the deputy position. That is legitimate
-- on its own, because the restored seat still carries the capability.
SELECT plugin_data.csf_update_role(
  'e8100000-0000-4000-8000-000000000001',
  (SELECT (payload->>'roleId')::uuid FROM csf_recovery_seat_results WHERE kind = 'deputy-role'),
  'Deputy Adviser',
  'Recovery backup',
  'Staff access removed while the restored seat still holds it.',
  ARRAY['manage_profiles'],
  NULL,
  'e8000000-0000-4000-8000-000000000001'
);

-- Session two revokes the restored seat. That is also legitimate on its own,
-- because the deputy position still carries the capability in committed state.
SELECT extensions.dblink_send_query(
  'recovery_seat_writer',
  format(
    $query$
    SELECT plugin_data.csf_revoke_staff_position(
      'e8100000-0000-4000-8000-000000000001'::uuid,
      %L::uuid,
      NULL, 'Session two ends the restored seat',
      'e8000000-0000-4000-8000-000000000001'::uuid
    )::text
    $query$,
    (SELECT (payload->>'positionId')::uuid FROM csf_recovery_seat_results WHERE kind = 'restored-seat')
  )
);

SELECT pg_sleep(0.25);
SELECT extensions.is(
  extensions.dblink_is_busy('recovery_seat_writer'),
  1,
  'a concurrent revocation waits on the same organization lock the role edit holds'
);

COMMIT;

SELECT * FROM extensions.dblink_get_result('recovery_seat_writer', false) AS result(payload text);

SELECT extensions.ok(
  position(
    'This is the last active position that can still manage CSF staff access.'
    IN extensions.dblink_error_message('recovery_seat_writer')
  ) > 0,
  'the waiting revocation is refused once it observes the committed permission strip'
);

SELECT extensions.dblink_disconnect('recovery_seat_writer');

SELECT extensions.is(
  plugin_data.csf_count_recovery_staff_seats('e8100000-0000-4000-8000-000000000001', NULL),
  1,
  'a permission strip racing a revocation cannot drain the chapter to zero'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM csf_recovery_seat_results AS result
    JOIN plugin_data.csf_staff_positions AS position
      ON position.id = (result.payload->>'positionId')::uuid
    WHERE result.kind = 'restored-seat'
      AND position.status = 'active'
      AND position.revoked_at IS NULL
  ),
  'the surviving restored seat is still active and unrevoked after the race'
);

-- 42-53: a staff-only actor cannot keep mutating after waiting behind the
-- organization lock while a committed mutation removes their capability.
-- Keep one independent recovery seat throughout so the authorization race is
-- isolated from the recovery-floor refusal proved above.
INSERT INTO csf_recovery_seat_results (kind, payload)
SELECT 'stale-auth-backup-role', plugin_data.csf_create_custom_role(
  'e8100000-0000-4000-8000-000000000001',
  'Stale Authorization Backup',
  'Independent recovery seat',
  'Keeps staff recovery available while a queued actor loses authorization.',
  ARRAY['manage_roles'],
  'e8000000-0000-4000-8000-000000000001'
);
INSERT INTO csf_recovery_seat_results (kind, payload)
SELECT 'stale-auth-backup-seat', plugin_data.csf_assign_staff_position(
  'e8100000-0000-4000-8000-000000000001',
  'e8200000-0000-4000-8000-000000000006',
  (SELECT (payload->>'roleId')::uuid
   FROM csf_recovery_seat_results
   WHERE kind = 'stale-auth-backup-role'),
  '2026-2027', NULL, NULL, NULL,
  'Independent recovery seat for stale authorization races',
  'e8000000-0000-4000-8000-000000000001'
);
SELECT extensions.is(
  plugin_data.csf_count_recovery_staff_seats(
    'e8100000-0000-4000-8000-000000000001', NULL
  ),
  2,
  'the stale-authorization race starts with an independent recovery seat'
);

SELECT extensions.dblink_connect(
  'stale_staff_role_writer',
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
    'e8100000-0000-4000-8000-000000000001'
  )
);
SELECT extensions.dblink_send_query(
  'stale_staff_role_writer',
  format(
    $query$
    SELECT plugin_data.csf_update_role(
      'e8100000-0000-4000-8000-000000000001'::uuid,
      %L::uuid,
      'Unauthorized queued rewrite',
      'Must never persist',
      'The actor loses staff access while this request waits.',
      ARRAY['manage_finances']::text[],
      NULL,
      'e8000000-0000-4000-8000-000000000003'::uuid
    )::text
    $query$,
    (SELECT id
     FROM plugin_data.csf_roles
     WHERE organization_id = 'e8100000-0000-4000-8000-000000000001'
       AND key = 'treasurer')
  )
);
SELECT pg_sleep(0.25);
SELECT extensions.is(
  extensions.dblink_is_busy('stale_staff_role_writer'),
  1,
  'the staff-only role edit waits behind the organization lock'
);
SELECT plugin_data.csf_revoke_staff_position(
  'e8100000-0000-4000-8000-000000000001',
  (SELECT (payload->>'positionId')::uuid
   FROM csf_recovery_seat_results
   WHERE kind = 'restored-seat'),
  NULL,
  'Remove the queued actor staff capability',
  'e8000000-0000-4000-8000-000000000001'
);
COMMIT;

SELECT *
FROM extensions.dblink_get_result('stale_staff_role_writer', false)
  AS result(payload text);
SELECT extensions.ok(
  position(
    'Not authorized to manage CSF staff access.'
    IN extensions.dblink_error_message('stale_staff_role_writer')
  ) > 0,
  'the queued role edit rechecks authorization after acquiring the lock'
);
SELECT extensions.dblink_disconnect('stale_staff_role_writer');
SELECT extensions.is(
  (SELECT public_title
   FROM plugin_data.csf_roles
   WHERE organization_id = 'e8100000-0000-4000-8000-000000000001'
     AND key = 'treasurer'),
  'Treasurer',
  'the stale staff actor changes no role data'
);
SELECT extensions.is(
  (SELECT status
   FROM plugin_data.csf_staff_positions
   WHERE id = (
     SELECT (payload->>'positionId')::uuid
     FROM csf_recovery_seat_results
     WHERE kind = 'restored-seat'
   )),
  'ended',
  'the authorization revocation committed before the queued edit resumed'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'e8100000-0000-4000-8000-000000000001'
     AND actor_user_id = 'e8000000-0000-4000-8000-000000000003'
     AND action = 'role.update'
     AND after_data->>'publicTitle' = 'Unauthorized queued rewrite'),
  0,
  'the refused stale role edit writes no audit event'
);

INSERT INTO csf_recovery_seat_results (kind, payload)
SELECT 'stale-revoke-actor-role', plugin_data.csf_create_custom_role(
  'e8100000-0000-4000-8000-000000000001',
  'Stale Revocation Actor',
  'Queued staff actor',
  'Carries staff access until a concurrent role edit removes it.',
  ARRAY['manage_roles'],
  'e8000000-0000-4000-8000-000000000001'
);
INSERT INTO csf_recovery_seat_results (kind, payload)
SELECT 'stale-revoke-actor-seat', plugin_data.csf_assign_staff_position(
  'e8100000-0000-4000-8000-000000000001',
  'e8200000-0000-4000-8000-000000000002',
  (SELECT (payload->>'roleId')::uuid
   FROM csf_recovery_seat_results
   WHERE kind = 'stale-revoke-actor-role'),
  '2026-2027', NULL, NULL, NULL,
  'Queued staff-only actor for stale revocation race',
  'e8000000-0000-4000-8000-000000000001'
);
SELECT extensions.is(
  plugin_data.csf_count_recovery_staff_seats(
    'e8100000-0000-4000-8000-000000000001', NULL
  ),
  2,
  'a second staff-only actor is authorized before the revoke race'
);

SELECT extensions.dblink_connect(
  'stale_staff_revoke_writer',
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
    'e8100000-0000-4000-8000-000000000001'
  )
);
SELECT extensions.dblink_send_query(
  'stale_staff_revoke_writer',
  format(
    $query$
    SELECT plugin_data.csf_revoke_staff_position(
      'e8100000-0000-4000-8000-000000000001'::uuid,
      %L::uuid,
      NULL,
      'Queued actor must lose this revocation',
      'e8000000-0000-4000-8000-000000000002'::uuid
    )::text
    $query$,
    (SELECT (payload->>'positionId')::uuid
     FROM csf_recovery_seat_results
     WHERE kind = 'stale-auth-backup-seat')
  )
);
SELECT pg_sleep(0.25);
SELECT extensions.is(
  extensions.dblink_is_busy('stale_staff_revoke_writer'),
  1,
  'the staff-only revocation waits behind the organization lock'
);
SELECT plugin_data.csf_update_role(
  'e8100000-0000-4000-8000-000000000001',
  (SELECT (payload->>'roleId')::uuid
   FROM csf_recovery_seat_results
   WHERE kind = 'stale-revoke-actor-role'),
  'Stale Revocation Actor',
  'Queued staff actor',
  'Staff access removed before the queued revocation resumes.',
  ARRAY['manage_profiles'],
  NULL,
  'e8000000-0000-4000-8000-000000000001'
);
COMMIT;

SELECT *
FROM extensions.dblink_get_result('stale_staff_revoke_writer', false)
  AS result(payload text);
SELECT extensions.ok(
  position(
    'Not authorized to manage CSF staff access.'
    IN extensions.dblink_error_message('stale_staff_revoke_writer')
  ) > 0,
  'the queued revocation rechecks authorization after acquiring the lock'
);
SELECT extensions.dblink_disconnect('stale_staff_revoke_writer');
SELECT extensions.is(
  (SELECT status
   FROM plugin_data.csf_staff_positions
   WHERE id = (
     SELECT (payload->>'positionId')::uuid
     FROM csf_recovery_seat_results
     WHERE kind = 'stale-auth-backup-seat'
   )),
  'active',
  'the stale staff actor does not revoke the target position'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_staff_position_history
   WHERE organization_id = 'e8100000-0000-4000-8000-000000000001'
     AND actor_user_id = 'e8000000-0000-4000-8000-000000000002'
     AND action = 'revoke'
     AND staff_position_id = (
       SELECT (payload->>'positionId')::uuid
       FROM csf_recovery_seat_results
       WHERE kind = 'stale-auth-backup-seat'
     )),
  0,
  'the refused stale revocation writes no position history'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'e8100000-0000-4000-8000-000000000001'
     AND actor_user_id = 'e8000000-0000-4000-8000-000000000002'
     AND action = 'staff_position.revoke'
     AND target_id = (
       SELECT (payload->>'positionId')::uuid
       FROM csf_recovery_seat_results
       WHERE kind = 'stale-auth-backup-seat'
     )),
  0,
  'the refused stale revocation writes no admin audit event'
);
SELECT extensions.is(
  plugin_data.csf_count_recovery_staff_seats(
    'e8100000-0000-4000-8000-000000000001', NULL
  ),
  1,
  'the committed role edit leaves only the independent backup recovery seat'
);

-- The concurrency window commits on purpose so the second connection can
-- observe it. Keep this namespaced synthetic chapter for the remainder of the
-- disposable replay rather than defeating the immutable-audit trigger with
-- cleanup-only mutation.
DROP TABLE csf_recovery_seat_results;

SELECT * FROM extensions.finish();
