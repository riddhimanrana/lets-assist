BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(53);

-- ---------------------------------------------------------------------------
-- Shape and boundaries
-- ---------------------------------------------------------------------------

SELECT extensions.has_table(
  'plugin_data', 'csf_retention_runs',
  'a retention run has a durable table'
);
SELECT extensions.has_table(
  'plugin_data', 'csf_retention_preview_profiles',
  'a sealed preview keeps its per-profile rows'
);
SELECT extensions.has_table(
  'plugin_data', 'csf_retention_retired_cohorts',
  'retired classes are recorded'
);
SELECT extensions.has_table(
  'plugin_data', 'csf_retention_source_tombstones',
  'retired source rows are recorded by fingerprint'
);
SELECT extensions.has_table(
  'plugin_data', 'csf_retention_profile_tombstones',
  'each retired profile leaves a receipt'
);

SELECT extensions.ok(
  (
    SELECT bool_and(class.relrowsecurity)
    FROM pg_class AS class
    WHERE class.oid IN (
      'plugin_data.csf_retention_runs'::regclass,
      'plugin_data.csf_retention_preview_profiles'::regclass,
      'plugin_data.csf_retention_retired_cohorts'::regclass,
      'plugin_data.csf_retention_source_tombstones'::regclass,
      'plugin_data.csf_retention_profile_tombstones'::regclass,
      'plugin_data.csf_retention_reference_policy'::regclass,
      'plugin_data.csf_retention_identity_inventory'::regclass
    )
  ),
  'every retention table has row level security enabled'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'plugin_data.csf_retention_runs',
      'plugin_data.csf_retention_preview_profiles',
      'plugin_data.csf_retention_retired_cohorts',
      'plugin_data.csf_retention_source_tombstones',
      'plugin_data.csf_retention_profile_tombstones',
      'plugin_data.csf_retention_reference_policy',
      'plugin_data.csf_retention_identity_inventory'
    ]) AS target(relation)
    CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) AS client(role_name)
    CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS wanted(privilege)
    WHERE has_table_privilege(client.role_name::name, target.relation, wanted.privilege)
  ),
  'no client role can read or write retention evidence directly'
);

-- ---------------------------------------------------------------------------
-- Both catalogs have to be complete, or the operation refuses to run
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_retention_reference_coverage_gaps()),
  0,
  'every live foreign key into a retention-owned table is classified'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_retention_identity_coverage_gaps()),
  0,
  'every column of the two tables retention may leave in place is classified'
);

-- Every column the inventory calls identifying must actually be nulled or
-- overwritten by the commit. This is the assertion that catches a column added
-- to csf_profiles and then forgotten.
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_retention_identity_inventory
    WHERE table_name = 'csf_profiles'
      AND column_name = 'reported_application_school_email'
      AND treatment = 'erase'
  )
  AND EXISTS (
    SELECT 1 FROM plugin_data.csf_retention_identity_inventory
    WHERE table_name = 'csf_term_applications'
      AND column_name = 'application_data'
      AND treatment = 'erase'
  ),
  'reported application addresses and raw application responses are classified as identifying'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_retention_reference_policy
    WHERE child_table = 'csf_sheet_import_rows'
      AND child_column = 'matched_profile_id'
      AND policy = 'retain_immutable'
  ),
  'import provenance is classified as immutable retention, never as a delete'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_retention_reference_policy
    WHERE child_table = 'csf_staff_positions' AND policy = 'blocker'
  ),
  'a student who served as an officer blocks the run'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_retention_reference_policy
    WHERE child_table IN ('csf_terms', 'csf_meetings', 'csf_term_policies', 'csf_cohort_terms')
      AND policy = 'delete_with_owner'
  ),
  'shared semester records are never deleted with a student'
);

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE retention_function (function_oid regprocedure PRIMARY KEY, entrypoint boolean);

