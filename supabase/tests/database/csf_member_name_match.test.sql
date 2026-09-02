-- Name-only class-code evidence always enters one officer review request.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(10);

SELECT extensions.is(
  to_regprocedure(
    'plugin_data.csf_confirm_profile_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text)'
  ),
  NULL,
  'the legacy member name-confirmation RPC is removed'
);
SELECT extensions.is(
  to_regprocedure(
    'plugin_data.csf_join_class_by_code_pre_identity_guard(uuid,text,uuid,text,text,text,text,uuid,uuid)'
  ),
  NULL,
  'the bypassable legacy class-code implementation is removed'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_join_class_by_code(uuid,text,uuid,text,text,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'the server role can call the guarded class-code RPC'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('cb100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@local.test', now(), '{}', '{}', now(), now()),
  ('cb100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'member@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'cb200000-0000-4000-8000-000000000001', 'Name Match Test',
  'name-match-test', 'school', '984003'
);
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'cb200000-0000-4000-8000-000000000001',
  'cb100000-0000-4000-8000-000000000001', 'admin', 'active'
);
INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES (
  'cb300000-0000-4000-8000-000000000001',
  'cb200000-0000-4000-8000-000000000001', 2034, 'Class of 2034'
);

CREATE TEMP TABLE name_match_code AS
SELECT plugin_data.csf_rotate_class_join_code(
  'cb200000-0000-4000-8000-000000000001',
  'cb300000-0000-4000-8000-000000000001',
  'cb100000-0000-4000-8000-000000000001'
) ->> 'code' AS code;

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES (
  'cb400000-0000-4000-8000-000000000001',
  'cb200000-0000-4000-8000-000000000001',
  'Member', 'Match', 'member', 'match'
);
INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) VALUES (
  'cb200000-0000-4000-8000-000000000001',
  'cb400000-0000-4000-8000-000000000001',
  'cb300000-0000-4000-8000-000000000001', 'active'
);

SELECT extensions.is(
  plugin_data.csf_join_class_by_code(
    'cb200000-0000-4000-8000-000000000001',
    (SELECT code FROM name_match_code),
    'cb100000-0000-4000-8000-000000000002', 'member@local.test',
    'Member', 'Match', NULL
  ) ->> 'needsReview',
  'true',
  'a single name-only match enters officer review'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'cb200000-0000-4000-8000-000000000001'
      AND user_id = 'cb100000-0000-4000-8000-000000000002'
      AND status = 'verified'
  ),
  'name-only evidence never creates a verified account link'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_profile_link_requests
    WHERE organization_id = 'cb200000-0000-4000-8000-000000000001'
      AND user_id = 'cb100000-0000-4000-8000-000000000002'
  ),
  1,
  'the first attempt creates one review request'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_join_class_by_code(
      'cb200000-0000-4000-8000-000000000001', %L,
      'cb100000-0000-4000-8000-000000000002', 'member@local.test',
      'Member', 'Match', NULL,
      'cb400000-0000-4000-8000-000000000001', NULL
    )$$,
    (SELECT code FROM name_match_code)
  ),
  'P0001',
  'Name-only profile confirmation is no longer supported.',
  'the compatibility argument cannot confirm a name-only match'
);
SELECT extensions.is(
  plugin_data.csf_join_class_by_code(
    'cb200000-0000-4000-8000-000000000001',
    (SELECT code FROM name_match_code),
    'cb100000-0000-4000-8000-000000000002', 'member@local.test',
    'Member', 'Match', NULL,
    NULL, 'cb400000-0000-4000-8000-000000000001'
  ) ->> 'replayed',
  'true',
  'a declined candidate replays the same officer request'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_profiles
    WHERE organization_id = 'cb200000-0000-4000-8000-000000000001'
      AND normalized_first_name = 'member'
      AND normalized_last_name = 'match'
  ),
  1,
  'declining a candidate does not create a duplicate profile'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_profile_link_requests
    WHERE organization_id = 'cb200000-0000-4000-8000-000000000001'
      AND user_id = 'cb100000-0000-4000-8000-000000000002'
  ),
  1,
  'all name-only retries keep exactly one officer request'
);

SELECT * FROM extensions.finish();
ROLLBACK;
