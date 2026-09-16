-- Two-session proof that writing a member-visible profile note, and
-- withdrawing one, both recheck authority after the shared staff-access lock.
--
-- The single-session tests can only show that the lock, the membership share
-- lock, and the recheck are present in the function body. They cannot show
-- that the recheck observes a revocation that committed while the mutation was
-- queued, because nothing in one session ever queues. That is the property
-- worth proving: an officer whose authority was removed while their note was
-- waiting must not commit it, and must leave nothing behind when refused.
--
-- Both functions are VOLATILE PL/pgSQL, so in READ COMMITTED each statement
-- inside them takes a fresh snapshot. The recheck that runs after the advisory
-- lock is released therefore sees the revocation that committed while the
-- caller waited. These fixtures commit, so the file cleans up explicitly at the
-- end rather than relying on a surrounding transaction.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SELECT extensions.plan(17);

-- ---------------------------------------------------------------------------
-- Fixtures
--
-- An independent synthetic tenant. The officer is an ordinary organization
-- member, not an admin: an admin short-circuits csf_actor_has_permission, and
-- a revocation that the permission check never consults would prove nothing.
-- Authority comes from a real custom role carrying manage_profiles, held
-- through an active staff position in the current school year.
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'eb000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'csf-note-authority-race@local.test',
  now(), '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'eb100000-0000-4000-8000-000000000001',
  'CSF Note Authority Race', 'csf-note-authority-race', 'school', '999301'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'eb100000-0000-4000-8000-000000000001',
  'eb000000-0000-4000-8000-000000000001',
  'member', 'active'
);

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, role_type, is_system
) VALUES (
  'eb200000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000001',
  'note-race-records', 'Note race records officer', 'custom', false
);

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key, enabled
) VALUES (
  'eb100000-0000-4000-8000-000000000001',
  'eb200000-0000-4000-8000-000000000001',
  'manage_profiles', true
);

INSERT INTO plugin_data.csf_staff_positions (
  id, organization_id, user_id, role_id, school_year, display_title,
  status, starts_at, ends_at
) VALUES (
  'eb300000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000001',
  'eb000000-0000-4000-8000-000000000001',
  'eb200000-0000-4000-8000-000000000001',
  '2052-2053', 'Records officer', 'active',
  current_date - 1, current_date + 30
);

-- csf_actor_has_permission only honours a staff position whose school year has
-- a current term, so the fixture needs one.
INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  lifecycle_status, is_current
) VALUES (
  'eb400000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000001',
  'F52', 'Fall 2052', '2052-2053', 'fall', 'open', true
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES (
  'eb500000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000001',
  'Noa', 'Raceward', 'noa', 'raceward'
);

CREATE TEMP TABLE csf_note_authority_race_results (
  key text PRIMARY KEY,
  observed boolean NOT NULL
) ON COMMIT PRESERVE ROWS;

CREATE FUNCTION pg_temp.csf_note_authority_race_dsn()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT 'hostaddr=' || host(inet_server_addr()) ||
    ' port=' || current_setting('port') ||
    ' dbname=' || current_database() ||
    ' user=' || current_user ||
    ' password=' || current_user ||
    ' sslmode=disable'
$$;

-- ---------------------------------------------------------------------------
-- 1-4. Creating a member-visible note, queued behind a permission revocation
--
-- The writer passes the pre-lock permission check while the capability is still
-- enabled, then blocks. The revocation commits underneath it. The recheck after
-- the lock must refuse, and nothing may be left behind.
-- ---------------------------------------------------------------------------

SELECT extensions.dblink_connect(
  'note_permission_revoked_writer',
  pg_temp.csf_note_authority_race_dsn()
);

BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key(
    'eb100000-0000-4000-8000-000000000001'
  )
);
SELECT extensions.dblink_send_query(
  'note_permission_revoked_writer',
  $query$
    SELECT plugin_data.csf_add_profile_note(
      'eb100000-0000-4000-8000-000000000001'::uuid,
      'eb000000-0000-4000-8000-000000000001'::uuid,
      'eb500000-0000-4000-8000-000000000001'::uuid,
      NULL,
      'info',
      'Queued behind a capability revocation; must never reach the member.',
      'member'
    )::text
  $query$
);
DO $wait_permission$
DECLARE
  v_waiting boolean := false;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '15 seconds';
  v_lock_key bigint := plugin_data.csf_staff_access_lock_key(
    'eb100000-0000-4000-8000-000000000001'
  );
