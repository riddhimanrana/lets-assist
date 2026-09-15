-- Reject stale intake flags and lock the term through the native insert.
BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_new_application_intake()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_accepts_new_applications boolean;
BEGIN
  IF NEW.source <> 'native' THEN
    RETURN NEW;
  END IF;

  -- A close that wins this lock commits before this insert checks the flag. An
  -- insert that wins it keeps the intake state stable through its statement.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      NEW.organization_id::text || ':' || NEW.term_id::text,
      0
    )
  );

  SELECT term.accepts_new_applications
  INTO v_accepts_new_applications
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = NEW.organization_id
    AND term.id = NEW.term_id
    AND term.is_current
    AND term.lifecycle_status = 'open'
  FOR SHARE;

  IF NOT FOUND OR v_accepts_new_applications IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'New applications are closed for this semester.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION plugin_data.csf_enforce_new_application_intake() OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_enforce_new_application_intake() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_enforce_new_application_intake() TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_set_application_intake(uuid,uuid,boolean,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_application_intake(uuid,uuid,boolean,uuid) TO postgres, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
