-- Preserve immutable Drive provenance and explicit targeting for CSF imports.
-- These records remain server-only in plugin_data; the browser never receives
-- Google access tokens or unrestricted source rows.

BEGIN;

ALTER TABLE plugin_data.csf_sheet_sources
  ADD COLUMN IF NOT EXISTS target_strategy text NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS drive_mime_type text,
  ADD COLUMN IF NOT EXISTS drive_web_view_link text,
  ADD COLUMN IF NOT EXISTS drive_trashed boolean,
  ADD COLUMN IF NOT EXISTS drive_access_state text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS drive_access_checked_at timestamptz;

ALTER TABLE plugin_data.csf_sheet_sources
  DROP CONSTRAINT IF EXISTS csf_sheet_sources_target_strategy_check,
  ADD CONSTRAINT csf_sheet_sources_target_strategy_check
    CHECK (target_strategy IN ('fixed', 'derive_from_grade')),
  DROP CONSTRAINT IF EXISTS csf_sheet_sources_drive_access_state_check,
  ADD CONSTRAINT csf_sheet_sources_drive_access_state_check
    CHECK (drive_access_state IN ('accessible', 'reconnect_required', 'not_found', 'trashed', 'unknown'));

ALTER TABLE plugin_data.csf_sheet_import_jobs
  ADD COLUMN IF NOT EXISTS source_file_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE plugin_data.csf_sheet_import_jobs
  DROP CONSTRAINT IF EXISTS csf_sheet_import_jobs_source_file_metadata_object_check,
  ADD CONSTRAINT csf_sheet_import_jobs_source_file_metadata_object_check
    CHECK (jsonb_typeof(source_file_metadata) = 'object');

ALTER TABLE plugin_data.csf_application_files
  ADD COLUMN IF NOT EXISTS drive_mime_type text,
  ADD COLUMN IF NOT EXISTS drive_web_view_link text,
  ADD COLUMN IF NOT EXISTS drive_trashed boolean,
  ADD COLUMN IF NOT EXISTS drive_access_state text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS drive_access_checked_at timestamptz;

ALTER TABLE plugin_data.csf_application_files
  DROP CONSTRAINT IF EXISTS csf_application_files_drive_access_state_check,
  ADD CONSTRAINT csf_application_files_drive_access_state_check
    CHECK (drive_access_state IN ('accessible', 'reconnect_required', 'not_found', 'trashed', 'unknown'));

CREATE UNIQUE INDEX IF NOT EXISTS csf_sheet_sources_derived_file_title_unique
  ON plugin_data.csf_sheet_sources (organization_id, spreadsheet_id, title)
  WHERE cohort_id IS NULL AND spreadsheet_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS csf_sheet_import_jobs_source_history_idx
  ON plugin_data.csf_sheet_import_jobs (
    organization_id,
    source_type,
    source_id,
    created_at DESC,
    id DESC
  );

CREATE OR REPLACE FUNCTION plugin_data.csf_reject_import_provenance_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, plugin_data
AS $$
BEGIN
  IF NEW.source_file_id IS DISTINCT FROM OLD.source_file_id
    OR NEW.source_file_name IS DISTINCT FROM OLD.source_file_name
    OR NEW.source_sheet_tab IS DISTINCT FROM OLD.source_sheet_tab
    OR NEW.source_range IS DISTINCT FROM OLD.source_range
    OR NEW.source_modified_at IS DISTINCT FROM OLD.source_modified_at
    OR NEW.source_file_metadata IS DISTINCT FROM OLD.source_file_metadata
    OR NEW.mapping_snapshot IS DISTINCT FROM OLD.mapping_snapshot
    OR NEW.mapping_version IS DISTINCT FROM OLD.mapping_version
    OR NEW.retry_of_job_id IS DISTINCT FROM OLD.retry_of_job_id
    OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
  THEN
    RAISE EXCEPTION 'CSF import provenance is immutable; create a retry job instead'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS csf_sheet_import_jobs_immutable_provenance
  ON plugin_data.csf_sheet_import_jobs;
CREATE TRIGGER csf_sheet_import_jobs_immutable_provenance
  BEFORE UPDATE ON plugin_data.csf_sheet_import_jobs
  FOR EACH ROW
  EXECUTE FUNCTION plugin_data.csf_reject_import_provenance_mutation();

ALTER TABLE plugin_data.csf_sheet_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_sheet_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_application_files ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  plugin_data.csf_sheet_sources,
  plugin_data.csf_sheet_import_jobs,
  plugin_data.csf_application_files
FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE
  plugin_data.csf_sheet_sources,
  plugin_data.csf_sheet_import_jobs,
  plugin_data.csf_application_files
TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_reject_import_provenance_mutation()
  FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN plugin_data.csf_sheet_sources.target_strategy IS
  'Whether all rows target one configured cohort or each application row derives its cohort from grade and term.';
COMMENT ON COLUMN plugin_data.csf_sheet_import_jobs.source_file_metadata IS
  'Immutable Drive metadata snapshot captured when this explicit preview or commit job was created.';
COMMENT ON FUNCTION plugin_data.csf_reject_import_provenance_mutation() IS
  'Prevents an import job from silently changing the Drive file, tab, range, mapping, or retry lineage it represents.';

COMMIT;
