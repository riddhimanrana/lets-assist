BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(5);
INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) VALUES
('ea000000-0000-4000-8000-000000000001','authenticated','authenticated','sheet-admin@local.test','{}','{}'),
('ea000000-0000-4000-8000-000000000002','authenticated','authenticated','sheet-outsider@local.test','{}','{}');
INSERT INTO public.organizations(id,name,username,type,join_code) VALUES
('ea100000-0000-4000-8000-000000000001','Sheet sync fixtures','sheet-sync-fixtures','school','739284'),
('ea100000-0000-4000-8000-000000000002','Sheet sync other','sheet-sync-other','school','739285');
INSERT INTO public.organization_members(organization_id,user_id,role,status) VALUES('ea100000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000001','admin','active');
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester) VALUES('ea200000-0000-4000-8000-000000000001','ea100000-0000-4000-8000-000000000001','F30','Fall 2030','2030-2031','fall');
INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label) VALUES('ea500000-0000-4000-8000-000000000001','ea100000-0000-4000-8000-000000000001',2033,'Class of 2033');
SELECT plugin_data.csf_register_sheet_sync_test_workspace('ea100000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000001');
SELECT plugin_data.csf_register_sheet_sync_test_file('ea100000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000001','fixture-sheet-copy','fixture-source-sheet');
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name) VALUES
('ea300000-0000-4000-8000-000000000001','ea100000-0000-4000-8000-000000000001','Test','Student','test','student'),
('ea300000-0000-4000-8000-000000000002','ea100000-0000-4000-8000-000000000002','Other','Student','other','student');
INSERT INTO plugin_data.csf_profile_cohort_memberships(organization_id,profile_id,cohort_id) VALUES('ea100000-0000-4000-8000-000000000001','ea300000-0000-4000-8000-000000000001','ea500000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_term_applications(id,organization_id,profile_id,cohort_id,term_id,source,status) VALUES('ea600000-0000-4000-8000-000000000001','ea100000-0000-4000-8000-000000000001','ea300000-0000-4000-8000-000000000001','ea500000-0000-4000-8000-000000000001','ea200000-0000-4000-8000-000000000001','manual','submitted');
INSERT INTO plugin_data.csf_cohort_terms(organization_id,cohort_id,term_id) VALUES('ea100000-0000-4000-8000-000000000001','ea500000-0000-4000-8000-000000000001','ea200000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_term_memberships(organization_id,profile_id,term_id,status) VALUES('ea100000-0000-4000-8000-000000000001','ea300000-0000-4000-8000-000000000001','ea200000-0000-4000-8000-000000000001','completed');
INSERT INTO plugin_data.csf_credit_records(organization_id,profile_id,term_id,source,points,status) VALUES('ea100000-0000-4000-8000-000000000001','ea300000-0000-4000-8000-000000000001','ea200000-0000-4000-8000-000000000001','manual',2,'verified');
INSERT INTO plugin_data.csf_review_periods(id,organization_id,term_id,kind,title) VALUES('ea800000-0000-4000-8000-000000000001','ea100000-0000-4000-8000-000000000001','ea200000-0000-4000-8000-000000000001','member_points','Fictional review');
INSERT INTO plugin_data.csf_review_notes(organization_id,period_id,subject_kind,subject_id,body,author_user_id) VALUES('ea100000-0000-4000-8000-000000000001','ea800000-0000-4000-8000-000000000001','profile','ea300000-0000-4000-8000-000000000001','Fictional staff note retained in the app','ea000000-0000-4000-8000-000000000001');
CREATE TEMP TABLE note_scope_result AS
SELECT plugin_data.csf_sheet_sync_destination_snapshot('ea100000-0000-4000-8000-000000000001',
 (plugin_data.csf_configure_sheet_sync_destination('ea100000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000001','fixture-sheet-copy',0,'class','ea500000-0000-4000-8000-000000000001','ea200000-0000-4000-8000-000000000001',true,13,'["Record ID","Status"]')->>'id')::uuid,
 'profile','ea300000-0000-4000-8000-000000000001') AS snapshot;
SELECT extensions.is((SELECT snapshot->'comments' FROM note_scope_result),'[]'::jsonb,'class exports omit deferred profile review notes');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_review_notes WHERE organization_id='ea100000-0000-4000-8000-000000000001'),1::bigint,'deferral retains original app note history');
SELECT extensions.is((SELECT snapshot->'memberships'->0->>'status' FROM note_scope_result),'completed','semester membership completion remains available');
SELECT extensions.is((SELECT snapshot->'projection_credits'->0->>'points' FROM note_scope_result)::numeric,2::numeric,'verified point projection remains available');
SELECT extensions.is((SELECT jsonb_array_length(snapshot->'applications') FROM note_scope_result),1,'semester applications remain available');
SELECT * FROM extensions.finish();
ROLLBACK;
