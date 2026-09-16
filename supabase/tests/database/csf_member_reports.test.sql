-- A member reports a problem with their own record; an officer closes it.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(21);

SELECT extensions.ok(NOT has_table_privilege('authenticated', 'plugin_data.csf_member_reports', 'SELECT'),
  'browser roles cannot read member reports');
SELECT extensions.ok(has_table_privilege('service_role', 'plugin_data.csf_member_reports', 'SELECT'),
  'the server role reads member reports');
SELECT extensions.ok(NOT has_function_privilege('authenticated',
  'plugin_data.csf_submit_member_report(uuid,uuid,text,text,uuid)', 'EXECUTE'),
  'browser roles cannot submit reports directly');
SELECT extensions.ok(NOT has_function_privilege('authenticated',
  'plugin_data.csf_resolve_member_report(uuid,uuid,uuid,text,text)', 'EXECUTE'),
  'browser roles cannot resolve reports directly');

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('f3100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'report-officer@local.test', now(), '{}', '{}', now(), now()),
  ('f3100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'report-member@local.test', now(), '{}', '{}', now(), now()),
  ('f3100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'unconnected@local.test', now(), '{}', '{}', now(), now());
INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('f3200000-0000-4000-8000-000000000001', 'Member Report Test', 'member-report-test', 'school', '984012');
INSERT INTO public.organization_members (organization_id, user_id, role, status) VALUES
  ('f3200000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('f3200000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-000000000002', 'member', 'active'),
  ('f3200000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-000000000003', 'member', 'active');
INSERT INTO plugin_data.csf_profiles (id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name)
VALUES ('f3400000-0000-4000-8000-000000000001', 'f3200000-0000-4000-8000-000000000001', 'Reporting', 'Member', 'reporting', 'member');
INSERT INTO plugin_data.csf_profile_accounts (organization_id, profile_id, user_id, status, is_primary, linked_by, connection_basis)
VALUES ('f3200000-0000-4000-8000-000000000001', 'f3400000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-000000000002', 'verified', true, 'f3100000-0000-4000-8000-000000000001', 'officer_decision');

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_submit_member_report(
  'f3200000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-000000000003', 'points', 'My points are wrong.')$q$,
  'Connect your CSF record before reporting a problem with it.',
  'an account without a connected record cannot report');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_submit_member_report(
  'f3200000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-000000000002', 'points', 'short')$q$,
  'Describe the problem in 8 to 2000 characters.', 'a report needs a real description');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_submit_member_report(
  'f3200000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-000000000002', 'weather', 'My points are wrong.')$q$,
  'Choose what is wrong.', 'a report needs a known category');

INSERT INTO public.organizations(id,name,username,type,join_code) VALUES ('f3200000-0000-4000-8000-000000000002','Other report chapter','other-report-chapter','school','984013');
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester) VALUES
('f3500000-0000-4000-8000-000000000001','f3200000-0000-4000-8000-000000000001','F31','Own term','2031-2032','fall'),
('f3500000-0000-4000-8000-000000000002','f3200000-0000-4000-8000-000000000002','F31','Other term','2031-2032','fall');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_submit_member_report('f3200000-0000-4000-8000-000000000001','f3100000-0000-4000-8000-000000000002','points','My point total looks wrong.','f3500000-0000-4000-8000-000000000002')$q$,'23514','CSF semester not found for this organization.','foreign term refused');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_submit_member_report('f3200000-0000-4000-8000-000000000001','f3100000-0000-4000-8000-000000000002','points','My point total looks wrong.','f3500000-0000-4000-8000-000000000003')$q$,'23514','CSF semester not found for this organization.','missing term refused');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_member_reports WHERE organization_id='f3200000-0000-4000-8000-000000000001'),0,'rejected terms create no report');
CREATE TEMP TABLE report_results (scenario text PRIMARY KEY, payload jsonb);
INSERT INTO report_results VALUES ('first', plugin_data.csf_submit_member_report(
  'f3200000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-000000000002', 'attendance',
  'The October meeting shows me absent but I signed in at the door.', 'f3500000-0000-4000-8000-000000000001'));
SELECT extensions.is((SELECT term_id FROM plugin_data.csf_member_reports WHERE id=(SELECT (payload->>'reportId')::uuid FROM report_results WHERE scenario='first')),'f3500000-0000-4000-8000-000000000001'::uuid,'own term accepted and retained');
SELECT extensions.is((SELECT payload->>'profileId' FROM report_results WHERE scenario='first'),
  'f3400000-0000-4000-8000-000000000001', 'the report attaches to the member''s own connected record');
SELECT extensions.is((SELECT status FROM plugin_data.csf_member_reports
  WHERE id = (SELECT (payload->>'reportId')::uuid FROM report_results WHERE scenario='first')), 'open',
  'a new report is open');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_admin_audit_events
  WHERE organization_id='f3200000-0000-4000-8000-000000000001' AND action='profile.member_report_submitted'), 1,
  'submitting is audited');

-- Officer resolves it.
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_resolve_member_report(
  'f3200000-0000-4000-8000-000000000001', (SELECT (payload->>'reportId')::uuid FROM report_results WHERE scenario='first'),
  'f3100000-0000-4000-8000-000000000002', 'resolved', 'Fixed the attendance row.')$q$,
  '42501', NULL, 'a member cannot resolve reports');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_resolve_member_report(
  'f3200000-0000-4000-8000-000000000001', (SELECT (payload->>'reportId')::uuid FROM report_results WHERE scenario='first'),
  'f3100000-0000-4000-8000-000000000001', 'resolved', 'ok')$q$,
  'Say what you did about it, in 4 to 1000 characters.', 'resolving needs a note');
INSERT INTO report_results VALUES ('resolve', plugin_data.csf_resolve_member_report(
  'f3200000-0000-4000-8000-000000000001', (SELECT (payload->>'reportId')::uuid FROM report_results WHERE scenario='first'),
  'f3100000-0000-4000-8000-000000000001', 'resolved', 'Corrected the October attendance to attended.'));
SELECT extensions.is((SELECT status FROM plugin_data.csf_member_reports
  WHERE id = (SELECT (payload->>'reportId')::uuid FROM report_results WHERE scenario='first')), 'resolved',
  'an officer with manage_profiles resolves the report');
SELECT extensions.is((SELECT payload->>'replayed' FROM report_results WHERE scenario='resolve'), 'false', 'the first resolution is not a replay');
INSERT INTO report_results VALUES ('resolve_again', plugin_data.csf_resolve_member_report(
  'f3200000-0000-4000-8000-000000000001', (SELECT (payload->>'reportId')::uuid FROM report_results WHERE scenario='first'),
  'f3100000-0000-4000-8000-000000000001', 'dismissed', 'Clicked twice.'));
SELECT extensions.is((SELECT payload->>'status' FROM report_results WHERE scenario='resolve_again'), 'resolved',
  'a second decision replays the first rather than overwriting it');

-- Five open reports is the cap.
INSERT INTO report_results
SELECT 'cap' || n, plugin_data.csf_submit_member_report(
  'f3200000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-000000000002', 'other', 'Report number ' || n || ' about something.')
FROM generate_series(1, 5) AS n;
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_submit_member_report(
  'f3200000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-000000000002', 'other', 'One more report about it.')$q$,
  'You already have five open reports. An officer will get to them.', 'a sixth open report is refused');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_member_reports
  WHERE organization_id='f3200000-0000-4000-8000-000000000001' AND status='open'), 5, 'five remain open');

SELECT * FROM extensions.finish();
ROLLBACK;
