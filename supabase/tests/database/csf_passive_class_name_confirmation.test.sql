-- Passive account-name confirmation can link only one current, unclaimed
-- class record. Typed names always create one officer review request.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(39);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_confirm_class_code_account_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot call the passive name-confirmation RPC'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_confirm_class_code_account_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text,text)',
    'EXECUTE'
  ),
  'the server role can call the passive name-confirmation RPC'
);

SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_confirm_class_code_account_name_match(
    NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::uuid,
    NULL::uuid, NULL::text, NULL::text, NULL::text
  )$$,
  '42501',
  NULL,
  'an authenticated database role cannot execute the confirmation RPC'
);
RESET ROLE;

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('d1100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@local.test', now(), '{}', '{"full_name":"Test Owner"}', now(), now()),
  ('d1100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'unique@local.test', now(), '{}', '{"full_name":"Unique Member"}', now(), now()),
  ('d1100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'changed@local.test', now(), '{}', '{"full_name":"Changed Member"}', now(), now()),
  ('d1100000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'duplicate@local.test', now(), '{}', '{"full_name":"Duplicate Member"}', now(), now()),
  ('d1100000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'claimant@local.test', now(), '{}', '{"full_name":"Claimed Member"}', now(), now()),
  ('d1100000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'claim-owner@local.test', now(), '{}', '{"full_name":"Claim Owner"}', now(), now()),
  ('d1100000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'multi@local.test', now(), '{}', '{"full_name":"Multi Class"}', now(), now()),
  ('d1100000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'revoked@local.test', now(), '{}', '{"full_name":"Revoked Code"}', now(), now()),
  ('d1100000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'zero@local.test', now(), '{}', '{"full_name":"No Roster"}', now(), now()),
  ('d1100000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'typed@local.test', now(), '{}', '{"full_name":"Typed Match"}', now(), now()),
  ('d1100000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'revoked-link@local.test', now(), '{}', '{"full_name":"Revoked Link"}', now(), now()),
  ('d1100000-0000-4000-8000-00000000000c', 'authenticated', 'authenticated', 'manual-revoked@local.test', now(), '{}', '{"full_name":"Manual Revoked"}', now(), now());

UPDATE public.profiles
SET full_name = CASE id
  WHEN 'd1100000-0000-4000-8000-000000000001' THEN 'Test Owner'
  WHEN 'd1100000-0000-4000-8000-000000000002' THEN 'Unique Member'
  WHEN 'd1100000-0000-4000-8000-000000000003' THEN 'Changed Member'
  WHEN 'd1100000-0000-4000-8000-000000000004' THEN 'Duplicate Member'
  WHEN 'd1100000-0000-4000-8000-000000000005' THEN 'Claimed Member'
  WHEN 'd1100000-0000-4000-8000-000000000006' THEN 'Claim Owner'
  WHEN 'd1100000-0000-4000-8000-000000000007' THEN 'Multi Class'
  WHEN 'd1100000-0000-4000-8000-000000000008' THEN 'Revoked Code'
  WHEN 'd1100000-0000-4000-8000-000000000009' THEN 'No Roster'
  WHEN 'd1100000-0000-4000-8000-00000000000a' THEN 'Typed Match'
  WHEN 'd1100000-0000-4000-8000-00000000000b' THEN 'Revoked Link'
  WHEN 'd1100000-0000-4000-8000-00000000000c' THEN 'Manual Revoked'
END
WHERE id::text LIKE 'd1100000-0000-4000-8000-0000000000%';

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'd1200000-0000-4000-8000-000000000001',
  'Passive Name Test', 'passive-name-test', 'school', '984004'
);
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'd1200000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001', 'admin', 'active'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES
  ('d1300000-0000-4000-8000-000000000001', 'd1200000-0000-4000-8000-000000000001', 2035, 'Class of 2035'),
  ('d1300000-0000-4000-8000-000000000002', 'd1200000-0000-4000-8000-000000000001', 2036, 'Class of 2036');

CREATE TEMP TABLE passive_name_code AS
SELECT
  result ->> 'id' AS id,
  result ->> 'code' AS code
FROM (
  SELECT plugin_data.csf_rotate_class_join_code(
    'd1200000-0000-4000-8000-000000000001',
    'd1300000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-000000000001'
  ) AS result
) AS created;

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES
  ('d1400000-0000-4000-8000-000000000001', 'd1200000-0000-4000-8000-000000000001', 'Unique', 'Member', 'unique', 'member'),
  ('d1400000-0000-4000-8000-000000000002', 'd1200000-0000-4000-8000-000000000001', 'Changed', 'Member', 'changed', 'member'),
  ('d1400000-0000-4000-8000-000000000003', 'd1200000-0000-4000-8000-000000000001', 'Duplicate', 'Member', 'duplicate', 'member'),
  ('d1400000-0000-4000-8000-000000000004', 'd1200000-0000-4000-8000-000000000001', 'Duplicate', 'Member', 'duplicate', 'member'),
  ('d1400000-0000-4000-8000-000000000005', 'd1200000-0000-4000-8000-000000000001', 'Claimed', 'Member', 'claimed', 'member'),
  ('d1400000-0000-4000-8000-000000000006', 'd1200000-0000-4000-8000-000000000001', 'Multi', 'Class', 'multi', 'class'),
  ('d1400000-0000-4000-8000-000000000007', 'd1200000-0000-4000-8000-000000000001', 'Revoked', 'Code', 'revoked', 'code'),
  ('d1400000-0000-4000-8000-000000000008', 'd1200000-0000-4000-8000-000000000001', 'Typed', 'Match', 'typed', 'match');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  personal_email, normalized_personal_email
) VALUES
  ('d1400000-0000-4000-8000-000000000009', 'd1200000-0000-4000-8000-000000000001', 'Revoked', 'Link', 'revoked', 'link', NULL, NULL),
  ('d1400000-0000-4000-8000-00000000000a', 'd1200000-0000-4000-8000-000000000001', 'Manual', 'Revoked', 'manual', 'revoked', 'manual-revoked@local.test', 'manual-revoked@local.test');

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) VALUES
  ('d1200000-0000-4000-8000-000000000001', 'd1400000-0000-4000-8000-000000000001', 'd1300000-0000-4000-8000-000000000001', 'active'),
  ('d1200000-0000-4000-8000-000000000001', 'd1400000-0000-4000-8000-000000000002', 'd1300000-0000-4000-8000-000000000001', 'active'),
  ('d1200000-0000-4000-8000-000000000001', 'd1400000-0000-4000-8000-000000000003', 'd1300000-0000-4000-8000-000000000001', 'active'),
  ('d1200000-0000-4000-8000-000000000001', 'd1400000-0000-4000-8000-000000000004', 'd1300000-0000-4000-8000-000000000001', 'active'),
  ('d1200000-0000-4000-8000-000000000001', 'd1400000-0000-4000-8000-000000000005', 'd1300000-0000-4000-8000-000000000001', 'active'),
  ('d1200000-0000-4000-8000-000000000001', 'd1400000-0000-4000-8000-000000000006', 'd1300000-0000-4000-8000-000000000001', 'active'),
  ('d1200000-0000-4000-8000-000000000001', 'd1400000-0000-4000-8000-000000000006', 'd1300000-0000-4000-8000-000000000002', 'active'),
  ('d1200000-0000-4000-8000-000000000001', 'd1400000-0000-4000-8000-000000000007', 'd1300000-0000-4000-8000-000000000001', 'active'),
  ('d1200000-0000-4000-8000-000000000001', 'd1400000-0000-4000-8000-000000000008', 'd1300000-0000-4000-8000-000000000001', 'active'),
  ('d1200000-0000-4000-8000-000000000001', 'd1400000-0000-4000-8000-000000000009', 'd1300000-0000-4000-8000-000000000001', 'active'),
  ('d1200000-0000-4000-8000-000000000001', 'd1400000-0000-4000-8000-00000000000a', 'd1300000-0000-4000-8000-000000000001', 'active');

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary, linked_by
) VALUES (
  'd1200000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000005',
  'd1100000-0000-4000-8000-000000000006',
  'verified', true, 'd1100000-0000-4000-8000-000000000001'
), (
  'd1200000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000009',
  'd1100000-0000-4000-8000-00000000000b',
  'revoked', false, 'd1100000-0000-4000-8000-000000000001'
), (
  'd1200000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-00000000000a',
  'd1100000-0000-4000-8000-00000000000c',
  'revoked', false, 'd1100000-0000-4000-8000-000000000001'
);

UPDATE plugin_data.csf_profile_accounts
SET revoked_at = now()
WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
  AND status = 'revoked';

SELECT extensions.is(
  plugin_data.csf_confirm_class_code_account_name_match(
    'd1200000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-000000000002', 'unique@local.test',
    (SELECT id::uuid FROM passive_name_code),
    'd1300000-0000-4000-8000-000000000001', 'unique', 'member',
    (SELECT encode(extensions.digest(convert_to(full_name, 'UTF8'), 'sha256'), 'hex')
     FROM public.profiles WHERE id = 'd1100000-0000-4000-8000-000000000002')
  ) ->> 'connected',
  'true',
  'one current unclaimed account-name match connects after confirmation'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
      AND profile_id = 'd1400000-0000-4000-8000-000000000001'
      AND user_id = 'd1100000-0000-4000-8000-000000000002'
      AND status = 'verified'
  ),
  'successful confirmation creates the verified account link'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_term_memberships
   WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'),
  0,
  'account-name confirmation does not activate a semester membership'
);
SELECT extensions.is(
  plugin_data.csf_confirm_class_code_account_name_match(
    'd1200000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-000000000002', 'unique@local.test',
    (SELECT id::uuid FROM passive_name_code),
    'd1300000-0000-4000-8000-000000000001', 'unique', 'member',
    (SELECT encode(extensions.digest(convert_to(full_name, 'UTF8'), 'sha256'), 'hex')
     FROM public.profiles WHERE id = 'd1100000-0000-4000-8000-000000000002')
  ) ->> 'replayed',
  'true',
  'repeating a successful confirmation replays its settled result'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_link_requests
   WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
     AND user_id = 'd1100000-0000-4000-8000-000000000002'),
  1,
  'replay keeps one confirmation receipt'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_confirm_class_code_account_name_match(
    'd1200000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000002',
    'd1100000-0000-4000-8000-000000000003', 'changed@local.test',
    (SELECT id::uuid FROM passive_name_code),
    'd1300000-0000-4000-8000-000000000001', 'changed', 'member',
    repeat('0', 64)
  )$$,
  'a changed account-name snapshot settles as an officer review request'
);
SELECT extensions.is(
  (SELECT match_status FROM plugin_data.csf_profile_link_requests
   WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
     AND user_id = 'd1100000-0000-4000-8000-000000000003'),
  'needs_review',
  'the changed account-name receipt is queued for officer review'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
      AND user_id = 'd1100000-0000-4000-8000-000000000003'
      AND status = 'verified'
  ),
  'changed account-name evidence never links the account'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_link_requests
   WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
     AND user_id = 'd1100000-0000-4000-8000-000000000003'),
  1,
  'changed account-name evidence creates one durable receipt'
);

SELECT extensions.is(
  plugin_data.csf_confirm_class_code_account_name_match(
    'd1200000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000003',
    'd1100000-0000-4000-8000-000000000004', 'duplicate@local.test',
    (SELECT id::uuid FROM passive_name_code),
    'd1300000-0000-4000-8000-000000000001', 'duplicate', 'member',
    (SELECT encode(extensions.digest(convert_to(full_name, 'UTF8'), 'sha256'), 'hex')
     FROM public.profiles WHERE id = 'd1100000-0000-4000-8000-000000000004')
  ) ->> 'needsReview',
  'true',
  'duplicate account-name records require officer review'
);
SELECT extensions.is(
  (SELECT cardinality(candidate_profile_ids) FROM plugin_data.csf_profile_link_requests
   WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
     AND user_id = 'd1100000-0000-4000-8000-000000000004'),
  2,
  'the duplicate-name receipt retains both class candidates'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
      AND user_id = 'd1100000-0000-4000-8000-000000000004'
      AND status = 'verified'
  ),
  'duplicate account-name records do not link an account'
);

SELECT extensions.is(
  plugin_data.csf_confirm_class_code_account_name_match(
    'd1200000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000005',
    'd1100000-0000-4000-8000-000000000005', 'claimant@local.test',
    (SELECT id::uuid FROM passive_name_code),
    'd1300000-0000-4000-8000-000000000001', 'claimed', 'member',
    (SELECT encode(extensions.digest(convert_to(full_name, 'UTF8'), 'sha256'), 'hex')
     FROM public.profiles WHERE id = 'd1100000-0000-4000-8000-000000000005')
  ) ->> 'needsReview',
  'true',
  'a claimed class record cannot connect to a second account'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
      AND profile_id = 'd1400000-0000-4000-8000-000000000005'
      AND user_id = 'd1100000-0000-4000-8000-000000000006'
      AND status = 'verified'
  ),
  'the claimed record stays linked to its original account'
);
SELECT extensions.ok(
  'd1400000-0000-4000-8000-000000000005'::uuid = ANY (
    coalesce(
      (SELECT candidate_profile_ids
       FROM plugin_data.csf_profile_link_requests
       WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
         AND user_id = 'd1100000-0000-4000-8000-000000000005'),
      ARRAY[]::uuid[]
    )
  ),
  'the blocked claimed-record receipt retains the signed target'
);

