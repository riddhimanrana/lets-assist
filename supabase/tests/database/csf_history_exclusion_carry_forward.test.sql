BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(29);

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('ed760000-0000-4000-8000-000000000001','authenticated','authenticated','exclusion-officer@local.test',now(),'{}','{}',now(),now()),
('ed760000-0000-4000-8000-000000000002','authenticated','authenticated','exclusion-outsider@local.test',now(),'{}','{}',now(),now());
INSERT INTO public.organizations(id,name,username,type,join_code)
VALUES('ed761000-0000-4000-8000-000000000001','Exclusion fixture','exclusion-fixture','school','907601');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
VALUES('ed761000-0000-4000-8000-000000000001','ed760000-0000-4000-8000-000000000001','admin','active');
INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label)
VALUES('ed762000-0000-4000-8000-000000000001','ed761000-0000-4000-8000-000000000001',2030,'Class of 2030');
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester)
VALUES('ed763000-0000-4000-8000-000000000001','ed761000-0000-4000-8000-000000000001','F26','Fall 2026','2026-2027','fall');
INSERT INTO plugin_data.csf_sheet_sources(id,organization_id,cohort_id,title,provider,source_type,spreadsheet_id,settings)
VALUES('ed764000-0000-4000-8000-000000000001','ed761000-0000-4000-8000-000000000001','ed762000-0000-4000-8000-000000000001',
'Fictional exclusion source','google_sheets','class_history','fictional-exclusion-file','{"mappingVersion":2}');
INSERT INTO plugin_data.csf_class_workbooks(id,organization_id,cohort_id,drive_file_id,drive_owner_user_id,provider_version,state)
VALUES('ed765000-0000-4000-8000-000000000001','ed761000-0000-4000-8000-000000000001','ed762000-0000-4000-8000-000000000001',
'fictional-exclusion-file','ed760000-0000-4000-8000-000000000001','2','linked');
INSERT INTO plugin_data.csf_class_workbook_refresh_jobs(id,organization_id,workbook_id,drive_file_id,provider_version,status,lease_token,lease_expires_at,claimed_owner_user_id)
VALUES('ed766000-0000-4000-8000-000000000001','ed761000-0000-4000-8000-000000000001','ed765000-0000-4000-8000-000000000001',
'fictional-exclusion-file','2','running','ed767000-0000-4000-8000-000000000001',now()+interval '5 minutes','ed760000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_sheet_import_jobs(id,organization_id,source_id,mode,status,source_type,source_file_id,source_sheet_tab,source_range,
 mapping_version,snapshot_contract_version,mapping_snapshot,created_at)