INSERT INTO retention_function (function_oid, entrypoint)
VALUES
  ('plugin_data.csf_retention_preview(uuid,uuid,uuid,integer[],text)'::regprocedure, true),
  ('plugin_data.csf_retention_commit(uuid,uuid,uuid,uuid,text,integer[],uuid[])'::regprocedure, true),
  ('plugin_data.csf_retention_candidates(uuid,integer[])'::regprocedure, false),
  ('plugin_data.csf_retention_reference_coverage_gaps()'::regprocedure, false),
  ('plugin_data.csf_retention_identity_coverage_gaps()'::regprocedure, false),
  ('plugin_data.csf_retention_profile_set_digest(uuid[])'::regprocedure, false),
  ('plugin_data.csf_retention_disposition(text[],integer)'::regprocedure, false),
  ('plugin_data.csf_retention_run_summary(uuid)'::regprocedure, false),
  ('plugin_data.csf_retention_delete_owned_records(uuid,uuid)'::regprocedure, false),
  ('plugin_data.csf_retention_in_progress()'::regprocedure, false),
  ('plugin_data.csf_guard_retired_cohort_membership()'::regprocedure, false),
  ('plugin_data.csf_guard_retired_source_row_commit()'::regprocedure, false),
  ('plugin_data.csf_guard_retention_evidence_immutable()'::regprocedure, false);

SELECT extensions.is(
  (
    SELECT bool_and(pg_get_userbyid(proc.proowner) = 'postgres')
    FROM retention_function AS expected
    JOIN pg_proc AS proc ON proc.oid = expected.function_oid::oid
  ),
  true,
  'every retention function is owned by postgres'
);

