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
 '[{"tabName":"F39","termCode":"F39","headerRow":1,"rangeA1":"F39!A1:Q4","targetStrategy":"fixed","cohortYear":2040}]',
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
 'class_history','synthetic-class-consent','Fictional class workbook','F39','F39!A1:Q4','2039-09-01T00:00:00Z','{"id":"synthetic-class-consent","sourceProvider":"google_sheets","mimeType":"application/vnd.google-apps.spreadsheet","version":"21","modifiedTime":"2039-09-01T00:00:00Z","trashed":false,"accessState":"accessible"}',
 jsonb_build_object('version',1,'sourceType','class_history','sourceProvider','google_sheets','sourceFileId','synthetic-class-consent','tabs',jsonb_build_array(jsonb_build_object('tabName','F39','range','F39!A1:Q4','headerRow',1)),'mappingVersion',1,'headerSignature',repeat('d',64),
 'workbookId','cb600000-0000-4000-8000-000000000001','workbookRefreshJobId','cb700000-0000-4000-8000-000000000001',
 'workbookProviderVersion','21','workbookDriveFileId','synthetic-class-consent',
 'automaticUpdateAuthorizationId',id,'automaticUpdateGeneration',generation,'automaticUpdateProviderVersion','21',
 'automaticUpdateReadScope','mapped_columns_all_rows'),
 1,NULL,repeat('a',64),repeat('b',64),3,'csf-normalized-import/v1',
 'cb700000-0000-4000-8000-000000000001','cb800000-0000-4000-8000-000000000001',
 'cb600000-0000-4000-8000-000000000001','cb200000-0000-4000-8000-000000000001','synthetic-class-consent','21')
FROM plugin_data.csf_sheet_automatic_update_authorizations WHERE organization_id='cb100000-0000-4000-8000-000000000001';

