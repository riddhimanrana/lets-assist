BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(40);

-- ---------------------------------------------------------------------------
-- Execution privileges
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_profile_merge_preview_identity_base(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'the service role cannot reach the pre-consolidation identity preview directly'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_profile_merge_preview_identity_base(uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_profile_merge_preview_identity_base(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'no browser role can reach the pre-consolidation identity preview'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_profile_merge_preview(uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_profile_merge_preview(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'only the service role may read the canonical consolidation-aware preview'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'the consolidating owner-internal merge stays unreachable from the service role'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  ),
  'the request-aware merge entrypoint remains the only service-role merge path'
);
SELECT extensions.ok(
  pg_get_functiondef(
    'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid)'::regprocedure
  ) LIKE '%LOCK TABLE plugin_data.csf_profile_accounts%'
  AND pg_get_functiondef(
    'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid)'::regprocedure
  ) LIKE '%LOCK TABLE plugin_data.csf_profile_cohort_memberships%',
  'consolidation runs under the established account and cohort identity locks'
);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  (
    'fa000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'merge-consolidation-officer@local.test',
    now(), '{}', '{}', now(), now()
  ),
  (
    'fa000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'merge-consolidation-member@local.test',
    now(), '{}', '{}', now(), now()
  ),
  (
    'fa000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'merge-consolidation-other-org@local.test',
    now(), '{}', '{}', now(), now()
  );

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'fa100000-0000-4000-8000-000000000001',
    'CSF Merge Cohort Consolidation', 'csf-merge-cohort-consolidation',
    'school', '983301'
  ),
  (
    'fa100000-0000-4000-8000-000000000002',
    'CSF Merge Cohort Other', 'csf-merge-cohort-other', 'school', '983302'
  );

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  (
    'fa100000-0000-4000-8000-000000000001',
    'fa000000-0000-4000-8000-000000000001', 'admin', 'active'
  ),
  (
    'fa100000-0000-4000-8000-000000000001',
    'fa000000-0000-4000-8000-000000000002', 'member', 'active'
  ),
  (
    'fa100000-0000-4000-8000-000000000002',
    'fa000000-0000-4000-8000-000000000003', 'admin', 'active'
  );

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES
  ('fa200000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 2031, 'Class of 2031'),
  ('fa200000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000001', 2032, 'Class of 2032');

-- Every pair below shares an exact name and an exact school email, so identity
-- corroboration is never what is under test: only the cohort rules are.
INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, school_email,
  normalized_first_name, normalized_last_name, normalized_school_email,
  source_summary
) VALUES
  ('fa300000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'Rowan', 'Diaz', 'rowan@students.local.test', 'rowan', 'diaz', 'rowan@students.local.test', '{"sources":["legacy"]}'),
  ('fa300000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000001', 'Rowan', 'Diaz', 'rowan@students.local.test', 'rowan', 'diaz', 'rowan@students.local.test', '{"sources":["current"]}'),
  ('fa300000-0000-4000-8000-000000000003', 'fa100000-0000-4000-8000-000000000001', 'Sage', 'Rivera', 'sage@students.local.test', 'sage', 'rivera', 'sage@students.local.test', '{}'),
  ('fa300000-0000-4000-8000-000000000004', 'fa100000-0000-4000-8000-000000000001', 'Sage', 'Rivera', 'sage@students.local.test', 'sage', 'rivera', 'sage@students.local.test', '{}'),
  ('fa300000-0000-4000-8000-000000000005', 'fa100000-0000-4000-8000-000000000001', 'Emery', 'Blake', 'emery@students.local.test', 'emery', 'blake', 'emery@students.local.test', '{}'),
  ('fa300000-0000-4000-8000-000000000006', 'fa100000-0000-4000-8000-000000000001', 'Emery', 'Blake', 'emery@students.local.test', 'emery', 'blake', 'emery@students.local.test', '{}'),
  ('fa300000-0000-4000-8000-000000000007', 'fa100000-0000-4000-8000-000000000001', 'Nova', 'Quinn', 'nova@students.local.test', 'nova', 'quinn', 'nova@students.local.test', '{}'),
  ('fa300000-0000-4000-8000-000000000008', 'fa100000-0000-4000-8000-000000000001', 'Nova', 'Quinn', 'nova@students.local.test', 'nova', 'quinn', 'nova@students.local.test', '{}');

-- Pair 1: the ordinary duplicate. One class, held by both records. The source
-- carries the active status and the older row; the target carries the row that
-- must survive. Consolidation therefore has to move BOTH facts across.
-- Pair 2: genuinely different active classes.
-- Pair 3: the trap. The shared row is archived on the target, so the records
-- really are active in different classes and must stay blocked.
-- Pair 4: the asymmetric trap. The pair DOES share an active class, so the
-- pairwise "different active classes" rule is false and consolidation removes
-- nothing from the target -- but the target is also active in a second class,
-- so merging would leave one student active in two.
INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status, created_at, updated_at
) VALUES
  ('fa100000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', 'active', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
  ('fa100000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000002', 'fa200000-0000-4000-8000-000000000001', 'archived', '2025-06-01T00:00:00Z', '2025-06-01T00:00:00Z'),
  ('fa100000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000003', 'fa200000-0000-4000-8000-000000000001', 'active', now(), now()),
  ('fa100000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000004', 'fa200000-0000-4000-8000-000000000002', 'active', now(), now()),
  ('fa100000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000005', 'fa200000-0000-4000-8000-000000000001', 'active', now(), now()),
  ('fa100000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000006', 'fa200000-0000-4000-8000-000000000001', 'archived', now(), now()),
  ('fa100000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000006', 'fa200000-0000-4000-8000-000000000002', 'active', now(), now()),
  ('fa100000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000007', 'fa200000-0000-4000-8000-000000000001', 'active', now(), now()),
  ('fa100000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000008', 'fa200000-0000-4000-8000-000000000001', 'active', now(), now()),
  ('fa100000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000008', 'fa200000-0000-4000-8000-000000000002', 'active', now(), now());

-- ---------------------------------------------------------------------------
-- Tenant and authorization boundaries stay closed
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000002',
    'Attempted by an officer of another chapter.',
    'fa000000-0000-4000-8000-000000000003',
    'fa400000-0000-4000-8000-000000000001'
  ) $$,
  'P0001',
  'Not authorized to merge CSF profiles.',
  'an officer of another chapter cannot consolidate and merge these records'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'fa100000-0000-4000-8000-000000000002',
    'fa300000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000002',
    'Attempted through the wrong organization scope.',
    'fa000000-0000-4000-8000-000000000003',
    'fa400000-0000-4000-8000-000000000002'
  ) $$,
  'P0001',
  'Source CSF student record not found.',
  'a foreign organization scope cannot reach these cohort rows'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000002',
    'Attempted without the profile-management role.',
    'fa000000-0000-4000-8000-000000000002',
    'fa400000-0000-4000-8000-000000000003'
  ) $$,
  'P0001',
  'Not authorized to merge CSF profiles.',
  'a plain member cannot consolidate cohort rows through the merge path'
);
SELECT extensions.ok(
  (
    SELECT count(*) = 2
    FROM plugin_data.csf_profile_cohort_memberships
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND profile_id IN (
        'fa300000-0000-4000-8000-000000000001',
        'fa300000-0000-4000-8000-000000000002'
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id IN (
      'fa100000-0000-4000-8000-000000000001',
      'fa100000-0000-4000-8000-000000000002'
    )
  ),
  'every refused attempt consolidated nothing and wrote no audit evidence'
);

-- ---------------------------------------------------------------------------
-- Preview: an exact shared class is consolidatable, a disjoint one is not
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  (plugin_data.csf_profile_merge_preview(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000002'
  )->>'canMerge')::boolean,
  'two records for one student in one class are ready to merge'
);
SELECT extensions.ok(
  NOT jsonb_path_exists(
    plugin_data.csf_profile_merge_preview(
      'fa100000-0000-4000-8000-000000000001',
      'fa300000-0000-4000-8000-000000000001',
      'fa300000-0000-4000-8000-000000000002'
    ),
    '$.conflicts[*] ? (@.type == "class_membership")'
  ),
  'the shared class is no longer reported as an unresolvable conflict'
);
SELECT extensions.is(
  plugin_data.csf_profile_merge_preview(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000002'
  )->'cohortConsolidation'->>'plannedCount',
  '1',
  'the preview names exactly the one class row the merge will consolidate'
);
SELECT extensions.ok(
  (plugin_data.csf_profile_merge_preview(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000002'
  )->'identityEvidence'->>'exactEmailOverlap')::boolean,
  'identity corroboration is still required and still reported'
);
SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000003',
    'fa300000-0000-4000-8000-000000000004'
  )->>'canMerge')::boolean
  AND jsonb_path_exists(
    plugin_data.csf_profile_merge_preview(
      'fa100000-0000-4000-8000-000000000001',
      'fa300000-0000-4000-8000-000000000003',
      'fa300000-0000-4000-8000-000000000004'
    ),
    '$.conflicts[*] ? (@.type == "active_cohort_mismatch")'
  ),
  'different active graduating classes remain a hard identity conflict'
);
SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000005',
    'fa300000-0000-4000-8000-000000000006'
  )->>'canMerge')::boolean
  AND jsonb_path_exists(
    plugin_data.csf_profile_merge_preview(
      'fa100000-0000-4000-8000-000000000001',
      'fa300000-0000-4000-8000-000000000005',
      'fa300000-0000-4000-8000-000000000006'
    ),
    '$.conflicts[*] ? (@.type == "active_cohort_mismatch")'
  ),
  'an archived shared class cannot launder a genuinely different active class'
);
SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000007',
    'fa300000-0000-4000-8000-000000000008'
  )->>'canMerge')::boolean
  AND jsonb_path_exists(
    plugin_data.csf_profile_merge_preview(
      'fa100000-0000-4000-8000-000000000001',
      'fa300000-0000-4000-8000-000000000007',
      'fa300000-0000-4000-8000-000000000008'
    ),
    '$.conflicts[*] ? (@.type == "active_cohort_mismatch")'
  ),
  'a shared active class cannot hide a second active class on the target'
);
SELECT extensions.is(
  plugin_data.csf_profile_merge_preview(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000007',
    'fa300000-0000-4000-8000-000000000008'
  )->'cohortConsolidation'->>'postMergeActiveCohortCount',
  '2',
  'the preview counts the graduating classes the merged record would be active in'
);
SELECT extensions.ok(
  (plugin_data.csf_profile_merge_preview(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000007',
    'fa300000-0000-4000-8000-000000000008'
  )->'identityEvidence'->>'activeCohortConflict')::boolean,
  'the canonical identity evidence stays aligned with the stronger active-class union blocker'
);
SELECT extensions.is(
  plugin_data.csf_profile_merge_preview(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000002'
  )->'cohortConsolidation'->>'postMergeActiveCohortCount',
  '1',
  'the ordinary duplicate resolves to exactly one active graduating class'
);

