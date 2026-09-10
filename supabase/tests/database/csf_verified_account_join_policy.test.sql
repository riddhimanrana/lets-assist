BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('e9100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@local.test', now(), '{}', '{"full_name":"Test Owner"}', now(), now()),
  ('e9100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'unique@local.test', now(), '{}', '{"full_name":"Unique Member"}', now(), now()),
  ('e9100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'changed@local.test', now(), '{}', '{"full_name":"Changed Member"}', now(), now()),
  ('e9100000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'duplicate@local.test', now(), '{}', '{"full_name":"Duplicate Member"}', now(), now()),
  ('e9100000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'claimant@local.test', now(), '{}', '{"full_name":"Claimed Member"}', now(), now()),
  ('e9100000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'claim-owner@local.test', now(), '{}', '{"full_name":"Claim Owner"}', now(), now()),
  ('e9100000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'multi@local.test', now(), '{}', '{"full_name":"Multi Class"}', now(), now()),
  ('e9100000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'revoked@local.test', now(), '{}', '{"full_name":"Revoked Code"}', now(), now()),
  ('e9100000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'zero@local.test', now(), '{}', '{"full_name":"No Roster"}', now(), now()),
  ('e9100000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'typed@local.test', now(), '{}', '{"full_name":"Typed Match"}', now(), now()),
  ('e9100000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'revoked-link@local.test', now(), '{}', '{"full_name":"Revoked Link"}', now(), now()),
  ('e9100000-0000-4000-8000-00000000000c', 'authenticated', 'authenticated', 'manual-revoked@local.test', now(), '{}', '{"full_name":"Manual Revoked"}', now(), now()),
  ('e9100000-0000-4000-8000-00000000000d', 'authenticated', 'authenticated', 'name-only@local.test', now(), '{}', '{"full_name":"Name Only"}', now(), now());

UPDATE public.profiles
SET full_name = CASE id
  WHEN 'e9100000-0000-4000-8000-000000000001' THEN 'Test Owner'
  WHEN 'e9100000-0000-4000-8000-000000000002' THEN 'Unique Member'
  WHEN 'e9100000-0000-4000-8000-000000000003' THEN 'Changed Member'
  WHEN 'e9100000-0000-4000-8000-000000000004' THEN 'Duplicate Member'
  WHEN 'e9100000-0000-4000-8000-000000000005' THEN 'Claimed Member'
  WHEN 'e9100000-0000-4000-8000-000000000006' THEN 'Claim Owner'
  WHEN 'e9100000-0000-4000-8000-000000000007' THEN 'Multi Class'
  WHEN 'e9100000-0000-4000-8000-000000000008' THEN 'Revoked Code'
  WHEN 'e9100000-0000-4000-8000-000000000009' THEN 'No Roster'
  WHEN 'e9100000-0000-4000-8000-00000000000a' THEN 'Typed Match'
  WHEN 'e9100000-0000-4000-8000-00000000000b' THEN 'Revoked Link'
  WHEN 'e9100000-0000-4000-8000-00000000000c' THEN 'Manual Revoked'
  WHEN 'e9100000-0000-4000-8000-00000000000d' THEN 'Name Only'
END
WHERE id::text LIKE 'e9100000-0000-4000-8000-0000000000%';

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'e9200000-0000-4000-8000-000000000001',
  'Passive Name Test', 'verified-ownership-test', 'school', '984004'
);
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'e9200000-0000-4000-8000-000000000001',
  'e9100000-0000-4000-8000-000000000001', 'admin', 'active'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES
  ('e9300000-0000-4000-8000-000000000001', 'e9200000-0000-4000-8000-000000000001', 2035, 'Class of 2035'),
  ('e9300000-0000-4000-8000-000000000002', 'e9200000-0000-4000-8000-000000000001', 2036, 'Class of 2036');

CREATE TEMP TABLE passive_name_code AS
SELECT
  result ->> 'id' AS id,
  result ->> 'code' AS code
FROM (
  SELECT plugin_data.csf_rotate_class_join_code(
    'e9200000-0000-4000-8000-000000000001',
    'e9300000-0000-4000-8000-000000000001',
    'e9100000-0000-4000-8000-000000000001'
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
  ('e9400000-0000-4000-8000-000000000001', 'e9200000-0000-4000-8000-000000000001', 'Unique', 'Member', 'unique', 'member'),
  ('e9400000-0000-4000-8000-000000000002', 'e9200000-0000-4000-8000-000000000001', 'Changed', 'Member', 'changed', 'member'),
  ('e9400000-0000-4000-8000-000000000003', 'e9200000-0000-4000-8000-000000000001', 'Duplicate', 'Member', 'duplicate', 'member'),
  ('e9400000-0000-4000-8000-000000000004', 'e9200000-0000-4000-8000-000000000001', 'Duplicate', 'Member', 'duplicate', 'member'),
  ('e9400000-0000-4000-8000-000000000005', 'e9200000-0000-4000-8000-000000000001', 'Claimed', 'Member', 'claimed', 'member'),
  ('e9400000-0000-4000-8000-000000000006', 'e9200000-0000-4000-8000-000000000001', 'Multi', 'Class', 'multi', 'class'),
  ('e9400000-0000-4000-8000-000000000007', 'e9200000-0000-4000-8000-000000000001', 'Revoked', 'Code', 'revoked', 'code'),
  ('e9400000-0000-4000-8000-000000000008', 'e9200000-0000-4000-8000-000000000001', 'Typed', 'Match', 'typed', 'match');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  personal_email, normalized_personal_email
) VALUES
  ('e9400000-0000-4000-8000-000000000009', 'e9200000-0000-4000-8000-000000000001', 'Revoked', 'Link', 'revoked', 'link', NULL, NULL),
  ('e9400000-0000-4000-8000-00000000000a', 'e9200000-0000-4000-8000-000000000001', 'Manual', 'Revoked', 'manual', 'revoked', 'manual-revoked@local.test', 'manual-revoked@local.test');

UPDATE plugin_data.csf_profiles
SET personal_email = 'unique@local.test',
    normalized_personal_email = 'unique@local.test'
WHERE id = 'e9400000-0000-4000-8000-000000000001';

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES (
  'e9400000-0000-4000-8000-00000000000b',
  'e9200000-0000-4000-8000-000000000001',
  'Name', 'Only', 'name', 'only'
);

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) VALUES
  ('e9200000-0000-4000-8000-000000000001', 'e9400000-0000-4000-8000-000000000001', 'e9300000-0000-4000-8000-000000000001', 'active'),
  ('e9200000-0000-4000-8000-000000000001', 'e9400000-0000-4000-8000-000000000002', 'e9300000-0000-4000-8000-000000000001', 'active'),
  ('e9200000-0000-4000-8000-000000000001', 'e9400000-0000-4000-8000-000000000003', 'e9300000-0000-4000-8000-000000000001', 'active'),
  ('e9200000-0000-4000-8000-000000000001', 'e9400000-0000-4000-8000-000000000004', 'e9300000-0000-4000-8000-000000000001', 'active'),
  ('e9200000-0000-4000-8000-000000000001', 'e9400000-0000-4000-8000-000000000005', 'e9300000-0000-4000-8000-000000000001', 'active'),
  ('e9200000-0000-4000-8000-000000000001', 'e9400000-0000-4000-8000-000000000006', 'e9300000-0000-4000-8000-000000000001', 'active'),
  ('e9200000-0000-4000-8000-000000000001', 'e9400000-0000-4000-8000-000000000006', 'e9300000-0000-4000-8000-000000000002', 'active'),
  ('e9200000-0000-4000-8000-000000000001', 'e9400000-0000-4000-8000-000000000007', 'e9300000-0000-4000-8000-000000000001', 'active'),
  ('e9200000-0000-4000-8000-000000000001', 'e9400000-0000-4000-8000-000000000008', 'e9300000-0000-4000-8000-000000000001', 'active'),
  ('e9200000-0000-4000-8000-000000000001', 'e9400000-0000-4000-8000-000000000009', 'e9300000-0000-4000-8000-000000000001', 'active'),
  ('e9200000-0000-4000-8000-000000000001', 'e9400000-0000-4000-8000-00000000000a', 'e9300000-0000-4000-8000-000000000001', 'active'),
  ('e9200000-0000-4000-8000-000000000001', 'e9400000-0000-4000-8000-00000000000b', 'e9300000-0000-4000-8000-000000000001', 'active');


CREATE TEMP TABLE ownership_results (scenario text, result jsonb);
INSERT INTO ownership_results VALUES ('email',plugin_data.csf_join_class_by_code('e9200000-0000-4000-8000-000000000001',(SELECT code FROM passive_name_code),'e9100000-0000-4000-8000-000000000002','unique@local.test','Unique','Member'));
SELECT extensions.is((SELECT result->>'needsReview' FROM ownership_results WHERE scenario='email'),'true','unverified ownership from matching contact email requires review');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_profile_accounts WHERE organization_id='e9200000-0000-4000-8000-000000000001'),0::bigint,'contact match creates no account links');
SELECT extensions.is((SELECT count(*) FROM public.organization_members WHERE organization_id='e9200000-0000-4000-8000-000000000001' AND user_id='e9100000-0000-4000-8000-000000000002' AND status='active'),1::bigint,'pending student joins organization for staff review');
INSERT INTO ownership_results VALUES ('retry',plugin_data.csf_join_class_by_code('e9200000-0000-4000-8000-000000000001',(SELECT code FROM passive_name_code),'e9100000-0000-4000-8000-000000000002','unique@local.test','Unique','Member'));
SELECT extensions.is((SELECT result->>'requestId' FROM ownership_results WHERE scenario='retry'),(SELECT result->>'requestId' FROM ownership_results WHERE scenario='email'),'pending retry reuses request');
SELECT extensions.is(plugin_data.csf_confirm_class_code_account_name_match('e9200000-0000-4000-8000-000000000001','e9400000-0000-4000-8000-00000000000b','e9100000-0000-4000-8000-00000000000d','name-only@local.test',(SELECT id::uuid FROM passive_name_code),'e9300000-0000-4000-8000-000000000001','Name','Only','arbitrary')->>'needsReview','true','csf_confirm_class_code_account_name_match does not treat names as ownership');
SELECT extensions.is(plugin_data.csf_confirm_class_code_account_name_match_v4('e9200000-0000-4000-8000-000000000001','e9400000-0000-4000-8000-00000000000b','e9100000-0000-4000-8000-00000000000d','name-only@local.test',(SELECT id::uuid FROM passive_name_code),'e9300000-0000-4000-8000-000000000001','Name','Only','arbitrary')->>'needsReview','true','csf_confirm_class_code_account_name_match_v4 does not treat names as ownership');
SELECT extensions.is(plugin_data.csf_confirm_class_code_account_name_match_identity_base('e9200000-0000-4000-8000-000000000001','e9400000-0000-4000-8000-00000000000b','e9100000-0000-4000-8000-00000000000d','name-only@local.test',(SELECT id::uuid FROM passive_name_code),'e9300000-0000-4000-8000-000000000001','Name','Only','arbitrary')->>'needsReview','true','csf_confirm_class_code_account_name_match_identity_base does not treat names as ownership');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_profile_accounts WHERE organization_id='e9200000-0000-4000-8000-000000000001'),0::bigint,'every confirmation path leaves historical ownership unchanged');
INSERT INTO ownership_results VALUES ('new',plugin_data.csf_join_class_by_code('e9200000-0000-4000-8000-000000000001',(SELECT code FROM passive_name_code),'e9100000-0000-4000-8000-000000000009','zero@local.test','No','Roster'));
SELECT extensions.is((SELECT result->>'connected' FROM ownership_results WHERE scenario='new'),'true','new verified account creates its own new profile');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_profile_accounts WHERE organization_id='e9200000-0000-4000-8000-000000000001' AND user_id='e9100000-0000-4000-8000-000000000009' AND status='verified'),1::bigint,'new profile has one verified account link');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_term_memberships WHERE organization_id='e9200000-0000-4000-8000-000000000001'),0::bigint,'joining does not award semester credit');
UPDATE plugin_data.csf_profiles SET personal_email='different@local.test',normalized_personal_email='different@local.test' WHERE id=(SELECT (result->>'profileId')::uuid FROM ownership_results WHERE scenario='new');
INSERT INTO ownership_results VALUES ('existing',plugin_data.csf_join_class_by_code('e9200000-0000-4000-8000-000000000001',(SELECT code FROM passive_name_code),'e9100000-0000-4000-8000-000000000009','zero@local.test','No','Roster'));
SELECT extensions.is((SELECT result->>'connected' FROM ownership_results WHERE scenario='existing'),'true','existing verified account retains ownership when contact emails differ');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_profile_accounts WHERE organization_id='e9200000-0000-4000-8000-000000000001'),1::bigint,'retries never add duplicate account links');
SELECT extensions.ok(NOT has_function_privilege('anon','plugin_data.csf_join_class_by_code(uuid,text,uuid,text,text,text,text,uuid,uuid)','EXECUTE'),'anon cannot call csf_join_class_by_code directly');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_join_class_by_code(uuid,text,uuid,text,text,text,text,uuid,uuid)','EXECUTE'),'authenticated cannot call csf_join_class_by_code directly');
SELECT extensions.ok(NOT has_function_privilege('anon','plugin_data.csf_join_class_by_code_identity_base(uuid,text,uuid,text,text,text,text,uuid,uuid)','EXECUTE'),'anon cannot call csf_join_class_by_code_identity_base directly');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_join_class_by_code_identity_base(uuid,text,uuid,text,text,text,text,uuid,uuid)','EXECUTE'),'authenticated cannot call csf_join_class_by_code_identity_base directly');
SELECT extensions.ok(NOT has_function_privilege('service_role','plugin_data.csf_join_class_by_code_identity_base(uuid,text,uuid,text,text,text,text,uuid,uuid)','EXECUTE'),'owner base is not service callable');
SELECT extensions.ok(NOT has_function_privilege('anon','plugin_data.csf_confirm_class_code_account_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text,text)','EXECUTE'),'anon cannot call csf_confirm_class_code_account_name_match directly');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_confirm_class_code_account_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text,text)','EXECUTE'),'authenticated cannot call csf_confirm_class_code_account_name_match directly');
SELECT extensions.ok(NOT has_function_privilege('anon','plugin_data.csf_confirm_class_code_account_name_match_v4(uuid,uuid,uuid,text,uuid,uuid,text,text,text)','EXECUTE'),'anon cannot call csf_confirm_class_code_account_name_match_v4 directly');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_confirm_class_code_account_name_match_v4(uuid,uuid,uuid,text,uuid,uuid,text,text,text)','EXECUTE'),'authenticated cannot call csf_confirm_class_code_account_name_match_v4 directly');
SELECT extensions.ok(NOT has_function_privilege('anon','plugin_data.csf_confirm_class_code_account_name_match_identity_base(uuid,uuid,uuid,text,uuid,uuid,text,text,text)','EXECUTE'),'anon cannot call csf_confirm_class_code_account_name_match_identity_base directly');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_confirm_class_code_account_name_match_identity_base(uuid,uuid,uuid,text,uuid,uuid,text,text,text)','EXECUTE'),'authenticated cannot call csf_confirm_class_code_account_name_match_identity_base directly');
SELECT extensions.ok(NOT has_function_privilege('service_role','plugin_data.csf_confirm_class_code_account_name_match_identity_base(uuid,uuid,uuid,text,uuid,uuid,text,text,text)','EXECUTE'),'owner base is not service callable');

