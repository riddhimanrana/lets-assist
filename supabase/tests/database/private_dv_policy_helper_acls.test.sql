-- The two DV identity helpers are fixed-path definers called by authenticated
-- RLS policies. Their executable surface is exactly authenticated plus owner.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(20);

SELECT extensions.ok(
  to_regprocedure('private.is_dv_student(uuid)') IS NOT NULL,
  'the private DV student predicate retains its stable signature'
);

SELECT extensions.ok(
  to_regprocedure('private.can_access_dv_household(uuid)') IS NOT NULL,
  'the private DV household predicate retains its stable signature'
);

SELECT extensions.ok(
  (
    SELECT routine.prosecdef
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = 'private.is_dv_student(uuid)'::regprocedure
  ),
  'the private DV student predicate remains a security definer'
);

SELECT extensions.ok(
  (
    SELECT routine.prosecdef
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = 'private.can_access_dv_household(uuid)'::regprocedure
  ),
  'the private DV household predicate remains a security definer'
);

SELECT extensions.is(
  (
    SELECT routine.proconfig
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = 'private.is_dv_student(uuid)'::regprocedure
  ),
  ARRAY['search_path=""']::text[],
  'the private DV student predicate retains an empty search path'
);

SELECT extensions.is(
  (
    SELECT routine.proconfig
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = 'private.can_access_dv_household(uuid)'::regprocedure
  ),
  ARRAY['search_path=""']::text[],
  'the private DV household predicate retains an empty search path'
);

SELECT extensions.is(
  (
    SELECT owner.rolname::text
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_roles AS owner ON owner.oid = routine.proowner
    WHERE routine.oid = 'private.is_dv_student(uuid)'::regprocedure
  ),
  'postgres',
  'the private DV student predicate remains owned by postgres'
);

SELECT extensions.is(
  (
    SELECT owner.rolname::text
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_roles AS owner ON owner.oid = routine.proowner
    WHERE routine.oid = 'private.can_access_dv_household(uuid)'::regprocedure
  ),
  'postgres',
  'the private DV household predicate remains owned by postgres'
);

SELECT extensions.set_eq(
  $$
    SELECT COALESCE(grantee.rolname, 'PUBLIC')::text
    FROM pg_catalog.pg_proc AS routine
    CROSS JOIN LATERAL pg_catalog.aclexplode(routine.proacl) AS acl
    LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
    WHERE routine.oid = 'private.is_dv_student(uuid)'::regprocedure
      AND acl.privilege_type = 'EXECUTE'
  $$,
  $$ VALUES ('authenticated'::text), ('postgres'::text) $$,
  'the private DV student predicate has exactly the reviewed direct execute ACL'
);

SELECT extensions.set_eq(
  $$
    SELECT COALESCE(grantee.rolname, 'PUBLIC')::text
    FROM pg_catalog.pg_proc AS routine
    CROSS JOIN LATERAL pg_catalog.aclexplode(routine.proacl) AS acl
    LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
    WHERE routine.oid = 'private.can_access_dv_household(uuid)'::regprocedure
      AND acl.privilege_type = 'EXECUTE'
  $$,
  $$ VALUES ('authenticated'::text), ('postgres'::text) $$,
  'the private DV household predicate has exactly the reviewed direct execute ACL'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    CROSS JOIN LATERAL pg_catalog.aclexplode(routine.proacl) AS acl
    WHERE routine.oid = 'private.is_dv_student(uuid)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no direct execute grant on the private DV student predicate'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    CROSS JOIN LATERAL pg_catalog.aclexplode(routine.proacl) AS acl
    WHERE routine.oid = 'private.can_access_dv_household(uuid)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no direct execute grant on the private DV household predicate'
);

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'private.is_dv_student(uuid)', 'EXECUTE'),
  'anon cannot execute the private DV student predicate'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'private.can_access_dv_household(uuid)',
    'EXECUTE'
  ),
  'anon cannot execute the private DV household predicate'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'private.is_dv_student(uuid)',
    'EXECUTE'
  ),
  'authenticated can execute the student predicate required by DV RLS policies'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'private.can_access_dv_household(uuid)',
    'EXECUTE'
  ),
  'authenticated can execute the household predicate required by DV RLS policies'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'private.is_dv_student(uuid)',
    'EXECUTE'
  ),
  'service_role has no unused execute capability on the student predicate'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'private.can_access_dv_household(uuid)',
    'EXECUTE'
  ),
  'service_role has no unused execute capability on the household predicate'
);

SELECT extensions.ok(
  has_function_privilege('postgres', 'private.is_dv_student(uuid)', 'EXECUTE'),
  'owner postgres retains administrative execution of the student predicate'
);

SELECT extensions.ok(
  has_function_privilege(
    'postgres',
    'private.can_access_dv_household(uuid)',
    'EXECUTE'
  ),
  'owner postgres retains administrative execution of the household predicate'
);

SELECT * FROM extensions.finish();

ROLLBACK;
