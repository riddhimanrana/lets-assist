BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(52);
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('fd000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'delete-'||n||'@local.test',now(),CASE WHEN n=5 THEN '{"role":"super_admin"}'::jsonb ELSE '{}'::jsonb END,'{}',now(),now()
FROM generate_series(1,6) n;
INSERT INTO public.organizations(id,name,username,type,join_code)
VALUES('fd100000-0000-4000-8000-000000000001','Deletion protocol','deletion-protocol','school','839921');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
VALUES('fd100000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001','admin','active'),
 ('fd100000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000002','admin','inactive');
INSERT INTO public.notifications(user_id,title,body,type) VALUES('fd000000-0000-4000-8000-000000000003','Synthetic','Synthetic','general');
INSERT INTO public.feedback(user_id,section,email,title,feedback)
VALUES('fd000000-0000-4000-8000-000000000003','other','synthetic@local.test','Synthetic','Synthetic');
INSERT INTO public.reporter_references(reference,reporter_id)
VALUES('fd200000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000003');
INSERT INTO public.content_reports(reporter_id,reporter_reference,content_type,content_id,reason,description)
VALUES('fd000000-0000-4000-8000-000000000003','fd200000-0000-4000-8000-000000000001','user','fd000000-0000-4000-8000-000000000004','spam','Synthetic report');
INSERT INTO public.certificates(user_id,project_title,is_certified,event_start,event_end,check_in_method)
VALUES('fd000000-0000-4000-8000-000000000003','Synthetic receipt',false,now(),now(),'manual');

SET LOCAL ROLE service_role;
SELECT extensions.ok(public.preflight_account_deletion('fd000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001') ? 'sole_admin_organizations',
 'an inactive second administrator does not make deletion safe');
SELECT extensions.is(public.begin_account_deletion('fd000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001')->>'phase','blocked',
 'the atomic phase repeats preflight and refuses sole-admin deletion');
SELECT extensions.throws_ok($$SELECT public.begin_account_deletion('fd000000-0000-4000-8000-000000000002','fd000000-0000-4000-8000-000000000003')$$,
 '42501',NULL,'self-deletion cannot supply a different target');
SELECT extensions.throws_ok($$SELECT public.begin_account_deletion('fd000000-0000-4000-8000-000000000002','fd000000-0000-4000-8000-000000000003','admin_blacklist')$$,
 '42501',NULL,'a regular user cannot request administrative deletion');
RESET ROLE;
SELECT extensions.is((SELECT count(*) FROM public.profiles WHERE id='fd000000-0000-4000-8000-000000000001'),1::bigint,'blocked preflight preserves the profile');
SELECT extensions.ok(app_private.account_deletion_actor_is_active('fd000000-0000-4000-8000-000000000001'),'blocked preflight leaves normal writes available');
SELECT set_config('request.jwt.claim.sub','fd000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok($$UPDATE public.organization_members SET status='inactive'
 WHERE organization_id='fd100000-0000-4000-8000-000000000001' AND user_id='fd000000-0000-4000-8000-000000000001'$$,
 '23514','cannot remove the final active organization admin','a direct browser status change cannot deactivate the last active admin');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$UPDATE public.organization_members SET status='inactive'
 WHERE organization_id='fd100000-0000-4000-8000-000000000001' AND user_id='fd000000-0000-4000-8000-000000000001'$$,
 '23514','cannot remove the final active organization admin','service actions also preserve the last active admin');
RESET ROLE;
SELECT extensions.is((SELECT count(*) FROM app_private.account_deletion_operations WHERE target_user_id='fd000000-0000-4000-8000-000000000002'),0::bigint,
 'read-only preview and authorization failures create no operation');
INSERT INTO public.organization_sheet_syncs(organization_id,created_by,sheet_id,sheet_url)
VALUES('fd100000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000002','synthetic','https://example.invalid/synthetic');
SELECT extensions.ok(public.preflight_account_deletion('fd000000-0000-4000-8000-000000000002','fd000000-0000-4000-8000-000000000002') ? 'sheet_sync_ownership',
 'required sync ownership blocks before any destructive phase');
