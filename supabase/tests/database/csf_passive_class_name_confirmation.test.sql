-- Exact account-name self-confirmation is a lower-assurance connection basis.
-- Typed names, changed candidates, and conflicting evidence remain in review.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(76);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_confirm_class_code_account_name_match_v4(uuid,uuid,uuid,text,uuid,uuid,text,text,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot call the passive name-confirmation RPC'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_confirm_class_code_account_name_match_v4(uuid,uuid,uuid,text,uuid,uuid,text,text,text)',
    'EXECUTE'
  ),
  'the server role can call the passive name-confirmation RPC'
);

SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_confirm_class_code_account_name_match_v4(
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
  ('d1100000-0000-4000-8000-00000000000c', 'authenticated', 'authenticated', 'manual-revoked@local.test', now(), '{}', '{"full_name":"Manual Revoked"}', now(), now()),
  ('d1100000-0000-4000-8000-00000000000d', 'authenticated', 'authenticated', 'name-only@local.test', now(), '{}', '{"full_name":"Name Only"}', now(), now());

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
  WHEN 'd1100000-0000-4000-8000-00000000000d' THEN 'Name Only'
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

CREATE TEMP TABLE passive_replay_results (
  scenario text PRIMARY KEY,
  payload jsonb NOT NULL
);

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

UPDATE plugin_data.csf_profiles
SET personal_email = 'unique@local.test',
    normalized_personal_email = 'unique@local.test'
WHERE id = 'd1400000-0000-4000-8000-000000000001';

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES (
  'd1400000-0000-4000-8000-00000000000b',
  'd1200000-0000-4000-8000-000000000001',
  'Name', 'Only', 'name', 'only'
);

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
  ('d1200000-0000-4000-8000-000000000001', 'd1400000-0000-4000-8000-00000000000a', 'd1300000-0000-4000-8000-000000000001', 'active'),
  ('d1200000-0000-4000-8000-000000000001', 'd1400000-0000-4000-8000-00000000000b', 'd1300000-0000-4000-8000-000000000001', 'active');

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

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('d1100000-0000-4000-8000-00000000000e', 'authenticated', 'authenticated',
  'legacy-policy@local.test', now(), '{}', '{"full_name":"Legacy Member"}', now(), now());
UPDATE public.profiles SET full_name = 'Legacy Member'
WHERE id = 'd1100000-0000-4000-8000-00000000000e';
INSERT INTO plugin_data.csf_profiles (id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name)
VALUES ('d1400000-0000-4000-8000-00000000000c', 'd1200000-0000-4000-8000-000000000001',
  'Legacy', 'Member', 'legacy', 'member');
INSERT INTO plugin_data.csf_profile_cohort_memberships (organization_id, profile_id, cohort_id, status)
VALUES ('d1200000-0000-4000-8000-000000000001', 'd1400000-0000-4000-8000-00000000000c',
  'd1300000-0000-4000-8000-000000000001', 'active');
SELECT extensions.is(plugin_data.csf_confirm_class_code_account_name_match(
  'd1200000-0000-4000-8000-000000000001', 'd1400000-0000-4000-8000-00000000000c',
  'd1100000-0000-4000-8000-00000000000e', 'legacy-policy@local.test',
  (SELECT id::uuid FROM passive_name_code), 'd1300000-0000-4000-8000-000000000001',
  'legacy', 'member', encode(extensions.digest(convert_to('Legacy Member', 'UTF8'), 'sha256'), 'hex'))
  ->> 'needsReview', 'true', 'the previous policy endpoint remains review-only for old pages');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_profile_accounts
  WHERE user_id = 'd1100000-0000-4000-8000-00000000000e'), 0,
  'an old policy request cannot create a name claim after migration');

UPDATE plugin_data.csf_profiles SET middle_name = 'Middle', last_name = 'van Only',
  normalized_last_name = 'van only'
WHERE id = 'd1400000-0000-4000-8000-00000000000b';
UPDATE public.profiles SET full_name = 'Name Middle van Only'
WHERE id = 'd1100000-0000-4000-8000-00000000000d';

SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_find_account_name_candidate(
  'd1200000-0000-4000-8000-000000000001', 'd1300000-0000-4000-8000-000000000001',
  'Name Middle van Only')), 1, 'full names include middle names and multiword surnames');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_find_account_name_candidate(
  'd1200000-0000-4000-8000-000000000001', 'd1300000-0000-4000-8000-000000000001',
  'Name Wrong van Only')), 0, 'a different middle name cannot match');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_find_account_name_candidate(
  'd1200000-0000-4000-8000-000000000001', 'd1300000-0000-4000-8000-000000000001',
  'Name van Only')), 0, 'omitting the middle name cannot match');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_find_account_name_candidate(
  'd1200000-0000-4000-8000-000000000001', 'd1300000-0000-4000-8000-000000000001',
  'Duplicate Member')), 0, 'duplicate names produce no candidate');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_find_account_name_candidate(
  'd1200000-0000-4000-8000-000000000001', 'd1300000-0000-4000-8000-000000000001',
  'Claimed Member')), 0, 'claimed profiles produce no candidate');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_find_account_name_candidate(
  'd1200000-0000-4000-8000-000000000002', 'd1300000-0000-4000-8000-000000000001',
  'Name Middle van Only')), 0, 'another organization cannot read a candidate');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_find_account_name_candidate(
  'd1200000-0000-4000-8000-000000000001', 'd1300000-0000-4000-8000-000000000002',
  'Name Middle van Only')), 0, 'another class cannot read a candidate');
SELECT extensions.ok(NOT has_function_privilege('authenticated',
  'plugin_data.csf_find_account_name_candidate(uuid,uuid,text)', 'EXECUTE'),
  'browser roles cannot search the name-candidate function');
SELECT extensions.ok(has_function_privilege('service_role',
  'plugin_data.csf_find_account_name_candidate(uuid,uuid,text)', 'EXECUTE'),
  'only the server can request a candidate');

INSERT INTO passive_replay_results (scenario, payload)
SELECT
  'initial verified email connection',
  plugin_data.csf_confirm_class_code_account_name_match_v4(
    'd1200000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-000000000002', 'unique@local.test',
    (SELECT id::uuid FROM passive_name_code),
    'd1300000-0000-4000-8000-000000000001', 'unique', 'member',
    (SELECT encode(extensions.digest(convert_to(full_name, 'UTF8'), 'sha256'), 'hex')
     FROM public.profiles WHERE id = 'd1100000-0000-4000-8000-000000000002')
  );
SELECT extensions.is(
  (SELECT payload ->> 'connected' FROM passive_replay_results
   WHERE scenario = 'initial verified email connection'),
  'true',
  'one exact verified roster email connects after confirmation'
);
SELECT extensions.is(
  (SELECT payload ->> 'connectionBasis' FROM passive_replay_results
   WHERE scenario = 'initial verified email connection'),
  'verified_email',
  'the locked connection receipt states its verified-email basis'
);
SELECT extensions.is(
  (SELECT payload ->> 'verifiedEmailMatch' FROM passive_replay_results
   WHERE scenario = 'initial verified email connection'),
  'true',
  'the locked connection receipt proves the exact verified-email match'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
      AND profile_id = 'd1400000-0000-4000-8000-000000000001'
      AND user_id = 'd1100000-0000-4000-8000-000000000002'
      AND status = 'verified'
  ),
  'verified-email confirmation creates the account link'
);

