BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users (id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('cf800000-0000-4000-8000-000000000001','authenticated','authenticated','application-review-link@local.test',now(),'{}','{}',now(),now());
INSERT INTO public.organizations (id,name,username,type,join_code)
VALUES ('cf810000-0000-4000-8000-000000000001','Application link fixture','application-link-fixture','school','985392');
INSERT INTO public.organization_members (organization_id,user_id,role,status)
VALUES ('cf810000-0000-4000-8000-000000000001','cf800000-0000-4000-8000-000000000001','admin','active');
INSERT INTO plugin_data.csf_terms (id,organization_id,code,label,school_year,semester)
VALUES ('cf820000-0000-4000-8000-000000000001','cf810000-0000-4000-8000-000000000001','S34','Spring 2034','2033-2034','spring');
INSERT INTO plugin_data.csf_sheet_sources
  (id,organization_id,source_type,title,provider,spreadsheet_id,tab_mappings,settings,target_strategy)
VALUES ('cf830000-0000-4000-8000-000000000001','cf810000-0000-4000-8000-000000000001',
  'application_responses','Chapter responses','google_sheets','synthetic-application-link',
  '[{"tabName":"Responses","termCode":"S34","targetStrategy":"derive_from_grade"}]',
  '{"mappingVersion":2}','derive_from_grade');
SELECT extensions.ok(NOT has_function_privilege('anon','plugin_data.csf_prepare_application_source_review_periods(uuid,uuid,uuid,integer)','EXECUTE'),'anonymous callers cannot prepare review');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_prepare_application_source_review_periods(uuid,uuid,uuid,integer)','EXECUTE'),'browser callers cannot prepare review');
SELECT extensions.ok(has_function_privilege('service_role','plugin_data.csf_prepare_application_source_review_periods(uuid,uuid,uuid,integer)','EXECUTE'),'audited server may prepare review');
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_prepare_application_source_review_periods('cf810000-0000-4000-8000-000000000001','cf800000-0000-4000-8000-000000000001','cf830000-0000-4000-8000-000000000001',1)$test$,'40001','The Sheet mapping changed. Reload it before preparing review.','stale mapping refuses before creating a period');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_review_periods WHERE organization_id='cf810000-0000-4000-8000-000000000001'),0,'stale mapping creates nothing');
SELECT extensions.is(plugin_data.csf_prepare_application_source_review_periods('cf810000-0000-4000-8000-000000000001','cf800000-0000-4000-8000-000000000001','cf830000-0000-4000-8000-000000000001',2)->>'createdPeriodCount','1','linking prepares its missing source-semester review');
SELECT extensions.is((SELECT status::text FROM plugin_data.csf_review_periods WHERE organization_id='cf810000-0000-4000-8000-000000000001'),'open','new review opens');
CREATE TEMP TABLE application_period_original AS SELECT to_jsonb(p) AS value
FROM plugin_data.csf_review_periods p WHERE organization_id='cf810000-0000-4000-8000-000000000001';
SELECT extensions.is(plugin_data.csf_prepare_application_source_review_periods('cf810000-0000-4000-8000-000000000001','cf800000-0000-4000-8000-000000000001','cf830000-0000-4000-8000-000000000001',2)->>'existingPeriodCount','1','retry reuses the period');
SELECT extensions.is((SELECT to_jsonb(p) FROM plugin_data.csf_review_periods p WHERE organization_id='cf810000-0000-4000-8000-000000000001'),(SELECT value FROM application_period_original),'retry leaves review settings unchanged');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_admin_audit_events WHERE organization_id='cf810000-0000-4000-8000-000000000001' AND action='application_source.review_period_prepared'),1,'retry preserves one linking audit');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_term_applications WHERE organization_id='cf810000-0000-4000-8000-000000000001'),0,'period setup neither imports nor approves applications');
SELECT plugin_data.csf_set_review_period('cf810000-0000-4000-8000-000000000001','cf800000-0000-4000-8000-000000000001',
  'cf820000-0000-4000-8000-000000000001','membership_applications','closed','Closed review',NULL,NULL,NULL);
SELECT extensions.is(plugin_data.csf_prepare_application_source_review_periods('cf810000-0000-4000-8000-000000000001','cf800000-0000-4000-8000-000000000001','cf830000-0000-4000-8000-000000000001',2)->>'closedPeriodCount','1','closed review is reported, not reopened');
SELECT extensions.is((SELECT status::text FROM plugin_data.csf_review_periods WHERE organization_id='cf810000-0000-4000-8000-000000000001'),'closed','closed status is preserved');
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_prepare_application_source_review_periods('cf810000-0000-4000-8000-000000000001','cf800000-0000-4000-8000-000000000001','cf830000-0000-4000-8000-000000000002',2)$test$,'22023','Choose a linked chapter application Sheet.','unknown source is refused');
UPDATE public.organization_members SET status='inactive' WHERE organization_id='cf810000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_prepare_application_source_review_periods('cf810000-0000-4000-8000-000000000001','cf800000-0000-4000-8000-000000000001','cf830000-0000-4000-8000-000000000001',2)$test$,'42501','This officer is not an active member of the organization whose CSF import they are acting on.','revoked officer cannot prepare or reuse review');
SELECT * FROM extensions.finish();
ROLLBACK;
