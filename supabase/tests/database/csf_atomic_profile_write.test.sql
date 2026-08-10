BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(59);

SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_upsert_profile(uuid,uuid,uuid,jsonb)') IS NOT NULL,
  'the atomic profile create/edit operation exists'
);
SELECT extensions.ok(
  NOT has_function_privilege('public', 'plugin_data.csf_upsert_profile(uuid,uuid,uuid,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'plugin_data.csf_upsert_profile(uuid,uuid,uuid,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'plugin_data.csf_upsert_profile(uuid,uuid,uuid,jsonb)', 'EXECUTE')
    AND has_function_privilege('service_role', 'plugin_data.csf_upsert_profile(uuid,uuid,uuid,jsonb)', 'EXECUTE'),
  'only service_role can invoke the profile mutation'
);
SELECT extensions.ok(
  pg_get_functiondef('plugin_data.csf_upsert_profile(uuid,uuid,uuid,jsonb)'::regprocedure)
    LIKE '%SECURITY DEFINER%SET search_path TO %',
  'the privileged operation pins an empty search path'
);
SELECT extensions.ok(
  pg_get_functiondef('plugin_data.csf_upsert_profile(uuid,uuid,uuid,jsonb)'::regprocedure)
    LIKE '%manage_profiles%decide_applications%',
  'the database rechecks profile management and accepted-decision permissions'
);
SELECT extensions.ok(
  pg_get_functiondef('plugin_data.csf_upsert_profile(uuid,uuid,uuid,jsonb)'::regprocedure)
    LIKE '%pg_advisory_xact_lock%requestFingerprint%',
  'profile writes serialize and bind replay to a canonical fingerprint'
);
SELECT extensions.ok(
  pg_get_functiondef('plugin_data.csf_upsert_profile(uuid,uuid,uuid,jsonb)'::regprocedure)
    NOT LIKE '%INSERT INTO plugin_data.csf_cohorts%'
    AND pg_get_functiondef('plugin_data.csf_upsert_profile(uuid,uuid,uuid,jsonb)'::regprocedure)
      NOT LIKE '%INSERT INTO plugin_data.csf_terms%'
    AND pg_get_functiondef('plugin_data.csf_upsert_profile(uuid,uuid,uuid,jsonb)'::regprocedure)
      NOT LIKE '%INSERT INTO plugin_data.csf_cohort_terms%',
  'profile writes cannot invent classes, semesters, or class-semester links'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('be000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'profile-admin@local.test', now(), '{}', '{}', now(), now()),
  ('be000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'profile-member@local.test', now(), '{}', '{}', now(), now()),
  ('be000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'other-profile-admin@local.test', now(), '{}', '{}', now(), now()),
  ('be000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'profile-manager@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('be100000-0000-4000-8000-000000000001', 'Atomic Profiles', 'atomic-profiles', 'school', '993101'),
  ('be100000-0000-4000-8000-000000000002', 'Other Atomic Profiles', 'other-atomic-profiles', 'school', '993102');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('be100000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('be100000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('be100000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000004', 'member', 'active'),
  ('be100000-0000-4000-8000-000000000002', 'be000000-0000-4000-8000-000000000003', 'admin', 'active');

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, role_type, is_system
) VALUES (
  'be110000-0000-4000-8000-000000000001',
  'be100000-0000-4000-8000-000000000001',
  'profile-manager-only', 'Profile manager only', 'custom', false
);
INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key, enabled
) VALUES (
  'be100000-0000-4000-8000-000000000001',
  'be110000-0000-4000-8000-000000000001',
  'manage_profiles', true
);
INSERT INTO plugin_data.csf_staff_positions (
  id, organization_id, user_id, role_id, school_year, display_title,
  status, starts_at, ends_at, appointed_by
) VALUES (
  'be120000-0000-4000-8000-000000000001',
  'be100000-0000-4000-8000-000000000001',
  'be000000-0000-4000-8000-000000000004',
  'be110000-0000-4000-8000-000000000001',
  '2039-2040', 'Profile manager', 'active', current_date - 1, current_date + 365,
  'be000000-0000-4000-8000-000000000001'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label, status
) VALUES
  ('be200000-0000-4000-8000-000000000001', 'be100000-0000-4000-8000-000000000001', 2040, 'Class of 2040', 'active'),
  ('be200000-0000-4000-8000-000000000002', 'be100000-0000-4000-8000-000000000001', 2041, 'Class of 2041', 'active'),
  ('be200000-0000-4000-8000-000000000003', 'be100000-0000-4000-8000-000000000002', 2040, 'Other Class of 2040', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, lifecycle_status, is_current
) VALUES
  ('be300000-0000-4000-8000-000000000001', 'be100000-0000-4000-8000-000000000001', 'F39', 'Fall 2039', '2039-2040', 'fall', 'open', true),
  ('be300000-0000-4000-8000-000000000002', 'be100000-0000-4000-8000-000000000001', 'S40', 'Spring 2040', '2039-2040', 'spring', 'planned', false),
  ('be300000-0000-4000-8000-000000000003', 'be100000-0000-4000-8000-000000000002', 'F39', 'Other Fall 2039', '2039-2040', 'fall', 'open', true);

INSERT INTO plugin_data.csf_cohort_terms (
  organization_id, cohort_id, term_id, grade_level, status
) VALUES
  ('be100000-0000-4000-8000-000000000001', 'be200000-0000-4000-8000-000000000001', 'be300000-0000-4000-8000-000000000001', 12, 'active'),
  ('be100000-0000-4000-8000-000000000001', 'be200000-0000-4000-8000-000000000002', 'be300000-0000-4000-8000-000000000001', 11, 'active');

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, policy_version, created_by, updated_by
) VALUES (
  'be100000-0000-4000-8000-000000000001',
  'be300000-0000-4000-8000-000000000001',
  1,
  'be000000-0000-4000-8000-000000000001',
  'be000000-0000-4000-8000-000000000001'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES (
  'be400000-0000-4000-8000-000000000099',
  'be100000-0000-4000-8000-000000000002',
  'Other', 'Student', 'other', 'student'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_profile(
    'be100000-0000-4000-8000-000000000001',
    'be000000-0000-4000-8000-000000000002',
    'be900000-0000-4000-8000-000000000001',
    jsonb_build_object('firstName', 'Unauthorized', 'lastName', 'Student', 'cohortId', 'be200000-0000-4000-8000-000000000001', 'nicknames', '[]'::jsonb)
  )$$,
  'P0001', 'Not authorized to manage CSF member profiles.',
  'an ordinary member cannot create a profile'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE organization_id = 'be100000-0000-4000-8000-000000000001'),
  0,
  'a rejected authorization attempt writes no profile'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_profile(
    'be100000-0000-4000-8000-000000000001',
    'be000000-0000-4000-8000-000000000001',
    'be900000-0000-4000-8000-000000000002',
    jsonb_build_object('firstName', 'No', 'lastName', 'Class', 'nicknames', '[]'::jsonb)
  )$$,
  'P0001', 'Choose an existing graduating class before adding this student.',
  'creating a profile requires an explicit existing class'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_profile(
    'be100000-0000-4000-8000-000000000001',
    'be000000-0000-4000-8000-000000000001',
    'be900000-0000-4000-8000-000000000003',
    jsonb_build_object('firstName', 'Cross', 'lastName', 'Class', 'cohortId', 'be200000-0000-4000-8000-000000000003', 'nicknames', '[]'::jsonb)
  )$$,
  'P0001', 'The selected graduating class was not found or is not active in this organization.',
  'an authorized actor cannot use another organization class'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE organization_id = 'be100000-0000-4000-8000-000000000001'),
  0,
  'invalid and cross-tenant class attempts leave no profile'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_upsert_profile(
    'be100000-0000-4000-8000-000000000001',
    'be000000-0000-4000-8000-000000000001',
    'be900000-0000-4000-8000-000000000004',
    jsonb_build_object(
      'firstName', 'Maya', 'lastName', 'Chen', 'preferredName', 'Maya',
      'schoolEmail', ' Maya@School.Test ', 'personalEmail', 'maya@example.test',
      'cohortId', 'be200000-0000-4000-8000-000000000001',
      'nicknames', jsonb_build_array('May')
    )
  )$$,
  'an authorized actor atomically creates a profile and exact class membership'
);
SELECT extensions.results_eq(
  $$SELECT first_name, last_name, school_email, personal_email, nicknames
    FROM plugin_data.csf_profiles
    WHERE organization_id = 'be100000-0000-4000-8000-000000000001'$$,
  $$VALUES ('Maya'::text, 'Chen'::text, 'maya@school.test'::text, 'maya@example.test'::text, ARRAY['May']::text[])$$,
  'the canonical profile identity and contact values are saved'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_profile_cohort_memberships WHERE organization_id = 'be100000-0000-4000-8000-000000000001'),
  'active',
  'the exact existing class membership commits with the profile'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'be900000-0000-4000-8000-000000000004'),
  1,
  'profile creation writes one immutable request receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_cohorts WHERE organization_id = 'be100000-0000-4000-8000-000000000001'),
  2,
  'profile creation creates no hidden class'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_cohort_terms WHERE organization_id = 'be100000-0000-4000-8000-000000000001'),
  2,
  'profile creation creates no hidden class-semester link'
);

