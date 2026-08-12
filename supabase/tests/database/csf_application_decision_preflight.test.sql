BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(53);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_application_decision_readiness(uuid,uuid)',
    'EXECUTE'
  ),
  'the server role can load the canonical application decision preflight'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_application_decision_readiness(uuid,uuid)',
    'EXECUTE'
  ),
  'browser-authenticated users cannot load private decision evidence directly'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_application_decision_readiness_page(uuid,uuid[])',
    'EXECUTE'
  ),
  'the server role can load one bounded canonical readiness batch'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_application_decision_readiness_page(uuid,uuid[])',
    'EXECUTE'
  ),
  'browser-authenticated users cannot batch private application readiness'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_decide_term_application_readiness_base(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'the service role cannot bypass the locked readiness wrapper'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_decide_term_application(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'the service role cannot call the response-loss-unsafe legacy decision signature'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_decide_term_application(uuid,uuid,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'the service role can call only the request-aware application decision signature'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_decide_term_application(uuid,uuid,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'browser-authenticated users cannot call the request-aware decision RPC directly'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  (
    'ef000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'decision-preflight-officer@local.test',
    now(), '{}', '{}', now(), now()
  ),
  (
    'ef000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'decision-preflight-member@local.test',
    now(), '{}', '{}', now(), now()
  ),
  (
    'ef000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'decision-preflight-other-org@local.test',
    now(), '{}', '{}', now(), now()
  );

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'ef100000-0000-4000-8000-000000000001',
    'CSF Decision Preflight', 'csf-decision-preflight', 'school', '981201'
  ),
  (
    'ef100000-0000-4000-8000-000000000002',
    'CSF Decision Preflight Other', 'csf-decision-preflight-other', 'school', '981202'
  );

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  (
    'ef100000-0000-4000-8000-000000000001',
    'ef000000-0000-4000-8000-000000000001',
    'admin', 'active'
  ),
  (
    'ef100000-0000-4000-8000-000000000001',
    'ef000000-0000-4000-8000-000000000002',
    'member', 'active'
  ),
  (
    'ef100000-0000-4000-8000-000000000002',
    'ef000000-0000-4000-8000-000000000003',
    'admin', 'active'
  );

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES (
  'ef200000-0000-4000-8000-000000000001',
  'ef100000-0000-4000-8000-000000000001',
  'F31', 'Fall 2031', '2031-2032', 'fall', true
);

INSERT INTO plugin_data.csf_term_policies (
  id, organization_id, term_id, policy_version, dues_required, academic_rules
) VALUES (
  'ef300000-0000-4000-8000-000000000001',
  'ef100000-0000-4000-8000-000000000001',
  'ef200000-0000-4000-8000-000000000001',
  1, true,
  '{"minimumListI":4,"minimumListIAndII":7,"minimumTotal":10,"maximumCourses":5,"bonusPointLimit":2,"gradePointValues":{"I":{"A":3,"B":1},"II":{"A":2,"B":1},"III":{"A":1,"B":0}},"disqualifyingGrades":["D","F"]}'::jsonb
)
ON CONFLICT (organization_id, term_id) DO UPDATE
SET policy_version = excluded.policy_version,
    dues_required = excluded.dues_required,
    academic_rules = excluded.academic_rules;

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES (
  'ef400000-0000-4000-8000-000000000001',
  'ef100000-0000-4000-8000-000000000001', 2032, 'Class of 2032'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES (
  'ef500000-0000-4000-8000-000000000001',
  'ef100000-0000-4000-8000-000000000001',
  'Aarav', 'Review', 'aarav', 'review'
);

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status,
  submission_status, eligibility_status, decision_status,
  current_grade_level, most_checked_email, list_i_points,
  list_i_ii_points, grand_total_points, submitted_at
) VALUES (
  'ef600000-0000-4000-8000-000000000001',
  'ef100000-0000-4000-8000-000000000001',
  'ef500000-0000-4000-8000-000000000001',
  'ef400000-0000-4000-8000-000000000001',
  'ef200000-0000-4000-8000-000000000001',
  'google_form_sheet', 'submitted', 'ready', 'eligible', 'pending',
  11, 'aarav.review@local.test', 7, 10, 10, now()
);

UPDATE plugin_data.csf_application_checks
SET status = 'passed',
    mandatory = true,
    reviewed_by = 'ef000000-0000-4000-8000-000000000001',
    reviewed_at = now(),
    updated_at = now()
WHERE organization_id = 'ef100000-0000-4000-8000-000000000001'
  AND application_id = 'ef600000-0000-4000-8000-000000000001';

UPDATE plugin_data.csf_dues_records
SET status = 'verified',
    paid_amount = required_amount,
    verified_by = 'ef000000-0000-4000-8000-000000000001',
    verified_at = now(),
    updated_at = now()
WHERE organization_id = 'ef100000-0000-4000-8000-000000000001'
  AND application_id = 'ef600000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_decide_term_application(
    'ef100000-0000-4000-8000-000000000001',
    'ef600000-0000-4000-8000-000000000001',
    'accepted', NULL,
    'ef000000-0000-4000-8000-000000000003',
    'ef700000-0000-4000-8000-000000000008'
  ) $$,
  'P0001',
  'Not authorized to decide CSF applications.',
  'an org-B officer cannot decide an org-A application'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_decide_term_application(
    'ef100000-0000-4000-8000-000000000002',
    'ef600000-0000-4000-8000-000000000001',
    'accepted', NULL,
    'ef000000-0000-4000-8000-000000000003',
    'ef700000-0000-4000-8000-000000000009'
  ) $$,
  'P0001',
  'CSF application not found.',
  'an org-B officer cannot resolve an org-A application through an org-B scope'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_term_applications
    WHERE organization_id = 'ef100000-0000-4000-8000-000000000001'
      AND id = 'ef600000-0000-4000-8000-000000000001'
      AND status = 'submitted'
      AND decision_status = 'pending'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_term_memberships
    WHERE application_id = 'ef600000-0000-4000-8000-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_application_status_events
    WHERE application_id = 'ef600000-0000-4000-8000-000000000001'
      AND actor_user_id = 'ef000000-0000-4000-8000-000000000003'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events
    WHERE correlation_id IN (
      'ef700000-0000-4000-8000-000000000008',
      'ef700000-0000-4000-8000-000000000009'
    )
  ),
  'cross-organization decision attempts leave the application unchanged with zero memberships, events, or receipts'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_decide_term_application(
    'ef100000-0000-4000-8000-000000000001',
    'ef600000-0000-4000-8000-000000000001',
    'accepted', NULL,
    'ef000000-0000-4000-8000-000000000002',
    'ef700000-0000-4000-8000-000000000001'
  ) $$,
  'P0001',
  'Not authorized to decide CSF applications.',
  'a trusted service call still revalidates the recorded decision actor before private evidence'
);

