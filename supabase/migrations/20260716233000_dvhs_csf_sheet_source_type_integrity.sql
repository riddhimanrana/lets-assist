-- Keep the typed import-source discriminator aligned with the legacy JSON
-- compatibility field. Contextual meeting and partner-club sources created
-- after source_type became NOT NULL previously inherited the class_history
-- default even though their settings recorded the correct workflow.

BEGIN;

UPDATE plugin_data.csf_sheet_sources
SET source_type = settings ->> 'sourceKind'
WHERE settings ->> 'sourceKind' IN (
    'application_responses',
    'student_roster',
    'class_history',
    'meeting_attendance',
    'partner_club_audit'
  )
  AND source_type IS DISTINCT FROM settings ->> 'sourceKind';

ALTER TABLE plugin_data.csf_sheet_sources
  DROP CONSTRAINT IF EXISTS csf_sheet_sources_source_kind_agreement_check,
  ADD CONSTRAINT csf_sheet_sources_source_kind_agreement_check CHECK (
    coalesce(nullif(settings ->> 'sourceKind', ''), source_type) = source_type
  ) NOT VALID;

ALTER TABLE plugin_data.csf_sheet_sources
  VALIDATE CONSTRAINT csf_sheet_sources_source_kind_agreement_check;

COMMENT ON CONSTRAINT csf_sheet_sources_source_kind_agreement_check
  ON plugin_data.csf_sheet_sources IS
  'When legacy settings.sourceKind is populated, it must agree with the canonical typed source_type column.';

COMMIT;
