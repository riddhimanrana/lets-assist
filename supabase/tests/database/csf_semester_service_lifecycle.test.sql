BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(57);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_update_term_policy_v2(uuid,uuid,numeric,numeric,numeric,integer,integer,boolean,jsonb,boolean,numeric,text,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot version CSF semester policy'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_update_term_policy_v2(uuid,uuid,numeric,numeric,numeric,integer,integer,boolean,jsonb,boolean,numeric,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot version CSF semester policy'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_update_term_policy_v2(uuid,uuid,numeric,numeric,numeric,integer,integer,boolean,jsonb,boolean,numeric,text,uuid)',
    'EXECUTE'
  ),
  'the server role cannot bypass draft publication through the complete legacy policy function'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_create_activity(uuid,uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot create CSF activities'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_create_activity(uuid,uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot create CSF activities'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_create_activity(uuid,uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ),
  'the server role can create CSF activities'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_update_activity(uuid,uuid,uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot edit CSF activities'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_update_activity(uuid,uuid,uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot edit CSF activities'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_update_activity(uuid,uuid,uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ),
  'the server role can edit CSF activities'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_set_activity_status(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot change CSF activity status'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_set_activity_status(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot change CSF activity status'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_set_activity_status(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'the server role can change CSF activity status'
);
SELECT extensions.ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'plugin_data.csf_opportunities'::regclass
  )
  AND NOT has_table_privilege('authenticated', 'plugin_data.csf_opportunities', 'SELECT'),
  'CSF activities keep their server-only RLS and grant boundary'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'ce000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'semester-service-officer@local.test',
  now(),
  '{}',
  '{}',
  now(),
  now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'ce100000-0000-4000-8000-000000000001',
    'CSF Semester Service A',
    'csf-semester-service-a',
    'school',
    '985001'
  ),
  (
    'ce100000-0000-4000-8000-000000000002',
    'CSF Semester Service B',
    'csf-semester-service-b',
    'school',
    '985002'
  );

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, starts_at, ends_at, lifecycle_status
) VALUES
  (
    'ce200000-0000-4000-8000-000000000001',
    'ce100000-0000-4000-8000-000000000001',
    'F28', 'Fall 2028', '2028-2029', 'fall', '2028-08-15', '2028-12-20', 'open'
  ),
  (
    'ce200000-0000-4000-8000-000000000002',
    'ce100000-0000-4000-8000-000000000002',
    'F28', 'Fall 2028', '2028-2029', 'fall', '2028-08-15', '2028-12-20', 'open'
  );

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES
  (
    'ce300000-0000-4000-8000-000000000001',
    'ce100000-0000-4000-8000-000000000001',
    2030, 'Class of 2030'
  ),
  (
    'ce300000-0000-4000-8000-000000000002',
    'ce100000-0000-4000-8000-000000000002',
    2030, 'Class of 2030'
  );

INSERT INTO plugin_data.csf_term_policies (
  id,
  organization_id,
  term_id,
  policy_version,
  total_points_required,
  max_drive_points,
  max_points_per_activity,
  required_meetings,
  allowed_absences,
  allow_point_carryover,
  academic_rules,
  dues_required,
  dues_amount,
  dues_currency,
  created_by,
  updated_by
) VALUES (
  'ce400000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  'ce200000-0000-4000-8000-000000000001',
  1,
  7,
  2,
  3,
  3,
  1,
  false,
  '{"minimumListI":4,"minimumListIAndII":7,"minimumTotal":10,"maximumCourses":5,"honorsApBonusLimit":2,"disqualifyingGrades":["D","F"]}'::jsonb,
  true,
  5,
  'USD',
  'ce000000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000001'
);

