-- Record the frozen officer as the resolver when an authoritative import write
-- creates the profile for a previously unmatched preview row.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_set_import_created_profile_resolution()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.commit_frozen_at IS NOT NULL
    AND OLD.commit_target_profile_id IS NULL
    AND OLD.matched_profile_id IS NULL
    AND NEW.matched_profile_id IS NOT NULL
    AND OLD.commit_outcome_state = 'in_flight'
    AND OLD.commit_intent_attempt_id IS NOT NULL
    AND OLD.import_status = 'pending'
    AND NEW.import_status IN ('created', 'updated')
    AND NEW.resolved_by IS NULL
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_profiles AS profile
      WHERE profile.organization_id = OLD.organization_id
        AND profile.id = NEW.matched_profile_id
        AND profile.source_summary->>'importRowId' = OLD.id::text
    )
  THEN
    NEW.resolution_status := 'resolved';
    NEW.resolution_reason_code := 'commit_created_profile';
    NEW.resolution_notes :=
      'The approved import commit created this CSF member from the frozen row.';
    NEW.resolved_by := OLD.commit_frozen_actor_user_id;
    NEW.resolved_at := pg_catalog.now();
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_set_import_created_profile_resolution()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS csf_sheet_import_rows_attempt_created_profile_resolution
  ON plugin_data.csf_sheet_import_rows;
CREATE TRIGGER csf_sheet_import_rows_attempt_created_profile_resolution
BEFORE UPDATE ON plugin_data.csf_sheet_import_rows
FOR EACH ROW
EXECUTE FUNCTION plugin_data.csf_set_import_created_profile_resolution();

COMMENT ON FUNCTION plugin_data.csf_set_import_created_profile_resolution() IS
  'Stamps the frozen officer resolution when an authoritative in-flight import creates a profile whose source lineage names the exact preview row.';

COMMIT;
