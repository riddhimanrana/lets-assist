-- Retire the graduated classes of 2024, 2025 and 2026 from the CSF product.
--
-- Read the name carefully: retire, not delete. The chapter asked for those
-- classes to be deleted, and this is as close as the schema honestly allows.
-- What it is not is whole-database erasure of those students, and section 0
-- says exactly what is left behind and why.
--
-- Three facts shape the design.
--
--   1. The immutable references to a CSF profile are declared ON DELETE SET
--      NULL, not RESTRICT -- `csf_admin_audit_events.actor_profile_id`,
--      `csf_sheet_import_rows.matched_profile_id`,
--      `csf_sheet_import_rows.matched_application_id`. A delete does not fail
--      loudly. It quietly rewrites immutable evidence and then trips the
--      import provenance guard with SQLSTATE 55000 somewhere in the middle.
--   2. Those import rows are the provenance for everything ever committed for
--      these students (V46, V125), and they hold the raw source snapshot --
--      names and addresses as typed in the chapter workbook.
--   3. A CSF semester is chapter-wide. A 2026 student's records may sit in a
--      semester that a 2027 student also uses. Ownership is per record, by
--      profile; it is never inferred from the semester.
--
-- ---------------------------------------------------------------------------
-- 0. What is erased, and what is knowingly kept
-- ---------------------------------------------------------------------------
--
-- Erased: every operational record owned by an eligible profile, and every
-- identifying column on the profile row and on any application row that has to
-- stay. Section B enumerates those columns in a table the database checks
-- against its own catalog, so a column added later fails the gate instead of
-- being silently left behind.
--
-- Kept, deliberately, and this is the limitation:
--
--   * `csf_sheet_import_rows.raw_data` and `normalized_data` -- the immutable
--     source snapshot. It contains the student's name and address as the
--     chapter typed them. It is the provenance for every committed record and
--     V46/V125 make it immutable. It is not touched here.
--   * `csf_admin_audit_events` -- immutable receipts, including actor
--     references to these profiles.
--   * `csf_profile_merge_reviews` and the merge consolidation tables.
--   * `csf_communication_recipient_snapshots` -- frozen audiences (V117).
--   * Every `auth.users` login, `organization_members` row, staff position,
--     and every Google file.
--
-- So: after this runs, the CSF product holds no roster, no membership, no
-- points, no attendance and no identity for these students, and the immutable
-- evidence layer still holds their names. That is operational retirement. If
-- the chapter needs the source snapshots gone too, that is separate work with
-- a different blast radius, and it is not what this migration does.
--
-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------
--
-- No trigger is disabled. Some of these semesters are closed and some are
-- open -- as of this writing S24, F24, S25, F25 and S26 are all open in
-- Production -- so the commit does not assume either. Where a closed semester
-- is involved it uses the one reviewed way past
-- `csf_guard_term_evidence_write`: `plugin_data.csf_closed_term_edit_attested()`
-- from 20260916055000, a transaction-local flag no client role can set, raised
-- only after the actor is authorized, and the receipt records whether any
-- closed semester was in scope.
--
-- Nobody gets mail about this. The personal-notice lane in 20260917080000
-- reads `app.csf_suppress_notices` and records nothing while it is on, so the
-- commit sets it before any write and calls that migration's own
-- `csf_suppress_publication_notices()` where it is present. Its profile
-- trigger would also return early on `record_status <> 'active'`, but that is
-- a happy accident of ordering and this does not rely on it.
--
-- Re-import cannot bring these students back, and the refusal is not by name.
-- A retired class cannot take a member, and an import row whose immutable
-- fingerprint was retired cannot be committed into a retired class again. A
-- current student who shares a name with an erased one is unaffected, and so
-- is a source row that merely happens to sit at the same spreadsheet position.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Retention state
--
-- None of these tables carries a foreign key to `csf_profiles`. A receipt has
-- to outlive the row it is about, and a new profile foreign key would oblige
-- the merge catalog (V124) to classify it -- a merge should never rewrite a
-- retention receipt.
-- ---------------------------------------------------------------------------

CREATE TABLE plugin_data.csf_retention_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  graduation_years integer[] NOT NULL
    CHECK (pg_catalog.cardinality(graduation_years) BETWEEN 1 AND 8),
  state text NOT NULL DEFAULT 'sealed' CHECK (state IN ('sealed', 'committed')),
  profile_digest text NOT NULL CHECK (pg_catalog.length(profile_digest) = 64),
  eligible_profile_count integer NOT NULL CHECK (eligible_profile_count >= 0),
  blocked_profile_count integer NOT NULL CHECK (blocked_profile_count >= 0),
  coverage_gaps jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(coverage_gaps) = 'array'),
  reason text NOT NULL
    CHECK (pg_catalog.length(pg_catalog.btrim(reason)) BETWEEN 10 AND 500),
  sealed_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  committed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  commit_request_id uuid,
  committed_counts jsonb,
  CONSTRAINT csf_retention_runs_request_key UNIQUE (organization_id, request_id),
  CONSTRAINT csf_retention_runs_commit_shape CHECK (
    (state = 'sealed'
      AND committed_at IS NULL AND committed_counts IS NULL AND commit_request_id IS NULL)
    OR (state = 'committed'
      AND committed_at IS NOT NULL AND committed_counts IS NOT NULL AND commit_request_id IS NOT NULL)
  )
);

CREATE INDEX csf_retention_runs_org_state_idx
  ON plugin_data.csf_retention_runs (organization_id, state, sealed_at DESC);

CREATE TABLE plugin_data.csf_retention_preview_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES plugin_data.csf_retention_runs(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL,
  cohort_id uuid NOT NULL,
  graduation_year integer NOT NULL,
  disposition text NOT NULL
    CHECK (disposition IN ('erase_and_delete', 'erase_in_place', 'blocked')),
  blockers text[] NOT NULL DEFAULT ARRAY[]::text[],
  retained_reference_count integer NOT NULL DEFAULT 0
    CHECK (retained_reference_count >= 0),
  CONSTRAINT csf_retention_preview_profile_key UNIQUE (run_id, profile_id),
  CONSTRAINT csf_retention_preview_blocked_shape CHECK (
    (disposition = 'blocked') = (pg_catalog.cardinality(blockers) > 0)
  )
);

CREATE INDEX csf_retention_preview_profiles_run_idx
  ON plugin_data.csf_retention_preview_profiles (run_id, disposition);

-- A retired class can never take a member again. That is what stops a
-- re-import of the old class workbook from rebuilding the class, and it says
-- nothing whatsoever about any other class.
CREATE TABLE plugin_data.csf_retention_retired_cohorts (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cohort_id uuid NOT NULL REFERENCES plugin_data.csf_cohorts(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES plugin_data.csf_retention_runs(id) ON DELETE RESTRICT,
  graduation_year integer NOT NULL,
  retired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, cohort_id)
);

-- The retired source rows, identified by the immutable content fingerprint the
-- importer already computes -- not by where the row sat in the sheet. A moved
-- row carries its fingerprint with it; an unrelated student who later lands on
-- row 41 of the same tab does not.
CREATE TABLE plugin_data.csf_retention_source_tombstones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES plugin_data.csf_retention_runs(id) ON DELETE RESTRICT,
  source_id uuid,
  row_hash text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(row_hash)) > 0),
  sheet_tab_name text,
  row_number integer CHECK (row_number IS NULL OR row_number > 0),
  retired_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_retention_source_tombstone_key
    UNIQUE NULLS NOT DISTINCT (organization_id, source_id, row_hash)
);

CREATE TABLE plugin_data.csf_retention_profile_tombstones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES plugin_data.csf_retention_runs(id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL,
  cohort_id uuid NOT NULL,
  graduation_year integer NOT NULL,
  disposition text NOT NULL
    CHECK (disposition IN ('erase_and_delete', 'erase_in_place')),
  deleted_row_counts jsonb NOT NULL CHECK (jsonb_typeof(deleted_row_counts) = 'object'),
  retained_references jsonb NOT NULL CHECK (jsonb_typeof(retained_references) = 'object'),
  erased_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_retention_profile_tombstone_key UNIQUE (organization_id, profile_id)
);

