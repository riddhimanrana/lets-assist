-- Teach the graduated-cohort retirement about officer course corrections.
--
-- 20260917130000 adds three things retirement has to be told about:
--
--   1. Two columns on `csf_term_applications` -- `courses_corrected_at` and
--      `courses_corrected_by`. The identity inventory in 20260917100000 checks
--      itself against `pg_attribute`, so two unclassified columns would block
--      every preview and commit. That is the gate working; this classifies
--      them.
--   2. `csf_application_course_corrections`, an append-only ledger whose
--      `application_id` foreign key cascades on application delete. Retirement
--      deletes applications that no import row names. Left alone, that cascade
--      would destroy immutable receipts, and it would do it quietly: the
--      ledger's own immutability guard returns OLD when
--      `pg_trigger_depth() > 1`, which is exactly the shape a cascade has.
--   3. A guard on `csf_application_course_entries` that turns a delete into
--      `55000` once an officer has corrected the application. Retirement
--      deletes those rows directly, at trigger depth 1, so retiring a corrected
--      student would abort the whole run.
--
-- The answer to (2) is the answer 20260917100000 already gives everywhere
-- else: keep the row, erase what it says about a person. A correction receipt
-- holds `before_values`, `after_values` and `imported_values` -- the student's
-- course names and grades -- plus an officer's free-text reason. None of that
-- is import provenance and none of it may survive a retirement. The lineage
-- that makes the receipt a receipt (which application, which operation, which
-- correlation, when, by whom) does survive, and the row is never deleted.
--
-- So an application with correction receipts is retained and scrubbed rather
-- than deleted, on the same footing as an application an import row names, and
-- the cascade never fires.
--
-- The answer to (3) is the narrow yield this repository already uses for an
-- immutability guard that a reviewed lane must pass: the guard consults a
-- transaction-local attestation that only an authorized entrypoint raises, and
-- refuses everything else exactly as before. Nothing is disabled and nothing
-- is dropped.
--
-- 20260917130000 lives in another lane and is not in this tree, so everything
-- here that depends on it is applied only when it is actually present. In a
-- tree without it this migration classifies the columns it can see and changes
-- nothing else.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Classification
--
-- Rows are data, not schema, so these are safe to record whether or not
-- 20260917130000 is present -- the coverage functions read the live catalog
-- and only ever ask whether what exists is classified.
-- ---------------------------------------------------------------------------

INSERT INTO plugin_data.csf_retention_identity_inventory
  (table_name, column_name, treatment, note)
VALUES
  ('csf_term_applications', 'courses_corrected_at', 'structural',
   'marks that an officer corrected the course lines; says nothing about the student'),
  ('csf_term_applications', 'courses_corrected_by', 'structural',
   'the officer who corrected them, not the student'),

  ('csf_application_course_corrections', 'id', 'structural', 'receipt key'),
  ('csf_application_course_corrections', 'organization_id', 'structural', 'tenant'),
  ('csf_application_course_corrections', 'application_id', 'structural', 'the record the receipt belongs to'),
  ('csf_application_course_corrections', 'course_entry_id', 'structural',
   'the course row the correction produced; deliberately not a foreign key, and dangling once retirement removes the course rows'),
  ('csf_application_course_corrections', 'source_course_entry_id', 'structural',
   'the course row it replaced; same'),
  ('csf_application_course_corrections', 'operation', 'structural', 'added, updated, removed or restored'),
  ('csf_application_course_corrections', 'before_values', 'erase', 'the student''s course line as it was'),
  ('csf_application_course_corrections', 'after_values', 'erase', 'the student''s course line as corrected'),
  ('csf_application_course_corrections', 'imported_values', 'erase', 'the student''s imported course line'),
  ('csf_application_course_corrections', 'reason', 'erase', 'officer free text that may name the student'),
  ('csf_application_course_corrections', 'actor_user_id', 'structural', 'the officer who corrected'),
  ('csf_application_course_corrections', 'correlation_id', 'structural', 'replay key'),
  ('csf_application_course_corrections', 'created_at', 'structural', 'row timestamp')
ON CONFLICT (table_name, column_name) DO NOTHING;

INSERT INTO plugin_data.csf_retention_reference_policy
  (parent_table, child_table, child_column, policy, note)
VALUES
  ('csf_term_applications', 'csf_application_course_corrections', 'application_id', 'retain_immutable',
   'an append-only correction receipt; its cascade would destroy it silently, so the application is retained instead and the receipt is scrubbed')
