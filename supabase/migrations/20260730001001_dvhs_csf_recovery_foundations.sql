-- DVHS CSF recovery foundations (additive).
--
-- This migration extends the existing CSF domain model. It does not introduce a
-- second set of profile/term/import/partner-club tables, and it does not rewrite
-- the existing import commit path: the atomic reconciliation RPCs continue to
-- resolve their preview through summary->>'previewJobId'. Here we only add the
-- durable provenance columns, the term-scoped partner-club representative and
-- lifecycle-event records, the durable communications ledger, and the calendar
-- source generalization the recovery plan depends on.
--
-- Google Forms remains application intake and existing Drive identifiers remain
-- external evidence; no native application-upload schema is added here.
--
-- Every new plugin_data table is server-only: RLS is enabled with no policies,
-- PUBLIC/anon/authenticated privileges are revoked, and service_role receives
-- only SELECT/INSERT/UPDATE/DELETE -- never TRUNCATE, REFERENCES, or TRIGGER.
-- Trigger functions pin an empty search_path and revoke client EXECUTE.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Preflight
--
-- Every constraint below that tightens an existing populated table is checked
-- first, so a deployment that cannot satisfy it fails with an actionable
-- message naming the offending row instead of an opaque constraint violation.
-- ---------------------------------------------------------------------------

DO $preflight$
DECLARE
  v_row record;
BEGIN
  SELECT
    source_row.job_id,
    source_row.sheet_tab_name,
    source_row.row_number,
    count(*) AS occurrences
  INTO v_row
  FROM plugin_data.csf_sheet_import_rows AS source_row
  GROUP BY source_row.job_id, source_row.sheet_tab_name, source_row.row_number
  HAVING count(*) > 1
  ORDER BY count(*) DESC, source_row.job_id, source_row.sheet_tab_name, source_row.row_number
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'CSF recovery preflight failed: import job % already stores % rows for coordinate "%":%. Deduplicate plugin_data.csf_sheet_import_rows on (job_id, sheet_tab_name, row_number) before applying this migration.',
      v_row.job_id, v_row.occurrences, v_row.sheet_tab_name, v_row.row_number
      USING ERRCODE = '23505';
  END IF;

  SELECT job.id, job.organization_id
  INTO v_row
  FROM plugin_data.csf_sheet_import_jobs AS job
  WHERE job.retry_of_job_id = job.id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'CSF recovery preflight failed: import job % records itself as its own retry. Clear plugin_data.csf_sheet_import_jobs.retry_of_job_id on that row before applying this migration.',
      v_row.id
      USING ERRCODE = '23514';
  END IF;

  SELECT job.id, job.retry_of_job_id
  INTO v_row
  FROM plugin_data.csf_sheet_import_jobs AS job
  JOIN plugin_data.csf_sheet_import_jobs AS parent
    ON parent.id = job.retry_of_job_id
  WHERE parent.organization_id <> job.organization_id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'CSF recovery preflight failed: import job % retries job % from another organization. Repair that lineage before applying this migration.',
      v_row.id, v_row.retry_of_job_id
      USING ERRCODE = '23503';
  END IF;

  SELECT source_row.id
  INTO v_row
  FROM plugin_data.csf_sheet_import_rows AS source_row
  WHERE source_row.retry_of_row_id = source_row.id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'CSF recovery preflight failed: import row % records itself as its own retry. Clear plugin_data.csf_sheet_import_rows.retry_of_row_id on that row before applying this migration.',
      v_row.id
      USING ERRCODE = '23514';
  END IF;

  SELECT source_row.id, source_row.retry_of_row_id
  INTO v_row
  FROM plugin_data.csf_sheet_import_rows AS source_row
  JOIN plugin_data.csf_sheet_import_rows AS parent
    ON parent.id = source_row.retry_of_row_id
  WHERE parent.organization_id <> source_row.organization_id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'CSF recovery preflight failed: import row % retries row % from another organization. Repair that lineage before applying this migration.',
      v_row.id, v_row.retry_of_row_id
      USING ERRCODE = '23503';
  END IF;

  SELECT source_row.id, source_row.job_id
  INTO v_row
  FROM plugin_data.csf_sheet_import_rows AS source_row
  JOIN plugin_data.csf_sheet_import_jobs AS job
    ON job.id = source_row.job_id
  WHERE job.organization_id <> source_row.organization_id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'CSF recovery preflight failed: import row % belongs to job % in another organization. Repair that ownership before applying this migration.',
      v_row.id, v_row.job_id
      USING ERRCODE = '23503';
  END IF;

  SELECT event.id, event.project_id, event.organization_id
  INTO v_row
  FROM public.organization_calendar_events AS event
  LEFT JOIN public.projects AS project
    ON project.id = event.project_id
  WHERE event.project_id IS NOT NULL
    AND (
      project.id IS NULL
      OR project.organization_id IS DISTINCT FROM event.organization_id
    )
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'CSF recovery preflight failed: calendar binding % in organization % points at project %, which is missing or owned by a different organization. Repair or remove that binding before applying this migration.',
      v_row.id, v_row.organization_id, v_row.project_id
      USING ERRCODE = '23503';
  END IF;

  -- occurrence_key is derived from schedule_id and must be non-blank.
  SELECT event.id, event.organization_id
  INTO v_row
  FROM public.organization_calendar_events AS event
  WHERE nullif(btrim(event.schedule_id), '') IS NULL
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'CSF recovery preflight failed: calendar binding % in organization % has a blank schedule_id, which cannot become an occurrence key. Repair or remove that binding before applying this migration.',
      v_row.id, v_row.organization_id
      USING ERRCODE = '23514';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- A. Import lineage that current writers cannot bypass
-- ---------------------------------------------------------------------------

