BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

-- ---------------------------------------------------------------------------
-- ACL: the award assertion and the intake trigger helper stay owner-only with
-- an explicit postgres grant; the intake switch stays service-only.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  pg_catalog.pg_get_userbyid(proc.proowner),
  'postgres',
  'the intake trigger helper is owned by postgres'
)
FROM pg_catalog.pg_proc AS proc
WHERE proc.oid = 'plugin_data.csf_enforce_new_application_intake()'::regprocedure;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    CROSS JOIN LATERAL pg_catalog.aclexplode(proc.proacl) AS acl
    WHERE proc.oid = 'plugin_data.csf_enforce_new_application_intake()'::regprocedure
      AND acl.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'postgres')
      AND acl.privilege_type = 'EXECUTE'
  ),
  'the intake trigger helper carries an explicit postgres execute grant'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    CROSS JOIN LATERAL pg_catalog.aclexplode(proc.proacl) AS acl
    WHERE proc.oid = 'plugin_data.csf_assert_activity_earning_award(uuid,uuid,uuid,uuid,numeric,jsonb,jsonb)'::regprocedure
      AND acl.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'postgres')
      AND acl.privilege_type = 'EXECUTE'
  ),
  'the replaced award assertion carries an explicit postgres execute grant'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS roles(role_name)
    CROSS JOIN (
      VALUES
        ('plugin_data.csf_enforce_new_application_intake()'),
        ('plugin_data.csf_assert_activity_earning_award(uuid,uuid,uuid,uuid,numeric,jsonb,jsonb)')
    ) AS routines(signature)
    WHERE pg_catalog.has_function_privilege(roles.role_name, routines.signature, 'EXECUTE')
  ),
  'anon, authenticated, and service_role cannot execute the trigger helper or the award assertion'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(proc.proacl, pg_catalog.acldefault('f', proc.proowner))
    ) AS acl
    WHERE proc.oid IN (
      'plugin_data.csf_enforce_new_application_intake()'::regprocedure,
      'plugin_data.csf_assert_activity_earning_award(uuid,uuid,uuid,uuid,numeric,jsonb,jsonb)'::regprocedure,
      'plugin_data.csf_set_application_intake(uuid,uuid,boolean,uuid)'::regprocedure
    )
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute the trigger helper, the award assertion, or the intake switch'
);

