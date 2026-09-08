BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('cb000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'class-consent-'||n||'@local.test',now(),'{}','{}',now(),now() FROM generate_series(1,2) n;
INSERT INTO public.organizations(id,name,username,type,join_code)
VALUES('cb100000-0000-4000-8000-000000000001','Class consent fixture','class-consent-fixture','school','975380');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
SELECT 'cb100000-0000-4000-8000-000000000001',('cb000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'admin','active'
FROM generate_series(1,2) n;
INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label)
VALUES('cb200000-0000-4000-8000-000000000001','cb100000-0000-4000-8000-000000000001',2040,'Class of 2040');
INSERT INTO plugin_data.csf_sheet_sources(id,organization_id,cohort_id,source_type,title,provider,spreadsheet_id,drive_file_id,target_strategy,tab_mappings,settings,sync_owner_user_id)
VALUES('cb300000-0000-4000-8000-000000000001','cb100000-0000-4000-8000-000000000001','cb200000-0000-4000-8000-000000000001',
 'class_history','Fictional class term','google_sheets','synthetic-class-consent','synthetic-class-consent','fixed',
 '[{"tabName":"F39","termCode":"F39","headerRow":1,"rangeA1":"F39!A1:B1","targetStrategy":"fixed","cohortYear":2040}]',
 '{"mappingVersion":1,"sourceKind":"class_history"}','cb000000-0000-4000-8000-000000000002');
INSERT INTO plugin_data.csf_sheet_import_jobs(id,organization_id,source_id,initiated_by,mode,status,source_type,source_file_id,mapping_version,mapping_snapshot)
VALUES('cb400000-0000-4000-8000-000000000001','cb100000-0000-4000-8000-000000000001','cb300000-0000-4000-8000-000000000001',
 'cb000000-0000-4000-8000-000000000002','preview','completed','class_history','synthetic-class-consent',1,jsonb_build_object('headerSignature',repeat('d',64)));
SELECT plugin_data.csf_set_sheet_automatic_update_authorization('cb100000-0000-4000-8000-000000000001','cb300000-0000-4000-8000-000000000001',
 'cb000000-0000-4000-8000-000000000001',1,'enable','cb500000-0000-4000-8000-000000000001','cb400000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_class_workbooks(id,organization_id,cohort_id,drive_file_id,drive_owner_user_id,provider_version,last_prepared_version,state)
VALUES('cb600000-0000-4000-8000-000000000001','cb100000-0000-4000-8000-000000000001','cb200000-0000-4000-8000-000000000001',
 'synthetic-class-consent','cb000000-0000-4000-8000-000000000002','21','20','linked');
INSERT INTO plugin_data.csf_class_workbook_refresh_jobs(id,organization_id,workbook_id,drive_file_id,provider_version,requested_by,status,lease_token,lease_expires_at,claimed_owner_user_id,attempt_count,started_at)
VALUES('cb700000-0000-4000-8000-000000000001','cb100000-0000-4000-8000-000000000001','cb600000-0000-4000-8000-000000000001',
 'synthetic-class-consent','21','cb000000-0000-4000-8000-000000000001','running','cb800000-0000-4000-8000-000000000001',
 now()+interval '5 minutes','cb000000-0000-4000-8000-000000000002',1,now());
UPDATE plugin_data.csf_sheet_sources SET settings=settings||jsonb_build_object(
 'workbookId','cb600000-0000-4000-8000-000000000001','workbookRefreshJobId','cb700000-0000-4000-8000-000000000001',
 'workbookProviderVersion','21','workbookDriveFileId','synthetic-class-consent') WHERE id='cb300000-0000-4000-8000-000000000001';
CREATE TEMP TABLE class_consent_preview(value jsonb);
INSERT INTO class_consent_preview
SELECT plugin_data.csf_open_or_reuse_class_workbook_import_preview(
 'cb100000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000002','cb300000-0000-4000-8000-000000000001',
 'class_history','synthetic-class-consent','Fictional class workbook','F39','F39!A1:B1',now(),'{"version":"21"}',
 jsonb_build_object('mappingVersion',1,'headerSignature',repeat('d',64),
 'workbookId','cb600000-0000-4000-8000-000000000001','workbookRefreshJobId','cb700000-0000-4000-8000-000000000001',
 'workbookProviderVersion','21','workbookDriveFileId','synthetic-class-consent',
 'automaticUpdateAuthorizationId',id,'automaticUpdateGeneration',generation,'automaticUpdateProviderVersion','21',
 'automaticUpdateReadScope','mapped_columns_all_rows'),
 1,NULL,NULL,repeat('b',64),0,'csf-normalized-import/v1',
 'cb700000-0000-4000-8000-000000000001','cb800000-0000-4000-8000-000000000001',
 'cb600000-0000-4000-8000-000000000001','cb200000-0000-4000-8000-000000000001','synthetic-class-consent','21')
FROM plugin_data.csf_sheet_automatic_update_authorizations WHERE organization_id='cb100000-0000-4000-8000-000000000001';
SELECT plugin_data.csf_seal_class_workbook_import_preview('cb100000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000002',
 (value->>'previewJobId')::uuid,'completed','{}','cb700000-0000-4000-8000-000000000001','cb800000-0000-4000-8000-000000000001',
 'cb600000-0000-4000-8000-000000000001','cb200000-0000-4000-8000-000000000001','synthetic-class-consent','21') FROM class_consent_preview;
SELECT extensions.is(plugin_data.csf_dispatch_automatic_class_preview()->>'status','idle','dispatch waits for complete workbook preparation');
SELECT extensions.throws_ok(format('SELECT plugin_data.csf_queue_automatic_class_preview(%L,%L)',
 'cb100000-0000-4000-8000-000000000001',value->>'previewJobId'),'55000','This workbook changed after the preview. Prepare it again.',
 'a published preview waits for its complete workbook generation') FROM class_consent_preview;
SELECT extensions.ok((SELECT last_preview_job_id IS NULL FROM plugin_data.csf_sheet_automatic_update_authorizations
 WHERE organization_id='cb100000-0000-4000-8000-000000000001'),'refused generation leaves the preparation checkpoint unchanged');
SELECT plugin_data.csf_finish_class_workbook_refresh_job('cb700000-0000-4000-8000-000000000001','cb800000-0000-4000-8000-000000000001',
 'completed','[{"tabName":"F39"}]',1,0,0,NULL);
SELECT extensions.is(plugin_data.csf_dispatch_automatic_class_preview()->>'status','needs_attention','dispatch discovers the completed consent-backed preview without a caller-supplied ID');
SELECT extensions.is(plugin_data.csf_dispatch_automatic_class_preview()->>'status','idle','a repeated dispatch uses the saved checkpoint instead of repeating queue work');
SELECT extensions.is((SELECT plugin_data.csf_queue_automatic_class_preview('cb100000-0000-4000-8000-000000000001',
 (value->>'previewJobId')::uuid)->>'readyRows' FROM class_consent_preview),'0','a valid owner-prepared preview settles without inventing rows');
SELECT extensions.lives_ok(format('SELECT plugin_data.csf_assert_automatic_sheet_preview_current(%L,%L,%L)',
 'cb100000-0000-4000-8000-000000000001',value->>'previewJobId','cb000000-0000-4000-8000-000000000001'),
 'the authorizing officer may act on a different Google owner preparation') FROM class_consent_preview;
SELECT extensions.throws_ok(format('SELECT plugin_data.csf_assert_automatic_sheet_preview_current(%L,%L,%L)',
 'cb100000-0000-4000-8000-000000000001',value->>'previewJobId','cb000000-0000-4000-8000-000000000002'),
 '55000','Automatic updates changed. Review this Sheet before importing.','Google ownership is not the approval authority') FROM class_consent_preview;
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_queue_automatic_class_preview('cb100000-0000-4000-8000-000000000001',
 'cb400000-0000-4000-8000-000000000001')$test$,'55000','Automatic updates changed. Review this Sheet before importing.',
 'old manual previews cannot be converted into automatic approval');
UPDATE plugin_data.csf_class_workbooks SET provider_version='22' WHERE id='cb600000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok(format('SELECT plugin_data.csf_assert_automatic_sheet_preview_current(%L,%L,%L)',
 'cb100000-0000-4000-8000-000000000001',value->>'previewJobId','cb000000-0000-4000-8000-000000000001'),
 '55000','Automatic updates changed. Review this Sheet before importing.','provider drift invalidates consent-backed commit access') FROM class_consent_preview;
