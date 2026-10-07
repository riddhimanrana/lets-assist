BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(27);
SELECT extensions.ok(NOT has_table_privilege('anon','app_private.worker_run_receipts','SELECT'),'anonymous cannot read receipts');
SELECT extensions.ok(NOT has_table_privilege('authenticated','app_private.worker_run_receipts','SELECT'),'browser cannot read receipts');
SELECT extensions.ok(NOT has_table_privilege('service_role','app_private.worker_run_receipts','INSERT'),'service cannot bypass receipt RPC');
SELECT extensions.ok((SELECT relrowsecurity FROM pg_class WHERE oid='app_private.worker_run_receipts'::regclass),'receipt RLS enabled');
SELECT extensions.ok(bool_and(NOT has_function_privilege('anon',signature,'EXECUTE') AND NOT has_function_privilege('authenticated',signature,'EXECUTE') AND has_function_privilege('service_role',signature,'EXECUTE')),'receipt functions are service only')
FROM (VALUES ('public.start_worker_run_receipt(uuid,text,text,text)'),('public.finish_worker_run_receipt(uuid,text,text,jsonb)'),('public.read_worker_run_receipts(text,text)')) f(signature);
CREATE FUNCTION pg_temp.receipt_result(p_changes jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT '{"outcome":"processed","code":"completed","durationMs":10,"attempted":1,"completed":1,"failed":0,"pending":0,"refused":0,"faults":0,"deadlineReached":false}'::jsonb || p_changes;
$$;
CREATE FUNCTION pg_temp.finish_receipt(p_changes jsonb DEFAULT '{}',p_worker text DEFAULT 'csf-communications-dispatch',p_env text DEFAULT 'local') RETURNS void LANGUAGE sql AS $$
 SELECT public.finish_worker_run_receipt('bc100000-0000-4000-8000-000000000001',p_worker,p_env,pg_temp.receipt_result(p_changes));
$$;
SELECT extensions.lives_ok($$SELECT public.start_worker_run_receipt('bc100000-0000-4000-8000-000000000001','csf-communications-dispatch','local',repeat('a',40))$$,'start records an execution');
SELECT extensions.is((SELECT outcome FROM app_private.worker_run_receipts WHERE run_id='bc100000-0000-4000-8000-000000000001'),'started','crashed pass remains started');
SELECT extensions.throws_ok($$SELECT pg_temp.finish_receipt('{}','data-exports')$$,'55000','Worker receipt is missing, mismatched, or already finished.','wrong worker cannot finish');
SELECT extensions.throws_ok($$SELECT pg_temp.finish_receipt('{}','csf-communications-dispatch','production')$$,'55000','Worker receipt is missing, mismatched, or already finished.','wrong environment cannot finish');
SELECT extensions.throws_ok($$SELECT pg_temp.finish_receipt('{"error":"forbidden raw text"}')$$,'22023','Invalid aggregate worker result.','unknown raw fields refused');
SELECT extensions.throws_ok($$SELECT pg_temp.finish_receipt('{"outcome":null}')$$,'22023','Invalid aggregate worker result.','null outcome refused');
SELECT extensions.throws_ok($$SELECT pg_temp.finish_receipt('{"code":3}')$$,'22023','Invalid aggregate worker result.','wrong code type refused');
SELECT extensions.throws_ok($$SELECT pg_temp.finish_receipt('{"completed":1.5}')$$,'22023','Invalid aggregate worker result.','fractional count refused');
SELECT extensions.throws_ok($$SELECT pg_temp.finish_receipt('{"completed":1000001}')$$,'23514',NULL,'unbounded count refused');
SELECT extensions.throws_ok($$SELECT pg_temp.finish_receipt('{"code":"worker_failed"}')$$,'23514',NULL,'outcome code mismatch refused');
SELECT extensions.throws_ok($$SELECT pg_temp.finish_receipt('{"failed":1}')$$,'23514',NULL,'processed cannot hide failed work');
SELECT extensions.throws_ok($$SELECT pg_temp.finish_receipt('{"outcome":"no_run","code":"empty_queue"}')$$,'23514',NULL,'empty queue cannot claim completed work');
SELECT extensions.lives_ok($$SELECT pg_temp.finish_receipt()$$,'valid finish succeeds');
SELECT extensions.is((SELECT outcome FROM app_private.worker_run_receipts WHERE run_id='bc100000-0000-4000-8000-000000000001'),'processed','finish persisted');
SELECT extensions.throws_ok($$SELECT pg_temp.finish_receipt()$$,'55000','Worker receipt is missing, mismatched, or already finished.','finish is not repeated');
SELECT extensions.is(jsonb_array_length(public.read_worker_run_receipts('csf-communications-dispatch','local')),1,'read returns scoped current receipt');
SELECT extensions.is(jsonb_array_length(public.read_worker_run_receipts('csf-communications-dispatch','production')),0,'read cannot mix environments');
INSERT INTO app_private.worker_run_receipts(run_id,worker_key,environment,started_at)
SELECT gen_random_uuid(),'project-cancellations','local',clock_timestamp()-make_interval(secs=>n) FROM generate_series(1,25)n;
SELECT extensions.is(jsonb_array_length(public.read_worker_run_receipts('project-cancellations','local')),20,'read bounded to twenty receipts');
INSERT INTO app_private.worker_run_receipts(run_id,worker_key,environment,started_at)
VALUES ('bc100000-0000-4000-8000-000000000002','data-exports','local',clock_timestamp()-interval '31 days');
SELECT extensions.is(jsonb_array_length(public.read_worker_run_receipts('data-exports','local')),0,'expired crashed receipt excluded from reads');
SELECT public.start_worker_run_receipt(gen_random_uuid(),'data-exports','local');
SELECT extensions.is((SELECT count(*)::integer FROM app_private.worker_run_receipts WHERE run_id='bc100000-0000-4000-8000-000000000002'),0,'later start prunes expired receipt');
SELECT extensions.throws_ok($$SELECT public.read_worker_run_receipts('request-chosen-worker','local')$$,'22023','Invalid worker receipt scope.','unknown worker refused');
SELECT extensions.throws_ok($$SELECT public.start_worker_run_receipt(gen_random_uuid(),'data-exports','local','request-chosen-id')$$,'23514',NULL,'source SHA constrained');
SELECT * FROM extensions.finish();
ROLLBACK;
