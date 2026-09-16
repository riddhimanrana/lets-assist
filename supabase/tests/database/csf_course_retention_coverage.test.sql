BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(12);

-- ---------------------------------------------------------------------------
-- The two catalogs are complete against whatever schema this tree actually has
--
-- These are the assertions that matter when 20260917100000 and 20260917130000
-- are replayed together: the course editor adds columns and a foreign key, and
-- retirement refuses to run until both are classified.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_retention_reference_coverage_gaps()),
  0,
  'no unclassified foreign key into a retention-owned table, course editor included'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_retention_identity_coverage_gaps()),
  0,
  'no unclassified column on a table retirement may leave standing, course editor included'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_retention_identity_inventory
    WHERE table_name = 'csf_term_applications'
      AND column_name = 'courses_corrected_at'
      AND treatment = 'structural'
  ),
  'the correction marker is classified as a fact about the record, not about the student'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_retention_identity_inventory
   WHERE table_name = 'csf_application_course_corrections'
     AND treatment = 'erase'),
  4,
  'the four receipt columns holding course lines and officer prose are classified as identifying'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_retention_reference_policy
    WHERE child_table = 'csf_application_course_corrections'
      AND child_column = 'application_id'
      AND policy = 'retain_immutable'
  ),
  'the correction ledger is retained, so its cascade can never be the thing that deletes it'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_retention_reference_policy
    WHERE child_table = 'csf_application_course_corrections'
      AND policy = 'delete_with_owner'
  ),
  'nothing classifies a correction receipt as deletable'
);

-- ---------------------------------------------------------------------------
-- A corrected student, retired
--
-- 20260917130000 lives in another lane. Where it is present this runs the
-- whole thing; where it is not, these six report as skipped rather than
-- pretending to have proved something.
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE course_retention_outcome (key text PRIMARY KEY, value text);

DO $do$
BEGIN
  IF pg_catalog.to_regclass('plugin_data.csf_application_course_corrections') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE $fixture$
    INSERT INTO auth.users (id, instance_id, email, email_confirmed_at, aud, role)
    VALUES ('ce000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
            'course.retention.officer@example.test', now(), 'authenticated', 'authenticated');

    INSERT INTO public.organizations (id, name, username, type, join_code)
    VALUES ('ce100000-0000-4000-8000-000000000001', 'Course Retention Chapter',
            'course-retention-chapter', 'school', '885001');

    INSERT INTO public.organization_members (organization_id, user_id, role, status)
    VALUES ('ce100000-0000-4000-8000-000000000001',
            'ce000000-0000-4000-8000-000000000001', 'admin', 'active');

    INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
    VALUES ('ce200000-0000-4000-8000-000000000001', 'ce100000-0000-4000-8000-000000000001',
            2024, 'Class of 2024');

    INSERT INTO plugin_data.csf_terms (id, organization_id, code, label, school_year, semester)
    VALUES ('ce500000-0000-4000-8000-000000000001', 'ce100000-0000-4000-8000-000000000001',
            'F23', 'Fall 2023', '2023-2024', 'fall');

    INSERT INTO plugin_data.csf_cohort_terms (organization_id, cohort_id, term_id)
    VALUES ('ce100000-0000-4000-8000-000000000001', 'ce200000-0000-4000-8000-000000000001',
            'ce500000-0000-4000-8000-000000000001');

    INSERT INTO plugin_data.csf_profiles (
      id, organization_id, first_name, last_name,
      normalized_first_name, normalized_last_name)
    VALUES ('ce300000-0000-4000-8000-000000000001', 'ce100000-0000-4000-8000-000000000001',
            'Ari', 'Coursework', 'ari', 'coursework');

    INSERT INTO plugin_data.csf_profile_cohort_memberships (organization_id, profile_id, cohort_id)
    VALUES ('ce100000-0000-4000-8000-000000000001', 'ce300000-0000-4000-8000-000000000001',
            'ce200000-0000-4000-8000-000000000001');

    -- No import row names this application. Without the correction receipt it
    -- would be deleted outright; the receipt is the only thing keeping it.
    INSERT INTO plugin_data.csf_term_applications (
      id, organization_id, profile_id, cohort_id, term_id,
      application_data, courses_corrected_at, courses_corrected_by)
    VALUES ('ce600000-0000-4000-8000-000000000001', 'ce100000-0000-4000-8000-000000000001',
            'ce300000-0000-4000-8000-000000000001', 'ce200000-0000-4000-8000-000000000001',
            'ce500000-0000-4000-8000-000000000001',
            '{"answer": "student response"}'::jsonb, now(),
            'ce000000-0000-4000-8000-000000000001');

    INSERT INTO plugin_data.csf_application_course_entries (
      id, organization_id, application_id, course_list, course_name, grade, origin,
      officer_corrected_at, officer_corrected_by)
    VALUES ('ce700000-0000-4000-8000-000000000001', 'ce100000-0000-4000-8000-000000000001',
            'ce600000-0000-4000-8000-000000000001', 'I', 'Corrected Course', 'A', 'officer',
            now(), 'ce000000-0000-4000-8000-000000000001');

    INSERT INTO plugin_data.csf_application_course_corrections (
      id, organization_id, application_id, course_entry_id, source_course_entry_id,
      operation, before_values, after_values, imported_values, reason,
      actor_user_id, correlation_id)
    VALUES ('ce800000-0000-4000-8000-000000000001', 'ce100000-0000-4000-8000-000000000001',
            'ce600000-0000-4000-8000-000000000001', 'ce700000-0000-4000-8000-000000000001', NULL,
            'added',
            '{"courseName": "Wrong Course", "grade": "B"}'::jsonb,
            '{"courseName": "Corrected Course", "grade": "A"}'::jsonb,
            '{"courseName": "Wrong Course", "grade": "B"}'::jsonb,
            'Student reported the transcript line was wrong.',
            'ce000000-0000-4000-8000-000000000001',
            'ce900000-0000-4000-8000-000000000001');
  $fixture$;

  EXECUTE $run$
    SELECT plugin_data.csf_retention_preview(
      'ce100000-0000-4000-8000-000000000001',
      'ce000000-0000-4000-8000-000000000001',
      'cea00000-0000-4000-8000-000000000001',
      ARRAY[2024],
      'Chapter retention decision for the graduated class of 2024.')
  $run$;

  EXECUTE $run$
    SELECT plugin_data.csf_retention_commit(
      'ce100000-0000-4000-8000-000000000001',
      'ce000000-0000-4000-8000-000000000001',
      'cea00000-0000-4000-8000-000000000002',
      run.id, run.profile_digest, ARRAY[2024],
      ARRAY['ce300000-0000-4000-8000-000000000001']::uuid[])
    FROM plugin_data.csf_retention_runs AS run
    WHERE run.request_id = 'cea00000-0000-4000-8000-000000000001'
  $run$;

  EXECUTE $collect$
    INSERT INTO course_retention_outcome (key, value)
    SELECT 'applications', count(*)::text
    FROM plugin_data.csf_term_applications
    WHERE id = 'ce600000-0000-4000-8000-000000000001'
    UNION ALL
    SELECT 'receipts', count(*)::text
    FROM plugin_data.csf_application_course_corrections
    WHERE id = 'ce800000-0000-4000-8000-000000000001'
    UNION ALL
    SELECT 'courseEntries', count(*)::text
    FROM plugin_data.csf_application_course_entries
    WHERE application_id = 'ce600000-0000-4000-8000-000000000001'
    UNION ALL
    SELECT 'scrubbed', count(*)::text
    FROM plugin_data.csf_application_course_corrections
    WHERE id = 'ce800000-0000-4000-8000-000000000001'
      AND before_values = '{}'::jsonb
      AND after_values = '{}'::jsonb
      AND imported_values IS NULL
      AND reason = plugin_data.csf_retention_erased_reason()
    UNION ALL
    SELECT 'lineage', count(*)::text
    FROM plugin_data.csf_application_course_corrections
    WHERE id = 'ce800000-0000-4000-8000-000000000001'
      AND application_id = 'ce600000-0000-4000-8000-000000000001'
      AND course_entry_id = 'ce700000-0000-4000-8000-000000000001'
      AND operation = 'added'
      AND correlation_id = 'ce900000-0000-4000-8000-000000000001'
      AND actor_user_id = 'ce000000-0000-4000-8000-000000000001'
  $collect$;
