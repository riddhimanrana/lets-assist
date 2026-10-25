-- Bootstrap the permanent request guard before the unpublished schema changes.
BEGIN;

DO $$
DECLARE
  authenticator_oid oid := pg_catalog.to_regrole('authenticator')::oid;
  database_oid oid := (SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database());
BEGIN
  IF authenticator_oid IS NULL THEN
    RAISE EXCEPTION 'The application request role is missing.' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_db_role_setting AS configured
    CROSS JOIN LATERAL pg_catalog.unnest(configured.setconfig) AS entry(setting)
    WHERE configured.setrole IN (0, authenticator_oid)
      AND configured.setdatabase IN (0, database_oid)
      AND pg_catalog.split_part(entry.setting, '=', 1) = 'pgrst.db_pre_config'
      AND entry.setting <> 'pgrst.db_pre_config='
  ) THEN
    RAISE EXCEPTION 'An existing application pre-config hook requires separate review.' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_db_role_setting AS configured
    CROSS JOIN LATERAL pg_catalog.unnest(configured.setconfig) AS entry(setting)
    WHERE configured.setrole IN (0, authenticator_oid)
      AND configured.setdatabase IN (0, database_oid)
      AND pg_catalog.split_part(entry.setting, '=', 1) = 'pgrst.db_pre_request'
      AND (
        configured.setdatabase <> 0
        OR configured.setrole <> authenticator_oid
        OR entry.setting NOT IN (
          'pgrst.db_pre_request=',
          'pgrst.db_pre_request=public.enforce_application_request_write_fence'
        )
      )
  ) THEN
    RAISE EXCEPTION 'An existing application request hook requires separate review.' USING ERRCODE = '55000';
  END IF;
END;
$$;

CREATE FUNCTION public.enforce_application_request_write_fence()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- Keep this lock until the request transaction ends. A waiting request must
  -- read a fresh catalog snapshot after the operator commits the flag.
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(592043, 1);
  -- Stronger write isolation can retain a pre-activation snapshot after the
  -- lock wait. Refuse it even while the flag is off. Read-only RPCs still work.
  -- Read the operator-owned catalog flag, not an overridable request setting.
  IF pg_catalog.current_setting('transaction_read_only') <> 'on'
    AND (pg_catalog.current_setting('transaction_isolation') <> 'read committed'
      OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = 'authenticator'
        AND 'pgrst.app_settings.maintenance_write_block=on' = ANY (coalesce(rolconfig, ARRAY[]::text[]))
    )) THEN
    RAISE EXCEPTION 'Application writes are temporarily unavailable for maintenance.'
      USING ERRCODE = '25006';
  END IF;
END;
$$;

ALTER FUNCTION public.enforce_application_request_write_fence() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_application_request_write_fence()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_application_request_write_fence()
  TO anon, authenticated, service_role, postgres;

ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.enforce_application_request_write_fence';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';

COMMIT;