SELECT ('ed768000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ed761000-0000-4000-8000-000000000001',
'ed764000-0000-4000-8000-000000000001','preview','needs_resolution','class_history','fictional-exclusion-file','F26',
'''F26''!A1:M186',2,'csf-normalized-import/v1',jsonb_build_object('version',2,'sourceType','class_history','tabs','[]'::jsonb,
'columns','{}'::jsonb,'workbookId','ed765000-0000-4000-8000-000000000001','workbookRefreshJobId','ed766000-0000-4000-8000-000000000001',
'workbookDriveFileId','fictional-exclusion-file','workbookProviderVersion',n::text,
'normalizedSnapshot',jsonb_build_object('targetSignature','fictional-target','diagnostics','[]'::jsonb)),now()-(3-n)*interval '1 hour'
FROM generate_series(1,2)n;
CREATE TEMP TABLE exclusion_pairs AS
SELECT n,('ed769000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid old_id,
('ed76a000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid new_id
FROM generate_series(1,187)n;
INSERT INTO plugin_data.csf_sheet_import_rows(id,organization_id,job_id,source_id,cohort_id,term_id,sheet_tab_name,source_range,row_number,
 raw_data,normalized_data,row_hash,import_status)
SELECT CASE WHEN j=1 THEN p.old_id ELSE p.new_id END,'ed761000-0000-4000-8000-000000000001',
('ed768000-0000-4000-8000-'||lpad(j::text,12,'0'))::uuid,'ed764000-0000-4000-8000-000000000001',
'ed762000-0000-4000-8000-000000000001','ed763000-0000-4000-8000-000000000001','F26','''F26''!A1:M186',n+1,
jsonb_build_object('identity',jsonb_build_object('firstName',CASE WHEN j=2 AND n=187 THEN 'Changed' ELSE 'Fictional' END,'lastName',n::text)),
jsonb_build_object('rowHash',md5(n::text)||md5(n::text),'snapshotHash',j::text,
'record',jsonb_build_object('identity',jsonb_build_object('firstName','Fictional','lastName',n::text)),
'annotations',CASE WHEN j=2 AND n=186 THEN '{"1":{"note":"New evidence"}}'::jsonb ELSE '{}'::jsonb END,'commitPayload',jsonb_build_object('activities','[]'::jsonb,'meetings','[]'::jsonb)),
md5(n::text)||md5(n::text),'ambiguous' FROM exclusion_pairs p CROSS JOIN generate_series(1,2)j;
DO $$DECLARE r record; BEGIN FOR r IN SELECT old_id FROM exclusion_pairs LOOP
PERFORM plugin_data.csf_reconcile_sheet_import_row('ed761000-0000-4000-8000-000000000001',r.old_id,NULL,'skip',
'Redundant current-term history. Keep the application and membership.','ed760000-0000-4000-8000-000000000001',NULL); END LOOP; END$$;
ALTER TABLE exclusion_pairs ADD COLUMN audit_id uuid;
UPDATE exclusion_pairs p SET audit_id=a.id FROM plugin_data.csf_admin_audit_events a WHERE a.target_id=p.old_id AND a.action='sheets.row_skipped';

CREATE FUNCTION pg_temp.carry(n integer, state jsonb DEFAULT NULL, actor uuid DEFAULT 'ed760000-0000-4000-8000-000000000001',
 version text DEFAULT '2', organization uuid DEFAULT 'ed761000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
SELECT plugin_data.csf_carry_forward_history_exclusion(organization,actor,p.new_id,p.old_id,p.audit_id,
coalesce(state,jsonb_build_object('importStatus','ambiguous','resolutionStatus','pending','matchedProfileId',NULL,
'rowHash',md5(n::text)||md5(n::text))),'ed766000-0000-4000-8000-000000000001','ed767000-0000-4000-8000-000000000001',
'ed765000-0000-4000-8000-000000000001','ed762000-0000-4000-8000-000000000001','fictional-exclusion-file',version)
FROM exclusion_pairs p WHERE p.n=carry.n;
$$;
SELECT extensions.ok(has_function_privilege('service_role','plugin_data.csf_carry_forward_history_exclusion(uuid,uuid,uuid,uuid,uuid,jsonb,uuid,uuid,uuid,uuid,text,text)','EXECUTE')
AND NOT has_function_privilege('authenticated','plugin_data.csf_carry_forward_history_exclusion(uuid,uuid,uuid,uuid,uuid,jsonb,uuid,uuid,uuid,uuid,text,text)','EXECUTE')
AND NOT has_function_privilege('anon','plugin_data.csf_carry_forward_history_exclusion(uuid,uuid,uuid,uuid,uuid,jsonb,uuid,uuid,uuid,uuid,text,text)','EXECUTE'),'only service_role can execute the internal guard');
SELECT extensions.throws_ok($$SELECT pg_temp.carry(1,NULL,'ed760000-0000-4000-8000-000000000002')$$,'55000',NULL,'another actor cannot reuse the worker lease');
SELECT extensions.throws_ok($$SELECT pg_temp.carry(1,NULL,'ed760000-0000-4000-8000-000000000001','3')$$,'55000',NULL,'changed provider generation refuses carry-forward');
SELECT extensions.throws_ok($$SELECT pg_temp.carry(1,NULL,'ed760000-0000-4000-8000-000000000001','2','ed761000-0000-4000-8000-000000000002')$$,'23503',NULL,'cross-chapter request is denied');
SELECT extensions.throws_ok($$SELECT pg_temp.carry(1,'{"importStatus":"pending"}')$$,'55000',NULL,'the expected current row state must match exactly');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_admin_audit_events WHERE target_id IN(SELECT new_id FROM exclusion_pairs)),0::bigint,'refused requests create no review receipts');

SAVEPOINT officer_review;
UPDATE plugin_data.csf_sheet_import_rows SET resolution_status='resolved',resolved_by='ed760000-0000-4000-8000-000000000001',resolved_at=now(),resolution_reason_code='matched_existing_profile'
WHERE id=(SELECT new_id FROM exclusion_pairs WHERE n=1);
SELECT extensions.throws_ok($$SELECT pg_temp.carry(1)$$,'55000','A newer officer review changed this row.','a concurrent officer review wins over the stale worker proposal');
SELECT extensions.is((SELECT resolution_status FROM plugin_data.csf_sheet_import_rows WHERE id=(SELECT new_id FROM exclusion_pairs WHERE n=1)),'resolved','new officer review remains unchanged');
ROLLBACK TO SAVEPOINT officer_review;

