BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

-- ---------------------------------------------------------------------------
-- Privileges: rule helpers stay owner-only, request writers stay service-only.
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS roles(role_name)
    CROSS JOIN (
      VALUES
        ('plugin_data.csf_normalize_earning_rules(jsonb)'),
        ('plugin_data.csf_calculate_earning(jsonb,jsonb)'),
        ('plugin_data.csf_effective_earning_rules(jsonb,numeric,text)'),
        ('plugin_data.csf_default_earning_selection(jsonb)'),
        ('plugin_data.csf_normalize_signup_links(jsonb)'),
        ('plugin_data.csf_assert_activity_earning_award(uuid,uuid,uuid,uuid,numeric,jsonb,jsonb)'),
        ('plugin_data.csf_review_point_submission_v2(uuid,uuid,text,numeric,text,uuid)'),
        ('plugin_data.csf_review_point_appeal(uuid,uuid,text,text,uuid,uuid)'),
        ('plugin_data.csf_create_activity_locked_impl(uuid,uuid,uuid,jsonb,uuid,uuid)'),
        ('plugin_data.csf_update_activity_locked_impl(uuid,uuid,uuid,uuid,jsonb,uuid,uuid)')
    ) AS routines(signature)
    WHERE pg_catalog.has_function_privilege(roles.role_name, routines.signature, 'EXECUTE')
  ),
  'earning-rule helpers and replaced engines are owner-only'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
    ) AS privilege
    WHERE namespace.nspname = 'plugin_data'
      AND routine.proname IN (
        'csf_normalize_earning_rules', 'csf_calculate_earning',
        'csf_effective_earning_rules', 'csf_default_earning_selection',
        'csf_normalize_signup_links', 'csf_assert_activity_earning_award',
        'csf_begin_point_submission_request_v2', 'csf_resubmit_point_submission_request_v2'
      )
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute earning helpers or request writers'
);

SELECT extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'plugin_data.csf_begin_point_submission_request_v2(uuid,uuid,uuid,uuid,uuid,text,text,numeric,text,date,uuid,text,text,bigint,text,uuid,jsonb)',
    'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'service_role',
    'plugin_data.csf_resubmit_point_submission_request_v2(uuid,uuid,numeric,text,date,text,uuid,uuid,jsonb)',
    'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'service_role',
    'plugin_data.csf_begin_point_submission_request(uuid,uuid,uuid,uuid,uuid,text,text,numeric,text,date,uuid,text,text,bigint,text,uuid)',
    'EXECUTE'
  ),
  'service_role reaches the v2 request writers and the delegating originals'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated')) AS roles(role_name)
    WHERE pg_catalog.has_function_privilege(
      roles.role_name,
      'plugin_data.csf_begin_point_submission_request_v2(uuid,uuid,uuid,uuid,uuid,text,text,numeric,text,date,uuid,text,text,bigint,text,uuid,jsonb)',
      'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      roles.role_name,
      'plugin_data.csf_resubmit_point_submission_request_v2(uuid,uuid,numeric,text,date,text,uuid,uuid,jsonb)',
      'EXECUTE'
    )
  ),
  'browser roles cannot execute the v2 request writers'
);

SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'plugin_data.csf_begin_point_submission_request(uuid,uuid,uuid,uuid,uuid,text,text,numeric,text,date,uuid,text,text,bigint,text,uuid)'::regprocedure
  ) LIKE '%csf_begin_point_submission_request_v2(%'
  AND pg_catalog.pg_get_functiondef(
    'plugin_data.csf_resubmit_point_submission_request(uuid,uuid,numeric,text,date,text,uuid,uuid)'::regprocedure
  ) LIKE '%csf_resubmit_point_submission_request_v2(%',
  'the original request signatures delegate to the rules-aware writers'
);

SELECT extensions.ok(
  (
    SELECT pg_catalog.strpos(definition, 'plugin_data.csf_begin_point_submission(')
      < pg_catalog.strpos(definition, 'plugin_data.csf_assert_activity_earning_award(')
      AND pg_catalog.strpos(definition, 'plugin_data.csf_assert_activity_earning_award(')
      < pg_catalog.strpos(definition, 'v_begin_state := plugin_data.csf_point_submission_receipt_state(')
    FROM pg_catalog.pg_get_functiondef(
      'plugin_data.csf_begin_point_submission_request_v2(uuid,uuid,uuid,uuid,uuid,text,text,numeric,text,date,uuid,text,text,bigint,text,uuid,jsonb)'::regprocedure
    ) AS source(definition)
  ),
  'begin evaluates the award cap after the locked eligibility check and before the receipt state'
);

SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'plugin_data.csf_assert_activity_earning_award(uuid,uuid,uuid,uuid,numeric,jsonb,jsonb)'::regprocedure
  ) LIKE '%FOR UPDATE%',
  'the award assertion locks the activity row before summing verified credit'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('fc000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'earning-member@local.test', now(), '{}', '{}', now(), now()),
  ('fc000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'earning-officer@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('fc100000-0000-4000-8000-000000000001', 'CSF Earning Rules', 'csf-earning-rules', 'school', '996101');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', 'member', 'active'),
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000002', 'admin', 'active');

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, public_title, role_type, is_system
) VALUES
  ('fc200000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001', 'earning-officer', 'Earning officer', 'Earning officer', 'custom', false);

INSERT INTO plugin_data.csf_role_permissions (organization_id, role_id, permission_key, enabled)
VALUES
  ('fc100000-0000-4000-8000-000000000001', 'fc200000-0000-4000-8000-000000000001', 'manage_opportunities', true),
  ('fc100000-0000-4000-8000-000000000001', 'fc200000-0000-4000-8000-000000000001', 'verify_submissions', true),
  ('fc100000-0000-4000-8000-000000000001', 'fc200000-0000-4000-8000-000000000001', 'process_points', true);

INSERT INTO plugin_data.csf_staff_positions (
  organization_id, user_id, role_id, school_year, display_title, status, starts_at, ends_at
) VALUES (
  'fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000002',
  'fc200000-0000-4000-8000-000000000001', '2099-2100', 'Earning officer', 'active',
  current_date - 1, current_date + 30
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current, lifecycle_status
) VALUES (
  'fc300000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001',
  'F99', 'Fall 2099', '2099-2100', 'fall', true, 'open'
);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label, status)
VALUES ('fc310000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001', 2100, 'Class of 2100', 'active');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name, record_status
) VALUES (
  'fc400000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001',
  'Earning', 'Member', 'earning', 'member', 'active'
);

INSERT INTO plugin_data.csf_profile_accounts (organization_id, profile_id, user_id, status, is_primary)
VALUES ('fc100000-0000-4000-8000-000000000001', 'fc400000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', 'verified', true);

INSERT INTO plugin_data.csf_term_memberships (
  organization_id, profile_id, term_id, cohort_id, status, accepted_at
) VALUES (
  'fc100000-0000-4000-8000-000000000001', 'fc400000-0000-4000-8000-000000000001',
  'fc300000-0000-4000-8000-000000000001', 'fc310000-0000-4000-8000-000000000001', 'accepted', now()
);

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, max_points_per_activity, outside_volunteering_allowed, published_at
) VALUES (
  'fc100000-0000-4000-8000-000000000001', 'fc300000-0000-4000-8000-000000000001', 3, true, now()
);

CREATE TEMPORARY TABLE earning_results (label text PRIMARY KEY, result jsonb NOT NULL);

-- ---------------------------------------------------------------------------
-- Activity creation with versioned rules
-- ---------------------------------------------------------------------------

INSERT INTO earning_results (label, result)
SELECT 'quantity-activity', plugin_data.csf_create_activity(
  'fc100000-0000-4000-8000-000000000001',
  'fc300000-0000-4000-8000-000000000001',
  NULL,
  pg_catalog.jsonb_build_object(
    'status', 'published',
    'title', 'Canned food drive',
    'signupMode', 'external',
    'signupUrl', 'https://example.test/cans',
    'signupLinks', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('label', 'Saturday', 'url', 'https://example.test/sat'),
      pg_catalog.jsonb_build_object('label', 'Sunday', 'url', 'https://example.test/sun')
    ),
    'externalCapacity', '20 volunteers per shift',
    'pointCap', 2,
    'requiresPointSubmission', true,
    'evidencePolicy', 'optional',
    'earningRules', pg_catalog.jsonb_build_object(
      'version', 1,
      'mode', 'quantity',
      'components', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'key', 'cans', 'label', 'Canned food', 'category', 'drive', 'kind', 'quantity',
          'unitLabel', 'cans', 'unitsPerPoint', 2, 'maxPoints', 2
        )
      )
    )
  ),
  'fc000000-0000-4000-8000-000000000002',
  'fc800000-0000-4000-8000-000000000001'
);