ALTER TABLE plugin_data.csf_retention_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_retention_preview_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_retention_retired_cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_retention_source_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_retention_profile_tombstones ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  plugin_data.csf_retention_runs,
  plugin_data.csf_retention_preview_profiles,
  plugin_data.csf_retention_retired_cohorts,
  plugin_data.csf_retention_source_tombstones,
  plugin_data.csf_retention_profile_tombstones
  FROM PUBLIC, anon, authenticated, service_role;

-- A sealed preview is evidence. Only the sealed -> committed transition on the
-- run is allowed, and only from inside the commit function.
CREATE FUNCTION plugin_data.csf_guard_retention_evidence_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- One trigger function guards four tables, and only one of them has a
  -- `state` column. PL/pgSQL resolves a record field when it compiles the
  -- expression, not when the branch is reached, so naming OLD.state here would
  -- raise 42703 on the other three. Compare through jsonb instead, which also
  -- lets DELETE run without touching NEW at all.
  v_old jsonb := pg_catalog.to_jsonb(OLD);
  v_new jsonb;
  v_mutable constant text[] := ARRAY[
    'state', 'committed_at', 'committed_by', 'commit_request_id', 'committed_counts'
  ];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_new := pg_catalog.to_jsonb(NEW);
  END IF;

  -- The one permitted transition: sealed to committed, with the five commit
  -- columns filled in and every other column identical.
  IF TG_TABLE_NAME = 'csf_retention_runs'
    AND TG_OP = 'UPDATE'
    AND v_old ->> 'state' = 'sealed'
    AND v_new ->> 'state' = 'committed'
    AND v_old - v_mutable = v_new - v_mutable THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'CSF retention evidence is immutable.',
    DETAIL = 'CSF_RETENTION_EVIDENCE_IMMUTABLE=' || TG_TABLE_NAME,
    HINT = 'Open a new preview instead of editing a sealed one.';
END;
$$;

CREATE TRIGGER csf_retention_runs_immutable
  BEFORE UPDATE OR DELETE ON plugin_data.csf_retention_runs
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_retention_evidence_immutable();

CREATE TRIGGER csf_retention_preview_profiles_immutable
  BEFORE UPDATE OR DELETE ON plugin_data.csf_retention_preview_profiles
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_retention_evidence_immutable();

CREATE TRIGGER csf_retention_profile_tombstones_immutable
  BEFORE UPDATE OR DELETE ON plugin_data.csf_retention_profile_tombstones
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_retention_evidence_immutable();

CREATE TRIGGER csf_retention_source_tombstones_immutable
  BEFORE UPDATE OR DELETE ON plugin_data.csf_retention_source_tombstones
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_retention_evidence_immutable();

-- The profile row survives as a tombstone, so `record_status` needs a word for
-- it. `merged` means "this student is somewhere else"; erased means "this
-- student is nowhere, on purpose".
ALTER TABLE plugin_data.csf_profiles
  DROP CONSTRAINT IF EXISTS csf_profiles_record_status_check;

ALTER TABLE plugin_data.csf_profiles
  ADD CONSTRAINT csf_profiles_record_status_check
  CHECK (record_status IN ('active', 'merged', 'retention_erased'));

-- The merge-state check pairs `record_status` with the merge columns, so it
-- has to learn the third state too. An erased row keeps whatever merge lineage
-- it already had -- that is a relationship between two keys, not a student
-- attribute -- and loses the officer's merge reason, which is free text about
-- a person.
ALTER TABLE plugin_data.csf_profiles
  DROP CONSTRAINT IF EXISTS csf_profiles_merge_state_check;

ALTER TABLE plugin_data.csf_profiles
  ADD CONSTRAINT csf_profiles_merge_state_check CHECK (
    (
      record_status = 'active'
      AND merged_into_profile_id IS NULL
      AND merged_at IS NULL
      AND merged_by IS NULL
      AND merge_reason IS NULL
    )
    OR (
      record_status = 'merged'
      AND merged_into_profile_id IS NOT NULL
      AND merged_into_profile_id <> id
      AND merged_at IS NOT NULL
      AND merged_by IS NOT NULL
      AND nullif(btrim(merge_reason), '') IS NOT NULL
    )
    OR (
      record_status = 'retention_erased'
      AND merge_reason IS NULL
      AND (merged_into_profile_id IS NULL OR merged_into_profile_id <> id)
    )
  );

-- A transaction-local marker that a retirement run is underway, for other CSF
-- code that needs to tell bulk retirement apart from an officer edit. This
-- operation's own guards deliberately do not consult it -- see section G --
-- and it is not the notice switch either: that is `app.csf_suppress_notices`,
-- owned by 20260917080000, which the commit sets rather than inventing a
-- parallel mechanism.
CREATE FUNCTION plugin_data.csf_retention_in_progress()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    pg_catalog.current_setting('plugin_data.csf_retention_in_progress', true),
    'off'
  ) = 'on';
$$;

COMMENT ON FUNCTION plugin_data.csf_retention_in_progress() IS
  'True only inside a transaction running the CSF graduated-cohort retention commit. Per-row notification and digest triggers must suppress themselves while it is true.';

-- ---------------------------------------------------------------------------
-- B. Identifying columns, enumerated rather than remembered
--
-- Two tables can still be holding a student attribute after this operation
-- runs: the profile row, which is kept as a tombstone whenever immutable
-- evidence points at it, and an application row that an import row names
-- directly. Every column of both is classified here, and the database checks
-- the list against its own catalog. A column added by a later migration is an
-- unclassified column, and an unclassified column blocks the run.
-- ---------------------------------------------------------------------------

CREATE TABLE plugin_data.csf_retention_identity_inventory (
  table_name text NOT NULL,
  column_name text NOT NULL,
  treatment text NOT NULL CHECK (treatment IN (
    'erase',        -- carries a student attribute; overwritten or nulled
    'structural',   -- keys, timestamps, enums; carries no student attribute
    'decision',     -- chapter decision state kept as the record of what was decided
    'provenance'    -- points into the immutable evidence layer; preserved deliberately
  )),
  note text NOT NULL,
  PRIMARY KEY (table_name, column_name)
);

ALTER TABLE plugin_data.csf_retention_identity_inventory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_retention_identity_inventory
  FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO plugin_data.csf_retention_identity_inventory
  (table_name, column_name, treatment, note)
