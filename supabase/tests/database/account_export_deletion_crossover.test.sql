-- Integrated 42000/50600/50700 regression. Written but not run while the owned
-- database is unavailable. Every fixture and simulated provider change rolls back.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(27);

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES
 ('fa840000-0000-4000-8000-000000000001','authenticated','authenticated','export-deletion-pending@local.test',now(),'{}','{}',now(),now()),
 ('fa840000-0000-4000-8000-000000000002','authenticated','authenticated','export-deletion-cleanup@local.test',now(),'{}','{}',now(),now());
CREATE TEMP TABLE crossover_results(key text PRIMARY KEY,value jsonb);
GRANT ALL ON crossover_results TO service_role;

-- A stale queued job must not become new work after the account fence closes.
INSERT INTO public.account_data_export_jobs(id,user_id,delivery_email,protocol_version,status)
VALUES('fa850000-0000-4000-8000-000000000001','fa840000-0000-4000-8000-000000000001',
 'export-deletion-pending@local.test',2,'pending');
INSERT INTO app_private.account_deletion_operations(target_user_id,requested_by,mode,phase)
VALUES('fa840000-0000-4000-8000-000000000001','fa840000-0000-4000-8000-000000000001','self_delete','external_pending');
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.request_account_data_export('fa840000-0000-4000-8000-000000000001')$$,
 '42501','export_account_unavailable','pending account deletion refuses a new export request');
SELECT extensions.is((SELECT count(*) FROM public.claim_account_data_export_jobs(1)),0::bigint,
 'pending account deletion prevents claiming an earlier queued export');
SELECT extensions.ok((SELECT status='pending' AND attempt_count=0 AND lease_token IS NULL
 FROM public.account_data_export_jobs WHERE id='fa850000-0000-4000-8000-000000000001'),
 'refused claim does not advance the queued job or acquire a lease');
SELECT extensions.is((SELECT count(*) FROM public.account_data_export_jobs
 WHERE user_id='fa840000-0000-4000-8000-000000000001'),1::bigint,
 'refused request leaves no duplicate job');

INSERT INTO crossover_results VALUES('request',public.request_account_data_export('fa840000-0000-4000-8000-000000000002'));
INSERT INTO crossover_results SELECT 'first_claim',to_jsonb(c) FROM public.claim_account_data_export_jobs(1) c;
INSERT INTO crossover_results SELECT 'first_plan',public.advance_account_data_export(
 (value->>'id')::uuid,(value->>'lease_token')::uuid,'plan_artifact',
 jsonb_build_object('sha256',repeat('a',64),'size_bytes',17,'record_count',1,'datasets_count',48,
 'manifest',jsonb_build_object('totalDatasets',48))) FROM crossover_results WHERE key='first_claim';
SELECT extensions.ok(public.preflight_account_deletion('fa840000-0000-4000-8000-000000000002',
 'fa840000-0000-4000-8000-000000000002') ? 'export_in_progress',
 'an active archive upload blocks the destructive account phase');
RESET ROLE;

-- Model a lost upload response, a new lease, and both attempts appearing in Storage.
UPDATE public.account_data_export_jobs SET lease_expires_at=now()-interval '1 second'
 WHERE id=(SELECT (value->>'id')::uuid FROM crossover_results WHERE key='first_claim');
SET LOCAL ROLE service_role;
INSERT INTO crossover_results SELECT 'second_claim',to_jsonb(c) FROM public.claim_account_data_export_jobs(1) c;
INSERT INTO crossover_results SELECT 'second_plan',public.advance_account_data_export(
 (value->>'id')::uuid,(value->>'lease_token')::uuid,'plan_artifact',
 jsonb_build_object('sha256',repeat('b',64),'size_bytes',19,'record_count',1,'datasets_count',48,
 'manifest',jsonb_build_object('totalDatasets',48))) FROM crossover_results WHERE key='second_claim';
