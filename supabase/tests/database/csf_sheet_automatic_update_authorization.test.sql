BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users (id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('cfb00000-0000-4000-8000-000000000001','authenticated','authenticated','source-officer@local.test',now(),'{}','{}',now(),now());
INSERT INTO public.organizations (id,name,username,type,join_code)
VALUES ('cfb10000-0000-4000-8000-000000000001','Automatic source fixture','automatic-source-fixture','school','975382');
INSERT INTO public.organization_members (organization_id,user_id,role,status)
VALUES ('cfb10000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000001','admin','active');
INSERT INTO plugin_data.csf_sheet_sources (id,organization_id,source_type,title,provider,spreadsheet_id,target_strategy,tab_mappings,settings,sync_owner_user_id)
VALUES ('cfb20000-0000-4000-8000-000000000001','cfb10000-0000-4000-8000-000000000001','application_responses','Fictional responses','google_sheets','fictional-source','derive_from_grade','[{"tabName":"Responses","termCode":"F39","targetStrategy":"derive_from_grade"}]','{"mappingVersion":2}','cfb00000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_sheet_import_jobs
  (id,organization_id,source_id,initiated_by,mode,status,source_type,source_file_id,mapping_version,mapping_snapshot)
VALUES
  ('cfb70000-0000-4000-8000-000000000001','cfb10000-0000-4000-8000-000000000001','cfb20000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000001','preview','completed','application_responses','fictional-source',2,jsonb_build_object('headerSignature',repeat('d',64))),
  ('cfb70000-0000-4000-8000-000000000002','cfb10000-0000-4000-8000-000000000001','cfb20000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000001','preview','completed','application_responses','fictional-source',3,jsonb_build_object('headerSignature',repeat('d',64)));
SELECT extensions.ok(NOT has_table_privilege('authenticated','plugin_data.csf_sheet_automatic_update_authorizations','SELECT'),'browser cannot read worker leases');
SELECT extensions.ok(NOT has_table_privilege('service_role','plugin_data.csf_sheet_automatic_update_authorizations','UPDATE'),'server cannot bypass authorization actions');
SELECT extensions.ok(NOT has_function_privilege('anon','plugin_data.csf_set_sheet_automatic_update_authorization(uuid,uuid,uuid,integer,text,uuid,uuid)','EXECUTE'),'anonymous authorization refused');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_sheet_automatic_update_authorizations),0,'existing links gain no automatic authority');
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_set_sheet_automatic_update_authorization('cfb10000-0000-4000-8000-000000000001','cfb20000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000001',2,'enable','cfb30000-0000-4000-8000-000000000009',NULL)$test$,'22023','Review a current preview before enabling automatic updates.','automatic scope requires an explicitly reviewed preview');
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_set_sheet_automatic_update_authorization('cfb10000-0000-4000-8000-000000000001','cfb20000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000001',2,'enable','cfb30000-0000-4000-8000-000000000009','cfb70000-0000-4000-8000-000000000002')$test$,'22023','Review a current preview before enabling automatic updates.','another mapping version cannot supply the reviewed headers');
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_set_sheet_automatic_update_authorization('cfb10000-0000-4000-8000-000000000001','cfb20000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000001',1,'enable','cfb30000-0000-4000-8000-000000000001','cfb70000-0000-4000-8000-000000000001')$test$,'40001','The Sheet mapping changed. Review it before enabling updates.','stale mapping refuses authority');
SELECT extensions.is(plugin_data.csf_set_sheet_automatic_update_authorization('cfb10000-0000-4000-8000-000000000001','cfb20000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000001',2,'enable','cfb30000-0000-4000-8000-000000000001','cfb70000-0000-4000-8000-000000000001')->>'status','active','explicit linking grants source-scoped authority');
SELECT extensions.is(plugin_data.csf_set_sheet_automatic_update_authorization('cfb10000-0000-4000-8000-000000000001','cfb20000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000001',2,'enable','cfb30000-0000-4000-8000-000000000001','cfb70000-0000-4000-8000-000000000001')->>'generation','1','retry preserves the authorized generation');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE organization_id='cfb10000-0000-4000-8000-000000000001' AND action='sheets.automatic_update_authorization_changed'),1,'retry retains one authorization receipt');
CREATE TEMP TABLE automatic_source_claim (value jsonb);
SELECT extensions.is(plugin_data.csf_claim_sheet_automatic_update_check('class_history')->>'claimed','false','class worker cannot claim an application source');
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_claim_sheet_automatic_update_check('unknown')$test$,'22023','Choose a supported Sheet source type.','worker requires an explicit supported source kind');
INSERT INTO automatic_source_claim VALUES(plugin_data.csf_claim_sheet_automatic_update_check());
SELECT extensions.is((SELECT value->>'claimed' FROM automatic_source_claim),'true','due source receives one lease');
SELECT extensions.is(plugin_data.csf_claim_sheet_automatic_update_check()->>'claimed','false','second worker cannot claim the leased source');
SELECT extensions.is((SELECT plugin_data.csf_assert_sheet_automatic_update_lease('cfb10000-0000-4000-8000-000000000001',(value->>'authorizationId')::uuid,(value->>'generation')::bigint,(value->>'leaseToken')::uuid)->>'valid' FROM automatic_source_claim),'true','current lease rechecks source authority');
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_finish_sheet_automatic_update_check('cfb10000-0000-4000-8000-000000000001',(value->>'authorizationId')::uuid,(value->>'generation')::bigint,(value->>'leaseToken')::uuid,'unchanged','4',NULL) FROM automatic_source_claim$test$,'22023','Prepare this source revision before marking it unchanged.','first check cannot skip preview preparation');
INSERT INTO plugin_data.csf_sheet_import_jobs
  (id,organization_id,source_id,initiated_by,mode,status,source_type,source_file_id,mapping_version,source_file_metadata,mapping_snapshot)
