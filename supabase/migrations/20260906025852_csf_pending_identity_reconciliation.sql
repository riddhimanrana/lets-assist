BEGIN;

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
      AND v_row.resolution_status = 'pending'
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
      resolution_reason_code = 'matched_existing_profile',
      resolution_notes = p_reason,
      resolved_by = p_actor_user_id,
      resolved_at = v_now,
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

COMMIT;
