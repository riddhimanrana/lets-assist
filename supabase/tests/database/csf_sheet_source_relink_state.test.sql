BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(9);

SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_reset_sheet_sync_state_on_source_change()') IS NOT NULL,
  'the sheet source identity reset trigger function exists'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger
    WHERE trigger.tgrelid = 'plugin_data.csf_sheet_sources'::regclass
      AND trigger.tgname = 'csf_sheet_sources_reset_sync_state_on_source_change'
      AND NOT trigger.tgisinternal
  ),
  'sheet sources run the identity reset trigger'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_reset_sheet_sync_state_on_source_change()',
    'EXECUTE'
  ),
  'anon cannot execute the trigger function'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_reset_sheet_sync_state_on_source_change()',
    'EXECUTE'
  ),
  'authenticated cannot execute the trigger function'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_reset_sheet_sync_state_on_source_change()',
    'EXECUTE'
  ),
  'service_role cannot call the trigger function directly'
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'eb100000-0000-4000-8000-000000000001',
  'Synthetic CSF relink state',
  'synthetic-csf-relink-state',
  'school',
  '996401'
);

INSERT INTO plugin_data.csf_sheet_sources (
  id,
  organization_id,
  source_type,
  title,
  provider,
  spreadsheet_id,
  drive_file_id,
  sync_mode,
  sync_status,
  last_sync_status,
  last_sync_error,
  last_synced_at,
  last_previewed_at,
  last_committed_at,
  settings
)
VALUES (
  'eb200000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000001',
  'class_history',
  'Synthetic Class · F25',
  'google_sheets',
  'synthetic-old-workbook',
  'synthetic-old-workbook',
  'manual',
  'healthy',
  'commit_completed',
  'old bounded error',
  '2026-01-01T00:00:00Z',
  '2026-01-02T00:00:00Z',
  '2026-01-03T00:00:00Z',
  '{"sourceKind":"class_history"}'::jsonb
);

UPDATE plugin_data.csf_sheet_sources
SET drive_file_name = 'Metadata refresh only'
WHERE id = 'eb200000-0000-4000-8000-000000000001';

SELECT extensions.is(
  (
    SELECT last_sync_status
    FROM plugin_data.csf_sheet_sources
    WHERE id = 'eb200000-0000-4000-8000-000000000001'
  ),
  'commit_completed',
  'metadata-only refreshes preserve the prior sync state'
);

UPDATE plugin_data.csf_sheet_sources
SET spreadsheet_id = 'synthetic-new-workbook',
    drive_file_id = 'synthetic-new-workbook'
WHERE id = 'eb200000-0000-4000-8000-000000000001';

SELECT extensions.results_eq(
  $$
    SELECT sync_status, last_sync_status, last_sync_error
    FROM plugin_data.csf_sheet_sources
    WHERE id = 'eb200000-0000-4000-8000-000000000001'
  $$,
  $$ VALUES ('not_synced'::text, 'source_saved'::text, NULL::text) $$,
  'a replacement workbook resets status and clears the prior error'
);

SELECT extensions.ok(
  (
    SELECT last_synced_at IS NULL
      AND last_previewed_at IS NULL
      AND last_committed_at IS NULL
    FROM plugin_data.csf_sheet_sources
    WHERE id = 'eb200000-0000-4000-8000-000000000001'
  ),
  'a replacement workbook clears all prior preview and commit timestamps'
);

UPDATE plugin_data.csf_sheet_sources
SET sync_mode = 'disabled',
    spreadsheet_id = 'synthetic-disabled-workbook',
    drive_file_id = 'synthetic-disabled-workbook'
WHERE id = 'eb200000-0000-4000-8000-000000000001';

SELECT extensions.results_eq(
  $$
    SELECT sync_status, last_sync_status
    FROM plugin_data.csf_sheet_sources
    WHERE id = 'eb200000-0000-4000-8000-000000000001'
  $$,
  $$ VALUES ('disabled'::text, 'unlinked'::text) $$,
  'a replacement disabled source remains disabled and unsynced'
);

SELECT * FROM extensions.finish();

ROLLBACK;