SELECT extensions.ok(
  NOT (plugin_data.csf_application_decision_readiness(
    'ef100000-0000-4000-8000-000000000001',
    'ef600000-0000-4000-8000-000000000001'
  )->>'ready')::boolean,
  'green stored totals and checks cannot make an application with zero course rows ready'
);
SELECT extensions.ok(
  jsonb_path_exists(
    plugin_data.csf_application_decision_readiness(
      'ef100000-0000-4000-8000-000000000001',
      'ef600000-0000-4000-8000-000000000001'
    ),
    '$.blockers[*] ? (@ like_regex "At least one course row")'
  ),
  'the canonical preflight explains the missing course evidence'
);
SELECT extensions.is(
  (
    SELECT readiness
    FROM plugin_data.csf_application_decision_readiness_page(
      'ef100000-0000-4000-8000-000000000001',
      ARRAY['ef600000-0000-4000-8000-000000000001'::uuid]
    )
  ),
  plugin_data.csf_application_decision_readiness(
    'ef100000-0000-4000-8000-000000000001',
    'ef600000-0000-4000-8000-000000000001'
  ),
  'the queue exposes the exact missing-course database preflight'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_application_decision_readiness_page(
      'ef100000-0000-4000-8000-000000000001',
      ARRAY(
        SELECT ('ab000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid
        FROM generate_series(1, 100) AS i
        UNION ALL
        SELECT 'ef600000-0000-4000-8000-000000000001'::uuid
      )
    )
  ),
  0,
  'the readiness batch ignores every application id after the first 100'
);
SET LOCAL ROLE service_role;
SELECT extensions.lives_ok(
  $$ SELECT *
     FROM plugin_data.csf_application_decision_readiness_page(
       'ef100000-0000-4000-8000-000000000001',
       ARRAY['ef600000-0000-4000-8000-000000000001'::uuid]
     ) $$,
  'the real server role can execute the bounded readiness batch'
);
RESET ROLE;
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_decide_term_application(
    'ef100000-0000-4000-8000-000000000001',
    'ef600000-0000-4000-8000-000000000001',
    'accepted', NULL,
    'ef000000-0000-4000-8000-000000000001',
    'ef700000-0000-4000-8000-000000000002'
  ) $$,
  'P0001',
  'Application decision preflight is blocked.',
  'the locked decision refuses the same zero-course application'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_term_memberships
    WHERE application_id = 'ef600000-0000-4000-8000-000000000001'
  ),
  0,
  'a refused readiness decision creates no partial membership'
);

