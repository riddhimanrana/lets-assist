-- Real two-connection proof for the attendance projection lock order
-- (contract 1.9). This file runs in autocommit so a dblink session observes
-- commits from the primary connection. Fixtures are fictional and removed at
-- both ends of the file.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(48);

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

-- N1 fixture: fifteen fictional chapters linking one partner project.
CREATE OR REPLACE FUNCTION pg_temp.cleanup_attendance_multi_fixtures()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  DELETE FROM plugin_data.csf_opportunities WHERE organization_id::text LIKE 'a8c10000-%';
  DELETE FROM plugin_data.csf_point_submissions WHERE organization_id::text LIKE 'a8c10000-%';
  DELETE FROM plugin_data.csf_attendance_projection_outcomes WHERE organization_id::text LIKE 'a8c10000-%';
  DELETE FROM public.certificates WHERE project_id = 'a8500000-0000-4000-8000-000000000003';
  DELETE FROM public.hours_publication_receipts WHERE project_id = 'a8500000-0000-4000-8000-000000000003';
  DELETE FROM public.notifications WHERE user_id = 'a8000000-0000-4000-8000-000000000005';
  DELETE FROM public.project_signups WHERE project_id = 'a8500000-0000-4000-8000-000000000003';
  DELETE FROM public.projects WHERE id = 'a8500000-0000-4000-8000-000000000003';
  DELETE FROM plugin_data.csf_term_memberships WHERE organization_id::text LIKE 'a8c10000-%';
  DELETE FROM plugin_data.csf_profile_accounts WHERE organization_id::text LIKE 'a8c10000-%';
  DELETE FROM plugin_data.csf_profiles WHERE organization_id::text LIKE 'a8c10000-%';
  DELETE FROM plugin_data.csf_term_policies WHERE organization_id::text LIKE 'a8c10000-%';
  DELETE FROM plugin_data.csf_terms WHERE organization_id::text LIKE 'a8c10000-%';
  DELETE FROM public.organization_plugin_installs WHERE organization_id::text LIKE 'a8c10000-%';
  DELETE FROM public.organization_plugin_entitlements WHERE organization_id::text LIKE 'a8c10000-%';
  DELETE FROM public.organization_members WHERE organization_id::text LIKE 'a8c10000-%';
  DELETE FROM public.organizations WHERE id::text LIKE 'a8c10000-%';
  DELETE FROM auth.users WHERE id = 'a8000000-0000-4000-8000-000000000005';
END;
$function$;

CREATE OR REPLACE FUNCTION pg_temp.cleanup_attendance_multi_receipts()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  DELETE FROM plugin_data.csf_admin_audit_events WHERE organization_id::text LIKE 'a8c10000-%';
END;
$function$;

BEGIN;
SET LOCAL session_replication_role = replica;
SELECT pg_temp.cleanup_attendance_multi_receipts();
COMMIT;
SELECT pg_temp.cleanup_attendance_multi_fixtures();

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

-- 15-18 (N1): fifteen chapters link one partner project and every chapter's
-- member row is locked. Under a 2 s statement_timeout the publication must
-- commit, spending one bounded wait for the whole statement, not one per
-- chapter.
INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES ('a8000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated',
  'race-member-multi@local.test', now(), '{}', '{"full_name":"Race Member Multi"}', now(), now());
