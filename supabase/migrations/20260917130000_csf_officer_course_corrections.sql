-- Authorized officer correction of the course lines on a semester application.
--
-- The gap this closes.
--
-- `20260917090000` gave an officer a bounded editor for the eight reported
-- scalar fields on `csf_term_applications`, and said so explicitly: the course
-- lines the applicant claimed those totals from stayed read-only, so "the
-- transcript says AP Biology, not Biology" still meant editing the source
-- workbook and re-importing. That is the correction officers actually need,
-- because `csf_application_course_entries` is what the decision preflight
-- recomputes points from and what the `course_data` and `academic_eligibility`
-- checks read.
--
-- What this adds, and what it deliberately does not.
--
-- `csf_application_course_entries` stays the one canonical effective course
-- record. There is no shadow "override" table and no second opinion about what
-- an applicant's courses are: an officer correction edits the canonical row and
-- leaves a receipt beside it, exactly like the scalar editor edits the
-- canonical application row and leaves an audit event. A reviewed override
-- mechanism for effective course values did not already exist; the only writer
-- was the import commit.
--
-- The imported original survives in three places, none of which this writes:
--
--   1. `csf_sheet_import_rows` keeps the immutable raw row (V24/V46).
--   2. `csf_term_applications.application_data -> 'normalizedImport' ->
--      'courses'` keeps the exact parsed course list the commit used. This
--      migration never writes `application_data`, and the restore path below
--      reads it back verbatim.
--   3. `csf_application_course_entries.imported_values` freezes the pre-edit
--      imported values on the row itself, the first time an officer touches it,
--      and the append-only `csf_application_course_corrections` ledger records
--      every before/after pair with its actor, reason, and correlation id.
--
-- Points are not invented and eligibility is not recalculated here. The stored
-- `points` column has been source provenance since `20260809212324`; the
-- preflight recomputes every base point from the current versioned policy's
-- grade map and caps bonuses itself. So this editor writes exactly the numbers
-- an officer typed, writes no `eligibility_status`, and reports
-- `eligibilityInputsChanged` so the existing V52/V105 derivation surfaces
-- `Needs recalculation` on its own.
--
-- Source sync cannot silently win. The import commit overwrites courses by
-- deleting every row for the application and re-inserting from the snapshot. A
-- guard trigger turns that delete into an explicit `55000` conflict once an
-- officer has corrected the application, and names the restore path. Restoring
-- the imported originals is itself a permitted, audited, replay-safe officer
-- action, so the conflict has an exit that does not require weakening the
-- guard.

BEGIN;

-- ===========================================================================
-- 1. Correction state on the canonical rows
-- ===========================================================================

ALTER TABLE plugin_data.csf_application_course_entries
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'import',
  ADD COLUMN IF NOT EXISTS officer_corrected_at timestamptz,
  ADD COLUMN IF NOT EXISTS officer_corrected_by uuid
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS imported_values jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'csf_application_course_entries_origin_check'
      AND conrelid = 'plugin_data.csf_application_course_entries'::regclass
  ) THEN
    ALTER TABLE plugin_data.csf_application_course_entries
      ADD CONSTRAINT csf_application_course_entries_origin_check
      CHECK (origin IN ('import', 'officer'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'csf_application_course_entries_officer_row_is_marked'
      AND conrelid = 'plugin_data.csf_application_course_entries'::regclass
  ) THEN
    -- A row an officer added is a correction by definition, so it can never
    -- look like an imported row that nobody touched.
    ALTER TABLE plugin_data.csf_application_course_entries
      ADD CONSTRAINT csf_application_course_entries_officer_row_is_marked
      CHECK (origin <> 'officer' OR officer_corrected_at IS NOT NULL);
  END IF;
END $$;

COMMENT ON COLUMN plugin_data.csf_application_course_entries.origin IS
  'import = written by the import commit from the immutable source snapshot. officer = added by an authorized officer correction. Existing rows keep import through the default.';

COMMENT ON COLUMN plugin_data.csf_application_course_entries.imported_values IS
  'The imported values this row held before an officer first corrected it, frozen once. NULL on an untouched imported row and on a row an officer added.';

-- The application-level marker. NULL means every course line on this
-- application is still exactly what the source produced.
ALTER TABLE plugin_data.csf_term_applications
  ADD COLUMN IF NOT EXISTS courses_corrected_at timestamptz,
  ADD COLUMN IF NOT EXISTS courses_corrected_by uuid
    REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN plugin_data.csf_term_applications.courses_corrected_at IS
  'Set when an officer corrects this application''s course lines, cleared when the imported originals are restored. While it is set, a source re-import cannot overwrite the course rows.';

-- ===========================================================================
-- 1b. The shared permission catalog
--
-- This editor runs on `edit_application_records`, the capability the scalar
-- application editor introduces in `20260917090000`. V99 requires the SQL and
-- TypeScript catalogs to agree, and the catalog is a whole-array function, so
-- the branch that adds a capability restates the array.
--
-- Restated here so this migration's ledger is self-consistent whether or not
-- `20260917090000` has landed. The two restatements are byte-identical and
-- `CREATE OR REPLACE` makes the later one a no-op; a reviewer who changes the
-- catalog in either branch must change it in both, because whichever migration
-- sorts last is the definition that survives.
--
-- The role backfill that grants the capability to existing decision and
-- check-review roles belongs to `20260917090000` and is deliberately not
-- repeated here. Without it an organization admin still reaches this editor
-- through `csf_actor_has_permission`, and every other role must be granted the
-- capability explicitly.
-- ===========================================================================

CREATE OR REPLACE FUNCTION plugin_data.csf_role_permission_catalog()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY[
    'manage_roles','manage_cohorts_terms','manage_schedule','manage_profiles',
    'review_applications','view_applications','review_application_checks',
    'decide_applications','assign_applications','write_application_notes',
    'edit_application_records',
    'manage_restrictions','manage_opportunities','manage_posts','manage_partner_clubs',
    'verify_participation','process_points','verify_submissions','manage_review_periods',
    'manage_meetings',
    'reconcile_meeting_attendance','close_term','reopen_term','edit_point_rules',
    'manage_payment_review','import_applications','import_members','import_meetings',
    'import_partner_clubs','manage_sheet_sync','resolve_imports','manage_settings',
    'export_membership_reports','export_dues_reports','export_service_reports',
    'export_club_reports','export_reports','export_sensitive_reports','view_audit_history'
  ]::text[];
$$;

-- The catalog keeps the ACL it was given in 20260801223711: it is an internal
-- helper for the role RPCs, so no role reaches it, not even service_role.
ALTER FUNCTION plugin_data.csf_role_permission_catalog() OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_role_permission_catalog()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_role_permission_catalog() TO postgres;

-- ===========================================================================
-- 2. The append-only correction ledger
--
-- The audit event carries the officer-facing story; this carries the per-row
-- lineage, including the imported original of every row a correction touched.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS plugin_data.csf_application_course_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  -- The row the correction produced. NULL for a removal, and deliberately not
  -- a foreign key: a later removal must not erase the lineage of the edit that
  -- came before it.
  course_entry_id uuid,
  -- The row the correction replaced or removed. NULL for an addition.
  source_course_entry_id uuid,
  operation text NOT NULL
    CHECK (operation IN ('added', 'updated', 'removed', 'restored')),
  before_values jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(before_values) = 'object'),
  after_values jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(after_values) = 'object'),
  -- The imported original for the touched row, when it had one.
  imported_values jsonb,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 500),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_application_course_corrections_application_organization_fkey
    FOREIGN KEY (application_id, organization_id)
    REFERENCES plugin_data.csf_term_applications (id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT csf_application_course_corrections_addition_has_no_source CHECK (
    operation <> 'added' OR source_course_entry_id IS NULL
  ),
  CONSTRAINT csf_application_course_corrections_removal_has_no_target CHECK (
    operation <> 'removed' OR course_entry_id IS NULL
  )
);