VALUES
  ('csf_profiles', 'id', 'structural', 'the key immutable evidence still points at'),
  ('csf_profiles', 'organization_id', 'structural', 'tenant'),
  ('csf_profiles', 'first_name', 'erase', 'name'),
  ('csf_profiles', 'middle_name', 'erase', 'name'),
  ('csf_profiles', 'last_name', 'erase', 'name'),
  ('csf_profiles', 'preferred_name', 'erase', 'name'),
  ('csf_profiles', 'nicknames', 'erase', 'name'),
  ('csf_profiles', 'school_email', 'erase', 'address'),
  ('csf_profiles', 'personal_email', 'erase', 'address'),
  ('csf_profiles', 'normalized_first_name', 'erase', 'name'),
  ('csf_profiles', 'normalized_last_name', 'erase', 'name'),
  ('csf_profiles', 'normalized_school_email', 'erase', 'address'),
  ('csf_profiles', 'normalized_personal_email', 'erase', 'address'),
  ('csf_profiles', 'reported_application_school_email', 'erase', 'address reported on an application'),
  ('csf_profiles', 'reported_application_personal_email', 'erase', 'address reported on an application'),
  ('csf_profiles', 'privacy_flags', 'erase', 'per-student settings'),
  ('csf_profiles', 'source_summary', 'erase', 'may quote source cells'),
  ('csf_profiles', 'merge_reason', 'erase', 'officer free text about this student'),
  ('csf_profiles', 'record_status', 'structural', 'set to retention_erased'),
  ('csf_profiles', 'merged_into_profile_id', 'structural', 'merge lineage between profile keys'),
  ('csf_profiles', 'merged_at', 'structural', 'merge lineage timestamp'),
  ('csf_profiles', 'merged_by', 'structural', 'the officer who merged, not the student'),
  ('csf_profiles', 'created_at', 'structural', 'row timestamp'),
  ('csf_profiles', 'updated_at', 'structural', 'row timestamp'),

  ('csf_term_applications', 'id', 'structural', 'the key an import row may name'),
  ('csf_term_applications', 'organization_id', 'structural', 'tenant'),
  ('csf_term_applications', 'profile_id', 'structural', 'points at the erased profile'),
  ('csf_term_applications', 'cohort_id', 'structural', 'retired class'),
  ('csf_term_applications', 'term_id', 'structural', 'chapter semester, shared'),
  ('csf_term_applications', 'source', 'structural', 'enum'),
  ('csf_term_applications', 'google_form_response_id', 'erase', 'identifies the student''s form response'),
  ('csf_term_applications', 'source_url', 'erase', 'may address the student''s response'),
  -- The application's own pointers into the immutable evidence layer: which
  -- import job and row produced it, where in the sheet, and when the source was
  -- last modified. They name coordinates, not a person, and on an application
  -- that has to stay they are the only remaining account of where it came
  -- from. Blanking them would leave a record with no lineage, which is the
  -- opposite of what V46 and V125 are for. An application that is deleted takes
  -- them with it; the import row's own reference is unaffected either way.
  ('csf_term_applications', 'source_row_id', 'provenance', 'legacy source row key'),
  ('csf_term_applications', 'source_import_job_id', 'provenance', 'the import job that committed this application'),
  ('csf_term_applications', 'source_import_row_id', 'provenance', 'the immutable import row this application came from'),
  ('csf_term_applications', 'source_row_number', 'provenance', 'the sheet row it was read from'),
  ('csf_term_applications', 'source_modified_at', 'provenance', 'when the source file was last modified'),
  ('csf_term_applications', 'source_submitted_at', 'provenance', 'when the source recorded the submission'),
  ('csf_term_applications', 'source_file_id', 'provenance', 'the Drive file it was read from'),
  ('csf_term_applications', 'source_file_name', 'provenance', 'the Drive file it was read from'),
  ('csf_term_applications', 'source_sheet_tab', 'provenance', 'the tab it was read from'),
  ('csf_term_applications', 'status', 'decision', 'what the chapter decided'),
  ('csf_term_applications', 'submission_status', 'decision', 'what the chapter decided'),
  ('csf_term_applications', 'decision_status', 'decision', 'what the chapter decided'),
  ('csf_term_applications', 'decision_reason_code', 'decision', 'typed decision reason'),
  ('csf_term_applications', 'decision_reason', 'erase', 'officer free text that may name the student'),
  ('csf_term_applications', 'decision_correlation_id', 'structural', 'replay key'),
  ('csf_term_applications', 'eligibility_status', 'decision', 'derived eligibility'),
  ('csf_term_applications', 'current_grade_level', 'erase', 'student attribute'),
  ('csf_term_applications', 'returning_status', 'erase', 'student attribute'),
  ('csf_term_applications', 'shirt_size', 'erase', 'student attribute'),
  ('csf_term_applications', 'most_checked_email', 'erase', 'address'),
  ('csf_term_applications', 'list_i_points', 'erase', 'student academic record'),
  ('csf_term_applications', 'list_i_ii_points', 'erase', 'student academic record'),
  ('csf_term_applications', 'grand_total_points', 'erase', 'student academic record'),
  ('csf_term_applications', 'social_confirmation', 'erase', 'student answer'),
  ('csf_term_applications', 'application_data', 'erase', 'the raw application responses'),
  ('csf_term_applications', 'review_notes', 'erase', 'officer free text about the student'),
  ('csf_term_applications', 'reviewed_by', 'structural', 'the officer who reviewed'),
  ('csf_term_applications', 'reviewed_at', 'structural', 'timestamp'),
  ('csf_term_applications', 'assigned_to', 'structural', 'the officer assigned'),
  ('csf_term_applications', 'assigned_by', 'structural', 'the officer who assigned'),
  ('csf_term_applications', 'assigned_at', 'structural', 'timestamp'),
  ('csf_term_applications', 'submitted_at', 'structural', 'timestamp'),
  ('csf_term_applications', 'created_at', 'structural', 'row timestamp'),
  ('csf_term_applications', 'updated_at', 'structural', 'row timestamp');

CREATE FUNCTION plugin_data.csf_retention_identity_coverage_gaps()
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
    AND rel.relname IN ('csf_profiles', 'csf_term_applications')
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

COMMENT ON FUNCTION plugin_data.csf_retention_identity_coverage_gaps() IS
  'Owner-internal. Columns of the two tables retention may leave in place that the identity inventory does not classify. A non-empty result blocks preview and commit.';

-- ---------------------------------------------------------------------------
-- C. Which references this operation understands
--
-- Same idea, for foreign keys. The policy table classifies edges; the coverage
-- function reads the live catalog and reports every edge into an owned table
-- the policy does not mention.
-- ---------------------------------------------------------------------------

CREATE TABLE plugin_data.csf_retention_reference_policy (
  parent_table text NOT NULL,
  child_table text NOT NULL,
  child_column text NOT NULL,
  policy text NOT NULL CHECK (policy IN (
    'delete_with_owner',   -- the child row is part of what is being erased
    'retain_immutable',    -- the child row stays; it is why the parent may not be deleted
    'blocker'              -- the child row means this profile is not ours to erase
  )),
  note text NOT NULL,
  PRIMARY KEY (child_table, child_column, parent_table)
);

ALTER TABLE plugin_data.csf_retention_reference_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_retention_reference_policy
  FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO plugin_data.csf_retention_reference_policy
  (parent_table, child_table, child_column, policy, note)