DELETE FROM public.organization_sheet_syncs WHERE created_by='fd000000-0000-4000-8000-000000000002';
CREATE TABLE app_private.account_deletion_retained_fixture(user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT);
INSERT INTO app_private.account_deletion_retained_fixture VALUES('fd000000-0000-4000-8000-000000000002');
SELECT extensions.ok(public.preflight_account_deletion('fd000000-0000-4000-8000-000000000002','fd000000-0000-4000-8000-000000000002') ? 'retained_account_references',
 'new private retained-owner references block before cleanup rather than stranding Auth deletion');
DROP TABLE app_private.account_deletion_retained_fixture;
INSERT INTO plugin_data.org_member_profiles(organization_id,user_id,plugin_key)
VALUES('fd100000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000002','dvhs-csf');
SELECT extensions.ok(public.preflight_account_deletion('fd000000-0000-4000-8000-000000000002','fd000000-0000-4000-8000-000000000002') ? 'plugin_retention_review_required',
 'plugin membership survives until its retention review resolves the account link');
DELETE FROM plugin_data.org_member_profiles WHERE user_id='fd000000-0000-4000-8000-000000000002';
INSERT INTO public.user_calendar_connections(user_id,provider,access_token,refresh_token,token_expires_at,calendar_email)
VALUES('fd000000-0000-4000-8000-000000000002','google','synthetic-token','synthetic-refresh',now()+interval '1 hour','synthetic@local.test');
SELECT extensions.ok(public.preflight_account_deletion('fd000000-0000-4000-8000-000000000002','fd000000-0000-4000-8000-000000000002') ? 'connected_provider_accounts',
 'provider credentials are not discarded before disconnect cleanup');
DELETE FROM public.user_calendar_connections WHERE user_id='fd000000-0000-4000-8000-000000000002';
INSERT INTO public.account_data_export_jobs(user_id,status,delivery_email)
VALUES('fd000000-0000-4000-8000-000000000002','processing','synthetic@local.test');
SELECT extensions.ok(public.preflight_account_deletion('fd000000-0000-4000-8000-000000000002','fd000000-0000-4000-8000-000000000002') ? 'export_in_progress',
 'an in-flight exporter prevents deletion racing its upload');
DELETE FROM public.account_data_export_jobs WHERE user_id='fd000000-0000-4000-8000-000000000002';
INSERT INTO storage.objects(bucket_id,name,owner)
VALUES('plugins','synthetic-retained-evidence','fd000000-0000-4000-8000-000000000002');
SELECT extensions.ok(public.preflight_account_deletion('fd000000-0000-4000-8000-000000000002','fd000000-0000-4000-8000-000000000002') ? 'retained_storage_ownership',
 'organization and plugin objects are not swept into personal cleanup');
SET LOCAL storage.allow_delete_query='true';
DELETE FROM storage.objects WHERE bucket_id='plugins' AND name='synthetic-retained-evidence';
INSERT INTO public.projects(id,creator_id,title,description,location,event_type,verification_method,schedule,require_login,organization_id)
VALUES('fd300000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000002','Synthetic project','Synthetic','Local','oneTime','manual',
 '{"oneTime":{"date":"2030-01-01","startTime":"10:00","endTime":"12:00","volunteers":5}}',true,'fd100000-0000-4000-8000-000000000001');
SELECT extensions.ok(public.preflight_account_deletion('fd000000-0000-4000-8000-000000000002','fd000000-0000-4000-8000-000000000002') ? 'project_ownership',
 'organization project ownership requires transfer rather than cascade deletion');
UPDATE public.projects SET organization_id=NULL WHERE id='fd300000-0000-4000-8000-000000000001';
SELECT extensions.ok(public.preflight_account_deletion('fd000000-0000-4000-8000-000000000002','fd000000-0000-4000-8000-000000000002','self_delete',false) ? 'project_ownership',
 'the no-project-deletion option cannot be defeated by a profile cascade');