SELECT extensions.ok(
  pg_catalog.has_function_privilege('service_role', 'plugin_data.csf_set_application_intake(uuid,uuid,boolean,uuid)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('anon', 'plugin_data.csf_set_application_intake(uuid,uuid,boolean,uuid)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('authenticated', 'plugin_data.csf_set_application_intake(uuid,uuid,boolean,uuid)', 'EXECUTE'),
  'the intake switch remains reachable only through the server role'
);

SELECT extensions.is(
  (
    SELECT tgfoid::regprocedure::text
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'plugin_data.csf_term_applications'::regclass
      AND tgname = 'csf_term_applications_new_intake_guard'
  ),
  'plugin_data.csf_enforce_new_application_intake()',
  'the native intake guard trigger still points at the helper'
);

-- ---------------------------------------------------------------------------
-- Fixtures (fictional, e6 namespace)
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('e6000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ceiling-member@local.test', now(), '{}', '{}', now(), now()),
  ('e6000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'ceiling-officer@local.test', now(), '{}', '{}', now(), now()),
  ('e6000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'ceiling-applicant@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('e6100000-0000-4000-8000-000000000001', 'CSF Ceiling And Intake Guards', 'csf-ceiling-intake-guards', 'school', '850003');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('e6100000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'member', 'active'),
  ('e6100000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000002', 'admin', 'active'),
  ('e6100000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000003', 'member', 'active');

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, public_title, role_type, is_system
) VALUES (
  'e6200000-0000-4000-8000-000000000001', 'e6100000-0000-4000-8000-000000000001',
  'ceiling-officer', 'Ceiling officer', 'Ceiling officer', 'custom', false
);

INSERT INTO plugin_data.csf_role_permissions (organization_id, role_id, permission_key, enabled)
VALUES
  ('e6100000-0000-4000-8000-000000000001', 'e6200000-0000-4000-8000-000000000001', 'manage_opportunities', true),
  ('e6100000-0000-4000-8000-000000000001', 'e6200000-0000-4000-8000-000000000001', 'verify_submissions', true),
  ('e6100000-0000-4000-8000-000000000001', 'e6200000-0000-4000-8000-000000000001', 'process_points', true),
  ('e6100000-0000-4000-8000-000000000001', 'e6200000-0000-4000-8000-000000000001', 'manage_cohorts_terms', true);

INSERT INTO plugin_data.csf_staff_positions (
  organization_id, user_id, role_id, school_year, display_title, status, starts_at, ends_at
) VALUES (
  'e6100000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000002',
  'e6200000-0000-4000-8000-000000000001', '2099-2100', 'Ceiling officer', 'active',
  current_date - 1, current_date + 30
);

-- Current open term, a planned future term, and a previous term that is still
-- open but no longer current.
INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current, lifecycle_status
) VALUES
  ('e6300000-0000-4000-8000-000000000001', 'e6100000-0000-4000-8000-000000000001',
   'F99', 'Fall 2099', '2099-2100', 'fall', true, 'open'),
  ('e6300000-0000-4000-8000-000000000002', 'e6100000-0000-4000-8000-000000000001',
   'S00', 'Spring 2100', '2099-2100', 'spring', false, 'planned'),
  ('e6300000-0000-4000-8000-000000000003', 'e6100000-0000-4000-8000-000000000001',
   'S99', 'Spring 2099', '2098-2099', 'spring', false, 'open');

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label, status)
VALUES ('e6310000-0000-4000-8000-000000000001', 'e6100000-0000-4000-8000-000000000001', 2100, 'Class of 2100', 'active');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name, record_status
) VALUES
  ('e6400000-0000-4000-8000-000000000001', 'e6100000-0000-4000-8000-000000000001',
   'Ceiling', 'Member', 'ceiling', 'member', 'active'),
  ('e6400000-0000-4000-8000-000000000002', 'e6100000-0000-4000-8000-000000000001',
   'Current', 'Applicant', 'current', 'applicant', 'active'),
  ('e6400000-0000-4000-8000-000000000003', 'e6100000-0000-4000-8000-000000000001',
   'Future', 'Applicant', 'future', 'applicant', 'active');

INSERT INTO plugin_data.csf_profile_accounts (organization_id, profile_id, user_id, status, is_primary)
VALUES ('e6100000-0000-4000-8000-000000000001', 'e6400000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'verified', true);

INSERT INTO plugin_data.csf_term_memberships (
  organization_id, profile_id, term_id, cohort_id, status, accepted_at
) VALUES (
  'e6100000-0000-4000-8000-000000000001', 'e6400000-0000-4000-8000-000000000001',
  'e6300000-0000-4000-8000-000000000001', 'e6310000-0000-4000-8000-000000000001', 'accepted', now()
);

-- The semester cap (4) sits above every component ceiling so the tests below
-- exercise the rule ceilings rather than the semester limit.
INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, max_points_per_activity, outside_volunteering_allowed, published_at
) VALUES (
  'e6100000-0000-4000-8000-000000000001', 'e6300000-0000-4000-8000-000000000001', 4, true, now()
);

CREATE TEMPORARY TABLE guard_results (label text PRIMARY KEY, result jsonb NOT NULL);

-- Mixed per-item rules: non-drive bookmarks up to 3, drive cards up to 2.
INSERT INTO guard_results (label, result)
SELECT 'mixed-per-item', plugin_data.csf_create_activity(
  'e6100000-0000-4000-8000-000000000001',
  'e6300000-0000-4000-8000-000000000001',
  NULL,
  pg_catalog.jsonb_build_object(
    'status', 'published',
    'title', 'Bookmarks and cards',
    'signupMode', 'none',
    'requiresPointSubmission', true,
    'evidencePolicy', 'optional',
    'earningRules', pg_catalog.jsonb_build_object(
      'version', 1,
      'mode', 'per_item',
      'components', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('key', 'bookmark', 'label', 'Bookmarks', 'category', 'non_drive', 'kind', 'per_item', 'unitLabel', 'bookmarks', 'pointsPerItem', 1, 'maxPoints', 3),
        pg_catalog.jsonb_build_object('key', 'cards', 'label', 'Cards', 'category', 'drive', 'kind', 'per_item', 'unitLabel', 'cards', 'pointsPerItem', 0.5, 'maxPoints', 2)
      )
    )
  ),
  'e6000000-0000-4000-8000-000000000002',
  'e6800000-0000-4000-8000-000000000001'
);

