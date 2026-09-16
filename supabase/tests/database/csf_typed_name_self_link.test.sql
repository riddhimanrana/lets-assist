-- A student who types their own name connects to their own record, and only
-- when the match is unambiguous and the record is unclaimed.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(40);

-- Reach.
SELECT extensions.ok(NOT has_function_privilege('anon',
  'plugin_data.csf_confirm_class_code_typed_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text)', 'EXECUTE'),
  'anonymous clients cannot confirm a typed-name match');
SELECT extensions.ok(NOT has_function_privilege('authenticated',
  'plugin_data.csf_confirm_class_code_typed_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text)', 'EXECUTE'),
  'authenticated clients cannot confirm a typed-name match directly');
SELECT extensions.ok(has_function_privilege('service_role',
  'plugin_data.csf_confirm_class_code_typed_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text)', 'EXECUTE'),
  'the server role confirms typed-name matches');
SELECT extensions.ok(NOT has_function_privilege('service_role',
  'plugin_data.csf_confirm_class_code_typed_name_match_identity_base(uuid,uuid,uuid,text,uuid,uuid,text,text)', 'EXECUTE'),
  'the lock-free base is unreachable by the server role');
SELECT extensions.ok(NOT has_function_privilege('authenticated',
  'plugin_data.csf_find_typed_name_candidates(uuid,uuid,text)', 'EXECUTE'),
  'browser roles cannot search typed-name candidates');

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('f2100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'typed-owner@local.test', now(), '{}', '{}', now(), now()),
  ('f2100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'sai@local.test', now(), '{}', '{}', now(), now()),
  ('f2100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'ambiguous@local.test', now(), '{}', '{}', now(), now()),
  ('f2100000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'nick@local.test', now(), '{}', '{}', now(), now()),
  ('f2100000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'claimer@local.test', now(), '{}', '{}', now(), now()),
  ('f2100000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'holder@local.test', now(), '{}', '{}', now(), now()),
  ('f2100000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'someone.else@local.test', now(), '{}', '{}', now(), now()),
  ('f2100000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'middle@local.test', now(), '{}', '{}', now(), now()),
  ('f2100000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'shortprefix@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('f2200000-0000-4000-8000-000000000001', 'Typed Name Test', 'typed-name-test', 'school', '984011');
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('f2200000-0000-4000-8000-000000000001', 'f2100000-0000-4000-8000-000000000001', 'admin', 'active');
INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES ('f2300000-0000-4000-8000-000000000001', 'f2200000-0000-4000-8000-000000000001', 2038, 'Class of 2038'),
       ('f2300000-0000-4000-8000-000000000002', 'f2200000-0000-4000-8000-000000000001', 2039, 'Class of 2039');

CREATE TEMP TABLE typed_code AS
SELECT result ->> 'id' AS id, result ->> 'code' AS code
FROM (SELECT plugin_data.csf_rotate_class_join_code(
  'f2200000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001',
  'f2100000-0000-4000-8000-000000000001') AS result) AS created;

INSERT INTO plugin_data.csf_profiles (id, organization_id, first_name, middle_name, last_name, preferred_name, nicknames,
  normalized_first_name, normalized_last_name, reported_application_personal_email)
VALUES
  -- The motivating case: the roster says Saisampath, the student types Sai.
  ('f2400000-0000-4000-8000-000000000001', 'f2200000-0000-4000-8000-000000000001', 'Saisampath', NULL, 'Uppu', NULL, '{}', 'saisampath', 'uppu', NULL),
  -- Two Patels whose first names share a prefix: never unambiguous.
  ('f2400000-0000-4000-8000-000000000002', 'f2200000-0000-4000-8000-000000000001', 'Anika', NULL, 'Patel', NULL, '{}', 'anika', 'patel', NULL),
  ('f2400000-0000-4000-8000-000000000003', 'f2200000-0000-4000-8000-000000000001', 'Anik', NULL, 'Patel', NULL, '{}', 'anik', 'patel', NULL),
  -- A recorded nickname.
  ('f2400000-0000-4000-8000-000000000004', 'f2200000-0000-4000-8000-000000000001', 'Nikhil', NULL, 'Rao', 'Nick', '{}', 'nikhil', 'rao', NULL),
  -- Already connected to someone.
  ('f2400000-0000-4000-8000-000000000005', 'f2200000-0000-4000-8000-000000000001', 'Claimed', NULL, 'Record', NULL, '{}', 'claimed', 'record', NULL),
  -- Carries an application email that belongs to a different signed-in user.
  ('f2400000-0000-4000-8000-000000000006', 'f2200000-0000-4000-8000-000000000001', 'Owned', NULL, 'Elsewhere', NULL, '{}', 'owned', 'elsewhere', 'someone.else@local.test'),
  ('f2400000-0000-4000-8000-000000000007', 'f2200000-0000-4000-8000-000000000001', 'Other', NULL, 'Person', NULL, '{}', 'other', 'person', NULL),
  -- Middle name on the record.
  ('f2400000-0000-4000-8000-000000000008', 'f2200000-0000-4000-8000-000000000001', 'Maya', 'Elise', 'Chen', NULL, '{}', 'maya', 'chen', NULL),
  -- In the other class only.
  ('f2400000-0000-4000-8000-000000000009', 'f2200000-0000-4000-8000-000000000001', 'Sai', NULL, 'Reddy', NULL, '{}', 'sai', 'reddy', NULL),
  -- A short first name where a two-letter prefix must not match.
  ('f2400000-0000-4000-8000-00000000000a', 'f2200000-0000-4000-8000-000000000001', 'Ashwin', NULL, 'Kumar', NULL, '{}', 'ashwin', 'kumar', NULL);

INSERT INTO plugin_data.csf_profile_cohort_memberships (organization_id, profile_id, cohort_id, status)
SELECT 'f2200000-0000-4000-8000-000000000001', id,
  CASE WHEN id = 'f2400000-0000-4000-8000-000000000009'
    THEN 'f2300000-0000-4000-8000-000000000002'::uuid
    ELSE 'f2300000-0000-4000-8000-000000000001'::uuid END,
  'active'
FROM plugin_data.csf_profiles WHERE organization_id = 'f2200000-0000-4000-8000-000000000001';

INSERT INTO plugin_data.csf_profile_accounts (organization_id, profile_id, user_id, status, is_primary, linked_by, connection_basis)
VALUES ('f2200000-0000-4000-8000-000000000001', 'f2400000-0000-4000-8000-000000000005', 'f2100000-0000-4000-8000-000000000006', 'verified', true, 'f2100000-0000-4000-8000-000000000001', 'officer_decision');

-- Candidate search.
SELECT extensions.is(
  (SELECT string_agg(match_kind, ',') FROM plugin_data.csf_find_typed_name_candidates(
    'f2200000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'Sai Uppu')),
  'prefix', 'a three-letter first-name prefix on an exact last name is a candidate');
SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_find_typed_name_candidates(
    'f2200000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'Sa Uppu')),
  0, 'a two-letter prefix is not a candidate');
SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_find_typed_name_candidates(
    'f2200000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'Ani Patel')),
  2, 'a prefix shared by two records returns both');
SELECT extensions.is(
  (SELECT match_kind FROM plugin_data.csf_find_typed_name_candidates(
    'f2200000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'Nick Rao')),
  'nickname', 'a recorded preferred name matches');
SELECT extensions.is(
  (SELECT match_kind FROM plugin_data.csf_find_typed_name_candidates(
    'f2200000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'Maya Elise Chen')),
  'exact_full', 'the full name including the middle name matches exactly');
SELECT extensions.is(
  (SELECT match_kind FROM plugin_data.csf_find_typed_name_candidates(
    'f2200000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'Maya Chen')),
  'exact', 'omitting the middle name still matches on first and last');
SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_find_typed_name_candidates(
    'f2200000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'Claimed Record')),
  0, 'a record with a live connection is never offered');
SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_find_typed_name_candidates(
    'f2200000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'Sai Reddy')),
  0, 'a record in another class is not offered for this code');
SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_find_typed_name_candidates(
    'f2200000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'Saisampath Kumar')),
  0, 'a different last name never matches, however close the first');
SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_find_typed_name_candidates(
    'f2200000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'Uppu')),
  0, 'a single token is not a name');

-- The link itself.
CREATE TEMP TABLE typed_results (scenario text PRIMARY KEY, payload jsonb NOT NULL);
CREATE OR REPLACE FUNCTION pg_temp.typed_hash(p text) RETURNS text LANGUAGE sql AS
  $$ SELECT encode(extensions.digest(convert_to(p, 'UTF8'), 'sha256'), 'hex') $$;

INSERT INTO typed_results VALUES ('sai', plugin_data.csf_confirm_class_code_typed_name_match(
  'f2200000-0000-4000-8000-000000000001', 'f2400000-0000-4000-8000-000000000001',
  'f2100000-0000-4000-8000-000000000002', 'sai@local.test',
  (SELECT id::uuid FROM typed_code), 'f2300000-0000-4000-8000-000000000001',
  'Sai Uppu', pg_temp.typed_hash('Sai Uppu')));
SELECT extensions.is((SELECT payload->>'connected' FROM typed_results WHERE scenario='sai'), 'true',
  'a unique prefix match on an unclaimed record connects');
SELECT extensions.is((SELECT payload->>'connectionBasis' FROM typed_results WHERE scenario='sai'), 'self_confirmed_account_name',
  'the connection is recorded as self-confirmed, not as an email match');
SELECT extensions.is((SELECT payload->>'matchKind' FROM typed_results WHERE scenario='sai'), 'prefix',
  'the receipt says how the name matched');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_profile_accounts
  WHERE profile_id='f2400000-0000-4000-8000-000000000001' AND user_id='f2100000-0000-4000-8000-000000000002'
    AND status='verified' AND connection_basis='self_confirmed_account_name'), 1,
  'one verified self-confirmed account row exists');
SELECT extensions.is((SELECT match_status FROM plugin_data.csf_profile_link_requests
  WHERE organization_id='f2200000-0000-4000-8000-000000000001' AND user_id='f2100000-0000-4000-8000-000000000002'), 'auto_linked',
  'the link request records the auto link');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_admin_audit_events
  WHERE organization_id='f2200000-0000-4000-8000-000000000001' AND action='profile.typed_name_connected'), 1,
  'the self-link is audited under its own action');
SELECT extensions.is((SELECT count(*)::int FROM public.organization_members
  WHERE organization_id='f2200000-0000-4000-8000-000000000001' AND user_id='f2100000-0000-4000-8000-000000000002' AND status='active'), 1,
  'the student becomes an active organization member');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_term_memberships
  WHERE organization_id='f2200000-0000-4000-8000-000000000001'), 0,
  'connecting grants no semester membership');

-- Replay returns the same answer without a second account row.
INSERT INTO typed_results VALUES ('sai_again', plugin_data.csf_confirm_class_code_typed_name_match(
  'f2200000-0000-4000-8000-000000000001', 'f2400000-0000-4000-8000-000000000001',
  'f2100000-0000-4000-8000-000000000002', 'sai@local.test',
  (SELECT id::uuid FROM typed_code), 'f2300000-0000-4000-8000-000000000001',
  'Sai Uppu', pg_temp.typed_hash('Sai Uppu')));
SELECT extensions.is((SELECT payload->>'replayed' FROM typed_results WHERE scenario='sai_again'), 'true',
  'confirming twice replays the settled connection');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_profile_accounts
  WHERE user_id='f2100000-0000-4000-8000-000000000002'), 1, 'a replay adds no account row');

-- Ambiguity goes to an officer.
INSERT INTO typed_results VALUES ('ambiguous', plugin_data.csf_confirm_class_code_typed_name_match(
  'f2200000-0000-4000-8000-000000000001', 'f2400000-0000-4000-8000-000000000002',
  'f2100000-0000-4000-8000-000000000003', 'ambiguous@local.test',
  (SELECT id::uuid FROM typed_code), 'f2300000-0000-4000-8000-000000000001',
  'Ani Patel', pg_temp.typed_hash('Ani Patel')));
SELECT extensions.is((SELECT payload->>'needsReview' FROM typed_results WHERE scenario='ambiguous'), 'true',
  'a name two records fit goes to officer review');
SELECT extensions.is((SELECT cardinality(candidate_profile_ids) FROM plugin_data.csf_profile_link_requests
  WHERE user_id='f2100000-0000-4000-8000-000000000003'), 2,
  'the officer request carries both candidates');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_profile_accounts
  WHERE user_id='f2100000-0000-4000-8000-000000000003'), 0, 'an ambiguous confirm links nothing');
SELECT extensions.is((SELECT count(*)::int FROM public.organization_members
  WHERE organization_id='f2200000-0000-4000-8000-000000000001' AND user_id='f2100000-0000-4000-8000-000000000003' AND status='active'), 1,
  'a student waiting on review is still an active organization member');

-- A nickname connects.
INSERT INTO typed_results VALUES ('nick', plugin_data.csf_confirm_class_code_typed_name_match(
  'f2200000-0000-4000-8000-000000000001', 'f2400000-0000-4000-8000-000000000004',
  'f2100000-0000-4000-8000-000000000004', 'nick@local.test',
  (SELECT id::uuid FROM typed_code), 'f2300000-0000-4000-8000-000000000001',
  'Nick Rao', pg_temp.typed_hash('Nick Rao')));
SELECT extensions.is((SELECT payload->>'connected' FROM typed_results WHERE scenario='nick'), 'true',
  'a recorded nickname connects');

-- A claimed record cannot be taken.
INSERT INTO typed_results VALUES ('claimed', plugin_data.csf_confirm_class_code_typed_name_match(
  'f2200000-0000-4000-8000-000000000001', 'f2400000-0000-4000-8000-000000000005',
  'f2100000-0000-4000-8000-000000000005', 'claimer@local.test',
  (SELECT id::uuid FROM typed_code), 'f2300000-0000-4000-8000-000000000001',
  'Claimed Record', pg_temp.typed_hash('Claimed Record')));
SELECT extensions.is((SELECT payload->>'needsReview' FROM typed_results WHERE scenario='claimed'), 'true',
  'a record someone else holds goes to officer review');
SELECT extensions.is((SELECT user_id FROM plugin_data.csf_profile_accounts
  WHERE profile_id='f2400000-0000-4000-8000-000000000005' AND status='verified'),
  'f2100000-0000-4000-8000-000000000006'::uuid, 'the existing holder keeps the record');

-- An email that belongs to another record blocks self-linking.
INSERT INTO typed_results VALUES ('email_elsewhere', plugin_data.csf_confirm_class_code_typed_name_match(
  'f2200000-0000-4000-8000-000000000001', 'f2400000-0000-4000-8000-000000000007',
  'f2100000-0000-4000-8000-000000000007', 'someone.else@local.test',
  (SELECT id::uuid FROM typed_code), 'f2300000-0000-4000-8000-000000000001',
  'Other Person', pg_temp.typed_hash('Other Person')));
SELECT extensions.is((SELECT payload->>'needsReview' FROM typed_results WHERE scenario='email_elsewhere'), 'true',
  'an account whose email is on a different record cannot self-link elsewhere');

-- A verified email on the record itself is recorded as the stronger basis.
UPDATE plugin_data.csf_profiles SET reported_application_personal_email = 'middle@local.test'
WHERE id = 'f2400000-0000-4000-8000-000000000008';
INSERT INTO typed_results VALUES ('middle', plugin_data.csf_confirm_class_code_typed_name_match(
  'f2200000-0000-4000-8000-000000000001', 'f2400000-0000-4000-8000-000000000008',
  'f2100000-0000-4000-8000-000000000008', 'middle@local.test',
  (SELECT id::uuid FROM typed_code), 'f2300000-0000-4000-8000-000000000001',
  'Maya Elise Chen', pg_temp.typed_hash('Maya Elise Chen')));
SELECT extensions.is((SELECT payload->>'connected' FROM typed_results WHERE scenario='middle'), 'true',
  'a full name with middle name connects');
SELECT extensions.is((SELECT payload->>'connectionBasis' FROM typed_results WHERE scenario='middle'), 'verified_email',
  'when the login email is on the record, the basis is the email, not the name');

-- Guards.
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_confirm_class_code_typed_name_match(
  'f2200000-0000-4000-8000-000000000001', 'f2400000-0000-4000-8000-00000000000a',
  'f2100000-0000-4000-8000-000000000009', 'shortprefix@local.test',
  (SELECT id::uuid FROM typed_code), 'f2300000-0000-4000-8000-000000000001',
  'Ashwin Kumar', pg_temp.typed_hash('Ashwini Kumar'))$q$,
  'The name changed after this match was prepared.',
  'a token minted for a different name is refused');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_confirm_class_code_typed_name_match(
  'f2200000-0000-4000-8000-000000000001', 'f2400000-0000-4000-8000-00000000000a',
  'f2100000-0000-4000-8000-000000000009', 'wrong@local.test',
  (SELECT id::uuid FROM typed_code), 'f2300000-0000-4000-8000-000000000001',
  'Ashwin Kumar', pg_temp.typed_hash('Ashwin Kumar'))$q$,
  'Use the verified email on your signed-in account.',
  'an email that is not the signed-in account''s is refused');

-- The candidate the browser names must be the one the server would pick.
INSERT INTO typed_results VALUES ('wrong_target', plugin_data.csf_confirm_class_code_typed_name_match(
  'f2200000-0000-4000-8000-000000000001', 'f2400000-0000-4000-8000-000000000007',
  'f2100000-0000-4000-8000-000000000009', 'shortprefix@local.test',
  (SELECT id::uuid FROM typed_code), 'f2300000-0000-4000-8000-000000000001',
  'Ashwin Kumar', pg_temp.typed_hash('Ashwin Kumar')));
SELECT extensions.is((SELECT payload->>'needsReview' FROM typed_results WHERE scenario='wrong_target'), 'true',
  'naming a record the typed name does not match goes to review, never links');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_profile_accounts
  WHERE user_id='f2100000-0000-4000-8000-000000000009'), 0, 'and creates no account row');

SELECT plugin_data.csf_revoke_class_join_code('f2200000-0000-4000-8000-000000000001',
  'f2300000-0000-4000-8000-000000000001', 'f2100000-0000-4000-8000-000000000001', 'Typed name tests finished');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_confirm_class_code_typed_name_match(
  'f2200000-0000-4000-8000-000000000001', 'f2400000-0000-4000-8000-00000000000a',
  'f2100000-0000-4000-8000-000000000009', 'shortprefix@local.test',
  (SELECT id::uuid FROM typed_code), 'f2300000-0000-4000-8000-000000000001',
  'Ashwin Kumar', pg_temp.typed_hash('Ashwin Kumar'))$q$,
  'This CSF class code is no longer active.', 'a revoked code cannot confirm');

SELECT * FROM extensions.finish();
ROLLBACK;
