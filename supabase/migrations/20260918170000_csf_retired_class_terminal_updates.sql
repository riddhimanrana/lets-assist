BEGIN;

-- Retired classes remain closed to operational writes. Officers may still
-- make a status-only terminal transition on records that already belong to
-- that class, with no change to their audience, content, or ownership.
CREATE OR REPLACE FUNCTION plugin_data.csf_guard_retired_cohort_operational_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cohort_id uuid;
  v_organization_id uuid;
  v_status text;
  v_terminal_statuses text[];
BEGIN
  v_terminal_statuses := CASE TG_TABLE_NAME
    WHEN 'csf_opportunities' THEN ARRAY['archived', 'cancelled']
    WHEN 'csf_cohort_terms' THEN ARRAY['inactive', 'archived']
    ELSE ARRAY[]::text[]
  END;

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
      IF TG_OP = 'UPDATE'
        AND OLD.organization_id = NEW.organization_id
        AND OLD.cohort_id = NEW.cohort_id
        AND OLD.status IS DISTINCT FROM NEW.status
        AND NEW.status = ANY(v_terminal_statuses)
        AND (
          (TG_TABLE_NAME = 'csf_cohort_terms'
            AND (to_jsonb(OLD) - ARRAY['status', 'updated_at'])
              = (to_jsonb(NEW) - ARRAY['status', 'updated_at']))
          OR (TG_TABLE_NAME = 'csf_opportunities'
            AND NEW.status = 'archived'
            AND nullif(to_jsonb(NEW)->>'archived_at', '') IS NOT NULL
            AND (to_jsonb(OLD) - ARRAY['status', 'updated_at', 'archived_at'])
              = (to_jsonb(NEW) - ARRAY['status', 'updated_at', 'archived_at']))
          OR (TG_TABLE_NAME = 'csf_opportunities'
            AND NEW.status = 'cancelled'
            AND nullif(to_jsonb(NEW)->>'cancelled_at', '') IS NOT NULL
            AND nullif(btrim(to_jsonb(NEW)->>'cancellation_reason'), '') IS NOT NULL
            AND (to_jsonb(OLD) - ARRAY['status', 'updated_at', 'cancelled_at', 'cancellation_reason'])
              = (to_jsonb(NEW) - ARRAY['status', 'updated_at', 'cancelled_at', 'cancellation_reason']))
        ) THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'A retired CSF class cannot change activities or semester settings.';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- A class-term status edit passes through the shared term RPC first. Fence
-- changes to that shared term when any linked class has retired, while allowing
-- its no-op timestamp touch so the existing audited status action can finish.
CREATE FUNCTION plugin_data.csf_guard_retired_shared_term_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (to_jsonb(OLD) - 'updated_at') = (to_jsonb(NEW) - 'updated_at') THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM plugin_data.csf_cohort_terms AS link
  JOIN plugin_data.csf_cohorts AS cohort
    ON cohort.organization_id = link.organization_id
   AND cohort.id = link.cohort_id
  WHERE link.organization_id = OLD.organization_id
    AND link.term_id = OLD.id
    AND (
      cohort.status = 'retired'
      OR EXISTS (
        SELECT 1 FROM plugin_data.csf_retention_retired_cohorts AS retired
        WHERE retired.organization_id = link.organization_id
          AND retired.cohort_id = link.cohort_id
      )
    )
  FOR SHARE OF cohort;
  IF FOUND THEN
    RAISE EXCEPTION 'A shared semester with a retired CSF class cannot be edited.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_guard_retired_shared_term_update
BEFORE UPDATE ON plugin_data.csf_terms
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_retired_shared_term_update();

CREATE OR REPLACE FUNCTION plugin_data.csf_guard_retired_class_post()
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
      SELECT NEW.audience_cohort_id AS cohort_id, NEW.organization_id
      WHERE NEW.audience = 'class'
      UNION ALL
      SELECT OLD.audience_cohort_id, OLD.organization_id
      WHERE TG_OP = 'UPDATE' AND OLD.audience = 'class'
    ) AS candidate
    WHERE candidate.cohort_id IS NOT NULL
  LOOP
    SELECT cohort.status INTO v_status
    FROM plugin_data.csf_cohorts AS cohort
    WHERE cohort.organization_id = v_organization_id
      AND cohort.id = v_cohort_id
    FOR SHARE;

    IF v_status IS NULL OR v_status = 'retired' OR EXISTS (
      SELECT 1 FROM plugin_data.csf_retention_retired_cohorts AS retired
      WHERE retired.organization_id = v_organization_id
        AND retired.cohort_id = v_cohort_id
    ) THEN
      IF TG_OP = 'UPDATE'
        AND OLD.organization_id = NEW.organization_id
        AND OLD.audience = 'class' AND NEW.audience = 'class'
        AND OLD.audience_cohort_id = NEW.audience_cohort_id
        AND (
          (OLD.status IS DISTINCT FROM NEW.status
            AND NEW.status = 'archived' AND NOT NEW.pinned)
          OR (OLD.status = NEW.status AND OLD.pinned AND NOT NEW.pinned)
        )
        AND (to_jsonb(OLD) - ARRAY['status', 'pinned', 'updated_at', 'updated_by'])
          = (to_jsonb(NEW) - ARRAY['status', 'pinned', 'updated_at', 'updated_by']) THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = 'A retired CSF class cannot receive posts.';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

ALTER FUNCTION plugin_data.csf_guard_retired_cohort_operational_write() OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_guard_retired_class_post() OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_guard_retired_shared_term_update() OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_retired_cohort_operational_write()
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_retired_cohort_operational_write() TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_retired_class_post()
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_retired_class_post() TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_retired_shared_term_update()
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_retired_shared_term_update() TO postgres;

COMMIT;
