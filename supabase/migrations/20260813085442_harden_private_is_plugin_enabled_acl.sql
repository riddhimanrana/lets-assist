-- AUD-043: private.is_plugin_enabled is a fixed-path SECURITY DEFINER created
-- by the historical plugin schema migration. A repository-wide caller scan
-- finds no runtime caller, so neither browser roles nor service_role need an
-- execution capability. Keep the stable definition and make the dormant helper
-- owner-only until a future caller establishes and tests a narrower role.

BEGIN;

REVOKE ALL ON FUNCTION private.is_plugin_enabled(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_plugin_enabled(uuid, text)
  TO postgres;

DO $$
DECLARE
  function_record record;
BEGIN
  SELECT
    routine.prosecdef,
    routine.proconfig
  INTO function_record
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = 'private.is_plugin_enabled(uuid,text)'::regprocedure;

  IF NOT function_record.prosecdef
    OR function_record.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  THEN
    RAISE EXCEPTION
      'private.is_plugin_enabled must remain a fixed-path security definer';
  END IF;

  IF pg_catalog.has_function_privilege(
    'anon',
    'private.is_plugin_enabled(uuid,text)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated',
    'private.is_plugin_enabled(uuid,text)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'service_role',
    'private.is_plugin_enabled(uuid,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'private.is_plugin_enabled retains an unreviewed execute capability';
  END IF;
END;
$$;

COMMENT ON FUNCTION private.is_plugin_enabled(uuid, text) IS
  'Dormant fixed-path plugin-install predicate; owner-only until a reviewed caller establishes a narrower execution role.';

COMMIT;