COMMENT ON TABLE plugin_data.csf_application_course_corrections IS
  'Append-only per-row lineage for authorized officer corrections of application course lines. Never the effective course record; csf_application_course_entries remains canonical.';

CREATE INDEX IF NOT EXISTS csf_application_course_corrections_application_idx
  ON plugin_data.csf_application_course_corrections
  (organization_id, application_id, created_at DESC);

CREATE INDEX IF NOT EXISTS csf_application_course_corrections_correlation_idx
  ON plugin_data.csf_application_course_corrections
  (organization_id, correlation_id);

-- Same posture as the decision-staging tables: `service_role` reads, every
-- write goes through a reviewed SECURITY DEFINER function, clients reach
-- nothing, and RLS stays on as defence in depth.
ALTER TABLE plugin_data.csf_application_course_corrections
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_application_course_corrections
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE plugin_data.csf_application_course_corrections
  TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_guard_application_course_correction_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- A cascade from the organization or the application is lifecycle teardown,
  -- not a rewrite. Referential actions run as internal triggers, so this
  -- trigger sees a depth above its own when one fires. Keeping teardown out of
  -- the guard means this does not have to be added to the suspend list an
  -- organization deletion already carries.
  IF pg_catalog.pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'CSF application course correction receipts are immutable.',
    DETAIL = 'CSF_COURSE_CORRECTION_RECEIPT_IMMUTABLE=' || OLD.id::text,
    HINT = 'Record another correction instead of rewriting this receipt.';
END;
$$;

ALTER FUNCTION plugin_data.csf_guard_application_course_correction_receipt()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_application_course_correction_receipt()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS csf_application_course_corrections_immutable
  ON plugin_data.csf_application_course_corrections;
CREATE TRIGGER csf_application_course_corrections_immutable
  BEFORE UPDATE OR DELETE ON plugin_data.csf_application_course_corrections
  FOR EACH ROW
  EXECUTE FUNCTION plugin_data.csf_guard_application_course_correction_receipt();

-- ===========================================================================
-- 3. Source sync cannot overwrite a correction
--
-- `csf_commit_application_import_row` replaces courses by deleting every row
-- for the application and re-inserting from the snapshot. Guarding the delete
-- covers that writer and any future one, without this migration restating a
-- 700-line import function it does not otherwise touch.
--
-- The officer paths announce themselves through a transaction-local setting
-- naming the exact application they are working on, so the guard never has to
-- guess and a correction that removes a line is not mistaken for an overwrite.
-- ===========================================================================

CREATE OR REPLACE FUNCTION plugin_data.csf_guard_application_course_overwrite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF pg_catalog.pg_trigger_depth() > 1 THEN
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
$$;

