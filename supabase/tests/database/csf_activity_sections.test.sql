BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(15);
INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('fc000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'activity-admin@local.test', now(), '{}', '{}', now(), now()),
  ('fc000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'activity-outsider@local.test', now(), '{}', '{}', now(), now()),
  ('fc000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'activity-other-admin@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('fc100000-0000-4000-8000-000000000001', 'Atomic Activities One', 'atomic-activities-one', 'school', '993401'),
  ('fc100000-0000-4000-8000-000000000002', 'Atomic Activities Two', 'atomic-activities-two', 'school', '993402');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('fc100000-0000-4000-8000-000000000002', 'fc000000-0000-4000-8000-000000000003', 'admin', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, lifecycle_status, is_current
) VALUES
  ('fc200000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001', 'F40', 'Fall 2040', '2040-2041', 'fall', 'open', true),
  ('fc200000-0000-4000-8000-000000000002', 'fc100000-0000-4000-8000-000000000002', 'F40', 'Fall 2040', '2040-2041', 'fall', 'open', true);

INSERT INTO plugin_data.csf_opportunities(id,organization_id,term_id,title,body,status,created_by_user_id)
VALUES ('fc500000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000001','Packing','Pack books','draft','fc000000-0000-4000-8000-000000000001');
CREATE TEMP TABLE layout_results(label text,payload jsonb);
INSERT INTO layout_results VALUES ('created',plugin_data.csf_edit_activity_layout('fc100000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000001','fc000000-0000-4000-8000-000000000001','fc700000-0000-4000-8000-000000000001',0,'create_section','{"title":"September"}'));
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_activity_sections WHERE organization_id='fc100000-0000-4000-8000-000000000001'),1,'creates one section');
SELECT extensions.is((SELECT revision FROM plugin_data.csf_activity_layouts WHERE organization_id='fc100000-0000-4000-8000-000000000001'),1::bigint,'increments layout revision');
SELECT extensions.is(plugin_data.csf_edit_activity_layout('fc100000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000001','fc000000-0000-4000-8000-000000000001','fc700000-0000-4000-8000-000000000001',0,'create_section','{"title":"September"}'),(SELECT payload FROM layout_results WHERE label='created'),'same request returns original receipt');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE action='activity.layout_updated' AND organization_id='fc100000-0000-4000-8000-000000000001'),1,'retry creates no second audit');
SELECT extensions.throws_ok($test$ SELECT plugin_data.csf_edit_activity_layout('fc100000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000001','fc000000-0000-4000-8000-000000000001','fc700000-0000-4000-8000-000000000002',0,'create_section','{"title":"October"}') $test$,'40001','Activities changed. Reload before organizing them.','stale edits refuse');
SELECT extensions.throws_ok($test$ SELECT plugin_data.csf_edit_activity_layout('fc100000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000001','fc000000-0000-4000-8000-000000000002','fc700000-0000-4000-8000-000000000003',1,'create_section','{"title":"October"}') $test$,'42501','Not authorized to organize activities.','outsider cannot edit');
SELECT extensions.throws_ok($test$ SELECT plugin_data.csf_edit_activity_layout('fc100000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000002','fc000000-0000-4000-8000-000000000001','fc700000-0000-4000-8000-000000000004',0,'create_section','{"title":"October"}') $test$,'P0001','Choose an open semester in this chapter.','cross-chapter term refused');
INSERT INTO layout_results SELECT 'moved',plugin_data.csf_edit_activity_layout('fc100000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000001','fc000000-0000-4000-8000-000000000001','fc700000-0000-4000-8000-000000000005',1,'move_activity',jsonb_build_object('id','fc500000-0000-4000-8000-000000000001','sectionId',payload->>'id')) FROM layout_results WHERE label='created';
SELECT extensions.is((SELECT section_id::text FROM plugin_data.csf_opportunities WHERE id='fc500000-0000-4000-8000-000000000001'),(SELECT payload->>'id' FROM layout_results WHERE label='created'),'activity is in saved section');
SELECT extensions.is((SELECT catalog_position FROM plugin_data.csf_opportunities WHERE id='fc500000-0000-4000-8000-000000000001'),1::bigint,'catalog order is persisted');
INSERT INTO layout_results SELECT 'deleted',plugin_data.csf_edit_activity_layout('fc100000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000001','fc000000-0000-4000-8000-000000000001','fc700000-0000-4000-8000-000000000006',2,'delete_section',jsonb_build_object('id',payload->>'id')) FROM layout_results WHERE label='created';
SELECT extensions.ok((SELECT section_id IS NULL FROM plugin_data.csf_opportunities WHERE id='fc500000-0000-4000-8000-000000000001'),'deletion moves activity to Unsectioned');
SELECT extensions.is((SELECT title FROM plugin_data.csf_opportunities WHERE id='fc500000-0000-4000-8000-000000000001'),'Packing','deletion preserves activity content');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_activity_sections WHERE organization_id='fc100000-0000-4000-8000-000000000001'),0,'section removed');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_edit_activity_layout(uuid,uuid,uuid,uuid,bigint,text,jsonb)','EXECUTE'),'browser cannot call mutation');
SELECT extensions.ok(NOT has_table_privilege('authenticated','plugin_data.csf_activity_sections','SELECT'),'section table stays server-only');
SELECT extensions.ok(has_function_privilege('service_role','plugin_data.csf_edit_activity_layout(uuid,uuid,uuid,uuid,bigint,text,jsonb)','EXECUTE'),'service can call audited mutation');
SELECT * FROM extensions.finish();
ROLLBACK;