INSERT INTO public.project_signups(project_id,user_id,schedule_id,status)
VALUES('fd300000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001','oneTime','approved');
SELECT extensions.ok(public.preflight_account_deletion('fd000000-0000-4000-8000-000000000002','fd000000-0000-4000-8000-000000000002') ? 'other_project_participants',
 'another participant prevents deleting the project through account removal');
INSERT INTO public.project_paper_roster_entries(project_id,schedule_id,name,batch_id,scan_row_id)
VALUES('fd300000-0000-4000-8000-000000000001','oneTime','Synthetic attendee',NULL,NULL);
SELECT extensions.ok(public.preflight_account_deletion('fd000000-0000-4000-8000-000000000002','fd000000-0000-4000-8000-000000000002') ? 'retained_project_evidence',
 'paper attendance survives even when its original scan batch no longer exists');
DELETE FROM public.projects WHERE id='fd300000-0000-4000-8000-000000000001';

CREATE FUNCTION pg_temp.refuse_notification_delete() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Synthetic cleanup failure'; END;$$;
CREATE TRIGGER synthetic_account_failure BEFORE DELETE ON public.notifications FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_notification_delete();
SELECT extensions.is(public.begin_account_deletion('fd000000-0000-4000-8000-000000000003','fd000000-0000-4000-8000-000000000003')->>'safe_error_code','database_phase_failed',
 'a failure after earlier cleanup steps records a safe failure code');
SELECT extensions.is((SELECT count(*) FROM public.feedback WHERE user_id='fd000000-0000-4000-8000-000000000003'),1::bigint,
 'a later error rolls back earlier personal data deletion');
SELECT extensions.is((SELECT count(*) FROM public.content_reports WHERE reporter_id='fd000000-0000-4000-8000-000000000003'),1::bigint,
 'a later error rolls back reporter detachment');
SELECT extensions.is((SELECT count(*) FROM public.profiles WHERE id='fd000000-0000-4000-8000-000000000003'),1::bigint,
 'a later error preserves the profile');
DROP TRIGGER synthetic_account_failure ON public.notifications;
CREATE TEMP TABLE deletion_receipt AS SELECT public.begin_account_deletion('fd000000-0000-4000-8000-000000000003','fd000000-0000-4000-8000-000000000003') AS result;
SELECT extensions.is((SELECT result->>'phase' FROM deletion_receipt),'external_pending','a repaired retry commits the database phase once');
SELECT extensions.is((SELECT count(*) FROM public.feedback WHERE user_id='fd000000-0000-4000-8000-000000000003'),0::bigint,'personal feedback is removed');
SELECT extensions.ok((SELECT reporter_id IS NULL AND reporter_reference IS NOT NULL FROM public.content_reports WHERE description='Synthetic report'),
 'moderation evidence retains an opaque reporter reference');
SELECT extensions.is((SELECT count(*) FROM public.certificates WHERE project_title='Synthetic receipt' AND user_id IS NULL),1::bigint,
 'the certificate survives with personal account linkage cleared');
SELECT extensions.is((SELECT count(*) FROM auth.users WHERE id='fd000000-0000-4000-8000-000000000003'),1::bigint,
 'the database phase does not mutate the external Auth lifecycle');
SELECT extensions.is(public.begin_account_deletion('fd000000-0000-4000-8000-000000000003','fd000000-0000-4000-8000-000000000003')->>'id',
 (SELECT result->>'id' FROM deletion_receipt),'an unknown commit response resumes the same operation');
SELECT extensions.throws_ok($$SELECT public.begin_account_deletion('fd000000-0000-4000-8000-000000000003','fd000000-0000-4000-8000-000000000003','self_delete',false)$$,
 '22023',NULL,'a retry cannot change its frozen deletion intent');
