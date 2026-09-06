BEGIN;

CREATE UNIQUE INDEX csf_officer_annotation_review_request_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id)
  WHERE action = 'sheets.annotation_reviewed';

CREATE FUNCTION plugin_data.csf_review_import_annotation(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_row_id uuid,
  p_request_id uuid,
  p_outcome text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_job plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_fingerprint text;
  v_result jsonb;
BEGIN
  IF p_request_id IS NULL OR p_row_id IS NULL OR p_actor_user_id IS NULL
    OR p_outcome IS NULL OR p_outcome NOT IN ('met','not_met','exception_met')
    OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 4 AND 500 THEN
    RAISE EXCEPTION 'Choose an outcome and provide a review reason and request identifier.'
      USING ERRCODE = '22023';
  END IF;
  PERFORM plugin_data.csf_assert_import_actor(p_organization_id,p_actor_user_id,'class_history');
  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );
  PERFORM m.user_id FROM public.organization_members m
    WHERE m.organization_id=p_organization_id AND m.user_id=p_actor_user_id FOR SHARE;
  PERFORM plugin_data.csf_assert_import_actor(p_organization_id,p_actor_user_id,'class_history');
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'csf_annotation_review:' || p_organization_id::text || ':' || p_request_id::text,0
  ));
  v_fingerprint := pg_catalog.encode(extensions.digest(
    pg_catalog.jsonb_build_array(p_actor_user_id,p_row_id,p_outcome,btrim(p_reason))::text,
    'sha256'),'hex');
  SELECT * INTO v_receipt FROM plugin_data.csf_admin_audit_events
    WHERE organization_id=p_organization_id AND correlation_id=p_request_id
      AND action='sheets.annotation_reviewed';
  IF FOUND THEN
    IF v_receipt.after_data->>'requestFingerprint' IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'This request identifier belongs to another decision.' USING ERRCODE='22023';
    END IF;
    RETURN (v_receipt.after_data->'result') || '{"replayed":true}'::jsonb;
  END IF;

  SELECT * INTO v_row FROM plugin_data.csf_sheet_import_rows
    WHERE organization_id=p_organization_id AND id=p_row_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import row not found.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_job FROM plugin_data.csf_sheet_import_jobs
    WHERE organization_id=p_organization_id AND id=v_row.job_id FOR UPDATE;
  IF NOT FOUND OR v_job.mode<>'preview' OR v_job.source_type<>'class_history' THEN
    RAISE EXCEPTION 'Choose a class history preview row.' USING ERRCODE='22023';
  END IF;
  -- Match approval's lock order so a queue receipt cannot race this decision.
  SELECT * INTO v_row FROM plugin_data.csf_sheet_import_rows
    WHERE organization_id=p_organization_id AND id=p_row_id AND job_id=v_job.id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import row not found.' USING ERRCODE='22023';
  END IF;
  IF v_row.import_status NOT IN ('pending','error')
    OR v_row.resolution_status<>'pending' OR v_row.commit_attempt_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM plugin_data.csf_import_commit_queue q
      WHERE q.organization_id=p_organization_id AND q.preview_job_id=v_job.id
        AND q.status IN ('queued','running')) THEN
    RAISE EXCEPTION 'This row is already reviewed or approved for import.' USING ERRCODE='22023';
  END IF;
  IF v_row.matched_profile_id IS NULL AND
    plugin_data.csf_class_history_source_key_requires_review(p_organization_id,p_row_id) THEN
    RAISE EXCEPTION 'Resolve the source identity before reviewing its semester outcome.' USING ERRCODE='22023';
  END IF;

  v_result := plugin_data.csf_apply_import_annotation_interpretation(
    p_organization_id,p_row_id,p_outcome,btrim(p_reason),p_actor_user_id
  );
  IF v_result->>'status' IS DISTINCT FROM 'settled' THEN
    RAISE EXCEPTION 'The officer decision could not be confirmed.';
  END IF;
  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,actor_user_id,action,target_type,target_id,
    before_data,after_data,source_type,source_id,reason_code,correlation_id
  ) VALUES (
    p_organization_id,p_actor_user_id,'sheets.annotation_reviewed','csf_sheet_import_rows',p_row_id,
    pg_catalog.jsonb_build_object('resolutionStatus',v_row.resolution_status,'rowHash',v_row.row_hash),
    pg_catalog.jsonb_build_object('requestFingerprint',v_fingerprint,'result',v_result),
    'class_history',v_job.id::text,'officer_annotation_review',p_request_id
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_review_import_annotation(uuid,uuid,uuid,uuid,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_import_annotation(uuid,uuid,uuid,uuid,text,text)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_apply_import_annotation_interpretation(uuid,uuid,text,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

COMMENT ON FUNCTION plugin_data.csf_review_import_annotation(uuid,uuid,uuid,uuid,text,text) IS
  'Explicit staff review of immutable class sheet evidence. Records an atomic audit receipt, preserves import blockers, and does not commit the preview.';

COMMIT;