SELECT extensions.is(
  (
    SELECT bool_and(
      NOT has_function_privilege('anon', function_oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', function_oid, 'EXECUTE')
    )
    FROM retention_function
  ),
  true,
  'no browser role can execute any retention function'
);

SELECT extensions.is(
  (
    SELECT bool_and(has_function_privilege('service_role', function_oid, 'EXECUTE') = entrypoint)
    FROM retention_function
  ),
  true,
  'the service role reaches the two entrypoints and nothing else'
);

-- ---------------------------------------------------------------------------
-- Fixtures: one chapter, one retiring class, one class that stays, and one
-- semester both classes share
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (id, instance_id, email, email_confirmed_at, aud, role)
VALUES
  ('bd000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'retention.officer@example.test', now(), 'authenticated', 'authenticated'),
  ('bd000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'retention.other@example.test', now(), 'authenticated', 'authenticated'),
  ('bd000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'retention.unprivileged@example.test', now(), 'authenticated', 'authenticated'),
  ('bd000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
   'retiring.student@example.test', now(), 'authenticated', 'authenticated');

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('bd100000-0000-4000-8000-000000000001', 'Retention Fixture Chapter',
        'retention-fixture-chapter', 'school', '884001');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('bd100000-0000-4000-8000-000000000001', 'bd000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('bd100000-0000-4000-8000-000000000001', 'bd000000-0000-4000-8000-000000000002', 'admin', 'active'),
  ('bd100000-0000-4000-8000-000000000001', 'bd000000-0000-4000-8000-000000000003', 'member', 'active'),
  ('bd100000-0000-4000-8000-000000000001', 'bd000000-0000-4000-8000-000000000004', 'member', 'active');

-- Four logins in this chapter: the officer running the retirement, a second
-- officer, an ordinary member used for the permission checks, and the retiring
-- student. All four must still be here afterwards.

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES
  ('bd200000-0000-4000-8000-000000000001', 'bd100000-0000-4000-8000-000000000001', 2024, 'Class of 2024'),
  ('bd200000-0000-4000-8000-000000000002', 'bd100000-0000-4000-8000-000000000001', 2029, 'Class of 2029');

-- One chapter-wide semester used by both classes. A record of the retiring
-- student that lives here must still be in scope; the semester row and the
-- continuing student's records must not be.
INSERT INTO plugin_data.csf_terms (id, organization_id, code, label, school_year, semester)
VALUES ('bd500000-0000-4000-8000-000000000001', 'bd100000-0000-4000-8000-000000000001',
        'F23', 'Fall 2023', '2023-2024', 'fall');

INSERT INTO plugin_data.csf_cohort_terms (organization_id, cohort_id, term_id)
VALUES
  ('bd100000-0000-4000-8000-000000000001', 'bd200000-0000-4000-8000-000000000001',
   'bd500000-0000-4000-8000-000000000001'),
  ('bd100000-0000-4000-8000-000000000001', 'bd200000-0000-4000-8000-000000000002',
   'bd500000-0000-4000-8000-000000000001');

-- Two students with the same name, one in each class.
INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  school_email, normalized_school_email, reported_application_school_email
)
VALUES
  ('bd300000-0000-4000-8000-000000000001', 'bd100000-0000-4000-8000-000000000001',
   'Robin', 'Fixture', 'robin', 'fixture',
   'robin.fixture@example.test', 'robin.fixture@example.test', 'robin.reported@example.test'),
  ('bd300000-0000-4000-8000-000000000002', 'bd100000-0000-4000-8000-000000000001',
   'Robin', 'Fixture', 'robin', 'fixture',
   'robin.current@example.test', 'robin.current@example.test', NULL),
  -- A third Robin Fixture, not yet in any class. After the retirement they
  -- must still be able to join a current one.
  ('bd300000-0000-4000-8000-000000000003', 'bd100000-0000-4000-8000-000000000001',
   'Robin', 'Fixture', 'robin', 'fixture',
   'robin.newcomer@example.test', 'robin.newcomer@example.test', NULL);

INSERT INTO plugin_data.csf_profile_cohort_memberships (organization_id, profile_id, cohort_id)
VALUES
  ('bd100000-0000-4000-8000-000000000001', 'bd300000-0000-4000-8000-000000000001',
   'bd200000-0000-4000-8000-000000000001'),
  ('bd100000-0000-4000-8000-000000000001', 'bd300000-0000-4000-8000-000000000002',
   'bd200000-0000-4000-8000-000000000002');

-- The retiring student has a connected login. The link row goes; the login
-- account does not.
INSERT INTO plugin_data.csf_profile_accounts (organization_id, profile_id, user_id, status, is_primary)
VALUES ('bd100000-0000-4000-8000-000000000001', 'bd300000-0000-4000-8000-000000000001',
        'bd000000-0000-4000-8000-000000000004', 'verified', true);

-- Each student has an application in the shared semester.
INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, most_checked_email, application_data,
  source_row_number
)
VALUES
  ('bd600000-0000-4000-8000-000000000001', 'bd100000-0000-4000-8000-000000000001',
   'bd300000-0000-4000-8000-000000000001', 'bd200000-0000-4000-8000-000000000001',
   'bd500000-0000-4000-8000-000000000001', 'robin.fixture@example.test',
   '{"answer": "retiring student response"}'::jsonb, 41),
  ('bd600000-0000-4000-8000-000000000002', 'bd100000-0000-4000-8000-000000000001',
   'bd300000-0000-4000-8000-000000000002', 'bd200000-0000-4000-8000-000000000002',
   'bd500000-0000-4000-8000-000000000001', 'robin.current@example.test',
   '{"answer": "continuing student response"}'::jsonb, 42);

-- An immutable import row that names the retiring student, with a content
-- fingerprint. This is what forces erase-in-place and what gets tombstoned.
INSERT INTO plugin_data.csf_sheet_sources (id, organization_id, cohort_id, title, provider)
VALUES ('bd700000-0000-4000-8000-000000000001', 'bd100000-0000-4000-8000-000000000001',
        'bd200000-0000-4000-8000-000000000001', 'Class of 2024 history', 'google_sheets');

-- A commit job has to name the preview it came from
-- (csf_enforce_import_commit_lineage), and the preview has to share its source
-- and source type. Build the pair the way the real workflow does rather than
-- reaching around the trigger.
INSERT INTO plugin_data.csf_sheet_import_jobs (id, organization_id, source_id, mode, status)
VALUES ('bd800000-0000-4000-8000-000000000002', 'bd100000-0000-4000-8000-000000000001',
        'bd700000-0000-4000-8000-000000000001', 'preview', 'completed');

INSERT INTO plugin_data.csf_sheet_import_jobs (id, organization_id, source_id, mode, status, preview_job_id)
VALUES ('bd800000-0000-4000-8000-000000000001', 'bd100000-0000-4000-8000-000000000001',
        'bd700000-0000-4000-8000-000000000001', 'commit', 'completed',
        'bd800000-0000-4000-8000-000000000002');

-- A second preview/commit pair on the same source, standing in for someone
-- re-reading the old workbook after the class has been retired. Its rows get
-- their own job coordinates, so the resurrection assertions below exercise the
-- guard rather than colliding with the fixture's row on (job, tab, row).
INSERT INTO plugin_data.csf_sheet_import_jobs (id, organization_id, source_id, mode, status)
VALUES ('bd800000-0000-4000-8000-000000000003', 'bd100000-0000-4000-8000-000000000001',
        'bd700000-0000-4000-8000-000000000001', 'preview', 'completed');

INSERT INTO plugin_data.csf_sheet_import_jobs (id, organization_id, source_id, mode, status, preview_job_id)
VALUES ('bd800000-0000-4000-8000-000000000004', 'bd100000-0000-4000-8000-000000000001',
        'bd700000-0000-4000-8000-000000000001', 'commit', 'completed',
        'bd800000-0000-4000-8000-000000000003');

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, cohort_id, sheet_tab_name, row_number,
  row_hash, matched_profile_id, matched_application_id, import_status
)
VALUES ('bd900000-0000-4000-8000-000000000001', 'bd100000-0000-4000-8000-000000000001',
        'bd800000-0000-4000-8000-000000000001', 'bd700000-0000-4000-8000-000000000001',
        'bd200000-0000-4000-8000-000000000001', 'Roster', 41,
        'fingerprint-retiring-student', 'bd300000-0000-4000-8000-000000000001',
        'bd600000-0000-4000-8000-000000000001', 'created');

-- One retiring profile belongs to both selected classes. Neither class may
-- reopen after its memberships have been removed.
INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES ('bd200000-0000-4000-8000-000000000003', 'bd100000-0000-4000-8000-000000000001', 2025, 'Class of 2025');
INSERT INTO plugin_data.csf_profile_cohort_memberships (organization_id, profile_id, cohort_id)
VALUES ('bd100000-0000-4000-8000-000000000001', 'bd300000-0000-4000-8000-000000000001',
        'bd200000-0000-4000-8000-000000000003');

-- This immutable row identifies its student only through the application.
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, cohort_id, sheet_tab_name, row_number,
  row_hash, matched_application_id, import_status
)
VALUES ('bd900000-0000-4000-8000-000000000002', 'bd100000-0000-4000-8000-000000000001',
        'bd800000-0000-4000-8000-000000000001', 'bd700000-0000-4000-8000-000000000001',
        'bd200000-0000-4000-8000-000000000001', 'Roster', 43,
        'fingerprint-application-only', 'bd600000-0000-4000-8000-000000000001', 'created');

-- ---------------------------------------------------------------------------
-- Preview
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_retention_preview(
      'bd100000-0000-4000-8000-000000000001',
      'bd000000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000001',
      ARRAY[2024, 2025],
      'Chapter retention decision for the graduated class of 2024.'
    )$$,
  'an authorized officer can seal a retention preview'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_retention_preview(
      'bd100000-0000-4000-8000-000000000001',
      'bd000000-0000-4000-8000-000000000003',
      'bd400000-0000-4000-8000-0000000000f1',
      ARRAY[2024, 2025],
      'An ordinary member should not be able to preview a retention run.'
    )$$,
  '42501',
  NULL,
  'an organization member without the CSF permissions cannot seal a preview'
);

