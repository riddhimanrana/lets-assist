BEGIN;

SELECT plan(8);

SELECT ok(
  (
    SELECT procedure.proconfig @> ARRAY['search_path=""']::text[]
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid =
      'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid)'::regprocedure
  ),
  'the internal merge was refreshed with a fixed empty search path'
);

SELECT ok(
  (
    SELECT procedure.proconfig @> ARRAY['search_path=""']::text[]
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid =
      'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid,uuid)'::regprocedure
  ),
  'the request-aware merge wrapper was refreshed with a fixed empty search path'
);

SELECT function_privs_are(
  'plugin_data',
  'csf_merge_profiles',
  ARRAY['uuid', 'uuid', 'uuid', 'text', 'uuid'],
  'service_role',
  ARRAY[]::text[],
  'the internal merge remains unavailable to service role'
);

SELECT function_privs_are(
  'plugin_data',
  'csf_merge_profiles',
  ARRAY['uuid', 'uuid', 'uuid', 'text', 'uuid', 'uuid'],
  'service_role',
  ARRAY['EXECUTE'],
  'service role can call only the retry-safe merge wrapper'
);

SELECT ok(
  pg_get_functiondef(
    'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid)'::regprocedure
  ) LIKE '%plugin_data.csf_merge_profiles_workbook_links_base(%'
  AND pg_get_functiondef(
    'plugin_data.csf_merge_profiles_workbook_links_base(uuid,uuid,uuid,text,uuid)'::regprocedure
  ) LIKE '%plugin_data.csf_profile_merge_preview(%',
  'the workbook-link merge delegates to the private implementation that calls the canonical preview'
);

SELECT ok(
  (
    SELECT procedure.proconfig @> ARRAY['search_path=""']::text[]
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid =
      'plugin_data.csf_merge_profiles_workbook_links_base(uuid,uuid,uuid,text,uuid)'::regprocedure
  ),
  'the private workbook-link merge implementation retains its fixed empty search path'
);

SELECT function_privs_are(
  'plugin_data',
  'csf_merge_profiles_workbook_links_base',
  ARRAY['uuid', 'uuid', 'uuid', 'text', 'uuid'],
  'service_role',
  ARRAY[]::text[],
  'service role cannot bypass the workbook-link merge wrapper'
);

SELECT ok(
  pg_get_functiondef(
    'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid,uuid)'::regprocedure
  ) LIKE '%plugin_data.csf_merge_profiles(%',
  'the retry-safe wrapper calls the refreshed internal merge by name'
);

SELECT * FROM finish();

ROLLBACK;