INSERT INTO public.organizations (id, name, username, type, join_code)
SELECT ('a8c10000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'Race Multi Chapter ' || i, 'race-multi-chapter-' || i, 'school', '99' || lpad(i::text, 4, '0')
FROM generate_series(1, 15) AS i;
INSERT INTO public.organization_members (organization_id, user_id, role, status)
SELECT ('a8c10000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'a8000000-0000-4000-8000-000000000005', 'member', 'active'
FROM generate_series(1, 15) AS i;
INSERT INTO public.organization_plugin_installs (organization_id, plugin_key, installed_version, configuration, installed_by)
SELECT ('a8c10000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'dvhs-csf', '0.1.0', '{}',
  'a8000000-0000-4000-8000-000000000005'
FROM generate_series(1, 15) AS i;
INSERT INTO public.organization_plugin_entitlements (organization_id, plugin_key, status, created_by)
SELECT ('a8c10000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'dvhs-csf', 'active',
  'a8000000-0000-4000-8000-000000000005'
FROM generate_series(1, 15) AS i;
INSERT INTO plugin_data.csf_terms (id, organization_id, code, label, school_year, semester, lifecycle_status, is_current)
SELECT ('a8c20000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  ('a8c10000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'F41', 'Fall 2041', '2041-2042', 'fall', 'open', true
FROM generate_series(1, 15) AS i;
INSERT INTO plugin_data.csf_term_policies (organization_id, term_id, max_points_per_activity, outside_volunteering_allowed, published_at)
SELECT ('a8c10000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  ('a8c20000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 3, true, now()
FROM generate_series(1, 15) AS i;
INSERT INTO plugin_data.csf_profiles (id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name, record_status)
SELECT ('a8c40000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  ('a8c10000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'Race', 'Multi', 'race', 'multi', 'active'
FROM generate_series(1, 15) AS i;
INSERT INTO plugin_data.csf_profile_accounts (organization_id, profile_id, user_id, status, is_primary)
SELECT ('a8c10000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  ('a8c40000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'a8000000-0000-4000-8000-000000000005', 'verified', true
FROM generate_series(1, 15) AS i;
INSERT INTO plugin_data.csf_term_memberships (organization_id, profile_id, term_id, status, accepted_at)
SELECT ('a8c10000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  ('a8c40000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  ('a8c20000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'accepted', now()
FROM generate_series(1, 15) AS i;
INSERT INTO public.projects (
  id, creator_id, organization_id, title, location, description, event_type,
  verification_method, schedule, require_login, visibility
) VALUES ('a8500000-0000-4000-8000-000000000003', 'a8000000-0000-4000-8000-000000000003',
  'a8100000-0000-4000-8000-000000000002', 'Race Shared Day', 'Plaza', 'Fictional', 'oneTime', 'manual',
  '{"oneTime":{"date":"2041-09-29","startTime":"09:00","endTime":"11:00","volunteers":10}}', true, 'public');
INSERT INTO public.project_signups (id, project_id, user_id, schedule_id, status)
VALUES ('a8600000-0000-4000-8000-000000000010', 'a8500000-0000-4000-8000-000000000003',
  'a8000000-0000-4000-8000-000000000005', 'oneTime', 'approved');
INSERT INTO plugin_data.csf_opportunities (
  id, organization_id, term_id, title, body, status, signup_mode, linked_project_id,
  signup_url, point_value, point_type, requires_point_submission, evidence_policy,
  attendance_submission_mode, published_at, created_by_user_id
)
SELECT ('a8c70000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  ('a8c10000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  ('a8c20000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'Race shared', 'Shared', 'published', 'lets_assist_project', 'a8500000-0000-4000-8000-000000000003',
  '/projects/a8500000-0000-4000-8000-000000000003', 1, 'non_drive', true, 'none', 'pending_submission', now(),
  'a8000000-0000-4000-8000-000000000005'
FROM generate_series(1, 15) AS i;

SELECT extensions.dblink_connect('attendance_race_multi', pg_temp.attendance_race_dsn());
SELECT extensions.dblink_exec('attendance_race_multi', 'BEGIN');
SELECT extensions.dblink_exec('attendance_race_multi', $query$
  DO $hold$
  BEGIN
    PERFORM 1 FROM plugin_data.csf_profiles WHERE id::text LIKE 'a8c40000-%' FOR UPDATE;
  END
  $hold$
$query$);
CREATE TEMP TABLE attendance_race_multi (label text PRIMARY KEY, at timestamptz, payload text);
INSERT INTO attendance_race_multi VALUES ('start', clock_timestamp(), NULL);
SET statement_timeout = '2s';
INSERT INTO attendance_race_multi
SELECT 'publish', clock_timestamp(), public.publish_volunteer_hours_transactional(
  'a8000000-0000-4000-8000-000000000003', 'a8500000-0000-4000-8000-000000000003', 'oneTime',
  '[{"signupId":"a8600000-0000-4000-8000-000000000010","checkIn":"2041-09-29T16:00:00Z","checkOut":"2041-09-29T18:00:00Z"}]'::jsonb,
  'hours-publication:v1:9999999999999999999999999999999999999999999999999999999999999999'
)::text;
RESET statement_timeout;
UPDATE attendance_race_multi SET at = clock_timestamp() WHERE label = 'publish';
SELECT extensions.dblink_exec('attendance_race_multi', 'ROLLBACK');
SELECT extensions.dblink_disconnect('attendance_race_multi');
SELECT extensions.is(
  (SELECT payload::jsonb ->> 'outcome' FROM attendance_race_multi WHERE label = 'publish'),
  'accepted',
  'N1: the publication commits under a 2 s timeout with fifteen contended chapters'
);
SELECT extensions.ok(
  (SELECT (p.at - s.at) < interval '1 second'
   FROM attendance_race_multi AS p, attendance_race_multi AS s
   WHERE p.label = 'publish' AND s.label = 'start'),
  'N1: the host statement spends one bounded wait, not one per chapter'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_attendance_projection_outcomes
   WHERE organization_id::text LIKE 'a8c10000-%' AND outcome = 'deferred' AND sqlstate = '55P03'),
  15,
  'N1: every contended chapter records a deferred source for replay'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.certificates
   WHERE signup_id = 'a8600000-0000-4000-8000-000000000010' AND type = 'verified'),
  1,
  'N1: the verified certificate committed'
);
SELECT extensions.diag('N1 host publication elapsed: ' || (
  SELECT round(extract(epoch FROM p.at - s.at) * 1000)::text || ' ms'
  FROM attendance_race_multi AS p, attendance_race_multi AS s
  WHERE p.label = 'publish' AND s.label = 'start'));

-- 19-22 (N3): chapter one's semester lock and its outcome row are held. The
-- failure recorder must not wait for the row: the host write commits, the
-- source stays as it was, and a later replay projects it.
SELECT extensions.dblink_connect('attendance_race_record', pg_temp.attendance_race_dsn());
SELECT extensions.dblink_exec('attendance_race_record', 'BEGIN');
SELECT extensions.dblink_exec('attendance_race_record', $query$
  DO $hold$
  BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'a8c10000-0000-4000-8000-000000000001:a8c20000-0000-4000-8000-000000000001', 0));
    PERFORM 1 FROM plugin_data.csf_attendance_projection_outcomes
    WHERE organization_id = 'a8c10000-0000-4000-8000-000000000001' FOR UPDATE;
  END
  $hold$
$query$);
CREATE TEMP TABLE attendance_race_record AS
SELECT outcome, attempt_count FROM plugin_data.csf_attendance_projection_outcomes
WHERE organization_id = 'a8c10000-0000-4000-8000-000000000001';
INSERT INTO attendance_race_multi VALUES ('record-start', clock_timestamp(), NULL);
SET statement_timeout = '2s';
UPDATE public.certificates SET event_end = event_end + interval '1 minute'
WHERE signup_id = 'a8600000-0000-4000-8000-000000000010';
RESET statement_timeout;
INSERT INTO attendance_race_multi VALUES ('record-end', clock_timestamp(), NULL);
SELECT extensions.ok(
  (SELECT (e.at - s.at) < interval '1 second'
   FROM attendance_race_multi AS e, attendance_race_multi AS s
   WHERE e.label = 'record-end' AND s.label = 'record-start'),
  'N3: the host write commits without waiting on a locked outcome row'
);
SELECT extensions.dblink_exec('attendance_race_record', 'ROLLBACK');
SELECT extensions.dblink_disconnect('attendance_race_record');
SELECT extensions.ok(
  (SELECT o.outcome = r.outcome AND o.attempt_count = r.attempt_count
   FROM plugin_data.csf_attendance_projection_outcomes AS o, attendance_race_record AS r
   WHERE o.organization_id = 'a8c10000-0000-4000-8000-000000000001'),
  'N3: the contended outcome row is left unrecorded rather than waited on'
);
SELECT plugin_data.csf_project_attendance_sources(
  'a8c10000-0000-4000-8000-000000000001', 'a8500000-0000-4000-8000-000000000003', NULL);
SELECT extensions.is(
  (SELECT outcome FROM plugin_data.csf_attendance_projection_outcomes
   WHERE organization_id = 'a8c10000-0000-4000-8000-000000000001'),
  'projected',
  'N3: replay projects the source the recorder skipped'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE organization_id = 'a8c10000-0000-4000-8000-000000000001' AND source = 'attendance'),
  1,
  'N3: the replay creates exactly one pending claim'
);
-- A busy first chapter must not defer every later chapter without an attempt.
SELECT extensions.dblink_connect('attendance_fair', pg_temp.attendance_race_dsn());
SELECT extensions.dblink_exec('attendance_fair', 'BEGIN');
SELECT extensions.dblink_exec('attendance_fair', $q$DO $hold$ BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('a8c10000-0000-4000-8000-000000000001:a8c20000-0000-4000-8000-000000000001',0));
END $hold$ $q$);
UPDATE public.certificates SET event_end=event_end+interval '1 minute'
WHERE signup_id='a8600000-0000-4000-8000-000000000010';
SELECT extensions.ok(EXISTS(SELECT 1 FROM plugin_data.csf_point_submissions
  WHERE organization_id::text LIKE 'a8c10000-%'
    AND organization_id<>'a8c10000-0000-4000-8000-000000000001' AND source='attendance'),
  'uncontended chapters progress while the first chapter stays locked');
SELECT extensions.dblink_exec('attendance_fair','ROLLBACK');
SELECT extensions.dblink_disconnect('attendance_fair');

-- csf_create_activity waits on the project before taking membership authority locks.
SELECT extensions.dblink_connect('attendance_order_0', pg_temp.attendance_race_dsn());
SELECT extensions.dblink_exec('attendance_order_0','BEGIN');
INSERT INTO attendance_race_pids SELECT 'attendance_order_0',pid
  FROM extensions.dblink('attendance_order_0','SELECT pg_backend_pid()') AS t(pid integer);
BEGIN;
SELECT id FROM public.projects WHERE id='a8500000-0000-4000-8000-000000000001' FOR UPDATE;
SELECT extensions.dblink_send_query('attendance_order_0', $q$SELECT plugin_data.csf_create_activity('a8100000-0000-4000-8000-000000000001','a8200000-0000-4000-8000-000000000001',NULL,'{"title":"Race edited","signupMode":"lets_assist_project","linkedProjectId":"a8500000-0000-4000-8000-000000000001","pointValue":1,"pointType":"non_drive"}'::jsonb,'a8000000-0000-4000-8000-000000000001',gen_random_uuid())::text$q$);
SELECT extensions.ok(pg_temp.wait_for_attendance_race_lock((SELECT pid FROM attendance_race_pids WHERE label='attendance_order_0')),
  'csf_create_activity waits for the project');
SELECT extensions.lives_ok($q$SELECT user_id FROM public.organization_members
  WHERE organization_id='a8100000-0000-4000-8000-000000000001' AND user_id='a8000000-0000-4000-8000-000000000001' FOR UPDATE NOWAIT$q$,
  'csf_create_activity holds no membership lock while waiting for publication');
COMMIT;
SELECT extensions.ok(pg_temp.wait_for_attendance_race_result('attendance_order_0'), 'csf_create_activity completes after project release');
SELECT * FROM extensions.dblink_get_result('attendance_order_0',false) AS t(payload text);
SELECT * FROM extensions.dblink_get_result('attendance_order_0',false) AS t(payload text);
SELECT extensions.dblink_exec('attendance_order_0','ROLLBACK');
SELECT extensions.dblink_disconnect('attendance_order_0');

-- csf_update_activity waits on the project before taking membership authority locks.
SELECT extensions.dblink_connect('attendance_order_1', pg_temp.attendance_race_dsn());
SELECT extensions.dblink_exec('attendance_order_1','BEGIN');
INSERT INTO attendance_race_pids SELECT 'attendance_order_1',pid
  FROM extensions.dblink('attendance_order_1','SELECT pg_backend_pid()') AS t(pid integer);
BEGIN;
SELECT id FROM public.projects WHERE id='a8500000-0000-4000-8000-000000000001' FOR UPDATE;
SELECT extensions.dblink_send_query('attendance_order_1', $q$SELECT plugin_data.csf_update_activity('a8100000-0000-4000-8000-000000000001','a8700000-0000-4000-8000-000000000001','a8200000-0000-4000-8000-000000000001',NULL,'{"title":"Race edited","signupMode":"lets_assist_project","linkedProjectId":"a8500000-0000-4000-8000-000000000001","pointValue":1,"pointType":"non_drive"}'::jsonb,'a8000000-0000-4000-8000-000000000001',gen_random_uuid())::text$q$);
SELECT extensions.ok(pg_temp.wait_for_attendance_race_lock((SELECT pid FROM attendance_race_pids WHERE label='attendance_order_1')),
  'csf_update_activity waits for the project');
SELECT extensions.lives_ok($q$SELECT user_id FROM public.organization_members
  WHERE organization_id='a8100000-0000-4000-8000-000000000001' AND user_id='a8000000-0000-4000-8000-000000000001' FOR UPDATE NOWAIT$q$,
  'csf_update_activity holds no membership lock while waiting for publication');
COMMIT;
SELECT extensions.ok(pg_temp.wait_for_attendance_race_result('attendance_order_1'), 'csf_update_activity completes after project release');
SELECT * FROM extensions.dblink_get_result('attendance_order_1',false) AS t(payload text);
SELECT * FROM extensions.dblink_get_result('attendance_order_1',false) AS t(payload text);
SELECT extensions.dblink_exec('attendance_order_1','ROLLBACK');
SELECT extensions.dblink_disconnect('attendance_order_1');

-- csf_set_activity_status waits on the project before taking membership authority locks.
SELECT extensions.dblink_connect('attendance_order_2', pg_temp.attendance_race_dsn());
SELECT extensions.dblink_exec('attendance_order_2','BEGIN');
INSERT INTO attendance_race_pids SELECT 'attendance_order_2',pid
  FROM extensions.dblink('attendance_order_2','SELECT pg_backend_pid()') AS t(pid integer);
BEGIN;
SELECT id FROM public.projects WHERE id='a8500000-0000-4000-8000-000000000001' FOR UPDATE;
SELECT extensions.dblink_send_query('attendance_order_2', $q$SELECT plugin_data.csf_set_activity_status('a8100000-0000-4000-8000-000000000001','a8700000-0000-4000-8000-000000000001','closed',NULL,'a8000000-0000-4000-8000-000000000001',gen_random_uuid())::text$q$);
SELECT extensions.ok(pg_temp.wait_for_attendance_race_lock((SELECT pid FROM attendance_race_pids WHERE label='attendance_order_2')),
  'csf_set_activity_status waits for the project');
SELECT extensions.lives_ok($q$SELECT user_id FROM public.organization_members
  WHERE organization_id='a8100000-0000-4000-8000-000000000001' AND user_id='a8000000-0000-4000-8000-000000000001' FOR UPDATE NOWAIT$q$,
  'csf_set_activity_status holds no membership lock while waiting for publication');
COMMIT;
SELECT extensions.ok(pg_temp.wait_for_attendance_race_result('attendance_order_2'), 'csf_set_activity_status completes after project release');
SELECT * FROM extensions.dblink_get_result('attendance_order_2',false) AS t(payload text);
SELECT * FROM extensions.dblink_get_result('attendance_order_2',false) AS t(payload text);
SELECT extensions.dblink_exec('attendance_order_2','ROLLBACK');
SELECT extensions.dblink_disconnect('attendance_order_2');

-- csf_link_activity_project waits on the project before taking membership authority locks.
SELECT extensions.dblink_connect('attendance_order_3', pg_temp.attendance_race_dsn());
SELECT extensions.dblink_exec('attendance_order_3','BEGIN');
INSERT INTO attendance_race_pids SELECT 'attendance_order_3',pid
  FROM extensions.dblink('attendance_order_3','SELECT pg_backend_pid()') AS t(pid integer);
BEGIN;
SELECT id FROM public.projects WHERE id='a8500000-0000-4000-8000-000000000001' FOR UPDATE;
SELECT extensions.dblink_send_query('attendance_order_3', $q$SELECT plugin_data.csf_link_activity_project('a8100000-0000-4000-8000-000000000001','a8700000-0000-4000-8000-000000000001','a8500000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001',gen_random_uuid())::text$q$);
SELECT extensions.ok(pg_temp.wait_for_attendance_race_lock((SELECT pid FROM attendance_race_pids WHERE label='attendance_order_3')),
  'csf_link_activity_project waits for the project');
SELECT extensions.lives_ok($q$SELECT user_id FROM public.organization_members
  WHERE organization_id='a8100000-0000-4000-8000-000000000001' AND user_id='a8000000-0000-4000-8000-000000000001' FOR UPDATE NOWAIT$q$,
  'csf_link_activity_project holds no membership lock while waiting for publication');
COMMIT;
SELECT extensions.ok(pg_temp.wait_for_attendance_race_result('attendance_order_3'), 'csf_link_activity_project completes after project release');
SELECT * FROM extensions.dblink_get_result('attendance_order_3',false) AS t(payload text);
SELECT * FROM extensions.dblink_get_result('attendance_order_3',false) AS t(payload text);
SELECT extensions.dblink_exec('attendance_order_3','ROLLBACK');
SELECT extensions.dblink_disconnect('attendance_order_3');

-- csf_set_activity_status_with_email waits on the project before taking membership authority locks.
SELECT extensions.dblink_connect('attendance_order_4', pg_temp.attendance_race_dsn());
SELECT extensions.dblink_exec('attendance_order_4','BEGIN');
INSERT INTO attendance_race_pids SELECT 'attendance_order_4',pid
  FROM extensions.dblink('attendance_order_4','SELECT pg_backend_pid()') AS t(pid integer);
BEGIN;
SELECT id FROM public.projects WHERE id='a8500000-0000-4000-8000-000000000001' FOR UPDATE;
SELECT extensions.dblink_send_query('attendance_order_4', $q$SELECT plugin_data.csf_set_activity_status_with_email('a8100000-0000-4000-8000-000000000001','a8700000-0000-4000-8000-000000000001','closed',NULL,'a8000000-0000-4000-8000-000000000001',gen_random_uuid(),false,NULL)::text$q$);
SELECT extensions.ok(pg_temp.wait_for_attendance_race_lock((SELECT pid FROM attendance_race_pids WHERE label='attendance_order_4')),
  'csf_set_activity_status_with_email waits for the project');
SELECT extensions.lives_ok($q$SELECT user_id FROM public.organization_members
  WHERE organization_id='a8100000-0000-4000-8000-000000000001' AND user_id='a8000000-0000-4000-8000-000000000001' FOR UPDATE NOWAIT$q$,
  'csf_set_activity_status_with_email holds no membership lock while waiting for publication');
COMMIT;
SELECT extensions.ok(pg_temp.wait_for_attendance_race_result('attendance_order_4'), 'csf_set_activity_status_with_email completes after project release');
SELECT * FROM extensions.dblink_get_result('attendance_order_4',false) AS t(payload text);
SELECT * FROM extensions.dblink_get_result('attendance_order_4',false) AS t(payload text);
SELECT extensions.dblink_exec('attendance_order_4','ROLLBACK');
SELECT extensions.dblink_disconnect('attendance_order_4');

-- A link changed while the wrapper waited must fail once as a business conflict.
SELECT extensions.dblink_connect('attendance_stale',pg_temp.attendance_race_dsn());
INSERT INTO attendance_race_pids SELECT 'stale',pid FROM extensions.dblink('attendance_stale','SELECT pg_backend_pid()') AS t(pid integer);
SELECT extensions.dblink_exec('attendance_stale',$q$CREATE FUNCTION pg_temp.stale_activity_result()
RETURNS text LANGUAGE plpgsql AS $body$ BEGIN
 PERFORM plugin_data.csf_set_activity_status('a8100000-0000-4000-8000-000000000001',
  'a8700000-0000-4000-8000-000000000001','closed',NULL,'a8000000-0000-4000-8000-000000000001',
  'a8900000-0000-4000-8000-000000000090');
 RETURN 'unexpected_success'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $body$ $q$);
BEGIN;
SELECT id FROM public.projects WHERE id='a8500000-0000-4000-8000-000000000001' FOR UPDATE;
SELECT extensions.dblink_send_query('attendance_stale','SELECT pg_temp.stale_activity_result()');
SELECT extensions.ok(pg_temp.wait_for_attendance_race_lock((SELECT pid FROM attendance_race_pids WHERE label='stale')),
 'stale-link request waits on its captured project');
UPDATE plugin_data.csf_opportunities SET linked_project_id='a8500000-0000-4000-8000-000000000002'
WHERE id='a8700000-0000-4000-8000-000000000001';
COMMIT;
SELECT extensions.ok(pg_temp.wait_for_attendance_race_result('attendance_stale'),'stale-link request returns after project release');
SELECT extensions.is((SELECT result FROM extensions.dblink_get_result('attendance_stale',false) AS t(result text)),
 'PT409','changed project returns a business conflict instead of a retryable engine error');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
 WHERE correlation_id='a8900000-0000-4000-8000-000000000090'),0,'stale-link refusal creates no audit receipt');
SELECT extensions.dblink_disconnect('attendance_stale');
UPDATE plugin_data.csf_opportunities SET linked_project_id='a8500000-0000-4000-8000-000000000001'
WHERE id='a8700000-0000-4000-8000-000000000001';

-- Certificate account binding and enable backfill cannot pass each other.
SELECT plugin_data.csf_set_activity_attendance_submissions(
  'a8100000-0000-4000-8000-000000000001','a8700000-0000-4000-8000-000000000002','off',
  'a8000000-0000-4000-8000-000000000001',gen_random_uuid());
UPDATE public.certificates SET user_id=NULL WHERE signup_id='a8600000-0000-4000-8000-000000000002';
SELECT extensions.dblink_connect('attendance_guest',pg_temp.attendance_race_dsn());
INSERT INTO attendance_race_pids SELECT 'guest',pid FROM extensions.dblink('attendance_guest','SELECT pg_backend_pid()') AS t(pid integer);
BEGIN;
SELECT plugin_data.csf_set_activity_attendance_submissions(
  'a8100000-0000-4000-8000-000000000001','a8700000-0000-4000-8000-000000000002','pending_submission',
  'a8000000-0000-4000-8000-000000000001',gen_random_uuid());
SELECT extensions.dblink_send_query('attendance_guest',$q$UPDATE public.certificates
  SET user_id='a8000000-0000-4000-8000-000000000002'
  WHERE signup_id='a8600000-0000-4000-8000-000000000002' RETURNING id::text$q$);
SELECT extensions.ok(pg_temp.wait_for_attendance_race_lock((SELECT pid FROM attendance_race_pids WHERE label='guest')),
  'guest binding waits for the enabling transaction');
COMMIT;
SELECT extensions.ok(pg_temp.wait_for_attendance_race_result('attendance_guest'),'guest binding completes after enable commits');
SELECT * FROM extensions.dblink_get_result('attendance_guest',false) AS t(payload text);
SELECT * FROM extensions.dblink_get_result('attendance_guest',false) AS t(payload text);
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_attendance_evidence
  WHERE signup_id='a8600000-0000-4000-8000-000000000002' AND state='active'),1,
  'enable-first guest race produces one active evidence row without staff retry');
SELECT extensions.dblink_disconnect('attendance_guest');

-- Reverse the order: enable must wait and then see the committed account.
SELECT plugin_data.csf_set_activity_attendance_submissions(
  'a8100000-0000-4000-8000-000000000001','a8700000-0000-4000-8000-000000000002','off',
  'a8000000-0000-4000-8000-000000000001',gen_random_uuid());
UPDATE public.certificates SET user_id=NULL WHERE signup_id='a8600000-0000-4000-8000-000000000002';
SELECT extensions.dblink_connect('attendance_guest_first',pg_temp.attendance_race_dsn());
INSERT INTO attendance_race_pids SELECT 'guest_first',pid FROM extensions.dblink('attendance_guest_first','SELECT pg_backend_pid()') AS t(pid integer);
BEGIN;
UPDATE public.certificates SET user_id='a8000000-0000-4000-8000-000000000002'
WHERE signup_id='a8600000-0000-4000-8000-000000000002';
SELECT extensions.dblink_send_query('attendance_guest_first',$q$SELECT plugin_data.csf_set_activity_attendance_submissions(
  'a8100000-0000-4000-8000-000000000001','a8700000-0000-4000-8000-000000000002','pending_submission',
  'a8000000-0000-4000-8000-000000000001',gen_random_uuid())::text$q$);
SELECT extensions.ok(pg_temp.wait_for_attendance_race_lock((SELECT pid FROM attendance_race_pids WHERE label='guest_first')),
  'enable waits for an uncommitted guest binding');
COMMIT;
SELECT extensions.ok(pg_temp.wait_for_attendance_race_result('attendance_guest_first'),'enable completes after guest commits');
SELECT * FROM extensions.dblink_get_result('attendance_guest_first',false) AS t(payload text);
SELECT * FROM extensions.dblink_get_result('attendance_guest_first',false) AS t(payload text);
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_attendance_evidence
  WHERE signup_id='a8600000-0000-4000-8000-000000000002' AND state='active'),1,
  'guest-first race backfills one active evidence row without staff retry');
SELECT extensions.dblink_disconnect('attendance_guest_first');

DROP TABLE attendance_race_record;
DROP TABLE attendance_race_multi;

BEGIN;
SET LOCAL session_replication_role = replica;
SELECT pg_temp.cleanup_attendance_multi_receipts();
COMMIT;
SELECT pg_temp.cleanup_attendance_multi_fixtures();
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