SELECT extensions.ok(
  (
    SELECT activity.earning_rules ->> 'mode' = 'quantity'
      AND activity.earning_rules_version = 1
      AND activity.point_value = 2
      AND activity.point_type = 'drive'
      AND activity.point_cap = 2
      AND activity.external_capacity = '20 volunteers per shift'
      AND pg_catalog.jsonb_array_length(activity.signup_links) = 2
      AND activity.signup_url = 'https://example.test/cans'
    FROM plugin_data.csf_opportunities AS activity
    WHERE activity.id = (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'quantity-activity')
  ),
  'a quantity activity stores normalized rules, the per-submission ceiling, lead category, capacity text, and extra signup links'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_create_activity(
    'fc100000-0000-4000-8000-000000000001',
    'fc300000-0000-4000-8000-000000000001',
    NULL,
    '{"status":"draft","title":"Mismatched kinds","signupMode":"none","earningRules":{"version":1,"mode":"fixed","components":[{"key":"a","label":"A","category":"drive","kind":"shift","points":1}]}}'::jsonb,
    'fc000000-0000-4000-8000-000000000002',
    'fc800000-0000-4000-8000-000000000002'
  ) $$,
  'P0001',
  'Component kinds must match the earning mode.',
  'rules whose component kinds disagree with the mode are refused'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_create_activity(
    'fc100000-0000-4000-8000-000000000001',
    'fc300000-0000-4000-8000-000000000001',
    NULL,
    '{"status":"draft","title":"Uncategorized","signupMode":"none","earningRules":{"version":1,"mode":"fixed","components":[{"key":"a","label":"Food drive bin","kind":"fixed","points":1}]}}'::jsonb,
    'fc000000-0000-4000-8000-000000000002',
    'fc800000-0000-4000-8000-000000000003'
  ) $$,
  'P0001',
  'Each component needs a drive or non-drive category.',
  'a component category is never inferred from its label'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_opportunities WHERE organization_id = 'fc100000-0000-4000-8000-000000000001'),
  1,
  'refused rule sets create no activity rows'
);

INSERT INTO earning_results (label, result)
SELECT 'shift-activity', plugin_data.csf_create_activity(
  'fc100000-0000-4000-8000-000000000001',
  'fc300000-0000-4000-8000-000000000001',
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
        pg_catalog.jsonb_build_object('key', 'am', 'label', 'Morning', 'category', 'non_drive', 'kind', 'shift', 'points', 1, 'startsAt', '2099-10-01T16:00:00Z', 'endsAt', '2099-10-01T19:00:00Z'),
        pg_catalog.jsonb_build_object('key', 'pm', 'label', 'Afternoon', 'category', 'non_drive', 'kind', 'shift', 'points', 2),
        pg_catalog.jsonb_build_object('key', 'eve', 'label', 'Evening', 'category', 'non_drive', 'kind', 'shift', 'points', 2)
      )
    )
  ),
  'fc000000-0000-4000-8000-000000000002',
  'fc800000-0000-4000-8000-000000000004'
);

INSERT INTO earning_results (label, result)
SELECT 'assessment-activity', plugin_data.csf_create_activity(
  'fc100000-0000-4000-8000-000000000001',
  'fc300000-0000-4000-8000-000000000001',
  NULL,
  pg_catalog.jsonb_build_object(
    'status', 'published',
    'title', 'Reflection essay',
    'signupMode', 'none',
    'requiresPointSubmission', true,
    'evidencePolicy', 'optional',
    'earningRules', pg_catalog.jsonb_build_object(
      'version', 1,
      'mode', 'assessment',
      'components', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('key', 'essay', 'label', 'Reflection', 'category', 'non_drive', 'kind', 'assessment', 'instructions', 'Write two paragraphs about the service.', 'maxPoints', 3)
      )
    )
  ),
  'fc000000-0000-4000-8000-000000000002',
  'fc800000-0000-4000-8000-000000000005'
);

INSERT INTO earning_results (label, result)
SELECT 'per-item-activity', plugin_data.csf_create_activity(
  'fc100000-0000-4000-8000-000000000001',
  'fc300000-0000-4000-8000-000000000001',
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
  'fc000000-0000-4000-8000-000000000002',
  'fc800000-0000-4000-8000-000000000006'
);

INSERT INTO earning_results (label, result)
SELECT 'legacy-activity', plugin_data.csf_create_activity(
  'fc100000-0000-4000-8000-000000000001',
  'fc300000-0000-4000-8000-000000000001',
  NULL,
  '{"status":"published","title":"Legacy fixed award","signupMode":"none","pointValue":2,"pointType":"non_drive","pointCap":2,"requiresPointSubmission":true,"evidencePolicy":"optional"}'::jsonb,
  'fc000000-0000-4000-8000-000000000002',
  'fc800000-0000-4000-8000-000000000007'
);

SELECT extensions.ok(
  (
    SELECT activity.earning_rules IS NULL AND activity.point_value = 2 AND activity.earning_rules_version = 1
    FROM plugin_data.csf_opportunities AS activity
    WHERE activity.id = (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'legacy-activity')
  ),
  'an activity without earningRules keeps the legacy fixed award'
);

SELECT extensions.ok(
  (
    SELECT activity.point_value = 3 AND activity.point_type = 'non_drive'
      AND activity.earning_rules -> 'shiftPolicy' ->> 'combinedMaxPoints' = '3'
      AND activity.earning_rules -> 'components' -> 0 ->> 'startsAt' = '2099-10-01T16:00:00Z'
    FROM plugin_data.csf_opportunities AS activity
    WHERE activity.id = (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'shift-activity')
  ),
  'a shift activity stores its combined ceiling and shift schedule'
);

