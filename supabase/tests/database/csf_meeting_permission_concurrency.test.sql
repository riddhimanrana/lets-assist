-- Two-session proof that a correction queued behind staff-access mutation
-- rechecks both exact authority and active membership after the shared lock.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SELECT extensions.plan(8);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'ed000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'meeting-permission-race@local.test',
  now(), '{}', '{}', now(), now()
);
INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ed100000-0000-4000-8000-000000000001',
  'Meeting Permission Race', 'meeting-permission-race', 'school', '995201'
);
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'ed100000-0000-4000-8000-000000000001',
  'ed000000-0000-4000-8000-000000000001',
  'member', 'active'
);
INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, role_type, is_system
) VALUES (
  'ed200000-0000-4000-8000-000000000001',
  'ed100000-0000-4000-8000-000000000001',
  'meeting-race-reconciler', 'Meeting race reconciler', 'custom', false
);
INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key, enabled
) VALUES (
  'ed100000-0000-4000-8000-000000000001',
  'ed200000-0000-4000-8000-000000000001',
  'reconcile_meeting_attendance', true
);
INSERT INTO plugin_data.csf_staff_positions (
  id, organization_id, user_id, role_id, school_year, display_title, status
) VALUES (
  'ed300000-0000-4000-8000-000000000001',
  'ed100000-0000-4000-8000-000000000001',
  'ed000000-0000-4000-8000-000000000001',
  'ed200000-0000-4000-8000-000000000001',
  '2051-2052', 'Meeting reconciler', 'active'
);
INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, lifecycle_status
) VALUES (
  'ed400000-0000-4000-8000-000000000001',
  'ed100000-0000-4000-8000-000000000001',
  'F51', 'Fall 2051', '2051-2052', 'fall', 'open'
);
INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES (
  'ed500000-0000-4000-8000-000000000001',
  'ed100000-0000-4000-8000-000000000001',
  'Race', 'Member', 'race', 'member'
);
INSERT INTO plugin_data.csf_term_meetings (
  id, organization_id, term_id, meeting_key, label, meeting_date
) VALUES (
  'ed600000-0000-4000-8000-000000000001',
  'ed100000-0000-4000-8000-000000000001',
  'ed400000-0000-4000-8000-000000000001',
  'race-meeting', 'Race meeting', '2051-09-10'
);

CREATE TEMP TABLE csf_meeting_permission_race_results (
  key text PRIMARY KEY,
  observed boolean NOT NULL
) ON COMMIT PRESERVE ROWS;

SELECT extensions.dblink_connect(
  'meeting_permission_revoked_writer',
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
    'ed100000-0000-4000-8000-000000000001'
  )
);
SELECT extensions.dblink_send_query(
  'meeting_permission_revoked_writer',
  $query$
    SELECT plugin_data.csf_correct_meeting_attendance(
      'ed100000-0000-4000-8000-000000000001'::uuid,
      'ed600000-0000-4000-8000-000000000001'::uuid,
      'ed500000-0000-4000-8000-000000000001'::uuid,
      'set', 'attended', 'Queued behind reconciliation revocation.',
      'ed000000-0000-4000-8000-000000000001'::uuid,
      'edf00000-0000-4000-8000-000000000001'::uuid
    )::text
  $query$
);
DO $wait_for_permission_lock$
DECLARE
  v_waiting boolean := false;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '2 seconds';
BEGIN
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_stat_activity AS activity
      WHERE activity.pid <> pg_catalog.pg_backend_pid()
        AND activity.query LIKE '%edf00000-0000-4000-8000-000000000001%'
        AND activity.wait_event_type = 'Lock'
        AND activity.wait_event = 'advisory'
    ) INTO v_waiting;
    EXIT WHEN v_waiting OR pg_catalog.clock_timestamp() >= v_deadline;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  INSERT INTO csf_meeting_permission_race_results (key, observed)
  VALUES ('permission_wait', v_waiting);
END
$wait_for_permission_lock$;
SELECT extensions.ok(
  (SELECT observed FROM csf_meeting_permission_race_results
   WHERE key = 'permission_wait'),
  'the correction waits behind the staff-access lock'
);
UPDATE plugin_data.csf_role_permissions
SET enabled = false
WHERE organization_id = 'ed100000-0000-4000-8000-000000000001'
  AND role_id = 'ed200000-0000-4000-8000-000000000001'
  AND permission_key = 'reconcile_meeting_attendance';
COMMIT;

SELECT *
FROM extensions.dblink_get_result('meeting_permission_revoked_writer', false)
  AS result(payload text);
