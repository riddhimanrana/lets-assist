BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'b8000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'activity-restoration@local.test',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'b8100000-0000-4000-8000-000000000001',
  'Activity restoration fixture',
  'activity-restoration-fixture',
  'school',
  '507508'
);

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES (
  'b8100000-0000-4000-8000-000000000001',
  'b8000000-0000-4000-8000-000000000001',
  'admin',
  'active'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  lifecycle_status, is_current
) VALUES (
  'b8200000-0000-4000-8000-000000000001',
  'b8100000-0000-4000-8000-000000000001',
  'F40',
  'Fall 2040',
  '2040-2041',
  'fall',
  'open',
  true
);




CREATE TEMP TABLE restore_fixture AS SELECT (plugin_data.csf_create_activity('b8100000-0000-4000-8000-000000000001','b8200000-0000-4000-8000-000000000001',NULL,'{"title":"Fictional fundraiser","status":"published","signupMode":"none","pointValue":2,"pointType":"drive"}'::jsonb,'b8000000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000001')->>'activityId')::uuid AS id;

GRANT SELECT ON restore_fixture TO service_role;

SELECT plugin_data.csf_set_activity_status_with_email('b8100000-0000-4000-8000-000000000001',(SELECT id FROM restore_fixture),'closed',NULL,'b8000000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000002',false,NULL);

CREATE TEMP TABLE original_activity AS SELECT * FROM plugin_data.csf_opportunities WHERE id=(SELECT id FROM restore_fixture);

CREATE TEMP TABLE original_events AS SELECT to_jsonb(e) AS data FROM plugin_data.csf_publication_events e WHERE source_id=(SELECT id FROM restore_fixture);

CREATE TEMP TABLE original_notices AS SELECT to_jsonb(d) AS data FROM plugin_data.csf_publication_notification_deliveries d WHERE event_id IN (SELECT id FROM plugin_data.csf_publication_events WHERE source_id=(SELECT id FROM restore_fixture));

SET LOCAL ROLE service_role;

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_set_activity_status_with_email('b8100000-0000-4000-8000-000000000001',(SELECT id FROM restore_fixture),'restored',NULL,'b8000000-0000-4000-8000-000000000099','b8300000-0000-4000-8000-000000000003',false,NULL)$q$,'P0001','Not authorized to manage CSF activities.','unknown actor cannot restore');

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_set_activity_status_with_email('b8100000-0000-4000-8000-000000000099',(SELECT id FROM restore_fixture),'restored',NULL,'b8000000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000003',false,NULL)$q$,'P0001','Not authorized to manage CSF activities.','restoration is organization scoped');

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_set_activity_status_with_email('b8100000-0000-4000-8000-000000000001',(SELECT id FROM restore_fixture),'restored',NULL,'b8000000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000003',true,NULL)$q$,'22023','Restoring an activity cannot request another announcement.','restoration refuses notification requests');

SET LOCAL ROLE service_role;

SELECT extensions.is((plugin_data.csf_set_activity_status_with_email('b8100000-0000-4000-8000-000000000001',(SELECT id FROM restore_fixture),'restored',NULL,'b8000000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000003',false,NULL)->>'status'),'published','closed activity restores to published');

SELECT extensions.is((plugin_data.csf_set_activity_status_with_email('b8100000-0000-4000-8000-000000000001',(SELECT id FROM restore_fixture),'restored',NULL,'b8000000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000003',false,NULL)->>'idempotent'),'true','the same restoration request is retry safe');

RESET ROLE;

SELECT extensions.ok((SELECT status='published' AND closed_at IS NULL FROM plugin_data.csf_opportunities WHERE id=(SELECT id FROM restore_fixture)),'restoration clears the closed state');

SELECT extensions.is((SELECT to_jsonb(a)-ARRAY['status','closed_at','updated_at'] FROM plugin_data.csf_opportunities a WHERE id=(SELECT id FROM restore_fixture)),(SELECT to_jsonb(a)-ARRAY['status','closed_at','updated_at'] FROM original_activity a),'restoration preserves all other activity data');

SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE target_id=(SELECT id FROM restore_fixture) AND reason_code='activity_restored'),1,'restoration creates one audited receipt');

SELECT extensions.is((SELECT before_data->>'status' FROM plugin_data.csf_admin_audit_events WHERE target_id=(SELECT id FROM restore_fixture) AND reason_code='activity_restored'),'closed','the audit preserves the old status');

SELECT extensions.is((SELECT after_data->>'status' FROM plugin_data.csf_admin_audit_events WHERE target_id=(SELECT id FROM restore_fixture) AND reason_code='activity_restored'),'published','the audit records the restored status');