-- Mixed shifts with multiple shifts allowed: non-drive morning (1), drive
-- afternoon (2), combined maximum 3.
INSERT INTO guard_results (label, result)
SELECT 'mixed-shifts', plugin_data.csf_create_activity(
  'e6100000-0000-4000-8000-000000000001',
  'e6300000-0000-4000-8000-000000000001',
  NULL,
  pg_catalog.jsonb_build_object(
    'status', 'published',
    'title', 'Festival shifts',
    'signupMode', 'none',
    'requiresPointSubmission', true,
    'evidencePolicy', 'optional',
    'earningRules', pg_catalog.jsonb_build_object(
      'version', 1,
      'mode', 'shifts',
      'shiftPolicy', pg_catalog.jsonb_build_object('allowMultiple', true, 'combinedMaxPoints', 3),
      'components', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('key', 'am', 'label', 'Morning', 'category', 'non_drive', 'kind', 'shift', 'points', 1),
        pg_catalog.jsonb_build_object('key', 'pm', 'label', 'Afternoon', 'category', 'drive', 'kind', 'shift', 'points', 2)
      )
    )
  ),
  'e6000000-0000-4000-8000-000000000002',
  'e6800000-0000-4000-8000-000000000002'
);

-- Single-shift policy: one shift per submission, so the ceiling is the
-- selected shift's own points even though the combined maximum is higher.
INSERT INTO guard_results (label, result)
SELECT 'single-shift', plugin_data.csf_create_activity(
  'e6100000-0000-4000-8000-000000000001',
  'e6300000-0000-4000-8000-000000000001',
  NULL,
  pg_catalog.jsonb_build_object(
    'status', 'published',
    'title', 'Evening shifts',
    'signupMode', 'none',
    'requiresPointSubmission', true,
    'evidencePolicy', 'optional',
    'earningRules', pg_catalog.jsonb_build_object(
      'version', 1,
      'mode', 'shifts',
      'shiftPolicy', pg_catalog.jsonb_build_object('allowMultiple', false, 'combinedMaxPoints', 3),
      'components', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('key', 'early', 'label', 'Early evening', 'category', 'non_drive', 'kind', 'shift', 'points', 1),
        pg_catalog.jsonb_build_object('key', 'late', 'label', 'Late evening', 'category', 'non_drive', 'kind', 'shift', 'points', 2)
      )
    )
  ),
  'e6000000-0000-4000-8000-000000000002',
  'e6800000-0000-4000-8000-000000000003'
);

SELECT extensions.ok(
  (
    SELECT activity.point_value = 3 AND activity.point_type = 'non_drive'
    FROM plugin_data.csf_opportunities AS activity
    WHERE activity.id = (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'mixed-per-item')
  ),
  'the mixed per-item activity stores the larger non-drive ceiling as its activity-wide ceiling'
);

