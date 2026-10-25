BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
SELECT extensions.ok(NOT has_table_privilege('authenticated','public.account_data_export_jobs','INSERT'),'browser sessions cannot bypass fresh Auth or choose export delivery details');
SELECT extensions.is((SELECT count(*) FROM app_private.client_relation_grant_catalog() WHERE relation_name='account_data_export_jobs' AND privilege='INSERT'),0::bigint,'browser INSERT removal is reflected in the authority catalog');
SELECT extensions.ok((SELECT bool_and(NOT has_function_privilege('anon',f,'EXECUTE') AND NOT has_function_privilege('authenticated',f,'EXECUTE') AND has_function_privilege('service_role',f,'EXECUTE')) FROM unnest(ARRAY[
 'public.request_account_data_export(uuid)', 'public.claim_account_data_export_jobs(integer)', 'public.advance_account_data_export(uuid,uuid,text,jsonb)', 'public.expired_account_export_artifacts(integer)', 'public.confirm_account_export_artifact_removed(text)']) f),'export lifecycle RPCs are service only');
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('fa830000-0000-4000-8000-000000000001','authenticated','authenticated','export-protocol@local.test',now(),'{}','{}',now(),now()),
 ('fa830000-0000-4000-8000-000000000002','authenticated','authenticated','export-unverified@local.test',NULL,'{}','{}',now(),now());
