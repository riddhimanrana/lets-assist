-- A retained retired class is an evidence anchor, not an operational target.
-- Lock its cohort row so a concurrent retirement cannot commit between the
-- check and an activity or class-term write.
BEGIN;

CREATE FUNCTION plugin_data.csf_guard_retired_cohort_operational_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cohort_id uuid;
  v_organization_id uuid;
  v_status text;
BEGIN
  FOR v_cohort_id, v_organization_id IN
    SELECT DISTINCT candidate.cohort_id, candidate.organization_id
    FROM (
      SELECT NEW.cohort_id, NEW.organization_id
      UNION ALL
      SELECT OLD.cohort_id, OLD.organization_id WHERE TG_OP = 'UPDATE'
    ) AS candidate
    WHERE candidate.cohort_id IS NOT NULL
  LOOP
    SELECT cohort.status INTO v_status
    FROM plugin_data.csf_cohorts AS cohort
    WHERE cohort.organization_id = v_organization_id
      AND cohort.id = v_cohort_id
    FOR SHARE;

    IF v_status = 'retired' OR EXISTS (
      SELECT 1 FROM plugin_data.csf_retention_retired_cohorts AS retired
      WHERE retired.organization_id = v_organization_id
        AND retired.cohort_id = v_cohort_id
    ) THEN
      RAISE EXCEPTION 'A retired CSF class cannot change activities or semester settings.';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_opportunities_retired_cohort_write_guard
BEFORE INSERT OR UPDATE ON plugin_data.csf_opportunities
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_retired_cohort_operational_write();

CREATE TRIGGER csf_cohort_terms_retired_cohort_write_guard
BEFORE INSERT OR UPDATE ON plugin_data.csf_cohort_terms
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_retired_cohort_operational_write();

ALTER FUNCTION plugin_data.csf_guard_retired_cohort_operational_write() OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_retired_cohort_operational_write()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_retired_cohort_operational_write() TO postgres;

COMMIT;
