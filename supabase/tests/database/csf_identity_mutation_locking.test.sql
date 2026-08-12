-- Real-session lock-order coverage cannot run inside a rolled-back fixture:
-- dblink sessions cannot observe uncommitted setup. The namespaced synthetic
-- rows intentionally remain only in the disposable isolated replay database.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(9);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('fd000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'identity-lock-officer@local.test', now(), '{}', '{}', now(), now()),
  ('fd000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'identity-lock-claim@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('fd100000-0000-4000-8000-000000000001', 'CSF Identity Lock A', 'csf-identity-lock-a', 'school', '983331'),
  ('fd100000-0000-4000-8000-000000000002', 'CSF Identity Lock B', 'csf-identity-lock-b', 'school', '983332');
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('fd100000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('fd100000-0000-4000-8000-000000000002', 'fd000000-0000-4000-8000-000000000001', 'admin', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES
  ('fd200000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001', 'FALL-2042', 'Fall 2042', '2042-2043', 'fall', true),
  ('fd200000-0000-4000-8000-000000000002', 'fd100000-0000-4000-8000-000000000002', 'FALL-2042', 'Fall 2042', '2042-2043', 'fall', true);
INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES
  ('fd300000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001', 2043, 'Class of 2043'),
  ('fd300000-0000-4000-8000-000000000002', 'fd100000-0000-4000-8000-000000000002', 2043, 'Class of 2043');
INSERT INTO plugin_data.csf_cohort_terms (
  organization_id, cohort_id, term_id, grade_level, status
) VALUES
  ('fd100000-0000-4000-8000-000000000001', 'fd300000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', 12, 'active'),
  ('fd100000-0000-4000-8000-000000000002', 'fd300000-0000-4000-8000-000000000002', 'fd200000-0000-4000-8000-000000000002', 12, 'active');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, preferred_name, school_email,
  personal_email, normalized_first_name, normalized_last_name,
  normalized_school_email, normalized_personal_email
) VALUES
  ('fd400000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001', 'Edit', 'Merge', 'Source', 'edit.merge@local.test', NULL, 'edit', 'merge', 'edit.merge@local.test', NULL),
  ('fd400000-0000-4000-8000-000000000002', 'fd100000-0000-4000-8000-000000000001', 'Edit', 'Merge', 'Target', 'edit.merge@local.test', NULL, 'edit', 'merge', 'edit.merge@local.test', NULL),
  ('fd400000-0000-4000-8000-000000000003', 'fd100000-0000-4000-8000-000000000001', 'Claim', 'Member', NULL, NULL, 'identity-lock-claim@local.test', 'claim', 'member', NULL, 'identity-lock-claim@local.test'),
  ('fd400000-0000-4000-8000-000000000004', 'fd100000-0000-4000-8000-000000000001', 'Claim', 'Merge', 'Source', 'claim.merge@local.test', NULL, 'claim', 'merge', 'claim.merge@local.test', NULL),
  ('fd400000-0000-4000-8000-000000000005', 'fd100000-0000-4000-8000-000000000001', 'Claim', 'Merge', 'Target', 'claim.merge@local.test', NULL, 'claim', 'merge', 'claim.merge@local.test', NULL),
  ('fd400000-0000-4000-8000-000000000006', 'fd100000-0000-4000-8000-000000000002', 'Cross', 'Organization', NULL, 'cross.organization@local.test', NULL, 'cross', 'organization', 'cross.organization@local.test', NULL);

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) VALUES
  ('fd100000-0000-4000-8000-000000000001', 'fd400000-0000-4000-8000-000000000001', 'fd300000-0000-4000-8000-000000000001', 'active'),
  ('fd100000-0000-4000-8000-000000000001', 'fd400000-0000-4000-8000-000000000002', 'fd300000-0000-4000-8000-000000000001', 'archived'),
  ('fd100000-0000-4000-8000-000000000001', 'fd400000-0000-4000-8000-000000000003', 'fd300000-0000-4000-8000-000000000001', 'active'),
  ('fd100000-0000-4000-8000-000000000001', 'fd400000-0000-4000-8000-000000000004', 'fd300000-0000-4000-8000-000000000001', 'active'),
  ('fd100000-0000-4000-8000-000000000001', 'fd400000-0000-4000-8000-000000000005', 'fd300000-0000-4000-8000-000000000001', 'archived'),
  ('fd100000-0000-4000-8000-000000000002', 'fd400000-0000-4000-8000-000000000006', 'fd300000-0000-4000-8000-000000000002', 'active');

INSERT INTO plugin_data.csf_onboarding_links (
  id, organization_id, term_id, cohort_id, code, title, link_type,
  invitation_scope, delivery_status, is_active
) VALUES (
  'fd500000-0000-4000-8000-000000000001',
  'fd100000-0000-4000-8000-000000000001',
  'fd200000-0000-4000-8000-000000000001',
  'fd300000-0000-4000-8000-000000000001',
  'identity-lock-claim-token-long-enough-0001', 'Class of 2043',
  'profile_connect', 'cohort', 'link_ready', true
);

SELECT extensions.dblink_connect(
  'same_org_editor',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);
SELECT extensions.dblink_connect(
  'cross_org_editor',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);

CREATE TEMP TABLE identity_lock_results (
  label text PRIMARY KEY,
  payload jsonb NOT NULL
) ON COMMIT PRESERVE ROWS;

-- A completed merge keeps its transaction open. A same-organization edit must
-- wait on the advisory lock, while an edit in another organization must finish
-- even though the merge transaction is still open. Any retained global table
-- lock would make the cross-organization assertion fail.
BEGIN;

INSERT INTO identity_lock_results (label, payload)
SELECT 'held_merge', plugin_data.csf_merge_profiles(
  'fd100000-0000-4000-8000-000000000001',
  'fd400000-0000-4000-8000-000000000001',
  'fd400000-0000-4000-8000-000000000002',
  'Synthetic duplicate used to hold the organization identity lock.',
  'fd000000-0000-4000-8000-000000000001',
  'fd600000-0000-4000-8000-000000000001'
);

SELECT extensions.is(
  (SELECT payload->>'targetProfileId' FROM identity_lock_results WHERE label = 'held_merge'),
  'fd400000-0000-4000-8000-000000000002',
  'the first-session merge completes while retaining its transaction lock'
);

SELECT extensions.dblink_send_query(
  'same_org_editor',
  $query$
  SELECT plugin_data.csf_upsert_profile(
    'fd100000-0000-4000-8000-000000000001'::uuid,
    'fd000000-0000-4000-8000-000000000001'::uuid,
    'fd600000-0000-4000-8000-000000000002'::uuid,
    jsonb_build_object(
      'profileId', 'fd400000-0000-4000-8000-000000000002',
      'firstName', 'Edit', 'lastName', 'Merge', 'preferredName', 'Canonical',
      'schoolEmail', 'edit.merge@local.test',
      'cohortId', 'fd300000-0000-4000-8000-000000000001',
      'nicknames', '[]'::jsonb
    )
  )::text
  $query$
);
SELECT extensions.dblink_send_query(
  'cross_org_editor',
  $query$
  SELECT plugin_data.csf_upsert_profile(
    'fd100000-0000-4000-8000-000000000002'::uuid,
    'fd000000-0000-4000-8000-000000000001'::uuid,
    'fd600000-0000-4000-8000-000000000003'::uuid,
    jsonb_build_object(
      'profileId', 'fd400000-0000-4000-8000-000000000006',
      'firstName', 'Cross', 'lastName', 'Organization',
      'preferredName', 'Independent',
      'schoolEmail', 'cross.organization@local.test',
      'cohortId', 'fd300000-0000-4000-8000-000000000002',
      'nicknames', '[]'::jsonb
    )
  )::text
  $query$
);

SELECT pg_catalog.pg_sleep(0.25);
SELECT extensions.is(
  extensions.dblink_is_busy('same_org_editor'),
  1,
  'a same-organization atomic profile edit serializes behind the merge'
);
SELECT extensions.is(
  extensions.dblink_is_busy('cross_org_editor'),
  0,
  'a cross-organization profile edit remains independent while the merge transaction is open'
);

INSERT INTO identity_lock_results (label, payload)
SELECT 'cross_org_edit', payload::jsonb
FROM extensions.dblink_get_result('cross_org_editor', false) AS result(payload text);
SELECT extensions.is(
  (SELECT payload->>'profileId' FROM identity_lock_results WHERE label = 'cross_org_edit'),
  'fd400000-0000-4000-8000-000000000006',
  'the cross-organization edit commits before the first organization releases its lock'
);

COMMIT;

INSERT INTO identity_lock_results (label, payload)
SELECT 'same_org_edit', payload::jsonb
FROM extensions.dblink_get_result('same_org_editor', false) AS result(payload text);
SELECT extensions.is(
  (SELECT payload->>'profileId' FROM identity_lock_results WHERE label = 'same_org_edit'),
  'fd400000-0000-4000-8000-000000000002',
  'the queued edit completes after merge without a lock-order deadlock'
);

SELECT extensions.dblink_disconnect('same_org_editor');
SELECT extensions.dblink_disconnect('cross_org_editor');

-- A profile claim acquires the same organization lock before its invitation,
-- user, account, cohort, and profile locks. A concurrent merge therefore waits
-- at the common first lock rather than forming a row-lock cycle.
SELECT extensions.dblink_connect(
  'claim_merge',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);

BEGIN;

INSERT INTO identity_lock_results (label, payload)
SELECT 'held_claim', plugin_data.csf_confirm_profile_claim(
  'fd100000-0000-4000-8000-000000000001',
  'identity-lock-claim-token-long-enough-0001',
  'fd400000-0000-4000-8000-000000000003',
  'fd000000-0000-4000-8000-000000000002',
  'identity-lock-claim@local.test'
);

SELECT extensions.ok(
  (SELECT payload->>'profileId' = 'fd400000-0000-4000-8000-000000000003'
    FROM identity_lock_results WHERE label = 'held_claim'),
  'the first-session verified claim completes while retaining the organization lock'
);

SELECT extensions.dblink_send_query(
  'claim_merge',
  $query$
  SELECT plugin_data.csf_merge_profiles(
    'fd100000-0000-4000-8000-000000000001'::uuid,
    'fd400000-0000-4000-8000-000000000004'::uuid,
    'fd400000-0000-4000-8000-000000000005'::uuid,
    'Synthetic duplicate merged concurrently with a verified profile claim.',
    'fd000000-0000-4000-8000-000000000001'::uuid,
    'fd600000-0000-4000-8000-000000000004'::uuid
  )::text
  $query$
);
SELECT pg_catalog.pg_sleep(0.25);
SELECT extensions.is(
  extensions.dblink_is_busy('claim_merge'),
  1,
  'the same-organization merge serializes behind the profile claim'
);

COMMIT;

INSERT INTO identity_lock_results (label, payload)
SELECT 'post_claim_merge', payload::jsonb
FROM extensions.dblink_get_result('claim_merge', false) AS result(payload text);
SELECT extensions.is(
  (SELECT payload->>'targetProfileId' FROM identity_lock_results WHERE label = 'post_claim_merge'),
  'fd400000-0000-4000-8000-000000000005',
  'the queued merge completes after the claim without a lock-order deadlock'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'fd100000-0000-4000-8000-000000000001'
      AND profile_id = 'fd400000-0000-4000-8000-000000000003'
      AND user_id = 'fd000000-0000-4000-8000-000000000002'
      AND status = 'verified'
  )
  AND EXISTS (
    SELECT 1 FROM plugin_data.csf_profiles
    WHERE id = 'fd400000-0000-4000-8000-000000000004'
      AND record_status = 'merged'
      AND merged_into_profile_id = 'fd400000-0000-4000-8000-000000000005'
  ),
  'claim and merge both commit their intended identity state exactly once'
);

SELECT extensions.dblink_disconnect('claim_merge');

SELECT * FROM extensions.finish();