-- ---------------------------------------------------------------------------
-- Blocked merges consolidate nothing and roll back completely
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000003',
    'fa300000-0000-4000-8000-000000000004',
    'The officer believes these are duplicates.',
    'fa000000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000004'
  ) $$,
  'P0001',
  'These CSF student records have conflicts that must be resolved before merging.',
  'a disjoint active class still refuses the merge'
);
SELECT extensions.ok(
  (
    SELECT count(*) = 1
    FROM plugin_data.csf_profile_cohort_memberships
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND profile_id = 'fa300000-0000-4000-8000-000000000003'
      AND cohort_id = 'fa200000-0000-4000-8000-000000000001'
      AND status = 'active'
  )
  AND (
    SELECT count(*) = 1
    FROM plugin_data.csf_profile_cohort_memberships
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND profile_id = 'fa300000-0000-4000-8000-000000000004'
      AND cohort_id = 'fa200000-0000-4000-8000-000000000002'
      AND status = 'active'
  ),
  'the refused disjoint merge deleted and consolidated neither class row'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000005',
    'fa300000-0000-4000-8000-000000000006',
    'The shared class row looks like a duplicate.',
    'fa000000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000005'
  ) $$,
  'P0001',
  'These CSF student records have conflicts that must be resolved before merging.',
  'consolidation cannot run first and hide the real active-class mismatch'
);
SELECT extensions.ok(
  (
    SELECT count(*) = 1
    FROM plugin_data.csf_profile_cohort_memberships
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND profile_id = 'fa300000-0000-4000-8000-000000000005'
      AND cohort_id = 'fa200000-0000-4000-8000-000000000001'
      AND status = 'active'
  )
  AND (
    SELECT count(*) = 2
    FROM plugin_data.csf_profile_cohort_memberships
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND profile_id = 'fa300000-0000-4000-8000-000000000006'
  )
  AND (
    SELECT status = 'archived'
    FROM plugin_data.csf_profile_cohort_memberships
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND profile_id = 'fa300000-0000-4000-8000-000000000006'
      AND cohort_id = 'fa200000-0000-4000-8000-000000000001'
  ),
  'the trapped pair keeps all three rows and its archived status untouched'
);
SELECT extensions.is(
  (
    SELECT count(*)::text
    FROM plugin_data.csf_profiles
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND record_status = 'merged'
  ),
  '0',
  'no blocked attempt archived a student record'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000007',
    'fa300000-0000-4000-8000-000000000008',
    'They share a class so they must be the same student.',
    'fa000000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000007'
  ) $$,
  'P0001',
  'These CSF student records have conflicts that must be resolved before merging.',
  'a shared active class cannot merge a record into a target active in two classes'
);
SELECT extensions.ok(
  (
    SELECT count(*) = 1
    FROM plugin_data.csf_profile_cohort_memberships
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND profile_id = 'fa300000-0000-4000-8000-000000000007'
      AND cohort_id = 'fa200000-0000-4000-8000-000000000001'
      AND status = 'active'
  )
  AND (
    SELECT count(*) = 2
    FROM plugin_data.csf_profile_cohort_memberships
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND profile_id = 'fa300000-0000-4000-8000-000000000008'
      AND status = 'active'
  ),
  'the asymmetric refusal consolidated nothing and deleted neither class row'
);