CREATE TEMP TABLE cleanup_claim AS SELECT public.claim_account_deletion_cleanup((SELECT (result->>'id')::uuid FROM deletion_receipt)) AS result;
SELECT extensions.throws_ok($$SELECT public.claim_account_deletion_cleanup((SELECT (result->>'id')::uuid FROM deletion_receipt))$$,
 '55P03',NULL,'a live cleanup lease refuses a second worker');
SELECT extensions.throws_ok($$SELECT public.advance_account_deletion_cleanup((SELECT (result->>'id')::uuid FROM cleanup_claim),gen_random_uuid(),'complete')$$,
 '55000',NULL,'a stale claim cannot complete an operation');
SELECT extensions.throws_ok($$SELECT public.advance_account_deletion_cleanup((SELECT (result->>'id')::uuid FROM cleanup_claim),(SELECT (result->>'claim_token')::uuid FROM cleanup_claim),'complete')$$,
 '55000',NULL,'completion requires independently confirmed Auth cleanup');
SELECT extensions.is(public.advance_account_deletion_cleanup((SELECT (result->>'id')::uuid FROM cleanup_claim),(SELECT (result->>'claim_token')::uuid FROM cleanup_claim),'auth_cleanup_failed')->>'phase',
 'external_pending','an Auth failure leaves a resumable receipt');
SELECT extensions.ok(NOT app_private.account_deletion_actor_is_active('fd000000-0000-4000-8000-000000000003'),
 'normal writes remain fenced after an Auth failure');
UPDATE cleanup_claim SET result=public.claim_account_deletion_cleanup((SELECT (result->>'id')::uuid FROM deletion_receipt));
DELETE FROM auth.users WHERE id='fd000000-0000-4000-8000-000000000003';
SELECT extensions.is(public.advance_account_deletion_cleanup((SELECT (result->>'id')::uuid FROM cleanup_claim),(SELECT (result->>'claim_token')::uuid FROM cleanup_claim),'complete')->>'phase',
 'completed','confirmed Auth removal completes the durable receipt');
SELECT extensions.is(public.claim_account_deletion_cleanup((SELECT (result->>'id')::uuid FROM deletion_receipt))->>'phase','completed',
 'replaying completed cleanup performs no new work');
SELECT extensions.is(public.begin_account_deletion('fd000000-0000-4000-8000-000000000005','fd000000-0000-4000-8000-000000000004','admin_blacklist',true,'Synthetic moderation reason')->>'phase',
 'external_pending','administrative removal uses the same atomic phase');
SELECT extensions.is((SELECT count(*) FROM public.banned_emails WHERE email='delete-4@local.test'),1::bigint,'the email blacklist commits with personal data cleanup');
SELECT extensions.is((SELECT reason FROM public.banned_emails WHERE email='delete-4@local.test'),'Synthetic moderation reason',
 'administrative reason persists with the frozen deletion intent');
CREATE TEMP TABLE blacklist_claim AS SELECT public.claim_account_deletion_cleanup((SELECT id FROM app_private.account_deletion_operations
 WHERE target_user_id='fd000000-0000-4000-8000-000000000004')) AS result;
SELECT extensions.throws_ok($$SELECT public.advance_account_deletion_cleanup((SELECT (result->>'id')::uuid FROM blacklist_claim),
 (SELECT (result->>'claim_token')::uuid FROM blacklist_claim),'complete')$$,'55000',NULL,'blacklist completion requires confirmed provider ban state');
UPDATE auth.users SET banned_until=now()+interval '1 day',raw_app_meta_data='{"account_access":{"status":"banned"}}'
WHERE id='fd000000-0000-4000-8000-000000000004';
SELECT extensions.is(public.advance_account_deletion_cleanup((SELECT (result->>'id')::uuid FROM blacklist_claim),
 (SELECT (result->>'claim_token')::uuid FROM blacklist_claim),'complete')->>'phase','completed','confirmed ban completes administrative removal');
SELECT extensions.is((SELECT count(*) FROM auth.users WHERE id='fd000000-0000-4000-8000-000000000004'),1::bigint,
 'administrative removal retains the banned Auth record');
