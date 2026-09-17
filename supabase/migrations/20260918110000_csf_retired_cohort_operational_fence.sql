-- Retention keeps class anchors for evidence, but retired classes cannot
-- receive new semesters or usable invitation codes.
BEGIN;

DO $migration$
DECLARE
  v_definition text;
  v_before text;
  v_after text;
BEGIN
  v_definition := pg_get_functiondef(
    'plugin_data.csf_create_term_for_cohort(uuid,uuid,jsonb,uuid)'::regprocedure
  );
  v_before := 'IF v_cohort.status = ''archived'' THEN';
  v_after := 'IF v_cohort.status IN (''archived'', ''retired'') THEN';
  IF length(v_definition) - length(replace(v_definition, v_before, '')) <> length(v_before) THEN
    RAISE EXCEPTION 'The reviewed CSF semester function changed.';
  END IF;
  EXECUTE replace(v_definition, v_before, v_after);

  v_definition := pg_get_functiondef(
    'plugin_data.csf_rotate_class_join_code(uuid,uuid,uuid)'::regprocedure
  );
  v_before := 'AND cohort.status <> ''archived''';
  v_after := 'AND cohort.status NOT IN (''archived'', ''retired'')';
  IF length(v_definition) - length(replace(v_definition, v_before, '')) <> length(v_before) THEN
    RAISE EXCEPTION 'The reviewed CSF join-code function changed.';
  END IF;
  EXECUTE replace(v_definition, v_before, v_after);
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
  SELECT run.actor_user_id INTO v_actor_user_id
  FROM plugin_data.csf_retention_runs AS run
  WHERE run.id = NEW.run_id
    AND run.organization_id = NEW.organization_id;

  UPDATE plugin_data.csf_cohorts AS cohort
  SET status = 'retired', updated_at = now()
  WHERE cohort.id = NEW.cohort_id
    AND cohort.organization_id = NEW.organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
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

ALTER FUNCTION plugin_data.csf_create_term_for_cohort(uuid, uuid, jsonb, uuid) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_rotate_class_join_code(uuid, uuid, uuid) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_project_retired_cohort_status() OWNER TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_create_term_for_cohort(uuid, uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_rotate_class_join_code(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_project_retired_cohort_status()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_term_for_cohort(uuid, uuid, jsonb, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_rotate_class_join_code(uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_project_retired_cohort_status() TO postgres;

COMMIT;
