BEGIN;

-- Identity and semester evidence are separate officer decisions. Preserve the
-- annotation outcome when matching, and allow annotation review after matching.
CREATE OR REPLACE FUNCTION plugin_data.csf_reconcile_sheet_import_row_identity_base(
  p_organization_id uuid,
  p_row_id uuid,
  p_profile_id uuid,
  p_decision text,
  p_reason text,
  p_actor_user_id uuid,
  p_correlation_id uuid,
  p_match_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_correlation_id uuid;
  v_partner_batch_id uuid;
  v_action text;
  v_reason_code text;
  v_now timestamptz := now();
BEGIN
  IF p_decision NOT IN ('match', 'skip') THEN
    RAISE EXCEPTION 'Import-row reconciliation decision must be match or skip.';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reconciliation reason is required.';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'A reconciliation actor is required.';
  END IF;
  IF p_match_metadata IS NOT NULL
    AND jsonb_typeof(p_match_metadata) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Match metadata must be a JSON object.';
  END IF;

  SELECT import_row.*
  INTO v_row
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_row_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import row not found.';
  END IF;

  v_correlation_id := v_row.correlation_id;
  IF p_correlation_id IS NOT NULL AND p_correlation_id <> v_correlation_id THEN
    RAISE EXCEPTION 'The reconciliation correlation does not match the immutable import row.';
  END IF;

  IF p_decision = 'match' THEN
    IF p_profile_id IS NULL THEN
      RAISE EXCEPTION 'Choose the matching CSF member.';
    END IF;

    SELECT profile.*
    INTO v_profile
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = p_profile_id
      AND profile.record_status = 'active';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CSF member not found.';
    END IF;

    IF v_row.resolution_status = 'resolved'
      AND v_row.import_status = 'pending'
      AND v_row.matched_profile_id = p_profile_id
    THEN
      RETURN jsonb_build_object(
        'rowId', v_row.id,
        'decision', p_decision,
        'profileId', p_profile_id,
        'correlationId', v_correlation_id,
        'idempotent', true
      );
    END IF;

    IF v_row.import_status NOT IN ('ambiguous', 'conflict', 'duplicate') AND NOT (
      v_row.import_status = 'pending'
      AND (v_row.resolution_status = 'pending' OR (
        v_row.resolution_status = 'resolved'
        AND v_row.resolution_reason_code IN ('annotation_met','annotation_not_met','annotation_exception_met')
      ))
      AND v_row.matched_profile_id IS NULL
      AND v_row.commit_attempt_id IS NULL
      AND coalesce(cardinality(v_row.errors),0) = 0
      AND NOT EXISTS (
        SELECT 1 FROM plugin_data.csf_import_commit_queue q
        WHERE q.organization_id=p_organization_id AND q.preview_job_id=v_row.job_id
          AND q.status IN ('queued','running')
      )
      AND EXISTS (
        SELECT 1 FROM plugin_data.csf_sheet_import_jobs j
        WHERE j.organization_id=p_organization_id AND j.id=v_row.job_id
          AND j.mode='preview' AND j.source_type='class_history'
      )
      AND EXISTS (
        SELECT 1 FROM plugin_data.csf_profile_cohort_memberships m
        WHERE m.organization_id=p_organization_id AND m.profile_id=p_profile_id
          AND m.cohort_id=v_row.cohort_id AND m.status='active'
      )
      AND (
        NOT plugin_data.csf_class_history_has_stable_source_key(v_row.normalized_data)
        OR plugin_data.csf_class_history_source_key_requires_review(p_organization_id,p_row_id)
      )
    ) THEN
      RAISE EXCEPTION 'This row no longer needs a matching decision.';
    END IF;

    UPDATE plugin_data.csf_sheet_import_rows
    SET
      matched_profile_id = p_profile_id,
      import_status = 'pending',
      errors = ARRAY[]::text[],
      resolution_status = 'resolved',
      resolution_reason_code = CASE WHEN v_row.resolution_reason_code IN
        ('annotation_met','annotation_not_met','annotation_exception_met')
        THEN v_row.resolution_reason_code ELSE 'matched_existing_profile' END,
      resolution_notes = CASE WHEN v_row.resolution_reason_code IN
        ('annotation_met','annotation_not_met','annotation_exception_met')
        THEN v_row.resolution_notes ELSE p_reason END,
      resolved_by = CASE WHEN v_row.resolution_reason_code IN
        ('annotation_met','annotation_not_met','annotation_exception_met')
        THEN v_row.resolved_by ELSE p_actor_user_id END,
      resolved_at = CASE WHEN v_row.resolution_reason_code IN
        ('annotation_met','annotation_not_met','annotation_exception_met')
        THEN v_row.resolved_at ELSE v_now END,
      resolution_metadata = coalesce(p_match_metadata, '{}'::jsonb)
    WHERE organization_id = p_organization_id
      AND id = p_row_id;

    v_action := 'sheets.row_match_resolved';
    v_reason_code := 'matched_existing_profile';
  ELSE
    IF v_row.resolution_status = 'ignored' AND v_row.import_status = 'skipped' THEN
      RETURN jsonb_build_object(
        'rowId', v_row.id,
        'decision', p_decision,
        'correlationId', v_correlation_id,
        'idempotent', true
      );
    END IF;

    IF v_row.import_status NOT IN ('pending', 'ambiguous', 'conflict', 'duplicate', 'error') THEN
      RAISE EXCEPTION 'This row has already been imported or skipped.';
    END IF;

    UPDATE plugin_data.csf_sheet_import_rows
    SET
      import_status = 'skipped',
      errors = ARRAY[]::text[],
      resolution_status = 'ignored',
      resolution_reason_code = 'officer_skipped',
      resolution_notes = p_reason,
      resolved_by = p_actor_user_id,
      resolved_at = v_now
    WHERE organization_id = p_organization_id
      AND id = p_row_id;

    v_action := 'sheets.row_skipped';
    v_reason_code := 'officer_skipped';
  END IF;

  BEGIN
    v_partner_batch_id := nullif(v_row.normalized_data->>'partnerAuditBatchId', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'The partner-audit batch reference on this import row is invalid.';
  END;

  IF v_partner_batch_id IS NOT NULL AND v_row.row_hash IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_partner_submission_batches AS batch
      WHERE batch.organization_id = p_organization_id
        AND batch.id = v_partner_batch_id
    ) THEN
      RAISE EXCEPTION 'The linked partner-audit batch was not found in this organization.';
    END IF;

    UPDATE plugin_data.csf_partner_submission_rows
    SET
      profile_id = CASE WHEN p_decision = 'match' THEN p_profile_id ELSE profile_id END,
      matched_status = CASE WHEN p_decision = 'match' THEN 'matched' ELSE 'rejected' END
    WHERE organization_id = p_organization_id
      AND batch_id = v_partner_batch_id
      AND normalized_data #>> '{source,rowHash}' = v_row.row_hash;
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    v_action,
    'csf_sheet_import_rows',
    v_row.id,
    v_row.term_id,
    jsonb_build_object(
      'decision', p_decision,
      'profileId', CASE WHEN p_decision = 'match' THEN p_profile_id ELSE NULL END,
      'profileName', CASE
        WHEN p_decision = 'match' THEN btrim(concat_ws(' ', v_profile.first_name, v_profile.last_name))
        ELSE NULL
      END,
      'previousStatus', v_row.import_status,
      'jobId', v_row.job_id,
      'sourceId', v_row.source_id,
      'reason', p_reason,
      'matchMetadata', p_match_metadata
    ),
    v_correlation_id,
    'sheet_import',
    coalesce(v_row.source_id::text, v_row.job_id::text),
    v_reason_code
  );

  RETURN jsonb_build_object(
    'rowId', v_row.id,
    'decision', p_decision,
    'profileId', CASE WHEN p_decision = 'match' THEN p_profile_id ELSE NULL END,
    'correlationId', v_correlation_id,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_reconcile_sheet_import_row_identity_base(uuid,uuid,uuid,text,text,uuid,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_reconcile_sheet_import_row_identity_base(uuid,uuid,uuid,text,text,uuid,uuid,jsonb)
  TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_apply_import_annotation_interpretation(
  p_organization_id uuid,
  p_row_id uuid,
  p_outcome text,
  p_reason text,
  p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row plugin_data.csf_sheet_import_rows;
  v_blocking_error text;
  v_has_evidence boolean;
  v_met boolean;
BEGIN
  IF p_outcome NOT IN ('met', 'exception_met', 'not_met') THEN
    RAISE EXCEPTION 'Annotation settlement outcome must be met, exception_met, or not_met.';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 4 THEN
    RAISE EXCEPTION 'A settlement reason is required.';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'A settlement actor is required.';
  END IF;

  SELECT * INTO v_row
  FROM plugin_data.csf_sheet_import_rows
  WHERE id = p_row_id
    AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import row not found.';
  END IF;

  IF v_row.resolution_status <> 'pending' AND NOT (
    v_row.resolution_status = 'resolved'
    AND v_row.resolution_reason_code = 'matched_existing_profile'
    AND v_row.matched_profile_id IS NOT NULL
  ) THEN
    RETURN jsonb_build_object(
      'status', 'already_settled',
      'rowNumber', v_row.row_number
    );
  END IF;
  IF v_row.import_status NOT IN ('pending', 'error')
    OR v_row.commit_attempt_id IS NOT NULL THEN
    RAISE EXCEPTION 'This row is no longer settleable.';
  END IF;

  -- Any error that is not the activity-points reconciliation message is a real
  -- blocker this settlement has no authority over.
  SELECT err INTO v_blocking_error
  FROM unnest(COALESCE(v_row.errors, ARRAY[]::text[])) AS err
  WHERE err NOT LIKE 'Activity values without explicit numeric points%'
  LIMIT 1;
  IF v_blocking_error IS NOT NULL THEN
    RAISE EXCEPTION 'Row % keeps a non-annotation blocker: %',
      v_row.row_number, v_blocking_error;
  END IF;

  v_has_evidence := coalesce(
    (
      jsonb_typeof(v_row.normalized_data -> 'annotations') = 'object'
        AND v_row.normalized_data -> 'annotations' <> '{}'::jsonb
    ),
    false
  ) OR coalesce(
    jsonb_typeof(
      v_row.normalized_data -> 'commitPayload' -> 'allRequirementsMet'
    ) = 'boolean',
    false
  );
  IF NOT v_has_evidence THEN
    RAISE EXCEPTION 'Row % carries no presentation evidence to settle from.',
      v_row.row_number;
  END IF;

  v_met := p_outcome IN ('met', 'exception_met');

  -- normalized_data is immutable evidence (csf_preserve_import_row_snapshot),
  -- so the outcome rides the mutable resolution columns; the commit path reads
  -- the annotation_* reason codes as the completion override.
  UPDATE plugin_data.csf_sheet_import_rows
  SET
    errors = ARRAY[]::text[],
    import_status = 'pending',
    resolution_status = 'resolved',
    resolution_reason_code = CASE p_outcome
      WHEN 'met' THEN 'annotation_met'
      WHEN 'exception_met' THEN 'annotation_exception_met'
      ELSE 'annotation_not_met'
    END,
    resolution_notes = btrim(p_reason),
    resolved_by = p_actor_user_id,
    resolved_at = now()
  WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'status', 'settled',
    'rowNumber', v_row.row_number,
    'outcome', p_outcome,
    'allRequirementsMet', v_met
  );
END;
$$;


REVOKE ALL ON FUNCTION plugin_data.csf_apply_import_annotation_interpretation(uuid,uuid,text,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_apply_import_annotation_interpretation(uuid,uuid,text,text,uuid)
  TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_review_import_annotation(
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
    OR (v_row.resolution_status<>'pending' AND NOT (
      v_row.resolution_status='resolved'
      AND v_row.resolution_reason_code='matched_existing_profile'
      AND v_row.matched_profile_id IS NOT NULL
    )) OR v_row.commit_attempt_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM plugin_data.csf_import_commit_queue q
      WHERE q.organization_id=p_organization_id AND q.preview_job_id=v_job.id
        AND q.status IN ('queued','running')) THEN
    RAISE EXCEPTION 'This row is already reviewed or approved for import.' USING ERRCODE='22023';
  END IF;
  -- Reviewing semester evidence does not resolve identity. Readiness continues
  -- to block an unmatched source key until the separate matching decision.

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