SELECT extensions.is(
  plugin_data.csf_confirm_class_code_account_name_match_v4(
    'd1200000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-00000000000b',
    'd1100000-0000-4000-8000-00000000000d', 'name-only@local.test',
    (SELECT id::uuid FROM passive_name_code),
    'd1300000-0000-4000-8000-000000000001', 'name', 'only',
    (SELECT encode(extensions.digest(convert_to(full_name, 'UTF8'), 'sha256'), 'hex')
     FROM public.profiles WHERE id = 'd1100000-0000-4000-8000-00000000000d')
  ) ->> 'connected',
  'true',
  'one exact unclaimed account-name snapshot connects after confirmation'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
      AND user_id = 'd1100000-0000-4000-8000-00000000000d'
      AND status = 'verified'
      AND connection_basis = 'self_confirmed_account_name'
  ),
  'the connected link records account-name confirmation rather than email proof'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_link_requests
   WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
     AND user_id = 'd1100000-0000-4000-8000-00000000000d'),
  1,
  'the name confirmation creates exactly one connection receipt'
);
SELECT extensions.ok(
  'd1400000-0000-4000-8000-00000000000b'::uuid = ANY (
    coalesce(
      (SELECT candidate_profile_ids
       FROM plugin_data.csf_profile_link_requests
       WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
         AND user_id = 'd1100000-0000-4000-8000-00000000000d'),
      ARRAY[]::uuid[]
    )
  ),
  'the connection receipt retains the selected name candidate'
);
INSERT INTO passive_replay_results (scenario, payload)
SELECT 'name basis replay', plugin_data.csf_confirm_class_code_account_name_match_v4(
  'd1200000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-00000000000b',
  'd1100000-0000-4000-8000-00000000000d', 'name-only@local.test',
  (SELECT id::uuid FROM passive_name_code),
  'd1300000-0000-4000-8000-000000000001', 'name', 'only',
  (SELECT encode(extensions.digest(convert_to(full_name, 'UTF8'), 'sha256'), 'hex')
   FROM public.profiles WHERE id = 'd1100000-0000-4000-8000-00000000000d')
);
SELECT extensions.is(
  (SELECT payload ->> 'connectionBasis' FROM passive_replay_results WHERE scenario = 'name basis replay'),
  'self_confirmed_account_name', 'a retry preserves the lower-assurance connection basis'
);
SELECT extensions.is(
  (SELECT payload ->> 'verifiedEmailMatch' FROM passive_replay_results WHERE scenario = 'name basis replay'),
  'false', 'name confirmation never becomes email verification on retry'
);
SELECT extensions.is(
  (SELECT payload ->> 'connected' FROM passive_replay_results WHERE scenario = 'name basis replay'),
  'true', 'name confirmation stays connected through the replay guard'
);
SELECT extensions.is(
  plugin_data.csf_member_profile_snapshot(
    'd1200000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-00000000000d'
  ) #>> '{profile,id}',
  'd1400000-0000-4000-8000-00000000000b',
  'the member can read the connected profile without a matching roster email'
);
SELECT extensions.is(
  (SELECT connection_basis FROM plugin_data.csf_profile_accounts
   WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
     AND user_id = 'd1100000-0000-4000-8000-000000000006'),
  'unknown', 'an unrelated legacy link does not receive guessed provenance'
);
SELECT extensions.ok(
  NOT has_function_privilege('service_role',
    'plugin_data.csf_revalidate_class_code_connection_replay_legacy(uuid,uuid,uuid,uuid,jsonb)', 'EXECUTE'),
  'the preserved replay implementation stays owner-only'
);
SELECT extensions.ok(
  NOT has_function_privilege('service_role', 'plugin_data.csf_record_connection_basis()', 'EXECUTE'),
  'the provenance trigger function stays owner-only'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_term_memberships
   WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'),
  0,
  'account-name confirmation does not activate a semester membership'
);
INSERT INTO passive_replay_results (scenario, payload)
SELECT
  'safe passive replay',
  plugin_data.csf_confirm_class_code_account_name_match_v4(
    'd1200000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-000000000002', 'unique@local.test',
    (SELECT id::uuid FROM passive_name_code),
    'd1300000-0000-4000-8000-000000000001', 'unique', 'member',
    (SELECT encode(extensions.digest(convert_to(full_name, 'UTF8'), 'sha256'), 'hex')
     FROM public.profiles WHERE id = 'd1100000-0000-4000-8000-000000000002')
  );
SELECT extensions.is(
  (SELECT payload ->> 'connected' FROM passive_replay_results
   WHERE scenario = 'safe passive replay'),
  'true',
  'an unchanged passive confirmation remains connected on replay'
);
SELECT extensions.is(
  (SELECT payload ->> 'replayed' FROM passive_replay_results
   WHERE scenario = 'safe passive replay'),
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

SELECT extensions.is(
  plugin_data.csf_unlink_profile_account(
    'd1200000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000001',
    (SELECT id FROM plugin_data.csf_profile_accounts
     WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
       AND profile_id = 'd1400000-0000-4000-8000-000000000001'
       AND user_id = 'd1100000-0000-4000-8000-000000000002'),
    'Officer removed the incorrect account connection.',
    'd1100000-0000-4000-8000-000000000001'
  ) ->> 'status',
  'revoked',
  'an officer can revoke the confirmed account connection'
);
SELECT extensions.is(
  plugin_data.csf_join_class_by_code(
    'd1200000-0000-4000-8000-000000000001',
    (SELECT code FROM passive_name_code),
    'd1100000-0000-4000-8000-000000000002', 'unique@local.test',
    'Unique', 'Member', NULL
  ) ->> 'needsReview',
  'true',
  'joining after an officer unlink returns to officer review'
);
SELECT extensions.is(
  (SELECT match_status FROM plugin_data.csf_profile_link_requests
   WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
     AND user_id = 'd1100000-0000-4000-8000-000000000002'),
  'needs_review',
  'the stale auto-linked receipt is reopened for officer review'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_link_requests
   WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
     AND user_id = 'd1100000-0000-4000-8000-000000000002'),
  1,
  'reconnection reuses one durable request'
);

UPDATE plugin_data.csf_profile_accounts
SET status = 'verified',
    is_primary = true,
    linked_by = 'd1100000-0000-4000-8000-000000000002',
    linked_at = pg_catalog.transaction_timestamp(),
    revoked_at = NULL,
    notes = 'Connected by one exact verified-email class match.'
WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
  AND profile_id = 'd1400000-0000-4000-8000-000000000001'
  AND user_id = 'd1100000-0000-4000-8000-000000000002';
UPDATE plugin_data.csf_profile_link_requests
SET match_status = 'auto_linked',
    resolved_by = user_id,
    resolved_at = pg_catalog.transaction_timestamp(),
    resolution_notes =
      'Connected by one exact verified-email match in the selected class.'
WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
  AND user_id = 'd1100000-0000-4000-8000-000000000002';
INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) VALUES (
  'd1200000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000002',
  'active'
);
INSERT INTO passive_replay_results (scenario, payload)
SELECT
  'passive replay after class drift',
  plugin_data.csf_confirm_class_code_account_name_match_v4(
    'd1200000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-000000000002', 'unique@local.test',
    (SELECT id::uuid FROM passive_name_code),
    'd1300000-0000-4000-8000-000000000001', 'unique', 'member',
    (SELECT encode(extensions.digest(convert_to(full_name, 'UTF8'), 'sha256'), 'hex')
     FROM public.profiles WHERE id = 'd1100000-0000-4000-8000-000000000002')
  );
SELECT extensions.is(
  (SELECT payload ->> 'connected' FROM passive_replay_results
   WHERE scenario = 'passive replay after class drift'),
  'false',
  'a passive confirmation replay fails closed after a second active class appears'
);
SELECT extensions.is(
  (SELECT payload ->> 'needsReview' FROM passive_replay_results
   WHERE scenario = 'passive replay after class drift'),
  'true',
  'passive class drift returns a durable officer-review state'
);
SELECT extensions.is(
  (SELECT match_status FROM plugin_data.csf_profile_link_requests
   WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
     AND user_id = 'd1100000-0000-4000-8000-000000000002'),
  'needs_review',
  'passive class drift reopens the exact existing request'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_profile_accounts
   WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
     AND profile_id = 'd1400000-0000-4000-8000-000000000001'
     AND user_id = 'd1100000-0000-4000-8000-000000000002'),
  'revoked',
  'passive class drift revokes the exact stale verified link'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = 'd1200000-0000-4000-8000-000000000001'
      AND audit.actor_user_id = 'd1100000-0000-4000-8000-000000000002'
      AND audit.actor_profile_id = 'd1400000-0000-4000-8000-000000000001'
      AND audit.action = 'profile.link_request_revalidation_failed'
      AND (audit.after_data -> 'blockerCodes') ? 'active_class_changed'
  ),
  'passive class drift records its stable blocker code'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = 'd1200000-0000-4000-8000-000000000001'
      AND audit.action = 'profile.link_request_revalidation_failed'
      AND (
        coalesce(audit.before_data::text, '') || coalesce(audit.after_data::text, '')
      ) ~* '(unique@local[.]test|unique member)'
  ),
  'passive replay-revalidation audits contain no email or student name'
);

DELETE FROM plugin_data.csf_profile_cohort_memberships
WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
  AND profile_id = 'd1400000-0000-4000-8000-000000000001'
  AND cohort_id = 'd1300000-0000-4000-8000-000000000002';

UPDATE plugin_data.csf_profile_accounts
SET status = 'verified',
    is_primary = true,
    linked_by = 'd1100000-0000-4000-8000-000000000001',
    linked_at = pg_catalog.clock_timestamp(),
    revoked_at = NULL,
    notes = 'Accepted a direct CSF student invitation.'
WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
  AND profile_id = 'd1400000-0000-4000-8000-000000000001'
  AND user_id = 'd1100000-0000-4000-8000-000000000002';

SELECT extensions.is(
  plugin_data.csf_confirm_class_code_account_name_match_v4(
    'd1200000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-000000000002', 'unique@local.test',
    (SELECT id::uuid FROM passive_name_code),
    'd1300000-0000-4000-8000-000000000001', 'unique', 'member',
    (SELECT encode(extensions.digest(convert_to(full_name, 'UTF8'), 'sha256'), 'hex')
     FROM public.profiles WHERE id = 'd1100000-0000-4000-8000-000000000002')
  ) ->> 'connected',
  'true',
  'an independently reconnected account remains connected on an old-request replay'
);
SELECT extensions.is(
  (SELECT status || ':' || notes
   FROM plugin_data.csf_profile_accounts
   WHERE organization_id = 'd1200000-0000-4000-8000-000000000001'
     AND profile_id = 'd1400000-0000-4000-8000-000000000001'
     AND user_id = 'd1100000-0000-4000-8000-000000000002'),
  'verified:Accepted a direct CSF student invitation.',
  'old request revalidation never revokes a newer independent profile link'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_confirm_class_code_account_name_match_v4(
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
  plugin_data.csf_confirm_class_code_account_name_match_v4(
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
  plugin_data.csf_confirm_class_code_account_name_match_v4(
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
  plugin_data.csf_confirm_class_code_account_name_match_v4(
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
  plugin_data.csf_confirm_class_code_account_name_match_v4(
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
  $$SELECT plugin_data.csf_confirm_class_code_account_name_match_v4(
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
