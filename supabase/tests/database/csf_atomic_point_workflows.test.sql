BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(20);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_review_point_submission_v2(uuid,uuid,text,numeric,text,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot execute point-submission review'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_review_point_submission_v2(uuid,uuid,text,numeric,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot execute point-submission review'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_review_point_submission_v2(uuid,uuid,text,numeric,text,uuid)',
    'EXECUTE'
  ),
  'the server role can execute point-submission review'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_replace_point_processing_row(uuid,uuid,uuid,jsonb,jsonb,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot replace a point-processing row'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_replace_point_processing_row(uuid,uuid,uuid,jsonb,jsonb,uuid)',
    'EXECUTE'
  ),
  'the server role can replace a point-processing row'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'cd000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'csf-points-officer@local.test',
  now(),
  '{}',
  '{}',
  now(),
  now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'cd100000-0000-4000-8000-000000000001',
  'CSF Atomic Points',
  'csf-atomic-points',
  'school',
  '720001'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester
) VALUES (
  'cd200000-0000-4000-8000-000000000001',
  'cd100000-0000-4000-8000-000000000001',
  'S27',
  'Spring 2027',
  '2026-2027',
  'spring'
);

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, max_points_per_activity
) VALUES (
  'cd100000-0000-4000-8000-000000000001',
  'cd200000-0000-4000-8000-000000000001',
  3
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES (
  'cd300000-0000-4000-8000-000000000001',
  'cd100000-0000-4000-8000-000000000001',
  'Atomic',
  'Member',
  'atomic',
  'member'
);

INSERT INTO plugin_data.csf_point_submissions (
  id, organization_id, profile_id, term_id, description, claimed_points, point_type, status
) VALUES (
  'cd400000-0000-4000-8000-000000000001',
  'cd100000-0000-4000-8000-000000000001',
  'cd300000-0000-4000-8000-000000000001',
  'cd200000-0000-4000-8000-000000000001',
  'Atomic approval fixture',
  2,
  'non_drive',
  'submitted'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_review_point_submission_v2(
      'cd100000-0000-4000-8000-000000000001',
      'cd400000-0000-4000-8000-000000000001',
      'approved',
      2,
      'Verified by fixture',
      'cd000000-0000-4000-8000-000000000001'
    )
  $$,
  'a valid point submission is reviewed atomically'
);

SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_point_submissions WHERE id = 'cd400000-0000-4000-8000-000000000001'),
  'approved',
  'submission status is updated'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_credit_records WHERE submission_id = 'cd400000-0000-4000-8000-000000000001'),
  'verified',
  'verified credit is written in the same review'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_submission_reviews WHERE submission_id = 'cd400000-0000-4000-8000-000000000001'),
  1,
  'review history is written in the same review'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE target_id = 'cd400000-0000-4000-8000-000000000001' AND action = 'point_submission.review'),
  1,
  'audit history is written in the same review'
);

SELECT extensions.ok(
  (
    SELECT correlation_id IS NOT NULL
      AND source_type = 'point_submission'
      AND source_id = 'cd400000-0000-4000-8000-000000000001'
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = 'cd400000-0000-4000-8000-000000000001'
      AND action = 'point_submission.review'
  ),
  'point review audit records carry correlation and source provenance'
);

SELECT extensions.ok(
  (
    SELECT evidence->>'correlationId' IS NOT NULL
      AND evidence->>'sourceSubmissionId' = 'cd400000-0000-4000-8000-000000000001'
    FROM plugin_data.csf_credit_records
    WHERE submission_id = 'cd400000-0000-4000-8000-000000000001'
  ),
  'awarded credit retains its submission source and correlation id'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester
) VALUES (
  'cd200000-0000-4000-8000-000000000002',
  'cd100000-0000-4000-8000-000000000001',
  'F27',
  'Fall 2027',
  '2027-2028',
  'fall'
);

INSERT INTO plugin_data.csf_point_submissions (
  id, organization_id, profile_id, term_id, description, claimed_points, point_type, status
) VALUES (
  'cd400000-0000-4000-8000-000000000002',
  'cd100000-0000-4000-8000-000000000001',
  'cd300000-0000-4000-8000-000000000001',
  'cd200000-0000-4000-8000-000000000002',
  'No policy fixture',
  2,
  'non_drive',
  'submitted'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_review_point_submission_v2(
      'cd100000-0000-4000-8000-000000000001',
      'cd400000-0000-4000-8000-000000000002',
      'approved',
      2,
      'Must not approve without policy',
      'cd000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'A saved semester policy is required before approving point submissions.',
  'approval is blocked until the semester has a saved policy'
);

SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_point_submissions WHERE id = 'cd400000-0000-4000-8000-000000000002'),
  'submitted',
  'a blocked policy-less approval leaves the submission unchanged'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_credit_records WHERE submission_id = 'cd400000-0000-4000-8000-000000000002'),
  0,
  'a blocked policy-less approval does not create credit'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_review_point_submission_v2(
      'cd100000-0000-4000-8000-000000000001',
      'cd400000-0000-4000-8000-000000000002',
      'needs_action',
      NULL,
      'Please correct the submitted evidence.',
      'cd000000-0000-4000-8000-000000000001'
    )
  $$,
  'officers can request a correction before semester policy is configured'
);

INSERT INTO plugin_data.csf_credit_records (
  organization_id, profile_id, term_id, source, points, point_type, status, evidence
) VALUES (
  'cd100000-0000-4000-8000-000000000001',
  'cd300000-0000-4000-8000-000000000001',
  'cd200000-0000-4000-8000-000000000001',
  'manual',
  1,
  'non_drive',
  'verified',
  '{"processor":"points_sheet","slot":"activity_1","title":"Existing row"}'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_replace_point_processing_row(
      'cd100000-0000-4000-8000-000000000001',
      'cd300000-0000-4000-8000-000000000001',
      'cd200000-0000-4000-8000-000000000001',
      '[{"slot":"activity_1","label":"Activity 1","value":"Replacement row"}]',
      '[{"key":"meeting_1","label":"Meeting 1","value":"bad","status":"invalid"}]',
      'cd000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Invalid meeting attendance status.',
  'a failed row replacement raises an error'
);

SELECT extensions.is(
  (
    SELECT evidence->>'title'
    FROM plugin_data.csf_credit_records
    WHERE organization_id = 'cd100000-0000-4000-8000-000000000001'
      AND profile_id = 'cd300000-0000-4000-8000-000000000001'
      AND term_id = 'cd200000-0000-4000-8000-000000000001'
      AND evidence @> '{"processor":"points_sheet"}'
  ),
  'Existing row',
  'a failed replacement rolls back its earlier delete and insert work'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_replace_point_processing_row(
      'cd100000-0000-4000-8000-000000000001',
      'cd300000-0000-4000-8000-000000000001',
      'cd200000-0000-4000-8000-000000000001',
      '[{"slot":"activity_1","label":"Activity 1","value":"Replacement row"}]',
      '[]',
      'cd000000-0000-4000-8000-000000000001'
    )
  $$,
  'a valid point-processing row replaces its generated records atomically'
);

SELECT extensions.is(
  (
    SELECT evidence->>'title'
    FROM plugin_data.csf_credit_records
    WHERE organization_id = 'cd100000-0000-4000-8000-000000000001'
      AND profile_id = 'cd300000-0000-4000-8000-000000000001'
      AND term_id = 'cd200000-0000-4000-8000-000000000001'
      AND evidence @> '{"processor":"points_sheet"}'
  ),
  'Replacement row',
  'a successful replacement commits the new row'
);

SELECT * FROM extensions.finish();

ROLLBACK;
