-- Carry a staged Sheet decision through the audited profile merge.
--
-- `csf_application_decision_stages.profile_id` is the thirty-fourth column that
-- references a CSF profile, and the merge catalog has to say what happens to
-- it. A stage is current ownership, not history: it names the student whose
-- application is being decided right now. The published record of what the
-- chapter decided lives in `csf_application_status_events` and
-- `csf_admin_audit_events`, which the merge already retains.
--
-- So the policy is a same-transaction rewrite, and the invariant behind it is
-- that a stage always names the same student as its application. Leaving a
-- stage pointed at a merged-away profile would strand it: the officer list
-- joins profiles through `stage.profile_id` and would show a name the
-- application no longer belongs to.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. The invariant, enforced rather than assumed
-- ---------------------------------------------------------------------------

CREATE FUNCTION plugin_data.csf_guard_decision_stage_profile_matches_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application_profile_id uuid;
BEGIN
  SELECT application.profile_id
  INTO v_application_profile_id
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = NEW.organization_id
    AND application.id = NEW.application_id;

  IF v_application_profile_id IS DISTINCT FROM NEW.profile_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'A staged CSF decision must name the same student as its application.',
      DETAIL = 'CSF_DECISION_STAGE_PROFILE_MISMATCH=' || NEW.application_id::text,
      HINT = 'Rewrite the application owner and the staged decision in one transaction.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_guard_decision_stage_profile_matches_application()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER csf_decision_stage_profile_matches_application
  BEFORE INSERT OR UPDATE OF profile_id, application_id
  ON plugin_data.csf_application_decision_stages
  FOR EACH ROW
  EXECUTE FUNCTION plugin_data.csf_guard_decision_stage_profile_matches_application();

-- ---------------------------------------------------------------------------
-- B. The merge catalog classifies the new reference
-- ---------------------------------------------------------------------------

ALTER FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid, uuid)
  RENAME TO csf_profile_merge_reference_plan_decision_stages_base;

CREATE FUNCTION plugin_data.csf_profile_merge_reference_plan(
  p_organization_id uuid,
  p_source_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan jsonb;
BEGIN
  v_plan := plugin_data.csf_profile_merge_reference_plan_decision_stages_base(
    p_organization_id, p_source_profile_id
  );

  RETURN pg_catalog.jsonb_set(
    v_plan,
    '{sameTransactionRewrites}',
    coalesce(v_plan -> 'sameTransactionRewrites', '[]'::jsonb)
      || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'reference', 'plugin_data.csf_application_decision_stages.profile_id',
          'scope',
          'staged and released Sheet decisions follow their application owner; the published decision history stays in the status events and audit trail',
          'sourceCount', (
            SELECT pg_catalog.count(*)
            FROM plugin_data.csf_application_decision_stages AS stage
            WHERE stage.organization_id = p_organization_id
              AND stage.profile_id = p_source_profile_id
          )
        )
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_reference_plan_decision_stages_base(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_reference_plan_decision_stages_base(uuid, uuid)
  TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid, uuid)
  TO postgres;

-- ---------------------------------------------------------------------------
-- C. The merge performs the rewrite it promised
--
-- The base rewrites `csf_term_applications.profile_id` first, so by the time
-- the stages move, the trigger in section A sees an application that already
-- names the target. The final check is the reverse direction: no stage in this
-- chapter may disagree with its application after the merge commits.
-- ---------------------------------------------------------------------------

ALTER FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid)
  RENAME TO csf_merge_profiles_decision_stages_base;

CREATE FUNCTION plugin_data.csf_merge_profiles(
  p_organization_id uuid,
  p_source_profile_id uuid,
  p_target_profile_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before jsonb;
  v_count integer;
  v_changed integer;
  v_result jsonb;
  v_review_id uuid;
  v_correlation_id uuid;
  v_mismatched integer;
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);

  SELECT
    coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'applicationId', stage.application_id,
        'releaseState', stage.release_state,
        'stagedDecision', stage.staged_decision
      ) ORDER BY stage.application_id
    ), '[]'::jsonb),
    pg_catalog.count(*)::integer
  INTO v_before, v_count
  FROM (
    SELECT *
    FROM plugin_data.csf_application_decision_stages
    WHERE organization_id = p_organization_id
      AND profile_id = p_source_profile_id
    ORDER BY id
    FOR UPDATE
  ) AS stage;

  v_result := plugin_data.csf_merge_profiles_decision_stages_base(
    p_organization_id, p_source_profile_id, p_target_profile_id,
    p_reason, p_actor_user_id
  );

  IF v_count > 0 THEN
    v_review_id := nullif(v_result ->> 'reviewId', '')::uuid;
    v_correlation_id := nullif(v_result ->> 'correlationId', '')::uuid;
    IF v_review_id IS NULL OR v_correlation_id IS NULL THEN
      RAISE EXCEPTION
        'The profile merge did not return its staged-decision evidence identifiers.'
        USING ERRCODE = '55000';
    END IF;

    UPDATE plugin_data.csf_application_decision_stages
    SET profile_id = p_target_profile_id,
        updated_at = pg_catalog.now()
    WHERE organization_id = p_organization_id
      AND profile_id = p_source_profile_id;
    GET DIAGNOSTICS v_changed = ROW_COUNT;

    IF v_changed <> v_count THEN
      RAISE EXCEPTION
        'The staged CSF decisions changed during the profile merge.'
        USING ERRCODE = '40001';
    END IF;

    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id, actor_user_id, action, target_type, target_id,
      before_data, after_data, correlation_id
    )
    VALUES (
      p_organization_id, p_actor_user_id,
      'profile_merge.decision_stages_reassigned', 'csf_profile_merge_reviews',
      v_review_id,
      pg_catalog.jsonb_build_object(
        'sourceProfileId', p_source_profile_id, 'stages', v_before
      ),
      pg_catalog.jsonb_build_object(
        'targetProfileId', p_target_profile_id, 'rewrittenCount', v_changed
      ),
      v_correlation_id
    );
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO v_mismatched
  FROM plugin_data.csf_application_decision_stages AS stage
  JOIN plugin_data.csf_term_applications AS application
    ON application.id = stage.application_id
   AND application.organization_id = stage.organization_id
  WHERE stage.organization_id = p_organization_id
    AND stage.profile_id IS DISTINCT FROM application.profile_id;

  IF v_mismatched > 0 THEN
    RAISE EXCEPTION
      'The profile merge left % staged CSF decisions pointing at the wrong student.',
      v_mismatched
      USING ERRCODE = '55000';
  END IF;

  RETURN v_result
    || pg_catalog.jsonb_build_object('rewrittenDecisionStages', v_count);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles_decision_stages_base(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles_decision_stages_base(uuid, uuid, uuid, text, uuid)
  TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid)
  TO postgres;

COMMENT ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid) IS
  'Audited CSF profile merge. Staged Sheet decisions follow their application owner and the merge fails closed if any stage disagrees with its application afterwards.';

COMMIT;