BEGIN
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_locks AS waiting_lock
      WHERE waiting_lock.pid <> pg_catalog.pg_backend_pid()
        AND waiting_lock.locktype = 'advisory'
        AND NOT waiting_lock.granted
        AND waiting_lock.classid::bigint = ((v_lock_key >> 32) & 4294967295)
        AND waiting_lock.objid::bigint = (v_lock_key & 4294967295)
        AND waiting_lock.objsubid = 1
    ) INTO v_waiting;
    EXIT WHEN v_waiting OR pg_catalog.clock_timestamp() >= v_deadline;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  -- Recorded rather than asserted here so the plan count stays stable if the
  -- wait times out; the assertion reads this row immediately below.
  INSERT INTO csf_note_authority_race_results (key, observed)
  VALUES ('permission_wait', v_waiting);
END
$wait_permission$;
SELECT extensions.ok(
  (SELECT observed FROM csf_note_authority_race_results
   WHERE key = 'permission_wait'),
  'the queued note write waits behind the staff-access lock'
);
UPDATE plugin_data.csf_role_permissions
SET enabled = false
WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'
  AND role_id = 'eb200000-0000-4000-8000-000000000001'
  AND permission_key = 'manage_profiles';
COMMIT;

SELECT *
FROM extensions.dblink_get_result('note_permission_revoked_writer', false)
  AS result(payload text);
SELECT extensions.ok(
  position(
    'Not authorized to write CSF member notes.'
    IN extensions.dblink_error_message('note_permission_revoked_writer')
  ) > 0,
  'the queued note write rechecks the revoked capability after the lock'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_notes
   WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'),
  0,
  'the capability-revoked note write leaves no note row'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'
     AND action = 'profile.note_published'),
  0,
  'the capability-revoked note write leaves no publication receipt'
);
SELECT extensions.dblink_disconnect('note_permission_revoked_writer');

UPDATE plugin_data.csf_role_permissions
SET enabled = true
WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'
  AND role_id = 'eb200000-0000-4000-8000-000000000001'
  AND permission_key = 'manage_profiles';

-- ---------------------------------------------------------------------------
-- 5-8. The same write, queued behind a host-membership deactivation
--
-- Here the capability is untouched. What is removed is the actor's active
-- organization membership, which the note write holds FOR SHARE after the
-- advisory lock.
-- ---------------------------------------------------------------------------

SELECT extensions.dblink_connect(
  'note_membership_revoked_writer',
  pg_temp.csf_note_authority_race_dsn()
);

BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key(
    'eb100000-0000-4000-8000-000000000001'
  )
);
SELECT extensions.dblink_send_query(
  'note_membership_revoked_writer',
  $query$
    SELECT plugin_data.csf_add_profile_note(
      'eb100000-0000-4000-8000-000000000001'::uuid,
      'eb000000-0000-4000-8000-000000000001'::uuid,
      'eb500000-0000-4000-8000-000000000001'::uuid,
      NULL,
      'info',
      'Queued behind a membership deactivation; must never reach the member.',
      'member'
    )::text
  $query$
);
DO $wait_membership$
DECLARE
  v_waiting boolean := false;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '15 seconds';
  v_lock_key bigint := plugin_data.csf_staff_access_lock_key(
    'eb100000-0000-4000-8000-000000000001'
  );
BEGIN
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_locks AS waiting_lock
      WHERE waiting_lock.pid <> pg_catalog.pg_backend_pid()
        AND waiting_lock.locktype = 'advisory'
        AND NOT waiting_lock.granted
        AND waiting_lock.classid::bigint = ((v_lock_key >> 32) & 4294967295)
        AND waiting_lock.objid::bigint = (v_lock_key & 4294967295)
        AND waiting_lock.objsubid = 1
    ) INTO v_waiting;
    EXIT WHEN v_waiting OR pg_catalog.clock_timestamp() >= v_deadline;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  -- Recorded rather than asserted here so the plan count stays stable if the
  -- wait times out; the assertion reads this row immediately below.
  INSERT INTO csf_note_authority_race_results (key, observed)
  VALUES ('membership_wait', v_waiting);
END
$wait_membership$;
SELECT extensions.ok(
  (SELECT observed FROM csf_note_authority_race_results
   WHERE key = 'membership_wait'),
  'the second queued note write also waits behind the staff-access lock'
);
UPDATE public.organization_members
SET status = 'inactive'
WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'
  AND user_id = 'eb000000-0000-4000-8000-000000000001';
COMMIT;

SELECT *
FROM extensions.dblink_get_result('note_membership_revoked_writer', false)
  AS result(payload text);