-- preview_job_id makes the preview -> commit lineage a real, organization-scoped
-- relation instead of a JSON string. Existing writers keep populating the legacy
-- summary key; the BEFORE INSERT trigger below derives this column from that key
-- so no application change is required to satisfy the new relation.
ALTER TABLE plugin_data.csf_sheet_import_jobs
  ADD COLUMN preview_job_id uuid,
  ADD COLUMN source_content_hash text,
  ADD COLUMN snapshot_hash text,
  ADD COLUMN snapshot_row_count integer,
  ADD COLUMN snapshot_contract_version text,
  ADD CONSTRAINT csf_sheet_import_jobs_preview_job_organization_fkey
    FOREIGN KEY (preview_job_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_jobs (id, organization_id)
    ON DELETE SET NULL (preview_job_id),
  ADD CONSTRAINT csf_sheet_import_jobs_preview_job_not_self_check
    CHECK (preview_job_id IS NULL OR preview_job_id <> id),
  ADD CONSTRAINT csf_sheet_import_jobs_source_content_hash_check
    CHECK (source_content_hash IS NULL OR source_content_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT csf_sheet_import_jobs_snapshot_hash_check
    CHECK (snapshot_hash IS NULL OR snapshot_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT csf_sheet_import_jobs_snapshot_row_count_check
    CHECK (snapshot_row_count IS NULL OR snapshot_row_count >= 0),
  ADD CONSTRAINT csf_sheet_import_jobs_snapshot_contract_version_check
    CHECK (
      snapshot_contract_version IS NULL
      OR nullif(btrim(snapshot_contract_version), '') IS NOT NULL
    );

-- Organization-scoped retry lineage. The pre-existing single-column
-- csf_sheet_import_jobs_retry_of_job_id_fkey and
-- csf_sheet_import_rows_retry_of_row_id_fkey constraints are deliberately left
-- in place: these composite constraints add tenant scoping with the same
-- ON DELETE behavior rather than replacing the existing referential contract.
ALTER TABLE plugin_data.csf_sheet_import_jobs
  ADD CONSTRAINT csf_sheet_import_jobs_retry_of_job_organization_fkey
    FOREIGN KEY (retry_of_job_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_jobs (id, organization_id)
    ON DELETE SET NULL (retry_of_job_id),
  ADD CONSTRAINT csf_sheet_import_jobs_retry_of_job_not_self_check
    CHECK (retry_of_job_id IS NULL OR retry_of_job_id <> id);

-- csf_sheet_import_rows_job_id_fkey already cascades from the job; this pairs
-- the same relation with organization_id so a row can never be filed under one
-- organization while its job belongs to another.
ALTER TABLE plugin_data.csf_sheet_import_rows
  ADD CONSTRAINT csf_sheet_import_rows_job_organization_fkey
    FOREIGN KEY (job_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_jobs (id, organization_id)
    ON DELETE CASCADE,
  ADD CONSTRAINT csf_sheet_import_rows_retry_of_row_organization_fkey
    FOREIGN KEY (retry_of_row_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_rows (id, organization_id)
    ON DELETE SET NULL (retry_of_row_id),
  ADD CONSTRAINT csf_sheet_import_rows_retry_of_row_not_self_check
    CHECK (retry_of_row_id IS NULL OR retry_of_row_id <> id);

-- Backfill only provable lineage. A legacy summary that carries a non-UUID
-- value, points at another organization, or points at something that is not a
-- preview job stays null rather than inventing a relationship. The CASE keeps
-- the cast from being evaluated for rows whose text is not a UUID.
--
-- When legacy data recorded more than one commit job against the same preview,
-- DISTINCT ON keeps the authoritative attempt: a completed commit outranks a
-- partially completed one, which outranks an unfinished one, which outranks a
-- cancelled or failed one. Ties break on the earliest commit. The other rows
-- are intentionally left null -- they are reported below rather than given
-- fabricated lineage.
WITH legacy_preview_links AS (
  SELECT DISTINCT ON (job.organization_id, preview.id)
    job.id AS commit_job_id,
    preview.id AS preview_job_id
  FROM plugin_data.csf_sheet_import_jobs AS job
  JOIN plugin_data.csf_sheet_import_jobs AS preview
    ON preview.organization_id = job.organization_id
    AND preview.mode = 'preview'
    AND preview.id = CASE
      WHEN job.summary->>'previewJobId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN (job.summary->>'previewJobId')::uuid
      ELSE NULL
    END
  WHERE job.preview_job_id IS NULL
    AND job.mode = 'commit'
    AND preview.id <> job.id
    AND preview.source_type IS NOT DISTINCT FROM job.source_type
  ORDER BY
    job.organization_id,
    preview.id,
    CASE job.status
      WHEN 'completed' THEN 0
      WHEN 'partially_completed' THEN 1
      WHEN 'needs_resolution' THEN 2
      WHEN 'running' THEN 3
      WHEN 'pending' THEN 4
      WHEN 'cancelled' THEN 5
      WHEN 'failed' THEN 6
      ELSE 7
    END,
    job.committed_at NULLS LAST,
    job.created_at,
    job.id
)
UPDATE plugin_data.csf_sheet_import_jobs AS job
SET preview_job_id = link.preview_job_id
FROM legacy_preview_links AS link
WHERE job.id = link.commit_job_id;

-- Report, but do not repair, the noncanonical duplicates. Their legacy summary
-- still names a preview; only the structured column is null, so an operator can
-- find them with:
--   SELECT id, organization_id, status, summary->>'previewJobId'
--   FROM plugin_data.csf_sheet_import_jobs
--   WHERE mode = 'commit' AND preview_job_id IS NULL
--     AND summary ? 'previewJobId';
DO $backfill_report$
DECLARE
  v_unlinked integer;
BEGIN
  SELECT count(*)
  INTO v_unlinked
  FROM plugin_data.csf_sheet_import_jobs AS job
  WHERE job.mode = 'commit'
    AND job.preview_job_id IS NULL
    AND job.summary ? 'previewJobId';

  IF v_unlinked > 0 THEN
    RAISE NOTICE
      'CSF recovery backfill: % legacy commit job(s) kept a summary previewJobId without structured lineage because another commit is the canonical claim on that preview, the named preview is missing, it belongs to another organization, or its source_type disagrees. They are readable through summary and are left for operator review.',
      v_unlinked;
  END IF;
END
$backfill_report$;

-- One commit job per preview. Scoped to commit jobs through the existing mode
-- discriminator so preview, scheduled, and unlinked jobs are unaffected. This
-- index -- not a read-then-write check inside the trigger -- is what arbitrates
-- concurrent and repeated commits: two sessions racing the same preview both
-- reach the insert and exactly one survives.
CREATE UNIQUE INDEX csf_sheet_import_jobs_one_commit_per_preview_idx
  ON plugin_data.csf_sheet_import_jobs (organization_id, preview_job_id)
  WHERE mode = 'commit' AND preview_job_id IS NOT NULL;

-- Supports the referencing side of the self foreign key for every mode.
CREATE INDEX csf_sheet_import_jobs_preview_lineage_idx
  ON plugin_data.csf_sheet_import_jobs (preview_job_id)
  WHERE preview_job_id IS NOT NULL;

-- csf_sheet_import_rows has no existing index on retry_of_row_id, so the
-- ON DELETE SET NULL path would otherwise scan the whole table.
-- csf_sheet_import_jobs.retry_of_job_id is already covered by
-- csf_sheet_import_jobs_retry_of_job_id_idx, so no second index is added there.
CREATE INDEX csf_sheet_import_rows_retry_of_row_idx
  ON plugin_data.csf_sheet_import_rows (retry_of_row_id)
  WHERE retry_of_row_id IS NOT NULL;

-- Snapshot history and content dedup lookups.
CREATE INDEX csf_sheet_import_jobs_content_hash_history_idx
  ON plugin_data.csf_sheet_import_jobs (
    organization_id,
    source_type,
    source_content_hash,
    created_at DESC,
    id DESC
  )
  WHERE source_content_hash IS NOT NULL;

CREATE INDEX csf_sheet_import_jobs_snapshot_hash_idx
  ON plugin_data.csf_sheet_import_jobs (
    organization_id,
    snapshot_hash,
    created_at DESC,
    id DESC
  )
  WHERE snapshot_hash IS NOT NULL;

-- One row per real source coordinate per job, using the tab/row columns the
-- importers already write. The application already treats
-- "<tabName>:<rowNumber>" as one job coordinate when it maps retry lineage.
CREATE UNIQUE INDEX csf_sheet_import_rows_job_coordinate_idx
  ON plugin_data.csf_sheet_import_rows (job_id, sheet_tab_name, row_number);

-- Structured lineage is mandatory for every new commit job, and it is derived
-- rather than demanded: current writers keep sending only
-- summary->>'previewJobId' and this trigger turns that into the real relation
-- before any constraint is evaluated.
--
-- Parsing is guarded. The UUID shape is tested with a regular expression before
-- any cast runs, so a malformed legacy value produces this migration's own
-- diagnostic instead of an invalid_text_representation crash, and a cast
-- exception can never be the only thing standing between a bad value and the
-- table.
--
-- Snapshot digests are not required here. Legacy and current previews were
-- written before source_content_hash/snapshot_hash existed; the normalized
-- importer slice writes those next. What is enforced today is that a commit may
-- not contradict a preview that already recorded them.
CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_import_commit_lineage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  c_uuid_shape constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_summary_text text;
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
BEGIN
  IF NEW.mode <> 'commit' THEN
    IF NEW.preview_job_id IS NOT NULL THEN
      RAISE EXCEPTION
        'Only a commit CSF import job may record preview lineage.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  v_summary_text := nullif(btrim(coalesce(NEW.summary->>'previewJobId', '')), '');

  IF NEW.preview_job_id IS NULL THEN
    IF v_summary_text IS NULL THEN
      RAISE EXCEPTION
        'A CSF commit import job must name the preview it was derived from, either as preview_job_id or as summary.previewJobId.'
        USING ERRCODE = '23514';
    END IF;

    IF v_summary_text !~ c_uuid_shape THEN
      RAISE EXCEPTION
        'The CSF commit import job summary.previewJobId is not a UUID.'
        USING ERRCODE = '23514';
    END IF;

    NEW.preview_job_id := v_summary_text::uuid;
  ELSIF v_summary_text IS NOT NULL THEN
    IF v_summary_text !~ c_uuid_shape
      OR v_summary_text::uuid <> NEW.preview_job_id
    THEN
      RAISE EXCEPTION
        'The CSF commit import job summary.previewJobId disagrees with its structured preview lineage.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.preview_job_id = NEW.id THEN
    RAISE EXCEPTION
      'A CSF commit import job cannot be its own preview.'
      USING ERRCODE = '23514';
  END IF;

  SELECT preview.*
  INTO v_preview
  FROM plugin_data.csf_sheet_import_jobs AS preview
  WHERE preview.id = NEW.preview_job_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The CSF preview import job named by this commit does not exist.'
      USING ERRCODE = '23503';
  END IF;

  IF v_preview.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION
      'A CSF commit import job cannot claim a preview from another organization.'
      USING ERRCODE = '23503';
  END IF;

  IF v_preview.mode <> 'preview' THEN
    RAISE EXCEPTION
      'A CSF commit import job must be derived from a preview job, not from another commit or scheduled job.'
      USING ERRCODE = '23514';
  END IF;

  IF v_preview.source_type IS DISTINCT FROM NEW.source_type THEN
    RAISE EXCEPTION
      'A CSF commit import job must keep the source type of the preview it commits.'
      USING ERRCODE = '23514';
  END IF;

  IF v_preview.source_id IS DISTINCT FROM NEW.source_id THEN
    RAISE EXCEPTION
      'A CSF commit import job must keep the source of the preview it commits.'
      USING ERRCODE = '23514';
  END IF;

  IF v_preview.source_content_hash IS NOT NULL THEN
    IF NEW.source_content_hash IS NULL THEN
      NEW.source_content_hash := v_preview.source_content_hash;
    ELSIF NEW.source_content_hash <> v_preview.source_content_hash THEN
      RAISE EXCEPTION
        'A CSF commit import job cannot contradict the source content digest recorded by its preview.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_preview.snapshot_hash IS NOT NULL THEN
    IF NEW.snapshot_hash IS NULL THEN
      NEW.snapshot_hash := v_preview.snapshot_hash;
    ELSIF NEW.snapshot_hash <> v_preview.snapshot_hash THEN
      RAISE EXCEPTION
        'A CSF commit import job cannot contradict the snapshot digest recorded by its preview.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_preview.snapshot_row_count IS NOT NULL THEN
    IF NEW.snapshot_row_count IS NULL THEN
      NEW.snapshot_row_count := v_preview.snapshot_row_count;
    ELSIF NEW.snapshot_row_count <> v_preview.snapshot_row_count THEN
      RAISE EXCEPTION
        'A CSF commit import job cannot contradict the snapshot row count recorded by its preview.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_preview.snapshot_contract_version IS NOT NULL THEN
    IF NEW.snapshot_contract_version IS NULL THEN
      NEW.snapshot_contract_version := v_preview.snapshot_contract_version;
    ELSIF NEW.snapshot_contract_version <> v_preview.snapshot_contract_version THEN
      RAISE EXCEPTION
        'A CSF commit import job cannot contradict the snapshot contract version recorded by its preview.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Deliberately no "does a commit already exist for this preview" lookup:
  -- csf_sheet_import_jobs_one_commit_per_preview_idx arbitrates that race.
  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_sheet_import_jobs_enforce_commit_lineage
BEFORE INSERT ON plugin_data.csf_sheet_import_jobs
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_enforce_import_commit_lineage();

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_import_commit_lineage()
  FROM PUBLIC, anon, authenticated;

-- Narrow immutability for the new fields only. The existing
-- csf_sheet_import_jobs_immutable_provenance trigger
-- (plugin_data.csf_reject_import_provenance_mutation) is left exactly as it is.
--
-- A null -> value transition is allowed once because the existing preview and
-- commit flows insert a running job and finalize it in a later UPDATE, so the
-- content/snapshot digest is not known at insert time. Once recorded, the value
-- can never change or be cleared.
CREATE OR REPLACE FUNCTION plugin_data.csf_preserve_import_snapshot_provenance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.preview_job_id IS NOT NULL
    AND NEW.preview_job_id IS DISTINCT FROM OLD.preview_job_id
  THEN
    -- Deleting the preview job itself clears this link through ON DELETE SET
    -- NULL, and the parent row is already gone when that update fires. Nothing
    -- else may re-point or clear recorded lineage. The nested IF keeps the
    -- lookup from running on the ordinary finalize path.
    IF NEW.preview_job_id IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM plugin_data.csf_sheet_import_jobs AS preview
        WHERE preview.id = OLD.preview_job_id
      )
    THEN
      RAISE EXCEPTION 'CSF import preview lineage is immutable; create a new commit job instead.';
    END IF;
  END IF;

  IF OLD.source_content_hash IS NOT NULL
    AND NEW.source_content_hash IS DISTINCT FROM OLD.source_content_hash
  THEN
    RAISE EXCEPTION 'CSF import source content hash is immutable once recorded.';
  END IF;

  IF OLD.snapshot_hash IS NOT NULL
    AND NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
  THEN
    RAISE EXCEPTION 'CSF import snapshot hash is immutable once recorded.';
  END IF;

  IF OLD.snapshot_row_count IS NOT NULL
    AND NEW.snapshot_row_count IS DISTINCT FROM OLD.snapshot_row_count
  THEN
    RAISE EXCEPTION 'CSF import snapshot row count is immutable once recorded.';
  END IF;

  IF OLD.snapshot_contract_version IS NOT NULL
    AND NEW.snapshot_contract_version IS DISTINCT FROM OLD.snapshot_contract_version
  THEN
    RAISE EXCEPTION 'CSF import snapshot contract version is immutable once recorded.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_sheet_import_jobs_preserve_snapshot_provenance
BEFORE UPDATE ON plugin_data.csf_sheet_import_jobs
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_preserve_import_snapshot_provenance();

REVOKE ALL ON FUNCTION plugin_data.csf_preserve_import_snapshot_provenance()
  FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN plugin_data.csf_sheet_import_jobs.preview_job_id IS
  'Organization-scoped preview job this commit job was derived from. Derived from summary.previewJobId at insert time; backfilled only from provable legacy summaries.';
COMMENT ON COLUMN plugin_data.csf_sheet_import_jobs.source_content_hash IS
  'SHA-256 of the exact source content this job read, for replay detection and dedup.';
COMMENT ON COLUMN plugin_data.csf_sheet_import_jobs.snapshot_hash IS
  'SHA-256 of the normalized row snapshot this job produced.';
COMMENT ON COLUMN plugin_data.csf_sheet_import_jobs.snapshot_row_count IS
  'Row count of the normalized snapshot this job produced.';
COMMENT ON COLUMN plugin_data.csf_sheet_import_jobs.snapshot_contract_version IS
  'Importer snapshot contract version, so an old snapshot is never re-read under new parsing rules.';
COMMENT ON INDEX plugin_data.csf_sheet_import_jobs_one_commit_per_preview_idx IS
  'One commit job per reviewed preview per organization. This index arbitrates concurrent and repeated commits.';
COMMENT ON INDEX plugin_data.csf_sheet_import_rows_job_coordinate_idx IS
  'One import row per (job, sheet tab, source row number) coordinate.';
COMMENT ON FUNCTION plugin_data.csf_enforce_import_commit_lineage() IS
  'Derives structured preview lineage from the legacy summary key and rejects missing, malformed, self, commit-to-commit, cross-organization, and source-mismatched lineage for every new commit job.';
COMMENT ON FUNCTION plugin_data.csf_preserve_import_snapshot_provenance() IS
  'Freezes new import snapshot/lineage fields once recorded, allowing only the initial null-to-finalized write.';

-- ---------------------------------------------------------------------------
-- B. Authorized teardown flag
--
-- The immutability and delete guards below refuse every ordinary deletion. The
-- single exception is the purge RPC at the end of this migration, which sets a
-- transaction-local, organization-bound GUC. A guard honors the exception only
-- when the flag holds exactly the organization of the row being removed, so a
-- purge of one organization can never authorize teardown of another.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_recovery_teardown_authorized(
  p_organization_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    nullif(
      pg_catalog.current_setting('plugin_data.csf_recovery_purge_organization', true),
      ''
    ) = p_organization_id::text,
    false
  );
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_recovery_teardown_authorized(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_recovery_teardown_authorized(uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_recovery_teardown_authorized(uuid) IS
  'True only while plugin_data.csf_purge_recovery_foundations() holds its transaction-local purge flag for exactly this organization.';

-- ---------------------------------------------------------------------------
-- C. Recursive provider payload sanitizer
--
-- The previous top-level key denylist was trivially bypassed by nesting the
-- body one level down. This walks the whole document and rejects any obviously
-- content-bearing key at any depth, in objects and inside arrays. Keys are
-- compared with punctuation and case removed, so htmlBody, html_body, and
-- HTML-BODY all collapse to the same denied name.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_jsonb_carries_raw_content(p_document jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  c_denied constant text[] := ARRAY[
    'html', 'htmlbody', 'htmlcontent',
    'text', 'textbody', 'textcontent', 'plain', 'plaintext',
    'body', 'bodies', 'messagebody',
    'attachment', 'attachments',
    'content', 'contents',
    'raw', 'rawbody', 'rawcontent', 'rawpayload',
    'payload', 'payloads',
    'message', 'messages',
    'subject', 'snippet', 'preview',
    'mime', 'mimecontent', 'eml', 'headers'
  ];
  v_key text;
  v_child jsonb;
BEGIN
  IF p_document IS NULL THEN
    RETURN false;
  END IF;

  IF pg_catalog.jsonb_typeof(p_document) = 'object' THEN
    FOR v_key IN
      SELECT present.key FROM pg_catalog.jsonb_object_keys(p_document) AS present(key)
    LOOP
      IF pg_catalog.regexp_replace(pg_catalog.lower(v_key), '[^a-z0-9]', '', 'g')
        = ANY (c_denied)
      THEN
        RETURN true;
      END IF;
    END LOOP;

    FOR v_child IN
      SELECT entry.value FROM pg_catalog.jsonb_each(p_document) AS entry
    LOOP
      IF plugin_data.csf_jsonb_carries_raw_content(v_child) THEN
        RETURN true;
      END IF;
    END LOOP;
  ELSIF pg_catalog.jsonb_typeof(p_document) = 'array' THEN
    FOR v_child IN
      SELECT element.value
      FROM pg_catalog.jsonb_array_elements(p_document) AS element(value)
    LOOP
      IF plugin_data.csf_jsonb_carries_raw_content(v_child) THEN
        RETURN true;
      END IF;
    END LOOP;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_jsonb_carries_raw_content(jsonb)
  FROM PUBLIC, anon, authenticated;
-- CHECK expressions are evaluated with the privileges of the writing role, and
-- service_role is the only role that may write these tables.
GRANT EXECUTE ON FUNCTION plugin_data.csf_jsonb_carries_raw_content(jsonb)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_jsonb_carries_raw_content(jsonb) IS
  'True when a JSON document carries an obviously content-bearing key (html, text, body, attachments, content, raw, payload, subject, headers, and relatives) at any nesting depth.';

-- ---------------------------------------------------------------------------
-- D. Durable CSF communications
--
-- Created before the partner-club lifecycle events so those events can carry a
-- real organization-scoped campaign reference at creation time.
-- ---------------------------------------------------------------------------

CREATE TABLE plugin_data.csf_communication_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_kind text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  status text NOT NULL DEFAULT 'draft',
  sender_name text,
  sender_email text NOT NULL,
  reply_to_email text,
  subject text NOT NULL,
  body_text_hash text,
  body_html_hash text,
  resend_topic_id text,
  audience_snapshot_version integer NOT NULL DEFAULT 1,
  provider_idempotency_key text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  queued_at timestamptz,
  sent_at timestamptz,
  completed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_communication_campaigns_id_organization_id_key
    UNIQUE (id, organization_id),
  -- Parent tuple for the recipient snapshot binding: a snapshot row may only
  -- attach to the audience revision the campaign actually declares.
  CONSTRAINT csf_communication_campaigns_audience_identity_key
    UNIQUE (id, organization_id, audience_snapshot_version),
  CONSTRAINT csf_communication_campaigns_provider_idempotency_key
    UNIQUE (organization_id, provider_idempotency_key),
  CONSTRAINT csf_communication_campaigns_kind_check
    CHECK (campaign_kind IN ('transactional', 'broadcast')),
  CONSTRAINT csf_communication_campaigns_channel_check
    CHECK (channel IN ('email')),
  CONSTRAINT csf_communication_campaigns_status_check
    CHECK (status IN ('draft', 'queued', 'sending', 'completed', 'failed', 'cancelled')),
  CONSTRAINT csf_communication_campaigns_sender_email_check
    CHECK (nullif(btrim(sender_email), '') IS NOT NULL AND position('@' IN sender_email) > 1),
  CONSTRAINT csf_communication_campaigns_reply_to_email_check
    CHECK (reply_to_email IS NULL OR position('@' IN reply_to_email) > 1),
  CONSTRAINT csf_communication_campaigns_subject_check
    CHECK (nullif(btrim(subject), '') IS NOT NULL),
  CONSTRAINT csf_communication_campaigns_body_text_hash_check
    CHECK (body_text_hash IS NULL OR body_text_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT csf_communication_campaigns_body_html_hash_check
    CHECK (body_html_hash IS NULL OR body_html_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT csf_communication_campaigns_snapshot_version_check
    CHECK (audience_snapshot_version >= 1),
  -- Resend rejects an Idempotency-Key longer than 256 characters, so a key this
  -- table accepts is always a key the provider can accept.
  CONSTRAINT csf_communication_campaigns_idempotency_shape_check
    CHECK (
      nullif(btrim(provider_idempotency_key), '') IS NOT NULL
      AND char_length(provider_idempotency_key) <= 256
    ),
  CONSTRAINT csf_communication_campaigns_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX csf_communication_campaigns_queue_idx
  ON plugin_data.csf_communication_campaigns (
    organization_id,
    status,
    created_at DESC,
    id DESC
  );

CREATE INDEX csf_communication_campaigns_topic_idx
  ON plugin_data.csf_communication_campaigns (organization_id, resend_topic_id)
  WHERE resend_topic_id IS NOT NULL;

-- The audience is reconstructed from these rows alone. Recipient identity is
-- copied here at send time, so a later membership, roster, or representative
-- change can never rewrite who a past campaign was addressed to.
CREATE TABLE plugin_data.csf_communication_recipient_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL,
  snapshot_version integer NOT NULL DEFAULT 1,
  recipient_email text NOT NULL,
  normalized_recipient_email text
    GENERATED ALWAYS AS (lower(btrim(recipient_email))) STORED,
  recipient_name text,
  profile_id uuid,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  club_representative_id uuid,
  partner_club_term_id uuid,
  subscription_decision text NOT NULL,
  exclusion_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_communication_recipient_snapshots_id_organization_key
    UNIQUE (id, organization_id),
  -- Parent tuple for the delivery binding: a delivery may only attach to a
  -- snapshot that belongs to the same organization and the same campaign.
  CONSTRAINT csf_communication_recipient_snapshots_campaign_identity_key
    UNIQUE (id, organization_id, campaign_id),
  -- snapshot_version is bound to the campaign's declared audience revision, so
  -- a snapshot can never describe an audience the campaign never published.
  CONSTRAINT csf_communication_recipient_snapshots_campaign_fkey
    FOREIGN KEY (campaign_id, organization_id, snapshot_version)
    REFERENCES plugin_data.csf_communication_campaigns
      (id, organization_id, audience_snapshot_version)
    ON DELETE CASCADE,
  CONSTRAINT csf_communication_recipient_snapshots_profile_fkey
    FOREIGN KEY (profile_id, organization_id)
    REFERENCES plugin_data.csf_profiles (id, organization_id)
    ON DELETE SET NULL (profile_id),
  CONSTRAINT csf_communication_recipient_snapshots_email_shape_check
    CHECK (nullif(btrim(recipient_email), '') IS NOT NULL AND position('@' IN recipient_email) > 1),
  CONSTRAINT csf_communication_recipient_snapshots_version_check
    CHECK (snapshot_version >= 1),
  CONSTRAINT csf_communication_recipient_snapshots_decision_check
    CHECK (subscription_decision IN ('included', 'excluded')),
  CONSTRAINT csf_communication_recipient_snapshots_exclusion_check
    CHECK (
      (subscription_decision = 'included' AND exclusion_reason IS NULL)
      OR
      (
        subscription_decision = 'excluded'
        AND exclusion_reason IS NOT NULL
        AND exclusion_reason IN (
          'unsubscribed',
          'suppressed',
          'invalid_address',
          'duplicate',
          'not_eligible',
          'other'
        )
      )
    ),
  CONSTRAINT csf_communication_recipient_snapshots_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX csf_communication_recipient_snapshots_campaign_email_idx
  ON plugin_data.csf_communication_recipient_snapshots (
    organization_id,
    campaign_id,
    normalized_recipient_email
  );

CREATE INDEX csf_communication_recipient_snapshots_email_lookup_idx
  ON plugin_data.csf_communication_recipient_snapshots (
    organization_id,
    normalized_recipient_email,
    created_at DESC
  );

CREATE INDEX csf_communication_recipient_snapshots_profile_idx
  ON plugin_data.csf_communication_recipient_snapshots (organization_id, profile_id)
  WHERE profile_id IS NOT NULL;

CREATE INDEX csf_communication_recipient_snapshots_user_idx
  ON plugin_data.csf_communication_recipient_snapshots (user_id)
  WHERE user_id IS NOT NULL;

CREATE TABLE plugin_data.csf_communication_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL,
  recipient_snapshot_id uuid NOT NULL,
  provider_message_id text,
  provider_idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_communication_deliveries_id_organization_id_key
    UNIQUE (id, organization_id),
  CONSTRAINT csf_communication_deliveries_campaign_recipient_key
    UNIQUE (organization_id, campaign_id, recipient_snapshot_id),
  CONSTRAINT csf_communication_deliveries_idempotency_key
    UNIQUE (organization_id, provider_idempotency_key),
  CONSTRAINT csf_communication_deliveries_campaign_fkey
    FOREIGN KEY (campaign_id, organization_id)
    REFERENCES plugin_data.csf_communication_campaigns (id, organization_id)
    ON DELETE CASCADE,
  -- The snapshot must belong to the same organization AND the same campaign, so
  -- a delivery can never quote one campaign's audience row under another
  -- campaign's identity.
  CONSTRAINT csf_communication_deliveries_recipient_fkey
    FOREIGN KEY (recipient_snapshot_id, organization_id, campaign_id)
    REFERENCES plugin_data.csf_communication_recipient_snapshots
      (id, organization_id, campaign_id)
    ON DELETE CASCADE,
  CONSTRAINT csf_communication_deliveries_status_check
    CHECK (status IN (
      'queued',
      'sent',
      'delivered',
      'bounced',
      'complained',
      'suppressed',
      'failed'
    )),
  CONSTRAINT csf_communication_deliveries_attempt_count_check
    CHECK (attempt_count >= 0),
  CONSTRAINT csf_communication_deliveries_idempotency_shape_check
    CHECK (
      nullif(btrim(provider_idempotency_key), '') IS NOT NULL
      AND char_length(provider_idempotency_key) <= 256
    ),
  CONSTRAINT csf_communication_deliveries_last_error_bounded_check
    CHECK (last_error IS NULL OR char_length(last_error) <= 1000),
  CONSTRAINT csf_communication_deliveries_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX csf_communication_deliveries_provider_message_idx
  ON plugin_data.csf_communication_deliveries (organization_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX csf_communication_deliveries_queue_idx
  ON plugin_data.csf_communication_deliveries (
    organization_id,
    status,
    queued_at,
    id
  );

CREATE INDEX csf_communication_deliveries_campaign_status_idx
  ON plugin_data.csf_communication_deliveries (organization_id, campaign_id, status);

CREATE INDEX csf_communication_deliveries_recipient_idx
  ON plugin_data.csf_communication_deliveries (organization_id, recipient_snapshot_id);

-- Sanitized provider webhook evidence. Raw email bodies and attachments are
-- never stored here; only digests, typed metadata, and provider identifiers.
CREATE TABLE plugin_data.csf_communication_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  delivery_id uuid,
  provider text NOT NULL DEFAULT 'resend',
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  provider_message_id text,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload_hash text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The dedupe identity is the webhook envelope id, which is globally unique
  -- across organizations, so this key is deliberately not tenant-scoped.
  CONSTRAINT csf_communication_provider_events_provider_event_id_key
    UNIQUE (provider, provider_event_id),
  CONSTRAINT csf_communication_provider_events_delivery_fkey
    FOREIGN KEY (delivery_id, organization_id)
    REFERENCES plugin_data.csf_communication_deliveries (id, organization_id)
    ON DELETE SET NULL (delivery_id),
  CONSTRAINT csf_communication_provider_events_provider_check
    CHECK (provider = 'resend'),
  -- provider_event_id is the Svix envelope id, never the provider's message id.
  -- The inequality below makes that distinction structural rather than a naming
  -- convention: a writer that pastes the message id into this column fails.
  CONSTRAINT csf_communication_provider_events_event_id_shape_check
    CHECK (
      nullif(btrim(provider_event_id), '') IS NOT NULL
      AND provider_event_id = btrim(provider_event_id)
      AND provider_event_id !~ '\s'
      AND char_length(provider_event_id) <= 255
    ),
  CONSTRAINT csf_communication_provider_events_event_id_not_message_id_check
    CHECK (
      provider_message_id IS NULL
      OR provider_event_id <> provider_message_id
    ),
  CONSTRAINT csf_communication_provider_events_event_type_check
    CHECK (nullif(btrim(event_type), '') IS NOT NULL),
  CONSTRAINT csf_communication_provider_events_payload_hash_check
    CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  -- A linked event always names the message it describes; the trigger below
  -- then proves that name matches the delivery it is attached to.
  CONSTRAINT csf_communication_provider_events_linked_message_check
    CHECK (delivery_id IS NULL OR provider_message_id IS NOT NULL),
  CONSTRAINT csf_communication_provider_events_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT csf_communication_provider_events_no_raw_content_check
    CHECK (NOT plugin_data.csf_jsonb_carries_raw_content(metadata))
);

CREATE INDEX csf_communication_provider_events_message_idx
  ON plugin_data.csf_communication_provider_events (
    organization_id,
    provider_message_id,
    occurred_at DESC
  )
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX csf_communication_provider_events_delivery_idx
  ON plugin_data.csf_communication_provider_events (
    organization_id,
    delivery_id,
    occurred_at DESC
  )
  WHERE delivery_id IS NOT NULL;

CREATE INDEX csf_communication_provider_events_type_idx
  ON plugin_data.csf_communication_provider_events (
    organization_id,
    event_type,
    occurred_at DESC,
    id DESC
  );

COMMENT ON COLUMN plugin_data.csf_communication_provider_events.provider IS
  'Delivery provider that signed this webhook. Only Resend is supported today.';
COMMENT ON COLUMN plugin_data.csf_communication_provider_events.provider_event_id IS
  'Dedupe identity: the verified Svix webhook envelope id, taken from the svix-id header of a request whose signature Resend verified. It is not the payload email id and not provider_message_id, and a constraint rejects a row where the two are equal.';
COMMENT ON COLUMN plugin_data.csf_communication_provider_events.provider_message_id IS
  'Provider message identity this event describes. When delivery_id is set, a trigger requires this to equal that delivery''s provider_message_id.';
COMMENT ON COLUMN plugin_data.csf_communication_provider_events.payload_hash IS
  'Required SHA-256 of the exact verified webhook payload, so evidence can be re-verified without storing message content.';

-- ---------------------------------------------------------------------------
-- E. Term-scoped partner-club representatives
-- ---------------------------------------------------------------------------

CREATE TABLE plugin_data.csf_partner_club_representatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  partner_club_term_id uuid NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  profile_id uuid,
  source_import_row_id uuid,
  role text NOT NULL DEFAULT 'primary_contact',
  display_name text NOT NULL,
  email text NOT NULL,
  normalized_email text GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  status text NOT NULL DEFAULT 'invited',
  effective_start date NOT NULL DEFAULT current_date,
  effective_end date,
  is_primary boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_partner_club_representatives_id_organization_id_key
    UNIQUE (id, organization_id),
  -- Parent tuple for the recipient snapshot binding: a snapshot may only cite a
  -- representative of the very club term it also records.
  CONSTRAINT csf_partner_club_representatives_club_term_identity_key
    UNIQUE (id, organization_id, partner_club_term_id),
  CONSTRAINT csf_partner_club_representatives_club_term_fkey
    FOREIGN KEY (organization_id, partner_club_term_id)
    REFERENCES plugin_data.csf_partner_club_terms (organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT csf_partner_club_representatives_profile_fkey
    FOREIGN KEY (profile_id, organization_id)
    REFERENCES plugin_data.csf_profiles (id, organization_id)
    ON DELETE SET NULL (profile_id),
  CONSTRAINT csf_partner_club_representatives_import_row_fkey
    FOREIGN KEY (source_import_row_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_rows (id, organization_id)
    ON DELETE SET NULL (source_import_row_id),
  CONSTRAINT csf_partner_club_representatives_role_check
    CHECK (role IN ('primary_contact', 'president', 'adviser', 'coordinator', 'other')),
  CONSTRAINT csf_partner_club_representatives_status_check
    CHECK (status IN ('invited', 'active', 'revoked', 'expired')),
  CONSTRAINT csf_partner_club_representatives_display_name_check
    CHECK (nullif(btrim(display_name), '') IS NOT NULL),
  CONSTRAINT csf_partner_club_representatives_email_check
    CHECK (nullif(btrim(email), '') IS NOT NULL AND position('@' IN email) > 1),
  CONSTRAINT csf_partner_club_representatives_effective_range_check
    CHECK (effective_end IS NULL OR effective_end >= effective_start),
  -- A revoked assignment always records when it ended. This is date-independent
  -- and therefore safe as a CHECK; the rules that compare against the current
  -- date live in the trigger below instead.
  CONSTRAINT csf_partner_club_representatives_revoked_end_check
    CHECK (status <> 'revoked' OR effective_end IS NOT NULL),
  CONSTRAINT csf_partner_club_representatives_expired_end_check
    CHECK (status <> 'expired' OR effective_end IS NOT NULL),
  CONSTRAINT csf_partner_club_representatives_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

-- One account may represent many clubs, so there is deliberately no unique key
-- on (organization_id, user_id). What is unique per club term is: one live
-- assignment per address, one live assignment per signed-in account, and one
-- primary contact. All three predicates are status-only -- no current_date term
-- appears in an index predicate, so no index can silently stop matching rows
-- as the clock moves.
CREATE UNIQUE INDEX csf_partner_club_representatives_live_email_idx
  ON plugin_data.csf_partner_club_representatives (
    organization_id,
    partner_club_term_id,
    normalized_email
  )
  WHERE status IN ('invited', 'active');

-- Closes the "same person, two addresses" hole: one signed-in account cannot
-- hold two live assignments for the same club term under different emails.
CREATE UNIQUE INDEX csf_partner_club_representatives_live_account_idx
  ON plugin_data.csf_partner_club_representatives (
    organization_id,
    partner_club_term_id,
    user_id
  )
  WHERE user_id IS NOT NULL AND status IN ('invited', 'active');

CREATE UNIQUE INDEX csf_partner_club_representatives_single_primary_idx
  ON plugin_data.csf_partner_club_representatives (organization_id, partner_club_term_id)
  WHERE is_primary AND status IN ('invited', 'active');

CREATE INDEX csf_partner_club_representatives_active_account_idx
  ON plugin_data.csf_partner_club_representatives (
    organization_id,
    user_id,
    partner_club_term_id
  )
  WHERE user_id IS NOT NULL AND status = 'active';

CREATE INDEX csf_partner_club_representatives_club_term_roster_idx
  ON plugin_data.csf_partner_club_representatives (
    organization_id,
    partner_club_term_id,
    status,
    role
  );

CREATE INDEX csf_partner_club_representatives_email_lookup_idx
  ON plugin_data.csf_partner_club_representatives (organization_id, normalized_email, status);

CREATE INDEX csf_partner_club_representatives_user_idx
  ON plugin_data.csf_partner_club_representatives (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX csf_partner_club_representatives_profile_idx
  ON plugin_data.csf_partner_club_representatives (organization_id, profile_id)
  WHERE profile_id IS NOT NULL;

CREATE INDEX csf_partner_club_representatives_import_row_idx
  ON plugin_data.csf_partner_club_representatives (source_import_row_id)
  WHERE source_import_row_id IS NOT NULL;

-- Status and date coherence. current_date is stable rather than immutable, so
-- these rules are a trigger instead of a CHECK, and no unique index predicate
-- depends on them.
CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_representative_date_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'active' THEN
    IF NEW.effective_start > CURRENT_DATE THEN
      RAISE EXCEPTION
        'An active CSF partner-club representative cannot start in the future.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.effective_end IS NOT NULL AND NEW.effective_end < CURRENT_DATE THEN
      RAISE EXCEPTION
        'An active CSF partner-club representative cannot already be ended.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status = 'expired' AND NEW.effective_end > CURRENT_DATE THEN
    RAISE EXCEPTION
      'An expired CSF partner-club representative cannot end in the future.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_partner_club_representatives_date_state
BEFORE INSERT OR UPDATE ON plugin_data.csf_partner_club_representatives
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_enforce_representative_date_state();

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_representative_date_state()
  FROM PUBLIC, anon, authenticated;

-- Account/profile coherence. When an assignment claims both a signed-in account
-- and a CSF profile, that pairing must already exist as a verified link in the
-- same organization. This is a deferrable constraint trigger so an officer can
-- create the link and the assignment in one transaction in either order.
CREATE OR REPLACE FUNCTION plugin_data.csf_assert_representative_account_profile()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.user_id IS NULL OR NEW.profile_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_accounts AS link
    WHERE link.organization_id = NEW.organization_id
      AND link.profile_id = NEW.profile_id
      AND link.user_id = NEW.user_id
      AND link.status = 'verified'
  ) THEN
    RAISE EXCEPTION
      'A CSF partner-club representative that names both an account and a profile requires a verified profile link in the same organization.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER csf_partner_club_representatives_account_profile
AFTER INSERT OR UPDATE OF user_id, profile_id, organization_id
ON plugin_data.csf_partner_club_representatives
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_assert_representative_account_profile();

REVOKE ALL ON FUNCTION plugin_data.csf_assert_representative_account_profile()
  FROM PUBLIC, anon, authenticated;

-- Recipient snapshots may now bind to representatives. The representative link
-- carries partner_club_term_id so the snapshot cannot cite a representative of
-- a different club term, and the deferred pairing trigger closes the MATCH
-- SIMPLE hole where a null club term would skip that check entirely.
ALTER TABLE plugin_data.csf_communication_recipient_snapshots
  ADD CONSTRAINT csf_communication_recipient_snapshots_representative_fkey
    FOREIGN KEY (club_representative_id, organization_id, partner_club_term_id)
    REFERENCES plugin_data.csf_partner_club_representatives
      (id, organization_id, partner_club_term_id)
    ON DELETE SET NULL (club_representative_id),
  ADD CONSTRAINT csf_communication_recipient_snapshots_club_term_fkey
    FOREIGN KEY (organization_id, partner_club_term_id)
    REFERENCES plugin_data.csf_partner_club_terms (organization_id, id)
    ON DELETE SET NULL (partner_club_term_id);

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_snapshot_representative_pairing()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.club_representative_id IS NOT NULL AND NEW.partner_club_term_id IS NULL THEN
    RAISE EXCEPTION
      'A CSF audience snapshot that cites a partner-club representative must also record that representative''s club term.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

-- Deferred, because deleting a club term detaches partner_club_term_id and
-- cascades the representative away in an order Postgres does not promise. By
-- commit both columns are null and the pair is coherent again.
CREATE CONSTRAINT TRIGGER csf_communication_recipient_snapshots_pairing
AFTER INSERT OR UPDATE OF club_representative_id, partner_club_term_id
ON plugin_data.csf_communication_recipient_snapshots
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_assert_snapshot_representative_pairing();

REVOKE ALL ON FUNCTION plugin_data.csf_assert_snapshot_representative_pairing()
  FROM PUBLIC, anon, authenticated;

CREATE INDEX csf_communication_recipient_snapshots_representative_idx
  ON plugin_data.csf_communication_recipient_snapshots (club_representative_id)
  WHERE club_representative_id IS NOT NULL;

CREATE INDEX csf_communication_recipient_snapshots_club_term_idx
  ON plugin_data.csf_communication_recipient_snapshots (organization_id, partner_club_term_id)
  WHERE partner_club_term_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- F. Append-only partner-club lifecycle events
-- ---------------------------------------------------------------------------

CREATE TABLE plugin_data.csf_partner_club_term_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  partner_club_term_id uuid NOT NULL,
  event_type text NOT NULL,
  previous_workflow_status text,
  next_workflow_status text,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text,
  source_import_job_id uuid,
  communication_campaign_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_partner_club_term_events_idempotency_key
    UNIQUE (organization_id, idempotency_key),
  CONSTRAINT csf_partner_club_term_events_club_term_fkey
    FOREIGN KEY (organization_id, partner_club_term_id)
    REFERENCES plugin_data.csf_partner_club_terms (organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT csf_partner_club_term_events_import_job_fkey
    FOREIGN KEY (source_import_job_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_jobs (id, organization_id)
    ON DELETE SET NULL (source_import_job_id),
  CONSTRAINT csf_partner_club_term_events_campaign_fkey
    FOREIGN KEY (communication_campaign_id, organization_id)
    REFERENCES plugin_data.csf_communication_campaigns (id, organization_id)
    ON DELETE SET NULL (communication_campaign_id),
  -- Each operational step is its own event type. Current state is a projection
  -- over this stream, never an overwritten omnibus status column.
  CONSTRAINT csf_partner_club_term_events_event_type_check
    CHECK (event_type IN (
      'audit_submitted',
      'decision_recorded',
      'notification_recorded',
      'acknowledgment_recorded',
      'point_policy_published',
      'tracker_presence_recorded',
      'evidence_requested',
      'attendance_recorded',
      'hours_recorded',
      'photos_recorded',
      'completion_recorded',
      'award_proposed',
      'award_recorded',
      'standing_changed',
      'archived'
    )),
  CONSTRAINT csf_partner_club_term_events_previous_status_check
    CHECK (
      previous_workflow_status IS NULL
      OR previous_workflow_status IN ('pending', 'active', 'inactive', 'rejected', 'archived')
    ),
  CONSTRAINT csf_partner_club_term_events_next_status_check
    CHECK (
      next_workflow_status IS NULL
      OR next_workflow_status IN ('pending', 'active', 'inactive', 'rejected', 'archived')
    ),
  CONSTRAINT csf_partner_club_term_events_idempotency_shape_check
    CHECK (nullif(btrim(idempotency_key), '') IS NOT NULL),
  CONSTRAINT csf_partner_club_term_events_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX csf_partner_club_term_events_timeline_idx
  ON plugin_data.csf_partner_club_term_events (
    organization_id,
    partner_club_term_id,
    occurred_at DESC,
    id DESC
  );

CREATE INDEX csf_partner_club_term_events_type_idx
  ON plugin_data.csf_partner_club_term_events (
    organization_id,
    event_type,
    occurred_at DESC,
    id DESC
  );

CREATE INDEX csf_partner_club_term_events_import_job_idx
  ON plugin_data.csf_partner_club_term_events (source_import_job_id)
  WHERE source_import_job_id IS NOT NULL;

CREATE INDEX csf_partner_club_term_events_campaign_idx
  ON plugin_data.csf_partner_club_term_events (communication_campaign_id)
  WHERE communication_campaign_id IS NOT NULL;

-- Append-only history, with three narrow exceptions.
--
-- Deletes are rejected unless the subject of the history is itself gone -- a
-- cascade from the organization or the partner-club term removes the parent row
-- before the child cascade fires, so that case is teardown, not rewriting -- or
-- unless the authorized purge RPC holds its flag for this organization.
--
-- Updates are rejected unless the only change is an optional reference being
-- cleared by ON DELETE SET NULL after its target was removed. Without that
-- exception, deleting an actor account, an import job, or a campaign would fail
-- against this trigger instead of simply detaching the stale link. Recorded
-- content, typing, timing, and idempotency can never change.
CREATE OR REPLACE FUNCTION plugin_data.csf_reject_partner_club_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF plugin_data.csf_recovery_teardown_authorized(OLD.organization_id) THEN
      RETURN OLD;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.organizations AS organization
      WHERE organization.id = OLD.organization_id
    ) OR NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_partner_club_terms AS club_term
      WHERE club_term.organization_id = OLD.organization_id
        AND club_term.id = OLD.partner_club_term_id
    ) THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION 'CSF partner-club lifecycle events are append-only.';
  END IF;

  IF ROW(
    NEW.id,
    NEW.organization_id,
    NEW.partner_club_term_id,
    NEW.event_type,
    NEW.previous_workflow_status,
    NEW.next_workflow_status,
    NEW.reason,
    NEW.occurred_at,
    NEW.metadata,
    NEW.idempotency_key,
    NEW.correlation_id,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id,
    OLD.organization_id,
    OLD.partner_club_term_id,
    OLD.event_type,
    OLD.previous_workflow_status,
    OLD.next_workflow_status,
    OLD.reason,
    OLD.occurred_at,
    OLD.metadata,
    OLD.idempotency_key,
    OLD.correlation_id,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'CSF partner-club lifecycle events are append-only.';
  END IF;

  -- Nested conditions keep each existence lookup off the common path.
  IF NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id THEN
    IF NEW.actor_user_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM auth.users AS account WHERE account.id = OLD.actor_user_id
      )
    THEN
      RAISE EXCEPTION 'CSF partner-club lifecycle events are append-only.';
    END IF;
  END IF;

  IF NEW.source_import_job_id IS DISTINCT FROM OLD.source_import_job_id THEN
    IF NEW.source_import_job_id IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM plugin_data.csf_sheet_import_jobs AS job
        WHERE job.id = OLD.source_import_job_id
      )
    THEN
      RAISE EXCEPTION 'CSF partner-club lifecycle events are append-only.';
    END IF;
  END IF;

  IF NEW.communication_campaign_id IS DISTINCT FROM OLD.communication_campaign_id THEN
    IF NEW.communication_campaign_id IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM plugin_data.csf_communication_campaigns AS campaign
        WHERE campaign.id = OLD.communication_campaign_id
      )
    THEN
      RAISE EXCEPTION 'CSF partner-club lifecycle events are append-only.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_partner_club_term_events_append_only
BEFORE UPDATE OR DELETE ON plugin_data.csf_partner_club_term_events
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_reject_partner_club_event_mutation();

REVOKE ALL ON FUNCTION plugin_data.csf_reject_partner_club_event_mutation()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- G. Durable immutability and monotonic delivery truth
-- ---------------------------------------------------------------------------

-- A campaign is editable only while it is still a draft. The moment it leaves
-- draft, everything that describes what was sent and to whom is frozen, and the
-- status may only move forward: no terminal state ever returns to queued.
CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_campaign_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF plugin_data.csf_recovery_teardown_authorized(OLD.organization_id) THEN
      RETURN OLD;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.organizations AS organization
      WHERE organization.id = OLD.organization_id
    ) THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION
      'CSF campaign history cannot be deleted; use plugin_data.csf_purge_recovery_foundations().'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id THEN
    RAISE EXCEPTION 'CSF campaign identity is immutable.' USING ERRCODE = '23514';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
    AND NOT (
      (OLD.status = 'draft' AND NEW.status IN ('queued', 'cancelled'))
      OR (OLD.status = 'queued' AND NEW.status IN ('sending', 'completed', 'failed', 'cancelled'))
      OR (OLD.status = 'sending' AND NEW.status IN ('completed', 'failed', 'cancelled'))
    )
  THEN
    RAISE EXCEPTION
      'CSF campaign status may only advance through the send lifecycle; a settled campaign never returns to an earlier state.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status <> 'draft'
    AND ROW(
      NEW.campaign_kind, NEW.channel, NEW.sender_name, NEW.sender_email,
      NEW.reply_to_email, NEW.subject, NEW.body_text_hash, NEW.body_html_hash,
      NEW.resend_topic_id, NEW.audience_snapshot_version,
      NEW.provider_idempotency_key, NEW.metadata
    ) IS DISTINCT FROM ROW(
      OLD.campaign_kind, OLD.channel, OLD.sender_name, OLD.sender_email,
      OLD.reply_to_email, OLD.subject, OLD.body_text_hash, OLD.body_html_hash,
      OLD.resend_topic_id, OLD.audience_snapshot_version,
      OLD.provider_idempotency_key, OLD.metadata
    )
  THEN
    RAISE EXCEPTION
      'CSF campaign sender, reply-to, subject, content digests, topic, metadata, audience version, kind, channel, and provider idempotency key are frozen once the campaign leaves draft.'
      USING ERRCODE = '23514';
  END IF;

  IF (OLD.queued_at IS NOT NULL AND NEW.queued_at IS DISTINCT FROM OLD.queued_at)
    OR (OLD.sent_at IS NOT NULL AND NEW.sent_at IS DISTINCT FROM OLD.sent_at)
    OR (OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at)
  THEN
    RAISE EXCEPTION
      'CSF campaign lifecycle timestamps are recorded once and never rewritten.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_communication_campaigns_lifecycle
BEFORE UPDATE OR DELETE ON plugin_data.csf_communication_campaigns
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_enforce_campaign_lifecycle();

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_campaign_lifecycle()
  FROM PUBLIC, anon, authenticated;

-- A recipient snapshot is what a past audience was. It never changes after
-- insert. The only tolerated writes are ON DELETE SET NULL detaches whose
-- target is already gone, and authorized teardown.
CREATE OR REPLACE FUNCTION plugin_data.csf_reject_recipient_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF plugin_data.csf_recovery_teardown_authorized(OLD.organization_id) THEN
      RETURN OLD;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.organizations AS organization
      WHERE organization.id = OLD.organization_id
    ) OR NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_communication_campaigns AS campaign
      WHERE campaign.id = OLD.campaign_id
    ) THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION
      'CSF audience snapshots cannot be deleted; use plugin_data.csf_purge_recovery_foundations().'
      USING ERRCODE = '23514';
  END IF;

  -- normalized_recipient_email is generated and is not yet recomputed in a
  -- BEFORE trigger, so recipient_email stands in for it here.
  IF ROW(
    NEW.id, NEW.organization_id, NEW.campaign_id, NEW.snapshot_version,
    NEW.recipient_email, NEW.recipient_name, NEW.subscription_decision,
    NEW.exclusion_reason, NEW.metadata, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.organization_id, OLD.campaign_id, OLD.snapshot_version,
    OLD.recipient_email, OLD.recipient_name, OLD.subscription_decision,
    OLD.exclusion_reason, OLD.metadata, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'CSF audience snapshots are immutable after insert.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
    IF NEW.profile_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM plugin_data.csf_profiles AS profile
        WHERE profile.id = OLD.profile_id
      )
    THEN
      RAISE EXCEPTION 'CSF audience snapshots are immutable after insert.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    IF NEW.user_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = OLD.user_id)
    THEN
      RAISE EXCEPTION 'CSF audience snapshots are immutable after insert.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.club_representative_id IS DISTINCT FROM OLD.club_representative_id THEN
    IF NEW.club_representative_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM plugin_data.csf_partner_club_representatives AS representative
        WHERE representative.id = OLD.club_representative_id
      )
    THEN
      RAISE EXCEPTION 'CSF audience snapshots are immutable after insert.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.partner_club_term_id IS DISTINCT FROM OLD.partner_club_term_id THEN
    IF NEW.partner_club_term_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM plugin_data.csf_partner_club_terms AS club_term
        WHERE club_term.id = OLD.partner_club_term_id
      )
    THEN
      RAISE EXCEPTION 'CSF audience snapshots are immutable after insert.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_communication_recipient_snapshots_immutable
BEFORE UPDATE OR DELETE ON plugin_data.csf_communication_recipient_snapshots
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_reject_recipient_snapshot_mutation();

REVOKE ALL ON FUNCTION plugin_data.csf_reject_recipient_snapshot_mutation()
  FROM PUBLIC, anon, authenticated;

-- A delivery may exist only for a recipient the audience snapshot actually
-- included. A CHECK cannot read another table, so this is a trigger.
CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_delivery_recipient_included()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_decision text;
BEGIN
  SELECT snapshot.subscription_decision
  INTO v_decision
  FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
  WHERE snapshot.id = NEW.recipient_snapshot_id
    AND snapshot.organization_id = NEW.organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The CSF audience snapshot for this delivery does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  IF v_decision <> 'included' THEN
    RAISE EXCEPTION
      'A CSF delivery may only be created for an audience snapshot whose subscription decision is included.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_communication_deliveries_recipient_included
BEFORE INSERT OR UPDATE OF recipient_snapshot_id, organization_id
ON plugin_data.csf_communication_deliveries
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_enforce_delivery_recipient_included();

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_delivery_recipient_included()
  FROM PUBLIC, anon, authenticated;

-- Delivery truth only moves forward: identity is frozen once set, attempts
-- never decrease, timestamps are written once, and a successful or terminal row
-- can never return to queued or sent.
CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_delivery_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF plugin_data.csf_recovery_teardown_authorized(OLD.organization_id) THEN
      RETURN OLD;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.organizations AS organization
      WHERE organization.id = OLD.organization_id
    ) OR NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_communication_campaigns AS campaign
      WHERE campaign.id = OLD.campaign_id
    ) THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION
      'CSF delivery history cannot be deleted; use plugin_data.csf_purge_recovery_foundations().'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.id <> OLD.id
    OR NEW.organization_id <> OLD.organization_id
    OR NEW.campaign_id <> OLD.campaign_id
    OR NEW.recipient_snapshot_id <> OLD.recipient_snapshot_id
    OR NEW.provider_idempotency_key <> OLD.provider_idempotency_key
  THEN
    RAISE EXCEPTION
      'CSF delivery campaign, recipient, and idempotency identity are frozen once recorded.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.provider_message_id IS NOT NULL
    AND NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id
  THEN
    RAISE EXCEPTION
      'CSF delivery provider message identity is frozen once recorded.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.attempt_count < OLD.attempt_count THEN
    RAISE EXCEPTION 'CSF delivery attempt count can never decrease.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status IN (
      'queued',
      'sent',
      'delivered',
      'bounced',
      'complained',
      'suppressed',
      'failed'
    )
    AND NOT (
      (OLD.status = 'queued' AND NEW.status IN ('sent', 'bounced', 'suppressed', 'failed'))
      OR (OLD.status = 'sent' AND NEW.status IN ('delivered', 'bounced', 'complained', 'failed'))
      OR (OLD.status = 'delivered' AND NEW.status = 'complained')
    )
  THEN
    RAISE EXCEPTION
      'CSF delivery state may only advance; a delivered, bounced, complained, suppressed, or failed delivery never returns to queued or sent.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.queued_at IS DISTINCT FROM OLD.queued_at
    OR (OLD.sent_at IS NOT NULL AND NEW.sent_at IS DISTINCT FROM OLD.sent_at)
    OR (OLD.delivered_at IS NOT NULL AND NEW.delivered_at IS DISTINCT FROM OLD.delivered_at)
    OR (OLD.failed_at IS NOT NULL AND NEW.failed_at IS DISTINCT FROM OLD.failed_at)
  THEN
    RAISE EXCEPTION
      'CSF delivery lifecycle timestamps are recorded once and never rewritten.'
      USING ERRCODE = '23514';
  END IF;

  IF (NEW.sent_at IS NOT NULL AND NEW.sent_at < NEW.queued_at)
    OR (NEW.failed_at IS NOT NULL AND NEW.failed_at < NEW.queued_at)
    OR (
      NEW.delivered_at IS NOT NULL
      AND (NEW.sent_at IS NULL OR NEW.delivered_at < NEW.sent_at)
    )
  THEN
    RAISE EXCEPTION
      'CSF delivery lifecycle timestamps must be monotonic: queued, then sent, then delivered.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_communication_deliveries_lifecycle
BEFORE UPDATE OR DELETE ON plugin_data.csf_communication_deliveries
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_enforce_delivery_lifecycle();

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_delivery_lifecycle()
  FROM PUBLIC, anon, authenticated;

-- A provider event attached to a delivery must describe that delivery's own
-- provider message. Shared by the insert path and the one-time reconciliation.
CREATE OR REPLACE FUNCTION plugin_data.csf_assert_provider_event_delivery_match(
  p_organization_id uuid,
  p_delivery_id uuid,
  p_provider_message_id text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_message_id text;
BEGIN
  SELECT delivery.provider_message_id
  INTO v_message_id
  FROM plugin_data.csf_communication_deliveries AS delivery
  WHERE delivery.id = p_delivery_id
    AND delivery.organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The CSF delivery for this provider event does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  IF v_message_id IS NULL OR v_message_id IS DISTINCT FROM p_provider_message_id THEN
    RAISE EXCEPTION
      'A CSF provider event may only be attached to the delivery whose provider message identity it reports.'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_assert_provider_event_delivery_match(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_provider_event_binding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.delivery_id IS NOT NULL THEN
    PERFORM plugin_data.csf_assert_provider_event_delivery_match(
      NEW.organization_id, NEW.delivery_id, NEW.provider_message_id
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_communication_provider_events_binding
BEFORE INSERT ON plugin_data.csf_communication_provider_events
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_enforce_provider_event_binding();

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_provider_event_binding()
  FROM PUBLIC, anon, authenticated;

-- Provider evidence is append-only. Webhooks arrive out of order, so an event
-- recorded before its delivery row existed may be attached exactly once -- null
-- to a delivery that matches its provider message. Every other column, and
-- every other delivery_id transition, is frozen.
CREATE OR REPLACE FUNCTION plugin_data.csf_reject_provider_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF plugin_data.csf_recovery_teardown_authorized(OLD.organization_id) THEN
      RETURN OLD;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.organizations AS organization
      WHERE organization.id = OLD.organization_id
    ) THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION
      'CSF provider webhook evidence cannot be deleted; use plugin_data.csf_purge_recovery_foundations().'
      USING ERRCODE = '23514';
  END IF;

  IF ROW(
    NEW.id, NEW.organization_id, NEW.provider, NEW.provider_event_id,
    NEW.event_type, NEW.provider_message_id, NEW.occurred_at, NEW.received_at,
    NEW.payload_hash, NEW.metadata, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.organization_id, OLD.provider, OLD.provider_event_id,
    OLD.event_type, OLD.provider_message_id, OLD.occurred_at, OLD.received_at,
    OLD.payload_hash, OLD.metadata, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'CSF provider webhook evidence is append-only.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.delivery_id IS DISTINCT FROM OLD.delivery_id THEN
    IF OLD.delivery_id IS NULL AND NEW.delivery_id IS NOT NULL THEN
      -- The single permitted reconciliation: an out-of-order event finds the
      -- delivery it was always describing.
      PERFORM plugin_data.csf_assert_provider_event_delivery_match(
        NEW.organization_id, NEW.delivery_id, NEW.provider_message_id
      );
    ELSIF NEW.delivery_id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_communication_deliveries AS delivery
        WHERE delivery.id = OLD.delivery_id
      )
    THEN
      -- ON DELETE SET NULL detaching a delivery that is already gone.
      NULL;
    ELSE
      RAISE EXCEPTION
        'A CSF provider event may be attached to its delivery once and never re-pointed.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_communication_provider_events_append_only
BEFORE UPDATE OR DELETE ON plugin_data.csf_communication_provider_events
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_reject_provider_event_mutation();

REVOKE ALL ON FUNCTION plugin_data.csf_reject_provider_event_mutation()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- H. Server-only boundaries for every new plugin_data table
--
-- service_role receives exactly the four row privileges it needs. TRUNCATE
-- would bypass every immutability trigger in this migration in one statement,
-- and REFERENCES/TRIGGER would let a holder attach new structure to audited
-- history, so none of the three are granted to anyone.
-- ---------------------------------------------------------------------------

ALTER TABLE plugin_data.csf_partner_club_representatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_partner_club_term_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_communication_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_communication_recipient_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_communication_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_communication_provider_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  plugin_data.csf_partner_club_representatives,
  plugin_data.csf_partner_club_term_events,
  plugin_data.csf_communication_campaigns,
  plugin_data.csf_communication_recipient_snapshots,
  plugin_data.csf_communication_deliveries,
  plugin_data.csf_communication_provider_events
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  plugin_data.csf_partner_club_representatives,
  plugin_data.csf_partner_club_term_events,
  plugin_data.csf_communication_campaigns,
  plugin_data.csf_communication_recipient_snapshots,
  plugin_data.csf_communication_deliveries,
  plugin_data.csf_communication_provider_events
TO service_role;

-- ---------------------------------------------------------------------------
-- I. Authorized teardown
--
-- The only supported way to remove recovery-foundation history. It is
-- SECURITY DEFINER with an empty search_path, executable by service_role alone,
-- and it holds a transaction-local flag bound to one organization so the
-- immutability guards above stand down for exactly that tenant and no other.
--
-- It removes provider events, then deliveries, then audience snapshots, then
-- campaigns, then partner-club lifecycle events, then representatives, then the
-- CSF calendar projections. It never touches public.projects and never touches
-- a project_schedule calendar binding.
--
-- The final statement reads organization_calendar_events.source_kind, which
-- section J adds below. plpgsql resolves table and column names on first
-- execution rather than at CREATE time, so defining the RPC here is safe; the
-- column exists long before any caller can reach it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_purge_recovery_foundations(
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_provider_events integer := 0;
  v_deliveries integer := 0;
  v_snapshots integer := 0;
  v_campaigns integer := 0;
  v_club_term_events integer := 0;
  v_representatives integer := 0;
  v_calendar_events integer := 0;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'A CSF recovery purge requires an organization.'
      USING ERRCODE = '22004';
  END IF;

  PERFORM pg_catalog.set_config(
    'plugin_data.csf_recovery_purge_organization',
    p_organization_id::text,
    true
  );

  DELETE FROM plugin_data.csf_communication_provider_events AS provider_event
  WHERE provider_event.organization_id = p_organization_id;
  GET DIAGNOSTICS v_provider_events = ROW_COUNT;

  DELETE FROM plugin_data.csf_communication_deliveries AS delivery
  WHERE delivery.organization_id = p_organization_id;
  GET DIAGNOSTICS v_deliveries = ROW_COUNT;

  DELETE FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
  WHERE snapshot.organization_id = p_organization_id;
  GET DIAGNOSTICS v_snapshots = ROW_COUNT;

  DELETE FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.organization_id = p_organization_id;
  GET DIAGNOSTICS v_campaigns = ROW_COUNT;

  DELETE FROM plugin_data.csf_partner_club_term_events AS club_event
  WHERE club_event.organization_id = p_organization_id;
  GET DIAGNOSTICS v_club_term_events = ROW_COUNT;

  DELETE FROM plugin_data.csf_partner_club_representatives AS representative
  WHERE representative.organization_id = p_organization_id;
  GET DIAGNOSTICS v_representatives = ROW_COUNT;

  -- CSF projections only. project_schedule bindings and public.projects are
  -- deliberately out of scope: this RPC retires plugin projections, never the
  -- core scheduling records they were derived from.
  DELETE FROM public.organization_calendar_events AS calendar_event
  WHERE calendar_event.organization_id = p_organization_id
    AND calendar_event.source_kind IN (
      'csf_opportunity',
      'csf_meeting_session',
      'csf_deadline'
    );
  GET DIAGNOSTICS v_calendar_events = ROW_COUNT;

  PERFORM pg_catalog.set_config(
    'plugin_data.csf_recovery_purge_organization',
    '',
    true
  );

  RETURN pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'providerEvents', v_provider_events,
    'deliveries', v_deliveries,
    'recipientSnapshots', v_snapshots,
    'campaigns', v_campaigns,
    'partnerClubTermEvents', v_club_term_events,
    'partnerClubRepresentatives', v_representatives,
    'calendarProjections', v_calendar_events
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_purge_recovery_foundations(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_purge_recovery_foundations(uuid)
  TO service_role;

COMMENT ON TABLE plugin_data.csf_partner_club_representatives IS
  'Officer-issued, term-scoped partner-club representative assignments. One account may represent several clubs; representatives never receive grade, transcript, or chapter-wide membership access.';
COMMENT ON TABLE plugin_data.csf_partner_club_term_events IS
  'Append-only partner-club semester lifecycle stream. Audit, decision, notification, acknowledgment, policy, tracker, evidence, attendance, hours, photos, completion, award, standing, and archive steps are separate events.';
COMMENT ON TABLE plugin_data.csf_communication_campaigns IS
  'Durable CSF email campaign record distinguishing transactional sends from broadcasts, with content digests and a provider idempotency key bounded to Resend''s 256-character limit.';
COMMENT ON TABLE plugin_data.csf_communication_recipient_snapshots IS
  'Immutable audience snapshot. A past campaign audience is reconstructed from these rows alone, never from a current mutable membership or roster join.';
COMMENT ON TABLE plugin_data.csf_communication_deliveries IS
  'Per-recipient delivery ledger with provider message identity, monotonic attempt count, write-once lifecycle timestamps, and a bounded last error.';
COMMENT ON TABLE plugin_data.csf_communication_provider_events IS
  'Deduplicated, sanitized Resend webhook events keyed by verified Svix envelope id. Raw email bodies and attachments are never stored at any nesting depth.';
COMMENT ON COLUMN plugin_data.csf_communication_campaigns.audience_snapshot_version IS
  'Audience snapshot revision this campaign published. Editable while the campaign is a draft, frozen thereafter, and bound to every recipient snapshot by composite foreign key.';
COMMENT ON FUNCTION plugin_data.csf_enforce_campaign_lifecycle() IS
  'Allows draft edits, freezes sender/content/topic/metadata/audience/kind/channel/idempotency once a campaign leaves draft, enforces forward-only status transitions, and blocks direct deletion.';
COMMENT ON FUNCTION plugin_data.csf_reject_recipient_snapshot_mutation() IS
  'Keeps audience snapshots immutable after insert, tolerating only referential detaches whose target is gone and authorized purge teardown.';
COMMENT ON FUNCTION plugin_data.csf_enforce_delivery_recipient_included() IS
  'Rejects a delivery for any audience snapshot whose subscription decision is not included.';
COMMENT ON FUNCTION plugin_data.csf_enforce_delivery_lifecycle() IS
  'Freezes delivery identity, forbids attempt-count regression, enforces forward-only state and write-once monotonic timestamps, and blocks direct deletion.';
COMMENT ON FUNCTION plugin_data.csf_reject_provider_event_mutation() IS
  'Keeps provider webhook evidence append-only, permitting exactly one null-to-matching delivery reconciliation for out-of-order webhooks.';
COMMENT ON FUNCTION plugin_data.csf_reject_partner_club_event_mutation() IS
  'Keeps partner-club lifecycle history append-only, tolerating only referential teardown: deletion of a removed organization or club term, clearing an optional actor, import-job, or campaign link whose target is already gone, and authorized purge teardown.';
COMMENT ON FUNCTION plugin_data.csf_purge_recovery_foundations(uuid) IS
  'Service-role-only authorized teardown of one organization''s recovery-foundation records and CSF calendar projections. Never deletes public.projects or project_schedule calendar bindings.';

-- ---------------------------------------------------------------------------
-- J. Generalized organization calendar bindings
--
-- Existing project rows, their project_id/schedule_id values, and the existing
-- unique constraint are preserved. Legacy writers that insert only
-- (organization_id, project_id, schedule_id, event_id) keep working: the source
-- binding trigger derives the new columns before constraints are evaluated.
-- ---------------------------------------------------------------------------

ALTER TABLE public.organization_calendar_events
  ADD COLUMN source_kind text NOT NULL DEFAULT 'project_schedule',
  ADD COLUMN source_id uuid,
  ADD COLUMN occurrence_key text;

UPDATE public.organization_calendar_events
SET
  source_kind = 'project_schedule',
  source_id = project_id,
  occurrence_key = schedule_id
WHERE source_id IS NULL
  OR occurrence_key IS NULL;

ALTER TABLE public.organization_calendar_events
  ALTER COLUMN source_id SET NOT NULL,
  ALTER COLUMN occurrence_key SET NOT NULL,
  ALTER COLUMN project_id DROP NOT NULL;

-- public.projects.id is already unique, so this composite adds no new
-- restriction on projects; it exists purely so a calendar binding can name the
-- project AND the organization in one referential check.
ALTER TABLE public.projects
  ADD CONSTRAINT projects_id_organization_id_key UNIQUE (id, organization_id);

ALTER TABLE public.organization_calendar_events
  ADD CONSTRAINT organization_calendar_events_source_kind_check
    CHECK (source_kind IN (
      'project_schedule',
      'csf_opportunity',
      'csf_meeting_session',
      'csf_deadline'
    )),
  ADD CONSTRAINT organization_calendar_events_occurrence_key_check
    CHECK (nullif(btrim(occurrence_key), '') IS NOT NULL),
  ADD CONSTRAINT organization_calendar_events_source_binding_check
    CHECK (
      (source_kind = 'project_schedule' AND project_id IS NOT NULL AND source_id = project_id)
      OR
      (source_kind <> 'project_schedule' AND project_id IS NULL)
    ),
  ADD CONSTRAINT organization_calendar_events_source_occurrence_key
    UNIQUE (organization_id, source_kind, source_id, occurrence_key),
  -- The pre-existing single-column organization_calendar_events_project_id_fkey
  -- is left in place with its ON DELETE CASCADE; this pairs the same relation
  -- with organization_id so organization A can never bind organization B's
  -- project.
  ADD CONSTRAINT organization_calendar_events_project_organization_fkey
    FOREIGN KEY (project_id, organization_id)
    REFERENCES public.projects (id, organization_id)
    ON DELETE CASCADE;

-- Lets the server find or retire every projection for one CSF source entity
-- without knowing its occurrence keys.
CREATE INDEX organization_calendar_events_source_lookup_idx
  ON public.organization_calendar_events (source_kind, source_id);

-- Derives the generalized coordinates for legacy writers, mirrors legacy
-- coordinate edits into them, and proves the named source actually exists in
-- this organization and in the table the source_kind claims.
--
-- This runs as the invoking role. Authenticated clients are confined to
-- project_schedule by both the source-binding CHECK and the RLS policies below,
-- so only the server role ever reaches the plugin_data branches.
CREATE OR REPLACE FUNCTION public.enforce_organization_calendar_event_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_exists boolean;
BEGIN
  NEW.source_kind := coalesce(nullif(btrim(NEW.source_kind), ''), 'project_schedule');

  IF TG_OP = 'UPDATE' THEN
    -- A legacy writer that repoints project_id or schedule_id must not leave
    -- the generalized coordinates describing the old binding.
    IF NEW.project_id IS DISTINCT FROM OLD.project_id
      AND NEW.source_kind = 'project_schedule'
    THEN
      NEW.source_id := NEW.project_id;
    END IF;

    IF NEW.schedule_id IS DISTINCT FROM OLD.schedule_id THEN
      NEW.occurrence_key := nullif(btrim(NEW.schedule_id), '');
    END IF;
  END IF;

  IF NEW.source_kind = 'project_schedule' THEN
    NEW.source_id := coalesce(NEW.source_id, NEW.project_id);
  END IF;

  -- schedule_id is never invented for a CSF projection beyond mirroring the
  -- occurrence key; occurrence_key is derived from schedule_id so legacy
  -- project sync keeps its exact stored value.
  NEW.occurrence_key := coalesce(
    nullif(btrim(NEW.occurrence_key), ''),
    nullif(btrim(NEW.schedule_id), '')
  );

  IF NEW.schedule_id IS NULL THEN
    NEW.schedule_id := NEW.occurrence_key;
  END IF;

  IF NEW.source_kind = 'project_schedule' THEN
    -- For a project binding the two representations are the same fact, so they
    -- are forced equal rather than merely defaulted.
    NEW.source_id := NEW.project_id;
    NEW.occurrence_key := NEW.schedule_id;
  END IF;

  IF NEW.source_id IS NULL THEN
    RAISE EXCEPTION 'A calendar binding must name the record it projects.'
      USING ERRCODE = '23502';
  END IF;

  IF NEW.source_kind = 'project_schedule' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.id = NEW.source_id
        AND project.organization_id = NEW.organization_id
    ) INTO v_exists;
  ELSIF NEW.source_kind = 'csf_opportunity' THEN
    SELECT EXISTS (
      SELECT 1
      FROM plugin_data.csf_opportunities AS opportunity
      WHERE opportunity.id = NEW.source_id
        AND opportunity.organization_id = NEW.organization_id
    ) INTO v_exists;
  ELSIF NEW.source_kind = 'csf_meeting_session' THEN
    SELECT EXISTS (
      SELECT 1
      FROM plugin_data.csf_meeting_sessions AS session
      WHERE session.id = NEW.source_id
        AND session.organization_id = NEW.organization_id
    ) INTO v_exists;
  ELSIF NEW.source_kind = 'csf_deadline' THEN
    SELECT EXISTS (
      SELECT 1
      FROM plugin_data.csf_term_deadlines AS deadline
      WHERE deadline.id = NEW.source_id
        AND deadline.organization_id = NEW.organization_id
    ) INTO v_exists;
  ELSE
    -- organization_calendar_events_source_kind_check owns the enumeration and
    -- rejects this row immediately after the trigger returns. Raising here too
    -- would only replace that constraint's diagnostic with a vaguer one.
    RETURN NEW;
  END IF;

  IF NOT v_exists THEN
    RAISE EXCEPTION
      'Calendar source % "%" does not exist in this organization.',
      NEW.source_kind, NEW.source_id
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_calendar_events_source_binding
BEFORE INSERT OR UPDATE ON public.organization_calendar_events
FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_calendar_event_source();

REVOKE ALL ON FUNCTION public.enforce_organization_calendar_event_source()
  FROM PUBLIC, anon, authenticated;

-- TRUNCATE would erase every calendar binding in one statement with no RLS
-- evaluation at all, and REFERENCES/TRIGGER would let a client attach its own
-- structure to a table the server projects into. Ordinary SELECT/INSERT/UPDATE/
-- DELETE are untouched and still governed by the policies below.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.organization_calendar_events
  FROM PUBLIC, anon, authenticated;

-- Client write authority stays limited to project schedule bindings, and only
-- for a member whose organization membership is currently active. CSF
-- projections are written only by the server role, which bypasses RLS; the
-- explicit service_role policy keeps that true if bypass is ever narrowed.
DROP POLICY IF EXISTS "Org admins/staff can create calendar events"
  ON public.organization_calendar_events;
CREATE POLICY "Org admins/staff can create calendar events"
  ON public.organization_calendar_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    source_kind = 'project_schedule'
    AND project_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_members AS om
      WHERE om.user_id = auth.uid()
        AND om.organization_id = organization_calendar_events.organization_id
        AND om.status = 'active'
        AND om.role::text IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Org admins/staff can update calendar events"
  ON public.organization_calendar_events;
CREATE POLICY "Org admins/staff can update calendar events"
  ON public.organization_calendar_events
  FOR UPDATE
  TO authenticated
  USING (
    source_kind = 'project_schedule'
    AND EXISTS (
      SELECT 1
      FROM public.organization_members AS om
      WHERE om.user_id = auth.uid()
        AND om.organization_id = organization_calendar_events.organization_id
        AND om.status = 'active'
        AND om.role::text IN ('admin', 'staff')
    )
  )
  WITH CHECK (
    source_kind = 'project_schedule'
    AND project_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_members AS om
      WHERE om.user_id = auth.uid()
        AND om.organization_id = organization_calendar_events.organization_id
        AND om.status = 'active'
        AND om.role::text IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Org admins/staff can delete calendar events"
  ON public.organization_calendar_events;
CREATE POLICY "Org admins/staff can delete calendar events"
  ON public.organization_calendar_events
  FOR DELETE
  TO authenticated
  USING (
    source_kind = 'project_schedule'
    AND EXISTS (
      SELECT 1
      FROM public.organization_members AS om
      WHERE om.user_id = auth.uid()
        AND om.organization_id = organization_calendar_events.organization_id
        AND om.status = 'active'
        AND om.role::text IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Server role manages calendar projections"
  ON public.organization_calendar_events;
CREATE POLICY "Server role manages calendar projections"
  ON public.organization_calendar_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON COLUMN public.organization_calendar_events.source_kind IS
  'Which published Let''s Assist record this calendar binding projects: project_schedule, csf_opportunity, csf_meeting_session, or csf_deadline.';
COMMENT ON COLUMN public.organization_calendar_events.source_id IS
  'Identifier of the source record, proven by trigger to exist in this organization and in the table source_kind names. Equals project_id for project schedule bindings.';
COMMENT ON COLUMN public.organization_calendar_events.occurrence_key IS
  'Stable per-occurrence key within one source record. Kept equal to schedule_id for project schedule bindings, including on legacy updates.';
COMMENT ON FUNCTION public.enforce_organization_calendar_event_source() IS
  'Derives and mirrors source_kind/source_id/occurrence_key so existing project calendar writers keep working unchanged, and proves the named source exists in the same organization and in the table its kind claims.';
COMMENT ON TABLE public.organization_calendar_events IS
  'Calendar bindings for published organization records. RUNTIME REQUIREMENT: the project reconciler in lib/organization/calendar-sync.ts must filter to source_kind = ''project_schedule'' before treating a row as untracked. SQL alone cannot prevent that reconciler from deleting a CSF projection''s remote Google event, because deletion of the remote event happens outside the database.';

-- ---------------------------------------------------------------------------
-- K. Audit target lookup
-- ---------------------------------------------------------------------------

CREATE INDEX csf_admin_audit_events_target_idx
  ON plugin_data.csf_admin_audit_events (
    organization_id,
    target_type,
    target_id,
    created_at DESC,
    id DESC
  );

COMMENT ON INDEX plugin_data.csf_admin_audit_events_target_idx IS
  'Newest-first audit history for one target record.';

COMMIT;