-- ---------------------------------------------------------------------------
-- Award assertion: selected components bound an override, not the activity
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_assert_activity_earning_award(
    'e6100000-0000-4000-8000-000000000001',
    'e6400000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'mixed-per-item'),
    'e6900000-0000-4000-8000-0000000000ff',
    3,
    (SELECT earning_rules FROM plugin_data.csf_opportunities WHERE id = (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'mixed-per-item')),
    '{"version":1,"items":[{"key":"cards","quantity":2}]}'::jsonb
  ) $$,
  'P0001',
  'Awarded points exceed the maximum of 2 for the selected drive items.',
  'per-item: 3 points on the 2-point drive component is refused although the activity ceiling is 3'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_assert_activity_earning_award(
    'e6100000-0000-4000-8000-000000000001',
    'e6400000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'mixed-per-item'),
    'e6900000-0000-4000-8000-0000000000ff',
    2,
    (SELECT earning_rules FROM plugin_data.csf_opportunities WHERE id = (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'mixed-per-item')),
    '{"version":1,"items":[{"key":"cards","quantity":2}]}'::jsonb
  ) $$,
  'per-item: an override up to the selected drive component maximum is accepted'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_assert_activity_earning_award(
    'e6100000-0000-4000-8000-000000000001',
    'e6400000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'mixed-per-item'),
    'e6900000-0000-4000-8000-0000000000ff',
    3,
    (SELECT earning_rules FROM plugin_data.csf_opportunities WHERE id = (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'mixed-per-item')),
    '{"version":1,"items":[{"key":"bookmark","quantity":1}]}'::jsonb
  ) $$,
  'per-item: an override up to the selected non-drive component maximum is accepted'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_assert_activity_earning_award(
    'e6100000-0000-4000-8000-000000000001',
    'e6400000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'mixed-per-item'),
    'e6900000-0000-4000-8000-0000000000ff',
    3.5,
    (SELECT earning_rules FROM plugin_data.csf_opportunities WHERE id = (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'mixed-per-item')),
    '{"version":1,"items":[{"key":"bookmark","quantity":1}]}'::jsonb
  ) $$,
  'P0001',
  'Awarded points exceed this submission''s maximum of 3.',
  'per-item: the activity-wide ceiling still applies first'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_assert_activity_earning_award(
    'e6100000-0000-4000-8000-000000000001',
    'e6400000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'mixed-per-item'),
    'e6900000-0000-4000-8000-0000000000ff',
    1,
    (SELECT earning_rules FROM plugin_data.csf_opportunities WHERE id = (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'mixed-per-item')),
    '{"version":1,"items":[{"key":"bookmark","quantity":1},{"key":"cards","quantity":1}]}'::jsonb
  ) $$,
  'P0001',
  'Submit drive and non-drive items as separate submissions.',
  'per-item: a selection that mixes categories cannot be awarded'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_assert_activity_earning_award(
    'e6100000-0000-4000-8000-000000000001',
    'e6400000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'mixed-per-item'),
    'e6900000-0000-4000-8000-0000000000ff',
    1,
    (SELECT earning_rules FROM plugin_data.csf_opportunities WHERE id = (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'mixed-per-item')),
    '{"version":1,"items":[{"key":"posters","quantity":1}]}'::jsonb
  ) $$,
  'P0001',
  'Selection refers to an unknown component.',
  'per-item: a selection naming no component of the snapshot fails closed'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_assert_activity_earning_award(
    'e6100000-0000-4000-8000-000000000001',
    'e6400000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'mixed-shifts'),
    'e6900000-0000-4000-8000-0000000000ff',
    2,
    (SELECT earning_rules FROM plugin_data.csf_opportunities WHERE id = (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'mixed-shifts')),
    '{"version":1,"items":[{"key":"am"}]}'::jsonb
  ) $$,
  'P0001',
  'Awarded points exceed the maximum of 1 for the selected non-drive items.',
  'shifts: 2 points on the 1-point non-drive shift is refused although the drive shift sets the activity ceiling'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_assert_activity_earning_award(
    'e6100000-0000-4000-8000-000000000001',
    'e6400000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'mixed-shifts'),
    'e6900000-0000-4000-8000-0000000000ff',
    2,
    (SELECT earning_rules FROM plugin_data.csf_opportunities WHERE id = (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'mixed-shifts')),
    '{"version":1,"items":[{"key":"pm"}]}'::jsonb
  ) $$,
  'shifts: the selected drive shift may be awarded its own points'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_assert_activity_earning_award(
    'e6100000-0000-4000-8000-000000000001',
    'e6400000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'single-shift'),
    'e6900000-0000-4000-8000-0000000000ff',
    2,
    (SELECT earning_rules FROM plugin_data.csf_opportunities WHERE id = (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'single-shift')),
    '{"version":1,"items":[{"key":"early"}]}'::jsonb
  ) $$,
  'P0001',
  'Awarded points exceed the maximum of 1 for the selected non-drive items.',
  'shifts without allowMultiple: the ceiling is the selected shift, not the combined maximum'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_assert_activity_earning_award(
    'e6100000-0000-4000-8000-000000000001',
    'e6400000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'single-shift'),
    'e6900000-0000-4000-8000-0000000000ff',
    2,
    (SELECT earning_rules FROM plugin_data.csf_opportunities WHERE id = (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'single-shift')),
    '{"version":1,"items":[{"key":"late"}]}'::jsonb
  ) $$,
  'shifts without allowMultiple: the larger selected shift may be awarded its own points'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_assert_activity_earning_award(
    'e6100000-0000-4000-8000-000000000001',
    'e6400000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'mixed-per-item'),
    'e6900000-0000-4000-8000-0000000000ff',
    1,
    '{"version":1,"mode":"fixed","legacy":true,"components":[{"key":"fixed","label":"Activity credit","category":"non_drive","kind":"fixed","points":1}]}'::jsonb,
    '{"version":1,"items":[{"key":"fixed"}]}'::jsonb
  ) $$,
  'a legacy fixed snapshot keeps bypassing the rule ceilings'
);