VALUES
  ('csf_profiles', 'csf_profile_cohort_memberships', 'profile_id', 'delete_with_owner', 'class membership'),
  ('csf_profiles', 'csf_profile_accounts', 'profile_id', 'delete_with_owner', 'the CSF link only; the login account is untouched'),
  ('csf_profiles', 'csf_profile_notes', 'profile_id', 'delete_with_owner', 'officer notes about the student'),
  ('csf_profiles', 'csf_profile_restrictions', 'profile_id', 'delete_with_owner', 'restriction records'),
  ('csf_profiles', 'csf_profile_activity_events', 'profile_id', 'delete_with_owner', 'member activity feed'),
  ('csf_profiles', 'csf_profile_link_requests', 'matched_profile_id', 'delete_with_owner', 'connection requests naming this profile'),
  ('csf_profiles', 'csf_communication_broadcast_preferences', 'profile_id', 'delete_with_owner', 'current email preferences'),
  ('csf_profiles', 'csf_member_reports', 'profile_id', 'delete_with_owner', 'generated member report rows'),
  ('csf_profiles', 'csf_reviewed_workbook_profile_links', 'profile_id', 'delete_with_owner', 'reviewed workbook link'),
  ('csf_profiles', 'csf_application_correction_requests', 'profile_id', 'delete_with_owner', 'member correction requests'),
  ('csf_profiles', 'csf_term_applications', 'profile_id', 'delete_with_owner', 'application, unless an import row names it; then scrubbed in place'),
  ('csf_profiles', 'csf_term_memberships', 'profile_id', 'delete_with_owner', 'semester membership'),
  ('csf_profiles', 'csf_term_membership_outcomes', 'profile_id', 'delete_with_owner', 'semester outcome'),
  ('csf_profiles', 'csf_point_submissions', 'profile_id', 'delete_with_owner', 'point claims'),
  ('csf_profiles', 'csf_point_appeals', 'profile_id', 'delete_with_owner', 'point appeals'),
  ('csf_profiles', 'csf_credit_records', 'profile_id', 'delete_with_owner', 'awarded credit ledger'),
  ('csf_profiles', 'csf_dues_records', 'profile_id', 'delete_with_owner', 'dues records'),
  ('csf_profiles', 'csf_meeting_attendance', 'profile_id', 'delete_with_owner', 'meeting attendance'),
  ('csf_profiles', 'csf_opportunity_signups', 'profile_id', 'delete_with_owner', 'service signups'),
  ('csf_profiles', 'csf_application_files', 'profile_id', 'delete_with_owner', 'application files; objects go to the storage deletion queue'),
  ('csf_profiles', 'csf_submission_files', 'profile_id', 'delete_with_owner', 'proof files; objects go to the storage deletion queue'),
  ('csf_profiles', 'csf_application_decision_stages', 'profile_id', 'delete_with_owner', 'staged Sheet decision'),
  ('csf_profiles', 'csf_profiles', 'merged_into_profile_id', 'retain_immutable', 'a prior merge tombstone points here under ON DELETE RESTRICT; the lineage stays and forces erase-in-place'),
  ('csf_profiles', 'csf_admin_audit_events', 'actor_profile_id', 'retain_immutable', 'immutable actor snapshot'),
  ('csf_profiles', 'csf_profile_merge_reviews', 'source_profile_id', 'retain_immutable', 'immutable merge decision'),
  ('csf_profiles', 'csf_profile_merge_reviews', 'target_profile_id', 'retain_immutable', 'immutable merge decision'),
  ('csf_profiles', 'csf_profile_merge_term_membership_consolidations', 'source_profile_id', 'retain_immutable', 'immutable merge consolidation'),
  ('csf_profiles', 'csf_profile_merge_term_membership_consolidations', 'target_profile_id', 'retain_immutable', 'immutable merge consolidation'),
  ('csf_profiles', 'csf_profile_merge_meeting_attendance_consolidations', 'source_profile_id', 'retain_immutable', 'immutable merge consolidation'),
  ('csf_profiles', 'csf_profile_merge_meeting_attendance_consolidations', 'target_profile_id', 'retain_immutable', 'immutable merge consolidation'),
  ('csf_profiles', 'csf_communication_recipient_snapshots', 'profile_id', 'retain_immutable', 'frozen campaign audience (V117)'),
  ('csf_profiles', 'csf_partner_submission_rows', 'profile_id', 'retain_immutable', 'immutable partner source row'),
  ('csf_profiles', 'csf_sheet_import_rows', 'matched_profile_id', 'retain_immutable', 'immutable import provenance (V46, V125)'),
  ('csf_profiles', 'csf_sheet_import_rows', 'commit_target_profile_id', 'retain_immutable', 'immutable commit lineage (V125)'),
  ('csf_profiles', 'csf_staff_positions', 'profile_id', 'blocker', 'a chapter officer is not an ordinary roster record'),

  ('csf_term_applications', 'csf_application_course_entries', 'application_id', 'delete_with_owner', 'course evidence'),
  ('csf_term_applications', 'csf_application_checks', 'application_id', 'delete_with_owner', 'typed eligibility checks'),
  ('csf_term_applications', 'csf_application_private_notes', 'application_id', 'delete_with_owner', 'private reviewer notes'),
  ('csf_term_applications', 'csf_application_status_events', 'application_id', 'delete_with_owner', 'status history'),
  ('csf_term_applications', 'csf_application_files', 'application_id', 'delete_with_owner', 'attached files'),
  ('csf_term_applications', 'csf_application_correction_requests', 'application_id', 'delete_with_owner', 'correction requests'),
  ('csf_term_applications', 'csf_application_decision_stages', 'application_id', 'delete_with_owner', 'staged decision'),
  ('csf_term_applications', 'csf_term_memberships', 'application_id', 'delete_with_owner', 'membership created from the application'),
  ('csf_term_applications', 'csf_sheet_import_rows', 'matched_application_id', 'retain_immutable', 'immutable import provenance (V46)'),
  ('csf_term_applications', 'csf_application_decision_sync_rows', 'application_id', 'retain_immutable', 'published decision lineage'),

  ('csf_point_submissions', 'csf_submission_files', 'submission_id', 'delete_with_owner', 'proof files'),
  ('csf_point_submissions', 'csf_submission_reviews', 'submission_id', 'delete_with_owner', 'point review'),
  ('csf_point_submissions', 'csf_credit_records', 'submission_id', 'delete_with_owner', 'awarded credit'),
  ('csf_point_submissions', 'csf_point_appeals', 'submission_id', 'delete_with_owner', 'appeal'),
  ('csf_point_submissions', 'csf_partner_submission_rows', 'generated_submission_id', 'retain_immutable', 'immutable partner source row'),

  ('csf_term_applications', 'csf_sheet_writeback_ledger', 'application_id', 'delete_with_owner', 'queued Sheet write-backs quote the decision and the row; they go with the record'),
  -- Dues are already deleted by profile. The application reference is the same
  -- student's row seen from the other side, so it has the same policy rather
  -- than a second one.
  ('csf_term_applications', 'csf_dues_records', 'application_id', 'delete_with_owner', 'the same student''s dues record, reached through their application'),
  -- Outcomes are deleted by profile before their membership goes, so this edge
  -- never cascades; classifying it says so out loud.
  ('csf_term_memberships', 'csf_term_membership_outcomes', 'membership_id', 'delete_with_owner', 'the same student''s semester outcome, reached through their membership'),

  ('csf_submission_files', 'csf_storage_deletion_queue', 'submission_file_id', 'delete_with_owner', 'the queue row outlives the file row by design'),
  ('csf_term_memberships', 'csf_term_closures', 'membership_id', 'blocker', 'a closure snapshot pointer is chapter evidence, not a student record');

-- Every live foreign key into a table this operation owns that the policy does
-- not classify. Empty is the only acceptable answer.
--
-- `unnest(conkey, confkey)` is multi-argument unnest, which is a FROM-clause
-- construct and cannot be schema-qualified. Two ordinality-paired unnests say
-- the same thing and replay anywhere.
CREATE FUNCTION plugin_data.csf_retention_reference_coverage_gaps()
RETURNS TABLE (child_table text, child_column text, parent_table text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    child_rel.relname::text,
    child_att.attname::text,
    parent_rel.relname::text
  FROM pg_catalog.pg_constraint AS fk
  JOIN pg_catalog.pg_class AS child_rel ON child_rel.oid = fk.conrelid
  JOIN pg_catalog.pg_class AS parent_rel ON parent_rel.oid = fk.confrelid
  JOIN pg_catalog.pg_namespace AS child_ns ON child_ns.oid = child_rel.relnamespace
  JOIN pg_catalog.pg_namespace AS parent_ns ON parent_ns.oid = parent_rel.relnamespace
  CROSS JOIN LATERAL pg_catalog.unnest(fk.conkey) WITH ORDINALITY AS child_key(attnum, ord)
  CROSS JOIN LATERAL pg_catalog.unnest(fk.confkey) WITH ORDINALITY AS parent_key(attnum, ord)
  JOIN pg_catalog.pg_attribute AS child_att
    ON child_att.attrelid = fk.conrelid AND child_att.attnum = child_key.attnum
  JOIN pg_catalog.pg_attribute AS parent_att
    ON parent_att.attrelid = fk.confrelid AND parent_att.attnum = parent_key.attnum
  WHERE fk.contype = 'f'
    AND child_key.ord = parent_key.ord
    AND child_ns.nspname = 'plugin_data'
    AND parent_ns.nspname = 'plugin_data'
    AND parent_att.attname = 'id'
    AND parent_rel.relname IN (
      SELECT DISTINCT policy_row.parent_table
      FROM plugin_data.csf_retention_reference_policy AS policy_row
    )
    AND NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_retention_reference_policy AS policy_row
      WHERE policy_row.parent_table = parent_rel.relname
        AND policy_row.child_table = child_rel.relname
        AND policy_row.child_column = child_att.attname
    )
  ORDER BY 1, 2, 3
$$;

COMMENT ON FUNCTION plugin_data.csf_retention_reference_coverage_gaps() IS
  'Owner-internal. Live foreign keys into retention-owned CSF tables that the retention reference policy does not classify. A non-empty result blocks preview and commit.';

