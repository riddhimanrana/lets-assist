BEGIN;

-- Commit evidence must name the officer who actually commits, before the
-- retired-cohort receipt invokes its projection trigger.
DO $migration$
DECLARE
  v_definition text;
  v_receipt text := $fragment$
  INSERT INTO plugin_data.csf_retention_retired_cohorts (
    organization_id, cohort_id, run_id, graduation_year
  )
  SELECT p_organization_id, cohort.id, v_run.id, cohort.graduation_year
  FROM plugin_data.csf_cohorts AS cohort
  WHERE cohort.organization_id = p_organization_id
    AND cohort.id = ANY(v_target_cohort_ids)
  ON CONFLICT (organization_id, cohort_id) DO NOTHING;
$fragment$;
  v_commit text := $fragment$
  UPDATE plugin_data.csf_retention_runs AS run
  SET state = 'committed',
      committed_at = now(),
      committed_by = p_actor_user_id,
      commit_request_id = p_request_id,
      committed_counts = v_counts
  WHERE run.id = v_run.id;
$fragment$;
  v_before text;
BEGIN
  v_definition := pg_get_functiondef(
    'plugin_data.csf_retention_commit(uuid,uuid,uuid,uuid,text,integer[],uuid[])'::regprocedure
  );
  v_receipt := btrim(v_receipt, E'\n');
  v_commit := btrim(v_commit, E'\n');
  v_before := v_receipt || E'\n\n' || v_commit;
  IF length(v_definition) - length(replace(v_definition, v_before, ''))
       <> length(v_before) THEN
    RAISE EXCEPTION 'The reviewed CSF retention commit order changed.';
  END IF;
  EXECUTE replace(v_definition, v_before, v_commit || E'\n\n' || v_receipt);
END;
$migration$;

CREATE OR REPLACE FUNCTION plugin_data.csf_project_retired_cohort_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
  v_code record;
BEGIN
  SELECT run.committed_by INTO v_actor_user_id
  FROM plugin_data.csf_retention_runs AS run
  WHERE run.id = NEW.run_id
    AND run.organization_id = NEW.organization_id
    AND run.state = 'committed';

  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'The committing CSF officer is missing from the retention receipt.';
  END IF;

  UPDATE plugin_data.csf_cohorts AS cohort
  SET status = 'retired', updated_at = now()
  WHERE cohort.id = NEW.cohort_id
    AND cohort.organization_id = NEW.organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'The retained CSF class anchor is missing.';
  END IF;

  FOR v_code IN
    UPDATE plugin_data.csf_class_join_codes AS code
    SET status = 'revoked', revoked_by = v_actor_user_id,
        revoked_at = now(), revoke_reason = 'Class retired by a completed retention operation.'
    WHERE code.organization_id = NEW.organization_id
      AND code.cohort_id = NEW.cohort_id
      AND code.status = 'active'
    RETURNING code.id
  LOOP
    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id, actor_user_id, action, target_type, target_id,
      after_data, correlation_id, source_type, source_id, reason_code
    ) VALUES (
      NEW.organization_id, v_actor_user_id, 'class.join_code.revoked',
      'csf_class_join_codes', v_code.id,
      jsonb_build_object('cohortId', NEW.cohort_id, 'status', 'revoked'),
      gen_random_uuid(), 'retention_run', NEW.run_id::text, 'class_retired'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- A post cannot target a class once its retained anchor is retired. Locking
-- that anchor serializes a post write with the retention commit.
CREATE FUNCTION plugin_data.csf_guard_retired_class_post()
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
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = 'A retired CSF class cannot receive posts.';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_guard_retired_class_post
BEFORE INSERT OR UPDATE ON plugin_data.csf_announcements
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_retired_class_post();

-- Previously queued class publication notices also become ineligible when
-- the class retires. Both bell and email delivery call this authorization.
DO $migration$
DECLARE
  v_definition text;
  v_before text;
  v_after text;
BEGIN
  v_definition := pg_get_functiondef(
    'plugin_data.csf_publication_recipient_allowed(uuid,text,uuid,uuid)'::regprocedure
  );
  v_before := 'IF v_audience <> ''class'' OR v_cohort_id IS NULL THEN RETURN false; END IF;';
  v_after := v_before || E'\n    IF EXISTS (SELECT 1 FROM plugin_data.csf_cohorts cohort WHERE cohort.organization_id=p_organization_id AND cohort.id=v_cohort_id AND cohort.status=''retired'') THEN RETURN false; END IF;';
  IF length(v_definition) - length(replace(v_definition, v_before, '')) <> length(v_before) THEN
    RAISE EXCEPTION 'The reviewed CSF post audience guard changed.';
  END IF;
  v_definition := replace(v_definition, v_before, v_after);
  v_before := 'IF v_cohort_id IS NULL OR (v_role IN (''admin'',''staff'') AND';
  v_after := 'IF v_cohort_id IS NOT NULL AND EXISTS (SELECT 1 FROM plugin_data.csf_cohorts cohort WHERE cohort.organization_id=p_organization_id AND cohort.id=v_cohort_id AND cohort.status=''retired'') THEN RETURN false; END IF;' || E'\n    ' || v_before;
  IF length(v_definition) - length(replace(v_definition, v_before, '')) <> length(v_before) THEN
    RAISE EXCEPTION 'The reviewed CSF activity audience guard changed.';
  END IF;
  EXECUTE replace(v_definition, v_before, v_after);
END;
$migration$;

ALTER FUNCTION plugin_data.csf_retention_commit(uuid, uuid, uuid, uuid, text, integer[], uuid[]) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_project_retired_cohort_status() OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_guard_retired_class_post() OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_publication_recipient_allowed(uuid, text, uuid, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_retention_commit(uuid, uuid, uuid, uuid, text, integer[], uuid[]) FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_retention_commit(uuid, uuid, uuid, uuid, text, integer[], uuid[]) TO postgres, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_project_retired_cohort_status() FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_project_retired_cohort_status() TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_retired_class_post() FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_retired_class_post() TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_publication_recipient_allowed(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_publication_recipient_allowed(uuid, text, uuid, uuid) TO postgres;

COMMIT;
