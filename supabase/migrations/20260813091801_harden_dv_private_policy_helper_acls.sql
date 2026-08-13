-- AUD-043 follow-up: these fixed-path SECURITY DEFINER helpers are called only
-- from authenticated DV RLS policies. Preserve that policy dependency while
-- removing PostgreSQL's inherited PUBLIC execution and unused API-role grants.

BEGIN;

REVOKE ALL ON FUNCTION private.is_dv_student(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_dv_student(uuid)
  TO authenticated, postgres;

REVOKE ALL ON FUNCTION private.can_access_dv_household(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_access_dv_household(uuid)
  TO authenticated, postgres;

DO $$
DECLARE
  function_name text;
  function_record record;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'private.is_dv_student(uuid)',
    'private.can_access_dv_household(uuid)'
  ] LOOP
    SELECT
      routine.oid,
      routine.prosecdef,
      routine.proconfig,
      routine.proowner
    INTO function_record
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = pg_catalog.to_regprocedure(function_name);

    IF function_record.oid IS NULL THEN
      RAISE EXCEPTION '% is missing', function_name;
    END IF;

    IF NOT function_record.prosecdef
      OR function_record.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
    THEN
      RAISE EXCEPTION
        '% must remain a fixed-path security definer',
        function_name;
    END IF;

    IF function_record.proowner <> 'postgres'::regrole THEN
      RAISE EXCEPTION '% must remain owned by postgres', function_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(
        (
          SELECT routine.proacl
          FROM pg_catalog.pg_proc AS routine
          WHERE routine.oid = function_record.oid
        )
      ) AS acl
      WHERE acl.privilege_type = 'EXECUTE'
        AND acl.grantee NOT IN (
          'authenticated'::regrole,
          'postgres'::regrole
        )
    ) OR NOT pg_catalog.has_function_privilege(
      'authenticated',
      function_name,
      'EXECUTE'
    ) OR NOT pg_catalog.has_function_privilege(
      'postgres',
      function_name,
      'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      'anon',
      function_name,
      'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      'service_role',
      function_name,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        '% does not have the reviewed authenticated-plus-owner ACL',
        function_name;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION private.is_dv_student(uuid) IS
  'Fixed-path DV student predicate used only by authenticated RLS policies; executable by authenticated and owner postgres.';
COMMENT ON FUNCTION private.can_access_dv_household(uuid) IS
  'Fixed-path DV household predicate used only by authenticated RLS policies; executable by authenticated and owner postgres.';

COMMIT;
