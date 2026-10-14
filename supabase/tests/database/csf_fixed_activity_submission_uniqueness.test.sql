BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

-- Regression for 20260915054936: an approved fixed-award submission keeps
-- blocking a second claim on the same activity, while repeatable per_item
-- submissions and distinct shifts still pass.

SELECT extensions.ok(
  (
    SELECT idx.indisunique AND idx.indpred IS NOT NULL
    FROM pg_catalog.pg_index AS idx
    WHERE idx.indexrelid = 'plugin_data.csf_point_submissions_one_active_activity_claim_idx'::regclass
  ),
  'the active-claim index is still a partial unique index'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('fd000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'fixed-award-member@local.test', now(), '{}', '{}', now(), now()),
  ('fd000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'fixed-award-officer@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('fd100000-0000-4000-8000-000000000001', 'CSF Fixed Award', 'csf-fixed-award', 'school', '996102');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('fd100000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001', 'member', 'active'),
  ('fd100000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000002', 'admin', 'active');

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, public_title, role_type, is_system
) VALUES
  ('fd200000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001', 'fixed-award-officer', 'Fixed award officer', 'Fixed award officer', 'custom', false);

INSERT INTO plugin_data.csf_role_permissions (organization_id, role_id, permission_key, enabled)
VALUES
  ('fd100000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', 'manage_opportunities', true),
  ('fd100000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', 'verify_submissions', true),
  ('fd100000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', 'process_points', true);

INSERT INTO plugin_data.csf_staff_positions (
  organization_id, user_id, role_id, school_year, display_title, status, starts_at, ends_at
) VALUES (
  'fd100000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000002',
  'fd200000-0000-4000-8000-000000000001', '2099-2100', 'Fixed award officer', 'active',
  current_date - 1, current_date + 30
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current, lifecycle_status
) VALUES (
  'fd300000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001',
  'F99', 'Fall 2099', '2099-2100', 'fall', true, 'open'
);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label, status)
VALUES ('fd310000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001', 2100, 'Class of 2100', 'active');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name, record_status
) VALUES (
  'fd400000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001',
  'Fixed', 'Member', 'fixed', 'member', 'active'
);

INSERT INTO plugin_data.csf_profile_accounts (organization_id, profile_id, user_id, status, is_primary)
VALUES ('fd100000-0000-4000-8000-000000000001', 'fd400000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001', 'verified', true);

INSERT INTO plugin_data.csf_term_memberships (
  organization_id, profile_id, term_id, cohort_id, status, accepted_at
) VALUES (
  'fd100000-0000-4000-8000-000000000001', 'fd400000-0000-4000-8000-000000000001',
  'fd300000-0000-4000-8000-000000000001', 'fd310000-0000-4000-8000-000000000001', 'accepted', now()
);

-- The semester allows 3 points per activity, so a 1-point fixed award leaves
-- headroom for a repeat unless the index refuses it.
INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, max_points_per_activity, outside_volunteering_allowed, published_at
) VALUES (
  'fd100000-0000-4000-8000-000000000001', 'fd300000-0000-4000-8000-000000000001', 3, true, now()
);

CREATE TEMPORARY TABLE fixed_results (label text PRIMARY KEY, result jsonb NOT NULL);

INSERT INTO fixed_results (label, result)
SELECT 'fixed-activity', plugin_data.csf_create_activity(
  'fd100000-0000-4000-8000-000000000001',
  'fd300000-0000-4000-8000-000000000001',
  NULL,
  pg_catalog.jsonb_build_object(
    'status', 'published',
    'title', 'Club meeting attendance',
    'signupMode', 'none',
    'pointCap', 3,
    'requiresPointSubmission', true,
    'evidencePolicy', 'optional',
    'earningRules', pg_catalog.jsonb_build_object(
      'version', 1,
      'mode', 'fixed',
      'components', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('key', 'credit', 'label', 'Attendance credit', 'category', 'non_drive', 'kind', 'fixed', 'points', 1)
      )
    )
  ),
  'fd000000-0000-4000-8000-000000000002',
  'fd800000-0000-4000-8000-000000000001'
);

INSERT INTO fixed_results (label, result)
SELECT 'legacy-activity', plugin_data.csf_create_activity(
  'fd100000-0000-4000-8000-000000000001',
  'fd300000-0000-4000-8000-000000000001',
  NULL,
  '{"status":"published","title":"Legacy fixed award","signupMode":"none","pointValue":1,"pointType":"non_drive","pointCap":3,"requiresPointSubmission":true,"evidencePolicy":"optional"}'::jsonb,
  'fd000000-0000-4000-8000-000000000002',
  'fd800000-0000-4000-8000-000000000002'
);

