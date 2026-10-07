-- Role changes stay inside this rollback. HTTP read-only transactions are
-- exercised separately by the isolated maintenance acceptance runner.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(25);

SELECT extensions.has_function('public', 'enforce_application_request_write_fence', ARRAY[]::text[],
  'the permanent request hook has no arguments');
SELECT extensions.is((SELECT provolatile::text FROM pg_catalog.pg_proc
  WHERE oid = 'public.enforce_application_request_write_fence()'::regprocedure), 's', 'the hook is stable');
SELECT extensions.ok((SELECT NOT prosecdef FROM pg_catalog.pg_proc
  WHERE oid = 'public.enforce_application_request_write_fence()'::regprocedure), 'the hook uses caller privileges');
SELECT extensions.is((SELECT prorettype::regtype::text FROM pg_catalog.pg_proc
  WHERE oid = 'public.enforce_application_request_write_fence()'::regprocedure), 'void', 'the hook returns no data');
SELECT extensions.is((SELECT pg_catalog.array_to_string(proconfig, ',') FROM pg_catalog.pg_proc
  WHERE oid = 'public.enforce_application_request_write_fence()'::regprocedure), 'search_path=""', 'the hook has an empty search path');
SELECT extensions.ok((SELECT 'pgrst.db_pre_request=public.enforce_application_request_write_fence' = ANY (rolconfig)
  FROM pg_catalog.pg_roles WHERE rolname = 'authenticator'), 'the global authenticator hook is configured');
SELECT extensions.ok(NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_db_role_setting AS configured
  CROSS JOIN LATERAL pg_catalog.unnest(configured.setconfig) AS entry(setting)
  WHERE configured.setrole IN (0, 'authenticator'::regrole::oid)
    AND configured.setdatabase IN (0, (SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database()))
    AND pg_catalog.split_part(entry.setting, '=', 1) = 'pgrst.db_pre_request'
    AND (configured.setrole <> 'authenticator'::regrole::oid OR configured.setdatabase <> 0)
), 'no database hook override shadows the reviewed global setting');
SELECT extensions.ok(NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_proc AS proc
  CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(proc.proacl, pg_catalog.acldefault('f', proc.proowner))) AS permission
  WHERE proc.oid = 'public.enforce_application_request_write_fence()'::regprocedure
    AND permission.grantee = 0 AND permission.privilege_type = 'EXECUTE'
), 'PUBLIC has no implicit execution grant');
SELECT extensions.ok(pg_catalog.has_function_privilege(role_name,
  'public.enforce_application_request_write_fence()', 'EXECUTE'), role_name || ' can run the request hook')
FROM (VALUES ('anon'), ('authenticated'), ('service_role'), ('postgres')) AS actor(role_name);

ALTER ROLE authenticator RESET pgrst.app_settings.maintenance_write_block;
SET LOCAL ROLE anon;
SELECT extensions.lives_ok('SELECT public.enforce_application_request_write_fence()', 'anonymous requests continue outside maintenance');
SELECT extensions.throws_ok($$ALTER ROLE authenticator SET pgrst.app_settings.maintenance_write_block = 'off'$$,
  '42501', NULL, 'anonymous callers cannot change the maintenance flag');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT extensions.lives_ok('SELECT public.enforce_application_request_write_fence()', 'authenticated requests continue outside maintenance');
SELECT extensions.throws_ok($$ALTER ROLE authenticator SET pgrst.app_settings.maintenance_write_block = 'off'$$,
  '42501', NULL, 'authenticated callers cannot change the maintenance flag');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT extensions.lives_ok('SELECT public.enforce_application_request_write_fence()', 'service requests continue outside maintenance');
SELECT extensions.throws_ok($$ALTER ROLE authenticator SET pgrst.app_settings.maintenance_write_block = 'off'$$,
  '42501', NULL, 'service callers cannot change the maintenance flag');
RESET ROLE;

ALTER ROLE authenticator SET pgrst.app_settings.maintenance_write_block = 'on';
SET LOCAL request.method = 'GET';
SET LOCAL ROLE anon;
SELECT extensions.throws_ok('SELECT public.enforce_application_request_write_fence()', '25006',
  'Application writes are temporarily unavailable for maintenance.', 'anonymous writable transactions cannot spoof a read method');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok('SELECT public.enforce_application_request_write_fence()', '25006',
  'Application writes are temporarily unavailable for maintenance.', 'authenticated writable transactions remain blocked');
SET LOCAL pgrst.app_settings.maintenance_write_block = 'off';
SELECT extensions.throws_ok('SELECT public.enforce_application_request_write_fence()', '25006',
  'Application writes are temporarily unavailable for maintenance.', 'a request-local off setting cannot bypass the operator-owned catalog flag');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok('SELECT public.enforce_application_request_write_fence()', '25006',
  'Application writes are temporarily unavailable for maintenance.', 'service writable transactions have no exemption');
RESET ROLE;

ALTER ROLE authenticator RESET pgrst.app_settings.maintenance_write_block;
SET LOCAL ROLE anon;
SELECT extensions.lives_ok('SELECT public.enforce_application_request_write_fence()', 'anonymous requests resume after the operator clears the flag');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT extensions.lives_ok('SELECT public.enforce_application_request_write_fence()', 'authenticated requests resume after the operator clears the flag');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT extensions.lives_ok('SELECT public.enforce_application_request_write_fence()', 'service requests resume after the operator clears the flag');
RESET ROLE;

SELECT * FROM extensions.finish();
ROLLBACK;
