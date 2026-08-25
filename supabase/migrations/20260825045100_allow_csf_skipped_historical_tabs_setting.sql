-- Historical class-sheet discovery records the tabs it deliberately skipped so
-- officers can distinguish an absent semester from a malformed one. The
-- application has emitted this caller-owned setting since the discovery flow
-- was added, but the registry's closed settings schema did not admit it. That
-- mismatch rejected every class-sheet link before any source could be saved.

CREATE OR REPLACE FUNCTION plugin_data.csf_sheet_source_settings_schema()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT '{
    "sourceKind": "string",
    "sourceVariant": "string",
    "targetStrategy": "string",
    "mappingVersion": "number",
    "headerRow": "number",
    "selectedTabs": "array",
    "availableTabs": "array",
    "visibleTabs": "array",
    "hiddenTabCount": "number",
    "workbookFormat": "string",
    "fileHash": "string",
    "contentHash": "string",
    "meetingId": "string",
    "termId": "string",
    "partnerClubId": "string",
    "batchId": "string",
    "latestPreviewJobId": "string",
    "sheetImportSourceId": "string",
    "sheetImportPreviewJobId": "string",
    "sheetImportCorrelationId": "string",
    "skippedHistoricalTabs": "array"
  }'::jsonb;
$$;

COMMENT ON FUNCTION plugin_data.csf_sheet_source_settings_schema() IS
  'The closed caller-owned settings vocabulary for CSF import sources. Historical discovery may record skippedHistoricalTabs; attachment and provider-evidence coordinates remain system-owned and excluded.';

REVOKE ALL ON FUNCTION plugin_data.csf_sheet_source_settings_schema()
  FROM PUBLIC, anon, authenticated, service_role;