INSERT INTO fixed_results (label, result)
SELECT 'per-item-activity', plugin_data.csf_create_activity(
  'fd100000-0000-4000-8000-000000000001',
  'fd300000-0000-4000-8000-000000000001',
  NULL,
  pg_catalog.jsonb_build_object(
    'status', 'published',
    'title', 'Bookmarks',
    'signupMode', 'none',
    'requiresPointSubmission', true,
    'evidencePolicy', 'optional',
    'earningRules', pg_catalog.jsonb_build_object(
      'version', 1,
      'mode', 'per_item',
      'components', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('key', 'bookmark', 'label', 'Bookmarks', 'category', 'non_drive', 'kind', 'per_item', 'unitLabel', 'bookmarks', 'pointsPerItem', 1, 'maxPoints', 3)
      )
    )
  ),
  'fd000000-0000-4000-8000-000000000002',
  'fd800000-0000-4000-8000-000000000003'
);

INSERT INTO fixed_results (label, result)
SELECT 'quantity-drive', plugin_data.csf_create_activity(
  'fd100000-0000-4000-8000-000000000001',
  'fd300000-0000-4000-8000-000000000001',
  NULL,
  pg_catalog.jsonb_build_object(
    'status', 'published',
    'title', 'Repeatable donation drive',
    'signupMode', 'none',
    'pointCap', 2,
    'requiresPointSubmission', true,
    'evidencePolicy', 'optional',
    'earningRules', pg_catalog.jsonb_build_object(
      'version', 1,
      'mode', 'quantity',
      'components', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('key', 'products', 'label', 'Products', 'category', 'drive', 'kind', 'quantity', 'unitLabel', 'products', 'unitsPerPoint', 3, 'maxPoints', 2)
      )
    )
  ),
  'fd000000-0000-4000-8000-000000000002',
  'fd800000-0000-4000-8000-000000000005'
);

INSERT INTO fixed_results (label, result)
SELECT 'shift-activity', plugin_data.csf_create_activity(
  'fd100000-0000-4000-8000-000000000001',
  'fd300000-0000-4000-8000-000000000001',
  NULL,
  pg_catalog.jsonb_build_object(
    'status', 'published',
    'title', 'Festival shifts',
    'signupMode', 'none',
    'pointCap', 3,
    'requiresPointSubmission', true,
    'evidencePolicy', 'optional',
    'earningRules', pg_catalog.jsonb_build_object(
      'version', 1,
      'mode', 'shifts',
      'shiftPolicy', pg_catalog.jsonb_build_object('allowMultiple', true, 'combinedMaxPoints', 3),
      'components', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('key', 'am', 'label', 'Morning', 'category', 'non_drive', 'kind', 'shift', 'points', 1),
        pg_catalog.jsonb_build_object('key', 'pm', 'label', 'Afternoon', 'category', 'non_drive', 'kind', 'shift', 'points', 1)
      )
    )
  ),
  'fd000000-0000-4000-8000-000000000002',
  'fd800000-0000-4000-8000-000000000004'
);

INSERT INTO fixed_results (label, result)
SELECT 'mode-change-activity', plugin_data.csf_create_activity(
  'fd100000-0000-4000-8000-000000000001',
  'fd300000-0000-4000-8000-000000000001',
  NULL,
  pg_catalog.jsonb_build_object(
    'status', 'published',
    'title', 'Changing donation rules',
    'signupMode', 'none',
    'pointCap', 2,
    'requiresPointSubmission', true,
    'evidencePolicy', 'optional',
    'earningRules', pg_catalog.jsonb_build_object(
      'version', 1,
      'mode', 'quantity',
      'components', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('key', 'items', 'label', 'Items', 'category', 'drive', 'kind', 'quantity', 'unitLabel', 'items', 'unitsPerPoint', 1, 'maxPoints', 2)
      )
    )
  ),
  'fd000000-0000-4000-8000-000000000002',
  'fd800000-0000-4000-8000-000000000010'
);

INSERT INTO fixed_results (label, result)
SELECT 'mode-change-pending', plugin_data.csf_begin_point_submission_request_v2(
  'fd100000-0000-4000-8000-000000000001',
  'fd400000-0000-4000-8000-000000000001',
  'fd300000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'mode-change-activity'),
  NULL, 'student', 'One item before rule change.', 1, 'drive', '2099-10-14',
  'fd000000-0000-4000-8000-000000000001',
  NULL, NULL, NULL, NULL,
  'fd600000-0000-4000-8000-000000000010',
  '{"version":1,"items":[{"key":"items","quantity":1}]}'::jsonb
);