SELECT extensions.is(
  plugin_data.csf_confirm_class_code_account_name_match(
    'd1200000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000006',
    'd1100000-0000-4000-8000-000000000007', 'multi@local.test',
    (SELECT id::uuid FROM passive_name_code),
    'd1300000-0000-4000-8000-000000000001', 'multi', 'class',
    (SELECT encode(extensions.digest(convert_to(full_name, 'UTF8'), 'sha256'), 'hex')
     FROM public.profiles WHERE id = 'd1100000-0000-4000-8000-000000000007')
  ) ->> 'needsReview',
  'true',
  'a record with a second active class membership requires officer review'
);
SELECT extensions.ok(
  'd1400000-0000-4000-8000-000000000006'::uuid = ANY (
    coalesce(
      (SELECT candidate_profile_ids
       FROM plugin_data.csf_profile_link_requests
       WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
         AND user_id = 'd1100000-0000-4000-8000-000000000007'),
      ARRAY[]::uuid[]
    )
  ),
  'the multiple-class receipt retains the signed target'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
      AND user_id = 'd1100000-0000-4000-8000-000000000007'
      AND status = 'verified'
  ),
  'a record with multiple active classes does not link an account'
);

SELECT extensions.is(
  plugin_data.csf_join_class_by_code(
    'd1200000-0000-4000-8000-000000000001',
    (SELECT code FROM passive_name_code),
    'd1100000-0000-4000-8000-000000000009', 'zero@local.test',
    'No', 'Roster', NULL
  ) ->> 'needsReview',
  'true',
  'a typed name with no roster match creates an officer request'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_profiles
    WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
      AND (normalized_personal_email = 'zero@local.test'
        OR normalized_school_email = 'zero@local.test')
  ),
  'a typed name with no match does not create a profile'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
      AND user_id = 'd1100000-0000-4000-8000-000000000009'
  ),
  'a typed name with no match does not create an account link'
);
SELECT extensions.is(
  plugin_data.csf_join_class_by_code(
    'd1200000-0000-4000-8000-000000000001',
    (SELECT code FROM passive_name_code),
    'd1100000-0000-4000-8000-000000000009', 'zero@local.test',
    'No', 'Roster', NULL
  ) ->> 'replayed',
  'true',
  'a repeated typed zero-match request replays its receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_link_requests
   WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
     AND user_id = 'd1100000-0000-4000-8000-000000000009'),
  1,
  'typed zero-match retries keep one officer request'
);

