-- AUD-003: relation and independent column ACLs must converge on the reviewed
-- direct catalog, while effective privileges also account for role inheritance
-- and grants to PUBLIC.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(15);

CREATE TEMP VIEW client_relation_expected AS
SELECT relation_name, role_name, privilege, NULL::text AS column_name
FROM app_private.client_relation_grant_catalog()
WHERE columns IS NULL
UNION ALL
SELECT catalog.relation_name, catalog.role_name, catalog.privilege, expected_column.column_name
FROM app_private.client_relation_grant_catalog() AS catalog
CROSS JOIN LATERAL unnest(catalog.columns) AS expected_column(column_name)
WHERE catalog.columns IS NOT NULL;

CREATE TEMP VIEW client_relation_direct_actual AS
SELECT
  relation.relname::text AS relation_name,
  grantee.rolname::text AS role_name,
  acl.privilege_type AS privilege,
  NULL::text AS column_name
FROM pg_class AS relation
JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
CROSS JOIN LATERAL aclexplode(relation.relacl) AS acl
JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
WHERE namespace.nspname = 'public'
  AND relation.relkind IN ('r', 'p', 'v', 'm')
  AND grantee.rolname IN ('anon', 'authenticated')
  AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
UNION ALL
SELECT
  relation.relname::text,
  grantee.rolname::text,
  acl.privilege_type,
  attribute.attname::text
FROM pg_attribute AS attribute
JOIN pg_class AS relation ON relation.oid = attribute.attrelid
JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
CROSS JOIN LATERAL aclexplode(attribute.attacl) AS acl
JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
WHERE namespace.nspname = 'public'
  AND relation.relkind IN ('r', 'p', 'v', 'm')
  AND attribute.attnum > 0
  AND NOT attribute.attisdropped
  AND grantee.rolname IN ('anon', 'authenticated')
  AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE');

CREATE TEMP VIEW client_relation_effective_actual AS
WITH client_roles AS (
  SELECT oid, rolname::text AS role_name
  FROM pg_roles
  WHERE rolname IN ('anon', 'authenticated')
),
relations AS (
  SELECT relation.oid, relation.relname::text AS relation_name
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p', 'v', 'm')
),
dml_privileges(privilege) AS (
  VALUES ('SELECT'::text), ('INSERT'::text), ('UPDATE'::text), ('DELETE'::text)
)
SELECT
  relations.relation_name,
  client_roles.role_name,
  dml_privileges.privilege,
  NULL::text AS column_name
FROM relations
CROSS JOIN client_roles
CROSS JOIN dml_privileges
WHERE has_table_privilege(client_roles.oid, relations.oid, dml_privileges.privilege)
UNION ALL
SELECT
  relations.relation_name,
  client_roles.role_name,
  dml_privileges.privilege,
  attribute.attname::text
FROM relations
JOIN pg_attribute AS attribute
  ON attribute.attrelid = relations.oid
 AND attribute.attnum > 0
 AND NOT attribute.attisdropped
CROSS JOIN client_roles
CROSS JOIN dml_privileges
WHERE dml_privileges.privilege IN ('SELECT', 'INSERT', 'UPDATE')
  AND NOT has_table_privilege(client_roles.oid, relations.oid, dml_privileges.privilege)
  AND has_column_privilege(
    client_roles.oid,
    relations.oid,
    attribute.attnum,
    dml_privileges.privilege
  );