SELECT plugin_data.csf_update_activity(
  'fd100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'mode-change-activity'),
  'fd300000-0000-4000-8000-000000000001',
  NULL,
  pg_catalog.jsonb_build_object(
    'title', 'Changing donation rules',
    'signupMode', 'none',
    'pointCap', 2,
    'requiresPointSubmission', true,
    'evidencePolicy', 'optional',
    'earningRules', pg_catalog.jsonb_build_object(
      'version', 1,
      'mode', 'fixed',
      'components', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('key', 'credit', 'label', 'Fixed credit', 'category', 'non_drive', 'kind', 'fixed', 'points', 2)
      )
    )
  ),
  'fd000000-0000-4000-8000-000000000002',
  'fd800000-0000-4000-8000-000000000011'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_assert_activity_earning_award(
    'fd100000-0000-4000-8000-000000000001',
    'fd400000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'mode-change-activity'),
    NULL,
    2,
    '{"version":1,"mode":"fixed","components":[{"key":"credit","label":"Fixed credit","category":"non_drive","kind":"fixed","points":2}]}'::jsonb,
    '{"version":1,"items":[{"key":"credit"}]}'::jsonb
  ) $$,
  'P0001',
  'This activity allows at most 2.00 points per person; 1.00 already submitted or verified.',
  'the award assertion also counts a quantity snapshot after a fixed-mode change'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission_request_v2(
    'fd100000-0000-4000-8000-000000000001',
    'fd400000-0000-4000-8000-000000000001',
    'fd300000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'mode-change-activity'),
    NULL, 'student', 'Fixed credit after rule change.', 2, 'non_drive', '2099-10-15',
    'fd000000-0000-4000-8000-000000000001',
    NULL, NULL, NULL, NULL,
    'fd600000-0000-4000-8000-000000000011',
    '{"version":1,"items":[{"key":"credit"}]}'::jsonb
  ) $$,
  'P0001',
  'This activity allows at most 2.00 points per person; 1.00 already submitted or verified.',
  'a fixed-mode claim cannot ignore a preserved pending quantity reservation'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_point_submissions
    WHERE opportunity_id = (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'mode-change-activity')
      AND status = 'submitted'
      AND earning_rules_snapshot ->> 'mode' = 'quantity'
  ),
  1,
  'a mode change leaves the earlier quantity claim and its snapshot intact'
);

SELECT plugin_data.csf_update_activity(
  'fd100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'mode-change-activity'),
  'fd300000-0000-4000-8000-000000000001',
  NULL,
  pg_catalog.jsonb_build_object(
    'title', 'Changing donation rules',
    'signupMode', 'none',
    'pointCap', 2,
    'requiresPointSubmission', true,
    'evidencePolicy', 'optional',
    'earningRules', pg_catalog.jsonb_build_object(
      'version', 1,
      'mode', 'fixed',
      'components', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('key', 'credit', 'label', 'Fixed credit', 'category', 'non_drive', 'kind', 'fixed', 'points', 1)
      )
    )
  ),
  'fd000000-0000-4000-8000-000000000002',
  'fd800000-0000-4000-8000-000000000012'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission_request_v2(
    'fd100000-0000-4000-8000-000000000001',
    'fd400000-0000-4000-8000-000000000001',
    'fd300000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'mode-change-activity'),
    NULL, 'student', 'Fixed credit within the remaining cap.', 1, 'non_drive', '2099-10-16',
    'fd000000-0000-4000-8000-000000000001',
    NULL, NULL, NULL, NULL,
    'fd600000-0000-4000-8000-000000000012',
    '{"version":1,"items":[{"key":"credit"}]}'::jsonb
  ) $$,
  'P0001',
  'This activity already has a claim that blocks another submission for this member.',
  'fixed mode refuses an older quantity claim even when both fit within the cap'
);

-- ---------------------------------------------------------------------------
-- Fixed mode: approval does not open the door to a second identical claim
-- ---------------------------------------------------------------------------

INSERT INTO fixed_results (label, result)
SELECT 'fixed-begin', plugin_data.csf_begin_point_submission_request_v2(
  'fd100000-0000-4000-8000-000000000001',
  'fd400000-0000-4000-8000-000000000001',
  'fd300000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'fixed-activity'),
  NULL, 'student', 'Attended the meeting.', 1, 'non_drive', '2099-09-10',
  'fd000000-0000-4000-8000-000000000001',
  NULL, NULL, NULL, NULL,
  'fd600000-0000-4000-8000-000000000001',
  '{"version":1,"items":[{"key":"credit"}]}'::jsonb
);

