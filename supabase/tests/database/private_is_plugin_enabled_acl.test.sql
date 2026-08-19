-- The legacy private plugin predicate has no runtime caller. Keep its existing
-- fixed-path definer definition, but make execution owner-only until a reviewed
-- caller establishes a narrower role requirement.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(8);

SELECT extensions.ok(
  to_regprocedure('private.is_plugin_enabled(uuid,text)') IS NOT NULL,
  'the private plugin predicate retains its stable signature'
);

SELECT extensions.ok(
  (
    SELECT routine.prosecdef
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = 'private.is_plugin_enabled(uuid,text)'::regprocedure
  ),
  'the private plugin predicate remains a security definer'
);

SELECT extensions.is(
  (
    SELECT routine.proconfig
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = 'private.is_plugin_enabled(uuid,text)'::regprocedure
  ),
  ARRAY['search_path=""']::text[],
  'the security definer retains an empty search path'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    CROSS JOIN LATERAL pg_catalog.aclexplode(routine.proacl) AS acl
    WHERE routine.oid = 'private.is_plugin_enabled(uuid,text)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no direct execute grant on the private plugin predicate'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'private.is_plugin_enabled(uuid,text)',
    'EXECUTE'
  ),
  'anon cannot execute the private plugin predicate'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'private.is_plugin_enabled(uuid,text)',
    'EXECUTE'
  ),
  'authenticated cannot execute the private plugin predicate'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'private.is_plugin_enabled(uuid,text)',
    'EXECUTE'
  ),
  'service_role has no unused execute capability'
);

SELECT extensions.ok(
  has_function_privilege(
    'postgres',
    'private.is_plugin_enabled(uuid,text)',
    'EXECUTE'
  ),
  'the reviewed owner retains administrative execution'
);

SELECT * FROM extensions.finish();

ROLLBACK;