SELECT extensions.is(
  plugin_data.csf_join_class_by_code(
    'd1200000-0000-4000-8000-000000000001',
    (SELECT code FROM passive_name_code),
    'd1100000-0000-4000-8000-00000000000a', 'typed@local.test',
    'Typed', 'Match', NULL
  ) ->> 'needsReview',
  'true',
  'a manually typed exact name still requires officer review'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
      AND user_id = 'd1100000-0000-4000-8000-00000000000a'
  ),
  'a manually typed exact name does not create an account link'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_link_requests
   WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
     AND user_id = 'd1100000-0000-4000-8000-00000000000a'),
  1,
  'a manually typed exact name creates one officer request'
);

SELECT extensions.is(
  plugin_data.csf_confirm_class_code_account_name_match(
    'd1200000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000009',
    'd1100000-0000-4000-8000-00000000000b', 'revoked-link@local.test',
    (SELECT id::uuid FROM passive_name_code),
    'd1300000-0000-4000-8000-000000000001', 'revoked', 'link',
    (SELECT encode(extensions.digest(convert_to(full_name, 'UTF8'), 'sha256'), 'hex')
     FROM public.profiles WHERE id = 'd1100000-0000-4000-8000-00000000000b')
  ) ->> 'needsReview',
  'true',
  'passive confirmation cannot revive a revoked account link'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_profile_accounts
   WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
     AND profile_id = 'd1400000-0000-4000-8000-000000000009'
     AND user_id = 'd1100000-0000-4000-8000-00000000000b'),
  'revoked',
  'the passive path leaves the revoked link unchanged'
);
SELECT extensions.ok(
  'd1400000-0000-4000-8000-000000000009'::uuid = ANY (
    coalesce(
      (SELECT candidate_profile_ids
       FROM plugin_data.csf_profile_link_requests
       WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
         AND user_id = 'd1100000-0000-4000-8000-00000000000b'),
      ARRAY[]::uuid[]
    )
  ),
  'the revoked-link review receipt retains the signed target'
);