SELECT extensions.throws_ok($$SELECT pg_temp.carry(186)$$,'55000','The exclusion row evidence or commit state changed.','new annotations cannot reuse an exclusion');
SELECT extensions.throws_ok($$SELECT pg_temp.carry(187)$$,'55000','The exclusion row evidence or commit state changed.','changed raw identity cannot reuse an exclusion');
SAVEPOINT changed_mapping;
UPDATE plugin_data.csf_sheet_sources SET settings=jsonb_set(settings,'{mappingVersion}','3') WHERE id='ed764000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.carry(2)$$,'55000',NULL,'changed mapping version cannot reuse an exclusion');
ROLLBACK TO SAVEPOINT changed_mapping;
SAVEPOINT changed_source;
UPDATE plugin_data.csf_sheet_sources SET spreadsheet_id='replacement-file' WHERE id='ed764000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.carry(2)$$,'55000',NULL,'changed active source cannot reuse an exclusion');
ROLLBACK TO SAVEPOINT changed_source;
SAVEPOINT expired_lease;
UPDATE plugin_data.csf_class_workbook_refresh_jobs SET lease_expires_at=now()-interval '1 minute' WHERE id='ed766000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.carry(2)$$,'55000',NULL,'expired lease cannot write a review');
ROLLBACK TO SAVEPOINT expired_lease;
SAVEPOINT missing_audit;
UPDATE exclusion_pairs SET audit_id=gen_random_uuid() WHERE n=2;
SELECT extensions.throws_ok($$SELECT pg_temp.carry(2)$$,'55000',NULL,'unaudited ignored state is insufficient');
ROLLBACK TO SAVEPOINT missing_audit;

SELECT extensions.lives_ok($$SELECT pg_temp.carry(n) FROM generate_series(1,25)n$$,'25 unchanged accountless rows retain their audited exclusions');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_sheet_import_rows WHERE id IN(SELECT new_id FROM exclusion_pairs) AND import_status='skipped'),25::bigint,'exactly 25 rows were skipped');
SELECT extensions.is(pg_temp.carry(1)->>'idempotent','true','retry returns the existing receipt');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_admin_audit_events WHERE target_id=(SELECT new_id FROM exclusion_pairs WHERE n=1) AND action='sheets.row_skipped'),1::bigint,'retry does not duplicate the skip audit');
SELECT extensions.lives_ok($$SELECT pg_temp.carry(n) FROM generate_series(26,185)n$$,'all 185 accountless rows can be settled without membership writes');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_sheet_import_rows WHERE id IN(SELECT new_id FROM exclusion_pairs) AND import_status='skipped' AND resolution_status='ignored'),185::bigint,'all 185 exclusions remain excluded');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_admin_audit_events WHERE target_id IN(SELECT new_id FROM exclusion_pairs) AND after_data#>>'{matchMetadata,kind}'='history_exclusion_carry_forward'),185::bigint,'each new audit links the prior review receipt');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_profiles WHERE organization_id='ed761000-0000-4000-8000-000000000001'),0::bigint,'no profiles are created');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_term_memberships WHERE organization_id='ed761000-0000-4000-8000-000000000001'),0::bigint,'no membership is granted');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_credit_records WHERE organization_id='ed761000-0000-4000-8000-000000000001'),0::bigint,'no credits are created');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_meeting_attendance WHERE organization_id='ed761000-0000-4000-8000-000000000001'),0::bigint,'no attendance is created');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_sheet_import_rows WHERE id IN(SELECT old_id FROM exclusion_pairs) AND import_status='skipped' AND resolution_status='ignored'),187::bigint,'all old exclusions remain intact');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_admin_audit_events WHERE target_id IN(SELECT old_id FROM exclusion_pairs) AND action='sheets.row_skipped'),187::bigint,'old receipts are unchanged');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_sheet_import_jobs WHERE organization_id='ed761000-0000-4000-8000-000000000001' AND mode<>'preview'),0::bigint,'carry-forward creates no commit jobs');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_import_commit_queue WHERE organization_id='ed761000-0000-4000-8000-000000000001'),0::bigint,'carry-forward never queues an import');
SELECT * FROM extensions.finish();
ROLLBACK;