SELECT extensions.ok(
  position(
    'Not authorized for the requested CSF meeting operation.'
    IN extensions.dblink_error_message('meeting_permission_revoked_writer')
  ) > 0,
  'the queued correction rechecks the revoked permission after the lock'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_meeting_attendance
   WHERE organization_id = 'ed100000-0000-4000-8000-000000000001'),
  0,
  'the permission-revoked correction writes no attendance'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'edf00000-0000-4000-8000-000000000001'),
  0,
  'the permission-revoked correction writes no audit receipt'
);
SELECT extensions.dblink_disconnect('meeting_permission_revoked_writer');

UPDATE plugin_data.csf_role_permissions
SET enabled = true
WHERE organization_id = 'ed100000-0000-4000-8000-000000000001'
  AND role_id = 'ed200000-0000-4000-8000-000000000001'
  AND permission_key = 'reconcile_meeting_attendance';

SELECT extensions.dblink_connect(
  'meeting_membership_revoked_writer',
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
    'ed100000-0000-4000-8000-000000000001'
  )
);
SELECT extensions.dblink_send_query(
  'meeting_membership_revoked_writer',
  $query$
    SELECT plugin_data.csf_correct_meeting_attendance(
      'ed100000-0000-4000-8000-000000000001'::uuid,
      'ed600000-0000-4000-8000-000000000001'::uuid,
      'ed500000-0000-4000-8000-000000000001'::uuid,
      'set', 'attended', 'Queued behind membership revocation.',
      'ed000000-0000-4000-8000-000000000001'::uuid,
      'edf00000-0000-4000-8000-000000000002'::uuid
    )::text
  $query$
);
DO $wait_for_membership_lock$
DECLARE
  v_waiting boolean := false;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '2 seconds';
BEGIN
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_stat_activity AS activity
      WHERE activity.pid <> pg_catalog.pg_backend_pid()
        AND activity.query LIKE '%edf00000-0000-4000-8000-000000000002%'
        AND activity.wait_event_type = 'Lock'
        AND activity.wait_event = 'advisory'
    ) INTO v_waiting;
    EXIT WHEN v_waiting OR pg_catalog.clock_timestamp() >= v_deadline;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  INSERT INTO csf_meeting_permission_race_results (key, observed)
  VALUES ('membership_wait', v_waiting);
END
$wait_for_membership_lock$;
SELECT extensions.ok(
  (SELECT observed FROM csf_meeting_permission_race_results
   WHERE key = 'membership_wait'),
  'the second correction also waits behind the staff-access lock'
);
UPDATE public.organization_members
SET status = 'inactive'
WHERE organization_id = 'ed100000-0000-4000-8000-000000000001'
  AND user_id = 'ed000000-0000-4000-8000-000000000001';
COMMIT;

SELECT *
FROM extensions.dblink_get_result('meeting_membership_revoked_writer', false)
  AS result(payload text);
SELECT extensions.ok(
  position(
    'Not authorized for the requested CSF meeting operation.'
    IN extensions.dblink_error_message('meeting_membership_revoked_writer')
  ) > 0,
  'the queued correction rechecks active membership after the lock'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_meeting_attendance
   WHERE organization_id = 'ed100000-0000-4000-8000-000000000001'),
  0,
  'the membership-revoked correction writes no attendance'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'edf00000-0000-4000-8000-000000000002'),
  0,
  'the membership-revoked correction writes no audit receipt'
);
SELECT extensions.dblink_disconnect('meeting_membership_revoked_writer');

DELETE FROM plugin_data.csf_staff_positions
WHERE organization_id = 'ed100000-0000-4000-8000-000000000001';
DELETE FROM plugin_data.csf_role_permissions
WHERE organization_id = 'ed100000-0000-4000-8000-000000000001';
DELETE FROM plugin_data.csf_roles
WHERE organization_id = 'ed100000-0000-4000-8000-000000000001';
DELETE FROM plugin_data.csf_term_meetings
WHERE organization_id = 'ed100000-0000-4000-8000-000000000001';
DELETE FROM plugin_data.csf_profiles
WHERE organization_id = 'ed100000-0000-4000-8000-000000000001';
DELETE FROM plugin_data.csf_terms
WHERE organization_id = 'ed100000-0000-4000-8000-000000000001';
DELETE FROM public.organization_members
WHERE organization_id = 'ed100000-0000-4000-8000-000000000001';
DELETE FROM public.organizations
WHERE id = 'ed100000-0000-4000-8000-000000000001';
DELETE FROM auth.users
WHERE id = 'ed000000-0000-4000-8000-000000000001';

SELECT * FROM extensions.finish();