ALTER FUNCTION plugin_data.csf_guard_application_course_overwrite()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_application_course_overwrite()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS csf_application_course_entries_correction_guard
  ON plugin_data.csf_application_course_entries;
CREATE TRIGGER csf_application_course_entries_correction_guard
  BEFORE DELETE ON plugin_data.csf_application_course_entries
  FOR EACH ROW
  EXECUTE FUNCTION plugin_data.csf_guard_application_course_overwrite();

-- ===========================================================================
-- 4. The stale-evidence revision
--
-- A caller edits the course lines it was shown. The revision is a hash of the
-- exact rows behind that render, so a concurrent correction or a re-import
-- between render and submit is a conflict rather than a blind overwrite.
-- ===========================================================================

CREATE OR REPLACE FUNCTION plugin_data.csf_application_course_revision(
  p_organization_id uuid,
  p_application_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        coalesce((
          SELECT pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'id', course.id,
              'courseList', course.course_list,
              'courseName', course.course_name,
              'grade', course.grade,
              'points', course.points,
              'isBonus', course.is_bonus,
              'origin', course.origin
            )
            ORDER BY course.id
          )
          FROM plugin_data.csf_application_course_entries AS course
          WHERE course.organization_id = p_organization_id
            AND course.application_id = p_application_id
        ), '[]'::jsonb)::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