SELECT extensions.is(
  (plugin_data.csf_upsert_profile(
    'be100000-0000-4000-8000-000000000001',
    'be000000-0000-4000-8000-000000000001',
    'be900000-0000-4000-8000-000000000004',
    jsonb_build_object(
      'firstName', 'Maya', 'lastName', 'Chen', 'preferredName', 'Maya',
      'schoolEmail', 'maya@school.test', 'personalEmail', 'maya@example.test',
      'cohortId', 'be200000-0000-4000-8000-000000000001',
      'nicknames', jsonb_build_array('May')
    )
  ) ->> 'idempotent'),
  'true',
  'an exact canonical replay returns the committed result'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE organization_id = 'be100000-0000-4000-8000-000000000001'),
  1,
  'exact replay cannot duplicate the profile'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'be900000-0000-4000-8000-000000000004'),
  1,
  'exact replay cannot duplicate audit history'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_profile(
    'be100000-0000-4000-8000-000000000001',
    'be000000-0000-4000-8000-000000000001',
    'be900000-0000-4000-8000-000000000004',
    jsonb_build_object(
      'firstName', 'Maya', 'lastName', 'Chen', 'preferredName', 'Different',
      'schoolEmail', 'maya@school.test', 'personalEmail', 'maya@example.test',
      'cohortId', 'be200000-0000-4000-8000-000000000001',
      'nicknames', jsonb_build_array('May')
    )
  )$$,
  'P0001', 'That profile-save request identifier is already bound to different content.',
  'a request UUID cannot be rebound to different profile content'
);
SELECT extensions.is(
  (SELECT preferred_name FROM plugin_data.csf_profiles WHERE normalized_first_name = 'maya' AND normalized_last_name = 'chen'),
  'Maya',
  'a conflicting replay leaves the profile unchanged'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_profile(
    'be100000-0000-4000-8000-000000000001',
    'be000000-0000-4000-8000-000000000001',
    'be900000-0000-4000-8000-000000000005',
    jsonb_build_object('firstName', ' MÁYA ', 'lastName', 'CHEN', 'cohortId', 'be200000-0000-4000-8000-000000000001', 'nicknames', '[]'::jsonb)
  )$$,
  'P0001', 'Another active CSF member already has this normalized name. Review the existing record instead of creating a duplicate.',
  'canonical name identity prevents a duplicate member'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE organization_id = 'be100000-0000-4000-8000-000000000001'),
  1,
  'a duplicate normalized name writes no profile'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_profile(
    'be100000-0000-4000-8000-000000000001',
    'be000000-0000-4000-8000-000000000001',
    'be900000-0000-4000-8000-000000000006',
    jsonb_build_object(
      'firstName', 'Jordan', 'lastName', 'Lee',
      'personalEmail', 'MAYA@SCHOOL.TEST',
      'cohortId', 'be200000-0000-4000-8000-000000000001', 'nicknames', '[]'::jsonb
    )
  )$$,
  'P0001', 'Another active CSF member already uses one of these email addresses. Review or link the existing record instead.',
  'an email cannot move between school and personal slots to evade duplicate detection'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE organization_id = 'be100000-0000-4000-8000-000000000001'),
  1,
  'a duplicate cross-slot email writes no profile'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_upsert_profile(
    'be100000-0000-4000-8000-000000000001',
    'be000000-0000-4000-8000-000000000001',
    'be900000-0000-4000-8000-000000000007',
    jsonb_build_object(
      'profileId', (SELECT id FROM plugin_data.csf_profiles WHERE normalized_first_name = 'maya' AND normalized_last_name = 'chen'),
      'firstName', 'Maya', 'lastName', 'Chen', 'preferredName', 'May',
      'schoolEmail', 'maya@school.test', 'personalEmail', 'maya@example.test',
      'cohortId', 'be200000-0000-4000-8000-000000000002',
      'nicknames', jsonb_build_array('May')
    )
  )$$,
  'editing a profile and transferring its current class commits atomically'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_profile_cohort_memberships WHERE cohort_id = 'be200000-0000-4000-8000-000000000001'),
  'transferred',
  'the prior active class becomes transferred history'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_profile_cohort_memberships WHERE cohort_id = 'be200000-0000-4000-8000-000000000002'),
  'active',
  'the selected class becomes the one active membership'
);
SELECT extensions.is(
  (SELECT preferred_name FROM plugin_data.csf_profiles WHERE normalized_first_name = 'maya' AND normalized_last_name = 'chen'),
  'May',
  'the identity edit commits with the class transfer'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_profile(
    'be100000-0000-4000-8000-000000000001',
    'be000000-0000-4000-8000-000000000001',
    'be900000-0000-4000-8000-000000000008',
    jsonb_build_object(
      'profileId', 'be400000-0000-4000-8000-000000000099',
      'firstName', 'Changed', 'lastName', 'Student', 'nicknames', '[]'::jsonb
    )
  )$$,
  'P0001', 'CSF member profile was not found in this organization.',
  'an actor cannot edit another organization profile'
);
SELECT extensions.is(
  (SELECT first_name FROM plugin_data.csf_profiles WHERE id = 'be400000-0000-4000-8000-000000000099'),
  'Other',
  'the cross-tenant profile remains unchanged'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_profile(
    'be100000-0000-4000-8000-000000000001',
    'be000000-0000-4000-8000-000000000001',
    'be900000-0000-4000-8000-000000000009',
    jsonb_build_object(
      'profileId', (SELECT id FROM plugin_data.csf_profiles WHERE normalized_first_name = 'maya' AND normalized_last_name = 'chen'),
      'firstName', 'Maya', 'lastName', 'Chen', 'preferredName', 'Cross term',
      'schoolEmail', 'maya@school.test', 'personalEmail', 'maya@example.test',
      'cohortId', 'be200000-0000-4000-8000-000000000002',
      'termId', 'be300000-0000-4000-8000-000000000003',
      'termMembershipStatus', 'needs_review', 'nicknames', jsonb_build_array('May')
    )
  )$$,
  'P0001', 'The selected semester was not found in this organization.',
  'an actor cannot attach another organization semester'
);
SELECT extensions.is(
  (SELECT preferred_name FROM plugin_data.csf_profiles WHERE normalized_first_name = 'maya' AND normalized_last_name = 'chen'),
  'May',
  'cross-tenant semester rejection rolls back the profile edit'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_profile(
    'be100000-0000-4000-8000-000000000001',
    'be000000-0000-4000-8000-000000000001',
    'be900000-0000-4000-8000-000000000010',
    jsonb_build_object(
      'profileId', (SELECT id FROM plugin_data.csf_profiles WHERE normalized_first_name = 'maya' AND normalized_last_name = 'chen'),
      'firstName', 'Maya', 'lastName', 'Chen', 'preferredName', 'Unlinked term',
      'schoolEmail', 'maya@school.test', 'personalEmail', 'maya@example.test',
      'cohortId', 'be200000-0000-4000-8000-000000000002',
      'termId', 'be300000-0000-4000-8000-000000000002',
      'termMembershipStatus', 'needs_review', 'nicknames', jsonb_build_array('May')
    )
  )$$,
  'P0001', 'The selected graduating class is not actively linked to this semester.',
  'a semester request requires an existing exact class-semester link'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_term_applications WHERE organization_id = 'be100000-0000-4000-8000-000000000001'),
  0,
  'a missing class-semester link leaves no application'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_upsert_profile(
    'be100000-0000-4000-8000-000000000001',
    'be000000-0000-4000-8000-000000000001',
    'be900000-0000-4000-8000-000000000011',
    jsonb_build_object(
      'profileId', (SELECT id FROM plugin_data.csf_profiles WHERE normalized_first_name = 'maya' AND normalized_last_name = 'chen'),
      'firstName', 'Maya', 'lastName', 'Chen', 'preferredName', 'May',
      'schoolEmail', 'maya@school.test', 'personalEmail', 'maya@example.test',
      'cohortId', 'be200000-0000-4000-8000-000000000002',
      'termId', 'be300000-0000-4000-8000-000000000001',
      'termMembershipStatus', 'needs_review', 'nicknames', jsonb_build_array('May')
    )
  )$$,
  'profile, class, and pending application state commit together'
);
SELECT extensions.results_eq(
  $$SELECT status, submission_status::text, decision_status::text, source
    FROM plugin_data.csf_term_applications
    WHERE organization_id = 'be100000-0000-4000-8000-000000000001'$$,
  $$VALUES ('needs_review'::text, 'ready'::text, 'pending'::text, 'manual'::text)$$,
  'the manual application projection is pending review rather than silently accepted'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_application_status_events WHERE correlation_id = 'be900000-0000-4000-8000-000000000011'),
  1,
  'the pending application transition has correlated history'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'be900000-0000-4000-8000-000000000011'),
  1,
  'the pending application and profile update share one request receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_term_applications WHERE organization_id = 'be100000-0000-4000-8000-000000000001'),
  1,
  'the pending request creates exactly one application'
);

