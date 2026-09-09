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
 jsonb_build_array(jsonb_build_object('tabName',CASE WHEN n=1 THEN 'F39' ELSE 'S40' END,'termCode',CASE WHEN n=1 THEN 'F39' ELSE 'S40' END,
 'cohortYear',2040,'targetStrategy','fixed','headerRow',1,'rangeA1',quote_literal(CASE WHEN n=1 THEN 'F39' ELSE 'S40' END)||'!A1:Q100','activityPointMode','one_per_populated_slot')),
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

SELECT plugin_data.csf_set_sheet_automatic_update_authorization(
'cd100000-0000-4000-8000-000000000001','cd300000-0000-4000-8000-000000000001','cd000000-0000-4000-8000-000000000001',
1,'enable','cd600000-0000-4000-8000-000000000001','cd400000-0000-4000-8000-000000000001');
SELECT extensions.is(plugin_data.csf_inherit_matching_class_tab_authorization(
'cd100000-0000-4000-8000-000000000001','cd300000-0000-4000-8000-000000000002')->>'inherited','false','legacy consent never expands to another tab');
SELECT extensions.is(plugin_data.csf_set_sheet_automatic_update_authorization(
'cd100000-0000-4000-8000-000000000001','cd300000-0000-4000-8000-000000000001','cd000000-0000-4000-8000-000000000001',
1,'enable','cd600000-0000-4000-8000-000000000010','cd400000-0000-4000-8000-000000000001',true)->>'includeMatchingSemesterTabs',
'true','an officer explicitly authorizes matching canonical semester tabs');
SELECT extensions.is(plugin_data.csf_set_sheet_automatic_update_authorization(
'cd100000-0000-4000-8000-000000000001','cd300000-0000-4000-8000-000000000001','cd000000-0000-4000-8000-000000000001',
1,'enable','cd600000-0000-4000-8000-000000000010','cd400000-0000-4000-8000-000000000001',true)->>'replayed','true','scope confirmation is retry-safe');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_set_sheet_automatic_update_authorization(
'cd100000-0000-4000-8000-000000000001','cd300000-0000-4000-8000-000000000001','cd000000-0000-4000-8000-000000000001',
1,'enable','cd600000-0000-4000-8000-000000000010','cd400000-0000-4000-8000-000000000001',false)$q$,
'22023','This request belongs to another Sheet update scope.','a request cannot change its authorization scope');
SELECT extensions.is(plugin_data.csf_inherit_matching_class_tab_authorization(
'cd100000-0000-4000-8000-000000000001','cd300000-0000-4000-8000-000000000002')->>'inherited','true','a matching new tab inherits reviewed layout consent');
SELECT extensions.is(plugin_data.csf_inherit_matching_class_tab_authorization(
'cd100000-0000-4000-8000-000000000001','cd300000-0000-4000-8000-000000000002')->>'inherited','false','retry does not replace an existing authorization');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE action='sheets.matching_tab_authorization_inherited'),1,'one inheritance audit is recorded');
SELECT extensions.ok((SELECT plugin_data.csf_sheet_automatic_update_authorization_current(organization_id,id)
FROM plugin_data.csf_sheet_automatic_update_authorizations WHERE source_id='cd300000-0000-4000-8000-000000000002'),'child authority is current');
SELECT extensions.ok((SELECT child.authorized_by=parent.authorized_by AND child.google_owner_user_id=parent.google_owner_user_id
AND child.approved_header_signature=parent.approved_header_signature AND child.reviewed_preview_job_id=parent.reviewed_preview_job_id
FROM plugin_data.csf_sheet_automatic_update_authorizations child JOIN plugin_data.csf_sheet_automatic_update_authorizations parent
ON parent.id=child.parent_authorization_id),'the child retains officer, owner, header and original review evidence');
INSERT INTO plugin_data.csf_sheet_sources(id,organization_id,cohort_id,source_type,title,provider,spreadsheet_id,target_strategy,tab_mappings,settings,sync_owner_user_id)
SELECT 'cd300000-0000-4000-8000-000000000003',organization_id,cohort_id,source_type,'Different point rules',provider,spreadsheet_id,target_strategy,
jsonb_set(tab_mappings,'{0,activityPointMode}','"explicit_numeric"'),settings,sync_owner_user_id
FROM plugin_data.csf_sheet_sources WHERE id='cd300000-0000-4000-8000-000000000002';
SELECT extensions.ok(NOT plugin_data.csf_class_sheet_layout_matches(
'cd100000-0000-4000-8000-000000000001','cd300000-0000-4000-8000-000000000001','cd300000-0000-4000-8000-000000000003'),'point rule changes need review');
SELECT extensions.is(plugin_data.csf_inherit_matching_class_tab_authorization(
'cd100000-0000-4000-8000-000000000001','cd300000-0000-4000-8000-000000000003')->>'inherited','false','changed mapping cannot inherit authority');
CREATE TEMP TABLE unmatched_tab_cases(n integer,label text,patch jsonb);
INSERT INTO unmatched_tab_cases VALUES
(21,'changed header row','{"headerRow":2}'),
(22,'changed right column','{"rangeA1":"S40!A1:R100"}'),
(23,'changed left column','{"rangeA1":"S40!B1:Q100"}'),
(24,'changed first row','{"rangeA1":"S40!A2:Q100"}'),
(25,'another range tab','{"rangeA1":"F39!A1:Q100"}'),
(26,'noncanonical tab','{"tabName":"Notes","termCode":"Notes"}'),
(27,'wrong class','{"cohortYear":2041}'),
(28,'postgraduation fall','{"tabName":"F40","termCode":"F40","rangeA1":"F40!A1:Q100"}'),
(29,'pre-high-school spring','{"tabName":"S36","termCode":"S36","rangeA1":"S36!A1:Q100"}'),
(30,'unknown layout field','{"unreviewedRule":true}');
INSERT INTO plugin_data.csf_sheet_sources(id,organization_id,cohort_id,source_type,title,provider,spreadsheet_id,target_strategy,tab_mappings,settings,sync_owner_user_id)
SELECT ('cd300000-0000-4000-8000-'||lpad(c.n::text,12,'0'))::uuid,s.organization_id,s.cohort_id,s.source_type,c.label,s.provider,s.spreadsheet_id,s.target_strategy,
jsonb_build_array(s.tab_mappings->0||c.patch),s.settings,s.sync_owner_user_id
FROM plugin_data.csf_sheet_sources s CROSS JOIN unmatched_tab_cases c WHERE s.id='cd300000-0000-4000-8000-000000000002';
SELECT extensions.ok(NOT plugin_data.csf_class_sheet_layout_matches(
'cd100000-0000-4000-8000-000000000001','cd300000-0000-4000-8000-000000000001',
('cd300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid),label||' needs review') FROM unmatched_tab_cases ORDER BY n;
UPDATE public.organization_members SET status='inactive'
WHERE organization_id='cd100000-0000-4000-8000-000000000001' AND user_id='cd000000-0000-4000-8000-000000000001';
SELECT extensions.ok(NOT (SELECT plugin_data.csf_sheet_automatic_update_authorization_current(organization_id,id)
FROM plugin_data.csf_sheet_automatic_update_authorizations WHERE source_id='cd300000-0000-4000-8000-000000000002'),'revoked officer permission blocks inherited authority');
UPDATE public.organization_members SET status='active'
WHERE organization_id='cd100000-0000-4000-8000-000000000001' AND user_id='cd000000-0000-4000-8000-000000000001';
SELECT plugin_data.csf_set_sheet_automatic_update_authorization(
'cd100000-0000-4000-8000-000000000001','cd300000-0000-4000-8000-000000000001','cd000000-0000-4000-8000-000000000001',
1,'pause','cd600000-0000-4000-8000-000000000011',NULL);
SELECT extensions.ok(NOT (SELECT plugin_data.csf_sheet_automatic_update_authorization_current(organization_id,id)
FROM plugin_data.csf_sheet_automatic_update_authorizations WHERE source_id='cd300000-0000-4000-8000-000000000002'),'pausing parent stops inherited updates');
SELECT plugin_data.csf_set_sheet_automatic_update_authorization(
'cd100000-0000-4000-8000-000000000001','cd300000-0000-4000-8000-000000000002','cd000000-0000-4000-8000-000000000001',
1,'enable','cd600000-0000-4000-8000-000000000012','cd400000-0000-4000-8000-000000000002');
SELECT extensions.ok((SELECT parent_authorization_id IS NULL AND NOT include_matching_semester_tabs
AND plugin_data.csf_sheet_automatic_update_authorization_current(organization_id,id)
FROM plugin_data.csf_sheet_automatic_update_authorizations WHERE source_id='cd300000-0000-4000-8000-000000000002'),
'an officer can independently review and enable the child tab');
SELECT extensions.ok(NOT plugin_data.csf_class_sheet_layout_matches(
'cd100000-0000-4000-8000-000000000002','cd300000-0000-4000-8000-000000000001','cd300000-0000-4000-8000-000000000002'),'another tenant cannot reuse the layout');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_inherit_matching_class_tab_authorization(uuid,uuid)','EXECUTE'),'browser roles cannot inherit authority directly');
SELECT extensions.ok(NOT has_function_privilege('service_role','plugin_data.csf_set_sheet_automatic_update_authorization_tab_base(uuid,uuid,uuid,integer,text,uuid,uuid)','EXECUTE'),'runtime cannot bypass scope-bound receipts');
SELECT * FROM extensions.finish();
ROLLBACK;
