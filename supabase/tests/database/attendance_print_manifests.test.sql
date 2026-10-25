BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(20);

SELECT extensions.ok(NOT has_table_privilege('anon', 'public.project_attendance_print_sheets', 'SELECT'), 'anonymous cannot read print manifests');
SELECT extensions.ok(NOT has_table_privilege('authenticated', 'public.project_attendance_print_rows', 'SELECT'), 'browser accounts cannot read print rows');
SELECT extensions.ok(NOT has_table_privilege('service_role', 'public.project_attendance_print_rows', 'INSERT'), 'service client cannot bypass manifest creation');
SELECT extensions.ok(NOT has_function_privilege('anon', 'public.create_attendance_print_sheet(uuid,text,uuid,integer,integer)', 'EXECUTE'), 'anonymous cannot print');
SELECT extensions.ok(NOT has_function_privilege('authenticated', 'public.create_attendance_print_sheet(uuid,text,uuid,integer,integer)', 'EXECUTE'), 'browser cannot call privileged print RPC');
SELECT extensions.ok(has_function_privilege('service_role', 'public.create_attendance_print_sheet(uuid,text,uuid,integer,integer)', 'EXECUTE'), 'server can create prints');
SELECT extensions.ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.project_attendance_print_rows'::regclass, 'public.project_attendance_print_sheets'::regclass)), 'both print tables use RLS');

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
('be000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'print-owner@local.test', now(), '{}', '{"username":"print_owner"}', now(), now()),
('be000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'print-volunteer@local.test', now(), '{}', '{"username":"print_volunteer"}', now(), now()),
('be000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'print-staff@local.test', now(), '{}', '{"username":"print_staff"}', now(), now());
UPDATE public.profiles SET full_name = 'Sample Volunteer' WHERE id = 'be000000-0000-4000-8000-000000000002';
INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('be100000-0000-4000-8000-000000000001', 'Print Fixture Org', 'print_fixture_org', 'nonprofit', '940382');
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('be100000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000003', 'staff', 'active');
INSERT INTO public.projects (id, creator_id, title, location, description, event_type, verification_method, schedule, require_login, status, organization_id, can_be_managed_by_staff)
VALUES ('be200000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000001', 'Print fixture', 'Local', 'Synthetic print fixture', 'sameDayMultiArea', 'manual',
'{"sameDayMultiArea":{"date":"2027-01-20","overallStart":"09:00","overallEnd":"12:00","roles":[{"name":"Morning","startTime":"09:00","endTime":"10:00","volunteers":10},{"name":"Afternoon","startTime":"11:00","endTime":"12:00","volunteers":10}]}}', true, 'upcoming', 'be100000-0000-4000-8000-000000000001', true);
INSERT INTO public.project_signups (id, project_id, user_id, schedule_id, status)
VALUES ('be300000-0000-4000-8000-000000000001', 'be200000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000002', 'Morning', 'approved');

SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheet('be200000-0000-4000-8000-000000000001', 'Morning', 'be000000-0000-4000-8000-000000000002')$$, '42501', 'Not authorized to print this project', 'volunteer cannot print roster');
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheet('be200000-0000-4000-8000-000000000001', 'Missing', 'be000000-0000-4000-8000-000000000001')$$, '22023', 'Invalid schedule session', 'unknown session fails closed');
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheet('be200000-0000-4000-8000-000000000001', 'Morning', 'be000000-0000-4000-8000-000000000001', 101, 4)$$, '22023', 'Invalid print options', 'row limit is enforced in SQL');

CREATE TEMP TABLE print_test_sheet AS SELECT public.create_attendance_print_sheet('be200000-0000-4000-8000-000000000001', 'Morning', 'be000000-0000-4000-8000-000000000001') AS id;
SELECT extensions.is((SELECT count(*)::integer FROM public.project_attendance_print_rows WHERE sheet_id = (SELECT id FROM print_test_sheet)), 15, 'one approved signup plus default ten walk-ins and four continuation rows');
SELECT extensions.is((SELECT printed_name FROM public.project_attendance_print_rows WHERE sheet_id = (SELECT id FROM print_test_sheet) AND row_kind = 'signup'), 'Sample Volunteer', 'manifest stores printed name');
SELECT extensions.is((SELECT signup_id FROM public.project_attendance_print_rows WHERE sheet_id = (SELECT id FROM print_test_sheet) AND row_kind = 'signup'), 'be300000-0000-4000-8000-000000000001'::uuid, 'reference maps to exact signup');
SELECT extensions.ok((SELECT bool_and(row_reference ~ '^[0-9a-f]{12}$') FROM public.project_attendance_print_rows WHERE sheet_id = (SELECT id FROM print_test_sheet)), 'all rows get opaque references');
SELECT extensions.is((SELECT count(*)::integer FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('project_attendance_print_rows', 'project_attendance_print_sheets') AND column_name ~ 'email|phone|token'), 0, 'manifests have no contact or capability fields');
CREATE TEMP TABLE print_other_sheet AS SELECT public.create_attendance_print_sheet('be200000-0000-4000-8000-000000000001', 'Afternoon', 'be000000-0000-4000-8000-000000000001', 0, 0) AS id;
SELECT extensions.is((SELECT count(*)::integer FROM public.project_attendance_print_rows WHERE sheet_id = (SELECT id FROM print_other_sheet)), 0, 'another session does not include the first session signup');
SELECT extensions.lives_ok($$SELECT public.create_attendance_print_sheet('be200000-0000-4000-8000-000000000001', 'Morning', 'be000000-0000-4000-8000-000000000003', 0, 0)$$, 'active staff may print opted-in project');
UPDATE public.organization_members SET status = 'inactive' WHERE user_id = 'be000000-0000-4000-8000-000000000003';
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheet('be200000-0000-4000-8000-000000000001', 'Morning', 'be000000-0000-4000-8000-000000000003')$$, '42501', 'Not authorized to print this project', 'revoked staff cannot create another sheet');
UPDATE public.organization_members SET status = 'active' WHERE user_id = 'be000000-0000-4000-8000-000000000003';
UPDATE public.projects SET can_be_managed_by_staff = false WHERE id = 'be200000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheet('be200000-0000-4000-8000-000000000001', 'Morning', 'be000000-0000-4000-8000-000000000003')$$, '42501', 'Not authorized to print this project', 'staff opt-out applies at action time');
SELECT extensions.is((SELECT count(*)::integer FROM public.project_signups WHERE project_id = 'be200000-0000-4000-8000-000000000001' AND status = 'approved'), 1, 'printing does not change attendance');

SELECT * FROM extensions.finish();
ROLLBACK;