SELECT extensions.is(
  (SELECT disposition FROM plugin_data.csf_retention_preview_profiles
   WHERE profile_id = 'bd300000-0000-4000-8000-000000000001'),
  'erase_in_place',
  'a student named by an immutable import row is erased in place, not deleted'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_retention_preview_profiles
   WHERE profile_id = 'bd300000-0000-4000-8000-000000000002'),
  0,
  'the identically named student in a current class is not in the preview'
);

SELECT extensions.is(
  (SELECT state FROM plugin_data.csf_retention_runs
   WHERE request_id = 'bd400000-0000-4000-8000-000000000001'),
  'sealed',
  'a preview seals without committing anything'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profiles
   WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'),
  3,
  'previewing changed no student record'
);

SELECT extensions.throws_ok(
  $$UPDATE plugin_data.csf_retention_preview_profiles
    SET disposition = 'blocked'
    WHERE profile_id = 'bd300000-0000-4000-8000-000000000001'$$,
  '55000',
  NULL,
  'a sealed preview row cannot be edited'
);

-- ---------------------------------------------------------------------------
-- Commit: the request has to match the preview it claims to come from
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_retention_commit(
        'bd100000-0000-4000-8000-000000000001',
        'bd000000-0000-4000-8000-000000000001',
        'bd400000-0000-4000-8000-000000000002',
        %L, %L, ARRAY[2024, 2025],
        ARRAY['bd300000-0000-4000-8000-000000000002']::uuid[])$$,
    (SELECT id FROM plugin_data.csf_retention_runs WHERE request_id = 'bd400000-0000-4000-8000-000000000001'),
    (SELECT profile_digest FROM plugin_data.csf_retention_runs WHERE request_id = 'bd400000-0000-4000-8000-000000000001')
  ),
  '55000',
  NULL,
  'a confirmed profile set that differs from the preview is refused'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_retention_commit(
        'bd100000-0000-4000-8000-000000000001',
        'bd000000-0000-4000-8000-000000000001',
        'bd400000-0000-4000-8000-000000000003',
        %L,
        '0000000000000000000000000000000000000000000000000000000000000000',
        ARRAY[2024, 2025],
        ARRAY['bd300000-0000-4000-8000-000000000001']::uuid[])$$,
    (SELECT id FROM plugin_data.csf_retention_runs WHERE request_id = 'bd400000-0000-4000-8000-000000000001')
  ),
  '55000',
  NULL,
  'a stale digest is refused'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_retention_commit(
        'bd100000-0000-4000-8000-000000000001',
        'bd000000-0000-4000-8000-000000000001',
        'bd400000-0000-4000-8000-000000000004',
        %L, %L, ARRAY[2024, 2025, 2026],
        ARRAY['bd300000-0000-4000-8000-000000000001']::uuid[])$$,
    (SELECT id FROM plugin_data.csf_retention_runs WHERE request_id = 'bd400000-0000-4000-8000-000000000001'),
    (SELECT profile_digest FROM plugin_data.csf_retention_runs WHERE request_id = 'bd400000-0000-4000-8000-000000000001')
  ),
  '55000',
  NULL,
  'a widened year list against a sealed preview is refused'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_retention_commit(
        'bd100000-0000-4000-8000-000000000001',
        'bd000000-0000-4000-8000-000000000003',
        'bd400000-0000-4000-8000-0000000000f2',
        %L, %L, ARRAY[2024, 2025],
        ARRAY['bd300000-0000-4000-8000-000000000001']::uuid[])$$,
    (SELECT id FROM plugin_data.csf_retention_runs WHERE request_id = 'bd400000-0000-4000-8000-000000000001'),
    (SELECT profile_digest FROM plugin_data.csf_retention_runs WHERE request_id = 'bd400000-0000-4000-8000-000000000001')
  ),
  '42501',
  NULL,
  'an organization member without the CSF permissions cannot commit a sealed preview'
);