UPDATE plugin_data.csf_class_workbooks SET provider_version='21' WHERE id='cb600000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok(format('SELECT plugin_data.csf_queue_automatic_class_preview(%L,%L)',
 'cb100000-0000-4000-8000-000000000002',value->>'previewJobId'),'23503','This class preview is no longer available.',
 'another organization cannot queue the preview') FROM class_consent_preview;
UPDATE plugin_data.csf_class_workbook_refresh_jobs SET claimed_owner_user_id='cb000000-0000-4000-8000-000000000001'
 WHERE id='cb700000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok(format('SELECT plugin_data.csf_assert_automatic_sheet_preview_current(%L,%L,%L)',
 'cb100000-0000-4000-8000-000000000001',value->>'previewJobId','cb000000-0000-4000-8000-000000000001'),
 '55000','Automatic updates changed. Review this Sheet before importing.','a changed preparation owner invalidates provenance') FROM class_consent_preview;
UPDATE plugin_data.csf_class_workbook_refresh_jobs SET claimed_owner_user_id='cb000000-0000-4000-8000-000000000002'
 WHERE id='cb700000-0000-4000-8000-000000000001';
UPDATE plugin_data.csf_sheet_automatic_update_authorizations SET approved_header_signature=repeat('e',64)
 WHERE organization_id='cb100000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok(format('SELECT plugin_data.csf_queue_automatic_class_preview(%L,%L)',
 'cb100000-0000-4000-8000-000000000001',value->>'previewJobId'),'55000','Automatic updates changed. Review this Sheet before importing.',
 'a different reviewed header signature cannot approve the preview') FROM class_consent_preview;