-- ---------------------------------------------------------------------------
-- D. Who is exclusively 2024-2026
--
-- Exclusivity is a property of the student, not of the semester. A CSF
-- semester is chapter-wide: a retiring student's records routinely sit in a
-- semester that a continuing student also uses, and that is not shared
-- ownership -- each row names one profile. So the scope is every record owned
-- by an eligible profile, in any semester, and the semester rows themselves
-- and every other student's rows are untouched.
--
-- What does disqualify a student: a class membership outside the retiring
-- years, service as an officer, unresolved import lineage, an open connection
-- request, or a live Sheet export still bound to their records.
-- ---------------------------------------------------------------------------

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
AS $$
  WITH target_cohort AS (
    SELECT cohort.id, cohort.graduation_year
    FROM plugin_data.csf_cohorts AS cohort
    WHERE cohort.organization_id = p_organization_id
      AND cohort.graduation_year = ANY (p_graduation_years)
  ),
  candidate AS (
    SELECT DISTINCT ON (membership.profile_id)
      membership.profile_id,
      membership.cohort_id,
      cohort.graduation_year
    FROM plugin_data.csf_profile_cohort_memberships AS membership
    JOIN target_cohort AS cohort ON cohort.id = membership.cohort_id
    WHERE membership.organization_id = p_organization_id
    ORDER BY membership.profile_id, cohort.graduation_year
  )
  SELECT
    candidate.profile_id,
    candidate.cohort_id,
    candidate.graduation_year,
    pg_catalog.array_remove(ARRAY[
      CASE WHEN EXISTS (
        SELECT 1
        FROM plugin_data.csf_profile_cohort_memberships AS other
        WHERE other.organization_id = p_organization_id
          AND other.profile_id = candidate.profile_id
          AND other.cohort_id NOT IN (SELECT id FROM target_cohort)
      ) THEN 'also_belongs_to_a_class_that_is_staying' END,
      CASE WHEN EXISTS (
        SELECT 1
        FROM plugin_data.csf_staff_positions AS position
        WHERE position.organization_id = p_organization_id
          AND position.profile_id = candidate.profile_id
      ) THEN 'held_a_staff_position' END,
      CASE WHEN EXISTS (
        SELECT 1
        FROM plugin_data.csf_sheet_import_rows AS import_row
        WHERE import_row.organization_id = p_organization_id
          AND (
            import_row.matched_profile_id = candidate.profile_id
            OR import_row.commit_target_profile_id = candidate.profile_id
          )
          AND plugin_data.csf_profile_merge_import_row_disposition(
            import_row.commit_frozen_at,
            import_row.commit_target_profile_id,
            import_row.matched_profile_id,
            import_row.commit_attempt_id,
            import_row.commit_retry_count,
            import_row.commit_outcome_state,
            import_row.import_status,
            import_row.commit_outcome_resolution
          ) = 'preflight_blocker'
      ) THEN 'import_lineage_is_unresolved' END,
      CASE WHEN EXISTS (
        SELECT 1
        FROM plugin_data.csf_profile_link_requests AS request
        WHERE request.organization_id = p_organization_id
          AND request.matched_profile_id = candidate.profile_id
          AND request.match_status IN ('pending', 'needs_review')
      ) THEN 'has_an_open_connection_request' END,
      CASE WHEN EXISTS (
        SELECT 1
        FROM plugin_data.csf_sheet_sync_bindings AS binding
        JOIN plugin_data.csf_sheet_sync_destinations AS destination
          ON destination.organization_id = binding.organization_id
          AND destination.id = binding.destination_id
          AND destination.enabled
        WHERE binding.organization_id = p_organization_id
          AND binding.profile_id = candidate.profile_id
      ) THEN 'an_enabled_sheet_destination_still_exports_this_record' END
    ], NULL),
    (
      SELECT pg_catalog.count(*)::integer
      FROM plugin_data.csf_sheet_import_rows AS import_row
      WHERE import_row.organization_id = p_organization_id
        AND (
          import_row.matched_profile_id = candidate.profile_id
          OR import_row.commit_target_profile_id = candidate.profile_id
        )
    )
    + (
      -- An import row that names only the application still pins this student:
      -- deleting the profile cascades into the application and nulls the
      -- provenance. Counting it here forces erase-in-place.
      SELECT pg_catalog.count(*)::integer
      FROM plugin_data.csf_sheet_import_rows AS import_row
      JOIN plugin_data.csf_term_applications AS application
        ON application.organization_id = import_row.organization_id
        AND application.id = import_row.matched_application_id
      WHERE import_row.organization_id = p_organization_id
        AND application.profile_id = candidate.profile_id
    )
    + (
      -- A prior merge tombstone points here under ON DELETE RESTRICT. Deleting
      -- would raise a foreign key violation, so count it and erase in place.
      SELECT pg_catalog.count(*)::integer
      FROM plugin_data.csf_profiles AS merged_away
      WHERE merged_away.organization_id = p_organization_id
        AND merged_away.id <> candidate.profile_id
        AND merged_away.merged_into_profile_id = candidate.profile_id
    )
    + (
      SELECT pg_catalog.count(*)::integer
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.actor_profile_id = candidate.profile_id
    )
    + (
      SELECT pg_catalog.count(*)::integer
      FROM plugin_data.csf_profile_merge_reviews AS review
      WHERE review.organization_id = p_organization_id
        AND (
          review.source_profile_id = candidate.profile_id
          OR review.target_profile_id = candidate.profile_id
        )
    )
    + (
      SELECT pg_catalog.count(*)::integer
      FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
      WHERE snapshot.organization_id = p_organization_id
        AND snapshot.profile_id = candidate.profile_id
    )
  FROM candidate
$$;

COMMENT ON FUNCTION plugin_data.csf_retention_candidates(uuid, integer[]) IS
  'Owner-internal. Profiles whose class membership falls in the given graduation years, the reasons any of them cannot be erased, and the count of immutable references that force a tombstone.';

CREATE FUNCTION plugin_data.csf_retention_disposition(
  p_blockers text[],
  p_retained_reference_count integer
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN pg_catalog.cardinality(p_blockers) > 0 THEN 'blocked'
    WHEN p_retained_reference_count > 0 THEN 'erase_in_place'
    ELSE 'erase_and_delete'
  END
$$;

CREATE FUNCTION plugin_data.csf_retention_profile_set_digest(p_profile_ids uuid[])
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(
      coalesce(
        (
          SELECT pg_catalog.string_agg(sorted_id::text, ',' ORDER BY sorted_id)
          FROM pg_catalog.unnest(p_profile_ids) AS sorted_id
        ),
        ''
      ),
      'sha256'
    ),
    'hex'
  )
$$;

-- ---------------------------------------------------------------------------
-- E. Preview
-- ---------------------------------------------------------------------------

-- Display metadata only. Every count the caller sees is derived from the
-- stored preview rows, never accepted from the caller (V126).
CREATE FUNCTION plugin_data.csf_retention_run_summary(p_run_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'runId', run.id,
    'state', run.state,
    'graduationYears', pg_catalog.to_jsonb(run.graduation_years),
    'profileDigest', run.profile_digest,
    'sealedAt', run.sealed_at,
    'committedAt', run.committed_at,
    'coverageGaps', run.coverage_gaps,
    'counts', (
      SELECT coalesce(pg_catalog.jsonb_object_agg(preview.disposition, preview.total), '{}'::jsonb)
      FROM (
        SELECT stored.disposition, pg_catalog.count(*) AS total
        FROM plugin_data.csf_retention_preview_profiles AS stored
        WHERE stored.run_id = run.id
        GROUP BY stored.disposition
      ) AS preview
    ),
    'blockers', (
      SELECT coalesce(pg_catalog.jsonb_object_agg(blocked.blocker, blocked.total), '{}'::jsonb)
      FROM (
        SELECT pg_catalog.unnest(stored.blockers) AS blocker, pg_catalog.count(*) AS total
        FROM plugin_data.csf_retention_preview_profiles AS stored
        WHERE stored.run_id = run.id
        GROUP BY 1
      ) AS blocked
    ),
    'committedCounts', run.committed_counts
  )
  FROM plugin_data.csf_retention_runs AS run
  WHERE run.id = p_run_id
$$;