INSERT INTO plugin_data.csf_application_course_entries (
  organization_id, application_id, course_list, course_name, grade, points
) VALUES
  ('ef100000-0000-4000-8000-000000000001', 'ef600000-0000-4000-8000-000000000001', 'I', 'Inflated List I', 'A', 99),
  ('ef100000-0000-4000-8000-000000000001', 'ef600000-0000-4000-8000-000000000001', 'II', 'Inflated List II', 'A', 99),
  ('ef100000-0000-4000-8000-000000000001', 'ef600000-0000-4000-8000-000000000001', 'III', 'Inflated List III', 'A', 99);

UPDATE plugin_data.csf_term_policies
SET policy_version = 2,
    updated_at = now()
WHERE organization_id = 'ef100000-0000-4000-8000-000000000001'
  AND term_id = 'ef200000-0000-4000-8000-000000000001';

SELECT extensions.ok(
  jsonb_path_exists(
    plugin_data.csf_application_decision_readiness(
      'ef100000-0000-4000-8000-000000000001',
      'ef600000-0000-4000-8000-000000000001'
    ),
    '$.blockers[*] ? (@ like_regex "current policy")'
  ),
  'a policy change makes the previously passed academic check stale'
);
SELECT extensions.ok(
  (
    SELECT jsonb_path_exists(
      readiness,
      '$.blockers[*] ? (@ like_regex "current policy")'
    )
    FROM plugin_data.csf_application_decision_readiness_page(
      'ef100000-0000-4000-8000-000000000001',
      ARRAY['ef600000-0000-4000-8000-000000000001'::uuid]
    )
  ),
  'the queue exposes the same stale-policy blocker as the decision boundary'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_decide_term_application(
    'ef100000-0000-4000-8000-000000000001',
    'ef600000-0000-4000-8000-000000000001',
    'accepted', NULL,
    'ef000000-0000-4000-8000-000000000001',
    'ef700000-0000-4000-8000-000000000003'
  ) $$,
  'P0001',
  'Application decision preflight is blocked.',
  'the locked decision refuses a stale academic check'
);

UPDATE plugin_data.csf_application_checks
SET details = details,
    updated_at = now()
WHERE organization_id = 'ef100000-0000-4000-8000-000000000001'
  AND application_id = 'ef600000-0000-4000-8000-000000000001'
  AND check_type = 'academic_eligibility';

SELECT extensions.is(
  (plugin_data.csf_application_decision_readiness(
    'ef100000-0000-4000-8000-000000000001',
    'ef600000-0000-4000-8000-000000000001'
  )->'calculatedPoints'->>'total')::numeric,
  6::numeric,
  'stored course points cannot override the current policy grade and list calculation'
);
SELECT extensions.ok(
  NOT (plugin_data.csf_application_decision_readiness(
    'ef100000-0000-4000-8000-000000000001',
    'ef600000-0000-4000-8000-000000000001'
  )->>'ready')::boolean,
  'inflated imported course points cannot make an ineligible application ready'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_decide_term_application(
    'ef100000-0000-4000-8000-000000000001',
    'ef600000-0000-4000-8000-000000000001',
    'accepted', NULL,
    'ef000000-0000-4000-8000-000000000001',
    'ef700000-0000-4000-8000-000000000004'
  ) $$,
  'P0001',
  'Application decision preflight is blocked.',
  'the locked decision rejects an application supported only by inflated stored points'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_term_memberships
    WHERE application_id = 'ef600000-0000-4000-8000-000000000001'
  ),
  0,
  'the inflated-points refusal creates no partial membership'
);