UPDATE plugin_data.csf_term_applications
SET eligibility_status = 'eligible'
WHERE organization_id = 'be100000-0000-4000-8000-000000000001';

UPDATE plugin_data.csf_application_checks
SET status = 'passed',
    summary = 'Verified for atomic profile decision test.',
    details = CASE
      WHEN check_type = 'academic_eligibility'
        THEN jsonb_build_object('policyVersion', 1)
      ELSE coalesce(details, '{}'::jsonb)
    END,
    reviewed_by = 'be000000-0000-4000-8000-000000000001',
    reviewed_at = now(),
    updated_at = now()
WHERE organization_id = 'be100000-0000-4000-8000-000000000001';

INSERT INTO plugin_data.csf_application_course_entries (
  organization_id, application_id, course_list, course_name, grade, points, is_bonus
)
SELECT
  application.organization_id,
  application.id,
  course.course_list,
  course.course_name,
  'A',
  course.points,
  course.is_bonus
FROM plugin_data.csf_term_applications AS application
JOIN (
  VALUES
    ('I'::text, 'Synthetic List I A', 3::numeric, true),
    ('I'::text, 'Synthetic List I A 2', 3::numeric, false),
    ('II'::text, 'Synthetic List II A', 2::numeric, true)
) AS course(course_list, course_name, points, is_bonus) ON true
WHERE application.organization_id = 'be100000-0000-4000-8000-000000000001';

