-- Bind an officer decision to the exact submission revision they inspected.
BEGIN;
CREATE FUNCTION plugin_data.csf_review_point_submission_revision_request(
  p_organization_id uuid, p_submission_id uuid, p_action text,
  p_awarded_points numeric, p_review_notes text, p_actor_user_id uuid,
  p_request_id uuid, p_expected_revision bigint, p_awarded_point_type text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  s plugin_data.csf_point_submissions%ROWTYPE;
  receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  fingerprint text; result jsonb; resulting_revision bigint;
BEGIN
  PERFORM plugin_data.csf_assert_point_actor_authority(p_organization_id,p_actor_user_id,ARRAY['verify_submissions']::text[]);
  IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0 THEN
    RAISE EXCEPTION 'Reload this submission before reviewing its current revision.' USING ERRCODE='40001';
  END IF;
  SELECT * INTO s FROM plugin_data.csf_point_submissions WHERE organization_id=p_organization_id AND id=p_submission_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Point submission was not found.'; END IF;
  fingerprint:=plugin_data.csf_point_request_fingerprint('review_submission_revision',p_organization_id,p_actor_user_id,
    jsonb_build_object('submissionId',p_submission_id,'expectedRevision',p_expected_revision,'action',p_action,'points',p_awarded_points,'notes',p_review_notes,'pointType',p_awarded_point_type));
  PERFORM pg_advisory_xact_lock(hashtextextended('plugin_data.csf_point_action_request:'||p_organization_id::text||':'||p_request_id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||s.term_id::text,0));
  SELECT * INTO s FROM plugin_data.csf_point_submissions WHERE organization_id=p_organization_id AND id=p_submission_id FOR UPDATE;
  SELECT * INTO receipt FROM plugin_data.csf_admin_audit_events WHERE organization_id=p_organization_id AND correlation_id=p_request_id AND source_type='point_review_revision' LIMIT 1;
  IF FOUND THEN
    IF receipt.actor_user_id IS DISTINCT FROM p_actor_user_id OR receipt.target_id IS DISTINCT FROM p_submission_id OR receipt.after_data->>'fingerprint' IS DISTINCT FROM fingerprint THEN
      RAISE EXCEPTION 'That point request identifier is already bound to a different change.';
    END IF;
    IF s.revision IS DISTINCT FROM (receipt.after_data->>'resultingRevision')::bigint THEN
      RAISE EXCEPTION 'This submission changed. Reload its details and proof before reviewing.' USING ERRCODE='40001';
    END IF;
  ELSIF s.revision<>p_expected_revision OR s.status<>'submitted' THEN
    RAISE EXCEPTION 'This submission changed. Reload its details and proof before reviewing.' USING ERRCODE='40001';
  END IF;
  IF s.request_kind='exception' AND p_action='approved' THEN
    result:=plugin_data.csf_review_point_exception_request(p_organization_id,p_submission_id,p_action,p_awarded_points,p_review_notes,p_actor_user_id,p_request_id,p_awarded_point_type);
  ELSE
    result:=plugin_data.csf_review_point_submission_request(p_organization_id,p_submission_id,p_action,p_awarded_points,p_review_notes,p_actor_user_id,p_request_id);
  END IF;
  IF receipt.id IS NULL THEN
    SELECT revision INTO resulting_revision FROM plugin_data.csf_point_submissions WHERE id=p_submission_id AND organization_id=p_organization_id;
    INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,actor_profile_id,action,target_type,target_id,term_id,before_data,after_data,correlation_id,source_type,source_id,reason_code)
    VALUES(p_organization_id,p_actor_user_id,s.profile_id,'point_submission.revision_reviewed','csf_point_submissions',p_submission_id,s.term_id,
      jsonb_build_object('revision',p_expected_revision),jsonb_build_object('fingerprint',fingerprint,'resultingRevision',resulting_revision),p_request_id,'point_review_revision',p_submission_id::text,'officer_review_revision_fence');
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_review_point_submission_revision_request(uuid,uuid,text,numeric,text,uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_point_submission_revision_request(uuid,uuid,text,numeric,text,uuid,uuid,bigint,text) TO service_role;
COMMIT;