CREATE FUNCTION plugin_data.csf_retention_preview(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_graduation_years integer[],
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run plugin_data.csf_retention_runs%ROWTYPE;
  v_gaps jsonb;
  v_eligible integer;
  v_blocked integer;
  v_digest text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  PERFORM 1
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
    AND member.status = 'active'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized.' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_profiles')
    AND plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_settings')
  ) THEN
    RAISE EXCEPTION 'Not authorized.' USING ERRCODE = '42501';
  END IF;

  SELECT existing.* INTO v_run
  FROM plugin_data.csf_retention_runs AS existing
  WHERE existing.organization_id = p_organization_id
    AND existing.request_id = p_request_id;

  IF FOUND THEN
    IF v_run.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_run.graduation_years IS DISTINCT FROM p_graduation_years THEN
      RAISE EXCEPTION 'This request ID was already used for a different retention preview.'
        USING ERRCODE = '55000';
    END IF;
    RETURN plugin_data.csf_retention_run_summary(v_run.id);
  END IF;

  SELECT coalesce(pg_catalog.jsonb_agg(gap.entry ORDER BY gap.entry::text), '[]'::jsonb)
  INTO v_gaps
  FROM (
    SELECT pg_catalog.jsonb_build_object(
      'kind', 'foreignKey',
      'childTable', reference_gap.child_table,
      'childColumn', reference_gap.child_column,
      'parentTable', reference_gap.parent_table
    ) AS entry
    FROM plugin_data.csf_retention_reference_coverage_gaps() AS reference_gap
    UNION ALL
    SELECT pg_catalog.jsonb_build_object(
      'kind', 'identityColumn',
      'table', identity_gap.table_name,
      'column', identity_gap.column_name
    )
    FROM plugin_data.csf_retention_identity_coverage_gaps() AS identity_gap
  ) AS gap;

  -- `csf_retention_candidates` is STABLE, so the second call below sees the
  -- same snapshot as this one.
  SELECT
    pg_catalog.count(*) FILTER (WHERE pg_catalog.cardinality(scratch.blockers) = 0)::integer,
    pg_catalog.count(*) FILTER (WHERE pg_catalog.cardinality(scratch.blockers) > 0)::integer,
    plugin_data.csf_retention_profile_set_digest(
      coalesce(
        pg_catalog.array_agg(scratch.profile_id)
          FILTER (WHERE pg_catalog.cardinality(scratch.blockers) = 0),
        ARRAY[]::uuid[]
      )
    )
  INTO v_eligible, v_blocked, v_digest
  FROM plugin_data.csf_retention_candidates(p_organization_id, p_graduation_years) AS scratch;

  INSERT INTO plugin_data.csf_retention_runs (
    organization_id, request_id, actor_user_id, graduation_years,
    profile_digest, eligible_profile_count, blocked_profile_count,
    coverage_gaps, reason
  )
  VALUES (
    p_organization_id, p_request_id, p_actor_user_id, p_graduation_years,
    v_digest, v_eligible, v_blocked, v_gaps, p_reason
  )
  RETURNING * INTO v_run;

  INSERT INTO plugin_data.csf_retention_preview_profiles (
    organization_id, run_id, profile_id, cohort_id, graduation_year,
    disposition, blockers, retained_reference_count
  )
  SELECT
    p_organization_id,
    v_run.id,
    scratch.profile_id,
    scratch.cohort_id,
    scratch.graduation_year,
    plugin_data.csf_retention_disposition(scratch.blockers, scratch.retained_reference_count),
    scratch.blockers,
    scratch.retained_reference_count
  FROM plugin_data.csf_retention_candidates(p_organization_id, p_graduation_years) AS scratch;

  RETURN plugin_data.csf_retention_run_summary(v_run.id);
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_retention_preview(uuid, uuid, uuid, integer[], text) IS
  'Owner-internal. Seals one immutable CSF graduated-cohort retention preview for the exact graduation years given, and returns derived counts and blockers. Mutates no student record.';

-- ---------------------------------------------------------------------------
-- F. Commit
--
-- Not a "delete class of 2024" button. The caller brings the sealed preview,
-- the digest, the years and the exact profile ids it showed an officer. The
-- commit recomputes eligibility from the live database under lock and requires
-- the fresh eligible set to equal the sealed set exactly -- in both
-- directions, so a profile that has since moved to a current class or vanished
-- from the candidate list aborts the run rather than being skipped. Every
-- disposition and reference count used below is the fresh one.
-- ---------------------------------------------------------------------------

-- The per-profile deletion, kept separate so the commit reads as a sequence of
-- decisions rather than a wall of DELETEs. Children first, then the rows that
-- own them, and nothing outside this one student's records.
CREATE FUNCTION plugin_data.csf_retention_delete_owned_records(
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
  -- stay for provenance must not keep its course evidence, checks, notes or
  -- status history.
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

  -- The application is the one operational row an import row can name directly
  -- (`matched_application_id`, ON DELETE SET NULL). Deleting such a row would
  -- rewrite immutable provenance, so it stays -- and because it stays, every
  -- column of it that carries a student attribute is overwritten here. The
  -- inventory in section B is what decides which those are.
  DELETE FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.profile_id = p_profile_id
    AND NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_sheet_import_rows AS import_row
      WHERE import_row.organization_id = p_organization_id
        AND import_row.matched_application_id = application.id
    );
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