-- ---------------------------------------------------------------------------
-- The ordinary duplicate merges, as the service role, through the one entrypoint
-- ---------------------------------------------------------------------------

SET LOCAL ROLE service_role;

SELECT extensions.is(
  plugin_data.csf_merge_profiles(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000002',
    'Same student, same class, imported twice from the roster.',
    'fa000000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000006'
  )->>'targetProfileId',
  'fa300000-0000-4000-8000-000000000002',
  'the service role merges the ordinary same-class duplicate'
);

RESET ROLE;

SELECT extensions.is(
  (
    SELECT count(*)::text
    FROM plugin_data.csf_profile_cohort_memberships
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND cohort_id = 'fa200000-0000-4000-8000-000000000001'
      AND profile_id IN (
        'fa300000-0000-4000-8000-000000000001',
        'fa300000-0000-4000-8000-000000000002'
      )
  ),
  '1',
  'exactly one class row survives the consolidation'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_cohort_memberships
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND cohort_id = 'fa200000-0000-4000-8000-000000000001'
      AND profile_id = 'fa300000-0000-4000-8000-000000000002'
      AND status = 'active'
      AND created_at = '2024-01-01T00:00:00Z'
      AND updated_at > created_at
  ),
  'the canonical row keeps the target, the active status, and the earliest created_at'
);
SELECT extensions.is(
  (
    SELECT record_status
    FROM plugin_data.csf_profiles
    WHERE id = 'fa300000-0000-4000-8000-000000000001'
  ),
  'merged',
  'the duplicate source record is archived as merged'
);