SELECT extensions.lives_ok(
  format(
    $$SELECT plugin_data.csf_retention_commit(
        'bd100000-0000-4000-8000-000000000001',
        'bd000000-0000-4000-8000-000000000001',
        'bd400000-0000-4000-8000-000000000005',
        %L, %L, ARRAY[2024, 2025],
        ARRAY['bd300000-0000-4000-8000-000000000001']::uuid[])$$,
    (SELECT id FROM plugin_data.csf_retention_runs WHERE request_id = 'bd400000-0000-4000-8000-000000000001'),
    (SELECT profile_digest FROM plugin_data.csf_retention_runs WHERE request_id = 'bd400000-0000-4000-8000-000000000001')
  ),
  'the matching request commits'
);

-- Replay is bound to the whole payload, not just the run.
SELECT extensions.lives_ok(
  format(
    $$SELECT plugin_data.csf_retention_commit(
        'bd100000-0000-4000-8000-000000000001',
        'bd000000-0000-4000-8000-000000000001',
        'bd400000-0000-4000-8000-000000000005',
        %L, %L, ARRAY[2024, 2025],
        ARRAY['bd300000-0000-4000-8000-000000000001']::uuid[])$$,
    (SELECT id FROM plugin_data.csf_retention_runs WHERE request_id = 'bd400000-0000-4000-8000-000000000001'),
    (SELECT profile_digest FROM plugin_data.csf_retention_runs WHERE request_id = 'bd400000-0000-4000-8000-000000000001')
  ),
  'an exact replay returns the original receipt'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_retention_commit(
        'bd100000-0000-4000-8000-000000000001',
        'bd000000-0000-4000-8000-000000000002',
        'bd400000-0000-4000-8000-000000000005',
        %L, %L, ARRAY[2024, 2025],
        ARRAY['bd300000-0000-4000-8000-000000000001']::uuid[])$$,
    (SELECT id FROM plugin_data.csf_retention_runs WHERE request_id = 'bd400000-0000-4000-8000-000000000001'),
    (SELECT profile_digest FROM plugin_data.csf_retention_runs WHERE request_id = 'bd400000-0000-4000-8000-000000000001')
  ),
  '55000',
  NULL,
  'a replay by a different actor is refused rather than returning the receipt'
);

