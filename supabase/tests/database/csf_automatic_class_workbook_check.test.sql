BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('cd000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
  'automatic-workbook-'||n||'@local.test',now(),'{}','{}',now(),now() FROM generate_series(1,2) n;
INSERT INTO public.organizations(id,name,username,type,join_code)
VALUES('cd100000-0000-4000-8000-000000000001','Automatic workbook fixture','automatic-workbook-fixture','school','975381');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
SELECT 'cd100000-0000-4000-8000-000000000001',('cd000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'admin','active'
FROM generate_series(1,2) n;
INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label)
VALUES('cd200000-0000-4000-8000-000000000001','cd100000-0000-4000-8000-000000000001',2040,'Class of 2040');
INSERT INTO plugin_data.csf_sheet_sources(id,organization_id,cohort_id,source_type,title,provider,spreadsheet_id,target_strategy,tab_mappings,settings,sync_owner_user_id)
SELECT ('cd300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'cd100000-0000-4000-8000-000000000001',
 'cd200000-0000-4000-8000-000000000001','class_history','Fictional term '||n,'google_sheets','synthetic-auto-workbook','fixed',
 jsonb_build_array(jsonb_build_object('tabName',CASE WHEN n=1 THEN 'F39' ELSE 'S40' END,'termCode',CASE WHEN n=1 THEN 'F39' ELSE 'S40' END)),
 '{"mappingVersion":1}','cd000000-0000-4000-8000-000000000002' FROM generate_series(1,2) n;
INSERT INTO plugin_data.csf_sheet_import_jobs(id,organization_id,source_id,initiated_by,mode,status,source_type,source_file_id,mapping_version,mapping_snapshot)
SELECT ('cd400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'cd100000-0000-4000-8000-000000000001',
 ('cd300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'cd000000-0000-4000-8000-000000000002',
 'preview','completed','class_history','synthetic-auto-workbook',1,jsonb_build_object('headerSignature',repeat('d',64))
 FROM generate_series(1,2) n;
INSERT INTO plugin_data.csf_class_workbooks(id,organization_id,cohort_id,drive_file_id,drive_owner_user_id,provider_version,last_prepared_version,state)
VALUES('cd500000-0000-4000-8000-000000000001','cd100000-0000-4000-8000-000000000001',
 'cd200000-0000-4000-8000-000000000001','synthetic-auto-workbook','cd000000-0000-4000-8000-000000000002','10','10','linked');

SELECT extensions.is(plugin_data.csf_claim_automatic_class_workbook_check()->>'claimed','false','existing workbook links do not gain automatic authority');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_claim_automatic_class_workbook_check()','EXECUTE'),'browser cannot claim a metadata lease');
SELECT extensions.ok(NOT has_function_privilege('anon','plugin_data.csf_finish_automatic_class_workbook_check(uuid,uuid,bigint,uuid,uuid,uuid,text,text,text)','EXECUTE'),'anonymous callers cannot settle metadata');
SELECT extensions.ok(has_function_privilege('service_role','plugin_data.csf_claim_automatic_class_workbook_check()','EXECUTE'),'worker may claim a metadata lease');
SELECT plugin_data.csf_set_sheet_automatic_update_authorization('cd100000-0000-4000-8000-000000000001',
 ('cd300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'cd000000-0000-4000-8000-000000000001',1,'enable',
 ('cd600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('cd400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid)
FROM generate_series(1,2) n;
CREATE TEMP TABLE workbook_check_claim(value jsonb);
INSERT INTO workbook_check_claim VALUES(plugin_data.csf_claim_automatic_class_workbook_check());
SELECT extensions.is((SELECT value->>'claimed' FROM workbook_check_claim),'true','authorized workbook receives a metadata lease');
SELECT extensions.is((SELECT value->>'googleOwnerUserId' FROM workbook_check_claim),'cd000000-0000-4000-8000-000000000002','metadata uses the Google owner rather than the authorizing officer');
SELECT extensions.is((SELECT value->>'actorUserId' FROM workbook_check_claim),'cd000000-0000-4000-8000-000000000001','authorization retains the officer separately');
SELECT extensions.is((SELECT plugin_data.csf_finish_automatic_class_workbook_check(
 (value->>'organizationId')::uuid,(value->>'authorizationId')::uuid,(value->>'generation')::bigint,(value->>'leaseToken')::uuid,
 (value->>'workbookId')::uuid,(value->>'workbookLeaseToken')::uuid,'available','10',NULL)->>'status' FROM workbook_check_claim),'unchanged','unchanged revision avoids preparation');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_class_workbook_refresh_jobs WHERE organization_id='cd100000-0000-4000-8000-000000000001'),0,'unchanged revision creates no refresh job');
SELECT extensions.is(plugin_data.csf_claim_automatic_class_workbook_check()->>'claimed','false','another term does not repeat the same recent workbook check');
SELECT extensions.ok((SELECT bool_and(last_provider_version IS NULL AND last_preview_job_id IS NULL) FROM plugin_data.csf_sheet_automatic_update_authorizations WHERE organization_id='cd100000-0000-4000-8000-000000000001'),'metadata does not impersonate a prepared preview checkpoint');

UPDATE plugin_data.csf_class_workbooks SET last_checked_at=now()-interval '6 minutes' WHERE id='cd500000-0000-4000-8000-000000000001';
UPDATE plugin_data.csf_sheet_automatic_update_authorizations SET next_check_at=now() WHERE organization_id='cd100000-0000-4000-8000-000000000001';
UPDATE workbook_check_claim SET value=plugin_data.csf_claim_automatic_class_workbook_check();
SELECT extensions.is((SELECT plugin_data.csf_finish_automatic_class_workbook_check(
 'cd100000-0000-4000-8000-000000000002',(value->>'authorizationId')::uuid,(value->>'generation')::bigint,(value->>'leaseToken')::uuid,
 (value->>'workbookId')::uuid,(value->>'workbookLeaseToken')::uuid,'available','11',NULL)->>'finished' FROM workbook_check_claim),'false','another organization cannot settle the lease');
SELECT extensions.throws_ok(format('SELECT plugin_data.csf_finish_automatic_class_workbook_check(%L,%L,%L,%L,%L,%L,%L,%L,NULL)',
 value->>'organizationId',value->>'authorizationId',value->>'generation',value->>'leaseToken',value->>'workbookId',
 'cd700000-0000-4000-8000-000000000001','available','11'),'55000','The workbook metadata lease is no longer current.',
 'a different workbook lease cannot queue preparation') FROM workbook_check_claim;
SELECT extensions.is((SELECT plugin_data.csf_finish_automatic_class_workbook_check(
 (value->>'organizationId')::uuid,(value->>'authorizationId')::uuid,(value->>'generation')::bigint,(value->>'leaseToken')::uuid,
 (value->>'workbookId')::uuid,(value->>'workbookLeaseToken')::uuid,'available','11',NULL)->>'status' FROM workbook_check_claim),'queued','changed revision uses the existing durable preparation queue');
SELECT extensions.is((SELECT plugin_data.csf_finish_automatic_class_workbook_check(
 (value->>'organizationId')::uuid,(value->>'authorizationId')::uuid,(value->>'generation')::bigint,(value->>'leaseToken')::uuid,
 (value->>'workbookId')::uuid,(value->>'workbookLeaseToken')::uuid,'available','11',NULL)->>'finished' FROM workbook_check_claim),'false','lost response replay cannot settle an already consumed lease');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_class_workbook_refresh_jobs WHERE organization_id='cd100000-0000-4000-8000-000000000001'),1,'settlement replay creates no duplicate queue job');

UPDATE plugin_data.csf_class_workbooks SET last_checked_at=now()-interval '6 minutes' WHERE id='cd500000-0000-4000-8000-000000000001';
UPDATE plugin_data.csf_sheet_automatic_update_authorizations SET next_check_at=now() WHERE organization_id='cd100000-0000-4000-8000-000000000001';
UPDATE workbook_check_claim SET value=plugin_data.csf_claim_automatic_class_workbook_check();
SELECT plugin_data.csf_set_sheet_automatic_update_authorization('cd100000-0000-4000-8000-000000000001',
 (value->>'sourceId')::uuid,'cd000000-0000-4000-8000-000000000001',1,'pause','cd600000-0000-4000-8000-000000000003') FROM workbook_check_claim;
SELECT extensions.is((SELECT plugin_data.csf_finish_automatic_class_workbook_check(
 (value->>'organizationId')::uuid,(value->>'authorizationId')::uuid,(value->>'generation')::bigint,(value->>'leaseToken')::uuid,
 (value->>'workbookId')::uuid,(value->>'workbookLeaseToken')::uuid,'available','12',NULL)->>'finished' FROM workbook_check_claim),'false','pause blocks an in-flight metadata result');
SELECT extensions.is((SELECT provider_version FROM plugin_data.csf_class_workbooks WHERE id='cd500000-0000-4000-8000-000000000001'),'11','paused metadata cannot advance the saved version');
UPDATE public.organization_members SET status='inactive' WHERE organization_id='cd100000-0000-4000-8000-000000000001' AND user_id='cd000000-0000-4000-8000-000000000001';
SELECT extensions.is(plugin_data.csf_claim_automatic_class_workbook_check()->>'claimed','false','revoked officer authority cannot check other terms');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE organization_id='cd100000-0000-4000-8000-000000000001'),0,'metadata checks create no profiles');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_term_applications WHERE organization_id='cd100000-0000-4000-8000-000000000001'),0,'metadata checks create no applications');
SELECT * FROM extensions.finish();
ROLLBACK;
