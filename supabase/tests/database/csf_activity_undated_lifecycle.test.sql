BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(18);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'b7000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'activity-optional-start@local.test',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'b7100000-0000-4000-8000-000000000001',
  'Undated activity update fixture',
  'undated-activity-update-fixture',
  'school',
  '507507'
);

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES (
  'b7100000-0000-4000-8000-000000000001',
  'b7000000-0000-4000-8000-000000000001',
  'admin',
  'active'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  lifecycle_status, is_current
) VALUES (
  'b7200000-0000-4000-8000-000000000001',
  'b7100000-0000-4000-8000-000000000001',
  'F40',
  'Fall 2040',
  '2040-2041',
  'fall',
  'open',
  true
);


CREATE TEMP TABLE activity_ids (kind text, id uuid);
INSERT INTO activity_ids SELECT 'published', (plugin_data.csf_create_activity('b7100000-0000-4000-8000-000000000001','b7200000-0000-4000-8000-000000000001',NULL,'{"title":"Undated published","status":"published","signupMode":"none","pointValue":1}','b7000000-0000-4000-8000-000000000001','b7300000-0000-4000-8000-000000000001')->>'activityId')::uuid;
INSERT INTO activity_ids SELECT 'draft', (plugin_data.csf_create_activity('b7100000-0000-4000-8000-000000000001','b7200000-0000-4000-8000-000000000001',NULL,'{"title":"Undated draft","status":"draft","signupMode":"none","pointValue":1}','b7000000-0000-4000-8000-000000000001','b7300000-0000-4000-8000-000000000002')->>'activityId')::uuid;
GRANT SELECT ON activity_ids TO service_role;
SELECT extensions.ok(NOT EXISTS (SELECT 1 FROM unnest(ARRAY['plugin_data.csf_update_activity_locked_impl(uuid,uuid,uuid,uuid,jsonb,uuid,uuid)','plugin_data.csf_set_activity_status_locked_impl(uuid,uuid,text,text,uuid,uuid)']) signature CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) role_name WHERE has_function_privilege(role_name,signature,'EXECUTE')), 'both implementation functions remain owner-only');
SET LOCAL ROLE service_role;
SELECT extensions.lives_ok($q$SELECT plugin_data.csf_update_activity('b7100000-0000-4000-8000-000000000001',(SELECT id FROM activity_ids WHERE kind='published'),'b7200000-0000-4000-8000-000000000001',NULL,'{"title":"Updated undated activity","signupMode":"none","pointValue":1}'::jsonb,'b7000000-0000-4000-8000-000000000001','b7300000-0000-4000-8000-000000000003')$q$,'editing an undated published activity succeeds');
SELECT extensions.lives_ok($q$SELECT plugin_data.csf_update_activity('b7100000-0000-4000-8000-000000000001',(SELECT id FROM activity_ids WHERE kind='published'),'b7200000-0000-4000-8000-000000000001',NULL,'{"title":"Updated undated activity","signupMode":"none","pointValue":1}'::jsonb,'b7000000-0000-4000-8000-000000000001','b7300000-0000-4000-8000-000000000003')$q$,'replaying the identical edit succeeds');
RESET ROLE;
SELECT extensions.ok((SELECT title='Updated undated activity' AND status='published' AND starts_at IS NULL AND ends_at IS NULL FROM plugin_data.csf_opportunities WHERE id=(SELECT id FROM activity_ids WHERE kind='published')),'edit keeps published state and absent dates');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE organization_id='b7100000-0000-4000-8000-000000000001' AND action='activity.update'),1,'edit retry retains one audit receipt');
SET LOCAL ROLE service_role;
SELECT extensions.lives_ok($q$SELECT plugin_data.csf_set_activity_status('b7100000-0000-4000-8000-000000000001',(SELECT id FROM activity_ids WHERE kind='draft'),'published','Fictional lifecycle review','b7000000-0000-4000-8000-000000000001','b7300000-0000-4000-8000-000000000004')$q$,'publishing an undated draft succeeds');
SELECT extensions.lives_ok($q$SELECT plugin_data.csf_set_activity_status('b7100000-0000-4000-8000-000000000001',(SELECT id FROM activity_ids WHERE kind='draft'),'published','Fictional lifecycle review','b7000000-0000-4000-8000-000000000001','b7300000-0000-4000-8000-000000000004')$q$,'replaying the identical publication succeeds');
RESET ROLE;
SELECT extensions.ok((SELECT status='published' AND starts_at IS NULL AND ends_at IS NULL AND published_at IS NOT NULL FROM plugin_data.csf_opportunities WHERE id=(SELECT id FROM activity_ids WHERE kind='draft')),'undated publication records publication time');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE organization_id='b7100000-0000-4000-8000-000000000001' AND action='activity.status_change'),1,'publication retry retains one audit receipt');
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_update_activity('b7100000-0000-4000-8000-000000000001',(SELECT id FROM activity_ids WHERE kind='published'),'b7200000-0000-4000-8000-000000000001',NULL,'{"title":"Updated undated activity","signupMode":"none","pointValue":1,"endsAt":"2040-09-15T17:00:00Z"}'::jsonb,'b7000000-0000-4000-8000-000000000001','b7300000-0000-4000-8000-000000000005')$q$,'P0001','Add a start before giving the activity an end time.','editing with only an end remains blocked');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_update_activity('b7100000-0000-4000-8000-000000000001',(SELECT id FROM activity_ids WHERE kind='published'),'b7200000-0000-4000-8000-000000000001',NULL,'{"title":"Updated undated activity","signupMode":"none","pointValue":1,"startsAt":"2040-09-15T17:00:00Z","endsAt":"2040-09-14T17:00:00Z"}'::jsonb,'b7000000-0000-4000-8000-000000000001','b7300000-0000-4000-8000-000000000006')$q$,'P0001','The activity end time must be after its start time.','backwards edit dates remain blocked');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_update_activity('b7100000-0000-4000-8000-000000000001',(SELECT id FROM activity_ids WHERE kind='published'),'b7200000-0000-4000-8000-000000000001',NULL,'{"title":"Updated undated activity","signupMode":"none","pointValue":1,"startsAt":"not-a-date"}'::jsonb,'b7000000-0000-4000-8000-000000000001','b7300000-0000-4000-8000-000000000007')$q$,'22007','invalid input syntax for type timestamp with time zone: "not-a-date"','invalid edit date remains blocked');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_set_activity_status('b7100000-0000-4000-8000-000000000001',(SELECT id FROM activity_ids WHERE kind='draft'),'published','Fictional lifecycle review','b7000000-0000-4000-8000-000000000001','b7300000-0000-4000-8000-000000000008')$q$,'P0001','Only draft activities can be published.','publishing an already published row still requires draft state');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_update_activity('b7100000-0000-4000-8000-000000000001',(SELECT id FROM activity_ids WHERE kind='published'),'b7200000-0000-4000-8000-000000000001',NULL,'{"title":"Updated undated activity","signupMode":"none","pointValue":1}'::jsonb,'b7000000-0000-4000-8000-000000000099','b7300000-0000-4000-8000-000000000009')$q$,'P0001','Not authorized to manage CSF activities.','undated edits retain actor authorization');
SELECT extensions.lives_ok($q$SELECT plugin_data.csf_set_activity_status('b7100000-0000-4000-8000-000000000001',(SELECT id FROM activity_ids WHERE kind='published'),'closed','Fictional lifecycle review','b7000000-0000-4000-8000-000000000001','b7300000-0000-4000-8000-000000000010')$q$,'undated published activity may close');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_update_activity('b7100000-0000-4000-8000-000000000001',(SELECT id FROM activity_ids WHERE kind='published'),'b7200000-0000-4000-8000-000000000001',NULL,'{"title":"Updated undated activity","signupMode":"none","pointValue":1}'::jsonb,'b7000000-0000-4000-8000-000000000001','b7300000-0000-4000-8000-000000000011')$q$,'P0001','Closed, cancelled, or archived activities cannot be edited.','closed activities remain immutable through edit');
RESET ROLE;
UPDATE plugin_data.csf_opportunities SET status='draft',starts_at=NULL,ends_at='2040-09-15T17:00:00Z' WHERE id=(SELECT id FROM activity_ids WHERE kind='draft');
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_set_activity_status('b7100000-0000-4000-8000-000000000001',(SELECT id FROM activity_ids WHERE kind='draft'),'published','Fictional lifecycle review','b7000000-0000-4000-8000-000000000001','b7300000-0000-4000-8000-000000000012')$q$,'P0001','Add a start before giving the activity an end time.','legacy end-only draft cannot publish');
RESET ROLE;
UPDATE plugin_data.csf_opportunities SET ends_at=NULL,term_id=NULL WHERE id=(SELECT id FROM activity_ids WHERE kind='draft');
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_set_activity_status('b7100000-0000-4000-8000-000000000001',(SELECT id FROM activity_ids WHERE kind='draft'),'published','Fictional lifecycle review','b7000000-0000-4000-8000-000000000001','b7300000-0000-4000-8000-000000000013')$q$,'P0001','A semester is required before publishing.','an undated draft still needs a semester');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