ON CONFLICT (child_table, child_column, parent_table) DO NOTHING;

-- ---------------------------------------------------------------------------
-- B. The identity scan learns a third table
--
-- Retirement can now leave three tables standing: the profile row, an
-- application an import row or a correction receipt names, and the receipt
-- itself. Each is scanned against the inventory, and a table that does not
-- exist in this tree simply contributes no columns.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_retention_identity_coverage_gaps()
RETURNS TABLE (table_name text, column_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT rel.relname::text, att.attname::text
  FROM pg_catalog.pg_class AS rel
  JOIN pg_catalog.pg_namespace AS ns ON ns.oid = rel.relnamespace
  JOIN pg_catalog.pg_attribute AS att ON att.attrelid = rel.oid
  WHERE ns.nspname = 'plugin_data'
    AND rel.relname IN (
      'csf_profiles',
      'csf_term_applications',
      'csf_application_course_corrections'
    )
    AND att.attnum > 0
    AND NOT att.attisdropped
    AND NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_retention_identity_inventory AS inventory
      WHERE inventory.table_name = rel.relname
        AND inventory.column_name = att.attname
    )
  ORDER BY 1, 2
$$;

-- The one sentence a scrubbed receipt carries, in one place, so the guard and
-- the writer cannot drift apart. `reason` is NOT NULL with a length floor, so
-- it cannot simply be blanked.
CREATE FUNCTION plugin_data.csf_retention_erased_reason()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT 'Record retired under the chapter retention decision.'::text
$$;

ALTER FUNCTION plugin_data.csf_retention_erased_reason() OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_retention_erased_reason()
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_retention_erased_reason() TO postgres;

-- ---------------------------------------------------------------------------
-- C/D. Everything that needs 20260917130000 to exist
--
-- A SQL-language function is parsed when it is created, so the chained
-- candidate catalog cannot even be declared in a tree without that migration.
-- The guard replacements have the same problem from the other direction. All
-- of it lives behind one existence check, and a tree without the course editor
-- keeps the base behaviour untouched.
-- ---------------------------------------------------------------------------