SELECT fixture.id,'cfb10000-0000-4000-8000-000000000001','cfb20000-0000-4000-8000-000000000001',
  'cfb00000-0000-4000-8000-000000000001','preview','completed','application_responses','fictional-source',fixture.mapping_version,
  jsonb_build_object('version',fixture.provider_version),
  jsonb_build_object('automaticUpdateAuthorizationId',value->>'authorizationId',
    'automaticUpdateGeneration',fixture.generation,'automaticUpdateProviderVersion','4',
    'automaticUpdateReadScope','mapped_columns_all_rows',
    'headerSignature',CASE WHEN fixture.id='cfb60000-0000-4000-8000-000000000005' THEN repeat('e',64) ELSE repeat('d',64) END)
FROM automatic_source_claim CROSS JOIN (VALUES
  ('cfb60000-0000-4000-8000-000000000001'::uuid,2,'4',1),
  ('cfb60000-0000-4000-8000-000000000002'::uuid,2,'3',1),
  ('cfb60000-0000-4000-8000-000000000003'::uuid,1,'4',1),
  ('cfb60000-0000-4000-8000-000000000004'::uuid,2,'4',2),
  ('cfb60000-0000-4000-8000-000000000005'::uuid,2,'4',1)
) fixture(id,mapping_version,provider_version,generation);
SELECT extensions.throws_ok(format(
  'SELECT plugin_data.csf_finish_sheet_automatic_update_check(%L,%L,%L,%L,%L,%L,%L)',
  'cfb10000-0000-4000-8000-000000000001',value->>'authorizationId',value->>'generation',value->>'leaseToken',
  'prepared','4',bad.id), '22023','The prepared preview does not belong to this source.',bad.label)
FROM automatic_source_claim CROSS JOIN (VALUES
  ('cfb60000-0000-4000-8000-000000000002','old provider revision cannot settle'),
  ('cfb60000-0000-4000-8000-000000000003','old mapping cannot settle'),
  ('cfb60000-0000-4000-8000-000000000004','another authorization generation cannot settle'),
  ('cfb60000-0000-4000-8000-000000000005','changed headers cannot settle under the old approved mapping')
) bad(id,label);
SELECT extensions.is((SELECT plugin_data.csf_finish_sheet_automatic_update_check('cfb10000-0000-4000-8000-000000000001',(value->>'authorizationId')::uuid,(value->>'generation')::bigint,(value->>'leaseToken')::uuid,'prepared','4','cfb60000-0000-4000-8000-000000000001')->>'finished' FROM automatic_source_claim),'true','matching immutable preview settles preparation');
SELECT extensions.ok(NOT has_function_privilege('service_role','plugin_data.csf_assert_automatic_sheet_preview_current(uuid,uuid,uuid)','EXECUTE'),'automatic commit guard is owner-only');
SELECT extensions.lives_ok($test$SELECT plugin_data.csf_assert_automatic_sheet_preview_current('cfb10000-0000-4000-8000-000000000001','cfb60000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000001')$test$,'current prepared preview retains automatic authority after its preparation lease ends');
SELECT extensions.throws_ok(format($query$DO $body$ BEGIN
  UPDATE plugin_data.csf_sheet_automatic_update_authorizations SET last_preview_job_id=%L
    WHERE organization_id='cfb10000-0000-4000-8000-000000000001';
  PERFORM plugin_data.csf_assert_automatic_sheet_preview_current(
    'cfb10000-0000-4000-8000-000000000001',%L,'cfb00000-0000-4000-8000-000000000001');
END $body$$query$,bad.id,bad.id),
  '55000','Automatic updates changed. Review this Sheet before importing.',bad.label)
