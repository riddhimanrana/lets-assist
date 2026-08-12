-- AUD-003: the public client relation grant catalog is the reviewed source for
-- anon/authenticated table and view DML ACLs used by architecture gates.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(16);

SELECT extensions.ok(
  to_regprocedure('app_private.client_relation_grant_catalog()') IS NOT NULL,
  'client relation grant catalog function exists'
);

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'app_private.client_relation_grant_catalog()', 'EXECUTE'),
  'anon cannot execute the client relation grant catalog'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.client_relation_grant_catalog()',
    'EXECUTE'
  ),
  'authenticated cannot execute the client relation grant catalog'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'app_private.client_relation_grant_catalog()',
    'EXECUTE'
  ),
  'service_role can execute the client relation grant catalog'
);

SELECT extensions.is(
  (
    WITH expected AS (
      SELECT relation_name, role_name, privilege, NULL::text AS column_name
      FROM app_private.client_relation_grant_catalog()
      WHERE columns IS NULL
      UNION ALL
      SELECT c.relation_name, c.role_name, c.privilege, col.column_name
      FROM app_private.client_relation_grant_catalog() c
      CROSS JOIN LATERAL unnest(c.columns) AS col(column_name)
      WHERE c.columns IS NOT NULL
    ),
    actual_relation AS (
      SELECT table_name AS relation_name, grantee AS role_name, privilege_type AS privilege, NULL::text AS column_name
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND grantee IN ('anon', 'authenticated')
        AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    ),
    actual_column AS (
      SELECT cp.table_name AS relation_name, cp.grantee AS role_name, cp.privilege_type AS privilege, cp.column_name
      FROM information_schema.column_privileges cp
      WHERE cp.table_schema = 'public'
        AND cp.grantee IN ('anon', 'authenticated')
        AND cp.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
        AND NOT EXISTS (
          SELECT 1
          FROM information_schema.role_table_grants rt
          WHERE rt.table_schema = cp.table_schema
            AND rt.table_name = cp.table_name
            AND rt.grantee = cp.grantee
            AND rt.privilege_type = cp.privilege_type
        )
    ),
    actual AS (
      SELECT * FROM actual_relation
      UNION ALL
      SELECT * FROM actual_column
    ),
    drift AS (
      SELECT e.relation_name, e.role_name, e.privilege, e.column_name
      FROM expected e
      WHERE NOT EXISTS (
        SELECT 1
        FROM actual a
        WHERE a.relation_name = e.relation_name
          AND a.role_name = e.role_name
          AND a.privilege = e.privilege
          AND app_private.client_relation_grant_expected_satisfied_by_actual(
            e.column_name,
            a.column_name
          )
      )
      UNION ALL
      SELECT a.relation_name, a.role_name, a.privilege, a.column_name
      FROM actual a
      WHERE NOT EXISTS (
        SELECT 1
        FROM expected e
        WHERE e.relation_name = a.relation_name
          AND e.role_name = a.role_name
          AND e.privilege = a.privilege
          AND app_private.client_relation_grant_actual_covered_by_expected(
            a.column_name,
            e.column_name
          )
      )
    )
    SELECT count(*) FROM drift
  ),
  0::bigint,
  'live public client relation grants match the catalog bidirectionally'
);

SELECT extensions.ok(
  NOT app_private.client_relation_grant_expected_satisfied_by_actual(NULL, 'id'),
  'a column-only actual grant must not satisfy a relation-level expected grant'
);

SELECT extensions.ok(
  app_private.client_relation_grant_expected_satisfied_by_actual('id', NULL),
  'a relation-level actual grant satisfies a column-level expected grant'
);

SELECT extensions.ok(
  NOT app_private.client_relation_grant_actual_covered_by_expected(NULL, 'id'),
  'a relation-level actual grant is not covered by a column-only expected grant'
);

SELECT extensions.ok(
  app_private.client_relation_grant_actual_covered_by_expected('id', NULL),
  'a column-level actual grant is covered by a relation-level expected grant'
);

SELECT extensions.ok(
  (
    SELECT bool_or(
      ce.column_name IS NULL
      OR a.column_name IS NULL
      OR a.column_name = ce.column_name
    )
    FROM (SELECT NULL::text AS column_name) ce
    CROSS JOIN (SELECT 'id'::text AS column_name) a
  )
  AND NOT app_private.client_relation_grant_expected_satisfied_by_actual(NULL, 'id'),
  'legacy preflight OR predicate would accept column-only actual for relation-level expected'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) acl(grantor_oid, grantee_oid, privilege_type, is_grantable)
    JOIN pg_roles grantee ON grantee.oid = acl.grantee_oid
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm')
      AND grantee.rolname IN ('anon', 'authenticated')
      AND acl.privilege_type NOT IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ),
  0::bigint,
  'anon and authenticated hold no non-DML relation privileges on public objects'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) acl(grantor_oid, grantee_oid, privilege_type, is_grantable)
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm')
      AND acl.grantee_oid = 0
      AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  ),
  0::bigint,
  'PUBLIC holds no DML or dangerous relation privileges on public objects'
);