SELECT extensions.ok(
  (
    SELECT submission.status = 'submitted'
      AND submission.claimed_points = 1
      AND submission.earning_rules_snapshot ->> 'mode' = 'fixed'
      AND (submission.earning_rules_snapshot -> 'legacy') IS DISTINCT FROM 'true'::jsonb
    FROM plugin_data.csf_point_submissions AS submission
    WHERE submission.id = (SELECT (result ->> 'submissionId')::uuid FROM fixed_results WHERE label = 'fixed-begin')
  ),
  'a fixed-mode submission stores a non-legacy fixed snapshot'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_review_point_submission_request(
    'fd100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM fixed_results WHERE label = 'fixed-begin'),
    'approved', 1, NULL,
    'fd000000-0000-4000-8000-000000000002',
    'fd700000-0000-4000-8000-000000000001'
  ) $$,
  'the fixed award is approved at its fixed value'
);

SELECT extensions.is(
  (
    SELECT sum(credit.points)::numeric
    FROM plugin_data.csf_credit_records AS credit
    WHERE credit.profile_id = 'fd400000-0000-4000-8000-000000000001'
      AND credit.opportunity_id = (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'fixed-activity')
      AND credit.status = 'verified'
  ),
  1::numeric,
  'the approved fixed award verifies exactly one point'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission_request_v2(
    'fd100000-0000-4000-8000-000000000001',
    'fd400000-0000-4000-8000-000000000001',
    'fd300000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'fixed-activity'),
    NULL, 'student', 'Attended the meeting again.', 1, 'non_drive', '2099-09-17',
    'fd000000-0000-4000-8000-000000000001',
    NULL, NULL, NULL, NULL,
    'fd600000-0000-4000-8000-000000000002',
    '{"version":1,"items":[{"key":"credit"}]}'::jsonb
  ) $$,
  '23505',
  'duplicate key value violates unique constraint "csf_point_submissions_one_active_activity_claim_idx"',
  'a second fixed-award claim is refused even though the per-person maximum has room'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_point_submissions
    WHERE opportunity_id = (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'fixed-activity')
  ),
  1,
  'the refused fixed claim leaves a single submission on the activity'
);

-- The cap may also be full, but the old one-claim index remains the fixed
-- activity's public duplicate contract.
UPDATE plugin_data.csf_opportunities SET point_cap = 1
WHERE organization_id = 'fd100000-0000-4000-8000-000000000001'
  AND id = (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'fixed-activity');

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission_request_v2(
    'fd100000-0000-4000-8000-000000000001',
    'fd400000-0000-4000-8000-000000000001',
    'fd300000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'fixed-activity'),
    NULL, 'student', 'Duplicate with a full cap.', 1, 'non_drive', '2099-09-18',
    'fd000000-0000-4000-8000-000000000001',
    NULL, NULL, NULL, NULL,
    'fd600000-0000-4000-8000-000000000014',
    '{"version":1,"items":[{"key":"credit"}]}'::jsonb
  ) $$,
  '23505',
  'duplicate key value violates unique constraint "csf_point_submissions_one_active_activity_claim_idx"',
  'a fixed duplicate keeps its unique-index response even when the point cap is full'
);

SELECT plugin_data.csf_update_activity(
  'fd100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'fixed-activity'),
  'fd300000-0000-4000-8000-000000000001',
  NULL,
  pg_catalog.jsonb_build_object(
    'title', 'Club meeting attendance',
    'signupMode', 'none',
    'pointCap', 3,
    'requiresPointSubmission', true,
    'evidencePolicy', 'optional',
    'earningRules', pg_catalog.jsonb_build_object(
      'version', 1,
      'mode', 'quantity',
      'components', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('key', 'visit', 'label', 'Visit', 'category', 'non_drive', 'kind', 'quantity', 'unitLabel', 'visits', 'unitsPerPoint', 1, 'maxPoints', 3)
      )
    )
  ),
  'fd000000-0000-4000-8000-000000000002',
  'fd800000-0000-4000-8000-000000000013'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission_request_v2(
    'fd100000-0000-4000-8000-000000000001',
    'fd400000-0000-4000-8000-000000000001',
    'fd300000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'fixed-activity'),
    NULL, 'student', 'Visit after fixed award.', 1, 'non_drive', '2099-10-17',
    'fd000000-0000-4000-8000-000000000001',
    NULL, NULL, NULL, NULL,
    'fd600000-0000-4000-8000-000000000013',
    '{"version":1,"items":[{"key":"visit","quantity":1}]}'::jsonb
  ) $$,
  'P0001',
  'This activity already has a claim that blocks another submission for this member.',
  'a historical fixed award still blocks a new repeatable claim after a mode change'
);

