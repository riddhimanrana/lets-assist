BEGIN;

SELECT plan(8);

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

SELECT ok(
  pg_get_functiondef(
    'plugin_data.csf_create_profile_for_application_import_row(uuid,uuid,uuid,uuid,text)'::regprocedure
  ) LIKE '%''rowId'', p_row_id%'
  AND pg_get_functiondef(
    'plugin_data.csf_create_profile_for_application_import_row(uuid,uuid,uuid,uuid,text)'::regprocedure
  ) LIKE '%''reason'', v_reason%',
  'the request fingerprint binds the operation to its import row and reviewed reason'
);

SELECT has_index(
  'plugin_data',
  'csf_admin_audit_events',
  'csf_application_profile_create_request_idx',
  'application profile-create receipts enforce one durable request binding'
);

SELECT * FROM finish();

ROLLBACK;
