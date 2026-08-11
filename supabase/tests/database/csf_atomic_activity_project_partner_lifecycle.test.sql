BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(34);

SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_create_activity(uuid,uuid,uuid,jsonb,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_update_activity(uuid,uuid,uuid,uuid,jsonb,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_set_activity_status(uuid,uuid,text,text,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_link_activity_project(uuid,uuid,uuid,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_set_partner_club_status(uuid,uuid,text,uuid,uuid)') IS NOT NULL,
  'all five atomic lifecycle operations exist'
);
SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_create_activity(uuid,uuid,uuid,jsonb,uuid)') IS NULL
    AND to_regprocedure('plugin_data.csf_update_activity(uuid,uuid,uuid,uuid,jsonb,uuid)') IS NULL
    AND to_regprocedure('plugin_data.csf_set_activity_status(uuid,uuid,text,text,uuid)') IS NULL,
  'the bypassable activity overloads no longer exist'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'plugin_data.csf_create_activity(uuid,uuid,uuid,jsonb,uuid,uuid)',
      'plugin_data.csf_update_activity(uuid,uuid,uuid,uuid,jsonb,uuid,uuid)',
      'plugin_data.csf_set_activity_status(uuid,uuid,text,text,uuid,uuid)',
      'plugin_data.csf_link_activity_project(uuid,uuid,uuid,uuid,uuid)',
      'plugin_data.csf_set_partner_club_status(uuid,uuid,text,uuid,uuid)'
    ]) AS operation(signature)
    CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated']) AS client(role_name)
    WHERE has_function_privilege(client.role_name::name, operation.signature, 'EXECUTE')
  ),
  'no client role can invoke the lifecycle mutations'
);
SELECT extensions.ok(
  (
    SELECT bool_and(has_function_privilege('service_role', operation.signature, 'EXECUTE'))
    FROM unnest(ARRAY[
      'plugin_data.csf_create_activity(uuid,uuid,uuid,jsonb,uuid,uuid)',
      'plugin_data.csf_update_activity(uuid,uuid,uuid,uuid,jsonb,uuid,uuid)',
      'plugin_data.csf_set_activity_status(uuid,uuid,text,text,uuid,uuid)',
      'plugin_data.csf_link_activity_project(uuid,uuid,uuid,uuid,uuid)',
      'plugin_data.csf_set_partner_club_status(uuid,uuid,text,uuid,uuid)'
    ]) AS operation(signature)
  ),
  'service_role can invoke each atomic lifecycle mutation'
);
SELECT extensions.ok(
  (
    SELECT bool_and(proc.prosecdef AND proc.proconfig @> ARRAY['search_path=""']::text[])
    FROM pg_proc AS proc
    WHERE proc.oid IN (
      'plugin_data.csf_create_activity(uuid,uuid,uuid,jsonb,uuid,uuid)'::regprocedure,
      'plugin_data.csf_update_activity(uuid,uuid,uuid,uuid,jsonb,uuid,uuid)'::regprocedure,
      'plugin_data.csf_set_activity_status(uuid,uuid,text,text,uuid,uuid)'::regprocedure,
      'plugin_data.csf_link_activity_project(uuid,uuid,uuid,uuid,uuid)'::regprocedure,
      'plugin_data.csf_set_partner_club_status(uuid,uuid,text,uuid,uuid)'::regprocedure
    )
  ),
  'every lifecycle operation is SECURITY DEFINER with an empty search path'
);
SELECT extensions.ok(
  pg_get_functiondef('plugin_data.csf_create_activity(uuid,uuid,uuid,jsonb,uuid,uuid)'::regprocedure)
    LIKE '%csf_actor_has_permission%manage_opportunities%'
  AND pg_get_functiondef('plugin_data.csf_set_partner_club_status(uuid,uuid,text,uuid,uuid)'::regprocedure)
    LIKE '%csf_actor_has_permission%manage_partner_clubs%',
  'the database rechecks the exact activity and partner-club permissions'
);

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
INSERT INTO plugin_data.csf_partner_clubs (id, organization_id, name, status, created_by)
VALUES
  ('fc600000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001', 'Local Club', 'active', 'fc000000-0000-4000-8000-000000000001'),
  ('fc600000-0000-4000-8000-000000000002', 'fc100000-0000-4000-8000-000000000002', 'Other Club', 'active', 'fc000000-0000-4000-8000-000000000003');