-- ---------------------------------------------------------------------------
-- What the commit left behind
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profiles
   WHERE id = 'bd300000-0000-4000-8000-000000000001'
     AND record_status = 'retention_erased'
     AND first_name = 'Erased'
     AND school_email IS NULL
     AND normalized_school_email IS NULL
     AND reported_application_school_email IS NULL
     AND privacy_flags = '{}'::jsonb
     AND source_summary = '{}'::jsonb),
  1,
  'the retained profile row carries no identifying value, including the reported application address'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_term_applications
   WHERE profile_id = 'bd300000-0000-4000-8000-000000000001'
     AND (most_checked_email IS NOT NULL OR application_data <> '{}'::jsonb)),
  0,
  'a retained application keeps no reported address and no raw responses'
);

SELECT extensions.is(
  (SELECT source_row_number FROM plugin_data.csf_term_applications
   WHERE id = 'bd600000-0000-4000-8000-000000000001'),
  41,
  'a retained application keeps its pointer into the immutable source, so it is not left with no lineage'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_cohort_memberships
   WHERE profile_id = 'bd300000-0000-4000-8000-000000000001'),
  0,
  'the retired student holds no class membership'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_sheet_import_rows
   WHERE id = 'bd900000-0000-4000-8000-000000000001'
     AND matched_profile_id = 'bd300000-0000-4000-8000-000000000001'),
  1,
  'the immutable import row and its profile reference are untouched'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_terms
   WHERE id = 'bd500000-0000-4000-8000-000000000001'),
  1,
  'the shared semester itself is untouched'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_term_applications
   WHERE profile_id = 'bd300000-0000-4000-8000-000000000002'
     AND most_checked_email = 'robin.current@example.test'
     AND application_data <> '{}'::jsonb),
  1,
  'the continuing student keeps their record in the same shared semester'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.organization_members
   WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'),
  4,
  'every organization membership is untouched, including the retiring student''s'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM auth.users
   WHERE id IN ('bd000000-0000-4000-8000-000000000001', 'bd000000-0000-4000-8000-000000000002',
                'bd000000-0000-4000-8000-000000000003', 'bd000000-0000-4000-8000-000000000004')),
  4,
  'login accounts are untouched, the retiring student''s included'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_accounts
   WHERE profile_id = 'bd300000-0000-4000-8000-000000000001'),
  0,
  'the CSF account link is gone while the login account it named survives'
);

-- ---------------------------------------------------------------------------
-- Notices: retiring a class must not become a mail run
--
-- 20260917080000 reads `app.csf_suppress_notices` in
-- csf_record_personal_notification and records nothing while it is on. These
-- assert the contract by its flag and by its tables, so they stay meaningful
-- whether or not 080000 is in the tree under test.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  current_setting('app.csf_suppress_notices', true),
  'on',
  'the retention commit switched personal notices off for its transaction'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname IN (
      'csf_profiles_personal_notifications',
      'csf_point_submissions_personal_notifications'
    )
    AND NOT tgisinternal
  )
  OR current_setting('app.csf_suppress_notices', true) = 'on',
  'where the 20260917080000 personal-notice triggers exist, retention ran with their suppression flag set'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_publication_events
   WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'
     AND source_id IN (
       'bd300000-0000-4000-8000-000000000001',
       'bd600000-0000-4000-8000-000000000001'
     )),
  0,
  'retiring the class recorded no publication event for the student or their application'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_publication_notification_deliveries
   WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'
     AND user_id = 'bd000000-0000-4000-8000-000000000004'),
  0,
  'the retiring student''s connected account was queued no notice'
);