UPDATE plugin_data.csf_dues_records
SET status = 'verified',
    paid_amount = required_amount,
    source = 'manual',
    verified_by = 'be000000-0000-4000-8000-000000000001',
    verified_at = now(),
    updated_at = now()
WHERE organization_id = 'be100000-0000-4000-8000-000000000001';

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_upsert_profile(
    'be100000-0000-4000-8000-000000000001',
    'be000000-0000-4000-8000-000000000001',
    'be900000-0000-4000-8000-000000000012',
    jsonb_build_object(
      'profileId', (SELECT id FROM plugin_data.csf_profiles WHERE normalized_first_name = 'maya' AND normalized_last_name = 'chen'),
      'firstName', 'Maya', 'lastName', 'Chen', 'preferredName', 'May',
      'schoolEmail', 'maya@school.test', 'personalEmail', 'maya@example.test',
      'cohortId', 'be200000-0000-4000-8000-000000000002',
      'termId', 'be300000-0000-4000-8000-000000000001',
      'termMembershipStatus', 'accepted', 'nicknames', jsonb_build_array('May')
    )
  )$$,
  'a fully reviewed application can be accepted inside the same profile transaction'
);
SELECT extensions.results_eq(
  $$SELECT status, submission_status::text, decision_status::text
    FROM plugin_data.csf_term_applications
    WHERE organization_id = 'be100000-0000-4000-8000-000000000001'$$,
  $$VALUES ('accepted'::text, 'decided'::text, 'approved'::text)$$,
  'accepted application status is coherent across legacy and normalized fields'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_term_memberships WHERE organization_id = 'be100000-0000-4000-8000-000000000001'),
  'accepted',
  'accepted application creates the matching term membership atomically'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE action = 'application.accepted' AND organization_id = 'be100000-0000-4000-8000-000000000001'),
  1,
  'the decision engine writes its immutable acceptance audit'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'be900000-0000-4000-8000-000000000012'),
  1,
  'the encompassing profile transaction writes one request receipt'
);
SELECT extensions.is(
  (plugin_data.csf_upsert_profile(
    'be100000-0000-4000-8000-000000000001',
    'be000000-0000-4000-8000-000000000001',
    'be900000-0000-4000-8000-000000000012',
    jsonb_build_object(
      'profileId', (SELECT id FROM plugin_data.csf_profiles WHERE normalized_first_name = 'maya' AND normalized_last_name = 'chen'),
      'firstName', 'Maya', 'lastName', 'Chen', 'preferredName', 'May',
      'schoolEmail', 'maya@school.test', 'personalEmail', 'maya@example.test',
      'cohortId', 'be200000-0000-4000-8000-000000000002',
      'termId', 'be300000-0000-4000-8000-000000000001',
      'termMembershipStatus', 'accepted', 'nicknames', jsonb_build_array('May')
    )
  ) ->> 'idempotent'),
  'true',
  'exact accepted-decision replay returns the prior result'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_application_status_events WHERE organization_id = 'be100000-0000-4000-8000-000000000001'),
  2,
  'accepted replay does not duplicate pending or decision history'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'be900000-0000-4000-8000-000000000012'),
  1,
  'accepted replay does not duplicate the profile receipt'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_profile(
    'be100000-0000-4000-8000-000000000001',
    'be000000-0000-4000-8000-000000000004',
    'be900000-0000-4000-8000-000000000013',
    jsonb_build_object(
      'profileId', (SELECT id FROM plugin_data.csf_profiles WHERE normalized_first_name = 'maya' AND normalized_last_name = 'chen'),
      'firstName', 'Maya', 'lastName', 'Chen', 'preferredName', 'Not allowed',
      'schoolEmail', 'maya@school.test', 'personalEmail', 'maya@example.test',
      'cohortId', 'be200000-0000-4000-8000-000000000002',
      'termId', 'be300000-0000-4000-8000-000000000001',
      'termMembershipStatus', 'accepted', 'nicknames', jsonb_build_array('May')
    )
  )$$,
  'P0001', 'Not authorized to accept CSF semester applications.',
  'profile-management permission alone cannot make an accepted decision'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'be900000-0000-4000-8000-000000000013'),
  0,
  'a rejected decision permission writes no receipt'
);
SELECT extensions.is(
  (SELECT preferred_name FROM plugin_data.csf_profiles WHERE normalized_first_name = 'maya' AND normalized_last_name = 'chen'),
  'May',
  'a rejected accepted-decision request cannot partially edit the profile'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_profile(
    'be100000-0000-4000-8000-000000000001',
    'be000000-0000-4000-8000-000000000001',
    'be900000-0000-4000-8000-000000000014',
    jsonb_build_object(
      'firstName', 'Incomplete', 'lastName', 'Review',
      'schoolEmail', 'incomplete@school.test',
      'cohortId', 'be200000-0000-4000-8000-000000000002',
      'termId', 'be300000-0000-4000-8000-000000000001',
      'termMembershipStatus', 'accepted', 'nicknames', '[]'::jsonb
    )
  )$$,
  'P0001', 'Application review is incomplete: 5 mandatory check(s) remain unresolved.',
  'a new manual application cannot bypass eligibility and accepted-decision checks'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE normalized_first_name = 'incomplete' AND normalized_last_name = 'review'),
  0,
  'failed acceptance rolls back the newly inserted profile'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_term_applications AS application JOIN plugin_data.csf_profiles AS profile ON profile.id = application.profile_id WHERE profile.normalized_first_name = 'incomplete'),
  0,
  'failed acceptance rolls back the application projection'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_cohort_memberships AS membership JOIN plugin_data.csf_profiles AS profile ON profile.id = membership.profile_id WHERE profile.normalized_first_name = 'incomplete'),
  0,
  'failed acceptance rolls back the class membership projection'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'be900000-0000-4000-8000-000000000014'),
  0,
  'failed acceptance writes no profile receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_cohorts WHERE organization_id = 'be100000-0000-4000-8000-000000000001'),
  2,
  'all failures and successes leave the configured class set unchanged'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_cohort_terms WHERE organization_id = 'be100000-0000-4000-8000-000000000001'),
  2,
  'all failures and successes leave class-semester configuration unchanged'
);

SELECT * FROM extensions.finish();
ROLLBACK;