CREATE TEMP TABLE csf_semester_service_results (
  kind text PRIMARY KEY,
  payload jsonb NOT NULL
) ON COMMIT DROP;

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_semester_service_results (kind, payload)
    SELECT 'policy-v2', plugin_data.csf_update_term_policy_v2(
      'ce100000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      8,
      2,
      4,
      4,
      1,
      false,
      '{"minimumListI":4,"minimumListIAndII":7,"minimumTotal":10,"maximumCourses":5,"honorsApBonusLimit":2,"disqualifyingGrades":["D","F"]}'::jsonb,
      true,
      7,
      'USD',
      'ce000000-0000-4000-8000-000000000001'
    )
  $$,
  'the complete semester policy is updated atomically'
);
SELECT extensions.ok(
  (
    SELECT policy_version = 2
      AND total_points_required = 8
      AND max_drive_points = 2
      AND max_points_per_activity = 4
      AND required_meetings = 4
      AND allowed_absences = 1
      AND allow_point_carryover = false
      AND academic_rules->>'minimumTotal' = '10'
      AND dues_required
      AND dues_amount = 7
      AND dues_currency = 'USD'
    FROM plugin_data.csf_term_policies
    WHERE id = 'ce400000-0000-4000-8000-000000000001'
  ),
  'the versioned row contains academic, dues, service, drive, and meeting policy'
);
SELECT extensions.ok(
  (
    SELECT (before_data->>'policy_version')::integer = 1
      AND (before_data->>'dues_amount')::numeric = 5
      AND (after_data->>'policy_version')::integer = 2
      AND (after_data->>'total_points_required')::numeric = 8
      AND (after_data->>'dues_amount')::numeric = 7
      AND reason_code = 'semester_policy_versioned'
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND action = 'term_policy.update'
  ),
  'the policy audit event records exact before and after snapshots'
);
SELECT extensions.ok(
  (
    SELECT result.payload->>'correlationId' = event.correlation_id::text
    FROM csf_semester_service_results AS result
    JOIN plugin_data.csf_admin_audit_events AS event
      ON event.organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND event.action = 'term_policy.update'
    WHERE result.kind = 'policy-v2'
  ),
  'the policy result and immutable audit event share one correlation ID'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_semester_service_results (kind, payload)
    SELECT 'policy-v3', plugin_data.csf_update_term_policy_v2(
      'ce100000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      9,
      3,
      4,
      5,
      1,
      true,
      '{"minimumListI":4,"minimumListIAndII":7,"minimumTotal":10,"maximumCourses":5,"honorsApBonusLimit":2,"disqualifyingGrades":["D","F"]}'::jsonb,
      false,
      0,
      'USD',
      'ce000000-0000-4000-8000-000000000001'
    )
  $$,
  'a second semester policy update succeeds'
);
SELECT extensions.ok(
  (
    SELECT policy_version = 3
      AND total_points_required = 9
      AND max_drive_points = 3
      AND required_meetings = 5
      AND allow_point_carryover
      AND dues_required = false
      AND dues_amount = 0
    FROM plugin_data.csf_term_policies
    WHERE id = 'ce400000-0000-4000-8000-000000000001'
  ),
  'each policy save increments from the locked database version'
);
SELECT extensions.ok(
  (
    SELECT count(*) = 2 AND count(DISTINCT correlation_id) = 2
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND action = 'term_policy.update'
  ),
  'each successful policy version has one distinct audit event'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_term_policy_v2(
      'ce100000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      9, 3, 4, 5, 1, true,
      '{"minimumListI":4,"minimumListIAndII":7,"minimumTotal":10,"maximumCourses":0,"disqualifyingGrades":["D","F"]}'::jsonb,
      false, 0, 'USD',
      'ce000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Academic rules are incomplete or invalid.',
  'an invalid academic rule snapshot is rejected'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_term_policy_v2(
      'ce100000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000002',
      9, 3, 4, 5, 1, true,
      '{"minimumListI":4,"minimumListIAndII":7,"minimumTotal":10,"maximumCourses":5,"disqualifyingGrades":["D","F"]}'::jsonb,
      false, 0, 'USD',
      'ce000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'CSF semester not found.',
  'policy updates cannot address another organization semester'
);
SELECT extensions.ok(
  (
    SELECT policy_version = 3
      AND (
        SELECT count(*)
        FROM plugin_data.csf_admin_audit_events
        WHERE organization_id = policy.organization_id
          AND action = 'term_policy.update'
          AND term_id = policy.term_id
      ) = 2
    FROM plugin_data.csf_term_policies AS policy
    WHERE policy.id = 'ce400000-0000-4000-8000-000000000001'
  ),
  'rejected policy updates change neither the version nor audit history'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_semester_service_results (kind, payload)
    SELECT 'activity-draft', plugin_data.csf_create_activity(
      'ce100000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      'ce300000-0000-4000-8000-000000000001',
      jsonb_build_object(
        'status', 'draft',
        'title', 'Campus cleanup',
        'body', 'Clean the campus after school.',
        'startsAt', '2028-09-14T22:00:00Z',
        'endsAt', '2028-09-15T00:00:00Z',
        'location', 'DVHS Commons',
        'signupMode', 'external',
        'signupUrl', 'https://example.test/csf-cleanup',
        'pointValue', 1.5,
        'pointType', 'non_drive',
        'pointCap', 3,
        'requiresPointSubmission', true,
        'evidencePolicy', 'required'
      ),
      'ce000000-0000-4000-8000-000000000001'
    )
  $$,
  'an officer can create a structured draft activity'
);
SELECT extensions.ok(
  (
    SELECT activity.organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND activity.term_id = 'ce200000-0000-4000-8000-000000000001'
      AND activity.cohort_id = 'ce300000-0000-4000-8000-000000000001'
      AND activity.status = 'draft'
      AND activity.point_value = 1.5
      AND activity.point_type = 'non_drive'
      AND activity.point_cap = 3
      AND activity.requires_point_submission
    FROM plugin_data.csf_opportunities AS activity
    JOIN csf_semester_service_results AS result
      ON activity.id = (result.payload->>'activityId')::uuid
    WHERE result.kind = 'activity-draft'
  ),
  'the draft is scoped to its organization, semester, and optional class audience'
);
SELECT extensions.ok(
  (
    SELECT result.payload->>'correlationId' = event.correlation_id::text
      AND event.reason_code = 'activity_created'
      AND event.after_data->>'status' = 'draft'
    FROM csf_semester_service_results AS result
    JOIN plugin_data.csf_admin_audit_events AS event
      ON event.target_id = (result.payload->>'activityId')::uuid
      AND event.action = 'activity.create'
    WHERE result.kind = 'activity-draft'
  ),
  'activity creation commits a correlated audit event'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_semester_service_results (kind, payload)
    SELECT 'activity-updated', plugin_data.csf_update_activity(
      'ce100000-0000-4000-8000-000000000001',
      (payload->>'activityId')::uuid,
      'ce200000-0000-4000-8000-000000000001',
      'ce300000-0000-4000-8000-000000000001',
      jsonb_build_object(
        'title', 'Campus cleanup and garden care',
        'body', 'Clean the campus and tend the garden after school.',
        'startsAt', '2028-09-14T22:30:00Z',
        'endsAt', '2028-09-15T00:30:00Z',
        'location', 'DVHS Commons',
        'signupMode', 'external',
        'signupUrl', 'https://example.test/csf-cleanup-updated',
        'pointValue', 2,
        'pointType', 'non_drive',
        'pointCap', 3,
        'requiresPointSubmission', true,
        'evidencePolicy', 'required'
      ),
      'ce000000-0000-4000-8000-000000000001'
    )
    FROM csf_semester_service_results
    WHERE kind = 'activity-draft'
  $$,
  'an officer can edit an active activity before publication'
);
SELECT extensions.ok(
  (
    SELECT activity.title = 'Campus cleanup and garden care'
      AND activity.point_value = 2
      AND activity.starts_at = '2028-09-14T22:30:00Z'::timestamptz
      AND result.payload->>'correlationId' = event.correlation_id::text
      AND event.before_data->>'title' = 'Campus cleanup'
      AND event.after_data->>'title' = 'Campus cleanup and garden care'
      AND event.reason_code = 'activity_updated'
    FROM csf_semester_service_results AS result
    JOIN plugin_data.csf_opportunities AS activity
      ON activity.id = (result.payload->>'activityId')::uuid
    JOIN plugin_data.csf_admin_audit_events AS event
      ON event.target_id = activity.id
      AND event.action = 'activity.update'
    WHERE result.kind = 'activity-updated'
  ),
  'activity edits commit the normalized fields and correlated before/after audit together'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_activity(
      'ce100000-0000-4000-8000-000000000002',
      (payload->>'activityId')::uuid,
      'ce200000-0000-4000-8000-000000000002',
      NULL,
      '{"title":"Wrong tenant edit"}'::jsonb,
      'ce000000-0000-4000-8000-000000000001'
    )
    FROM csf_semester_service_results
    WHERE kind = 'activity-draft'
  $$,
  'P0001',
  'CSF activity not found.',
  'activity edits cannot address another organization activity'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_activity(
      'ce100000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000002',
      NULL,
      '{"status":"draft","title":"Wrong tenant term"}'::jsonb,
      'ce000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'CSF semester not found.',
  'an activity cannot use another organization semester'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_activity(
      'ce100000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      'ce300000-0000-4000-8000-000000000002',
      '{"status":"draft","title":"Wrong tenant class"}'::jsonb,
      'ce000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'CSF class audience not found.',
  'an activity cannot use another organization class audience'
);
SELECT extensions.ok(
  (
    SELECT count(*) = 1
      AND (
        SELECT count(*)
        FROM plugin_data.csf_admin_audit_events
        WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'
          AND action = 'activity.create'
      ) = 1
    FROM plugin_data.csf_opportunities
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'
  ),
  'rejected cross-tenant creates leave no activity or audit event'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_semester_service_results (kind, payload)
    SELECT 'activity-published', plugin_data.csf_set_activity_status(
      'ce100000-0000-4000-8000-000000000001',
      (payload->>'activityId')::uuid,
      'published',
      NULL,
      'ce000000-0000-4000-8000-000000000001'
    )
    FROM csf_semester_service_results
    WHERE kind = 'activity-draft'
  $$,
  'a draft activity can be published in an open semester'
);
SELECT extensions.ok(
  (
    SELECT activity.status = 'published'
      AND activity.published_at IS NOT NULL
      AND result.payload->>'correlationId' = event.correlation_id::text
      AND event.before_data->>'status' = 'draft'
      AND event.after_data->>'status' = 'published'
    FROM csf_semester_service_results AS result
    JOIN plugin_data.csf_opportunities AS activity
      ON activity.id = (result.payload->>'activityId')::uuid
    JOIN plugin_data.csf_admin_audit_events AS event
      ON event.target_id = activity.id
      AND event.action = 'activity.status_change'
      AND event.after_data->>'status' = 'published'
    WHERE result.kind = 'activity-published'
  ),
  'publication timestamps the row and records the exact lifecycle transition'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_activity_status(
      'ce100000-0000-4000-8000-000000000001',
      (payload->>'activityId')::uuid,
      'draft',
      NULL,
      'ce000000-0000-4000-8000-000000000001'
    )
    FROM csf_semester_service_results
    WHERE kind = 'activity-draft'
  $$,
  'P0001',
  'Invalid activity status.',
  'published activities cannot be moved backward to draft'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_activity_status(
      'ce100000-0000-4000-8000-000000000002',
      (payload->>'activityId')::uuid,
      'closed',
      NULL,
      'ce000000-0000-4000-8000-000000000001'
    )
    FROM csf_semester_service_results
    WHERE kind = 'activity-draft'
  $$,
  'P0001',
  'CSF activity not found.',
  'status changes cannot address another organization activity'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_semester_service_results (kind, payload)
    SELECT 'activity-closed', plugin_data.csf_set_activity_status(
      'ce100000-0000-4000-8000-000000000001',
      (payload->>'activityId')::uuid,
      'closed',
      NULL,
      'ce000000-0000-4000-8000-000000000001'
    )
    FROM csf_semester_service_results
    WHERE kind = 'activity-draft'
  $$,
  'a published activity can be closed'
);
SELECT extensions.ok(
  (
    SELECT activity.status = 'closed'
      AND activity.closed_at IS NOT NULL
      AND result.payload->>'correlationId' = event.correlation_id::text
      AND event.after_data->>'status' = 'closed'
    FROM csf_semester_service_results AS result
    JOIN plugin_data.csf_opportunities AS activity
      ON activity.id = (result.payload->>'activityId')::uuid
    JOIN plugin_data.csf_admin_audit_events AS event
      ON event.target_id = activity.id
      AND event.action = 'activity.status_change'
      AND event.after_data->>'status' = 'closed'
    WHERE result.kind = 'activity-closed'
  ),
  'closure records its timestamp and correlated audit transition'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_activity(
      'ce100000-0000-4000-8000-000000000001',
      (payload->>'activityId')::uuid,
      'ce200000-0000-4000-8000-000000000001',
      NULL,
      '{"title":"Edited after closure"}'::jsonb,
      'ce000000-0000-4000-8000-000000000001'
    )
    FROM csf_semester_service_results
    WHERE kind = 'activity-draft'
  $$,
  'P0001',
  'Closed, cancelled, or archived activities cannot be edited.',
  'closed activities cannot be edited'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_activity_status(
      'ce100000-0000-4000-8000-000000000001',
      (payload->>'activityId')::uuid,
      'closed',
      NULL,
      'ce000000-0000-4000-8000-000000000001'
    )
    FROM csf_semester_service_results
    WHERE kind = 'activity-draft'
  $$,
  'P0001',
  'Only published activities can be closed or cancelled.',
  'a closed activity cannot be closed a second time'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_semester_service_results (kind, payload)
    SELECT 'activity-cancel-candidate', plugin_data.csf_create_activity(
      'ce100000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      NULL,
      '{"status":"published","title":"Food bank sorting","body":"Sort donations.","startsAt":"2028-10-03T22:00:00Z","pointValue":2,"pointType":"non_drive","signupMode":"none","evidencePolicy":"optional"}'::jsonb,
      'ce000000-0000-4000-8000-000000000001'
    )
  $$,
  'an officer can create an immediately published activity'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_activity_status(
      'ce100000-0000-4000-8000-000000000001',
      (payload->>'activityId')::uuid,
      'cancelled',
      '   ',
      'ce000000-0000-4000-8000-000000000001'
    )
    FROM csf_semester_service_results
    WHERE kind = 'activity-cancel-candidate'
  $$,
  'P0001',
  'A cancellation reason is required.',
  'cancellation requires an explicit officer reason'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_semester_service_results (kind, payload)
    SELECT 'activity-cancelled', plugin_data.csf_set_activity_status(
      'ce100000-0000-4000-8000-000000000001',
      (payload->>'activityId')::uuid,
      'cancelled',
      'Host cancelled the event.',
      'ce000000-0000-4000-8000-000000000001'
    )
    FROM csf_semester_service_results
    WHERE kind = 'activity-cancel-candidate'
  $$,
  'a published activity can be cancelled with a reason'
);
SELECT extensions.ok(
  (
    SELECT activity.status = 'cancelled'
      AND activity.cancelled_at IS NOT NULL
      AND activity.cancellation_reason = 'Host cancelled the event.'
      AND event.reason_code = 'activity_cancelled'
      AND event.after_data->>'reason' = 'Host cancelled the event.'
    FROM csf_semester_service_results AS result
    JOIN plugin_data.csf_opportunities AS activity
      ON activity.id = (result.payload->>'activityId')::uuid
    JOIN plugin_data.csf_admin_audit_events AS event
      ON event.target_id = activity.id
      AND event.action = 'activity.status_change'
      AND event.after_data->>'status' = 'cancelled'
    WHERE result.kind = 'activity-cancelled'
  ),
  'cancellation preserves its reason, timestamp, and audited reason code'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_semester_service_results (kind, payload)
    SELECT 'activity-archived', plugin_data.csf_set_activity_status(
      'ce100000-0000-4000-8000-000000000001',
      (payload->>'activityId')::uuid,
      'archived',
      NULL,
      'ce000000-0000-4000-8000-000000000001'
    )
    FROM csf_semester_service_results
    WHERE kind = 'activity-cancel-candidate'
  $$,
  'a cancelled activity can be archived'
);
SELECT extensions.ok(
  (
    SELECT status = 'archived'
      AND archived_at IS NOT NULL
      AND cancelled_at IS NOT NULL
      AND cancellation_reason = 'Host cancelled the event.'
    FROM plugin_data.csf_opportunities
    WHERE id = (
      SELECT (payload->>'activityId')::uuid
      FROM csf_semester_service_results
      WHERE kind = 'activity-archived'
    )
  ),
  'archiving retains the cancellation provenance on the activity'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_activity_status(
      'ce100000-0000-4000-8000-000000000001',
      (payload->>'activityId')::uuid,
      'published',
      NULL,
      'ce000000-0000-4000-8000-000000000001'
    )
    FROM csf_semester_service_results
    WHERE kind = 'activity-cancel-candidate'
  $$,
  'P0001',
  'Archived activities cannot be changed.',
  'archived activities are terminal'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_semester_service_results (kind, payload)
    SELECT 'activity-awaiting-publish', plugin_data.csf_create_activity(
      'ce100000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      NULL,
      '{"status":"draft","title":"Library tutoring","body":"Tutor after school.","startsAt":"2028-10-10T22:00:00Z","pointValue":1,"pointType":"non_drive","signupMode":"none","evidencePolicy":"optional"}'::jsonb,
      'ce000000-0000-4000-8000-000000000001'
    )
  $$,
  'an open semester accepts another draft activity'
);

INSERT INTO plugin_data.csf_term_closures (
  id, organization_id, term_id, policy_version, summary, decisions,
  closed_by, revision, correlation_id
) VALUES (
  'ce900000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  'ce200000-0000-4000-8000-000000000001',
  3,
  '{"fixture":"closed-semester policy and activity guards"}'::jsonb,
  '[]'::jsonb,
  'ce000000-0000-4000-8000-000000000001',
  1,
  'ce900000-0000-4000-8000-000000000002'
);

INSERT INTO plugin_data.csf_term_close_authorizations (
  transaction_id, organization_id, term_id, closure_id,
  closure_revision, actor_user_id, correlation_id
) VALUES (
  pg_catalog.txid_current(),
  'ce100000-0000-4000-8000-000000000001',
  'ce200000-0000-4000-8000-000000000001',
  'ce900000-0000-4000-8000-000000000001',
  1,
  'ce000000-0000-4000-8000-000000000001',
  'ce900000-0000-4000-8000-000000000002'
);

UPDATE plugin_data.csf_terms
SET
  lifecycle_status = 'closed',
  is_current = false,
  closed_at = now(),
  closed_by = 'ce000000-0000-4000-8000-000000000001',
  closure_policy_version = 3,
  closure_revision = 1,
  latest_closure_id = 'ce900000-0000-4000-8000-000000000001',
  active_closure_id = 'ce900000-0000-4000-8000-000000000001'
WHERE id = 'ce200000-0000-4000-8000-000000000001';

DELETE FROM plugin_data.csf_term_close_authorizations
WHERE transaction_id = pg_catalog.txid_current()
  AND organization_id = 'ce100000-0000-4000-8000-000000000001'
  AND term_id = 'ce200000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_term_policy_v2(
      'ce100000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      9, 3, 4, 5, 1, true,
      '{"minimumListI":4,"minimumListIAndII":7,"minimumTotal":10,"maximumCourses":5,"disqualifyingGrades":["D","F"]}'::jsonb,
      false, 0, 'USD',
      'ce000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Closed or archived semester policy cannot be changed.',
  'a closed semester policy is immutable'
);
SELECT extensions.ok(
  (
    SELECT policy_version = 3
      AND (
        SELECT count(*)
        FROM plugin_data.csf_admin_audit_events
        WHERE organization_id = policy.organization_id
          AND action = 'term_policy.update'
          AND term_id = policy.term_id
      ) = 2
    FROM plugin_data.csf_term_policies AS policy
    WHERE policy.id = 'ce400000-0000-4000-8000-000000000001'
  ),
  'the rejected closed-semester policy update leaves no partial changes'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_activity(
      'ce100000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      NULL,
      '{"status":"draft","title":"Late activity"}'::jsonb,
      'ce000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Activities cannot be created in a closed or archived semester.',
  'activities cannot be created after semester closure'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_activity_status(
      'ce100000-0000-4000-8000-000000000001',
      (payload->>'activityId')::uuid,
      'published',
      NULL,
      'ce000000-0000-4000-8000-000000000001'
    )
    FROM csf_semester_service_results
    WHERE kind = 'activity-awaiting-publish'
  $$,
  'P0001',
  'Activities cannot be published in a closed or archived semester.',
  'draft activities cannot publish after semester closure'
);
SELECT extensions.ok(
  (
    SELECT status = 'draft' AND published_at IS NULL
    FROM plugin_data.csf_opportunities
    WHERE id = (
      SELECT (payload->>'activityId')::uuid
      FROM csf_semester_service_results
      WHERE kind = 'activity-awaiting-publish'
    )
  )
  AND (
    SELECT count(*) = 1
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = (
      SELECT (payload->>'activityId')::uuid
      FROM csf_semester_service_results
      WHERE kind = 'activity-awaiting-publish'
    )
  ),
  'rejected closed-semester activity actions leave the draft and audit history unchanged'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_admin_audit_events
    SET reason_code = 'tampered'
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND action = 'term_policy.update'
  $$,
  'P0001',
  'CSF audit events are immutable.',
  'semester and service audit events cannot be updated'
);
SELECT extensions.throws_ok(
  $$
    DELETE FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND action = 'activity.create'
  $$,
  'P0001',
  'CSF audit events are immutable.',
  'semester and service audit events cannot be deleted'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_constraint
    WHERE conrelid = 'plugin_data.csf_opportunities'::regclass
      AND conname IN (
        'csf_opportunities_term_organization_fkey',
        'csf_opportunities_cohort_organization_fkey'
      )
      AND convalidated
  ),
  2,
  'activity semester and class relationships enforce organization-scoped foreign keys'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_constraint
    WHERE conrelid = 'plugin_data.csf_opportunities'::regclass
      AND conname IN (
        'csf_opportunities_status_check',
        'csf_opportunities_point_cap_check',
        'csf_opportunities_cancellation_check'
      )
      AND convalidated
  ),
  3,
  'activity lifecycle, point cap, and cancellation invariants are validated'
);

SELECT * FROM extensions.finish();

ROLLBACK;
