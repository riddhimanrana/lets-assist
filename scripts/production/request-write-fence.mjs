import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const applicationRequestWriteFenceBodySha256 =
  "cd241775632f67399789f0161c57de9d01b80facaae190b9b1adebfec2000da7";

// The legacy default breaks the schema listener and does not enforce API writes.
// Refuse ambiguous database settings instead of silently changing them.
const requestSettingsCompatible = `NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles AS request_role
    CROSS JOIN LATERAL pg_catalog.unnest(request_role.rolconfig) AS entry(setting)
    WHERE request_role.rolname = 'authenticator'
      AND pg_catalog.split_part(entry.setting, '=', 1) = 'default_transaction_read_only'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_db_role_setting AS configured
    CROSS JOIN LATERAL pg_catalog.unnest(configured.setconfig) AS entry(setting)
    WHERE configured.setrole IN (0, 'authenticator'::regrole)
      AND configured.setdatabase = (SELECT oid FROM pg_catalog.pg_database
        WHERE datname = current_database())
      AND pg_catalog.split_part(entry.setting, '=', 1)
        IN ('default_transaction_read_only', 'app.maintenance_write_block')
  )`;

export const applicationRequestWritesOpenQuery = `SELECT
  EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticator')
  AND ${requestSettingsCompatible}
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles AS request_role
    CROSS JOIN LATERAL pg_catalog.unnest(request_role.rolconfig) AS entry(setting)
    WHERE request_role.rolname = 'authenticator'
      AND pg_catalog.split_part(entry.setting, '=', 1) = 'app.maintenance_write_block'
      AND entry.setting <> 'app.maintenance_write_block=off'
  ) AS valid`;

// A flag alone cannot block PostgREST's explicitly writable transactions.
// Validate the installed migration-owned hook before changing that flag.
export const applicationRequestWriteFenceQuery = `SELECT
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    JOIN pg_catalog.pg_language AS language ON language.oid = routine.prolang
    WHERE namespace.nspname = 'public'
      AND routine.proname = 'enforce_application_request_write_fence'
      AND routine.pronargs = 0 AND routine.prokind = 'f'
      AND routine.prorettype = 'pg_catalog.void'::regtype
      AND NOT routine.proretset AND NOT routine.prosecdef AND NOT routine.proleakproof
      AND routine.provolatile = 's' AND routine.proparallel = 'u'
      AND routine.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND routine.proconfig = ARRAY['search_path=""']::text[]
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(routine.prosrc, 'UTF8')), 'hex')
        = '${applicationRequestWriteFenceBodySha256}'
      AND (SELECT count(*) FROM pg_catalog.aclexplode(routine.proacl)) = 4
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(routine.proacl) AS permission
        WHERE permission.grantee NOT IN ('postgres'::regrole, 'anon'::regrole,
            'authenticated'::regrole, 'service_role'::regrole)
          OR permission.grantor <> 'postgres'::regrole
          OR permission.privilege_type <> 'EXECUTE' OR permission.is_grantable
      )
  )
  AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles AS request_role
    WHERE request_role.rolname = 'authenticator'
      AND (SELECT count(*) FROM pg_catalog.unnest(request_role.rolconfig) AS entry(setting)
        WHERE pg_catalog.split_part(entry.setting, '=', 1) = 'pgrst.db_pre_request') = 1
      AND 'pgrst.db_pre_request=public.enforce_application_request_write_fence'
        = ANY(request_role.rolconfig)
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_db_role_setting AS configured
    CROSS JOIN LATERAL pg_catalog.unnest(configured.setconfig) AS entry(setting)
    WHERE configured.setrole IN (0, 'authenticator'::regrole)
      AND configured.setdatabase IN (0, (SELECT oid FROM pg_catalog.pg_database
        WHERE datname = current_database()))
      AND pg_catalog.split_part(entry.setting, '=', 1) = 'pgrst.db_pre_request'
      AND (configured.setdatabase <> 0 OR configured.setrole <> 'authenticator'::regrole)
  )
  AND ${requestSettingsCompatible} AS valid`;

export const requireApplicationRequestWriteFenceSql = `DO $write_fence$
BEGIN
  IF NOT (${applicationRequestWriteFenceQuery.replace(/ AS valid$/u, "")}) THEN
    RAISE EXCEPTION 'The reviewed application request guard is not installed. Bootstrap requires a separate approved change.'
      USING ERRCODE = '55000';
  END IF;
END;
$write_fence$;`;

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.stdout.write(requireApplicationRequestWriteFenceSql);