-- ---------------------------------------------------------------------------
-- Legacy fixed award: still single-claim after approval
-- ---------------------------------------------------------------------------

INSERT INTO fixed_results (label, result)
SELECT 'legacy-begin', plugin_data.csf_begin_point_submission_request(
  'fd100000-0000-4000-8000-000000000001',
  'fd400000-0000-4000-8000-000000000001',
  'fd300000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'legacy-activity'),
  NULL, 'student', 'Legacy claim.', 1, 'non_drive', '2099-09-11',
  'fd000000-0000-4000-8000-000000000001',
  NULL, NULL, NULL, NULL,
  'fd600000-0000-4000-8000-000000000003'
);

SELECT plugin_data.csf_review_point_submission_request(
  'fd100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'submissionId')::uuid FROM fixed_results WHERE label = 'legacy-begin'),
  'approved', 1, NULL,
  'fd000000-0000-4000-8000-000000000002',
  'fd700000-0000-4000-8000-000000000002'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission_request(
    'fd100000-0000-4000-8000-000000000001',
    'fd400000-0000-4000-8000-000000000001',
    'fd300000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'legacy-activity'),
    NULL, 'student', 'Legacy claim again.', 1, 'non_drive', '2099-09-18',
    'fd000000-0000-4000-8000-000000000001',
    NULL, NULL, NULL, NULL,
    'fd600000-0000-4000-8000-000000000004'
  ) $$,
  '23505',
  'duplicate key value violates unique constraint "csf_point_submissions_one_active_activity_claim_idx"',
  'an approved legacy fixed award still blocks a second claim'
);

-- ---------------------------------------------------------------------------
-- per_item: an approved submission can be followed by another
-- ---------------------------------------------------------------------------

INSERT INTO fixed_results (label, result)
SELECT 'per-item-begin', plugin_data.csf_begin_point_submission_request_v2(
  'fd100000-0000-4000-8000-000000000001',
  'fd400000-0000-4000-8000-000000000001',
  'fd300000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'per-item-activity'),
  NULL, 'student', 'Two bookmarks.', 2, 'non_drive', '2099-10-03',
  'fd000000-0000-4000-8000-000000000001',
  NULL, NULL, NULL, NULL,
  'fd600000-0000-4000-8000-000000000005',
  '{"version":1,"items":[{"key":"bookmark","quantity":2}]}'::jsonb
);

SELECT plugin_data.csf_review_point_submission_request(
  'fd100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'submissionId')::uuid FROM fixed_results WHERE label = 'per-item-begin'),
  'approved', 2, NULL,
  'fd000000-0000-4000-8000-000000000002',
  'fd700000-0000-4000-8000-000000000003'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_begin_point_submission_request_v2(
    'fd100000-0000-4000-8000-000000000001',
    'fd400000-0000-4000-8000-000000000001',
    'fd300000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'per-item-activity'),
    NULL, 'student', 'One more bookmark.', 1, 'non_drive', '2099-10-10',
    'fd000000-0000-4000-8000-000000000001',
    NULL, NULL, NULL, NULL,
    'fd600000-0000-4000-8000-000000000006',
    '{"version":1,"items":[{"key":"bookmark","quantity":1}]}'::jsonb
  ) $$,
  'a per_item activity accepts a new submission after an approved one'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_point_submissions
    WHERE opportunity_id = (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'per-item-activity')
      AND status IN ('approved', 'submitted')
  ),
  2,
  'the per_item activity carries one approved and one submitted claim'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission_request_v2(
    'fd100000-0000-4000-8000-000000000001',
    'fd400000-0000-4000-8000-000000000001',
    'fd300000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'per-item-activity'),
    NULL, 'student', 'More bookmarks beyond the cap.', 1, 'non_drive', '2099-10-11',
    'fd000000-0000-4000-8000-000000000001',
    NULL, NULL, NULL, NULL,
    'fd600000-0000-4000-8000-00000000000a',
    '{"version":1,"items":[{"key":"bookmark","quantity":1}]}'::jsonb
  ) $$,
  'P0001',
  'This activity allows at most 3.00 points per person; 3.00 already submitted or verified.',
  'a pending per-item claim reserves the remaining per-person capacity'
);

-- Two different donations may await review at once, without reserving more
-- than the activity cap or treating a retry as a third donation.
INSERT INTO fixed_results (label, result)
SELECT 'quantity-first', plugin_data.csf_begin_point_submission_request_v2(
  'fd100000-0000-4000-8000-000000000001',
  'fd400000-0000-4000-8000-000000000001',
  'fd300000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'quantity-drive'),
  NULL, 'student', 'First separate donation.', 1, 'drive', '2099-10-09',
  'fd000000-0000-4000-8000-000000000001',
  NULL, NULL, NULL, NULL,
  'fd600000-0000-4000-8000-00000000000b',
  '{"version":1,"items":[{"key":"products","quantity":3}]}'::jsonb
);