DO $outer$
BEGIN
  IF pg_catalog.to_regclass('plugin_data.csf_application_course_corrections') IS NULL THEN
    RETURN;
  END IF;

  -- A correction receipt pins its application, and through it the profile.
  -- Chained rather than restated: the base decides everything it decided
  -- before, and this adds the one reference it could not have known about.
  EXECUTE 'ALTER FUNCTION plugin_data.csf_retention_candidates(uuid, integer[])
    RENAME TO csf_retention_candidates_pre_course_corrections_base';

  EXECUTE $fn$
    CREATE FUNCTION plugin_data.csf_retention_candidates(
      p_organization_id uuid,
      p_graduation_years integer[]
    )
    RETURNS TABLE (
      profile_id uuid,
      cohort_id uuid,
      graduation_year integer,
      blockers text[],
      retained_reference_count integer
    )
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
      SELECT
        base.profile_id,
        base.cohort_id,
        base.graduation_year,
        base.blockers,
        base.retained_reference_count
          + (
            SELECT pg_catalog.count(*)::integer
            FROM plugin_data.csf_application_course_corrections AS receipt
            JOIN plugin_data.csf_term_applications AS application
              ON application.organization_id = receipt.organization_id
              AND application.id = receipt.application_id
            WHERE receipt.organization_id = p_organization_id
              AND application.profile_id = base.profile_id
          )
      FROM plugin_data.csf_retention_candidates_pre_course_corrections_base(
        p_organization_id, p_graduation_years
      ) AS base
    $body$;
  $fn$;

  EXECUTE 'COMMENT ON FUNCTION plugin_data.csf_retention_candidates(uuid, integer[]) IS
    ''Owner-internal. The base catalog plus officer course-correction receipts, which pin their application and so pin the profile that owns it.''';

  EXECUTE 'ALTER FUNCTION plugin_data.csf_retention_candidates_pre_course_corrections_base(uuid, integer[])
    OWNER TO postgres';
  EXECUTE 'ALTER FUNCTION plugin_data.csf_retention_candidates(uuid, integer[]) OWNER TO postgres';
  EXECUTE 'REVOKE ALL ON FUNCTION plugin_data.csf_retention_candidates_pre_course_corrections_base(uuid, integer[])
    FROM PUBLIC, anon, authenticated, service_role, postgres';
  EXECUTE 'REVOKE ALL ON FUNCTION plugin_data.csf_retention_candidates(uuid, integer[])
    FROM PUBLIC, anon, authenticated, service_role, postgres';
  EXECUTE 'GRANT EXECUTE ON FUNCTION plugin_data.csf_retention_candidates_pre_course_corrections_base(uuid, integer[])
    TO postgres';
  EXECUTE 'GRANT EXECUTE ON FUNCTION plugin_data.csf_retention_candidates(uuid, integer[]) TO postgres';

  -- The overwrite guard exists to stop a *source re-import* from silently
  -- replacing lines an officer corrected. A retirement is not the source
  -- winning an argument: it is the removal of the whole record, receipts and
  -- all, under a separate authorization. The guard still refuses every import
  -- path exactly as before.
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION plugin_data.csf_guard_application_course_overwrite()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
    BEGIN
      IF pg_catalog.pg_trigger_depth() > 1 THEN
        RETURN OLD;
      END IF;

      IF plugin_data.csf_retention_in_progress() THEN
        RETURN OLD;
      END IF;

      IF pg_catalog.current_setting('plugin_data.csf_course_correction_application', true)
        IS NOT DISTINCT FROM OLD.application_id::text THEN
        RETURN OLD;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM plugin_data.csf_term_applications AS application
        WHERE application.organization_id = OLD.organization_id
          AND application.id = OLD.application_id
          AND application.courses_corrected_at IS NOT NULL
      ) THEN
        RAISE EXCEPTION USING
          ERRCODE = '55000',
          MESSAGE = 'An officer corrected this application''s courses, so the source cannot overwrite them.',
          DETAIL = 'CSF_COURSE_CORRECTION_CONFLICT=' || OLD.application_id::text,
          HINT = 'Restore the imported course lines on this application, then re-import the row.';
      END IF;

      RETURN OLD;
    END;
    $body$;
  $fn$;

  -- The receipt guard yields to exactly one thing: a retirement blanking the
  -- four columns the identity inventory classifies as identifying, to exactly
  -- their erased values, with every other column byte-identical. A retirement
  -- still cannot delete a receipt, still cannot edit its lineage, and still
  -- cannot write arbitrary content into it.
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION plugin_data.csf_guard_application_course_correction_receipt()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
    DECLARE
      v_identity constant text[] :=
        ARRAY['before_values', 'after_values', 'imported_values', 'reason'];
    BEGIN
      IF pg_catalog.pg_trigger_depth() > 1 THEN
        RETURN OLD;
      END IF;

      IF TG_OP = 'UPDATE'
        AND plugin_data.csf_retention_in_progress()
        AND pg_catalog.to_jsonb(OLD) - v_identity = pg_catalog.to_jsonb(NEW) - v_identity
        AND NEW.before_values = '{}'::jsonb
        AND NEW.after_values = '{}'::jsonb
        AND NEW.imported_values IS NULL
        AND NEW.reason = plugin_data.csf_retention_erased_reason() THEN
        RETURN NEW;
      END IF;

      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'CSF application course correction receipts are immutable.',
        DETAIL = 'CSF_COURSE_CORRECTION_RECEIPT_IMMUTABLE=' || OLD.id::text,
        HINT = 'Record another correction instead of rewriting this receipt.';
    END;
    $body$;
  $fn$;

  EXECUTE 'ALTER FUNCTION plugin_data.csf_guard_application_course_overwrite() OWNER TO postgres';
  EXECUTE 'ALTER FUNCTION plugin_data.csf_guard_application_course_correction_receipt() OWNER TO postgres';
  EXECUTE 'REVOKE ALL ON FUNCTION plugin_data.csf_guard_application_course_overwrite()
    FROM PUBLIC, anon, authenticated, service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION plugin_data.csf_guard_application_course_correction_receipt()
    FROM PUBLIC, anon, authenticated, service_role';
END
$outer$;

-- ---------------------------------------------------------------------------
-- E. Retirement keeps the receipt and erases what it says
--
-- Restated rather than chained: the base decides whether to delete an
-- application, and that decision is the one that has to change. Everything
-- else below is the base unchanged.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_retention_delete_owned_records(
  p_organization_id uuid,
  p_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_counts jsonb := '{}'::jsonb;
  v_application_ids uuid[];
  v_submission_ids uuid[];
  v_has_corrections boolean :=
    pg_catalog.to_regclass('plugin_data.csf_application_course_corrections') IS NOT NULL;
  v_table text;
  v_deleted integer;
BEGIN
  SELECT coalesce(pg_catalog.array_agg(application.id), ARRAY[]::uuid[])
  INTO v_application_ids
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.profile_id = p_profile_id;

  SELECT coalesce(pg_catalog.array_agg(submission.id), ARRAY[]::uuid[])
  INTO v_submission_ids
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.profile_id = p_profile_id;

  -- Sheet export state. `csf_sheet_sync_bindings` and `csf_sheet_sync_changes`
  -- key on `record_id` and a bare `profile_id` with no foreign key, so the
  -- reference catalog cannot see them -- and both carry exported cell content,
  -- discussion threads and the last request payload, which is student data
  -- sitting outside the immutable evidence layer. The write-back ledger quotes
  -- the decision and the source row. All three go with the record; an enabled
  -- destination blocks the profile long before this point.
  DELETE FROM plugin_data.csf_sheet_sync_changes AS change
  WHERE change.organization_id = p_organization_id
    AND change.record_id = ANY(v_application_ids || v_submission_ids);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted > 0 THEN
    v_counts := v_counts || pg_catalog.jsonb_build_object('csf_sheet_sync_changes', v_deleted);
  END IF;

  DELETE FROM plugin_data.csf_sheet_sync_bindings AS binding
  WHERE binding.organization_id = p_organization_id
    AND (
      binding.profile_id = p_profile_id
      OR binding.record_id = ANY(v_application_ids || v_submission_ids)
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted > 0 THEN
    v_counts := v_counts || pg_catalog.jsonb_build_object('csf_sheet_sync_bindings', v_deleted);
  END IF;

  DELETE FROM plugin_data.csf_sheet_writeback_ledger AS ledger
  WHERE ledger.organization_id = p_organization_id
    AND (
      ledger.application_id = ANY(v_application_ids)
      OR ledger.record_id = ANY(v_application_ids || v_submission_ids)
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted > 0 THEN
    v_counts := v_counts || pg_catalog.jsonb_build_object('csf_sheet_writeback_ledger', v_deleted);
  END IF;

  -- Application children, by application. These do not all carry a profile_id,
  -- so deleting by profile would miss them, and an application that has to
  -- stay must not keep its course evidence, checks, notes or status history.
  FOREACH v_table IN ARRAY ARRAY[
    'csf_application_course_entries',
    'csf_application_checks',
    'csf_application_private_notes',
    'csf_application_status_events',
    'csf_application_decision_stages',
    'csf_application_correction_requests',
    'csf_application_files'
  ] LOOP
    EXECUTE pg_catalog.format(
      'DELETE FROM plugin_data.%I AS owned
        WHERE owned.organization_id = $1 AND owned.application_id = ANY($2)',
      v_table
    )
    USING p_organization_id, v_application_ids;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted > 0 THEN
      v_counts := v_counts || pg_catalog.jsonb_build_object(v_table, v_deleted);
    END IF;
  END LOOP;

  -- Review-period notes and decisions key on (subject_kind, subject_id), not
  -- on a foreign key, so the reference policy cannot see them. They hold
  -- officer free text about this student and go with everything else.
  DELETE FROM plugin_data.csf_review_notes AS note
  WHERE note.organization_id = p_organization_id
    AND (
      (note.subject_kind = 'profile' AND note.subject_id = p_profile_id)
      OR (note.subject_kind = 'application' AND note.subject_id = ANY(v_application_ids))
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted > 0 THEN
    v_counts := v_counts || pg_catalog.jsonb_build_object('csf_review_notes', v_deleted);
  END IF;

  DELETE FROM plugin_data.csf_review_decisions AS decision
  WHERE decision.organization_id = p_organization_id
    AND (
      (decision.subject_kind = 'profile' AND decision.subject_id = p_profile_id)
      OR (decision.subject_kind = 'application' AND decision.subject_id = ANY(v_application_ids))
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted > 0 THEN
    v_counts := v_counts || pg_catalog.jsonb_build_object('csf_review_decisions', v_deleted);
  END IF;

  -- Rows the student owns directly.
  FOREACH v_table IN ARRAY ARRAY[
    'csf_submission_files',
    'csf_point_appeals',
    'csf_credit_records',
    'csf_point_submissions',
    'csf_meeting_attendance',
    'csf_dues_records',
    'csf_opportunity_signups',
    'csf_term_membership_outcomes',
    'csf_term_memberships',
    'csf_reviewed_workbook_profile_links',
    'csf_member_reports',
    'csf_communication_broadcast_preferences',
    'csf_profile_activity_events',
    'csf_profile_restrictions',
    'csf_profile_notes',
    'csf_profile_accounts',
    'csf_profile_cohort_memberships'
  ] LOOP
    EXECUTE pg_catalog.format(
      'DELETE FROM plugin_data.%I AS owned
        WHERE owned.organization_id = $1 AND owned.profile_id = $2',
      v_table
    )
    USING p_organization_id, p_profile_id;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted > 0 THEN
      v_counts := v_counts || pg_catalog.jsonb_build_object(v_table, v_deleted);
    END IF;
  END LOOP;

  DELETE FROM plugin_data.csf_profile_link_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.matched_profile_id = p_profile_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted > 0 THEN
    v_counts := v_counts || pg_catalog.jsonb_build_object('csf_profile_link_requests', v_deleted);
  END IF;

  -- Scrub the correction receipts before anything can delete their
  -- application. The lineage stays; the course lines and the officer's words
  -- do not.
  IF v_has_corrections THEN
    EXECUTE $scrub$
      UPDATE plugin_data.csf_application_course_corrections AS receipt
      SET before_values = '{}'::jsonb,
          after_values = '{}'::jsonb,
          imported_values = NULL,
          reason = plugin_data.csf_retention_erased_reason()
      WHERE receipt.organization_id = $1
        AND receipt.application_id = ANY($2)
    $scrub$
    USING p_organization_id, v_application_ids;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted > 0 THEN
      v_counts := v_counts
        || pg_catalog.jsonb_build_object('csf_application_course_corrections_scrubbed', v_deleted);
    END IF;
  END IF;

  -- An application is deleted only when nothing immutable names it. An import
  -- row names it through `matched_application_id`; a correction receipt names
  -- it through a cascading foreign key that would take the receipt with it.
  -- Either way the row stays and is scrubbed below.
  IF v_has_corrections THEN
    EXECUTE $keep$
      DELETE FROM plugin_data.csf_term_applications AS application
      WHERE application.organization_id = $1
        AND application.profile_id = $2
        AND NOT EXISTS (
          SELECT 1
          FROM plugin_data.csf_sheet_import_rows AS import_row
          WHERE import_row.organization_id = $1
            AND import_row.matched_application_id = application.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM plugin_data.csf_application_course_corrections AS receipt
          WHERE receipt.organization_id = $1
            AND receipt.application_id = application.id
        )
    $keep$
    USING p_organization_id, p_profile_id;
  ELSE
    DELETE FROM plugin_data.csf_term_applications AS application
    WHERE application.organization_id = p_organization_id
      AND application.profile_id = p_profile_id
      AND NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_sheet_import_rows AS import_row
        WHERE import_row.organization_id = p_organization_id
          AND import_row.matched_application_id = application.id
      );
  END IF;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted > 0 THEN
    v_counts := v_counts || pg_catalog.jsonb_build_object('csf_term_applications', v_deleted);
  END IF;

  UPDATE plugin_data.csf_term_applications AS application
  SET google_form_response_id = NULL,
      source_url = NULL,
      current_grade_level = NULL,
      returning_status = NULL,
      shirt_size = NULL,
      most_checked_email = NULL,
      list_i_points = NULL,
      list_i_ii_points = NULL,
      grand_total_points = NULL,
      social_confirmation = NULL,
      application_data = '{}'::jsonb,
      review_notes = NULL,
      decision_reason = NULL,
      updated_at = now()
  WHERE application.organization_id = p_organization_id
    AND application.profile_id = p_profile_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted > 0 THEN
    v_counts := v_counts
      || pg_catalog.jsonb_build_object('csf_term_applications_scrubbed_for_provenance', v_deleted);
  END IF;

  RETURN v_counts;
END;
$$;

-- ---------------------------------------------------------------------------
-- F. Roles
-- ---------------------------------------------------------------------------

-- `CREATE OR REPLACE` keeps the owner and the grants of the function it
-- replaces, but restating them costs nothing and means a reader does not have
-- to know that. The chained candidate catalog and the two course guards carry
-- their own inside the existence check above, because in a tree without the
-- course editor they do not exist to grant.
ALTER FUNCTION plugin_data.csf_retention_identity_coverage_gaps() OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_retention_delete_owned_records(uuid, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_retention_identity_coverage_gaps()
  FROM PUBLIC, anon, authenticated, service_role, postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_retention_delete_owned_records(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, postgres;

GRANT EXECUTE ON FUNCTION plugin_data.csf_retention_identity_coverage_gaps() TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_retention_delete_owned_records(uuid, uuid) TO postgres;

COMMIT;
