-- Writable repeatable-read requests cannot refresh a snapshot after a gate wait.
BEGIN ISOLATION LEVEL REPEATABLE READ;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(3);
ALTER ROLE authenticator RESET pgrst.app_settings.maintenance_write_block;
SET LOCAL ROLE anon;
SELECT extensions.throws_ok('SELECT public.enforce_application_request_write_fence()', '25006',
  'Application writes are temporarily unavailable for maintenance.', 'anonymous repeatable-read writes fail closed while maintenance is off');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok('SELECT public.enforce_application_request_write_fence()', '25006',
  'Application writes are temporarily unavailable for maintenance.', 'authenticated repeatable-read writes fail closed while maintenance is off');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok('SELECT public.enforce_application_request_write_fence()', '25006',
  'Application writes are temporarily unavailable for maintenance.', 'service repeatable-read writes fail closed while maintenance is off');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
