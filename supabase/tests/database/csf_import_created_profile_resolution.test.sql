BEGIN;

SELECT plan(4);

SELECT has_function(
  'plugin_data',
  'csf_set_import_created_profile_resolution',
  ARRAY[]::text[],
  'created-profile import resolution trigger function exists'
);

SELECT function_lang_is(
  'plugin_data',
  'csf_set_import_created_profile_resolution',
  ARRAY[]::text[],
  'plpgsql',
  'created-profile import resolution is enforced in PostgreSQL'
);

SELECT function_privs_are(
  'plugin_data',
  'csf_set_import_created_profile_resolution',
  ARRAY[]::text[],
  'anon',
  ARRAY[]::text[],
  'anonymous clients cannot execute the internal trigger function'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger
    WHERE trigger.tgrelid = 'plugin_data.csf_sheet_import_rows'::regclass
      AND trigger.tgname =
        'csf_sheet_import_rows_attempt_created_profile_resolution'
      AND NOT trigger.tgisinternal
  ),
  'created-profile resolution trigger is installed on import rows'
);

SELECT * FROM finish();

ROLLBACK;