-- ---------------------------------------------------------------------------
-- Resurrection: scoped to the retired class and the retired fingerprint
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$INSERT INTO plugin_data.csf_profile_cohort_memberships (organization_id, profile_id, cohort_id)
    VALUES ('bd100000-0000-4000-8000-000000000001',
            'bd300000-0000-4000-8000-000000000002',
            'bd200000-0000-4000-8000-000000000001')$$,
  '55000',
  NULL,
  'a retired class cannot take a member again'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_retention_source_tombstones
   WHERE row_hash = 'fingerprint-retiring-student'),
  1,
  'the retired source row is tombstoned by its fingerprint'
);

-- Re-importing the same source content into the retired class is refused...
SELECT extensions.throws_ok(
  $$INSERT INTO plugin_data.csf_sheet_import_rows (
      organization_id, job_id, source_id, cohort_id, sheet_tab_name, row_number,
      row_hash, import_status
    )
    VALUES ('bd100000-0000-4000-8000-000000000001',
            'bd800000-0000-4000-8000-000000000004',
            'bd700000-0000-4000-8000-000000000001',
            'bd200000-0000-4000-8000-000000000001', 'Roster', 12,
            'fingerprint-retiring-student', 'created')$$,
  '55000',
  NULL,
  'the retired source row is refused even after it moves to a different sheet row'
);

-- ...while a different student who now occupies the retired row's old position
-- imports normally, because the fingerprint is different.
SELECT extensions.lives_ok(
  $$INSERT INTO plugin_data.csf_sheet_import_rows (
      organization_id, job_id, source_id, cohort_id, sheet_tab_name, row_number,
      row_hash, import_status
    )
    VALUES ('bd100000-0000-4000-8000-000000000001',
            'bd800000-0000-4000-8000-000000000004',
            'bd700000-0000-4000-8000-000000000001',
            'bd200000-0000-4000-8000-000000000002', 'Roster', 41,
            'fingerprint-different-student', 'created')$$,
  'a different source row at the same position imports normally'
);

SELECT extensions.lives_ok(
  $$INSERT INTO plugin_data.csf_profile_cohort_memberships (organization_id, profile_id, cohort_id)
    VALUES ('bd100000-0000-4000-8000-000000000001',
            'bd300000-0000-4000-8000-000000000003',
            'bd200000-0000-4000-8000-000000000002')$$,
  'a new student with the same name still joins a current class'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_retention_retired_cohorts
   WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'),
  2,
  'every selected class represented by the retired profile is guarded'
);
SELECT extensions.throws_ok(
  $$INSERT INTO plugin_data.csf_profile_cohort_memberships (organization_id, profile_id, cohort_id)
    VALUES ('bd100000-0000-4000-8000-000000000001',
            'bd300000-0000-4000-8000-000000000003',
            'bd200000-0000-4000-8000-000000000003')$$,
  '55000', NULL, 'the second retired class cannot take a new member'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_retention_source_tombstones
   WHERE row_hash = 'fingerprint-application-only'),
  1,
  'an application-only source reference receives a tombstone'
);
SELECT extensions.throws_ok(
  $$INSERT INTO plugin_data.csf_sheet_import_rows (
      organization_id, job_id, source_id, cohort_id, sheet_tab_name, row_number,
      row_hash, import_status
    ) VALUES ('bd100000-0000-4000-8000-000000000001',
              'bd800000-0000-4000-8000-000000000004',
              'bd700000-0000-4000-8000-000000000001',
              'bd200000-0000-4000-8000-000000000003', 'Roster', 99,
              'fingerprint-application-only', 'created')$$,
  '55000', NULL, 'application-only content cannot return through another retired class or row'
);

SELECT * FROM extensions.finish();

ROLLBACK;