CREATE TEMP VIEW client_relation_contract_drift AS
SELECT 'direct_missing'::text AS drift_kind, expected.*
FROM client_relation_expected AS expected
WHERE NOT EXISTS (
  SELECT 1
  FROM client_relation_direct_actual AS actual
  WHERE actual.relation_name = expected.relation_name
    AND actual.role_name = expected.role_name
    AND actual.privilege = expected.privilege
    AND actual.column_name IS NOT DISTINCT FROM expected.column_name
)
UNION ALL
SELECT 'direct_unexpected'::text, actual.*
FROM client_relation_direct_actual AS actual
WHERE NOT EXISTS (
  SELECT 1
  FROM client_relation_expected AS expected
  WHERE expected.relation_name = actual.relation_name
    AND expected.role_name = actual.role_name
    AND expected.privilege = actual.privilege
    AND expected.column_name IS NOT DISTINCT FROM actual.column_name
)
UNION ALL
SELECT 'effective_missing'::text, expected.*
FROM client_relation_expected AS expected
WHERE NOT EXISTS (
  SELECT 1
  FROM client_relation_effective_actual AS actual
  WHERE actual.relation_name = expected.relation_name
    AND actual.role_name = expected.role_name
    AND actual.privilege = expected.privilege
    AND actual.column_name IS NOT DISTINCT FROM expected.column_name
)
UNION ALL
SELECT 'effective_unexpected'::text, actual.*
FROM client_relation_effective_actual AS actual
WHERE NOT EXISTS (
  SELECT 1
  FROM client_relation_expected AS expected
  WHERE expected.relation_name = actual.relation_name
    AND expected.role_name = actual.role_name
    AND expected.privilege = actual.privilege
    AND expected.column_name IS NOT DISTINCT FROM actual.column_name
);

CREATE TEMP VIEW public_relation_column_acl_residue AS
SELECT relation.relname::text AS relation_name, acl.privilege_type, NULL::text AS column_name
FROM pg_class AS relation
JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
CROSS JOIN LATERAL aclexplode(relation.relacl) AS acl
WHERE namespace.nspname = 'public'
  AND relation.relkind IN ('r', 'p', 'v', 'm')
  AND acl.grantee = 0
UNION ALL
SELECT relation.relname::text, acl.privilege_type, attribute.attname::text
FROM pg_attribute AS attribute
JOIN pg_class AS relation ON relation.oid = attribute.attrelid
JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
CROSS JOIN LATERAL aclexplode(attribute.attacl) AS acl
WHERE namespace.nspname = 'public'
  AND relation.relkind IN ('r', 'p', 'v', 'm')
  AND attribute.attnum > 0
  AND NOT attribute.attisdropped
  AND acl.grantee = 0;

CREATE TEMP VIEW dangerous_client_relation_privileges AS
WITH client_roles AS (
  SELECT oid, rolname::text AS role_name
  FROM pg_roles
  WHERE rolname IN ('anon', 'authenticated')
),
relations AS (
  SELECT relation.oid, relation.relname::text AS relation_name
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p', 'v', 'm')
),
dangerous_table_privileges(privilege) AS (
  VALUES ('TRUNCATE'::text), ('REFERENCES'::text), ('TRIGGER'::text), ('MAINTAIN'::text)
)
SELECT
  relations.relation_name,
  client_roles.role_name,
  dangerous_table_privileges.privilege,
  NULL::text AS column_name
FROM relations
CROSS JOIN client_roles
CROSS JOIN dangerous_table_privileges
WHERE has_table_privilege(
  client_roles.oid,
  relations.oid,
  dangerous_table_privileges.privilege
)
UNION ALL
SELECT
  relations.relation_name,
  client_roles.role_name,
  'REFERENCES'::text,
  attribute.attname::text
FROM relations
JOIN pg_attribute AS attribute
  ON attribute.attrelid = relations.oid
 AND attribute.attnum > 0
 AND NOT attribute.attisdropped
CROSS JOIN client_roles
WHERE NOT has_table_privilege(client_roles.oid, relations.oid, 'REFERENCES')
  AND has_column_privilege(client_roles.oid, relations.oid, attribute.attnum, 'REFERENCES');

SELECT extensions.ok(
  to_regprocedure('app_private.client_relation_grant_catalog()') IS NOT NULL,
  'client relation grant catalog function exists'
);

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'app_private.client_relation_grant_catalog()', 'EXECUTE'),
  'anon cannot execute the client relation grant catalog'
);

SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'app_private.client_relation_grant_catalog()', 'EXECUTE'),
  'authenticated cannot execute the client relation grant catalog'
);

SELECT extensions.ok(
  has_function_privilege('service_role', 'app_private.client_relation_grant_catalog()', 'EXECUTE'),
  'service_role can execute the client relation grant catalog'
);

SELECT extensions.is(
  (SELECT count(*) FROM client_relation_contract_drift WHERE drift_kind LIKE 'direct_%'),
  0::bigint,
  'direct relation and independent column ACLs exactly match the catalog'
);

SELECT extensions.is(
  (SELECT count(*) FROM client_relation_contract_drift WHERE drift_kind LIKE 'effective_%'),
  0::bigint,
  'effective client privileges including PUBLIC and role inheritance exactly match the catalog'
);

SELECT extensions.is(
  (SELECT count(*) FROM public_relation_column_acl_residue),
  0::bigint,
  'PUBLIC holds no relation or independent column ACL on public relations'
);

SELECT extensions.is(
  (SELECT count(*) FROM dangerous_client_relation_privileges),
  0::bigint,
  'anon and authenticated inherit no dangerous table or column privilege'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM app_private.client_relation_grant_catalog()
    WHERE relation_name = 'organizations'
      AND role_name = 'authenticated'
      AND privilege = 'SELECT'
      AND columns IS NOT NULL
  ),
  'reviewed column-scoped grants remain represented explicitly'
);

GRANT SELECT (id) ON public.profiles TO PUBLIC;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public_relation_column_acl_residue
    WHERE relation_name = 'profiles'
      AND privilege_type = 'SELECT'
      AND column_name = 'id'
  ),
  'PUBLIC column grant residue is detected directly in pg_attribute.attacl'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM client_relation_contract_drift
    WHERE drift_kind = 'effective_unexpected'
      AND relation_name = 'profiles'
      AND role_name = 'anon'
      AND privilege = 'SELECT'
      AND column_name = 'id'
  ),
  'a PUBLIC column grant is detected as effective anonymous access'
);

REVOKE SELECT (id) ON public.profiles FROM PUBLIC;

GRANT SELECT (id) ON public.profiles TO anon;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM client_relation_contract_drift
    WHERE drift_kind = 'direct_unexpected'
      AND relation_name = 'profiles'
      AND role_name = 'anon'
      AND privilege = 'SELECT'
      AND column_name = 'id'
  ),
  'anonymous independent column residue is detected'
);

REVOKE SELECT (id) ON public.profiles FROM anon;

GRANT SELECT (id) ON public.profiles TO authenticated;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM client_relation_contract_drift
    WHERE drift_kind = 'direct_unexpected'
      AND relation_name = 'profiles'
      AND role_name = 'authenticated'
      AND privilege = 'SELECT'
      AND column_name = 'id'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM client_relation_contract_drift
    WHERE drift_kind = 'effective_unexpected'
      AND relation_name = 'profiles'
      AND role_name = 'authenticated'
      AND privilege = 'SELECT'
  ),
  'authenticated column residue is detected even beside a whole-table grant'
);

REVOKE SELECT (id) ON public.profiles FROM authenticated;

GRANT REFERENCES (id) ON public.profiles TO anon;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM dangerous_client_relation_privileges
    WHERE relation_name = 'profiles'
      AND role_name = 'anon'
      AND privilege = 'REFERENCES'
      AND column_name = 'id'
  ),
  'dangerous anonymous column privileges are detected'
);

REVOKE REFERENCES (id) ON public.profiles FROM anon;

REVOKE SELECT ON public.projects FROM anon;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM client_relation_contract_drift
    WHERE drift_kind IN ('direct_missing', 'effective_missing')
      AND relation_name = 'projects'
      AND role_name = 'anon'
      AND privilege = 'SELECT'
  ),
  'a missing reviewed relation grant is detected'
);

GRANT SELECT ON public.projects TO anon;

SELECT * FROM extensions.finish();

ROLLBACK;
