-- A new table in `public` must not be client-reachable by default (AUD-003).
--
-- The baseline carried ALTER DEFAULT PRIVILEGES granting anon and authenticated
-- full DML on future tables in `public`, so every table added afterwards was
-- automatically exposed through PostgREST and only RLS contained it.
-- 20260701054111 closed the same hole for plugin_data; `public` was never done.
--
-- Scope, deliberately matching the migration: the grantors asserted are the two
-- that migrations create objects as. `supabase_admin` keeps its own default
-- ACLs because `postgres` is not superuser on hosted Supabase and cannot alter
-- them. FUNCTIONS are not asserted because Postgres grants EXECUTE to PUBLIC as
-- a built-in default that ALTER DEFAULT PRIVILEGES was verified not to
-- suppress; new SECURITY DEFINER functions carry their own explicit REVOKE
-- instead, which the SECURITY DEFINER allowlist in
-- scripts/audit-supabase-architecture.sh checks.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(5);

-- ---------------------------------------------------------------------------
-- Catalog: no migration-owned default ACL may name a client role
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (
    SELECT count(*)
    FROM pg_default_acl d
    CROSS JOIN LATERAL unnest(d.defaclacl) AS entry(acl)
    WHERE d.defaclnamespace = 'public'::regnamespace
      AND d.defaclrole IN ('postgres'::regrole, 'service_role'::regrole)
      AND d.defaclobjtype IN ('r', 'S')
      AND (acl::text LIKE 'anon=%' OR acl::text LIKE 'authenticated=%')
  ),
  0::bigint,
  'no migration-owned table or sequence default in public grants a client role'
);

-- ---------------------------------------------------------------------------
-- Behaviour: the property that actually matters
-- ---------------------------------------------------------------------------

CREATE TABLE public.default_privilege_probe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.default_privilege_probe', 'SELECT'),
  'a new public table is not readable by anon'
);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.default_privilege_probe', 'INSERT'),
  'a new public table is not writable by anon'
);

SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'public.default_privilege_probe', 'SELECT'),
  'a new public table is not readable by authenticated'
);

SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'public.default_privilege_probe', 'INSERT'),
  'a new public table is not writable by authenticated'
);

SELECT * FROM extensions.finish();

ROLLBACK;