SELECT extensions.ok(
  position(
    'Not authorized to write CSF member notes.'
    IN extensions.dblink_error_message('note_membership_revoked_writer')
  ) > 0,
  'the queued note write rechecks active host membership after the lock'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_notes
   WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'),
  0,
  'the membership-revoked note write leaves no note row'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'
     AND action = 'profile.note_published'),
  0,
  'the membership-revoked note write leaves no publication receipt'
);
SELECT extensions.dblink_disconnect('note_membership_revoked_writer');

UPDATE public.organization_members
SET status = 'active'
WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'
  AND user_id = 'eb000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- 9-13. Withdrawing a published comment, queued behind a revocation
--
-- Withdrawal is the other half of the audience control and carries the same
-- authority. A refused withdrawal must leave the comment exactly as published
-- rather than half-applying it.
-- ---------------------------------------------------------------------------

SELECT plugin_data.csf_add_profile_note(
  'eb100000-0000-4000-8000-000000000001'::uuid,
  'eb000000-0000-4000-8000-000000000001'::uuid,
  'eb500000-0000-4000-8000-000000000001'::uuid,
  NULL,
  'correction',
  'Published while the officer still held the capability.',
  'member'
);

SELECT extensions.is(
  (SELECT visibility FROM plugin_data.csf_profile_notes
   WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'),
  'member',
  'an authorized officer publishes the comment the withdrawal will target'
);

SELECT extensions.dblink_connect(
  'note_withdrawal_revoked_writer',
  pg_temp.csf_note_authority_race_dsn()
);

BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key(
    'eb100000-0000-4000-8000-000000000001'
  )
);
SELECT extensions.dblink_send_query(
  'note_withdrawal_revoked_writer',
  pg_catalog.format(
    $query$
      SELECT plugin_data.csf_restrict_profile_note_to_officers(
        'eb100000-0000-4000-8000-000000000001'::uuid,
        'eb000000-0000-4000-8000-000000000001'::uuid,
        %L::uuid,
        'Queued behind a capability revocation.'
      )::text
    $query$,
    (SELECT id FROM plugin_data.csf_profile_notes
     WHERE organization_id = 'eb100000-0000-4000-8000-000000000001')
  )
);
DO $wait_withdrawal$
DECLARE
  v_waiting boolean := false;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '15 seconds';
  v_lock_key bigint := plugin_data.csf_staff_access_lock_key(
    'eb100000-0000-4000-8000-000000000001'
  );
BEGIN
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_locks AS waiting_lock
      WHERE waiting_lock.pid <> pg_catalog.pg_backend_pid()
        AND waiting_lock.locktype = 'advisory'
        AND NOT waiting_lock.granted
        AND waiting_lock.classid::bigint = ((v_lock_key >> 32) & 4294967295)
        AND waiting_lock.objid::bigint = (v_lock_key & 4294967295)
        AND waiting_lock.objsubid = 1
    ) INTO v_waiting;
    EXIT WHEN v_waiting OR pg_catalog.clock_timestamp() >= v_deadline;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  -- Recorded rather than asserted here so the plan count stays stable if the
  -- wait times out; the assertion reads this row immediately below.
  INSERT INTO csf_note_authority_race_results (key, observed)
  VALUES ('withdrawal_wait', v_waiting);
END
$wait_withdrawal$;
SELECT extensions.ok(
  (SELECT observed FROM csf_note_authority_race_results
   WHERE key = 'withdrawal_wait'),
  'the queued withdrawal waits behind the staff-access lock'
);
UPDATE plugin_data.csf_role_permissions
SET enabled = false
WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'
  AND role_id = 'eb200000-0000-4000-8000-000000000001'
  AND permission_key = 'manage_profiles';
COMMIT;

SELECT *
FROM extensions.dblink_get_result('note_withdrawal_revoked_writer', false)
  AS result(payload text);
SELECT extensions.ok(
  position(
    'Not authorized to change CSF member notes.'
    IN extensions.dblink_error_message('note_withdrawal_revoked_writer')
  ) > 0,
  'the queued withdrawal rechecks the revoked capability after the lock'
);
SELECT extensions.is(
  (SELECT visibility FROM plugin_data.csf_profile_notes
   WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'),
  'member',
  'the refused withdrawal leaves the published comment exactly as it was'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'
     AND action = 'profile.note_withdrawn'),
  0,
  'the refused withdrawal leaves no withdrawal receipt'
);
SELECT extensions.dblink_disconnect('note_withdrawal_revoked_writer');

