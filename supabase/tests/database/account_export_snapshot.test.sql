BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
SELECT extensions.ok(has_function_privilege('service_role','public.account_data_export_snapshot(uuid)','EXECUTE'), 'export snapshot is available to service workers');
SELECT extensions.ok(NOT has_function_privilege('anon','public.account_data_export_snapshot(uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.account_data_export_snapshot(uuid)','EXECUTE'), 'browsers cannot export an arbitrary subject');
SELECT extensions.ok((SELECT prosecdef AND provolatile = 's' AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='public.account_data_export_snapshot(uuid)'::regprocedure), 'snapshot reads share a stable statement with a fixed search path');
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('fa800000-0000-4000-8000-000000000001','authenticated','authenticated','export-one@local.test',now(),'{"hidden":"auth-private-marker"}','{}',now(),now()),
 ('fa800000-0000-4000-8000-000000000002','authenticated','authenticated','export-two@local.test',now(),'{}','{}',now(),now());
INSERT INTO public.organizations(id,name,username,type,join_code)
VALUES('fa810000-0000-4000-8000-000000000001','Export synthetic A','export-synthetic-a','school','193281'),
 ('fa810000-0000-4000-8000-000000000002','Export synthetic B','export-synthetic-b','school','193282');
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name,school_email,source_summary)
VALUES('fa820000-0000-4000-8000-000000000001','fa810000-0000-4000-8000-000000000001','Owned','Synthetic','owned','synthetic','export-one@local.test','{"private":"source-private-marker"}'),
 ('fa820000-0000-4000-8000-000000000002','fa810000-0000-4000-8000-000000000001','Pending','Synthetic','pending','synthetic','export-one@local.test','{}'),
 ('fa820000-0000-4000-8000-000000000003','fa810000-0000-4000-8000-000000000002','Unlinked','Synthetic','unlinked','synthetic','export-one@local.test','{}');
INSERT INTO plugin_data.csf_profile_accounts(organization_id,profile_id,user_id,status,notes)
VALUES('fa810000-0000-4000-8000-000000000001','fa820000-0000-4000-8000-000000000001','fa800000-0000-4000-8000-000000000001','verified','staff-private-marker'),
 ('fa810000-0000-4000-8000-000000000001','fa820000-0000-4000-8000-000000000002','fa800000-0000-4000-8000-000000000001','pending','staff-private-marker');
INSERT INTO plugin_data.dv_sd_students(organization_id,user_id,legal_name)
VALUES('fa810000-0000-4000-8000-000000000001','fa800000-0000-4000-8000-000000000001','Owned DV synthetic'),
 ('fa810000-0000-4000-8000-000000000002','fa800000-0000-4000-8000-000000000002','Other DV private marker');
INSERT INTO public.notifications(user_id,title,body,type)
SELECT 'fa800000-0000-4000-8000-000000000001','Export synthetic '||n,'Own record','info' FROM generate_series(1,1205) n;
INSERT INTO public.notifications(user_id,title,body,type)
VALUES('fa800000-0000-4000-8000-000000000002','Other account private marker','Other record','info');
INSERT INTO public.project_drafts(user_id,title,draft_data)
VALUES('fa800000-0000-4000-8000-000000000001','Owned synthetic draft','{"title":"Owned draft"}');
CREATE TEMP TABLE export_snapshot AS SELECT public.account_data_export_snapshot('fa800000-0000-4000-8000-000000000001') value;
SELECT extensions.is((SELECT jsonb_array_length(value->'datasets'->'notifications') FROM export_snapshot),1205,'more than 1000 records survive the projection');
SELECT extensions.is((SELECT (value->'counts'->>'notifications')::integer FROM export_snapshot),1205,'manifest count agrees with projected rows');
SELECT extensions.is((SELECT count(*)::integer FROM export_snapshot, jsonb_object_keys(value->'datasets')),48,'all declared datasets are present even when empty');
SELECT extensions.is((SELECT jsonb_array_length(value->'datasets'->'csfProfile') FROM export_snapshot),1,'only a verified profile link establishes CSF ownership');
SELECT extensions.is((SELECT value->'datasets'->'csfProfile'->0->>'first_name' FROM export_snapshot),'Owned','email equality does not export pending or unlinked profiles');
SELECT extensions.is((SELECT jsonb_array_length(value->'datasets'->'dvStudents') FROM export_snapshot),1,'DV ownership uses the canonical user UUID');
SELECT extensions.is((SELECT jsonb_array_length(value->'datasets'->'projectDrafts') FROM export_snapshot),1,'saved project drafts are included');
SELECT extensions.ok((SELECT value::text NOT LIKE '%private-marker%' AND value::text NOT LIKE '%Other account private marker%' AND value::text NOT LIKE '%Other DV private marker%' FROM export_snapshot),'Auth metadata, source material, staff notes, and other-account rows stay out');
UPDATE plugin_data.csf_profile_accounts SET status='revoked' WHERE profile_id='fa820000-0000-4000-8000-000000000001';
SELECT extensions.is(jsonb_array_length(public.account_data_export_snapshot('fa800000-0000-4000-8000-000000000001')->'datasets'->'csfProfile'),0,'a revoked link does not export former linked profile data');
INSERT INTO public.notifications(user_id,title,body,type)
SELECT 'fa800000-0000-4000-8000-000000000001','Export synthetic excess '||n,'Own record','info' FROM generate_series(1,8796) n;
SELECT extensions.throws_ok($$SELECT public.account_data_export_snapshot('fa800000-0000-4000-8000-000000000001')$$,'54000','account_export_dataset_limit','oversized datasets fail instead of silently truncating');
SELECT extensions.throws_ok($$SELECT public.account_data_export_snapshot('fa800000-0000-4000-8000-000000000099')$$,'P0002','account_export_unavailable','missing Auth user fails the whole snapshot');
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok($$SELECT public.account_data_export_snapshot('fa800000-0000-4000-8000-000000000001')$$,'42501',NULL,'authenticated callers cannot choose an export subject');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
