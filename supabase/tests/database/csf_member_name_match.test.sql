-- Member self-service name matching: the confirm RPC and the class-code
-- join's name branch. All fixtures are synthetic.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(18);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_confirm_profile_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot confirm name matches through a browser-direct RPC'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_confirm_profile_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'the server role can perform the audited name-match confirmation'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('cb100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@local.test', now(), '{}', '{}', now(), now()),
  ('cb100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'unique@local.test', now(), '{}', '{}', now(), now()),
  ('cb100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'twin@local.test', now(), '{}', '{}', now(), now()),
  ('cb100000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'codejoin@local.test', now(), '{}', '{}', now(), now()),
  ('cb100000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'decline@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'cb200000-0000-4000-8000-000000000001', 'Name Match Test',
  'name-match-test', 'school', '984003'
);
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('cb200000-0000-4000-8000-000000000001', 'cb100000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('cb200000-0000-4000-8000-000000000001', 'cb100000-0000-4000-8000-000000000002', 'member', 'active'),
  ('cb200000-0000-4000-8000-000000000001', 'cb100000-0000-4000-8000-000000000003', 'member', 'active');

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES (
  'cb300000-0000-4000-8000-000000000001',
  'cb200000-0000-4000-8000-000000000001', 2034, 'Class of 2034'
);
INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES (
  'cb350000-0000-4000-8000-000000000001',
  'cb200000-0000-4000-8000-000000000001', 'S34', 'Spring 2034', 2034, 'spring', true
);

-- Roster profiles: one unique name, one twin pair, one for the class-code
-- flows. None carry emails -- exactly like the real rosters.
INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES
  ('cb400000-0000-4000-8000-000000000001', 'cb200000-0000-4000-8000-000000000001', 'Unique', 'Rostername', 'unique', 'rostername'),
  ('cb400000-0000-4000-8000-000000000002', 'cb200000-0000-4000-8000-000000000001', 'Twin', 'Samename', 'twin', 'samename'),
  ('cb400000-0000-4000-8000-000000000003', 'cb200000-0000-4000-8000-000000000001', 'Twin', 'Samename', 'twin', 'samename'),
  ('cb400000-0000-4000-8000-000000000004', 'cb200000-0000-4000-8000-000000000001', 'Codejoin', 'Match', 'codejoin', 'match'),
  ('cb400000-0000-4000-8000-000000000005', 'cb200000-0000-4000-8000-000000000001', 'Declined', 'Match', 'declined', 'match');
INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) SELECT
  'cb200000-0000-4000-8000-000000000001', profile_id,
  'cb300000-0000-4000-8000-000000000001', 'active'
FROM unnest(ARRAY[
  'cb400000-0000-4000-8000-000000000001',
  'cb400000-0000-4000-8000-000000000002',
  'cb400000-0000-4000-8000-000000000003',
  'cb400000-0000-4000-8000-000000000004',
  'cb400000-0000-4000-8000-000000000005'
]::uuid[]) AS profile_id;

-- 1. Unique confirmed match links.
SELECT extensions.is(
  plugin_data.csf_confirm_profile_name_match(
    'cb200000-0000-4000-8000-000000000001',
    'cb400000-0000-4000-8000-000000000001',
    'cb100000-0000-4000-8000-000000000002', 'unique@local.test',
    'cb300000-0000-4000-8000-000000000001',
    'cb350000-0000-4000-8000-000000000001',
    'unique', 'rostername'
  ) ->> 'connected',
  'true',
  'a confirmed unique exact-name match connects the account'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'cb200000-0000-4000-8000-000000000001'
      AND profile_id = 'cb400000-0000-4000-8000-000000000001'
      AND user_id = 'cb100000-0000-4000-8000-000000000002'
      AND status = 'verified'
  ),
  'the confirmed name match creates a verified account link'
);
SELECT extensions.is(
  (
    SELECT request.match_status FROM plugin_data.csf_profile_link_requests AS request
    WHERE request.organization_id = 'cb200000-0000-4000-8000-000000000001'
      AND request.user_id = 'cb100000-0000-4000-8000-000000000002'
    ORDER BY request.created_at DESC LIMIT 1
  ),
  'auto_linked',
  'the confirmation records an auto_linked request for the officer audit trail'
);

-- 2. Replay is idempotent.
SELECT extensions.is(
  plugin_data.csf_confirm_profile_name_match(
    'cb200000-0000-4000-8000-000000000001',
    'cb400000-0000-4000-8000-000000000001',
    'cb100000-0000-4000-8000-000000000002', 'unique@local.test',
    'cb300000-0000-4000-8000-000000000001',
    'cb350000-0000-4000-8000-000000000001',
    'unique', 'rostername'
  ) ->> 'replayed',
  'true',
  'repeating a confirmed name match is a replay, not a second link'
);

-- 3. An already-claimed profile refuses a second account (degrades to review).
SELECT extensions.is(
  plugin_data.csf_confirm_profile_name_match(
    'cb200000-0000-4000-8000-000000000001',
    'cb400000-0000-4000-8000-000000000001',
    'cb100000-0000-4000-8000-000000000003', 'twin@local.test',
    'cb300000-0000-4000-8000-000000000001',
    'cb350000-0000-4000-8000-000000000001',
    'unique', 'rostername'
  ) ->> 'needsReview',
  'true',
  'a claimed profile cannot be confirmed by another account; the request queues for review'
);

-- 4. Ambiguous twin names degrade to review even when "confirmed".
SELECT extensions.is(
  plugin_data.csf_confirm_profile_name_match(
    'cb200000-0000-4000-8000-000000000001',
    'cb400000-0000-4000-8000-000000000002',
    'cb100000-0000-4000-8000-000000000003', 'twin@local.test',
    'cb300000-0000-4000-8000-000000000001',
    'cb350000-0000-4000-8000-000000000001',
    'twin', 'samename'
  ) ->> 'needsReview',
  'true',
  'two same-name roster records always require officer review'
);

-- 5. A name mismatch (token names do not match the profile) degrades to review.
SELECT extensions.is(
  plugin_data.csf_confirm_profile_name_match(
    'cb200000-0000-4000-8000-000000000001',
    'cb400000-0000-4000-8000-000000000004',
    'cb100000-0000-4000-8000-000000000003', 'twin@local.test',
    'cb300000-0000-4000-8000-000000000001',
    'cb350000-0000-4000-8000-000000000001',
    'somebody', 'else'
  ) ->> 'needsReview',
  'true',
  'a confirmation whose names no longer match the profile is queued for review'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'cb200000-0000-4000-8000-000000000001'
      AND user_id = 'cb100000-0000-4000-8000-000000000003'
      AND status = 'verified'
  ),
  'no degraded confirmation created a verified link'
);

-- Class-code name branch -------------------------------------------------

CREATE TEMP TABLE name_match_code AS
SELECT plugin_data.csf_rotate_class_join_code(
  'cb200000-0000-4000-8000-000000000001',
  'cb300000-0000-4000-8000-000000000001',
  'cb100000-0000-4000-8000-000000000001'
) ->> 'code' AS code;

-- 6. Unconfirmed single name match queues for review and flags the candidate.
SELECT extensions.is(
  plugin_data.csf_join_class_by_code(
    'cb200000-0000-4000-8000-000000000001', (SELECT code FROM name_match_code),
    'cb100000-0000-4000-8000-000000000004', 'codejoin@local.test',
    'Codejoin', 'Match', NULL
  ) ->> 'nameCandidate',
  'true',
  'an unanswered single name match is flagged, never silently linked'
);
SELECT extensions.is(
  (
    SELECT request.match_status FROM plugin_data.csf_profile_link_requests AS request
    WHERE request.organization_id = 'cb200000-0000-4000-8000-000000000001'
      AND request.user_id = 'cb100000-0000-4000-8000-000000000004'
    ORDER BY request.created_at DESC LIMIT 1
  ),
  'needs_review',
  'the unanswered name match queues for officer review'
);

-- 7. A confirmed retry supersedes the queued row and links the roster profile.
SELECT extensions.is(
  plugin_data.csf_join_class_by_code(
    'cb200000-0000-4000-8000-000000000001', (SELECT code FROM name_match_code),
    'cb100000-0000-4000-8000-000000000004', 'codejoin@local.test',
    'Codejoin', 'Match', NULL,
    'cb400000-0000-4000-8000-000000000004', NULL
  ) ->> 'connected',
  'true',
  'confirming the name match links the existing roster profile'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'cb200000-0000-4000-8000-000000000001'
      AND profile_id = 'cb400000-0000-4000-8000-000000000004'
      AND user_id = 'cb100000-0000-4000-8000-000000000004'
      AND status = 'verified'
  ),
  'the class-code confirmation links to the roster profile, not a duplicate'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_profiles
    WHERE organization_id = 'cb200000-0000-4000-8000-000000000001'
      AND normalized_first_name = 'codejoin'
  ),
  1,
  'no duplicate profile was created for the confirmed returning member'
);

-- 8. A declined match creates a fresh profile and records the near-miss.
SELECT extensions.is(
  plugin_data.csf_join_class_by_code(
    'cb200000-0000-4000-8000-000000000001', (SELECT code FROM name_match_code),
    'cb100000-0000-4000-8000-000000000005', 'decline@local.test',
    'Declined', 'Match', NULL,
    NULL, 'cb400000-0000-4000-8000-000000000005'
  ) ->> 'connected',
  'true',
  'declining the name match creates a new stable profile'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_profiles
    WHERE organization_id = 'cb200000-0000-4000-8000-000000000001'
      AND normalized_first_name = 'declined'
  ),
  2,
  'the declined path creates a second profile instead of linking the roster one'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_link_requests
    WHERE organization_id = 'cb200000-0000-4000-8000-000000000001'
      AND user_id = 'cb100000-0000-4000-8000-000000000005'
      AND 'cb400000-0000-4000-8000-000000000005' = ANY (candidate_profile_ids)
  ),
  'the declined near-miss is recorded for officers'
);

SELECT * FROM extensions.finish();
ROLLBACK;