RESET ROLE;
INSERT INTO storage.objects(bucket_id,name,metadata)
SELECT 'data-exports',value->>'storage_path',jsonb_build_object('size',(value->>'zip_size_bytes')::bigint)
 FROM crossover_results WHERE key IN ('first_plan','second_plan');
UPDATE app_private.account_export_artifacts SET expires_at=now()-interval '1 day'
 WHERE storage_path=(SELECT value->>'storage_path' FROM crossover_results WHERE key='first_plan');
SET LOCAL ROLE service_role;
INSERT INTO crossover_results SELECT 'ready',public.advance_account_data_export(
 (value->>'id')::uuid,(value->>'lease_token')::uuid,'archive_ready') FROM crossover_results WHERE key='second_plan';
SELECT extensions.is((SELECT count(*) FROM app_private.account_export_artifacts
 WHERE job_id=(SELECT (value->>'id')::uuid FROM crossover_results WHERE key='request')),2::bigint,
 'both upload attempts retain their own cleanup path until removal');
SELECT extensions.is((SELECT count(*) FROM public.expired_account_export_artifacts(10)
 WHERE storage_path=(SELECT value->>'storage_path' FROM crossover_results WHERE key='first_plan')),1::bigint,
 'only the expired attempt enters expiry cleanup');
SELECT extensions.ok(NOT public.confirm_account_export_artifact_removed(
 (SELECT value->>'storage_path' FROM crossover_results WHERE key='first_plan')),
 'expiry cleanup cannot acknowledge an object still present in Storage');
RESET ROLE;

-- Synthetic catalog writes stand in for the Storage API inside this rollback.
SET LOCAL storage.allow_delete_query='true';
DELETE FROM storage.objects WHERE bucket_id='data-exports'
 AND name=(SELECT value->>'storage_path' FROM crossover_results WHERE key='first_plan');
SET LOCAL ROLE service_role;
SELECT extensions.ok(public.confirm_account_export_artifact_removed(
 (SELECT value->>'storage_path' FROM crossover_results WHERE key='first_plan')),
 'catalog absence confirms expiry cleanup');
SELECT extensions.ok((SELECT removed_at IS NOT NULL FROM app_private.account_export_artifacts
 WHERE storage_path=(SELECT value->>'storage_path' FROM crossover_results WHERE key='first_plan')),
 'expired artifact retains its removal receipt before account deletion');
SELECT extensions.is(public.preflight_account_deletion('fa840000-0000-4000-8000-000000000002',
 'fa840000-0000-4000-8000-000000000002'),'{}'::jsonb,
 'expired cleanup and a completed remaining archive do not permanently block account deletion');
INSERT INTO crossover_results VALUES('deletion',public.begin_account_deletion(
 'fa840000-0000-4000-8000-000000000002','fa840000-0000-4000-8000-000000000002'));
SELECT extensions.is((SELECT value->>'phase' FROM crossover_results WHERE key='deletion'),'external_pending',
 'account deletion completes its database phase after expiry cleanup');
SELECT extensions.is((SELECT count(*) FROM public.account_data_export_jobs
 WHERE user_id='fa840000-0000-4000-8000-000000000002'),0::bigint,'the deleted account retains no export job');
SELECT extensions.is((SELECT count(*) FROM app_private.account_export_artifacts
 WHERE job_id=(SELECT (value->>'id')::uuid FROM crossover_results WHERE key='request')),0::bigint,
 'job deletion removes its export-specific artifact receipts');
RESET ROLE;
SELECT extensions.ok(EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='data-exports'
 AND name=(SELECT value->>'storage_path' FROM crossover_results WHERE key='second_plan')),
 'database deletion leaves the remaining object for explicit external cleanup');
SET LOCAL ROLE service_role;
INSERT INTO crossover_results SELECT 'cleanup',public.claim_account_deletion_cleanup((value->>'id')::uuid)
 FROM crossover_results WHERE key='deletion';
SELECT extensions.is((SELECT jsonb_array_length(value->'objects') FROM crossover_results WHERE key='cleanup'),1,
 'account cleanup claims the one remaining archive object');