INSERT INTO fixed_results (label, result)
SELECT 'quantity-second', plugin_data.csf_begin_point_submission_request_v2(
  'fd100000-0000-4000-8000-000000000001',
  'fd400000-0000-4000-8000-000000000001',
  'fd300000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'quantity-drive'),
  NULL, 'student', 'Second separate donation.', 1, 'drive', '2099-10-12',
  'fd000000-0000-4000-8000-000000000001',
  'second-donation.pdf', 'application/pdf', 1024,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'fd600000-0000-4000-8000-00000000000c',
  '{"version":1,"items":[{"key":"products","quantity":3}]}'::jsonb
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_point_submissions
    WHERE opportunity_id = (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'quantity-drive')
      AND status IN ('draft', 'submitted')
      AND earning_rules_snapshot ->> 'mode' = 'quantity'
  ),
  2,
  'two separate quantity claims, including a pending proof, retain their rules snapshots'
);

SELECT extensions.is(
  (plugin_data.csf_begin_point_submission_request_v2(
    'fd100000-0000-4000-8000-000000000001',
    'fd400000-0000-4000-8000-000000000001',
    'fd300000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'quantity-drive'),
    NULL, 'student', 'Second separate donation.', 1, 'drive', '2099-10-12',
    'fd000000-0000-4000-8000-000000000001',
    'second-donation.pdf', 'application/pdf', 1024,
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'fd600000-0000-4000-8000-00000000000c',
    '{"version":1,"items":[{"key":"products","quantity":3}]}'::jsonb
  ) ->> 'submissionId')::uuid,
  (SELECT (result ->> 'submissionId')::uuid FROM fixed_results WHERE label = 'quantity-second'),
  'an exact retry returns the second claim instead of creating another'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission_request_v2(
    'fd100000-0000-4000-8000-000000000001',
    'fd400000-0000-4000-8000-000000000001',
    'fd300000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'quantity-drive'),
    NULL, 'student', 'Third donation over the activity cap.', 1, 'drive', '2099-10-13',
    'fd000000-0000-4000-8000-000000000001',
    NULL, NULL, NULL, NULL,
    'fd600000-0000-4000-8000-00000000000d',
    '{"version":1,"items":[{"key":"products","quantity":3}]}'::jsonb
  ) $$,
  'P0001',
  'This activity allows at most 2.00 points per person; 2.00 already submitted or verified.',
  'a third donation is refused while the first two await review'
);

SELECT extensions.is(
  (
    plugin_data.csf_finalize_point_submission_proof_request(
      'fd100000-0000-4000-8000-000000000001',
      (SELECT (result ->> 'submissionId')::uuid FROM fixed_results WHERE label = 'quantity-second'),
      (SELECT (result ->> 'fileId')::uuid FROM fixed_results WHERE label = 'quantity-second'),
      (SELECT (result ->> 'uploadToken')::uuid FROM fixed_results WHERE label = 'quantity-second'),
      'fd000000-0000-4000-8000-000000000001',
      'fd600000-0000-4000-8000-00000000000c'
    ) ->> 'status'
  ),
  'submitted',
  'the second donation can finalize its separate proof before review'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_validate_submission_edit(
    'fd100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM fixed_results WHERE label = 'quantity-first'),
    'fd000000-0000-4000-8000-000000000001',
    (SELECT revision FROM plugin_data.csf_point_submissions WHERE id =
      (SELECT (result ->> 'submissionId')::uuid FROM fixed_results WHERE label = 'quantity-first')),
    '{"description":"Six products instead","claimedPoints":2,"pointType":"drive","activityDate":"2099-10-09","earningSelection":{"version":1,"items":[{"key":"products","quantity":6}]}}'::jsonb,
    false
  ) $$,
  'P0001',
  'This activity allows at most 2.00 points per person; 1.00 already submitted or verified.',
  'editing one pending claim cannot exceed the cap reserved by its sibling'
);