SELECT extensions.ok(NOT app_private.account_deletion_actor_is_active('fd000000-0000-4000-8000-000000000004'),
 'old access tokens cannot reopen ordinary writes after administrative completion');
INSERT INTO storage.objects(bucket_id,name,owner)
VALUES('avatars','fd000000-0000-4000-8000-000000000006-1700000000000.jpg','fd000000-0000-4000-8000-000000000006'),
 ('data-exports','fd000000-0000-4000-8000-000000000006/synthetic/export.zip',NULL);
SELECT extensions.is(public.preflight_account_deletion('fd000000-0000-4000-8000-000000000006','fd000000-0000-4000-8000-000000000006'),
 '{}'::jsonb,'only recognized personal storage is eligible for automatic cleanup');
CREATE TEMP TABLE storage_operation AS SELECT public.begin_account_deletion('fd000000-0000-4000-8000-000000000006','fd000000-0000-4000-8000-000000000006') AS result;
CREATE TEMP TABLE storage_claim AS SELECT public.claim_account_deletion_cleanup((SELECT (result->>'id')::uuid FROM storage_operation)) AS result;
SELECT extensions.is((SELECT jsonb_array_length(result->'objects') FROM storage_claim),2,'cleanup snapshots all personal object paths before profile deletion');
SELECT extensions.throws_ok($$INSERT INTO storage.objects(bucket_id,name) VALUES('avatars','fd000000-0000-4000-8000-000000000006-999.jpg')$$,
 '42501',NULL,'a late service upload cannot recreate a personal object after the DB phase');
SELECT extensions.throws_ok($$SELECT public.advance_account_deletion_cleanup((SELECT (result->>'id')::uuid FROM storage_claim),
 (SELECT (result->>'claim_token')::uuid FROM storage_claim),'storage_removed',ARRAY[(SELECT (result->'objects'->0->>'id')::uuid FROM storage_claim)])$$,
 '55000',NULL,'storage receipts require catalog readback of actual removal');
SELECT extensions.throws_ok($$SELECT public.advance_account_deletion_cleanup((SELECT (result->>'id')::uuid FROM storage_claim),
 (SELECT (result->>'claim_token')::uuid FROM storage_claim),'storage_removed',ARRAY[gen_random_uuid()])$$,
 '22023',NULL,'a claim cannot acknowledge another operation object');
-- Synthetic catalog fixtures model Storage API completion inside this rollback.
-- Production cleanup exclusively calls the Storage API.
SET LOCAL storage.allow_delete_query = 'true';
DELETE FROM storage.objects WHERE name LIKE 'fd000000-0000-4000-8000-000000000006%';
SELECT extensions.lives_ok($$SELECT public.advance_account_deletion_cleanup((SELECT (result->>'id')::uuid FROM storage_claim),
 (SELECT (result->>'claim_token')::uuid FROM storage_claim),'storage_removed',
 ARRAY(SELECT (value->>'id')::uuid FROM storage_claim,jsonb_array_elements(result->'objects')))$$,
 'successful Storage removal can be acknowledged once');
DELETE FROM auth.users WHERE id='fd000000-0000-4000-8000-000000000006';
SELECT extensions.is(public.advance_account_deletion_cleanup((SELECT (result->>'id')::uuid FROM storage_claim),
 (SELECT (result->>'claim_token')::uuid FROM storage_claim),'complete')->>'phase','completed','storage and Auth confirmation complete the operation');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated']) role_name CROSS JOIN unnest(ARRAY[
 'public.preflight_account_deletion(uuid,uuid,text,boolean)', 'public.begin_account_deletion(uuid,uuid,text,boolean,text)',
 'public.claim_account_deletion_cleanup(uuid)', 'public.advance_account_deletion_cleanup(uuid,uuid,text,uuid[])']) signature
 WHERE has_function_privilege(role_name,signature,'EXECUTE')),'browser roles cannot forge or resume service-owned deletion operations');
SELECT * FROM extensions.finish();
ROLLBACK;
