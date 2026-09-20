BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(13);
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
INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label, status)
VALUES
  ('fc300000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001', 2041, 'Class of 2041', 'active'),
  ('fc300000-0000-4000-8000-000000000002', 'fc100000-0000-4000-8000-000000000002', 2041, 'Other Class of 2041', 'active');
INSERT INTO plugin_data.csf_cohort_terms (organization_id, cohort_id, term_id, status)
VALUES
  ('fc100000-0000-4000-8000-000000000001', 'fc300000-0000-4000-8000-000000000001', 'fc200000-0000-4000-8000-000000000001', 'active'),
  ('fc100000-0000-4000-8000-000000000002', 'fc300000-0000-4000-8000-000000000002', 'fc200000-0000-4000-8000-000000000002', 'active');

INSERT INTO public.projects (
  id, creator_id, organization_id, title, location, description,
  event_type, verification_method, schedule, require_login
) VALUES
  ('fc400000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001', 'Local Project', 'Local', 'Local project', 'single', 'manual', '{}'::jsonb, true),
  ('fc400000-0000-4000-8000-000000000002', 'fc000000-0000-4000-8000-000000000003', 'fc100000-0000-4000-8000-000000000002', 'Other Project', 'Local', 'Other project', 'single', 'manual', '{}'::jsonb, true);

INSERT INTO plugin_data.csf_opportunities (
  id, organization_id, term_id, cohort_id, title, body, starts_at, status, created_by_user_id
) VALUES
  ('fc500000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001', 'fc200000-0000-4000-8000-000000000001', 'fc300000-0000-4000-8000-000000000001', 'Existing draft', 'Existing draft', '2040-09-01 17:00:00+00', 'draft', 'fc000000-0000-4000-8000-000000000001'),
  ('fc500000-0000-4000-8000-000000000002', 'fc100000-0000-4000-8000-000000000002', 'fc200000-0000-4000-8000-000000000002', 'fc300000-0000-4000-8000-000000000002', 'Other draft', 'Other draft', '2040-09-01 17:00:00+00', 'draft', 'fc000000-0000-4000-8000-000000000003');

SELECT extensions.ok(NOT has_function_privilege('anon','plugin_data.csf_delete_activity(uuid,uuid,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','plugin_data.csf_delete_activity(uuid,uuid,uuid,uuid)','EXECUTE')
  AND has_function_privilege('service_role','plugin_data.csf_delete_activity(uuid,uuid,uuid,uuid)','EXECUTE'), 'only the service role can call deletion');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_delete_activity('fc100000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000001','fc000000-0000-4000-8000-000000000002','fc900000-0000-4000-8000-000000000010')$q$,'42501','Not authorized to manage CSF activities.','members cannot delete activities');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_delete_activity('fc100000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000002','fc000000-0000-4000-8000-000000000001','fc900000-0000-4000-8000-000000000010')$q$,'22023','CSF activity was not found in this organization.','cross-organization deletion is refused');
UPDATE plugin_data.csf_opportunities SET linked_project_id='fc400000-0000-4000-8000-000000000001' WHERE id='fc500000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_delete_activity('fc100000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000001','fc000000-0000-4000-8000-000000000001','fc900000-0000-4000-8000-000000000010')$q$,'22023','This activity has participation, points, email history, or a linked project. Archive it to preserve those records.','a linked project prevents deletion');
UPDATE plugin_data.csf_opportunities SET linked_project_id=NULL WHERE id='fc500000-0000-4000-8000-000000000001';
INSERT INTO plugin_data.csf_opportunity_signups (organization_id, opportunity_id, term_id, source, signup_name)
VALUES ('fc100000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000001','manual','Fictional attendee');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_delete_activity('fc100000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000001','fc000000-0000-4000-8000-000000000001','fc900000-0000-4000-8000-000000000010')$q$,'22023','This activity has participation, points, email history, or a linked project. Archive it to preserve those records.','participation prevents deletion');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_opportunity_signups WHERE opportunity_id='fc500000-0000-4000-8000-000000000001'),1,'refused deletion preserves participation');
DELETE FROM plugin_data.csf_opportunity_signups WHERE opportunity_id='fc500000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_delete_activity('fc100000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000001','fc000000-0000-4000-8000-000000000001',NULL)$q$,'22023','A stable activity request identifier is required.','deletion requires a request identity');
SELECT extensions.is((plugin_data.csf_delete_activity('fc100000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000001','fc000000-0000-4000-8000-000000000001','fc900000-0000-4000-8000-000000000010')->>'status'),'deleted','an unused activity is deleted');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_opportunities WHERE id='fc500000-0000-4000-8000-000000000001'),0,'the activity is removed');
SELECT extensions.is((plugin_data.csf_delete_activity('fc100000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000001','fc000000-0000-4000-8000-000000000001','fc900000-0000-4000-8000-000000000010')->>'idempotent'),'true','retry returns the deletion receipt');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_admin_audit_events WHERE organization_id='fc100000-0000-4000-8000-000000000001' AND correlation_id='fc900000-0000-4000-8000-000000000010'),1,'retry writes no duplicate audit event');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_delete_activity('fc100000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000002','fc000000-0000-4000-8000-000000000001','fc900000-0000-4000-8000-000000000010')$q$,'P0001','That activity request identifier is already bound to a different change.','request collision cannot delete a different activity');
UPDATE public.organization_members SET status='inactive' WHERE organization_id='fc100000-0000-4000-8000-000000000001' AND user_id='fc000000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_delete_activity('fc100000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000001','fc000000-0000-4000-8000-000000000001','fc900000-0000-4000-8000-000000000010')$q$,'42501','Not authorized to manage CSF activities.','revoked staff cannot replay the deletion');
SELECT * FROM extensions.finish();
ROLLBACK;