SELECT plugin_data.csf_review_point_submission_request(
  'fd100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'submissionId')::uuid FROM fixed_results WHERE label = 'quantity-first'),
  'needs_action', NULL, 'Please clarify this donation.',
  'fd000000-0000-4000-8000-000000000002',
  'fd700000-0000-4000-8000-000000000008'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_resubmit_point_submission_request_v2(
    'fd100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM fixed_results WHERE label = 'quantity-first'),
    2, 'drive', '2099-10-09', 'Six products instead.',
    'fd000000-0000-4000-8000-000000000001',
    'fd600000-0000-4000-8000-00000000000e',
    '{"version":1,"items":[{"key":"products","quantity":6}]}'::jsonb
  ) $$,
  'P0001',
  'This activity allows at most 2.00 points per person; 1.00 already submitted or verified.',
  'resubmitting one pending claim cannot exceed the cap reserved by its sibling'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_resubmit_point_submission_request_v2(
    'fd100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM fixed_results WHERE label = 'quantity-first'),
    1, 'drive', '2099-10-09', 'Three products confirmed.',
    'fd000000-0000-4000-8000-000000000001',
    'fd600000-0000-4000-8000-00000000000f',
    '{"version":1,"items":[{"key":"products","quantity":3}]}'::jsonb
  ) $$,
  'a within-cap correction remains allowed'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_review_point_submission_request(
    'fd100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM fixed_results WHERE label = 'quantity-first'),
    'approved', 1, NULL,
    'fd000000-0000-4000-8000-000000000002',
    'fd700000-0000-4000-8000-000000000006'
  ) $$,
  'the first pending donation can be approved under the activity cap'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_review_point_submission_request(
    'fd100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM fixed_results WHERE label = 'quantity-second'),
    'approved', 1, NULL,
    'fd000000-0000-4000-8000-000000000002',
    'fd700000-0000-4000-8000-000000000007'
  ) $$,
  'the second pending donation can be approved up to the combined cap'
);

SELECT extensions.is(
  (
    SELECT pg_catalog.sum(credit.points)::numeric
    FROM plugin_data.csf_credit_records AS credit
    WHERE credit.profile_id = 'fd400000-0000-4000-8000-000000000001'
      AND credit.opportunity_id = (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'quantity-drive')
      AND credit.status = 'verified'
  ),
  2::numeric,
  'approval creates exactly two verified drive points across the two donations'
);

-- Without an activity pointCap, the semester policy's three-point limit
-- governs cumulative claims. The two-point quantity ceiling applies only to
-- one selection and must not prevent a final one-point donation.
INSERT INTO fixed_results (label, result)
SELECT 'uncapped-quantity-activity', plugin_data.csf_create_activity(
  'fd100000-0000-4000-8000-000000000001',
  'fd300000-0000-4000-8000-000000000001',
  NULL,
  pg_catalog.jsonb_build_object(
    'status', 'published',
    'title', 'Policy-capped donation drive',
    'signupMode', 'none',
    'requiresPointSubmission', true,
    'evidencePolicy', 'optional',
    'earningRules', pg_catalog.jsonb_build_object(
      'version', 1,
      'mode', 'quantity',
      'components', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('key', 'products', 'label', 'Products', 'category', 'drive', 'kind', 'quantity', 'unitLabel', 'products', 'unitsPerPoint', 3, 'maxPoints', 2)
      )
    )
  ),
  'fd000000-0000-4000-8000-000000000002',
  'fd800000-0000-4000-8000-000000000020'
);

SELECT extensions.ok(
  (
    SELECT activity.point_cap IS NULL AND activity.point_value = 2
    FROM plugin_data.csf_opportunities AS activity
    WHERE activity.id = (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'uncapped-quantity-activity')
  ),
  'omitting pointCap retains a two-point selection ceiling without an activity cap'
);

INSERT INTO fixed_results (label, result)
SELECT 'uncapped-quantity-first', plugin_data.csf_begin_point_submission_request_v2(
  'fd100000-0000-4000-8000-000000000001',
  'fd400000-0000-4000-8000-000000000001',
  'fd300000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'uncapped-quantity-activity'),
  NULL, 'student', 'Six products.', 2, 'drive', '2099-10-18',
  'fd000000-0000-4000-8000-000000000001',
  NULL, NULL, NULL, NULL,
  'fd600000-0000-4000-8000-000000000020',
  '{"version":1,"items":[{"key":"products","quantity":6}]}'::jsonb
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_review_point_submission_request(
    'fd100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM fixed_results WHERE label = 'uncapped-quantity-first'),
    'approved', 2, NULL,
    'fd000000-0000-4000-8000-000000000002',
    'fd700000-0000-4000-8000-000000000020'
  ) $$,
  'the first uncapped donation awards its two-point selection maximum'
);

