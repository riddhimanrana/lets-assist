BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_stamp_application_policy_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_policy_version integer;
BEGIN
  IF NEW.check_type = 'academic_eligibility'
    AND NEW.status <> 'waived'
  THEN
    SELECT policy.policy_version
    INTO v_policy_version
    FROM plugin_data.csf_term_applications AS application
    JOIN plugin_data.csf_term_policies AS policy
      ON policy.organization_id = application.organization_id
     AND policy.term_id = application.term_id
    WHERE application.organization_id = NEW.organization_id
      AND application.id = NEW.application_id
    ORDER BY policy.policy_version DESC, policy.updated_at DESC
    LIMIT 1;

    NEW.details := coalesce(NEW.details, '{}'::jsonb)
      || jsonb_build_object('policyVersion', v_policy_version);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS csf_application_checks_policy_version_trigger
  ON plugin_data.csf_application_checks;
CREATE TRIGGER csf_application_checks_policy_version_trigger
BEFORE INSERT OR UPDATE OF application_id, check_type, status, details
ON plugin_data.csf_application_checks
FOR EACH ROW
EXECUTE FUNCTION plugin_data.csf_stamp_application_policy_version();

UPDATE plugin_data.csf_application_checks AS application_check
SET details = coalesce(application_check.details, '{}'::jsonb)
  || jsonb_build_object(
    'policyVersion',
    (
      SELECT policy.policy_version
      FROM plugin_data.csf_term_applications AS application
      JOIN plugin_data.csf_term_policies AS policy
        ON policy.organization_id = application.organization_id
       AND policy.term_id = application.term_id
      WHERE application.organization_id = application_check.organization_id
        AND application.id = application_check.application_id
      ORDER BY policy.policy_version DESC, policy.updated_at DESC
      LIMIT 1
    )
  )
WHERE application_check.check_type = 'academic_eligibility'
  AND application_check.status <> 'waived';

ALTER FUNCTION plugin_data.csf_decide_term_application(uuid, uuid, text, text, uuid)
  RENAME TO csf_decide_term_application_policy_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_decide_term_application(
  p_organization_id uuid,
  p_application_id uuid,
  p_decision text,
  p_review_notes text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_check_status text;
  v_evaluated_policy_version integer;
  v_current_policy_version integer;
BEGIN
  IF p_decision = 'accepted' THEN
    SELECT
      application_check.status::text,
      CASE
        WHEN coalesce(application_check.details ->> 'policyVersion', '') ~ '^[0-9]+$'
          THEN (application_check.details ->> 'policyVersion')::integer
        ELSE NULL
      END
    INTO v_check_status, v_evaluated_policy_version
    FROM plugin_data.csf_application_checks AS application_check
    WHERE application_check.organization_id = p_organization_id
      AND application_check.application_id = p_application_id
      AND application_check.check_type = 'academic_eligibility';

    SELECT policy.policy_version
    INTO v_current_policy_version
    FROM plugin_data.csf_term_applications AS application
    JOIN plugin_data.csf_term_policies AS policy
      ON policy.organization_id = application.organization_id
     AND policy.term_id = application.term_id
    WHERE application.organization_id = p_organization_id
      AND application.id = p_application_id
    ORDER BY policy.policy_version DESC, policy.updated_at DESC
    LIMIT 1;

    IF v_current_policy_version IS NULL THEN
      RAISE EXCEPTION 'Application cannot be accepted until the semester policy is configured.';
    END IF;
    IF coalesce(v_check_status, '') <> 'waived'
      AND v_evaluated_policy_version IS DISTINCT FROM v_current_policy_version
    THEN
      RAISE EXCEPTION 'Application eligibility must be recalculated with current policy version %.', v_current_policy_version;
    END IF;
  END IF;

  RETURN plugin_data.csf_decide_term_application_policy_base(
    p_organization_id,
    p_application_id,
    p_decision,
    p_review_notes,
    p_actor_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_decide_term_application_policy_base(uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_decide_term_application(uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_decide_term_application(uuid, uuid, text, text, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_decide_term_application(uuid, uuid, text, text, uuid) IS
  'Requires a current-policy eligibility result, then atomically delegates the application decision, membership transition, and correlated audit writes.';

COMMIT;