DELETE FROM plugin_data.csf_application_course_entries
WHERE organization_id = 'ef100000-0000-4000-8000-000000000001'
  AND application_id = 'ef600000-0000-4000-8000-000000000001';

INSERT INTO plugin_data.csf_application_course_entries (
  organization_id, application_id, course_list, course_name, grade, points, is_bonus
) VALUES
  ('ef100000-0000-4000-8000-000000000001', 'ef600000-0000-4000-8000-000000000001', 'I', 'Synthetic List I A', 'A', 3, true),
  ('ef100000-0000-4000-8000-000000000001', 'ef600000-0000-4000-8000-000000000001', 'I', 'Synthetic List I A 2', 'A', 3, false),
  ('ef100000-0000-4000-8000-000000000001', 'ef600000-0000-4000-8000-000000000001', 'II', 'Synthetic List II', 'A', 2, true);

SELECT extensions.is(
  (plugin_data.csf_application_decision_readiness(
    'ef100000-0000-4000-8000-000000000001',
    'ef600000-0000-4000-8000-000000000001'
  )->'calculatedPoints'->>'total')::numeric,
  10::numeric,
  'the preflight recalculates policy-consistent grade, list, and bonus points from current course rows'
);
SELECT extensions.ok(
  (plugin_data.csf_application_decision_readiness(
    'ef100000-0000-4000-8000-000000000001',
    'ef600000-0000-4000-8000-000000000001'
  )->>'ready')::boolean,
  'current qualifying courses, current checks, and verified dues produce a ready preflight'
);
SELECT extensions.is(
  (
    SELECT readiness
    FROM plugin_data.csf_application_decision_readiness_page(
      'ef100000-0000-4000-8000-000000000001',
      ARRAY['ef600000-0000-4000-8000-000000000001'::uuid]
    )
  ),
  plugin_data.csf_application_decision_readiness(
    'ef100000-0000-4000-8000-000000000001',
    'ef600000-0000-4000-8000-000000000001'
  ),
  'the queue exposes the exact ready database preflight'
);

UPDATE plugin_data.csf_term_applications
SET eligibility_status = 'ineligible'
WHERE organization_id = 'ef100000-0000-4000-8000-000000000001'
  AND id = 'ef600000-0000-4000-8000-000000000001';

SELECT extensions.ok(
  jsonb_path_exists(
    plugin_data.csf_application_decision_readiness(
      'ef100000-0000-4000-8000-000000000001',
      'ef600000-0000-4000-8000-000000000001'
    ),
    '$.blockers[*] ? (@ like_regex "Stored eligibility disagrees")'
  ),
  'stored and calculated eligibility disagreement is explicit and blocking'
);
SELECT extensions.ok(
  (
    SELECT jsonb_path_exists(
      readiness,
      '$.blockers[*] ? (@ like_regex "Stored eligibility disagrees")'
    )
    FROM plugin_data.csf_application_decision_readiness_page(
      'ef100000-0000-4000-8000-000000000001',
      ARRAY['ef600000-0000-4000-8000-000000000001'::uuid]
    )
  ),
  'the queue exposes the same stored-versus-calculated blocker as the decision boundary'
);

UPDATE plugin_data.csf_term_applications
SET eligibility_status = 'eligible'
WHERE organization_id = 'ef100000-0000-4000-8000-000000000001'
  AND id = 'ef600000-0000-4000-8000-000000000001';

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_decide_term_application(
    'ef100000-0000-4000-8000-000000000001',
    'ef600000-0000-4000-8000-000000000001',
    'accepted', NULL,
    'ef000000-0000-4000-8000-000000000001',
    'ef700000-0000-4000-8000-000000000005'
  ) $$,
  'a current ready application is accepted atomically'
);
SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_term_applications
    WHERE id = 'ef600000-0000-4000-8000-000000000001'
  ),
  'accepted',
  'the accepted application stores the final legacy status'
);
SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_term_memberships
    WHERE application_id = 'ef600000-0000-4000-8000-000000000001'
  ),
  'accepted',
  'the accepted application creates the matching term membership in the same transaction'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = 'ef600000-0000-4000-8000-000000000001'
      AND action = 'application.accepted'
      AND correlation_id IS NOT NULL
  ),
  'the readiness-safe acceptance retains a correlated immutable audit receipt'
);