INSERT INTO fixed_results (label, result)
SELECT 'uncapped-quantity-second', plugin_data.csf_begin_point_submission_request_v2(
  'fd100000-0000-4000-8000-000000000001',
  'fd400000-0000-4000-8000-000000000001',
  'fd300000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'uncapped-quantity-activity'),
  NULL, 'student', 'Three more products.', 1, 'drive', '2099-10-19',
  'fd000000-0000-4000-8000-000000000001',
  NULL, NULL, NULL, NULL,
  'fd600000-0000-4000-8000-000000000021',
  '{"version":1,"items":[{"key":"products","quantity":3}]}'::jsonb
);

SELECT extensions.is(
  (SELECT result ->> 'status' FROM fixed_results WHERE label = 'uncapped-quantity-second'),
  'submitted',
  'the policy permits the final one-point claim after two verified points'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission_request_v2(
    'fd100000-0000-4000-8000-000000000001',
    'fd400000-0000-4000-8000-000000000001',
    'fd300000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'uncapped-quantity-activity'),
    NULL, 'student', 'One product claim beyond policy.', 1, 'drive', '2099-10-20',
    'fd000000-0000-4000-8000-000000000001',
    NULL, NULL, NULL, NULL,
    'fd600000-0000-4000-8000-000000000022',
    '{"version":1,"items":[{"key":"products","quantity":3}]}'::jsonb
  ) $$,
  'P0001',
  'This activity allows at most 3.00 points per person; 3.00 already submitted or verified.',
  'the policy still refuses claims beyond its three-point activity maximum'
);

-- ---------------------------------------------------------------------------
-- shifts: distinct shifts stack, a repeated shift is still refused
-- Both shifts are worth 1 point so the repeat stays under the 3-point
-- per-person cap and the shift guard, not the cap, is what refuses it.
-- ---------------------------------------------------------------------------

INSERT INTO fixed_results (label, result)
SELECT 'shift-am', plugin_data.csf_begin_point_submission_request_v2(
  'fd100000-0000-4000-8000-000000000001',
  'fd400000-0000-4000-8000-000000000001',
  'fd300000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'shift-activity'),
  NULL, 'student', 'Morning shift.', 1, 'non_drive', '2099-10-01',
  'fd000000-0000-4000-8000-000000000001',
  NULL, NULL, NULL, NULL,
  'fd600000-0000-4000-8000-000000000007',
  '{"version":1,"items":[{"key":"am"}]}'::jsonb
);

SELECT plugin_data.csf_review_point_submission_request(
  'fd100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'submissionId')::uuid FROM fixed_results WHERE label = 'shift-am'),
  'approved', 1, NULL,
  'fd000000-0000-4000-8000-000000000002',
  'fd700000-0000-4000-8000-000000000004'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission_request_v2(
    'fd100000-0000-4000-8000-000000000001',
    'fd400000-0000-4000-8000-000000000001',
    'fd300000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'shift-activity'),
    NULL, 'student', 'Morning shift again.', 1, 'non_drive', '2099-10-08',
    'fd000000-0000-4000-8000-000000000001',
    NULL, NULL, NULL, NULL,
    'fd600000-0000-4000-8000-000000000009',
    '{"version":1,"items":[{"key":"am"}]}'::jsonb
  ) $$,
  'P0001',
  'Shift am was already awarded for this member.',
  'a shift that was already verified is still refused by the award assertion'
);

INSERT INTO fixed_results (label, result)
SELECT 'shift-pm', plugin_data.csf_begin_point_submission_request_v2(
  'fd100000-0000-4000-8000-000000000001',
  'fd400000-0000-4000-8000-000000000001',
  'fd300000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'shift-activity'),
  NULL, 'student', 'Afternoon shift.', 1, 'non_drive', '2099-10-01',
  'fd000000-0000-4000-8000-000000000001',
  NULL, NULL, NULL, NULL,
  'fd600000-0000-4000-8000-000000000008',
  '{"version":1,"items":[{"key":"pm"}]}'::jsonb
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_review_point_submission_request(
    'fd100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM fixed_results WHERE label = 'shift-pm'),
    'approved', 1, NULL,
    'fd000000-0000-4000-8000-000000000002',
    'fd700000-0000-4000-8000-000000000005'
  ) $$,
  'a distinct shift is submitted and approved after the first approved shift'
);


SELECT extensions.is(
  (
    SELECT sum(credit.points)::numeric
    FROM plugin_data.csf_credit_records AS credit
    WHERE credit.profile_id = 'fd400000-0000-4000-8000-000000000001'
      AND credit.opportunity_id = (SELECT (result ->> 'activityId')::uuid FROM fixed_results WHERE label = 'shift-activity')
      AND credit.status = 'verified'
  ),
  2::numeric,
  'two distinct approved shifts are both verified and the repeated shift adds nothing'
);

SELECT extensions.finish();
ROLLBACK;
