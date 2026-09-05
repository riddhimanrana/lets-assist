BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(18);
SELECT extensions.ok(NOT has_function_privilege('authenticated', 'public.read_csf_release_worker_controls(text)', 'EXECUTE'), 'browser cannot read controls');
SELECT extensions.ok(has_function_privilege('service_role', 'public.read_csf_release_worker_controls(text)', 'EXECUTE'), 'server can read controls');
SELECT extensions.ok(NOT has_function_privilege('service_role', 'app_private.set_csf_release_worker_control(text,text,boolean,bigint,uuid,text,text)', 'EXECUTE'), 'runtime cannot enable itself');
SELECT extensions.ok(NOT has_table_privilege('service_role', 'app_private.csf_release_worker_controls', 'UPDATE'), 'runtime cannot write the table');
SELECT extensions.is(public.read_csf_release_worker_controls(repeat('a',40))->'revision', '0'::jsonb, 'new releases start at zero');
SELECT extensions.is(public.read_csf_release_worker_controls(repeat('a',40))->'workers'->>'workbook_refresh', 'false', 'new releases are disabled');
SELECT extensions.throws_ok($$SELECT public.read_csf_release_worker_controls('main')$$, '22023', 'Invalid release identity', 'branch labels are refused');
SELECT extensions.throws_ok($$SELECT app_private.set_csf_release_worker_control(repeat('a',40),'communications',true,0,'dd010000-0000-4000-8000-000000000001','fixture-operator','fixture activation')$$, '22023', 'Enable preceding workers first', 'activation order is enforced');
SELECT extensions.is(
  app_private.set_csf_release_worker_control(repeat('a',40),'workbook_refresh',true,0,'dd010000-0000-4000-8000-000000000002','fixture-operator','fixture activation')->>'revision',
  '1', 'first activation has revision one');
SELECT extensions.is(
  app_private.set_csf_release_worker_control(repeat('a',40),'workbook_refresh',true,0,'dd010000-0000-4000-8000-000000000002','fixture-operator','fixture activation')->>'revision',
  '1', 'lost response replays the same receipt');
SELECT extensions.is((SELECT count(*) FROM app_private.csf_release_worker_receipts WHERE release_sha = repeat('a',40)), 1::bigint, 'replay writes no duplicate receipt');
SELECT extensions.throws_ok($$SELECT app_private.set_csf_release_worker_control(repeat('b',40),'workbook_refresh',true,0,'dd010000-0000-4000-8000-000000000002','fixture-operator','fixture activation')$$, '22023', 'Worker request identity conflict', 'request IDs cannot cross releases');
SELECT extensions.throws_ok($$SELECT app_private.set_csf_release_worker_control(repeat('a',40),'import_commit',true,0,'dd010000-0000-4000-8000-000000000003','fixture-operator','fixture activation')$$, '40001', 'Worker configuration changed', 'stale concurrent writes are refused');
SELECT extensions.is(
  app_private.set_csf_release_worker_control(repeat('a',40),'import_commit',true,1,'dd010000-0000-4000-8000-000000000003','fixture-operator','fixture activation')->'workers'->>'import_commit',
  'true', 'next worker can be enabled');
SELECT extensions.is(
  app_private.set_csf_release_worker_control(repeat('a',40),'workbook_refresh',false,2,'dd010000-0000-4000-8000-000000000004','fixture-operator','fixture rollback')->'workers'->>'workbook_refresh',
  'false', 'independent emergency disable remains possible');
SELECT extensions.is(public.read_csf_release_worker_controls(repeat('b',40))->'workers'->>'import_commit', 'false', 'other release is still disabled');
SELECT extensions.throws_ok($$DELETE FROM app_private.csf_release_worker_receipts WHERE release_sha = repeat('a',40)$$, '55000', 'Worker receipts are immutable', 'operator cannot delete audit receipts');
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT app_private.set_csf_release_worker_control(repeat('a',40),'workbook_refresh',true,3,'dd010000-0000-4000-8000-000000000005','fixture-runtime','fixture activation')$$, '42501', NULL, 'service role cannot call the operator mutation');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