CREATE FUNCTION plugin_data.csf_retention_commit(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_run_id uuid,
  p_profile_digest text,
  p_graduation_years integer[],
  p_profile_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run plugin_data.csf_retention_runs%ROWTYPE;
  v_counts jsonb := '{}'::jsonb;
  v_gap_count integer;
  v_sealed uuid[];
  v_fresh uuid[];
  v_profile_id uuid;
  v_deleted jsonb;
  v_retained integer;
  v_blockers text[];
  v_disposition text;
  v_cohort_id uuid;
  v_graduation_year integer;
  v_closed_terms integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  PERFORM 1
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
    AND member.status = 'active'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized.' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_profiles')
    AND plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_settings')
  ) THEN
    RAISE EXCEPTION 'Not authorized.' USING ERRCODE = '42501';
  END IF;

  -- The profile-identity lock the merge path takes, for the same reason: no
  -- concurrent merge, class-code join or import may be rewriting these rows.
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);

  SELECT run.* INTO v_run
  FROM plugin_data.csf_retention_runs AS run
  WHERE run.id = p_run_id
    AND run.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That retention preview does not belong to this organization.'
      USING ERRCODE = '55000';
  END IF;

  -- Bind the whole payload before anything else. An exact replay of the same
  -- committed intent returns the original receipt; a request that differs in
  -- actor, years, digest or profile set is a different intent and is refused,
  -- committed or not (V116).
  IF v_run.graduation_years IS DISTINCT FROM p_graduation_years
    OR v_run.profile_digest IS DISTINCT FROM p_profile_digest
    OR plugin_data.csf_retention_profile_set_digest(p_profile_ids)
       IS DISTINCT FROM v_run.profile_digest THEN
    RAISE EXCEPTION 'The retention request does not match its sealed preview.'
      USING ERRCODE = '55000';
  END IF;

  IF v_run.state = 'committed' THEN
    IF v_run.commit_request_id IS DISTINCT FROM p_request_id
      OR v_run.committed_by IS DISTINCT FROM p_actor_user_id THEN
      RAISE EXCEPTION 'This retention preview was already committed by a different request.'
        USING ERRCODE = '55000';
    END IF;
    RETURN plugin_data.csf_retention_run_summary(v_run.id);
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_gap_count
  FROM (
    SELECT 1 FROM plugin_data.csf_retention_reference_coverage_gaps()
    UNION ALL
    SELECT 1 FROM plugin_data.csf_retention_identity_coverage_gaps()
  ) AS gap;

  IF v_gap_count > 0 OR pg_catalog.jsonb_array_length(v_run.coverage_gaps) > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'A CSF record or column is not classified by this retention operation.',
      DETAIL = 'CSF_RETENTION_UNCLASSIFIED=' || v_gap_count::text,
      HINT = 'Classify it in csf_retention_reference_policy or csf_retention_identity_inventory before erasing anything.';
  END IF;

  SELECT coalesce(pg_catalog.array_agg(preview.profile_id ORDER BY preview.profile_id), ARRAY[]::uuid[])
  INTO v_sealed
  FROM plugin_data.csf_retention_preview_profiles AS preview
  WHERE preview.run_id = v_run.id
    AND preview.disposition <> 'blocked';

  IF plugin_data.csf_retention_profile_set_digest(v_sealed)
    IS DISTINCT FROM v_run.profile_digest THEN
    RAISE EXCEPTION 'The sealed preview no longer describes its own profile set.'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.cardinality(v_sealed) = 0 THEN
    RAISE EXCEPTION 'This preview has nothing to erase.' USING ERRCODE = '55000';
  END IF;

  -- The fresh eligible set, recomputed now, under lock. Set equality in both
  -- directions: a profile that has left the candidate list -- moved to a
  -- current class, merged away, deleted -- fails here instead of being passed
  -- over by a join.
  SELECT coalesce(pg_catalog.array_agg(fresh.profile_id ORDER BY fresh.profile_id), ARRAY[]::uuid[])
  INTO v_fresh
  FROM plugin_data.csf_retention_candidates(p_organization_id, p_graduation_years) AS fresh
  WHERE pg_catalog.cardinality(fresh.blockers) = 0;

  IF plugin_data.csf_retention_profile_set_digest(v_fresh)
    IS DISTINCT FROM v_run.profile_digest THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'The eligible set has changed since this preview was sealed.',
      DETAIL = 'CSF_RETENTION_SCOPE_DRIFT sealed=' || pg_catalog.cardinality(v_sealed)::text
        || ' fresh=' || pg_catalog.cardinality(v_fresh)::text,
      HINT = 'Take a fresh preview and have an officer confirm it.';
  END IF;

  -- Some of these semesters are closed and some are open. Raise the reviewed
  -- attestation either way, after authorization, and record what was actually
  -- in scope. No trigger is disabled.
  SELECT pg_catalog.count(DISTINCT term.id)::integer INTO v_closed_terms
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.lifecycle_status IN ('closed', 'archived')
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_term_memberships AS membership
      WHERE membership.organization_id = p_organization_id
        AND membership.term_id = term.id
        AND membership.profile_id = ANY(v_sealed)
    );

  PERFORM pg_catalog.set_config('plugin_data.csf_closed_term_edit_attested', 'on', true);
  PERFORM pg_catalog.set_config('plugin_data.csf_retention_in_progress', 'on', true);

  -- Retiring 543 students must not become 543 emails. 20260917080000 already
  -- built the lane for exactly this -- its own comment names retention -- so
  -- use it rather than a second mechanism: `csf_suppress_publication_notices()`
  -- sets `app.csf_suppress_notices` for this transaction, and
  -- `csf_record_personal_notification` then records nothing at all, so there is
  -- no queued notice for a later worker to find.
  --
  -- The direct set_config is the same switch, not a second one. It is here so
  -- this migration still replays in a tree that does not yet carry 080000; the
  -- flag name is the contract either way.
  PERFORM pg_catalog.set_config('app.csf_suppress_notices', 'on', true);

  IF pg_catalog.to_regprocedure('plugin_data.csf_suppress_publication_notices()') IS NOT NULL THEN
    EXECUTE 'SELECT plugin_data.csf_suppress_publication_notices()';
  END IF;

  FOREACH v_profile_id IN ARRAY v_sealed LOOP
    PERFORM 1 FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = v_profile_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A profile in this preview no longer exists. Take a fresh preview.'
        USING ERRCODE = '55000';
    END IF;

    -- Disposition and reference counts are re-derived here, after the row
    -- lock. The sealed preview decides *which* profiles; the live database
    -- decides what may be done to each of them. A missing fresh row is a
    -- failure, never an assumption of zero retained references.
    SELECT fresh.blockers, fresh.retained_reference_count, fresh.cohort_id, fresh.graduation_year
    INTO v_blockers, v_retained, v_cohort_id, v_graduation_year
    FROM plugin_data.csf_retention_candidates(p_organization_id, p_graduation_years) AS fresh
    WHERE fresh.profile_id = v_profile_id;

    IF NOT FOUND OR v_blockers IS NULL OR pg_catalog.cardinality(v_blockers) > 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'A profile in this preview is no longer eligible.',
        DETAIL = 'CSF_RETENTION_PROFILE_INELIGIBLE=' || v_profile_id::text,
        HINT = 'Take a fresh preview and have an officer confirm it.';
    END IF;

    v_disposition := plugin_data.csf_retention_disposition(v_blockers, v_retained);

    -- Proof and application objects leave through the reviewed storage queue
    -- (V27), before the file rows that name them go.
    INSERT INTO plugin_data.csf_storage_deletion_queue (organization_id, submission_file_id, bucket, object_path)
    SELECT p_organization_id, proof.id, proof.bucket, proof.object_path
    FROM plugin_data.csf_submission_files AS proof
    WHERE proof.organization_id = p_organization_id
      AND proof.profile_id = v_profile_id
    ON CONFLICT ON CONSTRAINT csf_storage_deletion_queue_bucket_path_key DO NOTHING;

    INSERT INTO plugin_data.csf_storage_deletion_queue (organization_id, bucket, object_path)
    SELECT p_organization_id, attachment.bucket, attachment.object_path
    FROM plugin_data.csf_application_files AS attachment
    WHERE attachment.organization_id = p_organization_id
      AND attachment.profile_id = v_profile_id
    ON CONFLICT ON CONSTRAINT csf_storage_deletion_queue_bucket_path_key DO NOTHING;

    -- Record the immutable fingerprint of the source rows that produced this
    -- student, before the records that link to them go. A row with no
    -- fingerprint cannot be identified without falling back to position, so it
    -- is not tombstoned at all rather than tombstoned wrongly.
    INSERT INTO plugin_data.csf_retention_source_tombstones (
      organization_id, run_id, source_id, row_hash, sheet_tab_name, row_number
    )
    SELECT DISTINCT
      p_organization_id, v_run.id, import_row.source_id, import_row.row_hash,
      import_row.sheet_tab_name, import_row.row_number
    FROM plugin_data.csf_sheet_import_rows AS import_row
    WHERE import_row.organization_id = p_organization_id
      AND import_row.row_hash IS NOT NULL
      AND pg_catalog.btrim(import_row.row_hash) <> ''
      AND (
        import_row.matched_profile_id = v_profile_id
        OR import_row.commit_target_profile_id = v_profile_id
      )
    ON CONFLICT ON CONSTRAINT csf_retention_source_tombstone_key DO NOTHING;

    v_deleted := plugin_data.csf_retention_delete_owned_records(p_organization_id, v_profile_id);

    IF v_disposition = 'erase_and_delete' THEN
      DELETE FROM plugin_data.csf_profiles AS profile
      WHERE profile.organization_id = p_organization_id
        AND profile.id = v_profile_id;
    ELSE
      -- The row stays so the immutable references keep resolving. What the row
      -- says about a person does not. Every column listed as `erase` in the
      -- identity inventory appears here.
      UPDATE plugin_data.csf_profiles AS profile
      SET first_name = 'Erased',
          middle_name = NULL,
          last_name = 'Record',
          preferred_name = NULL,
          nicknames = ARRAY[]::text[],
          school_email = NULL,
          personal_email = NULL,
          normalized_first_name = 'erased',
          normalized_last_name = 'record',
          normalized_school_email = NULL,
          normalized_personal_email = NULL,
          reported_application_school_email = NULL,
          reported_application_personal_email = NULL,
          privacy_flags = '{}'::jsonb,
          source_summary = '{}'::jsonb,
          merge_reason = NULL,
          record_status = 'retention_erased',
          updated_at = now()
      WHERE profile.organization_id = p_organization_id
        AND profile.id = v_profile_id;
    END IF;

    INSERT INTO plugin_data.csf_retention_profile_tombstones (
      organization_id, run_id, profile_id, cohort_id, graduation_year,
      disposition, deleted_row_counts, retained_references
    )
    VALUES (
      p_organization_id, v_run.id, v_profile_id, v_cohort_id, v_graduation_year,
      v_disposition, v_deleted,
      pg_catalog.jsonb_build_object('immutableReferenceCount', v_retained)
    );

    v_counts := v_counts || pg_catalog.jsonb_build_object(v_disposition,
      coalesce((v_counts ->> v_disposition)::integer, 0) + 1);
  END LOOP;

  v_counts := v_counts || pg_catalog.jsonb_build_object('closedSemestersInScope', v_closed_terms);

  INSERT INTO plugin_data.csf_retention_retired_cohorts (
    organization_id, cohort_id, run_id, graduation_year
  )
  SELECT DISTINCT p_organization_id, preview.cohort_id, v_run.id, preview.graduation_year
  FROM plugin_data.csf_retention_preview_profiles AS preview
  WHERE preview.run_id = v_run.id
    AND preview.disposition <> 'blocked'
  ON CONFLICT (organization_id, cohort_id) DO NOTHING;

  UPDATE plugin_data.csf_retention_runs AS run
  SET state = 'committed',
      committed_at = now(),
      committed_by = p_actor_user_id,
      commit_request_id = p_request_id,
      committed_counts = v_counts
  WHERE run.id = v_run.id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action,
    target_type, target_id, before_data, after_data, correlation_id, reason_code
  )
  VALUES (
    p_organization_id, p_actor_user_id, NULL, 'retention.graduated_cohorts_retired',
    'csf_retention_runs', v_run.id, '{}'::jsonb,
    pg_catalog.jsonb_build_object(
      'graduationYears', pg_catalog.to_jsonb(p_graduation_years),
      'profileDigest', v_run.profile_digest,
      'counts', v_counts,
      'reason', v_run.reason,
      'immutableEvidenceRetained', true
    ),
    p_request_id, 'graduated_cohort_retention'
  );

  RETURN plugin_data.csf_retention_run_summary(v_run.id);
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_retention_commit(uuid, uuid, uuid, uuid, text, integer[], uuid[]) IS
  'Owner-internal. Retires the CSF records of the exact profile set sealed in one retention preview, after rechecking authorization, coverage, fresh set equality and per-profile eligibility under lock. Immutable audit, merge and import evidence is retained and still holds raw identity snapshots.';

