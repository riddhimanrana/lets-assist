-- Real two-connection proof for the attendance projection lock order
-- (contract 1.9). This file runs in autocommit so a dblink session observes
-- commits from the primary connection. Fixtures are fictional and removed at
-- both ends of the file.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(14);

CREATE OR REPLACE FUNCTION pg_temp.cleanup_attendance_race_fixtures()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_chapter constant uuid := 'a8100000-0000-4000-8000-000000000001';
BEGIN
  -- Remove chapter rows first so certificate deletion projects nothing.
  DELETE FROM plugin_data.csf_opportunities WHERE organization_id = v_chapter;
  DELETE FROM plugin_data.csf_point_submissions WHERE organization_id = v_chapter;
  DELETE FROM plugin_data.csf_attendance_projection_outcomes WHERE organization_id = v_chapter;
  DELETE FROM public.certificates
  WHERE project_id IN ('a8500000-0000-4000-8000-000000000001', 'a8500000-0000-4000-8000-000000000002');
  DELETE FROM public.hours_publication_receipts
  WHERE project_id IN ('a8500000-0000-4000-8000-000000000001', 'a8500000-0000-4000-8000-000000000002');
  DELETE FROM public.notifications
  WHERE user_id::text LIKE 'a8000000-0000-4000-8000-00000000000%';
  DELETE FROM public.project_signups
  WHERE project_id IN ('a8500000-0000-4000-8000-000000000001', 'a8500000-0000-4000-8000-000000000002');
  DELETE FROM public.projects
  WHERE id IN ('a8500000-0000-4000-8000-000000000001', 'a8500000-0000-4000-8000-000000000002');
  DELETE FROM plugin_data.csf_term_memberships WHERE organization_id = v_chapter;
  DELETE FROM plugin_data.csf_profile_accounts WHERE organization_id = v_chapter;
  DELETE FROM plugin_data.csf_profiles WHERE organization_id = v_chapter;
  DELETE FROM plugin_data.csf_term_policies WHERE organization_id = v_chapter;
  DELETE FROM plugin_data.csf_terms WHERE organization_id = v_chapter;
  DELETE FROM public.organization_plugin_installs WHERE organization_id = v_chapter;
  DELETE FROM public.organization_plugin_entitlements WHERE organization_id = v_chapter;
  DELETE FROM public.organization_members
  WHERE organization_id IN (v_chapter, 'a8100000-0000-4000-8000-000000000002');
  DELETE FROM public.organizations
  WHERE id IN (v_chapter, 'a8100000-0000-4000-8000-000000000002');
  DELETE FROM auth.users WHERE id::text LIKE 'a8000000-0000-4000-8000-00000000000%';
END;
$function$;

-- Audit rows are immutable; replica mode is confined to this transaction.
CREATE OR REPLACE FUNCTION pg_temp.cleanup_attendance_race_receipts()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  DELETE FROM plugin_data.csf_admin_audit_events
  WHERE organization_id = 'a8100000-0000-4000-8000-000000000001';
END;
$function$;

CREATE OR REPLACE FUNCTION pg_temp.attendance_race_dsn()
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