SELECT extensions.is(
  plugin_data.csf_join_class_by_code(
    'd1200000-0000-4000-8000-000000000001',
    (SELECT code FROM passive_name_code),
    'd1100000-0000-4000-8000-00000000000c',
    'manual-revoked@local.test', 'Manual', 'Revoked', NULL
  ) ->> 'needsReview',
  'true',
  'verified-email class joining cannot revive a revoked account link'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_profile_accounts
   WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
     AND profile_id = 'd1400000-0000-4000-8000-00000000000a'
     AND user_id = 'd1100000-0000-4000-8000-00000000000c'),
  'revoked',
  'the verified-email path leaves the revoked link unchanged'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_link_requests
   WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
     AND user_id = 'd1100000-0000-4000-8000-00000000000c'),
  1,
  'the verified-email path creates one officer request for a revoked link'
);

SELECT plugin_data.csf_revoke_class_join_code(
  'd1200000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001',
  'Passive confirmation test complete'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_confirm_class_code_account_name_match(
    'd1200000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000007',
    'd1100000-0000-4000-8000-000000000008', 'revoked@local.test',
    (SELECT id::uuid FROM passive_name_code),
    'd1300000-0000-4000-8000-000000000001', 'revoked', 'code',
    (SELECT encode(extensions.digest(convert_to(full_name, 'UTF8'), 'sha256'), 'hex')
     FROM public.profiles WHERE id = 'd1100000-0000-4000-8000-000000000008')
  )$$,
  'P0001',
  'This CSF class code is no longer active.',
  'a revoked code cannot confirm a passive account-name match'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
      AND user_id = 'd1100000-0000-4000-8000-000000000008'
  ),
  'a revoked code creates no account link'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_link_requests
   WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
     AND user_id = 'd1100000-0000-4000-8000-000000000008'),
  0,
  'a revoked code creates no confirmation receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_term_memberships
   WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'),
  0,
  'no confirmation or typed-name path creates semester membership'
);

SELECT * FROM extensions.finish();
ROLLBACK;
