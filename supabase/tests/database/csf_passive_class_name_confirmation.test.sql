-- Account-name confirmation only requests staff review of existing records.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

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


CREATE TEMP TABLE passive_existing_accounts AS SELECT id,status,connection_basis FROM plugin_data.csf_profile_accounts WHERE organization_id='d1200000-0000-4000-8000-000000000001';
INSERT INTO public.organization_members(organization_id,user_id,role,status)
VALUES('d1200000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-00000000000b','member','active'),
('d1200000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-00000000000c','member','active');
SELECT extensions.is(plugin_data.csf_confirm_class_code_account_name_match_v4('d1200000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000002','unique@local.test',(SELECT id::uuid FROM passive_name_code),'d1300000-0000-4000-8000-000000000001','Unique','Member',repeat('0',64))->>'needsReview','true','matching contact requires staff review');
SELECT extensions.is(plugin_data.csf_confirm_class_code_account_name_match_v4('d1200000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000002','unique@local.test',(SELECT id::uuid FROM passive_name_code),'d1300000-0000-4000-8000-000000000001','Unique','Member',repeat('0',64))->>'replayed','true','matching contact retry reuses its request');
SELECT extensions.is(plugin_data.csf_member_profile_snapshot('d1200000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000002')#>>'{profile,id}',NULL::text,'matching contact grants no history access');
SELECT extensions.is(plugin_data.csf_confirm_class_code_account_name_match_v4('d1200000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-000000000002','d1100000-0000-4000-8000-000000000003','changed@local.test',(SELECT id::uuid FROM passive_name_code),'d1300000-0000-4000-8000-000000000001','Changed','Member',repeat('0',64))->>'needsReview','true','changed name snapshot requires staff review');
SELECT extensions.is(plugin_data.csf_confirm_class_code_account_name_match_v4('d1200000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-000000000002','d1100000-0000-4000-8000-000000000003','changed@local.test',(SELECT id::uuid FROM passive_name_code),'d1300000-0000-4000-8000-000000000001','Changed','Member',repeat('0',64))->>'replayed','true','changed name snapshot retry reuses its request');
SELECT extensions.is(plugin_data.csf_member_profile_snapshot('d1200000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000003')#>>'{profile,id}',NULL::text,'changed name snapshot grants no history access');
SELECT extensions.is(plugin_data.csf_confirm_class_code_account_name_match_v4('d1200000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-000000000003','d1100000-0000-4000-8000-000000000004','duplicate@local.test',(SELECT id::uuid FROM passive_name_code),'d1300000-0000-4000-8000-000000000001','Duplicate','Member',repeat('0',64))->>'needsReview','true','duplicate names requires staff review');
SELECT extensions.is(plugin_data.csf_confirm_class_code_account_name_match_v4('d1200000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-000000000003','d1100000-0000-4000-8000-000000000004','duplicate@local.test',(SELECT id::uuid FROM passive_name_code),'d1300000-0000-4000-8000-000000000001','Duplicate','Member',repeat('0',64))->>'replayed','true','duplicate names retry reuses its request');
SELECT extensions.is(plugin_data.csf_member_profile_snapshot('d1200000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000004')#>>'{profile,id}',NULL::text,'duplicate names grants no history access');
SELECT extensions.is(plugin_data.csf_confirm_class_code_account_name_match_v4('d1200000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-000000000005','d1100000-0000-4000-8000-000000000005','claimant@local.test',(SELECT id::uuid FROM passive_name_code),'d1300000-0000-4000-8000-000000000001','Claimed','Member',repeat('0',64))->>'needsReview','true','already claimed profile requires staff review');
SELECT extensions.is(plugin_data.csf_confirm_class_code_account_name_match_v4('d1200000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-000000000005','d1100000-0000-4000-8000-000000000005','claimant@local.test',(SELECT id::uuid FROM passive_name_code),'d1300000-0000-4000-8000-000000000001','Claimed','Member',repeat('0',64))->>'replayed','true','already claimed profile retry reuses its request');
SELECT extensions.is(plugin_data.csf_member_profile_snapshot('d1200000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000005')#>>'{profile,id}',NULL::text,'already claimed profile grants no history access');
SELECT extensions.is(plugin_data.csf_confirm_class_code_account_name_match_v4('d1200000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-000000000006','d1100000-0000-4000-8000-000000000007','multi@local.test',(SELECT id::uuid FROM passive_name_code),'d1300000-0000-4000-8000-000000000001','Multi','Class',repeat('0',64))->>'needsReview','true','multiple active classes requires staff review');
SELECT extensions.is(plugin_data.csf_confirm_class_code_account_name_match_v4('d1200000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-000000000006','d1100000-0000-4000-8000-000000000007','multi@local.test',(SELECT id::uuid FROM passive_name_code),'d1300000-0000-4000-8000-000000000001','Multi','Class',repeat('0',64))->>'replayed','true','multiple active classes retry reuses its request');
SELECT extensions.is(plugin_data.csf_member_profile_snapshot('d1200000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000007')#>>'{profile,id}',NULL::text,'multiple active classes grants no history access');
SELECT extensions.is(plugin_data.csf_confirm_class_code_account_name_match_v4('d1200000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-00000000000b','d1100000-0000-4000-8000-00000000000d','name-only@local.test',(SELECT id::uuid FROM passive_name_code),'d1300000-0000-4000-8000-000000000001','Name','Only',repeat('0',64))->>'needsReview','true','account name only requires staff review');
SELECT extensions.is(plugin_data.csf_confirm_class_code_account_name_match_v4('d1200000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-00000000000b','d1100000-0000-4000-8000-00000000000d','name-only@local.test',(SELECT id::uuid FROM passive_name_code),'d1300000-0000-4000-8000-000000000001','Name','Only',repeat('0',64))->>'replayed','true','account name only retry reuses its request');
SELECT extensions.is(plugin_data.csf_member_profile_snapshot('d1200000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-00000000000d')#>>'{profile,id}',NULL::text,'account name only grants no history access');
SELECT extensions.is(plugin_data.csf_confirm_class_code_account_name_match_v4('d1200000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-000000000009','d1100000-0000-4000-8000-00000000000b','revoked-link@local.test',(SELECT id::uuid FROM passive_name_code),'d1300000-0000-4000-8000-000000000001','Revoked','Link',repeat('0',64))->>'needsReview','true','revoked connection requires staff review');
SELECT extensions.is(plugin_data.csf_confirm_class_code_account_name_match_v4('d1200000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-000000000009','d1100000-0000-4000-8000-00000000000b','revoked-link@local.test',(SELECT id::uuid FROM passive_name_code),'d1300000-0000-4000-8000-000000000001','Revoked','Link',repeat('0',64))->>'replayed','true','revoked connection retry reuses its request');
SELECT extensions.is(plugin_data.csf_member_profile_snapshot('d1200000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-00000000000b')#>>'{profile,id}',NULL::text,'revoked connection grants no history access');

SELECT extensions.ok(NOT EXISTS((SELECT id,status,connection_basis FROM plugin_data.csf_profile_accounts WHERE organization_id='d1200000-0000-4000-8000-000000000001' EXCEPT SELECT * FROM passive_existing_accounts) UNION ALL (SELECT * FROM passive_existing_accounts EXCEPT SELECT id,status,connection_basis FROM plugin_data.csf_profile_accounts WHERE organization_id='d1200000-0000-4000-8000-000000000001')),'confirmation never creates or changes account ownership');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_confirm_class_code_account_name_match_v4('d1200000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000002','wrong@local.test',(SELECT id::uuid FROM passive_name_code),'d1300000-0000-4000-8000-000000000001','Unique','Member','ignored')$q$,'P0001',NULL,'an incorrect signed-in email is rejected');
SELECT plugin_data.csf_revoke_class_join_code('d1200000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000001','Fictional confirmation tests finished');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_confirm_class_code_account_name_match_v4('d1200000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000002','unique@local.test',(SELECT id::uuid FROM passive_name_code),'d1300000-0000-4000-8000-000000000001','Unique','Member','ignored')$q$,'P0001','This CSF class code is no longer active.','a revoked code cannot submit confirmation');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_term_memberships WHERE organization_id='d1200000-0000-4000-8000-000000000001'),0::bigint,'confirmation grants no semester membership');
SELECT * FROM extensions.finish();
ROLLBACK;
