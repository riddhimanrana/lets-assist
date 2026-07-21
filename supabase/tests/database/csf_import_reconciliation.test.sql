BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(12);

SELECT extensions.has_column('plugin_data', 'csf_sheet_sources', 'target_strategy', 'sources record a fixed or grade-derived target strategy');
SELECT extensions.has_column('plugin_data', 'csf_sheet_sources', 'drive_access_state', 'sources record the last Drive access state');
SELECT extensions.has_column('plugin_data', 'csf_sheet_sources', 'drive_web_view_link', 'sources preserve the Drive web link');
SELECT extensions.has_column('plugin_data', 'csf_sheet_import_jobs', 'source_file_metadata', 'jobs preserve an immutable Drive metadata snapshot');
SELECT extensions.has_column('plugin_data', 'csf_application_files', 'drive_access_state', 'application evidence records its Drive access state');

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'plugin_data.csf_sheet_import_jobs'::regclass
      AND tgname = 'csf_sheet_import_jobs_immutable_provenance'
      AND NOT tgisinternal
  ),
  'import jobs reject provenance mutation through a database trigger'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'plugin_data'
      AND tablename = 'csf_sheet_import_jobs'
      AND indexname = 'csf_sheet_import_jobs_source_history_idx'
  ),
  'source-specific import history has a cursor-order index'
);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'plugin_data.csf_sheet_sources', 'SELECT'),
  'anonymous clients cannot read Drive import sources'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'plugin_data.csf_sheet_sources', 'SELECT'),
  'authenticated clients cannot read Drive import sources directly'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon', 'plugin_data.csf_sheet_import_jobs', 'SELECT'),
  'anonymous clients cannot read import jobs'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'plugin_data.csf_sheet_import_jobs', 'SELECT'),
  'authenticated clients cannot read import jobs directly'
);
SELECT extensions.ok(
  has_table_privilege('service_role', 'plugin_data.csf_sheet_import_jobs', 'SELECT,INSERT,UPDATE,DELETE'),
  'the server role can operate import jobs behind permission-checked actions'
);

SELECT * FROM extensions.finish();
ROLLBACK;