FROM (VALUES
  ('cfb60000-0000-4000-8000-000000000002','commit checks exact provider version independently of the checkpoint'),
  ('cfb60000-0000-4000-8000-000000000003','commit checks the authorized mapping version'),
  ('cfb60000-0000-4000-8000-000000000004','commit checks the original consent generation'),
  ('cfb60000-0000-4000-8000-000000000005','commit checks the approved header signature')
) bad(id,label);
SELECT extensions.lives_ok($test$SELECT plugin_data.csf_assert_automatic_sheet_preview_current('cfb10000-0000-4000-8000-000000000001','cfb70000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000001')$test$,'manual preview keeps its existing officer approval path');
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_assert_automatic_sheet_preview_current('cfb10000-0000-4000-8000-000000000001','cfb60000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000002')$test$,'55000','Automatic updates changed. Review this Sheet before importing.','another actor cannot reuse the source authorization');
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_assert_automatic_sheet_preview_current('cfb10000-0000-4000-8000-000000000002','cfb60000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000001')$test$,'23503','This import preview is no longer available.','another organization cannot use the preview');
UPDATE plugin_data.csf_sheet_automatic_update_authorizations SET next_check_at=now()
WHERE organization_id='cfb10000-0000-4000-8000-000000000001';
UPDATE automatic_source_claim SET value=plugin_data.csf_claim_sheet_automatic_update_check();
SELECT extensions.is((SELECT plugin_data.csf_finish_sheet_automatic_update_check('cfb10000-0000-4000-8000-000000000001',(value->>'authorizationId')::uuid,(value->>'generation')::bigint,(value->>'leaseToken')::uuid,'unchanged','4',NULL)->>'finished' FROM automatic_source_claim),'true','unchanged provider revision settles without preparing rows');
SELECT extensions.ok((SELECT last_provider_version='4' AND last_preview_job_id='cfb60000-0000-4000-8000-000000000001' AND next_check_at=now()+interval '5 minutes' AND lease_token IS NULL FROM plugin_data.csf_sheet_automatic_update_authorizations WHERE organization_id='cfb10000-0000-4000-8000-000000000001'),'unchanged check waits five minutes and retains the existing preview');
SELECT extensions.is(plugin_data.csf_claim_sheet_automatic_update_check()->>'claimed','false','checks do not run before their due time');
UPDATE plugin_data.csf_sheet_automatic_update_authorizations SET next_check_at=now()
WHERE organization_id='cfb10000-0000-4000-8000-000000000001';
UPDATE automatic_source_claim SET value=plugin_data.csf_claim_sheet_automatic_update_check();
UPDATE plugin_data.csf_sheet_sources SET settings='{"mappingVersion":3}' WHERE id='cfb20000-0000-4000-8000-000000000001';
SELECT extensions.ok((SELECT mapping_hash IS DISTINCT FROM plugin_data.csf_sheet_automatic_update_mapping_hash(source_id,organization_id) FROM plugin_data.csf_sheet_automatic_update_authorizations WHERE organization_id='cfb10000-0000-4000-8000-000000000001'),'changed mappings invalidate saved scope');
SELECT extensions.is((SELECT plugin_data.csf_assert_sheet_automatic_update_lease('cfb10000-0000-4000-8000-000000000001',(value->>'authorizationId')::uuid,(value->>'generation')::bigint,(value->>'leaseToken')::uuid)->>'valid' FROM automatic_source_claim),'false','mapping drift invalidates an in-progress lease');
SELECT extensions.is(plugin_data.csf_set_sheet_automatic_update_authorization('cfb10000-0000-4000-8000-000000000001','cfb20000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000001',2,'pause','cfb30000-0000-4000-8000-000000000002')->>'status','paused','officer can pause even after a mapping changes');
SELECT extensions.ok((SELECT lease_token IS NULL AND lease_expires_at IS NULL FROM plugin_data.csf_sheet_automatic_update_authorizations WHERE organization_id='cfb10000-0000-4000-8000-000000000001'),'pause invalidates an existing worker lease');
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_assert_automatic_sheet_preview_current('cfb10000-0000-4000-8000-000000000001','cfb60000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000001')$test$,'55000','Automatic updates changed. Review this Sheet before importing.','pause refuses a prepared preview before any row write');
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_claim_import_commit_attempt('cfb10000-0000-4000-8000-000000000001','cfb60000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000001',300,NULL)$test$,'55000','Automatic updates changed. Review this Sheet before importing.','public commit claim enforces pause before freezing a decision');
INSERT INTO plugin_data.csf_sheet_import_jobs
  (id,organization_id,source_id,initiated_by,mode,status,source_type,preview_job_id)