CREATE TEMP TABLE csf_atomic_lifecycle_results (kind text PRIMARY KEY, payload jsonb NOT NULL) ON COMMIT DROP;

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_create_activity(
    'fc100000-0000-4000-8000-000000000001', 'fc200000-0000-4000-8000-000000000001', NULL,
    '{"title":"Unauthorized","startsAt":"2040-09-10T17:00:00Z","status":"draft"}'::jsonb,
    'fc000000-0000-4000-8000-000000000002', 'fc900000-0000-4000-8000-000000000001'
  )$$,
  'P0001', 'Not authorized to manage CSF activities.',
  'an account without activity permission cannot create an activity'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_create_activity(
    'fc100000-0000-4000-8000-000000000001', 'fc200000-0000-4000-8000-000000000002', NULL,
    '{"title":"Wrong term","startsAt":"2040-09-10T17:00:00Z","status":"draft"}'::jsonb,
    'fc000000-0000-4000-8000-000000000001', 'fc900000-0000-4000-8000-000000000002'
  )$$,
  'P0001', 'CSF semester was not found in this organization.',
  'activity creation rejects a semester from another organization'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_create_activity(
    'fc100000-0000-4000-8000-000000000001', 'fc200000-0000-4000-8000-000000000001', 'fc300000-0000-4000-8000-000000000001',
    '{"title":"Wrong project","startsAt":"2040-09-10T17:00:00Z","status":"draft","signupMode":"lets_assist_project","linkedProjectId":"fc400000-0000-4000-8000-000000000002"}'::jsonb,
    'fc000000-0000-4000-8000-000000000001', 'fc900000-0000-4000-8000-000000000003'
  )$$,
  'P0001', 'Linked project was not found in this organization.',
  'activity creation rejects a linked project from another organization'
);
SELECT extensions.lives_ok(
  $$INSERT INTO csf_atomic_lifecycle_results (kind, payload)
    SELECT 'create', plugin_data.csf_create_activity(
      'fc100000-0000-4000-8000-000000000001', 'fc200000-0000-4000-8000-000000000001', 'fc300000-0000-4000-8000-000000000001',
      '{"title":"Library sorting","body":"Sort books","startsAt":"2040-09-10T17:00:00Z","endsAt":"2040-09-10T19:00:00Z","status":"draft","signupMode":"lets_assist_project","linkedProjectId":"fc400000-0000-4000-8000-000000000001","pointType":"non_drive","pointValue":2,"requiresPointSubmission":true,"evidencePolicy":"required"}'::jsonb,
      'fc000000-0000-4000-8000-000000000001', 'fc900000-0000-4000-8000-000000000004'
    )$$,
  'an authorized manager atomically creates an activity'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_opportunities AS activity
    JOIN csf_atomic_lifecycle_results AS result ON result.kind = 'create'
    WHERE activity.id = (result.payload ->> 'activityId')::uuid
      AND activity.organization_id = 'fc100000-0000-4000-8000-000000000001'
      AND activity.linked_project_id = 'fc400000-0000-4000-8000-000000000001'
      AND activity.signup_url = '/projects/fc400000-0000-4000-8000-000000000001'
  ),
  'activity creation writes the exact tenant and canonical project link'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fc900000-0000-4000-8000-000000000004'),
  1, 'activity creation writes one immutable audit receipt'
);
SELECT extensions.is(
  (plugin_data.csf_create_activity(
    'fc100000-0000-4000-8000-000000000001', 'fc200000-0000-4000-8000-000000000001', 'fc300000-0000-4000-8000-000000000001',
    '{"title":"Library sorting","body":"Sort books","startsAt":"2040-09-10T17:00:00Z","endsAt":"2040-09-10T19:00:00Z","status":"draft","signupMode":"lets_assist_project","linkedProjectId":"fc400000-0000-4000-8000-000000000001","pointType":"non_drive","pointValue":2,"requiresPointSubmission":true,"evidencePolicy":"required"}'::jsonb,
    'fc000000-0000-4000-8000-000000000001', 'fc900000-0000-4000-8000-000000000004'
  ) ->> 'idempotent'),
  'true', 'an exact activity-create replay returns the committed result'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_opportunities WHERE organization_id = 'fc100000-0000-4000-8000-000000000001' AND title = 'Library sorting'),
  1, 'create replay cannot duplicate the activity'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_create_activity(
    'fc100000-0000-4000-8000-000000000001', 'fc200000-0000-4000-8000-000000000001', NULL,
    '{"title":"Changed payload","startsAt":"2040-09-10T17:00:00Z","status":"draft"}'::jsonb,
    'fc000000-0000-4000-8000-000000000001', 'fc900000-0000-4000-8000-000000000004'
  )$$,
  'P0001', 'That activity request identifier is already bound to a different change.',
  'an activity request identifier cannot be reused for changed content'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_update_activity(
    'fc100000-0000-4000-8000-000000000001', 'fc500000-0000-4000-8000-000000000002', 'fc200000-0000-4000-8000-000000000001', NULL,
    '{"title":"Cross tenant update","startsAt":"2040-09-10T17:00:00Z","signupMode":"none"}'::jsonb,
    'fc000000-0000-4000-8000-000000000001', 'fc900000-0000-4000-8000-000000000005'
  )$$,
  'P0001', 'CSF activity was not found in this organization.',
  'activity update rejects an activity from another organization'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_set_activity_status(
    'fc100000-0000-4000-8000-000000000001', 'fc500000-0000-4000-8000-000000000002', 'published', NULL,
    'fc000000-0000-4000-8000-000000000001', 'fc900000-0000-4000-8000-000000000006'
  )$$,
  'P0001', 'CSF activity was not found in this organization.',
  'activity status rejects an activity from another organization'
);
SELECT extensions.lives_ok(
  $$INSERT INTO csf_atomic_lifecycle_results (kind, payload)
    SELECT 'status', plugin_data.csf_set_activity_status(
      'fc100000-0000-4000-8000-000000000001', 'fc500000-0000-4000-8000-000000000001', 'published', NULL,
      'fc000000-0000-4000-8000-000000000001', 'fc900000-0000-4000-8000-000000000007'
    )$$,
  'an authorized manager atomically publishes an activity'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_opportunities WHERE id = 'fc500000-0000-4000-8000-000000000001'),
  'published', 'activity status changes in the exact organization'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fc900000-0000-4000-8000-000000000007'),
  1, 'activity status writes one correlated receipt'
);
SELECT extensions.is(
  (plugin_data.csf_set_activity_status(
    'fc100000-0000-4000-8000-000000000001', 'fc500000-0000-4000-8000-000000000001', 'published', NULL,
    'fc000000-0000-4000-8000-000000000001', 'fc900000-0000-4000-8000-000000000007'
  ) ->> 'idempotent'),
  'true', 'an exact activity-status replay returns the committed result'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_link_activity_project(
    'fc100000-0000-4000-8000-000000000001', 'fc500000-0000-4000-8000-000000000001', 'fc400000-0000-4000-8000-000000000002',
    'fc000000-0000-4000-8000-000000000001', 'fc900000-0000-4000-8000-000000000008'
  )$$,
  'P0001', 'Linked project was not found in this organization.',
  'project linking rejects a public project from another organization'
);
SELECT extensions.lives_ok(
  $$INSERT INTO csf_atomic_lifecycle_results (kind, payload)
    SELECT 'link', plugin_data.csf_link_activity_project(
      'fc100000-0000-4000-8000-000000000001', 'fc500000-0000-4000-8000-000000000001', 'fc400000-0000-4000-8000-000000000001',
      'fc000000-0000-4000-8000-000000000001', 'fc900000-0000-4000-8000-000000000009'
    )$$,
  'an authorized manager atomically links an exact-tenant project'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_opportunities
    WHERE id = 'fc500000-0000-4000-8000-000000000001'
      AND organization_id = 'fc100000-0000-4000-8000-000000000001'
      AND linked_project_id = 'fc400000-0000-4000-8000-000000000001'
      AND signup_mode = 'lets_assist_project'
  ),
  'project linking changes the exact activity and canonical signup source'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fc900000-0000-4000-8000-000000000009'),
  1, 'project linking writes one correlated receipt'
);
SELECT extensions.is(
  (plugin_data.csf_link_activity_project(
    'fc100000-0000-4000-8000-000000000001', 'fc500000-0000-4000-8000-000000000001', 'fc400000-0000-4000-8000-000000000001',
    'fc000000-0000-4000-8000-000000000001', 'fc900000-0000-4000-8000-000000000009'
  ) ->> 'idempotent'),
  'true', 'an exact project-link replay returns the committed result'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_set_partner_club_status(
    'fc100000-0000-4000-8000-000000000001', 'fc600000-0000-4000-8000-000000000001', 'archived',
    'fc000000-0000-4000-8000-000000000002', 'fc900000-0000-4000-8000-000000000010'
  )$$,
  'P0001', 'Not authorized to manage CSF partner clubs.',
  'an account without partner permission cannot archive a club'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_set_partner_club_status(
    'fc100000-0000-4000-8000-000000000001', 'fc600000-0000-4000-8000-000000000002', 'archived',
    'fc000000-0000-4000-8000-000000000001', 'fc900000-0000-4000-8000-000000000011'
  )$$,
  'P0001', 'Partner club was not found in this organization.',
  'partner archive rejects a club from another organization'
);
SELECT extensions.lives_ok(
  $$INSERT INTO csf_atomic_lifecycle_results (kind, payload)
    SELECT 'partner', plugin_data.csf_set_partner_club_status(
      'fc100000-0000-4000-8000-000000000001', 'fc600000-0000-4000-8000-000000000001', 'archived',
      'fc000000-0000-4000-8000-000000000001', 'fc900000-0000-4000-8000-000000000012'
    )$$,
  'an authorized manager atomically archives a partner club'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_partner_clubs WHERE id = 'fc600000-0000-4000-8000-000000000001'),
  'archived', 'partner archive changes the exact organization-scoped row'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fc900000-0000-4000-8000-000000000012'),
  1, 'partner archive writes one correlated immutable receipt'
);
SELECT extensions.is(
  (plugin_data.csf_set_partner_club_status(
    'fc100000-0000-4000-8000-000000000001', 'fc600000-0000-4000-8000-000000000001', 'archived',
    'fc000000-0000-4000-8000-000000000001', 'fc900000-0000-4000-8000-000000000012'
  ) ->> 'idempotent'),
  'true', 'an exact partner archive replay returns the committed result'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_set_partner_club_status(
    'fc100000-0000-4000-8000-000000000001', 'fc600000-0000-4000-8000-000000000001', 'active',
    'fc000000-0000-4000-8000-000000000001', 'fc900000-0000-4000-8000-000000000012'
  )$$,
  'P0001', 'That partner-club request identifier is already bound to a different change.',
  'a partner request identifier cannot be reused for another status'
);
SELECT extensions.throws_ok(
  $$UPDATE plugin_data.csf_admin_audit_events
    SET action = 'tampered'
    WHERE correlation_id = 'fc900000-0000-4000-8000-000000000012'$$,
  'P0001', 'CSF audit events are immutable.',
  'the partner lifecycle receipt remains immutable after commit'
);

SELECT * FROM extensions.finish();
ROLLBACK;