SELECT extensions.results_eq($q$SELECT to_jsonb(e) FROM plugin_data.csf_publication_events e WHERE source_id=(SELECT id FROM restore_fixture)$q$,$q$SELECT data FROM original_events$q$,'restoration leaves publication and email receipts unchanged');

SELECT extensions.results_eq($q$SELECT to_jsonb(d) FROM plugin_data.csf_publication_notification_deliveries d WHERE event_id IN(SELECT id FROM plugin_data.csf_publication_events WHERE source_id=(SELECT id FROM restore_fixture))$q$,$q$SELECT data FROM original_notices$q$,'restoration creates no new notification deliveries');

SET LOCAL ROLE service_role;

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_set_activity_status_with_email('b8100000-0000-4000-8000-000000000001',(SELECT id FROM restore_fixture),'restored',NULL,'b8000000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000004',false,NULL)$q$,'P0001','Only closed activities can be restored.','a fresh request cannot restore an already published row');

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_set_activity_status_with_email('b8100000-0000-4000-8000-000000000001',(SELECT id FROM restore_fixture),'published',NULL,'b8000000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000005',false,NULL)$q$,'P0001','Only draft activities can be published.','restoration does not weaken duplicate publication guard');

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_set_activity_status_with_email('b8100000-0000-4000-8000-000000000001',(SELECT id FROM restore_fixture),'archived',NULL,'b8000000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000003',false,NULL)$q$,'P0001','That activity request identifier is already bound to a different change.','a restore receipt cannot be reused for another transition');

SELECT plugin_data.csf_set_activity_status_with_email('b8100000-0000-4000-8000-000000000001',(SELECT id FROM restore_fixture),'archived',NULL,'b8000000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000006',false,NULL);

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_set_activity_status_with_email('b8100000-0000-4000-8000-000000000001',(SELECT id FROM restore_fixture),'restored',NULL,'b8000000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000007',false,NULL)$q$,'P0001','Archived activities cannot be changed.','archived rows cannot be restored');

RESET ROLE;

INSERT INTO plugin_data.csf_cohorts (id,organization_id,graduation_year,label) VALUES ('b8400000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000001',2041,'Class of 2041');
INSERT INTO plugin_data.csf_profiles (id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name) VALUES ('b8500000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000001','Fictional','Member','fictional','member');
INSERT INTO plugin_data.csf_term_memberships (organization_id,profile_id,term_id,cohort_id,status) VALUES ('b8100000-0000-4000-8000-000000000001','b8500000-0000-4000-8000-000000000001','b8200000-0000-4000-8000-000000000001','b8400000-0000-4000-8000-000000000001','active');
INSERT INTO plugin_data.csf_term_policies (organization_id,term_id,policy_version,dues_required,total_points_required,max_drive_points,max_points_per_activity,required_meetings,allowed_absences) VALUES ('b8100000-0000-4000-8000-000000000001','b8200000-0000-4000-8000-000000000001',1,false,0,0,3,0,0);
UPDATE restore_fixture SET id=(plugin_data.csf_create_activity('b8100000-0000-4000-8000-000000000001','b8200000-0000-4000-8000-000000000001',NULL,'{"title":"Fictional locked-term activity","status":"published","signupMode":"none","pointValue":2}'::jsonb,'b8000000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000009')->>'activityId')::uuid;
SELECT plugin_data.csf_set_activity_status_with_email('b8100000-0000-4000-8000-000000000001',(SELECT id FROM restore_fixture),'closed',NULL,'b8000000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000010',false,NULL);
SELECT plugin_data.csf_close_term_v2('b8100000-0000-4000-8000-000000000001','b8200000-0000-4000-8000-000000000001',1,plugin_data.csf_term_closure_readiness('b8100000-0000-4000-8000-000000000001','b8200000-0000-4000-8000-000000000001')->>'evidenceHash','b8000000-0000-4000-8000-000000000001');
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_set_activity_status_with_email('b8100000-0000-4000-8000-000000000001',(SELECT id FROM restore_fixture),'restored',NULL,'b8000000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000011',false,NULL)$q$,'P0001','Activities cannot be published in a closed or archived semester.','a locked semester blocks restoration');
RESET ROLE;

SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_set_activity_status_with_email(uuid,uuid,text,text,uuid,uuid,boolean,jsonb)','EXECUTE'),'browser callers cannot restore directly');

SELECT extensions.ok(NOT has_function_privilege('anon','plugin_data.csf_set_activity_status_with_email(uuid,uuid,text,text,uuid,uuid,boolean,jsonb)','EXECUTE'),'anonymous callers cannot restore');

SELECT extensions.ok(NOT has_function_privilege('service_role','plugin_data.csf_set_activity_status_locked_impl(uuid,uuid,text,text,uuid,uuid)','EXECUTE'),'server callers cannot bypass the authorization wrapper');

SELECT * FROM extensions.finish();

ROLLBACK;
