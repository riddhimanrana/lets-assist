BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(13);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_join_class_by_code(uuid,text,uuid,text,text,text,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot redeem class codes through a browser-direct RPC'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_join_class_by_code(uuid,text,uuid,text,text,text,text)',
    'EXECUTE'
  ),
  'the server role can perform the audited class-code join operation'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('ca100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@local.test', now(), '{}', '{}', now(), now()),
  ('ca100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'exact@local.test', now(), '{}', '{}', now(), now()),
  ('ca100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'new@local.test', now(), '{}', '{}', now(), now()),
  ('ca100000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'ambiguous@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ca200000-0000-4000-8000-000000000001', 'Class Join Test',
  'class-join-test', 'school', '984002'
);
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'ca200000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001', 'admin', 'active'
);
INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES (
  'ca300000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001', 2033, 'Class of 2033'
);

CREATE TEMP TABLE class_join_test_code AS
SELECT plugin_data.csf_rotate_class_join_code(
  'ca200000-0000-4000-8000-000000000001',
  'ca300000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001'
) ->> 'code' AS code;

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  personal_email, normalized_personal_email
) VALUES
  ('ca400000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', 'Exact', 'Member', 'exact', 'member', 'exact@local.test', 'exact@local.test'),
  ('ca400000-0000-4000-8000-000000000002', 'ca200000-0000-4000-8000-000000000001', 'Ambiguous', 'One', 'ambiguous', 'one', 'ambiguous@local.test', 'ambiguous@local.test'),
  ('ca400000-0000-4000-8000-000000000003', 'ca200000-0000-4000-8000-000000000001', 'Ambiguous', 'Two', 'ambiguous', 'two', 'ambiguous@local.test', 'ambiguous@local.test');
INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) VALUES
  ('ca200000-0000-4000-8000-000000000001', 'ca400000-0000-4000-8000-000000000001', 'ca300000-0000-4000-8000-000000000001', 'active'),
  ('ca200000-0000-4000-8000-000000000001', 'ca400000-0000-4000-8000-000000000002', 'ca300000-0000-4000-8000-000000000001', 'active'),
  ('ca200000-0000-4000-8000-000000000001', 'ca400000-0000-4000-8000-000000000003', 'ca300000-0000-4000-8000-000000000001', 'active');

SELECT extensions.is(
  plugin_data.csf_join_class_by_code(
    'ca200000-0000-4000-8000-000000000001', (SELECT code FROM class_join_test_code),
    'ca100000-0000-4000-8000-000000000002', 'exact@local.test',
    'Exact', 'Member', NULL
  ) ->> 'connected',
  'true',
  'one exact verified-email class profile connects automatically'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
      AND profile_id = 'ca400000-0000-4000-8000-000000000001'
      AND user_id = 'ca100000-0000-4000-8000-000000000002'
      AND status = 'verified'
  ),
  'the exact-email connection creates a verified account link'
);
SELECT extensions.is(
  plugin_data.csf_join_class_by_code(
    'ca200000-0000-4000-8000-000000000001', (SELECT code FROM class_join_test_code),
    'ca100000-0000-4000-8000-000000000002', 'exact@local.test',
    'Exact', 'Member', NULL
  ) ->> 'replayed',
  'true',
  'repeating a class-code redemption is idempotent'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_profile_link_requests
    WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
      AND user_id = 'ca100000-0000-4000-8000-000000000002'
  ),
  1,
  'an idempotent redemption does not duplicate its link request'
);

SELECT extensions.is(
  plugin_data.csf_join_class_by_code(
    'ca200000-0000-4000-8000-000000000001', (SELECT code FROM class_join_test_code),
    'ca100000-0000-4000-8000-000000000003', 'new@local.test',
    'New', 'Student', 'New'
  ) ->> 'connected',
  'true',
  'no email match creates a stable class profile from verified account identity'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_profiles AS profile
    JOIN plugin_data.csf_profile_accounts AS account
      ON account.organization_id = profile.organization_id
     AND account.profile_id = profile.id
    JOIN plugin_data.csf_profile_cohort_memberships AS membership
      ON membership.organization_id = profile.organization_id
     AND membership.profile_id = profile.id
    WHERE profile.organization_id = 'ca200000-0000-4000-8000-000000000001'
      AND profile.normalized_personal_email = 'new@local.test'
      AND account.user_id = 'ca100000-0000-4000-8000-000000000003'
      AND account.status = 'verified'
      AND membership.cohort_id = 'ca300000-0000-4000-8000-000000000001'
      AND membership.status = 'active'
  ),
  'the new profile is linked to the account and lasting graduation class'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_term_memberships
    WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
  ),
  0,
  'permanent class-code joins never activate semester membership'
);

SELECT extensions.is(
  plugin_data.csf_join_class_by_code(
    'ca200000-0000-4000-8000-000000000001', (SELECT code FROM class_join_test_code),
    'ca100000-0000-4000-8000-000000000004', 'ambiguous@local.test',
    'Ambiguous', 'Student', NULL
  ) ->> 'needsReview',
  'true',
  'multiple exact email records enter the officer review queue'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
      AND user_id = 'ca100000-0000-4000-8000-000000000004'
      AND status = 'verified'
  ),
  'ambiguous evidence does not connect an account automatically'
);
SELECT extensions.is(
  (
    SELECT cardinality(candidate_profile_ids)
    FROM plugin_data.csf_profile_link_requests
    WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
      AND user_id = 'ca100000-0000-4000-8000-000000000004'
  ),
  2,
  'the review request retains both exact-email candidates without name matching'
);

SELECT plugin_data.csf_revoke_class_join_code(
  'ca200000-0000-4000-8000-000000000001',
  'ca300000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  'Join test complete'
);
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_join_class_by_code(
      'ca200000-0000-4000-8000-000000000001', %L,
      'ca100000-0000-4000-8000-000000000003', 'new@local.test',
      'New', 'Student', NULL
    )$$,
    (SELECT code FROM class_join_test_code)
  ),
  'P0001',
  'This CSF class code is no longer active.',
  'revoking a permanent class code invalidates it immediately'
);

SELECT * FROM extensions.finish();
ROLLBACK;