SELECT extensions.is(
  plugin_data.csf_decide_term_application(
    'ef100000-0000-4000-8000-000000000001',
    'ef600000-0000-4000-8000-000000000001',
    'accepted', NULL,
    'ef000000-0000-4000-8000-000000000001',
    'ef700000-0000-4000-8000-000000000005'
  )->>'correlationId',
  (
    SELECT decision_correlation_id::text
    FROM plugin_data.csf_term_applications
    WHERE id = 'ef600000-0000-4000-8000-000000000001'
  ),
  'an exact accepted retry returns the original committed response coordinate'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'ef100000-0000-4000-8000-000000000001'
      AND correlation_id = 'ef700000-0000-4000-8000-000000000005'
      AND action = 'application.decision_request_committed'
  ),
  1,
  'accepted response loss records exactly one immutable request receipt'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_application_status_events
    WHERE application_id = 'ef600000-0000-4000-8000-000000000001'
  ),
  1,
  'an accepted retry creates no second decision-history event'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = 'ef600000-0000-4000-8000-000000000001'
      AND action = 'application.accepted'
  ),
  1,
  'an accepted retry creates no second domain decision audit'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_decide_term_application(
    'ef100000-0000-4000-8000-000000000001',
    'ef600000-0000-4000-8000-000000000001',
    'rejected', 'Different intent.',
    'ef000000-0000-4000-8000-000000000001',
    'ef700000-0000-4000-8000-000000000005'
  ) $$,
  'P0001',
  'That application-decision request identifier is already bound to a different change.',
  'one application request UUID cannot be reused for a different decision'
);

UPDATE public.organization_members
SET status = 'inactive'
WHERE organization_id = 'ef100000-0000-4000-8000-000000000001'
  AND user_id = 'ef000000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_decide_term_application(
    'ef100000-0000-4000-8000-000000000001',
    'ef600000-0000-4000-8000-000000000001',
    'accepted', NULL,
    'ef000000-0000-4000-8000-000000000001',
    'ef700000-0000-4000-8000-000000000005'
  ) $$,
  'P0001',
  'Not authorized to decide CSF applications.',
  'revoked application authority is checked before an existing receipt can be replayed'
);
UPDATE public.organization_members
SET status = 'active'
WHERE organization_id = 'ef100000-0000-4000-8000-000000000001'
  AND user_id = 'ef000000-0000-4000-8000-000000000001';