-- ---------------------------------------------------------------------------
-- Member submissions: selection drives the suggested points and the snapshot
-- ---------------------------------------------------------------------------

INSERT INTO earning_results (label, result)
SELECT 'quantity-begin', plugin_data.csf_begin_point_submission_request_v2(
  'fc100000-0000-4000-8000-000000000001',
  'fc400000-0000-4000-8000-000000000001',
  'fc300000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'quantity-activity'),
  NULL, 'student', 'Brought five cans.', 2, 'drive', '2099-09-10',
  'fc000000-0000-4000-8000-000000000001',
  NULL, NULL, NULL, NULL,
  'fc600000-0000-4000-8000-000000000001',
  '{"version":1,"items":[{"key":"cans","quantity":5}]}'::jsonb
);

SELECT extensions.ok(
  (
    SELECT submission.status = 'submitted'
      AND submission.claimed_points = 2
      AND submission.suggested_points = 2
      AND submission.point_type = 'drive'
      AND submission.earning_rules_version = 1
      AND submission.earning_rules_snapshot ->> 'mode' = 'quantity'
      AND submission.earning_selection -> 'items' -> 0 ->> 'quantity' = '5'
    FROM plugin_data.csf_point_submissions AS submission
    WHERE submission.id = (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'quantity-begin')
  ),
  'a quantity submission stores the calculated suggestion, rules snapshot, and selection'
);

SELECT extensions.is(
  (
    SELECT audit.after_data -> 'earning' ->> 'rulesVersion'
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.correlation_id = 'fc600000-0000-4000-8000-000000000001'
      AND audit.action = 'point_submission.begin_request_committed'
  ),
  '1',
  'the begin receipt records the rules version the submission was evaluated under'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission_request_v2(
    'fc100000-0000-4000-8000-000000000001',
    'fc400000-0000-4000-8000-000000000001',
    'fc300000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'shift-activity'),
    NULL, 'student', 'Worked two shifts but claimed the wrong total.', 2, 'non_drive', '2099-10-01',
    'fc000000-0000-4000-8000-000000000001',
    NULL, NULL, NULL, NULL,
    'fc600000-0000-4000-8000-000000000002',
    '{"version":1,"items":[{"key":"am"},{"key":"pm"}]}'::jsonb
  ) $$,
  'P0001',
  'Requested points must match the calculated 3 for this selection.',
  'a submission that disagrees with the rule calculation is refused'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission_request(
    'fc100000-0000-4000-8000-000000000001',
    'fc400000-0000-4000-8000-000000000001',
    'fc300000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'shift-activity'),
    NULL, 'student', 'No selection through the original signature.', 1, 'non_drive', '2099-10-01',
    'fc000000-0000-4000-8000-000000000001',
    NULL, NULL, NULL, NULL,
    'fc600000-0000-4000-8000-000000000003'
  ) $$,
  'P0001',
  'Choose what you did for this activity before submitting.',
  'the original request signature cannot bypass the rules on a rule-driven activity'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_point_submissions
    WHERE opportunity_id = (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'shift-activity')
  ),
  0,
  'refused submissions leave no submission rows'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission_request_v2(
    'fc100000-0000-4000-8000-000000000001',
    'fc400000-0000-4000-8000-000000000001',
    'fc300000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'per-item-activity'),
    NULL, 'student', 'Mixed categories in one submission.', 1.5, 'non_drive', '2099-10-01',
    'fc000000-0000-4000-8000-000000000001',
    NULL, NULL, NULL, NULL,
    'fc600000-0000-4000-8000-000000000004',
    '{"version":1,"items":[{"key":"bookmark","quantity":1},{"key":"cards","quantity":1}]}'::jsonb
  ) $$,
  'P0001',
  'Submit drive and non-drive items as separate submissions.',
  'one submission never mixes drive and non-drive components'
);

-- Legacy activities keep accepting a submission at or below the fixed value and
-- still receive a derived snapshot.
INSERT INTO earning_results (label, result)
SELECT 'legacy-begin', plugin_data.csf_begin_point_submission_request(
  'fc100000-0000-4000-8000-000000000001',
  'fc400000-0000-4000-8000-000000000001',
  'fc300000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'legacy-activity'),
  NULL, 'student', 'Legacy partial submission.', 1, 'non_drive', '2099-09-12',
  'fc000000-0000-4000-8000-000000000001',
  NULL, NULL, NULL, NULL,
  'fc600000-0000-4000-8000-000000000005'
);