UPDATE plugin_data.csf_role_permissions
SET enabled = true
WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'
  AND role_id = 'eb200000-0000-4000-8000-000000000001'
  AND permission_key = 'manage_profiles';

-- ---------------------------------------------------------------------------
-- 14-17. The other order: the note mutation wins the lock first
--
-- A revocation arriving second must wait for the in-flight note mutation rather
-- than tearing it in half, the mutation that won must stay committed, and the
-- next mutation by the now-deprivileged officer must fail.
-- ---------------------------------------------------------------------------

SELECT extensions.dblink_connect(
  'note_mutation_first_writer',
  pg_temp.csf_note_authority_race_dsn()
);
SELECT extensions.dblink_exec('note_mutation_first_writer', 'BEGIN');
SELECT *
FROM extensions.dblink(
  'note_mutation_first_writer',
  $query$
    SELECT plugin_data.csf_add_profile_note(
      'eb100000-0000-4000-8000-000000000001'::uuid,
      'eb000000-0000-4000-8000-000000000001'::uuid,
      'eb500000-0000-4000-8000-000000000001'::uuid,
      NULL,
      'info',
      'Committed while the officer still held the capability.',
      'member'
    )::text
  $query$
) AS held(payload text);

-- csf_update_role and csf_revoke_staff_position take this exact key, so a
-- revocation arriving now would block here. Probing it without blocking keeps
-- the test bounded while proving the mutation really holds the lock for its
-- whole transaction rather than releasing it mid-flight.
BEGIN;
SELECT extensions.ok(
  NOT pg_catalog.pg_try_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(
      'eb100000-0000-4000-8000-000000000001'
    )
  ),
  'a revocation arriving second cannot take the staff-access lock while the note mutation holds it'
);
COMMIT;

SELECT extensions.dblink_exec('note_mutation_first_writer', 'COMMIT');
SELECT extensions.dblink_disconnect('note_mutation_first_writer');

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_notes
   WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'
     AND visibility = 'member'),
  2,
  'the note mutation that won the lock stays committed'
);

UPDATE plugin_data.csf_role_permissions
SET enabled = false
WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'
  AND role_id = 'eb200000-0000-4000-8000-000000000001'
  AND permission_key = 'manage_profiles';

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_add_profile_note(
      'eb100000-0000-4000-8000-000000000001'::uuid,
      'eb000000-0000-4000-8000-000000000001'::uuid,
      'eb500000-0000-4000-8000-000000000001'::uuid,
      NULL, 'info', 'Attempted after the revocation committed.', 'member'
    )
  $$,
  '42501',
  'Not authorized to write CSF member notes.',
  'the next note write by the deprivileged officer is refused once the revocation commits'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_notes
   WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'
     AND visibility = 'member'),
  2,
  'the refusal after revocation changes nothing that was already committed'
);

-- ---------------------------------------------------------------------------
-- Cleanup
--
-- These fixtures committed, so they are removed by hand in dependency order,
-- the same way every other committed-fixture concurrency test in this suite
-- cleans up after itself.
-- ---------------------------------------------------------------------------

-- The audit rows are intentionally immutable at runtime, and the trigger
-- refuses an organization cascade too, so replica mode is scoped to this one
-- test-only statement and restored before ordinary FK cleanup.
SET session_replication_role = replica;
DELETE FROM plugin_data.csf_admin_audit_events
WHERE organization_id = 'eb100000-0000-4000-8000-000000000001';
SET session_replication_role = origin;

DELETE FROM plugin_data.csf_profile_notes
WHERE organization_id = 'eb100000-0000-4000-8000-000000000001';
DELETE FROM plugin_data.csf_staff_positions
WHERE organization_id = 'eb100000-0000-4000-8000-000000000001';
DELETE FROM plugin_data.csf_role_permissions
WHERE organization_id = 'eb100000-0000-4000-8000-000000000001';
DELETE FROM plugin_data.csf_roles
WHERE organization_id = 'eb100000-0000-4000-8000-000000000001';
DELETE FROM plugin_data.csf_profiles
WHERE organization_id = 'eb100000-0000-4000-8000-000000000001';
DELETE FROM plugin_data.csf_terms
WHERE organization_id = 'eb100000-0000-4000-8000-000000000001';
DELETE FROM public.organization_members
WHERE organization_id = 'eb100000-0000-4000-8000-000000000001';
DELETE FROM public.organizations
WHERE id = 'eb100000-0000-4000-8000-000000000001';
DELETE FROM auth.users
WHERE id = 'eb000000-0000-4000-8000-000000000001';

DROP TABLE csf_note_authority_race_results;

SELECT * FROM extensions.finish();