-- ---------------------------------------------------------------------------
-- Provenance
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_merge_reviews AS review
    WHERE review.organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND review.source_profile_id = 'fa300000-0000-4000-8000-000000000001'
      AND review.target_profile_id = 'fa300000-0000-4000-8000-000000000002'
      AND review.status = 'approved'
      AND jsonb_array_length(review.evidence->'cohortConsolidation') = 1
      AND review.evidence->'cohortConsolidation'->0->'before'->'source'->>'status' = 'active'
      AND review.evidence->'cohortConsolidation'->0->'before'->'target'->>'status' = 'archived'
      AND review.evidence->'cohortConsolidation'->0->'after'->>'status' = 'active'
  ),
  'the approved review keeps both before snapshots and the canonical after snapshot'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND audit.action = 'profile.merge'
      AND audit.target_type = 'csf_profile_cohort_memberships'
      AND audit.reason_code = 'duplicate_profile_cohort_consolidated'
      AND audit.source_type = 'profile_merge_cohort_consolidation'
      AND audit.after_data->>'sourceProfileId' = 'fa300000-0000-4000-8000-000000000001'
      AND audit.after_data->>'targetProfileId' = 'fa300000-0000-4000-8000-000000000002'
      AND audit.before_data->'source'->>'status' = 'active'
  ),
  'the consolidation writes its own scoped immutable audit evidence'
);
SELECT extensions.is(
  (
    SELECT audit.target_id::text
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND audit.target_type = 'csf_profile_cohort_memberships'
  ),
  (
    SELECT membership.id::text
    FROM plugin_data.csf_profile_cohort_memberships AS membership
    WHERE membership.organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND membership.cohort_id = 'fa200000-0000-4000-8000-000000000001'
      AND membership.profile_id = 'fa300000-0000-4000-8000-000000000002'
  ),
  'the consolidation audit points at the exact surviving class row'
);
SELECT extensions.is(
  (
    SELECT count(*)::text
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND audit.action = 'profile.merge'
      AND audit.target_type = 'csf_profiles'
  ),
  '1',
  'the canonical profile.merge receipt the request-aware overload looks up stays unambiguous'
);
SELECT extensions.ok(
  (
    SELECT bool_and(
      audit.before_data::text !~* '(rowan|diaz|students\.local\.test|@)'
      AND audit.after_data::text !~* '(rowan|diaz|students\.local\.test|@)'
    )
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND audit.target_type = 'csf_profile_cohort_memberships'
  ),
  'the consolidation audit stores identifiers and statuses, never a name or address'
);

-- ---------------------------------------------------------------------------
-- A lost response is still a safe retry
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  plugin_data.csf_merge_profiles(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000002',
    'Same student, same class, imported twice from the roster.',
    'fa000000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000006'
  )->>'targetProfileId',
  'fa300000-0000-4000-8000-000000000002',
  'an exact retry after a lost response returns the original merge receipt'
);
SELECT extensions.is(
  (
    SELECT count(*)::text
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND audit.target_type = 'csf_profile_cohort_memberships'
  ),
  '1',
  'the retry consolidated nothing a second time'
);
SELECT extensions.is(
  (
    SELECT count(*)::text
    FROM plugin_data.csf_profile_cohort_memberships
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND cohort_id = 'fa200000-0000-4000-8000-000000000001'
      AND profile_id = 'fa300000-0000-4000-8000-000000000002'
  ),
  '1',
  'the retry left exactly one canonical class row'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000002',
    'A different rationale for the same request identifier.',
    'fa000000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000006'
  ) $$,
  'P0001',
  'That profile-merge request identifier is already bound to a different change.',
  'a changed rationale cannot masquerade as an idempotent consolidation retry'
);

SELECT * FROM extensions.finish();

ROLLBACK;