-- ---------------------------------------------------------------------------
-- Review path: the officer override with a note is bounded the same way
-- ---------------------------------------------------------------------------

INSERT INTO guard_results (label, result)
SELECT 'cards-begin', plugin_data.csf_begin_point_submission_request_v2(
  'e6100000-0000-4000-8000-000000000001',
  'e6400000-0000-4000-8000-000000000001',
  'e6300000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'mixed-per-item'),
  NULL, 'student', 'Two cards.', 1, 'drive', '2099-10-03',
  'e6000000-0000-4000-8000-000000000001',
  NULL, NULL, NULL, NULL,
  'e6600000-0000-4000-8000-000000000001',
  '{"version":1,"items":[{"key":"cards","quantity":2}]}'::jsonb
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_submission_request(
    'e6100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM guard_results WHERE label = 'cards-begin'),
    'approved', 3, 'Member brought many more cards than claimed.',
    'e6000000-0000-4000-8000-000000000002',
    'e6700000-0000-4000-8000-000000000001'
  ) $$,
  'P0001',
  'Awarded points exceed the maximum of 2 for the selected drive items.',
  'review: a noted override of 3 on the 2-point drive selection is refused'
);

SELECT extensions.ok(
  (
    SELECT submission.status = 'submitted' AND submission.reviewed_at IS NULL
    FROM plugin_data.csf_point_submissions AS submission
    WHERE submission.id = (SELECT (result ->> 'submissionId')::uuid FROM guard_results WHERE label = 'cards-begin')
  )
  AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_credit_records
    WHERE submission_id = (SELECT (result ->> 'submissionId')::uuid FROM guard_results WHERE label = 'cards-begin')
  )
  AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_admin_audit_events
    WHERE correlation_id = 'e6700000-0000-4000-8000-000000000001'
  ),
  'review: the refused override leaves no review state, credit, or receipt'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_review_point_submission_request(
    'e6100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM guard_results WHERE label = 'cards-begin'),
    'approved', 2, 'Member brought four cards.',
    'e6000000-0000-4000-8000-000000000002',
    'e6700000-0000-4000-8000-000000000002'
  ) $$,
  'review: a noted override up to the selected drive component maximum is approved'
);

SELECT extensions.ok(
  (
    SELECT credit.points = 2 AND credit.point_type = 'drive' AND credit.status = 'verified'
    FROM plugin_data.csf_credit_records AS credit
    WHERE credit.submission_id = (SELECT (result ->> 'submissionId')::uuid FROM guard_results WHERE label = 'cards-begin')
  ),
  'review: the accepted override produces one verified drive credit at the awarded value'
);

-- ---------------------------------------------------------------------------
-- Appeal path: the shared assertion bounds an approved appeal the same way
-- ---------------------------------------------------------------------------

INSERT INTO guard_results (label, result)
SELECT 'cards-appeal', plugin_data.csf_submit_point_appeal_request(
  'e6100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'submissionId')::uuid FROM guard_results WHERE label = 'cards-begin'),
  'The activity ceiling is 3, so the cards should count for 3.',
  3,
  'e6000000-0000-4000-8000-000000000001',
  'e6700000-0000-4000-8000-000000000003'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_appeal_request(
    'e6100000-0000-4000-8000-000000000001',
    (SELECT appeal.id FROM plugin_data.csf_point_appeals AS appeal
      WHERE appeal.submission_id = (SELECT (result ->> 'submissionId')::uuid FROM guard_results WHERE label = 'cards-begin')
        AND appeal.status = 'submitted'),
    'approved', 'Granting the requested three points.',
    'e6000000-0000-4000-8000-000000000002',
    'e6700000-0000-4000-8000-000000000004'
  ) $$,
  'P0001',
  'Awarded points exceed the maximum of 2 for the selected drive items.',
  'appeal: approving a request above the selected drive component maximum is refused'
);

