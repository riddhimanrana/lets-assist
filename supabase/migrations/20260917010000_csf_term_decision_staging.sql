-- Private decision staging for the Sheets application review term.
--
-- This term the chapter reviews applications by colouring rows in the Google
-- Form response workbooks (there are two: the regular and the late responses).
-- A colour must not become access on its own: a sync stages it *privately*
-- until an officer with `decide_applications` releases the term. Release then
-- publishes through the existing atomic decision, so persisted application
-- state keeps governing access exactly as it does today.
--
-- Nothing in this migration writes `csf_term_applications`,
-- `csf_term_memberships`, or `public.organization_members`. The release and
-- post-release RPCs in `20260917010100_csf_application_decision_rpcs.sql` are
-- the only writers.
--
-- Naming note: the existing `csf_sheet_sync_*` family is the Sheet *export*
-- product (destinations, exported-record changes, discussion transport). This
-- is the inbound application-decision read, named `csf_application_decision_*`
-- to keep the two apart.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Per-term review source
--
-- Opt-in, per term, and deliberately inert: flipping a term to `sheet` changes
-- no application, membership, or organization-member row. A chapter that
-- already ran an in-app intake term keeps every published outcome and every
-- existing membership.
--
-- This lives on `csf_terms` rather than in a side table so every existing term
-- projection reads it for free and there is exactly one source of truth.
-- ---------------------------------------------------------------------------

ALTER TABLE plugin_data.csf_terms
  ADD COLUMN application_review_source text NOT NULL DEFAULT 'app'
    CHECK (application_review_source IN ('app', 'sheet')),
  ADD COLUMN application_review_source_set_at timestamptz,
  ADD COLUMN application_review_source_set_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Release watermark. `decisions_first_released_at` is what turns current-term
  -- member tools on for a Sheets-review term; before it the term has published
  -- nothing at all.
  ADD COLUMN decisions_first_released_at timestamptz,
  ADD COLUMN decisions_last_released_at timestamptz,
  ADD COLUMN decisions_release_count integer NOT NULL DEFAULT 0
    CHECK (decisions_release_count >= 0);

COMMENT ON COLUMN plugin_data.csf_terms.application_review_source IS
  'app = ordinary in-product review. sheet = officers decide by colouring the source workbook; decisions stage privately until csf_release_sheet_application_decisions publishes them.';

CREATE FUNCTION plugin_data.csf_term_is_sheet_review(
  p_organization_id uuid,
  p_term_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id
      AND term.id = p_term_id
      AND term.application_review_source = 'sheet'
  );
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_term_is_sheet_review(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A2. Which columns carry a decision, per source
--
-- The chapter's workbooks have no decision column in the header: the verdict is
-- the cell fill, and the explanation is a column an officer picked. That
-- mapping has to be configured per source and versioned, because a sync reads a
-- workbook at one moment and stages it at another. If the mapping moved in
-- between, the staged rows would carry obsolete column semantics.
--
-- This lives here rather than in `csf_sheet_sources.settings` because the
-- existing `csf_enforce_sheet_source_mapping_version` trigger does not count
-- an `applicationDecisionMapping` key as a mapping change, so that column's
-- version would never move and the staleness check would be worthless.
-- ---------------------------------------------------------------------------

CREATE TABLE plugin_data.csf_application_decision_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_id uuid NOT NULL,
  -- One-based column numbers inside the source's configured range.
  decision_columns integer[] NOT NULL,
  reason_columns integer[] NOT NULL DEFAULT ARRAY[]::integer[],
  reads_cell_note boolean NOT NULL DEFAULT false,
  mapping_version integer NOT NULL DEFAULT 1 CHECK (mapping_version > 0),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_id),
  CONSTRAINT csf_application_decision_mappings_source_organization_fkey
    FOREIGN KEY (source_id, organization_id)
    REFERENCES plugin_data.csf_sheet_sources (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_application_decision_mappings_has_decision_column CHECK (
    pg_catalog.array_length(decision_columns, 1) >= 1
  )
);

COMMENT ON TABLE plugin_data.csf_application_decision_mappings IS
  'Per-source decision and reason columns for Sheets application review. A source with no row here is unconfigured and reads nothing; there is no default mapping.';