UPDATE plugin_data.csf_term_memberships
SET status = 'active', updated_at = now()
WHERE application_id = 'ef600000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_decide_term_application(
    'ef100000-0000-4000-8000-000000000001',
    'ef600000-0000-4000-8000-000000000001',
    'accepted', NULL,
    'ef000000-0000-4000-8000-000000000001',
    'ef700000-0000-4000-8000-000000000005'
  ) $$,
  'P0001',
  'The committed application decision receipt is stale. Reload the application for its current state.',
  'a later accepted-membership transition makes the old decision receipt truthfully stale'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES
  (
    'ef500000-0000-4000-8000-000000000002',
    'ef100000-0000-4000-8000-000000000001',
    'Rhea', 'Reject', 'rhea', 'reject'
  ),
  (
    'ef500000-0000-4000-8000-000000000003',
    'ef100000-0000-4000-8000-000000000001',
    'Niko', 'Revise', 'niko', 'revise'
  );

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status,
  submission_status, eligibility_status, decision_status,
  current_grade_level, most_checked_email, list_i_points,
  list_i_ii_points, grand_total_points, submitted_at
) VALUES
  (
    'ef600000-0000-4000-8000-000000000002',
    'ef100000-0000-4000-8000-000000000001',
    'ef500000-0000-4000-8000-000000000002',
    'ef400000-0000-4000-8000-000000000001',
    'ef200000-0000-4000-8000-000000000001',
    'google_form_sheet', 'submitted', 'ready', 'pending', 'pending',
    11, 'rhea.reject@local.test', 0, 0, 0, now()
  ),
  (
    'ef600000-0000-4000-8000-000000000003',
    'ef100000-0000-4000-8000-000000000001',
    'ef500000-0000-4000-8000-000000000003',
    'ef400000-0000-4000-8000-000000000001',
    'ef200000-0000-4000-8000-000000000001',
    'google_form_sheet', 'submitted', 'ready', 'pending', 'pending',
    11, 'niko.revise@local.test', 0, 0, 0, now()
  );

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_decide_term_application(
    'ef100000-0000-4000-8000-000000000001',
    'ef600000-0000-4000-8000-000000000002',
    'rejected', 'The submitted evidence does not meet the requirements.',
    'ef000000-0000-4000-8000-000000000001',
    'ef700000-0000-4000-8000-000000000006'
  ) $$,
  'a rejection is committed through the request-aware signature'
);
SELECT extensions.is(
  plugin_data.csf_decide_term_application(
    'ef100000-0000-4000-8000-000000000001',
    'ef600000-0000-4000-8000-000000000002',
    'rejected', 'The submitted evidence does not meet the requirements.',
    'ef000000-0000-4000-8000-000000000001',
    'ef700000-0000-4000-8000-000000000006'
  )->>'correlationId',
  (
    SELECT decision_correlation_id::text
    FROM plugin_data.csf_term_applications
    WHERE id = 'ef600000-0000-4000-8000-000000000002'
  ),
  'an exact rejection retry returns its original committed response'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_application_status_events WHERE application_id = 'ef600000-0000-4000-8000-000000000002'),
  1,
  'a rejection retry creates no duplicate status history'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE target_id = 'ef600000-0000-4000-8000-000000000002' AND action = 'application.rejected'),
  1,
  'a rejection retry creates no duplicate domain audit'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'ef700000-0000-4000-8000-000000000006' AND action = 'application.decision_request_committed'),
  1,
  'a rejection retry retains one response-loss receipt'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_decide_term_application(
    'ef100000-0000-4000-8000-000000000001',
    'ef600000-0000-4000-8000-000000000003',
    'needs_action', 'Please correct the missing application evidence.',
    'ef000000-0000-4000-8000-000000000001',
    'ef700000-0000-4000-8000-000000000007'
  ) $$,
  'a needs-action decision is committed through the request-aware signature'
);
SELECT extensions.is(
  plugin_data.csf_decide_term_application(
    'ef100000-0000-4000-8000-000000000001',
    'ef600000-0000-4000-8000-000000000003',
    'needs_action', 'Please correct the missing application evidence.',
    'ef000000-0000-4000-8000-000000000001',
    'ef700000-0000-4000-8000-000000000007'
  )->>'correlationId',
  (
    SELECT decision_correlation_id::text
    FROM plugin_data.csf_term_applications
    WHERE id = 'ef600000-0000-4000-8000-000000000003'
  ),
  'an exact needs-action retry returns its original committed response'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_application_status_events WHERE application_id = 'ef600000-0000-4000-8000-000000000003'),
  1,
  'a needs-action retry creates no duplicate status history'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE target_id = 'ef600000-0000-4000-8000-000000000003' AND action = 'application.needs_action'),
  1,
  'a needs-action retry creates no duplicate domain audit'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'ef700000-0000-4000-8000-000000000007' AND action = 'application.decision_request_committed'),
  1,
  'a needs-action retry retains one response-loss receipt'
);

UPDATE plugin_data.csf_term_applications
SET review_notes = 'Application evidence changed after the recorded request.',
    updated_at = now()
WHERE id = 'ef600000-0000-4000-8000-000000000003';
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_decide_term_application(
    'ef100000-0000-4000-8000-000000000001',
    'ef600000-0000-4000-8000-000000000003',
    'needs_action', 'Please correct the missing application evidence.',
    'ef000000-0000-4000-8000-000000000001',
    'ef700000-0000-4000-8000-000000000007'
  ) $$,
  'P0001',
  'The committed application decision receipt is stale. Reload the application for its current state.',
  'a later application-state change refuses an obsolete needs-action success receipt'
);

SELECT * FROM extensions.finish();

ROLLBACK;
