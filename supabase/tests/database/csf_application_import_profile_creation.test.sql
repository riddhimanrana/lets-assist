BEGIN;

SELECT plan(6);

SELECT has_function(
  'plugin_data',
  'csf_create_profile_for_application_import_row',
  ARRAY['uuid', 'uuid', 'uuid', 'uuid', 'text'],
  'application imports expose the reviewed unclaimed-profile creation RPC'
);

SELECT function_lang_is(
  'plugin_data',
  'csf_create_profile_for_application_import_row',
  ARRAY['uuid', 'uuid', 'uuid', 'uuid', 'text'],
  'plpgsql',
  'application import profile creation runs in PostgreSQL'
);

SELECT ok(
  (
    SELECT procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=""']::text[]
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid =
      'plugin_data.csf_create_profile_for_application_import_row(uuid,uuid,uuid,uuid,text)'::regprocedure
  ),
  'application import profile creation rechecks authority inside a security definer'
);

SELECT function_privs_are(
  'plugin_data',
  'csf_create_profile_for_application_import_row',
  ARRAY['uuid', 'uuid', 'uuid', 'uuid', 'text'],
  'anon',
  ARRAY[]::text[],
  'anonymous clients cannot create profiles from application imports'
);

SELECT function_privs_are(
  'plugin_data',
  'csf_create_profile_for_application_import_row',
  ARRAY['uuid', 'uuid', 'uuid', 'uuid', 'text'],
  'authenticated',
  ARRAY[]::text[],
  'browser-authenticated clients cannot create profiles from application imports'
);

SELECT function_privs_are(
  'plugin_data',
  'csf_create_profile_for_application_import_row',
  ARRAY['uuid', 'uuid', 'uuid', 'uuid', 'text'],
  'service_role',
  ARRAY['EXECUTE'],
  'only the service boundary may invoke application import profile creation'
);

SELECT * FROM finish();

ROLLBACK;