-- ---------------------------------------------------------------------------
-- B. Immutable sync evidence
--
-- Three levels, because one sync reads several sources: the run, one evidence
-- row per source+tab actually read, and one evidence row per source row. Every
-- level rejects UPDATE and DELETE, so a receipt can never be rewritten to agree
-- with a later story.
-- ---------------------------------------------------------------------------

CREATE TABLE plugin_data.csf_application_decision_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Stable caller intent. A lost response replays into the same receipt instead
  -- of staging the same workbooks twice.
  request_id uuid NOT NULL,
  -- A request id is only a replay when it asks for the same thing again. The
  -- fingerprint covers the term and the exact payload, so the same id pointed
  -- at another term or another set of rows is a conflict, not a receipt.
  request_fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('completed', 'failed')),
  changed_count integer NOT NULL DEFAULT 0 CHECK (changed_count >= 0),
  unchanged_count integer NOT NULL DEFAULT 0 CHECK (unchanged_count >= 0),
  unmatched_count integer NOT NULL DEFAULT 0 CHECK (unmatched_count >= 0),
  conflict_count integer NOT NULL DEFAULT 0 CHECK (conflict_count >= 0),
  applied_count integer NOT NULL DEFAULT 0 CHECK (applied_count >= 0),
  retracted_count integer NOT NULL DEFAULT 0 CHECK (retracted_count >= 0),
  error_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, request_id),
  CONSTRAINT csf_application_decision_sync_runs_term_organization_fkey
    FOREIGN KEY (term_id, organization_id)
    REFERENCES plugin_data.csf_terms (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_application_decision_sync_runs_id_organization_id_key
    UNIQUE (id, organization_id),
  CONSTRAINT csf_application_decision_sync_runs_failure_has_error CHECK (
    status <> 'failed'
    OR nullif(btrim(coalesce(error_text, '')), '') IS NOT NULL
  )
);

CREATE INDEX csf_application_decision_sync_runs_term_idx
  ON plugin_data.csf_application_decision_sync_runs
    (organization_id, term_id, created_at DESC);