SELECT extensions.ok(
  (
    SELECT appeal.status = 'submitted'
    FROM plugin_data.csf_point_appeals AS appeal
    WHERE appeal.submission_id = (SELECT (result ->> 'submissionId')::uuid FROM guard_results WHERE label = 'cards-begin')
  )
  AND (
    SELECT credit.points = 2 AND credit.status = 'verified'
    FROM plugin_data.csf_credit_records AS credit
    WHERE credit.submission_id = (SELECT (result ->> 'submissionId')::uuid FROM guard_results WHERE label = 'cards-begin')
  )
  AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_admin_audit_events
    WHERE correlation_id = 'e6700000-0000-4000-8000-000000000004'
  ),
  'appeal: the refused decision leaves the appeal open and the verified credit unchanged'
);

INSERT INTO guard_results (label, result)
SELECT 'bookmark-begin', plugin_data.csf_begin_point_submission_request_v2(
  'e6100000-0000-4000-8000-000000000001',
  'e6400000-0000-4000-8000-000000000001',
  'e6300000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'mixed-per-item'),
  NULL, 'student', 'One bookmark.', 1, 'non_drive', '2099-10-04',
  'e6000000-0000-4000-8000-000000000001',
  NULL, NULL, NULL, NULL,
  'e6600000-0000-4000-8000-000000000002',
  '{"version":1,"items":[{"key":"bookmark","quantity":1}]}'::jsonb
);

SELECT plugin_data.csf_review_point_submission_request(
  'e6100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'submissionId')::uuid FROM guard_results WHERE label = 'bookmark-begin'),
  'approved', 1, NULL,
  'e6000000-0000-4000-8000-000000000002',
  'e6700000-0000-4000-8000-000000000005'
);

INSERT INTO guard_results (label, result)
SELECT 'bookmark-appeal', plugin_data.csf_submit_point_appeal_request(
  'e6100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'submissionId')::uuid FROM guard_results WHERE label = 'bookmark-begin'),
  'Two bookmarks were in the photo, not one.',
  2,
  'e6000000-0000-4000-8000-000000000001',
  'e6700000-0000-4000-8000-000000000006'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_review_point_appeal_request(
    'e6100000-0000-4000-8000-000000000001',
    (SELECT appeal.id FROM plugin_data.csf_point_appeals AS appeal
      WHERE appeal.submission_id = (SELECT (result ->> 'submissionId')::uuid FROM guard_results WHERE label = 'bookmark-begin')
        AND appeal.status = 'submitted'),
    'approved', 'The photo shows two bookmarks.',
    'e6000000-0000-4000-8000-000000000002',
    'e6700000-0000-4000-8000-000000000007'
  ) $$,
  'appeal: a request within the selected non-drive component maximum is approved'
);

SELECT extensions.is(
  (
    SELECT sum(credit.points)::numeric
    FROM plugin_data.csf_credit_records AS credit
    WHERE credit.opportunity_id = (SELECT (result ->> 'activityId')::uuid FROM guard_results WHERE label = 'mixed-per-item')
      AND credit.profile_id = 'e6400000-0000-4000-8000-000000000001'
      AND credit.status = 'verified'
  ),
  4::numeric,
  'appeal: the approved appeal raises the bookmark credit to 2 alongside the 2-point cards credit'
);

-- ---------------------------------------------------------------------------
-- Intake: only the current open semester can be opened
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_set_application_intake(
    'e6100000-0000-4000-8000-000000000001', 'e6300000-0000-4000-8000-000000000002',
    true, 'e6000000-0000-4000-8000-000000000002'
  ) $$,
  '23514',
  'Only the current open CSF semester can accept new applications.',
  'intake: a planned future semester cannot be opened'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_set_application_intake(
    'e6100000-0000-4000-8000-000000000001', 'e6300000-0000-4000-8000-000000000003',
    true, 'e6000000-0000-4000-8000-000000000002'
  ) $$,
  '23514',
  'Only the current open CSF semester can accept new applications.',
  'intake: a previous semester that is still open but not current cannot be opened'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_terms
    WHERE organization_id = 'e6100000-0000-4000-8000-000000000001'
      AND accepts_new_applications
  )
  AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'e6100000-0000-4000-8000-000000000001'
      AND action = 'application_intake.opened'
  ),
  'intake: refused opens leave every semester closed with no audit receipt'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_set_application_intake(
    'e6100000-0000-4000-8000-000000000001', 'e6300000-0000-4000-8000-000000000001',
    true, 'e6000000-0000-4000-8000-000000000001'
  ) $$,
  '42501',
  'Not authorized to manage CSF application intake.',
  'intake: a member cannot open the current semester'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_set_application_intake(
    'e6100000-0000-4000-8000-000000000001', 'e6300000-0000-4000-8000-000000000001',
    NULL, 'e6000000-0000-4000-8000-000000000002'
  ) $$,
  '22004',
  'Choose whether this semester accepts new applications.',
  'intake: a null switch value is refused'
);

