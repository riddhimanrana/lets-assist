BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(23);
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
INSERT INTO plugin_data.csf_opportunity_signups (organization_id, opportunity_id, term_id, source, signup_name)
VALUES ('fc100000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000001','manual','Fictional attendee');
INSERT INTO plugin_data.csf_profiles (id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name)
VALUES ('fc600000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001','Fictional','Member','fictional','member');
INSERT INTO plugin_data.csf_point_submissions (organization_id,profile_id,term_id,opportunity_id,source,description,claimed_points,point_type,status)
VALUES ('fc100000-0000-4000-8000-000000000001','fc600000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000001','manual','Existing submission',2,'non_drive','submitted');
INSERT INTO plugin_data.csf_credit_records (organization_id,profile_id,term_id,opportunity_id,source,points,point_type,status,evidence)
VALUES ('fc100000-0000-4000-8000-000000000001','fc600000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000001','manual',2,'non_drive','verified','{}');
INSERT INTO plugin_data.csf_communication_campaigns (organization_id,campaign_kind,status,sender_email,subject,source_activity_id,term_id,audience_kind,audience_cohort_id,audience_snapshot_version,provider_idempotency_key)
VALUES ('fc100000-0000-4000-8000-000000000001','broadcast','draft','draft@local.test','Existing activity email','fc500000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000001','cohort_members','fc300000-0000-4000-8000-000000000001',1,'activity-removal-email');
CREATE TEMP TABLE removal_history_before AS SELECT
  (SELECT jsonb_agg(to_jsonb(s)) FROM plugin_data.csf_point_submissions s WHERE opportunity_id='fc500000-0000-4000-8000-000000000001') AS submissions,
  (SELECT jsonb_agg(to_jsonb(c)) FROM plugin_data.csf_credit_records c WHERE opportunity_id='fc500000-0000-4000-8000-000000000001') AS credits,
  (SELECT jsonb_agg(to_jsonb(c)) FROM plugin_data.csf_communication_campaigns c WHERE source_activity_id='fc500000-0000-4000-8000-000000000001') AS campaigns;
SELECT extensions.is((plugin_data.csf_delete_activity('fc100000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000001','fc000000-0000-4000-8000-000000000001','fc900000-0000-4000-8000-000000000011')->>'historyRetained'),'true','removal retains linked history');
SELECT extensions.is((SELECT status FROM plugin_data.csf_opportunities WHERE id='fc500000-0000-4000-8000-000000000001'),'archived','removed activity leaves the catalog');
SELECT extensions.is((SELECT linked_project_id::text FROM plugin_data.csf_opportunities WHERE id='fc500000-0000-4000-8000-000000000001'),'fc400000-0000-4000-8000-000000000001','linked project is preserved');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_opportunity_signups WHERE opportunity_id='fc500000-0000-4000-8000-000000000001'),1,'removal preserves participation');
SELECT extensions.is((plugin_data.csf_delete_activity('fc100000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000001','fc000000-0000-4000-8000-000000000001','fc900000-0000-4000-8000-000000000011')->>'idempotent'),'true','retained removal replays');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_admin_audit_events WHERE correlation_id='fc900000-0000-4000-8000-000000000011'),1,'retained removal has one receipt');
SELECT extensions.ok((SELECT archived_at IS NOT NULL FROM plugin_data.csf_opportunities WHERE id='fc500000-0000-4000-8000-000000000001'),'removal records its archive time');
SELECT extensions.is((SELECT jsonb_agg(to_jsonb(s)) FROM plugin_data.csf_point_submissions s WHERE opportunity_id='fc500000-0000-4000-8000-000000000001'),(SELECT submissions FROM removal_history_before),'submissions remain unchanged');
SELECT extensions.is((SELECT jsonb_agg(to_jsonb(c)) FROM plugin_data.csf_credit_records c WHERE opportunity_id='fc500000-0000-4000-8000-000000000001'),(SELECT credits FROM removal_history_before),'earned points remain unchanged');
SELECT extensions.is((SELECT jsonb_agg(to_jsonb(c)) FROM plugin_data.csf_communication_campaigns c WHERE source_activity_id='fc500000-0000-4000-8000-000000000001'),(SELECT campaigns FROM removal_history_before),'email history remains unchanged');
INSERT INTO plugin_data.csf_opportunities (id, organization_id, term_id, title, body, status, created_by_user_id)
VALUES ('fc500000-0000-4000-8000-000000000004','fc100000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000001','Email-only activity','Email-only activity','archived','fc000000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_communication_campaigns (organization_id,campaign_kind,status,sender_email,subject,source_activity_id,term_id,audience_kind,audience_snapshot_version,provider_idempotency_key)
VALUES ('fc100000-0000-4000-8000-000000000001','broadcast','draft','draft@local.test','Email-only history','fc500000-0000-4000-8000-000000000004','fc200000-0000-4000-8000-000000000001','term_members',1,'email-only-removal');
SELECT extensions.is((plugin_data.csf_delete_activity('fc100000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000004','fc000000-0000-4000-8000-000000000001','fc900000-0000-4000-8000-000000000012')->>'historyRetained'),'true','an archived activity with only email history can be removed');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_communication_campaigns WHERE source_activity_id='fc500000-0000-4000-8000-000000000004'),1,'email-only removal preserves its campaign');
SELECT extensions.is((SELECT reason_code FROM plugin_data.csf_admin_audit_events WHERE correlation_id='fc900000-0000-4000-8000-000000000012'),'activity_removed_history_retained','email-only removal records preserved history');
-- The remaining checks use a separate empty activity.
INSERT INTO plugin_data.csf_opportunities (id, organization_id, term_id, title, body, status, created_by_user_id)
VALUES ('fc500000-0000-4000-8000-000000000003','fc100000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000001','Unused draft','Unused draft','draft','fc000000-0000-4000-8000-000000000001');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_delete_activity('fc100000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000003','fc000000-0000-4000-8000-000000000001',NULL)$q$,'22023','A stable activity request identifier is required.','deletion requires a request identity');
SELECT extensions.is((plugin_data.csf_delete_activity('fc100000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000003','fc000000-0000-4000-8000-000000000001','fc900000-0000-4000-8000-000000000010')->>'status'),'deleted','an unused activity is deleted');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_opportunities WHERE id='fc500000-0000-4000-8000-000000000003'),0,'the activity is removed');
SELECT extensions.is((plugin_data.csf_delete_activity('fc100000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000003','fc000000-0000-4000-8000-000000000001','fc900000-0000-4000-8000-000000000010')->>'idempotent'),'true','retry returns the deletion receipt');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_admin_audit_events WHERE organization_id='fc100000-0000-4000-8000-000000000001' AND correlation_id='fc900000-0000-4000-8000-000000000010'),1,'retry writes no duplicate audit event');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_delete_activity('fc100000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000002','fc000000-0000-4000-8000-000000000001','fc900000-0000-4000-8000-000000000010')$q$,'P0001','That activity request identifier is already bound to a different change.','request collision cannot delete a different activity');
UPDATE public.organization_members SET status='inactive' WHERE organization_id='fc100000-0000-4000-8000-000000000001' AND user_id='fc000000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_delete_activity('fc100000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000003','fc000000-0000-4000-8000-000000000001','fc900000-0000-4000-8000-000000000010')$q$,'42501','Not authorized to manage CSF activities.','revoked staff cannot replay the deletion');
SELECT * FROM extensions.finish();
ROLLBACK;
