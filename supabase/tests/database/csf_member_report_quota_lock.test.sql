BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(7);
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


SELECT extensions.matches(pg_get_functiondef('plugin_data.csf_submit_member_report(uuid,uuid,text,text,uuid)'::regprocedure),
  'LIMIT 1[[:space:]]+FOR UPDATE OF profile, account;',
  'the verified account and active profile are locked before quota counting');
SELECT plugin_data.csf_submit_member_report('f3200000-0000-4000-8000-000000000001','f3100000-0000-4000-8000-000000000002','points','The verified point total needs correction.') FROM generate_series(1,4);
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_member_reports WHERE organization_id='f3200000-0000-4000-8000-000000000001'),4,'four reports exist before boundary');
SELECT extensions.lives_ok($q$SELECT plugin_data.csf_submit_member_report('f3200000-0000-4000-8000-000000000001','f3100000-0000-4000-8000-000000000002','points','The verified point total needs correction.')$q$,'the fifth report is accepted');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_submit_member_report('f3200000-0000-4000-8000-000000000001','f3100000-0000-4000-8000-000000000002','points','The verified point total needs correction.')$q$,'You already have five open reports. An officer will get to them.','the sixth report is refused');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_member_reports WHERE organization_id='f3200000-0000-4000-8000-000000000001'),5,'the quota refusal does not add a sixth row');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_admin_audit_events WHERE organization_id='f3200000-0000-4000-8000-000000000001' AND action='profile.member_report_submitted'),5,'only successful reports are audited');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_submit_member_report(uuid,uuid,text,text,uuid)','EXECUTE') AND has_function_privilege('service_role','plugin_data.csf_submit_member_report(uuid,uuid,text,text,uuid)','EXECUTE'),'the reviewed server-only ACL remains');
SELECT * FROM extensions.finish();
ROLLBACK;