-- ---------------------------------------------------------------------------
-- G. Why this cannot come back
--
-- Two narrow refusals, neither of which knows a student's name and neither of
-- which depends on a row's position in a spreadsheet:
--
--   * a retired class can never take a new member;
--   * an import row whose immutable fingerprint was retired cannot be
--     committed into a retired class again.
--
-- A current student who shares a name with an erased one joins a live class
-- from a live source. A different student who later occupies the same sheet
-- row has a different fingerprint. Neither meets a refusal.
-- ---------------------------------------------------------------------------

CREATE FUNCTION plugin_data.csf_guard_retired_cohort_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- No exemption for the retention run itself. It deletes class memberships
  -- and never inserts one, and it retires the classes after the last profile
  -- is done, so this guard has nothing to fire on during a commit. An
  -- exemption here would instead have made the guard inert for the rest of any
  -- transaction that had run one.
  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_retention_retired_cohorts AS retired
    WHERE retired.organization_id = NEW.organization_id
      AND retired.cohort_id = NEW.cohort_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'That CSF class was retired under the chapter''s retention decision and cannot take members again.',
      DETAIL = 'CSF_RETENTION_RETIRED_COHORT=' || NEW.cohort_id::text,
      HINT = 'Choose a current class. Restoring a retired class is a separate, audited decision.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_profile_cohort_memberships_retention_guard
  BEFORE INSERT OR UPDATE OF cohort_id
  ON plugin_data.csf_profile_cohort_memberships
  FOR EACH ROW
  EXECUTE FUNCTION plugin_data.csf_guard_retired_cohort_membership();

CREATE FUNCTION plugin_data.csf_guard_retired_source_row_commit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Again no exemption for the run: retention writes no import rows, so this
  -- guard cannot obstruct it, and exempting the transaction would leave the
  -- guard switched off afterwards.
  --
  -- Only a row that is being committed matters. Staging, preview and failed
  -- rows are evidence, not resurrection.
  IF NEW.commit_target_profile_id IS NULL
    AND NEW.import_status NOT IN ('created', 'updated') THEN
    RETURN NEW;
  END IF;

  IF NEW.row_hash IS NULL OR pg_catalog.btrim(NEW.row_hash) = '' THEN
    RETURN NEW;
  END IF;

  -- Retired scope, not position: the same content fingerprint, resolved into a
  -- class this chapter retired.
  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_retention_source_tombstones AS retired
    WHERE retired.organization_id = NEW.organization_id
      AND retired.source_id IS NOT DISTINCT FROM NEW.source_id
      AND retired.row_hash = NEW.row_hash
  ) AND (
    NEW.cohort_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM plugin_data.csf_retention_retired_cohorts AS retired_cohort
      WHERE retired_cohort.organization_id = NEW.organization_id
        AND retired_cohort.cohort_id = NEW.cohort_id
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'That source row belongs to a class the chapter retired, and cannot be imported again.',
      DETAIL = 'CSF_RETENTION_RETIRED_SOURCE_ROW=' || NEW.row_hash,
      HINT = 'Import from a current class source. Reversing a retention decision is a separate, audited action.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_sheet_import_rows_retention_guard
  BEFORE INSERT OR UPDATE OF commit_target_profile_id, import_status
  ON plugin_data.csf_sheet_import_rows
  FOR EACH ROW
  EXECUTE FUNCTION plugin_data.csf_guard_retired_source_row_commit();

-- ---------------------------------------------------------------------------
-- H. Roles
--
-- Everything here is owner-internal. The two entrypoints are reachable only
-- through a service-role backend that has already authorized the officer; no
-- browser role can execute any of it, and no client can reach the helpers.
-- `csf_retention_in_progress` is readable by the trigger owner so other CSF
-- triggers can suppress themselves during a run.
-- ---------------------------------------------------------------------------

ALTER FUNCTION plugin_data.csf_guard_retention_evidence_immutable() OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_guard_retired_cohort_membership() OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_guard_retired_source_row_commit() OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_retention_in_progress() OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_retention_identity_coverage_gaps() OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_retention_reference_coverage_gaps() OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_retention_candidates(uuid, integer[]) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_retention_disposition(text[], integer) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_retention_profile_set_digest(uuid[]) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_retention_run_summary(uuid) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_retention_delete_owned_records(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_retention_preview(uuid, uuid, uuid, integer[], text) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_retention_commit(uuid, uuid, uuid, uuid, text, integer[], uuid[]) OWNER TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_guard_retention_evidence_immutable()
  FROM PUBLIC, anon, authenticated, service_role, postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_retired_cohort_membership()
  FROM PUBLIC, anon, authenticated, service_role, postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_retired_source_row_commit()
  FROM PUBLIC, anon, authenticated, service_role, postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_retention_in_progress()
  FROM PUBLIC, anon, authenticated, service_role, postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_retention_identity_coverage_gaps()
  FROM PUBLIC, anon, authenticated, service_role, postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_retention_reference_coverage_gaps()
  FROM PUBLIC, anon, authenticated, service_role, postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_retention_candidates(uuid, integer[])
  FROM PUBLIC, anon, authenticated, service_role, postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_retention_disposition(text[], integer)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_retention_profile_set_digest(uuid[])
  FROM PUBLIC, anon, authenticated, service_role, postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_retention_run_summary(uuid)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_retention_delete_owned_records(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_retention_preview(uuid, uuid, uuid, integer[], text)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_retention_commit(uuid, uuid, uuid, uuid, text, integer[], uuid[])
  FROM PUBLIC, anon, authenticated, service_role, postgres;

GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_retention_evidence_immutable() TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_retired_cohort_membership() TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_retired_source_row_commit() TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_retention_in_progress() TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_retention_identity_coverage_gaps() TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_retention_reference_coverage_gaps() TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_retention_candidates(uuid, integer[]) TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_retention_disposition(text[], integer) TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_retention_profile_set_digest(uuid[]) TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_retention_run_summary(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_retention_delete_owned_records(uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_retention_preview(uuid, uuid, uuid, integer[], text)
  TO postgres, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_retention_commit(uuid, uuid, uuid, uuid, text, integer[], uuid[])
  TO postgres, service_role;

COMMIT;
