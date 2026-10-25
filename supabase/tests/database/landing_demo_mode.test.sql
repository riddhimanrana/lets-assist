BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(37);

SELECT extensions.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'app_private.landing_demo_setting'::regclass), 'setting uses RLS');
SELECT extensions.is(public.get_landing_demo_mode(), false, 'new setting defaults to real content');

WITH roles(role_name) AS (VALUES ('anon'), ('authenticated')),
privileges(privilege_name) AS (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'))
SELECT extensions.ok(NOT has_table_privilege(role_name, 'app_private.landing_demo_setting', privilege_name), role_name || ' cannot ' || privilege_name || ' setting')
FROM roles CROSS JOIN privileges;

WITH roles(role_name) AS (VALUES ('anon'), ('authenticated')),
functions(signature) AS (VALUES ('public.get_landing_demo_mode()'), ('public.set_landing_demo_mode(boolean,boolean,uuid)'))
SELECT extensions.ok(NOT has_function_privilege(role_name, signature, 'EXECUTE'), role_name || ' cannot call ' || signature)
FROM roles CROSS JOIN functions;
SELECT extensions.ok(has_function_privilege('service_role', 'public.get_landing_demo_mode()', 'EXECUTE'), 'service can read display mode');
SELECT extensions.ok(has_function_privilege('service_role', 'public.set_landing_demo_mode(boolean,boolean,uuid)', 'EXECUTE'), 'service can write through guarded RPC');
WITH roles(role_name) AS (VALUES ('anon'), ('authenticated'), ('service_role')),
tables(table_name) AS (VALUES ('app_private.landing_demo_setting'), ('app_private.landing_demo_events'))
SELECT extensions.ok(NOT has_table_privilege(role_name, table_name, 'SELECT,INSERT,UPDATE,DELETE'), role_name || ' has no direct access to ' || table_name)
FROM roles CROSS JOIN tables;

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
('ac000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'landing-admin@local.test', now(), '{"role":"super_admin"}', '{}', now(), now()),
('ac000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'landing-member@local.test', now(), '{}', '{"role":"super_admin","is_super_admin":true}', now(), now());

SELECT extensions.throws_ok($$SELECT public.set_landing_demo_mode(true, false, 'ac000000-0000-4000-8000-000000000002')$$, '42501', 'Super admin access required.', 'editable metadata cannot authorize global change');
SELECT extensions.throws_ok($$SELECT public.set_landing_demo_mode(true, false, NULL)$$, '22023', 'Invalid landing page mode.', 'missing actor denied');
SELECT extensions.throws_ok($$SELECT public.set_landing_demo_mode(NULL, false, 'ac000000-0000-4000-8000-000000000001')$$, '22023', 'Invalid landing page mode.', 'null mode denied');
SELECT extensions.is(public.set_landing_demo_mode(true, false, 'ac000000-0000-4000-8000-000000000001'), true, 'admin enables global demo');
SELECT extensions.is(public.get_landing_demo_mode(), true, 'subsequent public server read sees demo');
SELECT extensions.is((SELECT updated_by FROM app_private.landing_demo_setting), 'ac000000-0000-4000-8000-000000000001'::uuid, 'audit records actual actor');
SELECT extensions.is(public.set_landing_demo_mode(false, false, 'ac000000-0000-4000-8000-000000000001'), false, 'stale admin view cannot overwrite another change');
SELECT extensions.is(public.set_landing_demo_mode(false, true, 'ac000000-0000-4000-8000-000000000001'), true, 'admin returns to real content');
SELECT extensions.is((SELECT count(*)::integer FROM app_private.landing_demo_events), 2, 'both on and off events persist; stale save adds none');
SELECT extensions.is((SELECT count(*)::integer FROM app_private.landing_demo_events WHERE changed_by = 'ac000000-0000-4000-8000-000000000001'), 2, 'each event records authoritative actor');
UPDATE auth.users SET raw_app_meta_data = '{"is_super_admin":"true"}' WHERE id = 'ac000000-0000-4000-8000-000000000002';
SELECT extensions.throws_ok($$SELECT public.set_landing_demo_mode(true, false, 'ac000000-0000-4000-8000-000000000002')$$, '42501', 'Super admin access required.', 'string super admin flag cannot grant access');
UPDATE auth.users SET raw_app_meta_data = '{"is_super_admin":true}' WHERE id = 'ac000000-0000-4000-8000-000000000002';
SELECT extensions.is(public.set_landing_demo_mode(true, false, 'ac000000-0000-4000-8000-000000000002'), true, 'exact boolean super admin flag can grant access');
UPDATE auth.users SET raw_app_meta_data = '{"role":" Super_Admin "}' WHERE id = 'ac000000-0000-4000-8000-000000000002';
SELECT extensions.is(public.set_landing_demo_mode(false, true, 'ac000000-0000-4000-8000-000000000002'), true, 'mixed case trimmed super admin role can grant access');
SELECT extensions.is((SELECT count(*)::integer FROM app_private.landing_demo_events WHERE from_enabled IS DISTINCT FROM to_enabled), 4, 'events preserve both transition directions');
UPDATE auth.users SET raw_app_meta_data = '{}' WHERE id = 'ac000000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT public.set_landing_demo_mode(true, false, 'ac000000-0000-4000-8000-000000000001')$$, '42501', 'Super admin access required.', 'demoted actor cannot change mode through service RPC');

SELECT * FROM extensions.finish();
ROLLBACK;