UPDATE plugin_data.csf_profile_accounts SET connection_basis='unknown' WHERE organization_id='e9200000-0000-4000-8000-000000000001';
SELECT extensions.is(plugin_data.csf_join_class_by_code('e9200000-0000-4000-8000-000000000001',(SELECT code FROM passive_name_code),'e9100000-0000-4000-8000-000000000009','zero@local.test','No','Roster')->>'needsReview','true','a legacy verified status with unknown ownership cannot replay a connection');
UPDATE public.organization_members SET status='inactive' WHERE organization_id='e9200000-0000-4000-8000-000000000001' AND user_id='e9100000-0000-4000-8000-000000000009';
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_join_class_by_code('e9200000-0000-4000-8000-000000000001',(SELECT code FROM passive_name_code),'e9100000-0000-4000-8000-000000000009','zero@local.test','No','Roster')$q$,'P0001',NULL,'inactive organization access cannot be restored by a class code');
DELETE FROM public.organization_members WHERE organization_id='e9200000-0000-4000-8000-000000000001' AND user_id='e9100000-0000-4000-8000-000000000009';
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_join_class_by_code('e9200000-0000-4000-8000-000000000001',(SELECT code FROM passive_name_code),'e9100000-0000-4000-8000-000000000009','zero@local.test','No','Roster')$q$,'P0001',NULL,'removed organization access cannot be recreated by a returning account');
SELECT extensions.is((SELECT count(*) FROM public.organization_members WHERE organization_id='e9200000-0000-4000-8000-000000000001' AND user_id='e9100000-0000-4000-8000-000000000009'),0::bigint,'failed rejoin leaves removed membership absent');
SELECT * FROM extensions.finish();
ROLLBACK;