-- One row per source + tab the sync actually opened. `read_status` keeps an
-- unconfigured or unreachable source visible instead of letting the officer
-- believe both workbooks synced.
CREATE TABLE plugin_data.csf_application_decision_sync_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  source_id uuid NOT NULL,
  read_status text NOT NULL CHECK (read_status IN ('read', 'not_configured', 'unavailable')),
  message text,
  spreadsheet_file_id text NOT NULL,
  spreadsheet_title text,
  -- Drive `version` at read time. The identity fence the sync revalidated
  -- against immediately before this call.
  provider_version text,
  sheet_tab_name text NOT NULL,
  -- Numeric gid of that exact tab, so a later tab rename cannot retarget the
  -- evidence.
  sheet_tab_id bigint,
  requested_range text NOT NULL,
  content_hash text,
  mapping_version text,
  decision_columns integer[] NOT NULL DEFAULT ARRAY[]::integer[],
  reason_columns integer[] NOT NULL DEFAULT ARRAY[]::integer[],
  read_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, source_id, sheet_tab_name),
  CONSTRAINT csf_application_decision_sync_sources_run_organization_fkey
    FOREIGN KEY (run_id, organization_id)
    REFERENCES plugin_data.csf_application_decision_sync_runs (id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT csf_application_decision_sync_sources_source_organization_fkey
    FOREIGN KEY (source_id, organization_id)
    REFERENCES plugin_data.csf_sheet_sources (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_application_decision_sync_sources_id_organization_id_key
    UNIQUE (id, organization_id),
  CONSTRAINT csf_application_decision_sync_sources_read_has_evidence CHECK (
    read_status <> 'read'
    OR (content_hash IS NOT NULL AND mapping_version IS NOT NULL AND provider_version IS NOT NULL)
  )
);

CREATE TABLE plugin_data.csf_application_decision_sync_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  run_source_id uuid NOT NULL,
  -- Where the row sat in THIS read. Coordinates for the officer, never an
  -- identity: there is deliberately no `row_position` match basis below.
  observed_row_number integer NOT NULL CHECK (observed_row_number > 0),
  -- Both named bases are recorded immutable facts the database re-derives: the
  -- import row the application came from, or the Google Form response id frozen
  -- on the application at import. There is no basis meaning "same workbook" —
  -- a workbook holds every applicant, so file membership identifies nobody.
  match_basis text NOT NULL CHECK (match_basis IN (
    'import_row_provenance', 'recorded_response_id', 'unmatched'
  )),
  identity_digest text,
  decision_digest text,
  application_id uuid,
  import_row_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('changed', 'unchanged', 'unmatched', 'conflict')),
  decision text NOT NULL CHECK (decision IN (
    'accepted', 'rejected', 'rejected_with_explanation', 'unreviewed', 'conflict'
  )),
  observed_color text,
  reason text,
  previous_decision text CHECK (previous_decision IN (
    'accepted', 'rejected', 'rejected_with_explanation', 'unreviewed', 'conflict'
  )),
  previous_release_state text CHECK (previous_release_state IN ('staged', 'released')),
  block_reason text CHECK (block_reason IN (
    'missing_yellow_reason', 'unmapped_color', 'mixed_colors', 'ambiguous_match',
    'provenance_unverified', 'cross_source_conflict', 'historical_outcome',
    'term_closed', 'not_in_term', 'application_missing', 'no_import_row',
    'mapping_version_stale'
  )),
  -- True when this row changed an application that was already published.
  applied_to_released boolean NOT NULL DEFAULT false,
  -- True when this row retracted a published decision (uncolored after release).
  retracted_release boolean NOT NULL DEFAULT false,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_application_decision_sync_rows_run_organization_fkey
    FOREIGN KEY (run_id, organization_id)
    REFERENCES plugin_data.csf_application_decision_sync_runs (id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT csf_application_decision_sync_rows_source_organization_fkey
    FOREIGN KEY (run_source_id, organization_id)
    REFERENCES plugin_data.csf_application_decision_sync_sources (id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT csf_application_decision_sync_rows_application_organization_fkey
    FOREIGN KEY (application_id, organization_id)
    REFERENCES plugin_data.csf_term_applications (id, organization_id) ON DELETE SET NULL,
  CONSTRAINT csf_application_decision_sync_rows_import_row_organization_fkey
    FOREIGN KEY (import_row_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_rows (id, organization_id) ON DELETE SET NULL,
  CONSTRAINT csf_application_decision_sync_rows_unmatched_has_no_application CHECK (
    match_basis <> 'unmatched' OR application_id IS NULL
  ),
  CONSTRAINT csf_application_decision_sync_rows_unmatched_outcome CHECK (
    (match_basis = 'unmatched') = (outcome = 'unmatched')
  ),
  CONSTRAINT csf_application_decision_sync_rows_conflict_has_reason CHECK (
    outcome <> 'conflict' OR block_reason IS NOT NULL
  ),
  UNIQUE (run_source_id, observed_row_number)
);

CREATE INDEX csf_application_decision_sync_rows_application_idx
  ON plugin_data.csf_application_decision_sync_rows (organization_id, application_id)
  WHERE application_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- C. Immutable release receipts
-- ---------------------------------------------------------------------------

CREATE TABLE plugin_data.csf_application_decision_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  request_fingerprint text NOT NULL,
  released_count integer NOT NULL DEFAULT 0 CHECK (released_count >= 0),
  accepted_count integer NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  rejected_count integer NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  held_count integer NOT NULL DEFAULT 0 CHECK (held_count >= 0),
  pending_count integer NOT NULL DEFAULT 0 CHECK (pending_count >= 0),
  held jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(held) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, request_id),
  CONSTRAINT csf_application_decision_releases_term_organization_fkey
    FOREIGN KEY (term_id, organization_id)
    REFERENCES plugin_data.csf_terms (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_application_decision_releases_id_organization_id_key
    UNIQUE (id, organization_id)
);

CREATE INDEX csf_application_decision_releases_term_idx
  ON plugin_data.csf_application_decision_releases
    (organization_id, term_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- D. The staged decision itself
--
-- One row per application. `staged_*` is the private officer verdict read from
-- the workbook; `released_*` is what was actually published. They agree while a
-- row is released, because a later sync re-applies immediately, but they are
-- stored separately so the receipt can always answer "what did we publish".
--
-- `released_decision = 'unreviewed'` is a real state: the officer cleared the
-- colour after publication, so the published outcome was retracted and access
-- revoked while the row presents as unreviewed again.
-- ---------------------------------------------------------------------------

CREATE TABLE plugin_data.csf_application_decision_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES plugin_data.csf_profiles(id) ON DELETE CASCADE,
  -- The source that currently owns this application's decision. A second source
  -- claiming the same application with a different verdict is a
  -- `cross_source_conflict`, never a silent overwrite.
  source_id uuid,
  import_row_id uuid,
  observed_row_number integer CHECK (observed_row_number IS NULL OR observed_row_number > 0),
  staged_decision text NOT NULL DEFAULT 'unreviewed'
    CHECK (staged_decision IN (
      'accepted', 'rejected', 'rejected_with_explanation', 'unreviewed', 'conflict'
    )),
  staged_reason text,
  observed_color text,
  decision_digest text,
  identity_digest text,
  block_reason text CHECK (block_reason IN (
    'missing_yellow_reason', 'unmapped_color', 'mixed_colors', 'ambiguous_match',
    'provenance_unverified', 'cross_source_conflict', 'historical_outcome',
    'term_closed', 'mapping_version_stale'
  )),
  -- Terminal staged verdict. This is the Done/Not-done split the Applications
  -- list sorts and filters on.
  is_done boolean GENERATED ALWAYS AS (
    staged_decision IN ('accepted', 'rejected', 'rejected_with_explanation')
  ) STORED,
  -- Row-local releasability. A yellow row with no explanation blocks itself;
  -- so does any conflicting or unmapped colour. Term-level and membership-level
  -- blockers are derived at release time, not stored here.
  blocks_release boolean GENERATED ALWAYS AS (
    staged_decision = 'conflict'
    OR block_reason IS NOT NULL
    OR (
      staged_decision = 'rejected_with_explanation'
      AND nullif(btrim(coalesce(staged_reason, '')), '') IS NULL
    )
  ) STORED,
  first_staged_at timestamptz NOT NULL DEFAULT now(),
  last_staged_at timestamptz NOT NULL DEFAULT now(),
  last_sync_run_id uuid,
  release_state text NOT NULL DEFAULT 'staged'
    CHECK (release_state IN ('staged', 'released')),
  released_decision text CHECK (released_decision IN ('accepted', 'rejected', 'unreviewed')),
  released_reason text,
  released_at timestamptz,
  released_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  release_id uuid,
  -- Set when a post-release sync re-applied a changed verdict to a published
  -- row, so the officer view can name the last consequential update.
  last_applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, application_id),
  CONSTRAINT csf_application_decision_stages_application_organization_fkey
    FOREIGN KEY (application_id, organization_id)
    REFERENCES plugin_data.csf_term_applications (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_application_decision_stages_term_organization_fkey
    FOREIGN KEY (term_id, organization_id)
    REFERENCES plugin_data.csf_terms (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_application_decision_stages_profile_organization_fkey
    FOREIGN KEY (profile_id, organization_id)
    REFERENCES plugin_data.csf_profiles (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_application_decision_stages_source_organization_fkey
    FOREIGN KEY (source_id, organization_id)
    REFERENCES plugin_data.csf_sheet_sources (id, organization_id) ON DELETE SET NULL,
  CONSTRAINT csf_application_decision_stages_import_row_organization_fkey
    FOREIGN KEY (import_row_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_rows (id, organization_id) ON DELETE SET NULL,
  CONSTRAINT csf_application_decision_stages_run_organization_fkey
    FOREIGN KEY (last_sync_run_id, organization_id)
    REFERENCES plugin_data.csf_application_decision_sync_runs (id, organization_id)
    ON DELETE SET NULL,
  CONSTRAINT csf_application_decision_stages_release_organization_fkey
    FOREIGN KEY (release_id, organization_id)
    REFERENCES plugin_data.csf_application_decision_releases (id, organization_id)
    ON DELETE SET NULL,
  CONSTRAINT csf_application_decision_stages_released_is_complete CHECK (
    (release_state = 'staged'
      AND released_decision IS NULL
      AND released_at IS NULL
      AND release_id IS NULL)
    OR
    (release_state = 'released'
      AND released_decision IS NOT NULL
      AND released_at IS NOT NULL
      AND release_id IS NOT NULL)
  )
);

CREATE INDEX csf_application_decision_stages_term_idx
  ON plugin_data.csf_application_decision_stages
    (organization_id, term_id, release_state, staged_decision);

CREATE INDEX csf_application_decision_stages_releasable_idx
  ON plugin_data.csf_application_decision_stages (organization_id, term_id)
  WHERE release_state = 'staged' AND NOT blocks_release;

CREATE INDEX csf_application_decision_stages_profile_idx
  ON plugin_data.csf_application_decision_stages (organization_id, profile_id);

CREATE INDEX csf_application_decision_stages_source_idx
  ON plugin_data.csf_application_decision_stages (organization_id, source_id)
  WHERE source_id IS NOT NULL;

COMMENT ON TABLE plugin_data.csf_application_decision_stages IS
  'Private staged application decision read from a review Sheet. Never grants access on its own: only csf_release_sheet_application_decisions publishes, through the existing atomic decision.';

-- ---------------------------------------------------------------------------
-- E. ACLs
--
-- Same posture as the 20260910232532 sheet-sync tables: nothing but SELECT for
-- `service_role`, so every write goes through a reviewed SECURITY DEFINER
-- function rather than a PostgREST call. `anon` and `authenticated` reach none
-- of it, and RLS stays on as defence in depth.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'csf_application_decision_sync_runs',
    'csf_application_decision_sync_sources',
    'csf_application_decision_sync_rows',
    'csf_application_decision_releases',
    'csf_application_decision_stages',
    'csf_application_decision_mappings'
  ] LOOP
    EXECUTE pg_catalog.format('ALTER TABLE plugin_data.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON TABLE plugin_data.%I FROM PUBLIC, anon, authenticated, service_role',
      v_table
    );
    EXECUTE pg_catalog.format('GRANT SELECT ON TABLE plugin_data.%I TO service_role', v_table);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- F. Evidence immutability
--
-- Same contract as the import provenance guard (V24/V46): a rewrite attempt
-- fails with SQLSTATE 55000 and names the retry path instead of silently
-- winning.
-- ---------------------------------------------------------------------------

CREATE FUNCTION plugin_data.csf_guard_application_decision_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'CSF application decision evidence is immutable.',
    DETAIL = 'CSF_DECISION_EVIDENCE_IMMUTABLE=' || TG_TABLE_NAME,
    HINT = 'Record a new sync run or release instead of rewriting this receipt.';
END;
$$;

CREATE TRIGGER csf_application_decision_sync_runs_immutable
  BEFORE UPDATE OR DELETE ON plugin_data.csf_application_decision_sync_runs
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_application_decision_evidence();

CREATE TRIGGER csf_application_decision_sync_sources_immutable
  BEFORE UPDATE OR DELETE ON plugin_data.csf_application_decision_sync_sources
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_application_decision_evidence();

CREATE TRIGGER csf_application_decision_sync_rows_immutable
  BEFORE UPDATE OR DELETE ON plugin_data.csf_application_decision_sync_rows
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_application_decision_evidence();

CREATE TRIGGER csf_application_decision_releases_immutable
  BEFORE UPDATE OR DELETE ON plugin_data.csf_application_decision_releases
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_application_decision_evidence();

REVOKE ALL ON FUNCTION plugin_data.csf_guard_application_decision_evidence()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- G. No application source write-back while a term is in Sheets review
--
-- The chapter reads decisions from the workbook this term, so writing colours
-- and comments back into that same workbook would make the app and the sheet
-- argue about which one decided. Two layers: the queueing function skips and
-- records why, and the ledger itself fails closed for anything else.
--
-- Scoped to the legacy application source write-back (`destination_id IS NULL`).
-- The separate Let's Assist export destinations added in 20260910232532 keep
-- working; they are a different product with their own V112 controls.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_queue_application_sheet_writeback(
  p_organization_id uuid,
  p_application_id uuid,
  p_decision text,
  p_comment text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application plugin_data.csf_term_applications%ROWTYPE;
BEGIN
  SELECT application.*
  INTO v_application
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id;

  -- A manually created application has no sheet row to color; that is not an
  -- error, there is simply nothing to write back.
  IF NOT FOUND
    OR v_application.source_file_id IS NULL
    OR v_application.source_row_number IS NULL THEN
    RETURN;
  END IF;

  IF plugin_data.csf_term_is_sheet_review(p_organization_id, v_application.term_id) THEN
    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id, actor_user_id, action, target_type, target_id, term_id,
      after_data, source_type, source_id
    )
    VALUES (
      p_organization_id, NULL, 'application.sheet_writeback_suppressed',
      'csf_term_applications', p_application_id, v_application.term_id,
      pg_catalog.jsonb_build_object(
        'reason', 'term_in_sheet_review_mode',
        'decision', p_decision,
        'sourceFileId', v_application.source_file_id,
        'sourceSheetTab', v_application.source_sheet_tab,
        'sourceRowNumber', v_application.source_row_number
      ),
      'application_review', p_application_id::text
    );
    RETURN;
  END IF;

  INSERT INTO plugin_data.csf_sheet_writeback_ledger (
    organization_id, application_id, spreadsheet_file_id, sheet_tab,
    row_number, decision, comment
  )
  VALUES (
    p_organization_id, p_application_id, v_application.source_file_id,
    v_application.source_sheet_tab, v_application.source_row_number,
    p_decision, nullif(btrim(coalesce(p_comment, '')), '')
  )
  ON CONFLICT (organization_id, application_id) DO UPDATE SET
    spreadsheet_file_id = EXCLUDED.spreadsheet_file_id,
    sheet_tab = EXCLUDED.sheet_tab,
    row_number = EXCLUDED.row_number,
    decision = EXCLUDED.decision,
    comment = EXCLUDED.comment,
    status = 'queued',
    attempts = 0,
    last_error = NULL,
    sent_at = NULL,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_queue_application_sheet_writeback(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- On UPDATE this only rejects a fresh queueing. Settling a row that was already
-- queued before the term flipped stays possible, so
-- `csf_mark_sheet_writeback_result` can still record what the dispatcher did.
CREATE FUNCTION plugin_data.csf_guard_sheet_writeback_review_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_term_id uuid;
BEGIN
  IF NEW.destination_id IS NOT NULL OR NEW.application_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
    AND NOT (NEW.status = 'queued' AND OLD.status IS DISTINCT FROM 'queued') THEN
    RETURN NEW;
  END IF;

  SELECT application.term_id
  INTO v_term_id
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = NEW.organization_id
    AND application.id = NEW.application_id;

  IF v_term_id IS NOT NULL
    AND plugin_data.csf_term_is_sheet_review(NEW.organization_id, v_term_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'This term reviews applications in the source Sheet, so decisions are not written back to it.',
      DETAIL = 'CSF_SHEET_REVIEW_MODE=write_back_disabled',
      HINT = 'Release the term decisions in Let''s Assist instead.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_sheet_writeback_review_mode_guard
  BEFORE INSERT OR UPDATE ON plugin_data.csf_sheet_writeback_ledger
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_sheet_writeback_review_mode();

REVOKE ALL ON FUNCTION plugin_data.csf_guard_sheet_writeback_review_mode()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION plugin_data.csf_queue_application_sheet_writeback(uuid, uuid, text, text) IS
  'Queues the source-sheet decision write-back, except while the term is in Sheets review mode, where it records a suppression audit event and queues nothing.';

-- ---------------------------------------------------------------------------
-- H. Honest reason codes for an externally reviewed decision
--
-- `approved_standard` means the in-product academic path cleared the applicant.
-- A Sheets-review decision is an officer's external judgement, and recording it
-- as `approved_standard` would claim evidence the app never evaluated. Postgres
-- forbids using a new enum value in the transaction that adds it, so these are
-- added here and first used by 20260917010100.
-- ---------------------------------------------------------------------------

ALTER TYPE plugin_data.csf_application_reason_code ADD VALUE IF NOT EXISTS 'approved_sheet_review';
ALTER TYPE plugin_data.csf_application_reason_code ADD VALUE IF NOT EXISTS 'rejected_sheet_review';

COMMIT;