CREATE OR REPLACE FUNCTION pg_temp.wait_for_attendance_race_lock(p_pid integer)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_waiting boolean := false;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '15 seconds';
BEGIN
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_stat_activity AS activity
      WHERE activity.pid = p_pid AND activity.wait_event_type = 'Lock'
    ) INTO v_waiting;
    EXIT WHEN v_waiting OR pg_catalog.clock_timestamp() >= v_deadline;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  RETURN v_waiting;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.wait_for_attendance_race_result(p_connection text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_complete boolean := false;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '15 seconds';
BEGIN
  LOOP
    v_complete := extensions.dblink_is_busy(p_connection) = 0;
    EXIT WHEN v_complete OR pg_catalog.clock_timestamp() >= v_deadline;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  RETURN v_complete;
END;
$$;

BEGIN;
SET LOCAL session_replication_role = replica;
SELECT pg_temp.cleanup_attendance_race_receipts();
COMMIT;
SELECT pg_temp.cleanup_attendance_race_fixtures();

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('a8000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'race-officer@local.test', now(), '{}', '{"full_name":"Race Officer"}', now(), now()),
  ('a8000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'race-member@local.test', now(), '{}', '{"full_name":"Race Member"}', now(), now()),
  ('a8000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'race-partner@local.test', now(), '{}', '{"full_name":"Race Partner"}', now(), now()),
  ('a8000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'race-member-two@local.test', now(), '{}', '{"full_name":"Race Member Two"}', now(), now());
INSERT INTO public.organizations (id, name, username, type, join_code) VALUES
  ('a8100000-0000-4000-8000-000000000001', 'Race Chapter', 'race-chapter', 'school', '998101'),
  ('a8100000-0000-4000-8000-000000000002', 'Race Partner', 'race-partner', 'nonprofit', '998102');
INSERT INTO public.organization_members (organization_id, user_id, role, status) VALUES
  ('a8100000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('a8100000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('a8100000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000004', 'member', 'active'),
  ('a8100000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000003', 'admin', 'active');
INSERT INTO public.organization_plugin_installs (organization_id, plugin_key, installed_version, configuration, installed_by)
VALUES ('a8100000-0000-4000-8000-000000000001', 'dvhs-csf', '0.1.0', '{}', 'a8000000-0000-4000-8000-000000000001');
INSERT INTO public.organization_plugin_entitlements (organization_id, plugin_key, status, created_by)
VALUES ('a8100000-0000-4000-8000-000000000001', 'dvhs-csf', 'active', 'a8000000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_terms (id, organization_id, code, label, school_year, semester, lifecycle_status, is_current)
VALUES ('a8200000-0000-4000-8000-000000000001', 'a8100000-0000-4000-8000-000000000001', 'F41', 'Fall 2041', '2041-2042', 'fall', 'open', true);
INSERT INTO plugin_data.csf_term_policies (organization_id, term_id, max_points_per_activity, outside_volunteering_allowed, published_at)
VALUES ('a8100000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 3, true, now());
INSERT INTO plugin_data.csf_profiles (id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name, record_status) VALUES
  ('a8400000-0000-4000-8000-000000000002', 'a8100000-0000-4000-8000-000000000001', 'Race', 'Member', 'race', 'member', 'active'),
  ('a8400000-0000-4000-8000-000000000004', 'a8100000-0000-4000-8000-000000000001', 'Race', 'Two', 'race', 'two', 'active');
INSERT INTO plugin_data.csf_profile_accounts (id, organization_id, profile_id, user_id, status, is_primary) VALUES
  ('a8410000-0000-4000-8000-000000000002', 'a8100000-0000-4000-8000-000000000001', 'a8400000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000002', 'verified', true),
  ('a8410000-0000-4000-8000-000000000004', 'a8100000-0000-4000-8000-000000000001', 'a8400000-0000-4000-8000-000000000004', 'a8000000-0000-4000-8000-000000000004', 'verified', true);
INSERT INTO plugin_data.csf_term_memberships (organization_id, profile_id, term_id, status, accepted_at) VALUES
  ('a8100000-0000-4000-8000-000000000001', 'a8400000-0000-4000-8000-000000000002', 'a8200000-0000-4000-8000-000000000001', 'accepted', now()),
  ('a8100000-0000-4000-8000-000000000001', 'a8400000-0000-4000-8000-000000000004', 'a8200000-0000-4000-8000-000000000001', 'accepted', now());
INSERT INTO public.projects (
  id, creator_id, organization_id, title, location, description, event_type,
  verification_method, schedule, require_login, visibility
) VALUES
  ('a8500000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000003', 'a8100000-0000-4000-8000-000000000002',
   'Race Park Day', 'Park', 'Fictional', 'oneTime', 'manual',
   '{"oneTime":{"date":"2041-09-27","startTime":"09:00","endTime":"11:00","volunteers":10}}', true, 'public'),
  ('a8500000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000003', 'a8100000-0000-4000-8000-000000000002',
   'Race Garden Day', 'Garden', 'Fictional', 'oneTime', 'manual',
   '{"oneTime":{"date":"2041-09-28","startTime":"09:00","endTime":"11:00","volunteers":10}}', true, 'public');
INSERT INTO public.project_signups (id, project_id, user_id, schedule_id, status) VALUES
  ('a8600000-0000-4000-8000-000000000001', 'a8500000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000002', 'oneTime', 'approved'),
  ('a8600000-0000-4000-8000-000000000002', 'a8500000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000002', 'oneTime', 'approved'),
  ('a8600000-0000-4000-8000-000000000003', 'a8500000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000004', 'oneTime', 'approved');
INSERT INTO plugin_data.csf_opportunities (
  id, organization_id, term_id, title, body, status, signup_mode, linked_project_id,
  signup_url, point_value, point_type, requires_point_submission, evidence_policy,
  attendance_submission_mode, published_at, created_by_user_id
) VALUES
  ('a8700000-0000-4000-8000-000000000001', 'a8100000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001',
   'Race park', 'Park', 'published', 'lets_assist_project', 'a8500000-0000-4000-8000-000000000001',
   '/projects/a8500000-0000-4000-8000-000000000001', 1, 'non_drive', true, 'none', 'pending_submission', now(),
   'a8000000-0000-4000-8000-000000000001'),
  ('a8700000-0000-4000-8000-000000000002', 'a8100000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001',
   'Race garden', 'Garden', 'published', 'lets_assist_project', 'a8500000-0000-4000-8000-000000000002',
   '/projects/a8500000-0000-4000-8000-000000000002', 1, 'non_drive', true, 'none', 'off', now(),
   'a8000000-0000-4000-8000-000000000001');

-- 1-6 (R2): a member's in-flight claim holds the semester lock. The
-- organizer's publication runs under a short statement_timeout, never waits
-- for CSF, commits, and defers the source; a staff retry then attaches it.
SELECT extensions.dblink_connect('attendance_race_begin', pg_temp.attendance_race_dsn());
CREATE TEMP TABLE attendance_race_pids (label text PRIMARY KEY, pid integer NOT NULL);
INSERT INTO attendance_race_pids
SELECT 'begin', pid FROM extensions.dblink('attendance_race_begin', 'SELECT pg_backend_pid()') AS t(pid integer);
SELECT extensions.dblink_exec('attendance_race_begin', 'SET statement_timeout = 2000');
BEGIN;
SELECT plugin_data.csf_begin_point_submission_request_v2(
  'a8100000-0000-4000-8000-000000000001', 'a8400000-0000-4000-8000-000000000002',
  'a8200000-0000-4000-8000-000000000001', 'a8700000-0000-4000-8000-000000000001', NULL,
  'student', 'Park day', 1, 'non_drive', '2041-09-27',
  'a8000000-0000-4000-8000-000000000002', NULL, NULL, NULL, NULL,
  'a8900000-0000-4000-8000-000000000001', NULL);
SELECT extensions.dblink_send_query('attendance_race_begin', $query$
  SELECT public.publish_volunteer_hours_transactional(
    'a8000000-0000-4000-8000-000000000003', 'a8500000-0000-4000-8000-000000000001', 'oneTime',
    '[{"signupId":"a8600000-0000-4000-8000-000000000001","checkIn":"2041-09-27T16:00:00Z","checkOut":"2041-09-27T18:00:00Z"}]'::jsonb,
    'hours-publication:v1:7777777777777777777777777777777777777777777777777777777777777777'
  )::text
$query$);
SELECT extensions.ok(
  pg_temp.wait_for_attendance_race_result('attendance_race_begin'),
  'R2: the publication finishes while the member claim still holds the semester lock'
);
SELECT extensions.is(
  (SELECT payload::jsonb ->> 'outcome'
   FROM extensions.dblink_get_result('attendance_race_begin', false) AS result(payload text)),
  'accepted',
  'R2: the organizer publication commits instead of timing out'
);
COMMIT;
SELECT extensions.dblink_disconnect('attendance_race_begin');
SELECT extensions.is(
  (SELECT o.outcome || ':' || o.sqlstate FROM plugin_data.csf_attendance_projection_outcomes o
   JOIN public.certificates c ON c.id = o.certificate_id
   WHERE c.signup_id = 'a8600000-0000-4000-8000-000000000001'),
  'deferred:55P03',
  'R2: the contended source is deferred with its SQLSTATE'
);
SELECT extensions.ok(
  (plugin_data.csf_linked_project_attendance_summary(
    'a8100000-0000-4000-8000-000000000001', 'a8700000-0000-4000-8000-000000000001'
  ) ->> 'needsStaffAttention')::integer >= 1,
  'R2: a deferred source counts as needing staff attention'
);
SELECT plugin_data.csf_retry_activity_attendance_sync(
  'a8100000-0000-4000-8000-000000000001', 'a8700000-0000-4000-8000-000000000001',
  'a8000000-0000-4000-8000-000000000001', 'a8900000-0000-4000-8000-000000000003');
SELECT extensions.ok(
  (SELECT count(*) = 1 FROM plugin_data.csf_point_submissions
   WHERE opportunity_id = 'a8700000-0000-4000-8000-000000000001')
  AND EXISTS (
    SELECT 1 FROM plugin_data.csf_attendance_evidence e
    JOIN plugin_data.csf_point_submissions s ON s.id = e.submission_id
    WHERE s.opportunity_id = 'a8700000-0000-4000-8000-000000000001' AND s.source = 'student' AND e.state = 'active'
  ),
  'R2: the retry attaches the deferred evidence to the member''s own claim'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.certificates
   WHERE signup_id = 'a8600000-0000-4000-8000-000000000001' AND type = 'verified'),
  1,
  'R2: the verified certificate committed with the publication'
);

-- 5-8: enabling waits for an in-flight publication and backfills its certificates.
SELECT extensions.dblink_connect('attendance_race_enable', pg_temp.attendance_race_dsn());
INSERT INTO attendance_race_pids
SELECT 'enable', pid FROM extensions.dblink('attendance_race_enable', 'SELECT pg_backend_pid()') AS t(pid integer);
BEGIN;
SELECT public.publish_volunteer_hours_transactional(
  'a8000000-0000-4000-8000-000000000003', 'a8500000-0000-4000-8000-000000000002', 'oneTime',
  '[{"signupId":"a8600000-0000-4000-8000-000000000002","checkIn":"2041-09-28T16:00:00Z","checkOut":"2041-09-28T18:00:00Z"},
    {"signupId":"a8600000-0000-4000-8000-000000000003","checkIn":"2041-09-28T16:00:00Z","checkOut":"2041-09-28T18:00:00Z"}]'::jsonb,
  'hours-publication:v1:8888888888888888888888888888888888888888888888888888888888888888'
);
SELECT extensions.dblink_send_query('attendance_race_enable', $query$
  SELECT plugin_data.csf_set_activity_attendance_submissions(
    'a8100000-0000-4000-8000-000000000001', 'a8700000-0000-4000-8000-000000000002', 'pending_submission',
    'a8000000-0000-4000-8000-000000000001', 'a8900000-0000-4000-8000-000000000002'
  )::text
$query$);
SELECT extensions.ok(
  pg_temp.wait_for_attendance_race_lock((SELECT pid FROM attendance_race_pids WHERE label = 'enable')),
  'enabling waits on the project row held by the uncommitted publication'
);
COMMIT;
SELECT extensions.ok(
  pg_temp.wait_for_attendance_race_result('attendance_race_enable'),
  'enabling completes after the publication commits'
);
SELECT extensions.is(
  (SELECT payload::jsonb -> 'backfill' ->> 'projected'
   FROM extensions.dblink_get_result('attendance_race_enable', false) AS result(payload text)),
  '2',
  'the backfill sees both certificates the concurrent publication committed'
);
SELECT extensions.dblink_disconnect('attendance_race_enable');
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE opportunity_id = 'a8700000-0000-4000-8000-000000000002' AND source = 'attendance'),
  2,
  'no certificate is missed or duplicated across the publication and enable race'
);

-- 12-16: an account unlink is in flight while late attendance is written.
-- The host write never waits for CSF; the source is deferred and a later
-- retry sees the committed unlink.
UPDATE public.project_signups SET status = 'attended',
  check_in_time = '2041-09-27T16:30:00Z', check_out_time = '2041-09-27T18:00:00Z'
WHERE id = 'a8600000-0000-4000-8000-000000000001';
INSERT INTO public.project_signups (id, project_id, user_id, schedule_id, status)
VALUES ('a8600000-0000-4000-8000-000000000004', 'a8500000-0000-4000-8000-000000000001',
  'a8000000-0000-4000-8000-000000000004', 'oneTime', 'approved');
SELECT extensions.dblink_connect('attendance_race_unlink', pg_temp.attendance_race_dsn());
INSERT INTO attendance_race_pids
SELECT 'unlink', pid FROM extensions.dblink('attendance_race_unlink', 'SELECT pg_backend_pid()') AS t(pid integer);
BEGIN;
SELECT plugin_data.csf_unlink_profile_account(
  'a8100000-0000-4000-8000-000000000001', 'a8400000-0000-4000-8000-000000000004',
  'a8410000-0000-4000-8000-000000000004', 'Fixture unlink during publication',
  'a8000000-0000-4000-8000-000000000001');
SELECT extensions.dblink_send_query('attendance_race_unlink', $query$
  UPDATE public.project_signups SET status = 'attended',
    check_in_time = '2041-09-27T16:00:00Z', check_out_time = '2041-09-27T18:00:00Z'
  WHERE id = 'a8600000-0000-4000-8000-000000000004'
  RETURNING id::text
$query$);
SELECT extensions.ok(
  pg_temp.wait_for_attendance_race_result('attendance_race_unlink'),
  'the attendance write completes while the unlink is still uncommitted'
);
COMMIT;
SELECT plugin_data.csf_retry_activity_attendance_sync(
  'a8100000-0000-4000-8000-000000000001', 'a8700000-0000-4000-8000-000000000001',
  'a8000000-0000-4000-8000-000000000001', 'a8900000-0000-4000-8000-000000000004');
SELECT extensions.is(
  (SELECT payload FROM extensions.dblink_get_result('attendance_race_unlink', false) AS result(payload text)),
  'a8600000-0000-4000-8000-000000000004',
  'the host attendance write commits without a deadlock'
);
SELECT extensions.dblink_disconnect('attendance_race_unlink');
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM public.certificates WHERE signup_id = 'a8600000-0000-4000-8000-000000000004' AND type = 'verified'),
  'the late verified certificate exists'
);
SELECT extensions.ok(
  NOT EXISTS (SELECT 1 FROM plugin_data.csf_point_submissions
    WHERE profile_id = 'a8400000-0000-4000-8000-000000000004' AND opportunity_id = 'a8700000-0000-4000-8000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM plugin_data.csf_attendance_evidence
    WHERE user_id = 'a8000000-0000-4000-8000-000000000004' AND state = 'active'),
  'a certificate projected after the unlink commits creates no claim and no active evidence'
);

BEGIN;
SET LOCAL session_replication_role = replica;
SELECT pg_temp.cleanup_attendance_race_receipts();
COMMIT;
SELECT pg_temp.cleanup_attendance_race_fixtures();
BEGIN;
SET LOCAL session_replication_role = replica;
SELECT pg_temp.cleanup_attendance_race_receipts();
COMMIT;
SELECT pg_temp.cleanup_attendance_race_fixtures();
DROP TABLE attendance_race_pids;

SELECT * FROM extensions.finish();
