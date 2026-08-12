-- AUD-035: plugin_data is server-only. Close the legacy browser grants on
-- existing objects and on objects created later by the postgres migration role.
BEGIN;

REVOKE ALL ON SCHEMA plugin_data FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA plugin_data
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA plugin_data
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA plugin_data
  FROM PUBLIC, anon, authenticated;

-- PostgreSQL's built-in function default grants EXECUTE to PUBLIC globally.
-- A schema-local default REVOKE cannot subtract that global default, so close
-- it for the migration owner. Reviewed client-callable functions already use
-- explicit grants and every future function must do the same.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA plugin_data
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA plugin_data
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA plugin_data
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon'::text, 'authenticated'::text]
  LOOP
    IF has_schema_privilege(client_role, 'plugin_data', 'USAGE') THEN
      RAISE EXCEPTION '% retains plugin_data schema usage', client_role;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS function_record
    JOIN pg_namespace AS namespace
      ON namespace.oid = function_record.pronamespace
    CROSS JOIN unnest(ARRAY['anon'::text, 'authenticated'::text]) AS client(role_name)
    WHERE namespace.nspname = 'plugin_data'
      AND has_function_privilege(client.role_name, function_record.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'a browser role retains plugin_data function execution';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_default_acl AS default_acl
    JOIN pg_namespace AS namespace
      ON namespace.oid = default_acl.defaclnamespace
    CROSS JOIN LATERAL aclexplode(default_acl.defaclacl) AS acl
    LEFT JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
    WHERE namespace.nspname = 'plugin_data'
      AND (acl.grantee = 0 OR grantee.rolname IN ('anon', 'authenticated'))
  ) THEN
    RAISE EXCEPTION 'plugin_data retains browser-facing default privileges';
  END IF;
END;
$$;

COMMIT;