END
$do$;

SELECT extensions.skip(
  '20260917130000 is not in this tree, so the corrected-student retirement was not exercised', 6
) WHERE pg_catalog.to_regclass('plugin_data.csf_application_course_corrections') IS NULL;

SELECT extensions.is(
  (SELECT value FROM course_retention_outcome WHERE key = 'applications'),
  '1',
  'the application is kept rather than deleted, so its correction receipts are never cascaded away'
) WHERE pg_catalog.to_regclass('plugin_data.csf_application_course_corrections') IS NOT NULL;

SELECT extensions.is(
  (SELECT value FROM course_retention_outcome WHERE key = 'receipts'),
  '1',
  'the immutable correction receipt survives the retirement'
) WHERE pg_catalog.to_regclass('plugin_data.csf_application_course_corrections') IS NOT NULL;

SELECT extensions.is(
  (SELECT value FROM course_retention_outcome WHERE key = 'scrubbed'),
  '1',
  'the receipt keeps no course line, no imported original and no officer prose'
) WHERE pg_catalog.to_regclass('plugin_data.csf_application_course_corrections') IS NOT NULL;

SELECT extensions.is(
  (SELECT value FROM course_retention_outcome WHERE key = 'lineage'),
  '1',
  'the receipt keeps every column that makes it a receipt'
) WHERE pg_catalog.to_regclass('plugin_data.csf_application_course_corrections') IS NOT NULL;

SELECT extensions.is(
  (SELECT value FROM course_retention_outcome WHERE key = 'courseEntries'),
  '0',
  'the corrected course lines are gone, even though the overwrite guard protects them from a re-import'
) WHERE pg_catalog.to_regclass('plugin_data.csf_application_course_corrections') IS NOT NULL;

-- The yield is narrow: outside a retirement the receipt is as immutable as it
-- was. This runs after the commit, in the same transaction, so the retention
-- flag is still set -- which is the harder case, not the easier one.
SELECT extensions.throws_ok(
  $$UPDATE plugin_data.csf_application_course_corrections
    SET reason = 'Someone rewriting history after the fact.'
    WHERE id = 'ce800000-0000-4000-8000-000000000001'$$,
  '55000',
  NULL,
  'a receipt still cannot be rewritten, even inside a retirement transaction'
) WHERE pg_catalog.to_regclass('plugin_data.csf_application_course_corrections') IS NOT NULL;

SELECT * FROM extensions.finish();

ROLLBACK;