SELECT extensions.is(
  (
    plugin_data.csf_set_application_intake(
      'e6100000-0000-4000-8000-000000000001', 'e6300000-0000-4000-8000-000000000001',
      true, 'e6000000-0000-4000-8000-000000000002'
    ) ->> 'changed'
  )::boolean,
  true,
  'intake: the current open semester can be opened'
);

SELECT extensions.ok(
  (SELECT accepts_new_applications FROM plugin_data.csf_terms WHERE id = 'e6300000-0000-4000-8000-000000000001')
  AND EXISTS (
    SELECT 1 FROM plugin_data.csf_admin_audit_events
    WHERE action = 'application_intake.opened'
      AND term_id = 'e6300000-0000-4000-8000-000000000001'
      AND actor_user_id = 'e6000000-0000-4000-8000-000000000002'
  ),
  'intake: opening the current semester records its actor and term'
);

SELECT extensions.lives_ok(
  $$ INSERT INTO plugin_data.csf_term_applications (organization_id, profile_id, cohort_id, term_id, source, status)
     VALUES ('e6100000-0000-4000-8000-000000000001', 'e6400000-0000-4000-8000-000000000002',
             'e6310000-0000-4000-8000-000000000001', 'e6300000-0000-4000-8000-000000000001', 'native', 'submitted') $$,
  'intake: a native application reaches the opened current semester'
);

SELECT extensions.throws_ok(
  $$ INSERT INTO plugin_data.csf_term_applications (organization_id, profile_id, cohort_id, term_id, source, status)
     VALUES ('e6100000-0000-4000-8000-000000000001', 'e6400000-0000-4000-8000-000000000003',
             'e6310000-0000-4000-8000-000000000001', 'e6300000-0000-4000-8000-000000000002', 'native', 'submitted') $$,
  '23514',
  'New applications are closed for this semester.',
  'intake: a native application for the future semester is still refused by the trigger'
);

SELECT extensions.is(
  (
    plugin_data.csf_set_application_intake(
      'e6100000-0000-4000-8000-000000000001', 'e6300000-0000-4000-8000-000000000003',
      false, 'e6000000-0000-4000-8000-000000000002'
    ) ->> 'changed'
  )::boolean,
  false,
  'intake: closing an already closed previous semester remains a no-op'
);

-- Switching the current semester moves the right to open intake with it.
SELECT plugin_data.csf_set_current_term(
  'e6100000-0000-4000-8000-000000000001',
  'e6300000-0000-4000-8000-000000000003',
  'e6000000-0000-4000-8000-000000000002'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_set_application_intake(
    'e6100000-0000-4000-8000-000000000001', 'e6300000-0000-4000-8000-000000000001',
    true, 'e6000000-0000-4000-8000-000000000002'
  ) $$,
  '23514',
  'Only the current open CSF semester can accept new applications.',
  'intake: re-opening a semester that stopped being current is refused even though it is already open'
);

SELECT extensions.is(
  (
    plugin_data.csf_set_application_intake(
      'e6100000-0000-4000-8000-000000000001', 'e6300000-0000-4000-8000-000000000001',
      false, 'e6000000-0000-4000-8000-000000000002'
    ) ->> 'changed'
  )::boolean,
  true,
  'intake: a semester that stopped being current can still be closed'
);

SELECT extensions.is(
  (
    plugin_data.csf_set_application_intake(
      'e6100000-0000-4000-8000-000000000001', 'e6300000-0000-4000-8000-000000000003',
      true, 'e6000000-0000-4000-8000-000000000002'
    ) ->> 'changed'
  )::boolean,
  true,
  'intake: the newly current open semester can be opened'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_terms
    WHERE organization_id = 'e6100000-0000-4000-8000-000000000001'
      AND accepts_new_applications
  ),
  1,
  'intake: exactly one semester accepts new applications after the switch'
);

SELECT extensions.finish();
ROLLBACK;