SELECT extensions.is((SELECT value->'objects'->0->>'object_name' FROM crossover_results WHERE key='cleanup'),
 (SELECT value->>'storage_path' FROM crossover_results WHERE key='second_plan'),
 'durable account receipt preserves the exact remaining archive path after the artifact cascade');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM crossover_results r,jsonb_array_elements(r.value->'objects') o
 WHERE r.key='cleanup' AND o->>'object_name'=(SELECT value->>'storage_path' FROM crossover_results WHERE key='first_plan')),
 'the already removed attempt does not become a permanent account cleanup obligation');
SELECT extensions.throws_ok($$INSERT INTO storage.objects(bucket_id,name) VALUES('data-exports',
 'fa840000-0000-4000-8000-000000000002/fa850000-0000-4000-8000-000000000099/fa860000-0000-4000-8000-000000000099.zip')$$,
 '42501',NULL,'a late service upload cannot recreate an archive after account deletion begins');
SELECT extensions.throws_ok($$SELECT public.advance_account_deletion_cleanup(
 (SELECT (value->>'id')::uuid FROM crossover_results WHERE key='cleanup'),
 (SELECT (value->>'claim_token')::uuid FROM crossover_results WHERE key='cleanup'),'storage_removed',
 ARRAY[(SELECT (value->'objects'->0->>'id')::uuid FROM crossover_results WHERE key='cleanup')])$$,
 '55000','Storage removal is not confirmed.','the copied account receipt still requires Storage absence');
SELECT extensions.throws_ok($$SELECT public.advance_account_deletion_cleanup(
 (SELECT (value->>'id')::uuid FROM crossover_results WHERE key='cleanup'),
 (SELECT (value->>'claim_token')::uuid FROM crossover_results WHERE key='cleanup'),'complete')$$,
 '55000','External cleanup is not confirmed.','account deletion cannot finish before Storage and Auth cleanup');
RESET ROLE;
DELETE FROM storage.objects WHERE bucket_id='data-exports'
 AND name=(SELECT value->>'storage_path' FROM crossover_results WHERE key='second_plan');
SET LOCAL ROLE service_role;
SELECT extensions.lives_ok($$SELECT public.advance_account_deletion_cleanup(
 (SELECT (value->>'id')::uuid FROM crossover_results WHERE key='cleanup'),
 (SELECT (value->>'claim_token')::uuid FROM crossover_results WHERE key='cleanup'),'storage_removed',
 ARRAY[(SELECT (value->'objects'->0->>'id')::uuid FROM crossover_results WHERE key='cleanup')])$$,
 'confirmed removal settles the copied account cleanup receipt');
RESET ROLE;
DELETE FROM auth.users WHERE id='fa840000-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
SELECT extensions.is(public.advance_account_deletion_cleanup(
 (SELECT (value->>'id')::uuid FROM crossover_results WHERE key='cleanup'),
 (SELECT (value->>'claim_token')::uuid FROM crossover_results WHERE key='cleanup'),'complete')->>'phase','completed',
 'account deletion finishes after both external cleanup confirmations');
RESET ROLE;
SELECT extensions.is((SELECT count(*) FROM storage.objects WHERE bucket_id='data-exports'
 AND starts_with(name,'fa840000-0000-4000-8000-000000000002/')),0::bigint,
 'neither export attempt is orphaned after the deletion operation completes');
SELECT extensions.ok((SELECT deleted_at IS NOT NULL FROM app_private.account_deletion_storage_objects
 WHERE operation_id=(SELECT (value->>'id')::uuid FROM crossover_results WHERE key='deletion')),
 'the account cleanup receipt survives Auth deletion with confirmed removal');
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.request_account_data_export('fa840000-0000-4000-8000-000000000002')$$,
 '42501','export_account_unavailable','completed deletion cannot request another export');
SELECT extensions.is((SELECT count(*) FROM public.claim_account_data_export_jobs(1)),0::bigint,
 'cleanup completion does not reopen the other pending-deletion account');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
