import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const applicationRequestWriteFenceBodySha256 =
  "c3b1066136c3a1949d7a733e302039af78239e0bd4792f7c5a20b98399b268bc";

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
        IN ('default_transaction_read_only', 'pgrst.app_settings.maintenance_write_block')
  )`;

// PostgREST applies role and RPC isolation defaults before the hook runs.
// Writable requests require fresh snapshots after waiting for the shared gate.
const requestIsolationCompatible = `NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_db_role_setting AS configured
    CROSS JOIN LATERAL pg_catalog.unnest(configured.setconfig) AS entry(setting)
    WHERE configured.setrole IN (0, 'authenticator'::regrole, 'anon'::regrole,
        'authenticated'::regrole, 'service_role'::regrole)
      AND configured.setdatabase IN (0, (SELECT oid FROM pg_catalog.pg_database
        WHERE datname = current_database()))
      AND pg_catalog.split_part(entry.setting, '=', 1) = 'default_transaction_isolation'
      AND entry.setting <> 'default_transaction_isolation=read committed'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=routine.pronamespace
    CROSS JOIN LATERAL pg_catalog.unnest(routine.proconfig) AS entry(setting)
    WHERE namespace.nspname IN ('public', 'graphql_public', 'plugin_data')
      AND routine.provolatile='v'
      AND pg_catalog.split_part(entry.setting, '=', 1) = 'default_transaction_isolation'
      AND entry.setting <> 'default_transaction_isolation=read committed'
  )`;

export const applicationRequestWritesOpenQuery = `SELECT
  EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticator')
  AND ${requestSettingsCompatible}
  AND ${requestIsolationCompatible}
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles AS request_role
    CROSS JOIN LATERAL pg_catalog.unnest(request_role.rolconfig) AS entry(setting)
    WHERE request_role.rolname = 'authenticator'
      AND pg_catalog.split_part(entry.setting, '=', 1) = 'pgrst.app_settings.maintenance_write_block'
      AND entry.setting <> 'pgrst.app_settings.maintenance_write_block=off'
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
      AND routine.provolatile = 'v' AND routine.proparallel = 'u'
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
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_db_role_setting AS configured
    CROSS JOIN LATERAL pg_catalog.unnest(configured.setconfig) AS entry(setting)
    WHERE configured.setrole IN (0, 'authenticator'::regrole)
      AND configured.setdatabase IN (0, (SELECT oid FROM pg_catalog.pg_database
        WHERE datname = current_database()))
      AND pg_catalog.split_part(entry.setting, '=', 1) = 'pgrst.db_pre_config'
      AND entry.setting <> 'pgrst.db_pre_config='
  )
  AND ${requestSettingsCompatible}
  AND ${requestIsolationCompatible} AS valid`;

export const requireApplicationRequestWriteFenceSql = `DO $write_fence$
BEGIN
  IF NOT (${applicationRequestWriteFenceQuery.replace(/ AS valid$/u, "")}) THEN
    RAISE EXCEPTION 'The reviewed application request guard is not installed. Bootstrap requires a separate approved change.'
      USING ERRCODE = '55000';
  END IF;
END;
$write_fence$;`;

export function applicationRequestWriteFlagSql(enabled) {
  if (typeof enabled !== "boolean")
    throw new Error("Invalid request guard state.");
  return `BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout='20s';
SET LOCAL statement_timeout='30s';
SELECT pg_catalog.pg_advisory_xact_lock(592043,1);
${requireApplicationRequestWriteFenceSql}
ALTER ROLE authenticator ${
    enabled
      ? "SET pgrst.app_settings.maintenance_write_block TO 'on'"
      : "RESET pgrst.app_settings.maintenance_write_block"
  };
COMMIT;`;
}

// Requests admitted before the hook was loaded did not acquire its gate. Observe
// their exact transactions after proving the runtime fence, without terminating
// the listener, configuration reader or pooled connections.
export const settlePreexistingRequestTransactionsSql = `DO $request_barrier$
DECLARE captured jsonb; remaining integer;
  deadline timestamptz := clock_timestamp()+interval '20 seconds';
BEGIN
  PERFORM pg_catalog.pg_stat_clear_snapshot();
  SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backend_start',backend_start,'xact_start',xact_start)),'[]'::jsonb)
  INTO captured FROM pg_catalog.pg_stat_activity
  WHERE usename='authenticator' AND xact_start IS NOT NULL AND pid<>pg_backend_pid();
  LOOP
    PERFORM pg_catalog.pg_stat_clear_snapshot();
    SELECT count(*) INTO remaining
    FROM pg_catalog.pg_stat_activity AS actual
    JOIN jsonb_to_recordset(captured) AS prior(pid integer,backend_start timestamptz,xact_start timestamptz)
      ON actual.pid=prior.pid AND actual.backend_start=prior.backend_start AND actual.xact_start=prior.xact_start;
    EXIT WHEN remaining=0;
    IF clock_timestamp()>=deadline THEN
      RAISE EXCEPTION 'Preexisting request transactions have not settled' USING ERRCODE='55000';
    END IF;
    PERFORM pg_catalog.pg_sleep(0.1);
  END LOOP;
END;
$request_barrier$;`;

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.stdout.write(
    process.argv[2] === "enable"
      ? applicationRequestWriteFlagSql(true)
      : process.argv[2] === "disable"
        ? applicationRequestWriteFlagSql(false)
        : process.argv[2] === "barrier"
          ? settlePreexistingRequestTransactionsSql
          : requireApplicationRequestWriteFenceSql,
  );