UPDATE plugin_data.csf_sheet_automatic_update_authorizations SET approved_header_signature=repeat('d',64)
 WHERE organization_id='cb100000-0000-4000-8000-000000000001';
SELECT plugin_data.csf_set_sheet_automatic_update_authorization('cb100000-0000-4000-8000-000000000001','cb300000-0000-4000-8000-000000000001',
 'cb000000-0000-4000-8000-000000000001',1,'pause','cb500000-0000-4000-8000-000000000002');
SELECT extensions.throws_ok(format('SELECT plugin_data.csf_queue_automatic_class_preview(%L,%L)',
 'cb100000-0000-4000-8000-000000000001',value->>'previewJobId'),'55000','Automatic updates changed. Review this Sheet before importing.',
 'paused consent refuses queueing') FROM class_consent_preview;
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_queue_automatic_class_preview(uuid,uuid)','EXECUTE'),
 'browser cannot queue automatic previews');
SELECT extensions.ok(has_function_privilege('service_role','plugin_data.csf_queue_automatic_class_preview(uuid,uuid)','EXECUTE'),
 'the worker may invoke the checked queue entry point');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_dispatch_automatic_class_preview()','EXECUTE'),
 'browser cannot dispatch automatic class work');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_automatic_import_approvals
 WHERE organization_id='cb100000-0000-4000-8000-000000000001'),0,'an empty preview creates no approval receipt');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_profiles
 WHERE organization_id='cb100000-0000-4000-8000-000000000001'),0,'empty class previews create no profiles');
SELECT * FROM extensions.finish();
ROLLBACK;