UPDATE plugin_data.csf_sheet_sources SET drive_access_state='accessible',drive_mime_type='application/vnd.google-apps.spreadsheet',
 drive_modified_at='2039-09-01T00:00:00Z',settings=settings||'{"evidenceRevision":"21"}'
 WHERE id='cb300000-0000-4000-8000-000000000001';
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester)
VALUES('cb900000-0000-4000-8000-000000000001','cb100000-0000-4000-8000-000000000001','F39','Fall 2039','2039-2040','fall');
INSERT INTO plugin_data.csf_cohort_terms(organization_id,cohort_id,term_id)
VALUES('cb100000-0000-4000-8000-000000000001','cb200000-0000-4000-8000-000000000001','cb900000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name,personal_email,normalized_personal_email)
SELECT ('cba00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'cb100000-0000-4000-8000-000000000001','Fictional','Member'||n,
 'fictional','member'||n,'member'||n||'@local.test','member'||n||'@local.test' FROM generate_series(1,2) n;
INSERT INTO plugin_data.csf_sheet_import_rows(id,organization_id,job_id,source_id,cohort_id,term_id,sheet_tab_name,row_number,
 import_status,matched_profile_id,row_hash,normalized_data)
SELECT ('cbb00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'cb100000-0000-4000-8000-000000000001',
 (value->>'previewJobId')::uuid,'cb300000-0000-4000-8000-000000000001','cb200000-0000-4000-8000-000000000001',
 'cb900000-0000-4000-8000-000000000001','F39',n+1,CASE WHEN n<=2 THEN 'pending' ELSE 'ambiguous' END,
 CASE WHEN n<=2 THEN ('cba00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid END,repeat(n::text,64),
 jsonb_build_object('sourceType','class_history','targetStatus','resolved','rejected',false,
 'commitPayload',jsonb_build_object('version','csf-commit-payload/v1','sourceType','class_history',
 'identity',jsonb_build_object('firstName','Fictional','lastName','Member'||n,'normalizedFirstName','fictional','normalizedLastName','member'||n),
 'canonicalEmails',jsonb_build_object('schoolEmail',NULL,'personalEmail','member'||n||'@local.test','normalizedSchoolEmail',NULL,'normalizedPersonalEmail','member'||n||'@local.test'),
 'activities',jsonb_build_array(jsonb_build_object('slot','activity_1','label','Library book drive','value','Library book drive','points',2,'sourceColumns','[]'::jsonb)),
 'meetings',jsonb_build_array(jsonb_build_object('key','november_meeting','label','November meeting','value','present','status','attended')),
 'allRequirementsMet',NULL))
 FROM class_consent_preview CROSS JOIN generate_series(1,3) n;
SELECT plugin_data.csf_seal_class_workbook_import_preview('cb100000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000002',
 (value->>'previewJobId')::uuid,'needs_resolution','{}','cb700000-0000-4000-8000-000000000001','cb800000-0000-4000-8000-000000000001',
 'cb600000-0000-4000-8000-000000000001','cb200000-0000-4000-8000-000000000001','synthetic-class-consent','21') FROM class_consent_preview;
SELECT plugin_data.csf_finish_class_workbook_refresh_job('cb700000-0000-4000-8000-000000000001','cb800000-0000-4000-8000-000000000001',
 'completed','[{"tabName":"F39"}]',1,0,0,NULL);
SELECT extensions.is(plugin_data.csf_dispatch_automatic_class_preview()->>'queued','1','safe class rows dispatch beside an uncertain sibling');
CREATE TEMP TABLE class_commit_claim AS SELECT plugin_data.csf_claim_import_commit_attempt(
 'cb100000-0000-4000-8000-000000000001',(value->>'previewJobId')::uuid,'cb000000-0000-4000-8000-000000000001',300,
 (plugin_data.csf_refresh_sheet_source_evidence('cb100000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000001',
 'cb300000-0000-4000-8000-000000000001',(value->>'previewJobId')::uuid,
 (SELECT evidence_generation FROM plugin_data.csf_sheet_sources WHERE id='cb300000-0000-4000-8000-000000000001'),
 'synthetic-class-consent','application/vnd.google-apps.spreadsheet','2039-09-01T00:00:00Z','21',false,'accessible','Fictional class workbook')->>'evidenceToken')::uuid) AS receipt
 FROM class_consent_preview;
SELECT plugin_data.csf_commit_import_row_batch('cb100000-0000-4000-8000-000000000001',(receipt->>'attemptId')::uuid,
 'cbc00000-0000-4000-8000-000000000001',ARRAY['cbb00000-0000-4000-8000-000000000001'::uuid,'cbb00000-0000-4000-8000-000000000002'::uuid])
 FROM class_commit_claim;
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_sheet_import_rows WHERE organization_id='cb100000-0000-4000-8000-000000000001' AND commit_outcome_state='succeeded'),2,'both safe rows have successful durable outcomes');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_opportunities WHERE organization_id='cb100000-0000-4000-8000-000000000001'),1,'shared activity labels create one activity definition');
SELECT extensions.ok((SELECT title='Library book drive' AND point_value=2 FROM plugin_data.csf_opportunities WHERE organization_id='cb100000-0000-4000-8000-000000000001'),'activity retains its exact label and points');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_credit_records WHERE organization_id='cb100000-0000-4000-8000-000000000001' AND opportunity_id IS NOT NULL),2,'both profiles link to their activity catalog entry');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_meetings WHERE organization_id='cb100000-0000-4000-8000-000000000001' AND label='November meeting'),1,'meeting labels aggregate within the semester');
SELECT plugin_data.csf_commit_import_row_batch('cb100000-0000-4000-8000-000000000001',(receipt->>'attemptId')::uuid,
 'cbc00000-0000-4000-8000-000000000001',ARRAY['cbb00000-0000-4000-8000-000000000001'::uuid,'cbb00000-0000-4000-8000-000000000002'::uuid])
 FROM class_commit_claim;
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE organization_id='cb100000-0000-4000-8000-000000000001'),2,'lost-response replay creates no duplicate profile');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_credit_records WHERE organization_id='cb100000-0000-4000-8000-000000000001'),2,'lost-response replay creates no duplicate participation');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_import_row_batches WHERE organization_id='cb100000-0000-4000-8000-000000000001'),1,'batch replay retains one receipt');
SELECT extensions.is((SELECT import_status FROM plugin_data.csf_sheet_import_rows WHERE id='cbb00000-0000-4000-8000-000000000003'),'ambiguous','uncertain identity remains in officer review');
SELECT extensions.is(plugin_data.csf_dispatch_automatic_class_preview()->>'status','idle','repeated dispatch does not queue the committed preview again');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_meeting_attendance a
 JOIN plugin_data.csf_meetings m ON m.id=a.meeting_id AND m.organization_id=a.organization_id
 WHERE a.organization_id='cb100000-0000-4000-8000-000000000001'
 AND a.term_id='cb900000-0000-4000-8000-000000000001' AND a.status='attended'
 AND a.meeting_label='November meeting' AND m.label='November meeting'),2,
 'both attendance records retain the semester and exact named meeting link after replay');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_import_row_batch_outcomes
 WHERE organization_id='cb100000-0000-4000-8000-000000000001'),2,'replay retains one outcome per safe row');
CREATE TEMP TABLE class_finalization AS SELECT plugin_data.csf_finalize_import_commit_attempt(
 'cb100000-0000-4000-8000-000000000001',(receipt->>'attemptId')::uuid,'{}'::jsonb) AS receipt
 FROM class_commit_claim;
SELECT extensions.is((SELECT receipt->>'committed' FROM class_finalization),'2','finalization confirms both safe class records');
SELECT extensions.is((SELECT receipt->>'status' FROM class_finalization),'partially_completed','finalization keeps the uncertain sibling visible');
SELECT extensions.is((SELECT receipt->>'unknownOutcomes' FROM class_finalization),'0','finalization has no unknown write outcomes');
SELECT * FROM extensions.finish();
ROLLBACK;
