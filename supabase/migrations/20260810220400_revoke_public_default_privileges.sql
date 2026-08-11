-- Stop granting clients everything on future public objects (AUD-003).
--
-- The baseline still carries, from the original Supabase export:
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE
--     ON TABLES TO anon;   -- and to authenticated, plus ALL ON FUNCTIONS
--
-- so every table and function created afterwards in `public` is automatically
-- client-reachable, and only RLS stands between a newly added table and the
-- open internet. 20260701054111 closed the equivalent hole for plugin_data;
-- `public` was never done.
--
-- ALTER DEFAULT PRIVILEGES affects only objects created after it runs, and
-- every existing object carries explicit grants recorded in the baseline and
-- refined by 20260701180752, 20260701202252, and 20260712014700. The runtime
-- effect of this migration is therefore zero; what changes is that a new table
-- must now grant client access explicitly instead of receiving it silently.
--
-- Scope note: this covers TABLES and SEQUENCES for the two grantors that
-- migrations actually create objects as, `postgres` and `service_role`.
--
-- FUNCTIONS are deliberately NOT covered here. Postgres grants EXECUTE to
-- PUBLIC as a built-in default, and revoking it through ALTER DEFAULT
-- PRIVILEGES was verified locally NOT to suppress the `=X` entry on a
-- newly created function, so a revoke here would be security theatre. New
-- SECURITY DEFINER functions must therefore continue to carry an explicit
-- REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated in their own migration,
-- as 20260701040027, 20260701051022, and 20260802195500 already do, and as
-- the SECURITY DEFINER allowlist in scripts/audit-supabase-architecture.sh
-- enforces. Tracked as the open half of AUD-003.
--
-- The `supabase_admin` default ACLs are likewise untouched: `postgres` is not
-- superuser on hosted Supabase and cannot alter another role's defaults, so
-- attempting it would fail the deploy.

BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE service_role IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE service_role IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

COMMIT;
