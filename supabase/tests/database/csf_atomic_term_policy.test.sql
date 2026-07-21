BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(17);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_update_term_policy(uuid,uuid,numeric,numeric,numeric,integer,integer,boolean,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot update CSF term policy'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_update_term_policy(uuid,uuid,numeric,numeric,numeric,integer,integer,boolean,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot update CSF term policy'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_update_term_policy(uuid,uuid,numeric,numeric,numeric,integer,integer,boolean,uuid)',
    'EXECUTE'
  ),
  'the server role cannot bypass draft publication through the legacy policy function'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'cf000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'csf-policy-officer@local.test',
  now(),
  '{}',
  '{}',
  now(),
  now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'cf100000-0000-4000-8000-000000000001',
  'CSF Atomic Term Policy',
  'csf-atomic-term-policy',
  'school',
  '974001'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester
) VALUES (
  'cf200000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'F27',
  'Fall 2027',
  '2027-2028',
  'fall'
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
  created_by,
  updated_by
) VALUES (
  'cf300000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001',
  1,
  7,
  2,
  3,
  0,
  1,
  false,
  'cf000000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_update_term_policy(
      'cf100000-0000-4000-8000-000000000001',
      'cf200000-0000-4000-8000-000000000001',
      7,
      2,
      3,
      0,
      1,
      false,
      'cf000000-0000-4000-8000-000000000001'
    )
  $$,
  'unchanged default policy values allow one absence when no meetings are required'
);
SELECT extensions.is(
  (
    SELECT policy_version
    FROM plugin_data.csf_term_policies
    WHERE id = 'cf300000-0000-4000-8000-000000000001'
  ),
  2,
  'the first atomic save increments the policy version'
);
SELECT extensions.ok(
  (
    SELECT total_points_required = 7
      AND max_drive_points = 2
      AND max_points_per_activity = 3
      AND required_meetings = 0
      AND allowed_absences = 1
      AND allow_point_carryover = false
    FROM plugin_data.csf_term_policies
    WHERE id = 'cf300000-0000-4000-8000-000000000001'
  ),
  'saving unchanged defaults preserves every requirement value'
);
SELECT extensions.ok(
  (
    SELECT (before_data->>'policyVersion')::integer = 1
      AND (before_data->>'totalPointsRequired')::numeric = 7
      AND (before_data->>'requiredMeetings')::integer = 0
      AND (before_data->>'allowedAbsences')::integer = 1
      AND (before_data->>'allowPointCarryover')::boolean = false
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'
      AND action = 'term_policy.update'
      AND (after_data->>'policyVersion')::integer = 2
  ),
  'the audit event records the complete previous policy values'
);
SELECT extensions.ok(
  (
    SELECT (after_data->>'policyVersion')::integer = 2
      AND after_data->>'termCode' = 'F27'
      AND (after_data->>'totalPointsRequired')::numeric = 7
      AND (after_data->>'maxDrivePoints')::numeric = 2
      AND (after_data->>'maxPointsPerActivity')::numeric = 3
      AND (after_data->>'requiredMeetings')::integer = 0
      AND (after_data->>'allowedAbsences')::integer = 1
      AND (after_data->>'allowPointCarryover')::boolean = false
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'
      AND action = 'term_policy.update'
      AND (after_data->>'policyVersion')::integer = 2
  ),
  'the audit event records the complete saved policy values'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_update_term_policy(
      'cf100000-0000-4000-8000-000000000001',
      'cf200000-0000-4000-8000-000000000001',
      8,
      2,
      4,
      4,
      1,
      true,
      'cf000000-0000-4000-8000-000000000001'
    )
  $$,
  'a second policy save succeeds atomically'
);
SELECT extensions.is(
  (
    SELECT policy_version
    FROM plugin_data.csf_term_policies
    WHERE id = 'cf300000-0000-4000-8000-000000000001'
  ),
  3,
  'each atomic save increments from the locked database version'
);
SELECT extensions.ok(
  (
    SELECT (before_data->>'policyVersion')::integer = 2
      AND (before_data->>'totalPointsRequired')::numeric = 7
      AND (before_data->>'requiredMeetings')::integer = 0
      AND (before_data->>'allowedAbsences')::integer = 1
      AND (after_data->>'policyVersion')::integer = 3
      AND (after_data->>'totalPointsRequired')::numeric = 8
      AND (after_data->>'requiredMeetings')::integer = 4
      AND (after_data->>'allowedAbsences')::integer = 1
      AND (after_data->>'allowPointCarryover')::boolean = true
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'
      AND action = 'term_policy.update'
      AND (after_data->>'policyVersion')::integer = 3
  ),
  'the second audit event joins its exact before and after versions'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_term_policy(
      'cf100000-0000-4000-8000-000000000001',
      'cf200000-0000-4000-8000-000000000001',
      7,
      8,
      3,
      0,
      1,
      false,
      'cf000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'The drive-point cap cannot exceed the total point requirement.',
  'the atomic policy function rejects a drive cap above the total requirement'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_term_policy(
      'cf100000-0000-4000-8000-000000000001',
      'cf200000-0000-4000-8000-000000000001',
      8,
      2,
      4,
      2,
      3,
      false,
      'cf000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Allowed absences cannot exceed required meetings.',
  'the atomic policy function rejects excess absences when meetings are required'
);
SELECT extensions.ok(
  (
    SELECT policy.policy_version = 3
      AND (
        SELECT count(*)
        FROM plugin_data.csf_admin_audit_events AS event
        WHERE event.organization_id = policy.organization_id
          AND event.action = 'term_policy.update'
          AND event.term_id = policy.term_id
      ) = 2
    FROM plugin_data.csf_term_policies AS policy
    WHERE policy.id = 'cf300000-0000-4000-8000-000000000001'
  ),
  'rejected saves do not increment the policy or create audit history'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_constraint
    WHERE conrelid = 'plugin_data.csf_term_policies'::regclass
      AND conname IN (
        'csf_term_policies_drive_cap_check',
        'csf_term_policies_absence_allowance_check'
      )
      AND convalidated
  ),
  2,
  'both cross-field policy constraints exist and are validated'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_term_policies
    SET total_points_required = 7, max_drive_points = 8
    WHERE id = 'cf300000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'new row for relation "csf_term_policies" violates check constraint "csf_term_policies_drive_cap_check"',
  'the database rejects a drive cap above the total requirement'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_term_policies
    SET required_meetings = 2, allowed_absences = 3
    WHERE id = 'cf300000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'new row for relation "csf_term_policies" violates check constraint "csf_term_policies_absence_allowance_check"',
  'the database rejects excess absences when meetings are required'
);

SELECT * FROM extensions.finish();

ROLLBACK;