VALUES ('cfb80000-0000-4000-8000-000000000001','cfb10000-0000-4000-8000-000000000001',
  'cfb20000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000001','commit','running',
  'application_responses','cfb60000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_sheet_import_commit_attempts
  (id,organization_id,commit_job_id,attempt_number,actor_user_id,lease_expires_at)
VALUES ('cfb90000-0000-4000-8000-000000000001','cfb10000-0000-4000-8000-000000000001',
  'cfb80000-0000-4000-8000-000000000001',1,'cfb00000-0000-4000-8000-000000000001',now()+interval '5 minutes');
INSERT INTO plugin_data.csf_sheet_import_rows
  (id,organization_id,job_id,source_id,sheet_tab_name,row_number,import_status)
VALUES ('cfba0000-0000-4000-8000-000000000001','cfb10000-0000-4000-8000-000000000001',
  'cfb60000-0000-4000-8000-000000000001','cfb20000-0000-4000-8000-000000000001','Responses',2,'pending');
SELECT extensions.throws_ok(format('SELECT plugin_data.%I(%L,%L,%L)',entry.name,
  'cfb10000-0000-4000-8000-000000000001','cfb90000-0000-4000-8000-000000000001','cfba0000-0000-4000-8000-000000000001'),
  '55000','Automatic updates changed. Review this Sheet before importing.',entry.label)
FROM (VALUES ('csf_begin_import_row_for_attempt','row begin refuses paused source authority'),
  ('csf_commit_import_row_for_attempt','row commit refuses paused source authority')) entry(name,label);
SELECT extensions.is((SELECT commit_outcome_state FROM plugin_data.csf_sheet_import_rows
  WHERE id='cfba0000-0000-4000-8000-000000000001'),'not_started','paused source creates no row write intent');
SELECT extensions.is((SELECT plugin_data.csf_finish_sheet_automatic_update_check('cfb10000-0000-4000-8000-000000000001',(value->>'authorizationId')::uuid,(value->>'generation')::bigint,(value->>'leaseToken')::uuid,'unchanged','4',NULL)->>'finished' FROM automatic_source_claim),'false','late worker cannot settle after pause');
SELECT extensions.is(plugin_data.csf_set_sheet_automatic_update_authorization('cfb10000-0000-4000-8000-000000000001','cfb20000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000001',2,'enable','cfb30000-0000-4000-8000-000000000001','cfb70000-0000-4000-8000-000000000001')->>'status','paused','old enable retry does not undo pause');
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_set_sheet_automatic_update_authorization('cfb10000-0000-4000-8000-000000000001','cfb20000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000001',3,'enable','cfb30000-0000-4000-8000-000000000001','cfb70000-0000-4000-8000-000000000001')$test$,'22023','This request belongs to another source authorization.','request scope cannot change');
SELECT extensions.is(plugin_data.csf_set_sheet_automatic_update_authorization('cfb10000-0000-4000-8000-000000000001','cfb20000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000001',3,'enable','cfb30000-0000-4000-8000-000000000003','cfb70000-0000-4000-8000-000000000002')->>'status','active','officer may authorize the changed mapping with a new request');
SELECT extensions.ok((SELECT last_provider_version IS NULL AND last_preview_job_id IS NULL FROM plugin_data.csf_sheet_automatic_update_authorizations WHERE organization_id='cfb10000-0000-4000-8000-000000000001'),'new authorization requires a fresh preview instead of reusing earlier consent');
UPDATE public.organization_members SET status='inactive' WHERE organization_id='cfb10000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_set_sheet_automatic_update_authorization('cfb10000-0000-4000-8000-000000000001','cfb20000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000001',3,'enable','cfb30000-0000-4000-8000-000000000003','cfb70000-0000-4000-8000-000000000002')$test$,'42501','This officer is not an active member of the organization whose CSF import they are acting on.','revoked officer cannot authorize updates');
SELECT extensions.is(plugin_data.csf_claim_sheet_automatic_update_check()->>'claimed','false','worker cannot claim a source after the approving officer loses access');
SELECT extensions.is((SELECT status FROM plugin_data.csf_sheet_automatic_update_authorizations WHERE organization_id='cfb10000-0000-4000-8000-000000000001'),'blocked','revoked authority becomes a visible blocked state');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_term_applications WHERE organization_id='cfb10000-0000-4000-8000-000000000001'),0,'authorization never imports or approves applications');
SELECT * FROM extensions.finish();
ROLLBACK;
