-- Add explicit individual officer approvals and preserve them during Sheet sync.
BEGIN;

CREATE TABLE plugin_data.csf_individual_application_approvals (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  application_id uuid NOT NULL,
  request_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  intent jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, application_id),
  UNIQUE (organization_id, request_id),
  FOREIGN KEY (application_id, organization_id)
    REFERENCES plugin_data.csf_term_applications(id, organization_id)
);
INSERT INTO plugin_data.csf_retention_reference_policy
  (parent_table, child_table, child_column, policy, note)
VALUES ('csf_term_applications', 'csf_individual_application_approvals',
  'application_id', 'retain_immutable', 'Immutable officer approval and retry receipt.');

CREATE TRIGGER csf_individual_application_approvals_immutable
BEFORE UPDATE OR DELETE ON plugin_data.csf_individual_application_approvals
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_application_decision_evidence();
ALTER TABLE plugin_data.csf_individual_application_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_individual_application_approvals FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE plugin_data.csf_individual_application_approvals TO service_role;

ALTER TABLE plugin_data.csf_application_decision_stages
  DROP CONSTRAINT csf_application_decision_stages_block_reason_check,
  ADD CONSTRAINT csf_application_decision_stages_block_reason_check CHECK (block_reason IN (
    'awaiting_review', 'missing_yellow_reason', 'unmapped_color', 'mixed_colors',
    'ambiguous_match', 'provenance_unverified', 'cross_source_conflict',
    'historical_outcome', 'term_closed', 'mapping_version_stale', 'officer_approved'
  ));

CREATE FUNCTION plugin_data.csf_preserve_individual_application_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM plugin_data.csf_individual_application_approvals AS approval
    WHERE approval.organization_id = NEW.organization_id
      AND approval.application_id = NEW.application_id
  ) THEN
    NEW.block_reason := 'officer_approved';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_preserve_individual_application_approval() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_preserve_individual_application_approval() TO postgres;
CREATE TRIGGER csf_preserve_individual_application_approval
BEFORE INSERT OR UPDATE ON plugin_data.csf_application_decision_stages
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_preserve_individual_application_approval();

CREATE FUNCTION plugin_data.csf_approve_individual_term_application(
  p_organization_id uuid, p_actor_user_id uuid,
  p_profile_id uuid, p_term_id uuid, p_application_id uuid,
  p_expected_updated_at timestamptz, p_reason text, p_request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_receipt plugin_data.csf_individual_application_approvals%ROWTYPE;
  v_intent jsonb;
  v_result jsonb;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
BEGIN
  PERFORM plugin_data.csf_assert_sheet_decision_authority(
    p_organization_id, p_actor_user_id, 'decide_applications',
    'Not authorized to approve CSF applications.'
  );
  IF p_request_id IS NULL OR p_expected_updated_at IS NULL
    OR v_reason IS NULL OR pg_catalog.length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'An approval needs a reviewed application, reason and stable request identifier.' USING ERRCODE = '22023';
  END IF;
  v_intent := pg_catalog.jsonb_build_object(
    'actorId', p_actor_user_id, 'profileId', p_profile_id, 'termId', p_term_id,
    'applicationId', p_application_id, 'expectedUpdatedAt', p_expected_updated_at, 'reason', v_reason
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'csf.individual_approval:' || p_organization_id::text || ':' || p_request_id::text, 0
  ));
  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_sheet_decision_term_lock_key(p_organization_id, p_term_id)
  );
  SELECT * INTO v_term FROM plugin_data.csf_terms
  WHERE organization_id = p_organization_id AND id = p_term_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Semester not found.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_application FROM plugin_data.csf_term_applications
  WHERE organization_id = p_organization_id AND id = p_application_id
    AND profile_id = p_profile_id AND term_id = p_term_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found for this student and semester.' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_receipt FROM plugin_data.csf_individual_application_approvals
  WHERE organization_id = p_organization_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_receipt.intent IS DISTINCT FROM v_intent THEN
      RAISE EXCEPTION 'This request was used for another approval.' USING ERRCODE = '22023',
        DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=request_conflict';
    END IF;
    IF v_application.decision_status IS DISTINCT FROM 'approved'
      OR v_application.updated_at IS DISTINCT FROM (v_receipt.result->>'updatedAt')::timestamptz THEN
      RAISE EXCEPTION 'The approved application changed. Reload before deciding.' USING ERRCODE = '55000',
        DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=saved_stale';
    END IF;
    RETURN v_receipt.result || pg_catalog.jsonb_build_object('replay', true);
  END IF;
  IF v_term.lifecycle_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'Only an open semester can receive an application approval.' USING ERRCODE = '55000';
  END IF;
  IF v_application.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'The application changed. Review it again before approving.' USING ERRCODE = '55000';
  END IF;
  IF v_application.decision_status IS DISTINCT FROM 'pending' OR EXISTS (
    SELECT 1 FROM plugin_data.csf_individual_application_approvals
    WHERE organization_id = p_organization_id AND application_id = p_application_id
  ) THEN
    RAISE EXCEPTION 'This application already has a decision.' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM plugin_data.csf_term_applications
      WHERE organization_id = p_organization_id AND profile_id = p_profile_id AND term_id = p_term_id) <> 1 THEN
    RAISE EXCEPTION 'Resolve the duplicate semester applications before approving.' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM plugin_data.csf_term_memberships
  WHERE organization_id = p_organization_id AND profile_id = p_profile_id AND term_id = p_term_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_term_memberships
    WHERE organization_id = p_organization_id AND profile_id = p_profile_id AND term_id = p_term_id
      AND status IN ('completed', 'not_completed')) THEN
    RAISE EXCEPTION 'A finalized semester keeps its published outcome.' USING ERRCODE = '55000';
  END IF;

  -- Reuse the officer decision transaction, which records evidence, membership and audit history.
  PERFORM plugin_data.csf_decide_term_application_policy_base(
    p_organization_id, p_application_id, 'accepted', v_reason, p_actor_user_id
  );
  SELECT * INTO v_application FROM plugin_data.csf_term_applications
  WHERE organization_id = p_organization_id AND id = p_application_id;
  v_result := pg_catalog.jsonb_build_object(
    'applicationId', p_application_id, 'profileId', p_profile_id, 'termId', p_term_id,
    'decision', 'approved', 'updatedAt', v_application.updated_at, 'replay', false
  );
  INSERT INTO plugin_data.csf_individual_application_approvals
    (organization_id, application_id, request_id, actor_user_id, intent, result)
  VALUES (p_organization_id, p_application_id, p_request_id, p_actor_user_id, v_intent, v_result);
  UPDATE plugin_data.csf_application_decision_stages
  SET block_reason = 'officer_approved', updated_at = pg_catalog.now()
  WHERE organization_id = p_organization_id AND application_id = p_application_id;
  INSERT INTO plugin_data.csf_admin_audit_events
    (organization_id, actor_user_id, action, target_type, target_id, term_id, after_data, correlation_id)
  VALUES (p_organization_id, p_actor_user_id, 'application.individual_officer_approval',
    'csf_term_application', p_application_id, p_term_id, v_result, p_request_id);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_approve_individual_term_application(uuid,uuid,uuid,uuid,uuid,timestamptz,text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_approve_individual_term_application(uuid,uuid,uuid,uuid,uuid,timestamptz,text,uuid) TO service_role;

COMMIT;