SELECT extensions.ok(
  (
    SELECT submission.status = 'submitted'
      AND submission.claimed_points = 1
      AND submission.suggested_points = 2
      AND (submission.earning_rules_snapshot -> 'legacy') = 'true'::jsonb
      AND submission.earning_selection -> 'items' -> 0 ->> 'key' = 'fixed'
    FROM plugin_data.csf_point_submissions AS submission
    WHERE submission.id = (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'legacy-begin')
  ),
  'a legacy fixed activity still accepts a partial submission and records a derived snapshot'
);

-- ---------------------------------------------------------------------------
-- Rule edits version the activity without rewriting existing submissions
-- ---------------------------------------------------------------------------

SELECT plugin_data.csf_update_activity(
  'fc100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'quantity-activity'),
  'fc300000-0000-4000-8000-000000000001',
  NULL,
  pg_catalog.jsonb_build_object(
    'title', 'Canned food drive',
    'signupMode', 'external',
    'signupUrl', 'https://example.test/cans',
    'pointCap', 2,
    'requiresPointSubmission', true,
    'evidencePolicy', 'optional',
    'earningRules', pg_catalog.jsonb_build_object(
      'version', 1,
      'mode', 'quantity',
      'components', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'key', 'cans', 'label', 'Canned food', 'category', 'drive', 'kind', 'quantity',
          'unitLabel', 'cans', 'unitsPerPoint', 1, 'maxPoints', 3
        )
      )
    )
  ),
  'fc000000-0000-4000-8000-000000000002',
  'fc800000-0000-4000-8000-000000000008'
);

SELECT extensions.ok(
  (
    SELECT activity.earning_rules_version = 2
      AND activity.point_value = 3
      AND activity.earning_rules -> 'components' -> 0 ->> 'unitsPerPoint' = '1'
    FROM plugin_data.csf_opportunities AS activity
    WHERE activity.id = (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'quantity-activity')
  ),
  'editing earning rules bumps the activity rules version and ceiling'
);

SELECT extensions.ok(
  (
    SELECT submission.earning_rules_version = 1
      AND submission.suggested_points = 2
      AND submission.earning_rules_snapshot -> 'components' -> 0 ->> 'unitsPerPoint' = '2'
    FROM plugin_data.csf_point_submissions AS submission
    WHERE submission.id = (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'quantity-begin')
  ),
  'the existing submission keeps the version 1 snapshot and suggestion after the rule edit'
);

-- ---------------------------------------------------------------------------
-- Review: overrides need a written reason; awards stay within the snapshot
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_submission_request(
    'fc100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'quantity-begin'),
    'approved', 1, NULL,
    'fc000000-0000-4000-8000-000000000002',
    'fc700000-0000-4000-8000-000000000001'
  ) $$,
  'P0001',
  'Explain why the awarded points differ from the calculated 2.00.',
  'an override of the calculated points requires review notes'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_submission_request(
    'fc100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'quantity-begin'),
    'approved', 3, 'Officer raised the award above the snapshot.',
    'fc000000-0000-4000-8000-000000000002',
    'fc700000-0000-4000-8000-000000000002'
  ) $$,
  'P0001',
  'Points exceed the selected activity limit of 2.00.',
  'an award above the per-person maximum is refused before the snapshot ceiling'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_review_point_submission_request(
    'fc100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'quantity-begin'),
    'approved', 2, NULL,
    'fc000000-0000-4000-8000-000000000002',
    'fc700000-0000-4000-8000-000000000003'
  ) $$,
  'approving at the calculated value needs no override reason'
);

SELECT extensions.ok(
  (
    SELECT credit.points = 2 AND credit.point_type = 'drive' AND credit.status = 'verified'
    FROM plugin_data.csf_credit_records AS credit
    WHERE credit.submission_id = (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'quantity-begin')
  ),
  'the approved quantity submission produces one verified credit at the awarded value'
);

-- ---------------------------------------------------------------------------
-- Per-person cumulative cap across verified credit
-- ---------------------------------------------------------------------------

INSERT INTO plugin_data.csf_credit_records (
  id, organization_id, profile_id, term_id, opportunity_id, source, points, point_type, status
) VALUES (
  'fc900000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001',
  'fc400000-0000-4000-8000-000000000001', 'fc300000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'shift-activity'),
  'manual', 2, 'non_drive', 'verified'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission_request_v2(
    'fc100000-0000-4000-8000-000000000001',
    'fc400000-0000-4000-8000-000000000001',
    'fc300000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'shift-activity'),
    NULL, 'student', 'Two shifts on top of verified credit.', 3, 'non_drive', '2099-10-01',
    'fc000000-0000-4000-8000-000000000001',
    NULL, NULL, NULL, NULL,
    'fc600000-0000-4000-8000-000000000006',
    '{"version":1,"items":[{"key":"am"},{"key":"pm"}]}'::jsonb
  ) $$,
  'P0001',
  'This activity allows at most 3.00 points per person; 2.00 already verified.',
  'a submission that would exceed the per-person maximum with verified credit is refused at begin'
);

