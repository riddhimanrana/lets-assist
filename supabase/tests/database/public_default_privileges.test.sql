-- New public tables and sequences must be deny-by-default for browser roles.
-- This suite audits both migration object owners and drives real objects
-- through each owner's current default ACL. `has_*_privilege` includes grants
-- inherited from PUBLIC, so the behavioral matrix catches direct and PUBLIC
-- exposure without fragile aclitem text matching.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

-- 3 catalog assertions + 2 owners * 2 browser roles *
-- (7 table privileges + 1 MAINTAIN check + 3 sequence privileges) = 47.
SELECT extensions.plan(47);

-- Record the provider-owned baseline this suite deliberately does not assert
-- away, so a changed count is visible in the log even though EXT-005 owns it.
SELECT extensions.diag(
  format(
    'supabase_admin public table/sequence default ACL entries naming PUBLIC, anon, or authenticated: %s',
    (
      SELECT count(*)
      FROM pg_default_acl d
      CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
      WHERE d.defaclnamespace = 'public'::regnamespace
        AND d.defaclrole = 'supabase_admin'::regrole
        AND d.defaclobjtype IN ('r', 'S')
        AND acl.grantee IN (0, 'anon'::regrole, 'authenticated'::regrole)
    )
  )
);

-- ---------------------------------------------------------------------------
-- Catalog: no repository-owner default ACL names a browser role or PUBLIC
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (
    SELECT count(*)
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
    WHERE d.defaclnamespace = 'public'::regnamespace
      AND d.defaclrole IN ('postgres'::regrole, 'service_role'::regrole)
      AND d.defaclobjtype IN ('r', 'S')
      AND acl.grantee IN (0, 'anon'::regrole, 'authenticated'::regrole)
  ),
  0::bigint,
  'migration-owned public table/sequence defaults grant neither browser roles nor PUBLIC'
);

-- ---------------------------------------------------------------------------
-- Catalog: the provider-owned supabase_admin defaults cannot get worse
-- ---------------------------------------------------------------------------

-- `supabase_admin` owns separate `public` defaults that a repository migration
-- running as `postgres` cannot alter, because ALTER DEFAULT PRIVILEGES cannot
-- touch another role's defaults without superuser. Its baseline
-- `GRANT ALL ON TABLES/SEQUENCES ... TO anon, authenticated` is present on every
-- environment -- CI run 31563941682 counted 22 such entries -- so asserting that
-- count is zero is simply untrue, and the previous form of this suite could
-- never pass. EXT-005 tracks that provider boundary.
--
-- Deleting the assertion outright would leave the catalog uncovered, so assert
-- the two properties that are both true today and the only ways this
-- provider-owned baseline could become worse than it already is.
--
SELECT extensions.is(
  (
    SELECT count(*)
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
    WHERE d.defaclnamespace = 'public'::regnamespace
      AND d.defaclrole = 'supabase_admin'::regrole
      AND d.defaclobjtype IN ('r', 'S')
      AND acl.grantee = 0
  ),
  0::bigint,
  'supabase_admin public table/sequence defaults never name PUBLIC'
);

-- Non-grantable means neither browser role can pass what it holds to a third
-- role, so the exposure stays bounded to `anon` and `authenticated` themselves.
SELECT extensions.is(
  (
    SELECT count(*)
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
    WHERE d.defaclnamespace = 'public'::regnamespace
      AND d.defaclrole = 'supabase_admin'::regrole
      AND d.defaclobjtype IN ('r', 'S')
      AND acl.grantee IN ('anon'::regrole, 'authenticated'::regrole)
      AND acl.is_grantable
  ),
  0::bigint,
  'supabase_admin browser-role defaults are never grantable onward'
);

-- Repository-owned objects are covered behaviorally below rather than through
-- these defaults: migrations create objects as `postgres` or `service_role`,
-- never as `supabase_admin`, so only those two owners' defaults can govern them.

-- ---------------------------------------------------------------------------
-- Behavior: objects created by postgres
-- ---------------------------------------------------------------------------

CREATE TABLE public.default_privilege_postgres_table_probe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
CREATE SEQUENCE public.default_privilege_postgres_sequence_probe;

WITH browser_role(role_name) AS (
  VALUES ('anon'), ('authenticated')
), table_privilege(privilege_name) AS (
  VALUES
    ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
    ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
)
SELECT extensions.ok(
  NOT has_table_privilege(
    role_name,
    'public.default_privilege_postgres_table_probe',
    privilege_name
  ),
  format('postgres-created table denies %s to %s', privilege_name, role_name)
)
FROM browser_role CROSS JOIN table_privilege;

WITH browser_role(role_name) AS (
  VALUES ('anon'), ('authenticated')
)
SELECT extensions.ok(
  CASE current_setting('server_version_num')::int >= 170000
    WHEN TRUE THEN NOT has_table_privilege(
      role_name,
      'public.default_privilege_postgres_table_probe',
      'MAINTAIN'
    )
    ELSE TRUE
  END,
  format('postgres-created table denies MAINTAIN to %s', role_name)
)
FROM browser_role;

WITH browser_role(role_name) AS (
  VALUES ('anon'), ('authenticated')
), sequence_privilege(privilege_name) AS (
  VALUES ('SELECT'), ('USAGE'), ('UPDATE')
)
SELECT extensions.ok(
  NOT has_sequence_privilege(
    role_name,
    'public.default_privilege_postgres_sequence_probe',
    privilege_name
  ),
  format('postgres-created sequence denies %s to %s', privilege_name, role_name)
)
FROM browser_role CROSS JOIN sequence_privilege;

-- ---------------------------------------------------------------------------
-- Behavior: objects created by service_role
-- ---------------------------------------------------------------------------

-- service_role normally has USAGE only. Grant CREATE inside this rolled-back
-- test transaction solely to exercise that role's default ACL as an owner.
GRANT CREATE ON SCHEMA public TO service_role;
SET LOCAL ROLE service_role;
CREATE TABLE public.default_privilege_service_table_probe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
CREATE SEQUENCE public.default_privilege_service_sequence_probe;
RESET ROLE;

WITH browser_role(role_name) AS (
  VALUES ('anon'), ('authenticated')
), table_privilege(privilege_name) AS (
  VALUES
    ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
    ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
)
SELECT extensions.ok(
  NOT has_table_privilege(
    role_name,
    'public.default_privilege_service_table_probe',
    privilege_name
  ),
  format('service_role-created table denies %s to %s', privilege_name, role_name)
)
FROM browser_role CROSS JOIN table_privilege;

WITH browser_role(role_name) AS (
  VALUES ('anon'), ('authenticated')
)
SELECT extensions.ok(
  CASE current_setting('server_version_num')::int >= 170000
    WHEN TRUE THEN NOT has_table_privilege(
      role_name,
      'public.default_privilege_service_table_probe',
      'MAINTAIN'
    )
    ELSE TRUE
  END,
  format('service_role-created table denies MAINTAIN to %s', role_name)
)
FROM browser_role;

WITH browser_role(role_name) AS (
  VALUES ('anon'), ('authenticated')
), sequence_privilege(privilege_name) AS (
  VALUES ('SELECT'), ('USAGE'), ('UPDATE')
)
SELECT extensions.ok(
  NOT has_sequence_privilege(
    role_name,
    'public.default_privilege_service_sequence_probe',
    privilege_name
  ),
  format('service_role-created sequence denies %s to %s', privilege_name, role_name)
)
FROM browser_role CROSS JOIN sequence_privilege;

SELECT * FROM extensions.finish();

ROLLBACK;