ALTER FUNCTION plugin_data.csf_application_course_revision(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_application_course_revision(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_application_course_revision(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_application_course_revision(uuid, uuid) IS
  'Stable hash of an application''s current course rows. A course correction must present the revision it was rendered from.';

-- ===========================================================================
-- 5. Request fingerprint
--
-- The same shape the scalar application editor and the point receipts use: a
-- request id replays only for the exact same actor, operation, and normalized
-- intent.
-- ===========================================================================

CREATE OR REPLACE FUNCTION plugin_data.csf_application_course_editor_request_fingerprint(
  p_organization_id uuid,
  p_application_id uuid,
  p_actor_user_id uuid,
  p_operation text,
  p_intent jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'operation', p_operation,
          'organizationId', p_organization_id,
          'applicationId', p_application_id,
          'actorUserId', p_actor_user_id,
          'intent', p_intent
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

ALTER FUNCTION plugin_data.csf_application_course_editor_request_fingerprint(
  uuid, uuid, uuid, text, jsonb
) OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_application_course_editor_request_fingerprint(
  uuid, uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_application_course_editor_request_fingerprint(
  uuid, uuid, uuid, text, jsonb
) TO postgres;

-- ===========================================================================
-- 6. Shared refusals
--
-- The scalar editor's boundary, restated once so both editors agree about when
-- an application record is still correctable. Raises; returns the application
-- row when it is.
-- ===========================================================================

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_application_record_correctable(
  p_organization_id uuid,
  p_application_id uuid,
  p_blocker_key text
)
RETURNS plugin_data.csf_term_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_membership_status text;
BEGIN
  SELECT application.*
  INTO v_application
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'no_data_found',
      MESSAGE = 'CSF application not found.';
  END IF;

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = v_application.term_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'no_data_found',
      MESSAGE = 'The semester for this application was not found.';
  END IF;

  IF v_term.lifecycle_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'This semester is finished. Reopen it before correcting an application.',
      DETAIL = p_blocker_key || '=term_closed';
  END IF;

  IF v_application.decision_status IS NOT NULL
    AND v_application.decision_status::text <> 'pending' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'This application already has a published decision. Retract it before correcting the record.',
      DETAIL = p_blocker_key || '=decision_published';
  END IF;

  SELECT membership.status
  INTO v_membership_status
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = v_application.profile_id
    AND membership.term_id = v_application.term_id
  FOR SHARE;
  IF v_membership_status IN ('completed', 'not_completed') THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'A finalized semester membership keeps its published outcome.',
      DETAIL = p_blocker_key || '=historical_outcome';
  END IF;

  RETURN v_application;
END;
$$;

ALTER FUNCTION plugin_data.csf_assert_application_record_correctable(uuid, uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_application_record_correctable(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_application_record_correctable(uuid, uuid, text)
  TO postgres;

-- ===========================================================================
-- 7. Bounded course-value validation
--
-- One place, so the editor and the restore path cannot disagree about what a
-- course line may contain. Returns the normalized values as an object.
-- ===========================================================================

CREATE OR REPLACE FUNCTION plugin_data.csf_normalize_application_course_values(
  p_values jsonb,
  p_defaults jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_allowed text[] := ARRAY[
    'courseList', 'courseName', 'grade', 'points', 'isBonus'
  ];
  v_grades text[] := ARRAY[
    'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-',
    'D+', 'D', 'D-', 'F', 'P', 'NP'
  ];
  v_rejected text[] := ARRAY[]::text[];
  v_key text;
  v_course_list text;
  v_course_name text;
  v_grade text;
  v_points text;
  v_bonus jsonb;
BEGIN
  IF p_values IS NULL OR pg_catalog.jsonb_typeof(p_values) <> 'object' THEN
    RAISE EXCEPTION 'Each course change must be an object of course values.';
  END IF;

  FOR v_key IN SELECT pg_catalog.jsonb_object_keys(p_values) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      v_rejected := pg_catalog.array_append(v_rejected, v_key);
    END IF;
  END LOOP;
  IF pg_catalog.array_length(v_rejected, 1) IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'That course field cannot be edited here.',
      DETAIL = pg_catalog.format(
        'CSF_COURSE_EDIT_REJECTED_FIELDS=%s',
        pg_catalog.array_to_string(v_rejected, ',')
      );
  END IF;

  v_course_list := CASE
    WHEN p_values ? 'courseList'
      THEN pg_catalog.upper(nullif(pg_catalog.btrim(coalesce(p_values ->> 'courseList', '')), ''))
    ELSE p_defaults ->> 'courseList'
  END;
  IF v_course_list IS NULL OR v_course_list NOT IN ('I', 'II', 'III') THEN
    RAISE EXCEPTION 'A course must be on list I, II, or III.';
  END IF;

  v_course_name := CASE
    WHEN p_values ? 'courseName'
      THEN nullif(pg_catalog.btrim(coalesce(p_values ->> 'courseName', '')), '')
    ELSE p_defaults ->> 'courseName'
  END;
  IF v_course_name IS NULL THEN
    RAISE EXCEPTION 'A course needs a name.';
  END IF;
  IF pg_catalog.length(v_course_name) > 120 THEN
    RAISE EXCEPTION 'Keep a course name under 120 characters.';
  END IF;

  v_grade := CASE
    WHEN p_values ? 'grade'
      THEN pg_catalog.upper(nullif(pg_catalog.btrim(coalesce(p_values ->> 'grade', '')), ''))
    ELSE p_defaults ->> 'grade'
  END;
  IF v_grade IS NOT NULL AND NOT (v_grade = ANY (v_grades)) THEN
    RAISE EXCEPTION 'That is not one of the recorded course grades.';
  END IF;

  v_points := CASE
    WHEN p_values ? 'points'
      THEN nullif(pg_catalog.btrim(coalesce(p_values ->> 'points', '')), '')
    ELSE p_defaults ->> 'points'
  END;
  -- Bounded by the stored column, numeric(5,2), so a legacy row's own value can
  -- always travel back through here as an unchanged default.
  IF v_points IS NOT NULL AND v_points !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' THEN
    RAISE EXCEPTION 'Reported course points must be a number between 0 and 999.99.';
  END IF;

  IF p_values ? 'isBonus' THEN
    v_bonus := p_values -> 'isBonus';
    IF pg_catalog.jsonb_typeof(v_bonus) <> 'boolean' THEN
      RAISE EXCEPTION 'The bonus flag must be true or false.';
    END IF;
  ELSE
    v_bonus := pg_catalog.to_jsonb(
      coalesce((p_defaults ->> 'isBonus')::boolean, false)
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'courseList', v_course_list,
    'courseName', v_course_name,
    'grade', v_grade,
    'points', v_points::numeric(5, 2),
    'isBonus', v_bonus
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_normalize_application_course_values(jsonb, jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_normalize_application_course_values(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_normalize_application_course_values(jsonb, jsonb)
  TO postgres;

-- The stored shape of one course row, for a receipt or a default.
CREATE OR REPLACE FUNCTION plugin_data.csf_application_course_values(
  p_course plugin_data.csf_application_course_entries
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'courseList', p_course.course_list,
    'courseName', p_course.course_name,
    'grade', p_course.grade,
    'points', p_course.points,
    'isBonus', p_course.is_bonus
  );
$$;

ALTER FUNCTION plugin_data.csf_application_course_values(
  plugin_data.csf_application_course_entries
) OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_application_course_values(
  plugin_data.csf_application_course_entries
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_application_course_values(
  plugin_data.csf_application_course_entries
) TO postgres;

-- ===========================================================================
-- 8. The editor implementation (owner-only)
-- ===========================================================================

CREATE OR REPLACE FUNCTION plugin_data.csf_edit_application_courses_locked_impl(
  p_organization_id uuid,
  p_application_id uuid,
  p_operations jsonb,
  p_expected_revision text,
  p_reason text,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_expected text := nullif(pg_catalog.btrim(coalesce(p_expected_revision, '')), '');
  v_revision text;
  v_intent jsonb;
  v_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_operation jsonb;
  v_op text;
  v_target_ids uuid[] := ARRAY[]::uuid[];
  v_target_id uuid;
  v_course plugin_data.csf_application_course_entries%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_imported jsonb;
  v_new_id uuid;
  v_added integer := 0;
  v_updated integer := 0;
  v_removed integer := 0;
  v_receipts jsonb := '[]'::jsonb;
  v_total integer;
  v_now timestamptz := pg_catalog.now();
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable course correction request identifier is required.';
  END IF;
  IF v_reason IS NULL OR pg_catalog.length(v_reason) < 8 THEN
    RAISE EXCEPTION 'Explain the course correction in at least 8 characters.';
  END IF;
  IF pg_catalog.length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Keep the correction reason under 500 characters.';
  END IF;
  IF v_expected IS NULL THEN
    RAISE EXCEPTION 'A course correction must present the revision it was rendered from.';
  END IF;
  IF p_operations IS NULL OR pg_catalog.jsonb_typeof(p_operations) <> 'array' THEN
    RAISE EXCEPTION 'The requested course changes must be an array.';
  END IF;
  IF pg_catalog.jsonb_array_length(p_operations) = 0 THEN
    RAISE EXCEPTION 'Choose at least one course line to correct.';
  END IF;
  IF pg_catalog.jsonb_array_length(p_operations) > 40 THEN
    RAISE EXCEPTION 'Correct at most 40 course lines at a time.';
  END IF;

  v_intent := pg_catalog.jsonb_build_object(
    'applicationId', p_application_id,
    'operations', p_operations,
    'expectedRevision', v_expected,
    'reason', v_reason
  );
  v_fingerprint := plugin_data.csf_application_course_editor_request_fingerprint(
    p_organization_id, p_application_id, p_actor_user_id,
    'application.courses_edit', v_intent
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_application_course_edit_request:'
        || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'application_course_edit_request'
  ORDER BY audit.created_at, audit.id
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'application.courses_edited'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_term_applications'
      OR v_receipt.target_id IS DISTINCT FROM p_application_id
      OR v_receipt.after_data ->> 'requestFingerprint'
        IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'That course correction request identifier is already bound to a different change.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'applicationId', p_application_id,
      'correlationId', p_request_id,
      'revision', v_receipt.after_data ->> 'revision',
      'addedCount', coalesce((v_receipt.after_data ->> 'addedCount')::integer, 0),
      'updatedCount', coalesce((v_receipt.after_data ->> 'updatedCount')::integer, 0),
      'removedCount', coalesce((v_receipt.after_data ->> 'removedCount')::integer, 0),
      'eligibilityInputsChanged', true,
      'idempotent', true
    );
  END IF;

  v_application := plugin_data.csf_assert_application_record_correctable(
    p_organization_id, p_application_id, 'CSF_COURSE_EDIT_BLOCKER'
  );

  -- Lock the course rows before hashing them, so the revision this correction
  -- is checked against cannot move underneath it.
  PERFORM 1
  FROM plugin_data.csf_application_course_entries AS course
  WHERE course.organization_id = p_organization_id
    AND course.application_id = p_application_id
  FOR UPDATE;

  v_revision := plugin_data.csf_application_course_revision(
    p_organization_id, p_application_id
  );
  IF v_revision IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'These course lines changed since you opened them. Reload the application and redo the correction.',
      DETAIL = 'CSF_COURSE_EDIT_BLOCKER=stale_revision';
  END IF;

  -- Announce the officer path to the overwrite guard, naming the exact
  -- application. A delete on any other application in the same transaction is
  -- still refused.
  PERFORM pg_catalog.set_config(
    'plugin_data.csf_course_correction_application',
    p_application_id::text,
    true
  );

  FOR v_operation IN
    SELECT value FROM pg_catalog.jsonb_array_elements(p_operations)
  LOOP
    IF pg_catalog.jsonb_typeof(v_operation) <> 'object' THEN
      RAISE EXCEPTION 'Each course change must be an object.';
    END IF;
    v_op := nullif(pg_catalog.btrim(coalesce(v_operation ->> 'op', '')), '');
    IF v_op IS NULL OR v_op NOT IN ('add', 'update', 'remove') THEN
      RAISE EXCEPTION 'A course change must be add, update, or remove.';
    END IF;

    IF v_op = 'add' THEN
      v_after := plugin_data.csf_normalize_application_course_values(
        v_operation -> 'values', '{}'::jsonb
      );
      INSERT INTO plugin_data.csf_application_course_entries (
        organization_id, application_id, course_list, course_name,
        grade, points, is_bonus, raw_line,
        origin, officer_corrected_at, officer_corrected_by
      ) VALUES (
        p_organization_id, p_application_id,
        v_after ->> 'courseList',
        v_after ->> 'courseName',
        v_after ->> 'grade',
        (v_after ->> 'points')::numeric(5, 2),
        coalesce((v_after ->> 'isBonus')::boolean, false),
        NULL,
        'officer', v_now, p_actor_user_id
      ) RETURNING id INTO v_new_id;

      INSERT INTO plugin_data.csf_application_course_corrections (
        organization_id, application_id, course_entry_id,
        source_course_entry_id, operation, before_values, after_values,
        imported_values, reason, actor_user_id, correlation_id
      ) VALUES (
        p_organization_id, p_application_id, v_new_id,
        NULL, 'added', '{}'::jsonb, v_after,
        NULL, v_reason, p_actor_user_id, p_request_id
      );
      v_added := v_added + 1;
      v_receipts := v_receipts || pg_catalog.jsonb_build_object(
        'operation', 'added', 'courseEntryId', v_new_id, 'after', v_after
      );
      CONTINUE;
    END IF;

    -- update and remove both name an existing row.
    BEGIN
      v_target_id := nullif(pg_catalog.btrim(coalesce(v_operation ->> 'courseEntryId', '')), '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'That course line identifier is not valid.';
    END;
    IF v_target_id IS NULL THEN
      RAISE EXCEPTION 'Name the course line to correct.';
    END IF;
    IF v_target_id = ANY (v_target_ids) THEN
      RAISE EXCEPTION 'The same course line was corrected twice in one request.';
    END IF;
    v_target_ids := pg_catalog.array_append(v_target_ids, v_target_id);

    SELECT course.*
    INTO v_course
    FROM plugin_data.csf_application_course_entries AS course
    WHERE course.organization_id = p_organization_id
      AND course.application_id = p_application_id
      AND course.id = v_target_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'no_data_found',
        MESSAGE = 'That course line is not on this application.';
    END IF;

    v_before := plugin_data.csf_application_course_values(v_course);
    -- Freeze the imported original the first time an officer touches the row.
    v_imported := CASE
      WHEN v_course.origin = 'officer' THEN NULL
      ELSE coalesce(v_course.imported_values, v_before)
    END;

    IF v_op = 'remove' THEN
      DELETE FROM plugin_data.csf_application_course_entries AS course
      WHERE course.organization_id = p_organization_id
        AND course.id = v_target_id;

      INSERT INTO plugin_data.csf_application_course_corrections (
        organization_id, application_id, course_entry_id,
        source_course_entry_id, operation, before_values, after_values,
        imported_values, reason, actor_user_id, correlation_id
      ) VALUES (
        p_organization_id, p_application_id, NULL,
        v_target_id, 'removed', v_before, '{}'::jsonb,
        v_imported, v_reason, p_actor_user_id, p_request_id
      );
      v_removed := v_removed + 1;
      v_receipts := v_receipts || pg_catalog.jsonb_build_object(
        'operation', 'removed', 'courseEntryId', v_target_id, 'before', v_before
      );
      CONTINUE;
    END IF;

    v_after := plugin_data.csf_normalize_application_course_values(
      v_operation -> 'values', v_before
    );
    IF v_after IS NOT DISTINCT FROM v_before THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'That course line already holds those values. Nothing was changed.',
        DETAIL = 'CSF_COURSE_EDIT_BLOCKER=no_change';
    END IF;

    UPDATE plugin_data.csf_application_course_entries AS course
    SET
      course_list = v_after ->> 'courseList',
      course_name = v_after ->> 'courseName',
      grade = v_after ->> 'grade',
      points = (v_after ->> 'points')::numeric(5, 2),
      is_bonus = coalesce((v_after ->> 'isBonus')::boolean, false),
      imported_values = coalesce(course.imported_values, v_imported),
      officer_corrected_at = v_now,
      officer_corrected_by = p_actor_user_id
    WHERE course.organization_id = p_organization_id
      AND course.id = v_target_id;

    INSERT INTO plugin_data.csf_application_course_corrections (
      organization_id, application_id, course_entry_id,
      source_course_entry_id, operation, before_values, after_values,
      imported_values, reason, actor_user_id, correlation_id
    ) VALUES (
      p_organization_id, p_application_id, v_target_id,
      v_target_id, 'updated', v_before, v_after,
      v_imported, v_reason, p_actor_user_id, p_request_id
    );
    v_updated := v_updated + 1;
    v_receipts := v_receipts || pg_catalog.jsonb_build_object(
      'operation', 'updated', 'courseEntryId', v_target_id,
      'before', v_before, 'after', v_after
    );
  END LOOP;

  SELECT pg_catalog.count(*)
  INTO v_total
  FROM plugin_data.csf_application_course_entries AS course
  WHERE course.organization_id = p_organization_id
    AND course.application_id = p_application_id;
  IF v_total > 40 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'An application can hold at most 40 course lines.',
      DETAIL = 'CSF_COURSE_EDIT_BLOCKER=too_many_courses';
  END IF;

  UPDATE plugin_data.csf_term_applications AS application
  SET
    courses_corrected_at = v_now,
    courses_corrected_by = p_actor_user_id,
    updated_at = v_now
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id;

  v_revision := plugin_data.csf_application_course_revision(
    p_organization_id, p_application_id
  );

  -- Hand the guard back. The setting is transaction-local, and a caller's
  -- transaction can outlive this call, so leaving it set would quietly exempt
  -- a later write in the same transaction.
  PERFORM pg_catalog.set_config(
    'plugin_data.csf_course_correction_application', '', true
  );

  -- Identifiers, course values, and the officer's own reason. No other student
  -- attribute travels in the receipt.
  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'application.courses_edited',
    'csf_term_applications',
    p_application_id,
    v_application.term_id,
    pg_catalog.jsonb_build_object(
      'revision', v_expected,
      'eligibilityStatus', v_application.eligibility_status
    ),
    pg_catalog.jsonb_build_object(
      'revision', v_revision,
      'operations', v_receipts,
      'addedCount', v_added,
      'updatedCount', v_updated,
      'removedCount', v_removed,
      'courseCount', v_total,
      -- Unchanged by this action, and recorded as such. Course lines feed the
      -- policy recalculation, so the stored verdict is now stale and the
      -- existing derivation reports it; this editor asserts no verdict.
      'eligibilityStatus', v_application.eligibility_status,
      'eligibilityInputsChanged', true,
      'reason', v_reason,
      'requestFingerprint', v_fingerprint
    ),
    p_request_id,
    'application_course_edit_request',
    p_request_id::text,
    'officer_course_correction'
  );

  RETURN pg_catalog.jsonb_build_object(
    'applicationId', p_application_id,
    'correlationId', p_request_id,
    'revision', v_revision,
    'addedCount', v_added,
    'updatedCount', v_updated,
    'removedCount', v_removed,
    'courseCount', v_total,
    'eligibilityInputsChanged', true,
    'idempotent', false
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_edit_application_courses_locked_impl(
  uuid, uuid, jsonb, text, text, uuid, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_edit_application_courses_locked_impl(
  uuid, uuid, jsonb, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_edit_application_courses_locked_impl(
  uuid, uuid, jsonb, text, text, uuid, uuid
) TO postgres;

COMMENT ON FUNCTION plugin_data.csf_edit_application_courses_locked_impl(
  uuid, uuid, jsonb, text, text, uuid, uuid
) IS
  'Owner-only bounded application course editor retained behind csf_edit_application_courses; direct client and service-role execution is revoked.';

-- ===========================================================================
-- 9. Restoring the imported course lines
--
-- The exit from a source conflict, and the undo for a correction an officer
-- decides was wrong. It re-reads the immutable snapshot the commit stored on
-- the application and writes nothing of its own.
-- ===========================================================================

CREATE OR REPLACE FUNCTION plugin_data.csf_restore_application_courses_locked_impl(
  p_organization_id uuid,
  p_application_id uuid,
  p_reason text,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_intent jsonb;
  v_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_source jsonb;
  v_course jsonb;
  v_values jsonb;
  v_before jsonb;
  v_restored integer := 0;
  v_restored_id uuid;
  v_discarded integer := 0;
  v_revision text;
  v_expected text;
  v_now timestamptz := pg_catalog.now();
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable course restore request identifier is required.';
  END IF;
  IF v_reason IS NULL OR pg_catalog.length(v_reason) < 8 THEN
    RAISE EXCEPTION 'Explain the restore in at least 8 characters.';
  END IF;
  IF pg_catalog.length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Keep the restore reason under 500 characters.';
  END IF;

  v_intent := pg_catalog.jsonb_build_object(
    'applicationId', p_application_id,
    'reason', v_reason
  );
  v_fingerprint := plugin_data.csf_application_course_editor_request_fingerprint(
    p_organization_id, p_application_id, p_actor_user_id,
    'application.courses_restore', v_intent
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_application_course_edit_request:'
        || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'application_course_restore_request'
  ORDER BY audit.created_at, audit.id
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'application.courses_restored'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_term_applications'
      OR v_receipt.target_id IS DISTINCT FROM p_application_id
      OR v_receipt.after_data ->> 'requestFingerprint'
        IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'That course restore request identifier is already bound to a different change.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'applicationId', p_application_id,
      'correlationId', p_request_id,
      'revision', v_receipt.after_data ->> 'revision',
      'restoredCount', coalesce((v_receipt.after_data ->> 'restoredCount')::integer, 0),
      'discardedCount', coalesce((v_receipt.after_data ->> 'discardedCount')::integer, 0),
      'eligibilityInputsChanged', true,
      'idempotent', true
    );
  END IF;

  v_application := plugin_data.csf_assert_application_record_correctable(
    p_organization_id, p_application_id, 'CSF_COURSE_RESTORE_BLOCKER'
  );

  IF v_application.courses_corrected_at IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'No officer correction is recorded on these course lines.',
      DETAIL = 'CSF_COURSE_RESTORE_BLOCKER=no_corrections';
  END IF;

  -- The immutable snapshot the import commit stored. This function reads it and
  -- never writes it.
  v_source := v_application.application_data -> 'normalizedImport' -> 'courses';
  IF v_source IS NULL OR pg_catalog.jsonb_typeof(v_source) <> 'array' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'This application carries no imported course snapshot to restore.',
      DETAIL = 'CSF_COURSE_RESTORE_BLOCKER=no_imported_source';
  END IF;

  PERFORM 1
  FROM plugin_data.csf_application_course_entries AS course
  WHERE course.organization_id = p_organization_id
    AND course.application_id = p_application_id
  FOR UPDATE;

  v_expected := plugin_data.csf_application_course_revision(
    p_organization_id, p_application_id
  );

  PERFORM pg_catalog.set_config(
    'plugin_data.csf_course_correction_application',
    p_application_id::text,
    true
  );

  -- One receipt per discarded row, so what the restore threw away stays
  -- readable next to what it put back.
  FOR v_before IN
    SELECT plugin_data.csf_application_course_values(course)
    FROM plugin_data.csf_application_course_entries AS course
    WHERE course.organization_id = p_organization_id
      AND course.application_id = p_application_id
    ORDER BY course.id
  LOOP
    v_discarded := v_discarded + 1;
    INSERT INTO plugin_data.csf_application_course_corrections (
      organization_id, application_id, course_entry_id,
      source_course_entry_id, operation, before_values, after_values,
      imported_values, reason, actor_user_id, correlation_id
    ) VALUES (
      p_organization_id, p_application_id, NULL,
      NULL, 'removed', v_before, '{}'::jsonb,
      NULL, v_reason, p_actor_user_id, p_request_id
    );
  END LOOP;

  DELETE FROM plugin_data.csf_application_course_entries AS course
  WHERE course.organization_id = p_organization_id
    AND course.application_id = p_application_id;

  FOR v_course IN SELECT value FROM pg_catalog.jsonb_array_elements(v_source)
  LOOP
    -- Same shape and same refusals the import commit applies, so a snapshot the
    -- commit would have rejected cannot enter through the restore.
    v_values := plugin_data.csf_normalize_application_course_values(
      pg_catalog.jsonb_build_object(
        'courseList', v_course ->> 'courseList',
        'courseName', v_course ->> 'courseName',
        'grade', v_course ->> 'grade',
        'points', v_course ->> 'points',
        'isBonus', pg_catalog.to_jsonb(
          coalesce((v_course ->> 'isBonus')::boolean, false)
        )
      ),
      '{}'::jsonb
    );
    INSERT INTO plugin_data.csf_application_course_entries (
      organization_id, application_id, course_list, course_name,
      grade, points, is_bonus, raw_line, origin
    ) VALUES (
      p_organization_id, p_application_id,
      v_values ->> 'courseList',
      v_values ->> 'courseName',
      v_values ->> 'grade',
      (v_values ->> 'points')::numeric(5, 2),
      coalesce((v_values ->> 'isBonus')::boolean, false),
      nullif(pg_catalog.btrim(coalesce(v_course ->> 'rawLine', '')), ''),
      'import'
    ) RETURNING id INTO v_restored_id;
    v_restored := v_restored + 1;
    INSERT INTO plugin_data.csf_application_course_corrections (
      organization_id, application_id, course_entry_id,
      source_course_entry_id, operation, before_values, after_values,
      imported_values, reason, actor_user_id, correlation_id
    ) VALUES (
      p_organization_id, p_application_id, v_restored_id,
      NULL, 'restored', '{}'::jsonb, v_values,
      v_values, v_reason, p_actor_user_id, p_request_id
    );
  END LOOP;

  UPDATE plugin_data.csf_term_applications AS application
  SET
    courses_corrected_at = NULL,
    courses_corrected_by = NULL,
    updated_at = v_now
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id;

  v_revision := plugin_data.csf_application_course_revision(
    p_organization_id, p_application_id
  );

  PERFORM pg_catalog.set_config(
    'plugin_data.csf_course_correction_application', '', true
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'application.courses_restored',
    'csf_term_applications',
    p_application_id,
    v_application.term_id,
    pg_catalog.jsonb_build_object(
      'revision', v_expected,
      'correctedAt', v_application.courses_corrected_at,
      'eligibilityStatus', v_application.eligibility_status
    ),
    pg_catalog.jsonb_build_object(
      'revision', v_revision,
      'restoredCount', v_restored,
      'discardedCount', v_discarded,
      'eligibilityStatus', v_application.eligibility_status,
      'eligibilityInputsChanged', true,
      'reason', v_reason,
      'requestFingerprint', v_fingerprint
    ),
    p_request_id,
    'application_course_restore_request',
    p_request_id::text,
    'officer_course_correction_restore'
  );

  RETURN pg_catalog.jsonb_build_object(
    'applicationId', p_application_id,
    'correlationId', p_request_id,
    'revision', v_revision,
    'restoredCount', v_restored,
    'discardedCount', v_discarded,
    'eligibilityInputsChanged', true,
    'idempotent', false
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_restore_application_courses_locked_impl(
  uuid, uuid, text, uuid, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_restore_application_courses_locked_impl(
  uuid, uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_restore_application_courses_locked_impl(
  uuid, uuid, text, uuid, uuid
) TO postgres;

-- ===========================================================================
-- 10. The service signatures (V128 lock order)
--
-- Authorization, then the shared organization staff-access lock, then the
-- actor's active host membership row FOR SHARE, then the recheck, and only then
-- the implementation's own request and row locks. A queued correction whose
-- role edit, position revocation, or host-membership change committed first is
-- refused with zero writes.
-- ===========================================================================

CREATE OR REPLACE FUNCTION plugin_data.csf_edit_application_courses(
  p_organization_id uuid,
  p_application_id uuid,
  p_operations jsonb,
  p_expected_revision text,
  p_reason text,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_membership_user_id uuid;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id, p_actor_user_id, 'edit_application_records'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to correct CSF application records.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  SELECT member.user_id
  INTO v_actor_membership_user_id
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
    AND member.status = 'active'
  FOR SHARE;
  IF NOT FOUND OR v_actor_membership_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized to correct CSF application records.';
  END IF;

  IF plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'edit_application_records'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to correct CSF application records.';
  END IF;

  RETURN plugin_data.csf_edit_application_courses_locked_impl(
    p_organization_id, p_application_id, p_operations, p_expected_revision,
    p_reason, p_actor_user_id, p_request_id
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_edit_application_courses(
  uuid, uuid, jsonb, text, text, uuid, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_edit_application_courses(
  uuid, uuid, jsonb, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_edit_application_courses(
  uuid, uuid, jsonb, text, text, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_edit_application_courses(
  uuid, uuid, jsonb, text, text, uuid, uuid
) IS
  'Authorized officer correction of CSF application course lines. Refuses a published decision, a finalized membership, a closed semester, a stale revision, an unknown course field, and a no-op; writes no eligibility verdict, no decision, and no imported source snapshot.';

CREATE OR REPLACE FUNCTION plugin_data.csf_restore_application_courses(
  p_organization_id uuid,
  p_application_id uuid,
  p_reason text,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_membership_user_id uuid;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id, p_actor_user_id, 'edit_application_records'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to correct CSF application records.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  SELECT member.user_id
  INTO v_actor_membership_user_id
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
    AND member.status = 'active'
  FOR SHARE;
  IF NOT FOUND OR v_actor_membership_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized to correct CSF application records.';
  END IF;

  IF plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'edit_application_records'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to correct CSF application records.';
  END IF;

  RETURN plugin_data.csf_restore_application_courses_locked_impl(
    p_organization_id, p_application_id, p_reason, p_actor_user_id, p_request_id
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_restore_application_courses(
  uuid, uuid, text, uuid, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_restore_application_courses(
  uuid, uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_restore_application_courses(
  uuid, uuid, text, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_restore_application_courses(
  uuid, uuid, text, uuid, uuid
) IS
  'Restores an application''s course lines from the immutable imported snapshot, clearing the officer-correction marker so a source re-import can proceed. Audited and replay-safe.';

COMMIT;