DELETE FROM plugin_data.csf_credit_records WHERE id = 'fc900000-0000-4000-8000-000000000001';

INSERT INTO earning_results (label, result)
SELECT 'shift-begin', plugin_data.csf_begin_point_submission_request_v2(
  'fc100000-0000-4000-8000-000000000001',
  'fc400000-0000-4000-8000-000000000001',
  'fc300000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'shift-activity'),
  NULL, 'student', 'Morning shift.', 1, 'non_drive', '2099-10-01',
  'fc000000-0000-4000-8000-000000000001',
  NULL, NULL, NULL, NULL,
  'fc600000-0000-4000-8000-000000000007',
  '{"version":1,"items":[{"key":"am"}]}'::jsonb
);

-- Credit verified between begin and approval (another path) counts at approval.
INSERT INTO plugin_data.csf_credit_records (
  id, organization_id, profile_id, term_id, opportunity_id, source, points, point_type, status
) VALUES (
  'fc900000-0000-4000-8000-000000000002', 'fc100000-0000-4000-8000-000000000001',
  'fc400000-0000-4000-8000-000000000001', 'fc300000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'shift-activity'),
  'manual', 2.5, 'non_drive', 'verified'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_submission_request(
    'fc100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'shift-begin'),
    'approved', 1, NULL,
    'fc000000-0000-4000-8000-000000000002',
    'fc700000-0000-4000-8000-000000000004'
  ) $$,
  'P0001',
  'This activity allows at most 3.00 points per person; 2.50 already verified.',
  'approval re-sums verified credit under the semester lock and refuses to exceed the per-person maximum'
);

SELECT extensions.ok(
  (
    SELECT submission.status = 'submitted' AND submission.reviewed_at IS NULL
    FROM plugin_data.csf_point_submissions AS submission
    WHERE submission.id = (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'shift-begin')
  )
  AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fc700000-0000-4000-8000-000000000004'
  ),
  'a refused approval leaves the submission submitted with no partial review or receipt'
);

UPDATE plugin_data.csf_credit_records SET points = 2 WHERE id = 'fc900000-0000-4000-8000-000000000002';

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_review_point_submission_request(
    'fc100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'shift-begin'),
    'approved', 1, NULL,
    'fc000000-0000-4000-8000-000000000002',
    'fc700000-0000-4000-8000-000000000005'
  ) $$,
  'an award that exactly reaches the per-person maximum is approved'
);

DELETE FROM plugin_data.csf_credit_records WHERE id = 'fc900000-0000-4000-8000-000000000002';

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_assert_activity_earning_award(
    'fc100000-0000-4000-8000-000000000001',
    'fc400000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'shift-activity'),
    'fc900000-0000-4000-8000-0000000000ff',
    1,
    (SELECT earning_rules FROM plugin_data.csf_opportunities WHERE id = (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'shift-activity')),
    '{"version":1,"items":[{"key":"am"}]}'::jsonb
  ) $$,
  'P0001',
  'Shift am was already awarded for this member.',
  'a shift already verified for the member cannot be awarded again'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_assert_activity_earning_award(
    'fc100000-0000-4000-8000-000000000001',
    'fc400000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'shift-activity'),
    'fc900000-0000-4000-8000-0000000000ff',
    2,
    (SELECT earning_rules FROM plugin_data.csf_opportunities WHERE id = (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'shift-activity')),
    '{"version":1,"items":[{"key":"pm"}]}'::jsonb
  ) $$,
  'a different shift within the remaining per-person allowance is accepted'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_assert_activity_earning_award(
    'fc100000-0000-4000-8000-000000000001',
    'fc400000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'shift-activity'),
    'fc900000-0000-4000-8000-0000000000ff',
    4,
    (SELECT earning_rules FROM plugin_data.csf_opportunities WHERE id = (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'shift-activity')),
    '{"version":1,"items":[{"key":"pm"}]}'::jsonb
  ) $$,
  'P0001',
  'Awarded points exceed this submission''s maximum of 3.',
  'an award above the snapshot ceiling is refused'
);

-- ---------------------------------------------------------------------------
-- Officer assessment: no suggestion, written assessment required
-- ---------------------------------------------------------------------------

INSERT INTO earning_results (label, result)
SELECT 'assessment-begin', plugin_data.csf_begin_point_submission_request_v2(
  'fc100000-0000-4000-8000-000000000001',
  'fc400000-0000-4000-8000-000000000001',
  'fc300000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'assessment-activity'),
  NULL, 'student', 'Reflection attached.', 3, 'non_drive', '2099-10-02',
  'fc000000-0000-4000-8000-000000000001',
  NULL, NULL, NULL, NULL,
  'fc600000-0000-4000-8000-000000000008',
  '{"version":1,"items":[{"key":"essay"}]}'::jsonb
);

