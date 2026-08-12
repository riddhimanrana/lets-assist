-- Fix duplicate verified-account consolidation without weakening the
-- organization-scoped uniqueness constraint or deleting retained evidence.
CREATE OR REPLACE FUNCTION plugin_data.csf_merge_profiles_identity_base(p_organization_id uuid, p_source_profile_id uuid, p_target_profile_id uuid, p_reason text, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_source plugin_data.csf_profiles%ROWTYPE;
  v_target plugin_data.csf_profiles%ROWTYPE;
  v_preview jsonb;
  v_review_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_moved_accounts integer := 0;
  v_moved_records integer := 0;
  v_moved_import_matches integer := 0;
  v_row_count integer := 0;
BEGIN
  IF p_source_profile_id = p_target_profile_id THEN
    RAISE EXCEPTION 'Choose two different CSF student records.';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL OR length(btrim(p_reason)) < 8 THEN
    RAISE EXCEPTION 'Explain why these two CSF student records are duplicates.';
  END IF;

  PERFORM 1
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id IN (p_source_profile_id, p_target_profile_id)
  ORDER BY profile.id
  FOR UPDATE;

  SELECT profile.* INTO v_source
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_source_profile_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source CSF student record not found.'; END IF;

  SELECT profile.* INTO v_target
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_target_profile_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target CSF student record not found.'; END IF;
  IF v_source.record_status <> 'active' THEN RAISE EXCEPTION 'The source CSF student record has already been merged.'; END IF;
  IF v_target.record_status <> 'active' THEN RAISE EXCEPTION 'The target CSF student record is not active.'; END IF;

  v_preview := plugin_data.csf_profile_merge_preview(
    p_organization_id,
    p_source_profile_id,
    p_target_profile_id
  );
  IF coalesce((v_preview->>'canMerge')::boolean, false) = false THEN
    RAISE EXCEPTION USING
      MESSAGE = 'These CSF student records have conflicts that must be resolved before merging.',
      DETAIL = (v_preview->'conflicts')::text,
      HINT = 'Review the duplicate semester, attendance, signup, class, or verified-account records.';
  END IF;

  INSERT INTO plugin_data.csf_profile_merge_reviews (
    id, organization_id, source_profile_id, target_profile_id, reason,
    evidence, status, requested_by, reviewed_by, reviewed_at, notes,
    correlation_id, source_snapshot, target_snapshot, conflict_snapshot,
    created_at, updated_at
  ) VALUES (
    v_review_id,
    p_organization_id,
    p_source_profile_id,
    p_target_profile_id,
    btrim(p_reason),
    jsonb_build_object('preview', v_preview),
    'approved',
    p_actor_user_id,
    p_actor_user_id,
    v_now,
    'Completed through the audited member correction workflow.',
    v_correlation_id,
    v_preview->'source',
    v_preview->'target',
    v_preview->'conflicts',
    v_now,
    v_now
  );

  -- Revoke duplicate source accounts before promoting the matching target.
  -- The data-modifying CTE preserves the source values while ensuring the
  -- partial verified-account unique index never observes two verified rows.
  WITH source_snapshot AS MATERIALIZED (
    SELECT
      source_account.id AS source_account_id,
      source_account.status AS source_status,
      source_account.is_primary AS source_is_primary,
      source_account.linked_by AS source_linked_by,
      source_account.linked_at AS source_linked_at,
      target_account.id AS target_account_id
    FROM plugin_data.csf_profile_accounts AS source_account
    JOIN plugin_data.csf_profile_accounts AS target_account
      ON target_account.organization_id = source_account.organization_id
     AND target_account.profile_id = p_target_profile_id
     AND target_account.user_id = source_account.user_id
    WHERE source_account.organization_id = p_organization_id
      AND source_account.profile_id = p_source_profile_id
    FOR UPDATE OF source_account, target_account
  ),
  revoked_source AS (
    UPDATE plugin_data.csf_profile_accounts AS source_account
    SET status = 'revoked',
        is_primary = false,
        revoked_at = v_now,
        notes = concat_ws(E'\n', nullif(source_account.notes, ''), 'Superseded by profile merge ' || v_correlation_id::text || '.')
    FROM source_snapshot
    WHERE source_account.id = source_snapshot.source_account_id
    RETURNING source_account.id
  )
  UPDATE plugin_data.csf_profile_accounts AS target_account
  SET status = CASE
        WHEN source_snapshot.source_status = 'verified' THEN 'verified'
        WHEN target_account.status = 'verified' THEN 'verified'
        WHEN source_snapshot.source_status = 'pending' THEN 'pending'
        ELSE target_account.status
      END,
      is_primary = CASE
        WHEN source_snapshot.source_status = 'verified'
          AND source_snapshot.source_is_primary THEN true
        ELSE target_account.is_primary
      END,
      linked_by = coalesce(target_account.linked_by, source_snapshot.source_linked_by),
      linked_at = least(target_account.linked_at, source_snapshot.source_linked_at),
      revoked_at = CASE
        WHEN source_snapshot.source_status = 'verified'
          OR target_account.status = 'verified' THEN NULL
        ELSE target_account.revoked_at
      END,
      notes = concat_ws(E'\n', nullif(target_account.notes, ''), 'Duplicate account row consolidated during profile merge ' || v_correlation_id::text || '.')
  FROM source_snapshot
  WHERE target_account.id = source_snapshot.target_account_id
    AND EXISTS (
      SELECT 1
      FROM revoked_source
      WHERE revoked_source.id = source_snapshot.source_account_id
    );

  UPDATE plugin_data.csf_profile_accounts
  SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id
    AND profile_id = p_source_profile_id
    AND status <> 'revoked';
  GET DIAGNOSTICS v_moved_accounts = ROW_COUNT;

  UPDATE plugin_data.csf_term_applications SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_term_memberships SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_profile_cohort_memberships SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_point_submissions SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_credit_records SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_point_appeals SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_submission_files SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_meeting_attendance SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_opportunity_signups SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_partner_submission_rows SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_profile_activity_events SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_profile_restrictions SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_staff_positions SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_application_files SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_dues_records SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_sheet_import_rows AS import_row
  SET matched_profile_id = p_target_profile_id
  WHERE import_row.organization_id = p_organization_id
    AND import_row.matched_profile_id = p_source_profile_id
    AND plugin_data.csf_profile_merge_import_row_disposition(
      import_row.commit_frozen_at,
      import_row.commit_target_profile_id,
      import_row.matched_profile_id,
      import_row.commit_attempt_id,
      import_row.commit_retry_count,
      import_row.commit_outcome_state,
      import_row.import_status,
      import_row.commit_outcome_resolution
    ) = 'live_rewrite';
  GET DIAGNOSTICS v_moved_import_matches = ROW_COUNT;

  UPDATE plugin_data.csf_profile_link_requests
  SET matched_profile_id = CASE WHEN matched_profile_id = p_source_profile_id THEN p_target_profile_id ELSE matched_profile_id END,
      candidate_profile_ids = array_replace(candidate_profile_ids, p_source_profile_id, p_target_profile_id),
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND (
      matched_profile_id = p_source_profile_id
      OR p_source_profile_id = ANY(candidate_profile_ids)
    );

  UPDATE plugin_data.csf_profile_merge_reviews
  SET status = 'cancelled',
      reviewed_by = p_actor_user_id,
      reviewed_at = v_now,
      notes = concat_ws(E'\n', nullif(notes, ''), 'Cancelled because the source profile was merged by review ' || v_review_id::text || '.'),
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id <> v_review_id
    AND status = 'pending'
    AND (source_profile_id = p_source_profile_id OR target_profile_id = p_source_profile_id);

  UPDATE plugin_data.csf_profiles
  SET source_summary = coalesce(source_summary, '{}'::jsonb) || jsonb_build_object(
        'mergedProfiles',
        coalesce(source_summary->'mergedProfiles', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'profileId', v_source.id,
          'mergedAt', v_now,
          'correlationId', v_correlation_id,
          'sourceSummary', v_source.source_summary
        ))
      ),
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_target_profile_id;

  UPDATE plugin_data.csf_profiles
  SET record_status = 'merged',
      merged_into_profile_id = p_target_profile_id,
      merged_at = v_now,
      merged_by = p_actor_user_id,
      merge_reason = btrim(p_reason),
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_source_profile_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'profile.merge',
    'csf_profiles',
    p_target_profile_id,
    jsonb_build_object(
      'targetProfileId', p_target_profile_id,
      'targetRecordStatus', v_target.record_status
    ),
    jsonb_build_object(
      'sourceProfileId', p_source_profile_id,
      'targetProfileId', p_target_profile_id,
      'reasonRecorded', true,
      'reviewId', v_review_id,
      'movedAccounts', v_moved_accounts,
      'movedRecords', v_moved_records,
      'sourceProvenancePreserved', true
    ),
    v_correlation_id,
    'duplicate_profile_merged'
  );

  RETURN jsonb_build_object(
    'sourceProfileId', p_source_profile_id,
    'targetProfileId', p_target_profile_id,
    'reviewId', v_review_id,
    'movedAccounts', v_moved_accounts,
    'movedRecords', v_moved_records,
    'importRowLiveMatches', v_moved_import_matches,
    'correlationId', v_correlation_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles_identity_base(
  uuid, uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
