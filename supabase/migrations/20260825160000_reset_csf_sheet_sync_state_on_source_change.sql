-- Clear obsolete preview and commit evidence when a CSF source changes files.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_reset_sheet_sync_state_on_source_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.spreadsheet_id IS DISTINCT FROM OLD.spreadsheet_id
    OR NEW.drive_file_id IS DISTINCT FROM OLD.drive_file_id
    OR NEW.uploaded_file_path IS DISTINCT FROM OLD.uploaded_file_path
  THEN
    NEW.last_synced_at := NULL;
    NEW.last_previewed_at := NULL;
    NEW.last_committed_at := NULL;
    NEW.last_sync_error := NULL;
    NEW.sync_status := CASE
      WHEN NEW.sync_mode = 'disabled' THEN 'disabled'
      ELSE 'not_synced'
    END;
    NEW.last_sync_status := CASE
      WHEN NEW.sync_mode = 'disabled' THEN 'unlinked'
      ELSE 'source_saved'
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS csf_sheet_sources_reset_sync_state_on_source_change
  ON plugin_data.csf_sheet_sources;
CREATE TRIGGER csf_sheet_sources_reset_sync_state_on_source_change
  BEFORE UPDATE OF spreadsheet_id, drive_file_id, uploaded_file_path
  ON plugin_data.csf_sheet_sources
  FOR EACH ROW
  EXECUTE FUNCTION plugin_data.csf_reset_sheet_sync_state_on_source_change();

ALTER FUNCTION plugin_data.csf_reset_sheet_sync_state_on_source_change() OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_reset_sheet_sync_state_on_source_change()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_reset_sheet_sync_state_on_source_change()
  TO postgres;

COMMIT;