SELECT extensions.ok(
  (
    SELECT submission.suggested_points IS NULL AND submission.claimed_points = 3
    FROM plugin_data.csf_point_submissions AS submission
    WHERE submission.id = (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'assessment-begin')
  ),
  'an officer-assessed submission carries the ceiling and no suggested points'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_submission_request(
    'fc100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'assessment-begin'),
    'approved', 3, NULL,
    'fc000000-0000-4000-8000-000000000002',
    'fc700000-0000-4000-8000-000000000006'
  ) $$,
  'P0001',
  'Officer assessment requires review notes that explain the awarded points.',
  'an officer assessment cannot be approved without a written assessment'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_review_point_submission_request(
    'fc100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'assessment-begin'),
    'approved', 2, 'Thoughtful reflection; two of three points.',
    'fc000000-0000-4000-8000-000000000002',
    'fc700000-0000-4000-8000-000000000007'
  ) $$,
  'an assessed award with notes is approved'
);

SELECT extensions.is(
  (
    SELECT credit.points
    FROM plugin_data.csf_credit_records AS credit
    WHERE credit.submission_id = (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'assessment-begin')
  ),
  2::numeric(6,2),
  'the assessed credit equals the officer award, not the ceiling'
);

-- ---------------------------------------------------------------------------
-- Correction resubmission re-evaluates under current rules and keeps history
-- ---------------------------------------------------------------------------

INSERT INTO earning_results (label, result)
SELECT 'per-item-begin', plugin_data.csf_begin_point_submission_request_v2(
  'fc100000-0000-4000-8000-000000000001',
  'fc400000-0000-4000-8000-000000000001',
  'fc300000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'per-item-activity'),
  NULL, 'student', 'Two bookmarks.', 2, 'non_drive', '2099-10-03',
  'fc000000-0000-4000-8000-000000000001',
  NULL, NULL, NULL, NULL,
  'fc600000-0000-4000-8000-000000000009',
  '{"version":1,"items":[{"key":"bookmark","quantity":2}]}'::jsonb
);

SELECT plugin_data.csf_review_point_submission_request(
  'fc100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'per-item-begin'),
  'needs_action', NULL, 'Please add the photo of the bookmarks.',
  'fc000000-0000-4000-8000-000000000002',
  'fc700000-0000-4000-8000-000000000008'
);

SELECT plugin_data.csf_update_activity(
  'fc100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'per-item-activity'),
  'fc300000-0000-4000-8000-000000000001',
  NULL,
  pg_catalog.jsonb_build_object(
    'title', 'Bookmarks and cards',
    'signupMode', 'none',
    'requiresPointSubmission', true,
    'evidencePolicy', 'optional',
    'earningRules', pg_catalog.jsonb_build_object(
      'version', 1,
      'mode', 'per_item',
      'components', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('key', 'bookmark', 'label', 'Bookmarks', 'category', 'non_drive', 'kind', 'per_item', 'unitLabel', 'bookmarks', 'pointsPerItem', 1, 'maxPoints', 2),
        pg_catalog.jsonb_build_object('key', 'cards', 'label', 'Cards', 'category', 'drive', 'kind', 'per_item', 'unitLabel', 'cards', 'pointsPerItem', 0.5, 'maxPoints', 2)
      )
    )
  ),
  'fc000000-0000-4000-8000-000000000002',
  'fc800000-0000-4000-8000-000000000009'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_resubmit_point_submission_request_v2(
    'fc100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'per-item-begin'),
    1, 'non_drive', '2099-10-03', 'Five bookmarks with photo.',
    'fc000000-0000-4000-8000-000000000001',
    'fc700000-0000-4000-8000-000000000009',
    '{"version":1,"items":[{"key":"bookmark","quantity":5}]}'::jsonb
  ) $$,
  'P0001',
  'Requested points must match the calculated 2 for this selection.',
  'a correction is calculated under the current rules, not the original snapshot'
);

INSERT INTO earning_results (label, result)
SELECT 'per-item-resubmit', plugin_data.csf_resubmit_point_submission_request_v2(
  'fc100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'per-item-begin'),
  2, 'non_drive', '2099-10-03', 'Five bookmarks with photo.',
  'fc000000-0000-4000-8000-000000000001',
  'fc700000-0000-4000-8000-000000000010',
  '{"version":1,"items":[{"key":"bookmark","quantity":5}]}'::jsonb
);