GRANT TRUNCATE ON public.projects TO anon;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) acl(grantor_oid, grantee_oid, privilege_type, is_grantable)
    JOIN pg_roles grantee ON grantee.oid = acl.grantee_oid
    WHERE n.nspname = 'public'
      AND c.relname = 'projects'
      AND grantee.rolname = 'anon'
      AND acl.privilege_type = 'TRUNCATE'
  ),
  'a synthetic TRUNCATE grant is visible through aclexplode'
);

REVOKE TRUNCATE ON public.projects FROM anon;

GRANT SELECT ON public.profiles TO anon;

SELECT extensions.ok(
  EXISTS (
    WITH expected AS (
      SELECT relation_name, role_name, privilege, NULL::text AS column_name
      FROM app_private.client_relation_grant_catalog()
      WHERE columns IS NULL
      UNION ALL
      SELECT c.relation_name, c.role_name, c.privilege, col.column_name
      FROM app_private.client_relation_grant_catalog() c
      CROSS JOIN LATERAL unnest(c.columns) AS col(column_name)
      WHERE c.columns IS NOT NULL
    ),
    actual_relation AS (
      SELECT table_name AS relation_name, grantee AS role_name, privilege_type AS privilege, NULL::text AS column_name
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND grantee IN ('anon', 'authenticated')
        AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    ),
    actual_column AS (
      SELECT cp.table_name AS relation_name, cp.grantee AS role_name, cp.privilege_type AS privilege, cp.column_name
      FROM information_schema.column_privileges cp
      WHERE cp.table_schema = 'public'
        AND cp.grantee IN ('anon', 'authenticated')
        AND cp.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
        AND NOT EXISTS (
          SELECT 1
          FROM information_schema.role_table_grants rt
          WHERE rt.table_schema = cp.table_schema
            AND rt.table_name = cp.table_name
            AND rt.grantee = cp.grantee
            AND rt.privilege_type = cp.privilege_type
        )
    ),
    actual AS (
      SELECT * FROM actual_relation
      UNION ALL
      SELECT * FROM actual_column
    )
    SELECT 1
    FROM actual a
    WHERE NOT EXISTS (
      SELECT 1
      FROM expected e
      WHERE e.relation_name = a.relation_name
        AND e.role_name = a.role_name
        AND e.privilege = a.privilege
        AND app_private.client_relation_grant_actual_covered_by_expected(
          a.column_name,
          e.column_name
        )
    )
  ),
  'an unexpected anon SELECT grant is detected as catalog drift'
);

REVOKE SELECT ON public.profiles FROM anon;

REVOKE SELECT ON public.projects FROM anon;

SELECT extensions.ok(
  EXISTS (
    WITH expected AS (
      SELECT relation_name, role_name, privilege, NULL::text AS column_name
      FROM app_private.client_relation_grant_catalog()
      WHERE columns IS NULL
      UNION ALL
      SELECT c.relation_name, c.role_name, c.privilege, col.column_name
      FROM app_private.client_relation_grant_catalog() c
      CROSS JOIN LATERAL unnest(c.columns) AS col(column_name)
      WHERE c.columns IS NOT NULL
    ),
    actual_relation AS (
      SELECT table_name AS relation_name, grantee AS role_name, privilege_type AS privilege, NULL::text AS column_name
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND grantee IN ('anon', 'authenticated')
        AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    ),
    actual_column AS (
      SELECT cp.table_name AS relation_name, cp.grantee AS role_name, cp.privilege_type AS privilege, cp.column_name
      FROM information_schema.column_privileges cp
      WHERE cp.table_schema = 'public'
        AND cp.grantee IN ('anon', 'authenticated')
        AND cp.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
        AND NOT EXISTS (
          SELECT 1
          FROM information_schema.role_table_grants rt
          WHERE rt.table_schema = cp.table_schema
            AND rt.table_name = cp.table_name
            AND rt.grantee = cp.grantee
            AND rt.privilege_type = cp.privilege_type
        )
    ),
    actual AS (
      SELECT * FROM actual_relation
      UNION ALL
      SELECT * FROM actual_column
    )
    SELECT 1
    FROM expected e
    WHERE NOT EXISTS (
      SELECT 1
      FROM actual a
      WHERE a.relation_name = e.relation_name
        AND a.role_name = e.role_name
        AND a.privilege = e.privilege
        AND app_private.client_relation_grant_expected_satisfied_by_actual(
          e.column_name,
          a.column_name
        )
    )
      AND e.relation_name = 'projects'
      AND e.role_name = 'anon'
      AND e.privilege = 'SELECT'
  ),
  'a missing catalog grant is detected as catalog drift'
);

GRANT SELECT ON public.projects TO anon;

SELECT extensions.is(
  (
    SELECT count(*)
    FROM app_private.client_relation_grant_catalog()
    WHERE role_name = 'anon'
      AND relation_name NOT IN (
        'organizations',
        'organization_members',
        'organization_invitations',
        'projects',
        'certificate_verification_read_model',
        'organization_invitation_acceptance_read_model',
        'organization_public_member_read_model',
        'organization_public_read_model',
        'project_discovery_read_model',
        'projects_with_creator',
        'public_profile_read_model',
        'user_certificate_read_model'
      )
  ),
  0::bigint,
  'anon catalog entries are limited to reviewed base tables and current view SELECT grants'
);

SELECT * FROM extensions.finish();

ROLLBACK;