CREATE TEMP TABLE export_results(key text PRIMARY KEY, value jsonb);
INSERT INTO export_results VALUES('request',public.request_account_data_export('fa830000-0000-4000-8000-000000000001'));
SELECT extensions.is((SELECT value->>'existing' FROM export_results WHERE key='request'),'false','first request persists a new job');
SELECT extensions.is(public.request_account_data_export('fa830000-0000-4000-8000-000000000001')->>'existing','true','repeated request reuses existing job');
SELECT extensions.is((SELECT count(*) FROM public.account_data_export_jobs WHERE user_id='fa830000-0000-4000-8000-000000000001'),1::bigint,'retry does not duplicate export work');
SELECT extensions.throws_ok($$SELECT public.request_account_data_export('fa830000-0000-4000-8000-000000000002')$$,'42501','export_verified_email_required','unverified account cannot enqueue an export');
INSERT INTO export_results SELECT 'claim',to_jsonb(c) FROM public.claim_account_data_export_jobs(1) c;
SELECT extensions.is((SELECT value->>'status' FROM export_results WHERE key='claim'),'processing','claim persists processing state');
SELECT extensions.is((SELECT count(*) FROM public.claim_account_data_export_jobs(1)),0::bigint,'active claim cannot be claimed by a second worker');
SELECT extensions.throws_ok(format('SELECT public.advance_account_data_export(%L,%L,%L)',(SELECT value->>'id' FROM export_results WHERE key='claim'),'fa830000-0000-4000-8000-000000000099','archive_ready'),'55P03','export_lease_lost','stale claim cannot settle newer work');
INSERT INTO export_results SELECT 'plan',public.advance_account_data_export((value->>'id')::uuid,(value->>'lease_token')::uuid,'plan_artifact',jsonb_build_object('sha256',repeat('a',64),'size_bytes',17,'record_count',1,'datasets_count',48,'manifest',jsonb_build_object('totalDatasets',48))) FROM export_results WHERE key='claim';
SELECT extensions.ok((SELECT (value->>'storage_path') LIKE 'fa830000-0000-4000-8000-000000000001/%' FROM export_results WHERE key='plan'),'object path is derived from the account, job and lease');
SELECT extensions.is((SELECT count(*) FROM app_private.account_export_artifacts),1::bigint,'artifact intent exists before any provider upload');
UPDATE public.account_data_export_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=(SELECT (value->>'id')::uuid FROM export_results WHERE key='claim');
INSERT INTO export_results SELECT 'retry',to_jsonb(c) FROM public.claim_account_data_export_jobs(1) c;
SELECT extensions.ok((SELECT value->>'lease_token' FROM export_results WHERE key='retry')<>(SELECT value->>'lease_token' FROM export_results WHERE key='claim'),'expired work gets a new claim');
SELECT extensions.is((SELECT value->>'storage_path' FROM export_results WHERE key='retry'),(SELECT value->>'storage_path' FROM export_results WHERE key='plan'),'artifact identity survives the crash for independent verification');
SELECT extensions.throws_ok(format('SELECT public.advance_account_data_export(%L,%L,%L)',(SELECT value->>'id' FROM export_results WHERE key='retry'),(SELECT value->>'lease_token' FROM export_results WHERE key='retry'),'archive_ready'),'P0001','export_storage_unconfirmed','planned metadata alone cannot make an archive ready');
INSERT INTO storage.objects(bucket_id,name,metadata) SELECT 'data-exports',value->>'storage_path','{"size":17}'::jsonb FROM export_results WHERE key='plan';
INSERT INTO export_results SELECT 'ready',public.advance_account_data_export((value->>'id')::uuid,(value->>'lease_token')::uuid,'archive_ready') FROM export_results WHERE key='retry';
SELECT extensions.is((SELECT value->>'status' FROM export_results WHERE key='ready'),'completed','archive readiness is separate from email delivery');
SELECT extensions.is((SELECT value->>'delivery_status' FROM export_results WHERE key='ready'),'not_attempted','ready archive does not mean email was sent');
SELECT extensions.ok((SELECT value->>'signed_url' IS NULL FROM export_results WHERE key='ready'),'ready receipt stores no bearer download URL');
INSERT INTO export_results SELECT 'sending',public.advance_account_data_export((value->>'id')::uuid,(value->>'lease_token')::uuid,'begin_delivery') FROM export_results WHERE key='ready';
SELECT extensions.is((SELECT value->>'delivery_status' FROM export_results WHERE key='sending'),'sending','provider attempt is persisted before sending');
SELECT extensions.throws_ok(format('SELECT public.advance_account_data_export(%L,%L,%L)',(SELECT value->>'id' FROM export_results WHERE key='sending'),(SELECT value->>'lease_token' FROM export_results WHERE key='sending'),'begin_delivery'),'P0001','export_transition_refused','same claim cannot start a second email attempt');
INSERT INTO export_results SELECT 'unknown',public.advance_account_data_export((value->>'id')::uuid,(value->>'lease_token')::uuid,'settle_delivery','{"outcome":"unknown"}') FROM export_results WHERE key='sending';
SELECT extensions.is((SELECT value->>'delivery_status' FROM export_results WHERE key='unknown'),'sending','unknown delivery remains explicit');
SELECT extensions.is((SELECT count(*) FROM public.claim_account_data_export_jobs(1)),0::bigint,'unknown delivery is never automatically resent');
UPDATE app_private.account_export_artifacts SET expires_at=now()-interval '1 day';
SELECT extensions.is((SELECT count(*) FROM public.expired_account_export_artifacts(10)),1::bigint,'expired artifact is available to bounded cleanup');
SELECT extensions.ok(NOT public.confirm_account_export_artifact_removed((SELECT value->>'storage_path' FROM export_results WHERE key='plan')),'existing Storage object prevents cleanup acknowledgment');
-- Synthetic fixture deletion simulates the Storage API. Application code never writes this catalog.
SET LOCAL storage.allow_delete_query='true';
DELETE FROM storage.objects WHERE bucket_id='data-exports' AND name=(SELECT value->>'storage_path' FROM export_results WHERE key='plan');
SELECT extensions.ok(public.confirm_account_export_artifact_removed((SELECT value->>'storage_path' FROM export_results WHERE key='plan')),'independent catalog absence confirms cleanup');
SELECT extensions.is((SELECT count(*) FROM public.expired_account_export_artifacts(10)),0::bigint,'confirmed removed artifact leaves cleanup queue');
INSERT INTO public.account_data_export_jobs(user_id,delivery_email,protocol_version,status)
VALUES('fa830000-0000-4000-8000-000000000002','legacy@local.test',1,'processing');
SELECT extensions.is((SELECT count(*) FROM public.claim_account_data_export_jobs(1)),0::bigint,'legacy processing cannot be automatically replayed');
SELECT extensions.throws_ok($$SELECT public.claim_account_data_export_jobs(NULL)$$,'P0001','export_invalid_limit','null cannot bypass the bounded claim limit');
UPDATE public.account_data_export_jobs SET delivery_status='not_attempted',artifact_expires_at=now()-interval '1 day'
 WHERE user_id='fa830000-0000-4000-8000-000000000001';
SELECT extensions.is((SELECT count(*) FROM public.claim_account_data_export_jobs(1)),0::bigint,'expired archive notification is terminal instead of requeued');
SELECT extensions.is((SELECT delivery_status FROM public.account_data_export_jobs WHERE user_id='fa830000-0000-4000-8000-000000000001'),'failed','expired notification becomes an explicit failed delivery');
SELECT extensions.is((SELECT count(*) FROM public.claim_account_data_export_jobs(1)),0::bigint,'later workers do not retry the expired notification');
SELECT * FROM extensions.finish();
ROLLBACK;