SELECT extensions.ok(
  (
    SELECT submission.status = 'submitted'
      AND submission.earning_rules_version = 2
      AND submission.suggested_points = 2
      AND submission.earning_rules_snapshot -> 'components' -> 0 ->> 'maxPoints' = '2'
      AND submission.earning_selection -> 'items' -> 0 ->> 'quantity' = '5'
    FROM plugin_data.csf_point_submissions AS submission
    WHERE submission.id = (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'per-item-begin')
  ),
  'the corrected submission carries the current rules snapshot and selection'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_submission_reviews AS review
    WHERE review.submission_id = (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'per-item-begin')
      AND review.action IN ('needs_action', 'resubmitted')
  ),
  2,
  'the correction request and the resubmission both remain in review history'
);

SELECT extensions.ok(
  (
    SELECT audit.after_data -> 'earning' ->> 'previousRulesVersion' = '1'
      AND audit.after_data -> 'earning' ->> 'rulesVersion' = '2'
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.correlation_id = 'fc700000-0000-4000-8000-000000000010'
      AND audit.action = 'point_submission.resubmit_request_committed'
  ),
  'the resubmission receipt records the rules version transition'
);

SELECT extensions.is(
  (
    plugin_data.csf_resubmit_point_submission_request_v2(
      'fc100000-0000-4000-8000-000000000001',
      (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'per-item-begin'),
      2, 'non_drive', '2099-10-03', 'Five bookmarks with photo.',
      'fc000000-0000-4000-8000-000000000001',
      'fc700000-0000-4000-8000-000000000010',
      '{"version":1,"items":[{"key":"bookmark","quantity":5}]}'::jsonb
    ) ->> 'idempotent'
  )::boolean,
  true,
  'an exact resubmission retry replays its receipt'
);

SELECT plugin_data.csf_review_point_submission_request(
  'fc100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'per-item-begin'),
  'needs_action', NULL, 'Please correct this to the drive item you completed.',
  'fc000000-0000-4000-8000-000000000002',
  'fc700000-0000-4000-8000-000000000011'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_resubmit_point_submission_request_v2(
    'fc100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'per-item-begin'),
    1, 'drive', '2099-10-03', 'Two cards completed.',
    'fc000000-0000-4000-8000-000000000001',
    'fc700000-0000-4000-8000-000000000012',
    '{"version":1,"items":[{"key":"cards","quantity":2}]}'::jsonb
  ) $$,
  'a corrected mixed-category submission can use a non-lead component category'
);

SELECT extensions.ok(
  (
    SELECT submission.status = 'submitted'
      AND submission.claimed_points = 1
      AND submission.suggested_points = 1
      AND submission.point_type = 'drive'
      AND submission.earning_selection -> 'items' -> 0 ->> 'key' = 'cards'
    FROM plugin_data.csf_point_submissions AS submission
    WHERE submission.id = (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'per-item-begin')
  ),
  'the corrected submission stores the selected drive category and calculation'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_resubmit_point_submission_request_v2(
    'fc100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'per-item-begin'),
    2, 'non_drive', '2099-10-03', 'Five bookmarks with photo.',
    'fc000000-0000-4000-8000-000000000001',
    'fc700000-0000-4000-8000-000000000010',
    '{"version":1,"items":[{"key":"bookmark","quantity":4}]}'::jsonb
  ) $$,
  'P0001',
  'That point request identifier is already bound to a different change.',
  'a request identifier cannot be reused with a different selection'
);

-- A later shift uses its own submission while keeping the first award.
INSERT INTO earning_results (label, result)
SELECT 'second-shift', plugin_data.csf_begin_point_submission_request_v2(
  'fc100000-0000-4000-8000-000000000001',
  'fc400000-0000-4000-8000-000000000001',
  'fc300000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'shift-activity'),
  NULL, 'student', 'Afternoon shift.', 2, 'non_drive', '2099-10-01',
  'fc000000-0000-4000-8000-000000000001',
  NULL, NULL, NULL, NULL,
  'fc600000-0000-4000-8000-000000000020',
  '{"version":1,"items":[{"key":"pm"}]}'::jsonb
);
SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_review_point_submission_request(
    'fc100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM earning_results WHERE label = 'second-shift'),
    'approved', 2, NULL,
    'fc000000-0000-4000-8000-000000000002',
    'fc700000-0000-4000-8000-000000000020'
  ) $$,
  'a second distinct shift can be submitted and approved after the first'
);
SELECT extensions.is(
  (SELECT sum(points)::numeric FROM plugin_data.csf_credit_records
    WHERE opportunity_id = (SELECT (result ->> 'activityId')::uuid FROM earning_results WHERE label = 'shift-activity')
      AND profile_id = 'fc400000-0000-4000-8000-000000000001' AND status = 'verified'),
  3::numeric,
  'separate shift submissions total exactly the per-person maximum'
);

SELECT extensions.finish();
ROLLBACK;
