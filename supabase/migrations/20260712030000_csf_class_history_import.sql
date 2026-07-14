-- Atomically apply one reviewed row from a legacy DVHS CSF class workbook.

BEGIN;

DROP FUNCTION IF EXISTS plugin_data.csf_import_class_history_row(
  uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
);

CREATE OR REPLACE FUNCTION plugin_data.csf_import_class_history_row(
  p_organization_id uuid,
  p_profile_id uuid,
  p_first_name text,
  p_last_name text,
  p_school_email text,
  p_personal_email text,
  p_normalized_first_name text,
  p_normalized_last_name text,
  p_normalized_school_email text,
  p_normalized_personal_email text,
  p_cohort_id uuid,
  p_term_id uuid,
  p_source_id uuid,
  p_import_row_id uuid,
  p_row_hash text,
  p_activities jsonb,
  p_meetings jsonb,
  p_all_requirements_met boolean,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_activity jsonb;
  v_meeting jsonb;
  v_profile_id uuid;
  v_import_status text;
  v_status text;
  v_membership_status text;
  v_source_cohort_id uuid;
  v_source_settings jsonb;
  v_import_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_affected integer := 0;
  v_activity_count integer := 0;
  v_meeting_count integer := 0;
  v_now timestamptz := now();
BEGIN
  IF jsonb_typeof(p_activities) <> 'array' OR jsonb_typeof(p_meetings) <> 'array' THEN
    RAISE EXCEPTION 'Class-history activities and meetings must be arrays.';
  END IF;

  IF nullif(btrim(p_first_name), '') IS NULL
    OR nullif(btrim(p_last_name), '') IS NULL
    OR nullif(btrim(p_normalized_first_name), '') IS NULL
    OR nullif(btrim(p_normalized_last_name), '') IS NULL THEN
    RAISE EXCEPTION 'A first and last name are required for a class-history import.';
  END IF;

  PERFORM 1
  FROM plugin_data.csf_cohorts AS cohort
  WHERE cohort.organization_id = p_organization_id
    AND cohort.id = p_cohort_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF class was not found.';
  END IF;

  PERFORM 1
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF term was not found.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_cohort_terms AS cohort_term
    WHERE cohort_term.organization_id = p_organization_id
      AND cohort_term.cohort_id = p_cohort_id
      AND cohort_term.term_id = p_term_id
  ) THEN
    RAISE EXCEPTION 'The selected term is not part of this graduating class.';
  END IF;

  SELECT source.cohort_id, source.settings
  INTO v_source_cohort_id, v_source_settings
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF class-history source was not found.';
  END IF;
  IF v_source_cohort_id IS DISTINCT FROM p_cohort_id
    OR coalesce(v_source_settings->>'sourceKind', '') <> 'class_history' THEN
    RAISE EXCEPTION 'The Sheet source does not belong to this class-history workflow.';
  END IF;

  SELECT import_row.*
  INTO v_import_row
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_import_row_id
    AND import_row.source_id = p_source_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reviewed class-history import row was not found.';
  END IF;
  IF v_import_row.import_status <> 'pending'
    OR v_import_row.cohort_id IS DISTINCT FROM p_cohort_id
    OR v_import_row.term_id IS DISTINCT FROM p_term_id
    OR v_import_row.row_hash IS DISTINCT FROM p_row_hash
    OR v_import_row.matched_profile_id IS DISTINCT FROM p_profile_id THEN
    RAISE EXCEPTION 'The class-history row changed or still needs an officer decision.';
  END IF;

  IF p_profile_id IS NULL THEN
    INSERT INTO plugin_data.csf_profiles (
      organization_id,
      first_name,
      last_name,
      school_email,
      personal_email,
      normalized_first_name,
      normalized_last_name,
      normalized_school_email,
      normalized_personal_email,
      source_summary,
      updated_at
    ) VALUES (
      p_organization_id,
      btrim(p_first_name),
      btrim(p_last_name),
      nullif(btrim(p_school_email), ''),
      nullif(btrim(p_personal_email), ''),
      btrim(p_normalized_first_name),
      btrim(p_normalized_last_name),
      nullif(btrim(p_normalized_school_email), ''),
      nullif(btrim(p_normalized_personal_email), ''),
      jsonb_build_object('importedFrom', 'csf_sheet_sync', 'importRowId', p_import_row_id),
      v_now
    )
    RETURNING id INTO v_profile_id;
    v_import_status := 'created';
  ELSE
    SELECT profile.id
    INTO v_profile_id
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = p_profile_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CSF profile was not found.';
    END IF;

    UPDATE plugin_data.csf_profiles AS profile
    SET
      school_email = coalesce(profile.school_email, nullif(btrim(p_school_email), '')),
      personal_email = coalesce(profile.personal_email, nullif(btrim(p_personal_email), '')),
      normalized_school_email = coalesce(profile.normalized_school_email, nullif(btrim(p_normalized_school_email), '')),
      normalized_personal_email = coalesce(profile.normalized_personal_email, nullif(btrim(p_normalized_personal_email), '')),
      updated_at = v_now
    WHERE profile.organization_id = p_organization_id
      AND profile.id = v_profile_id;
    v_import_status := 'updated';
  END IF;

  INSERT INTO plugin_data.csf_profile_cohort_memberships (
    organization_id,
    profile_id,
    cohort_id,
    status,
    updated_at
  ) VALUES (
    p_organization_id,
    v_profile_id,
    p_cohort_id,
    'active',
    v_now
  )
  ON CONFLICT (profile_id, cohort_id)
  DO UPDATE SET
    status = CASE
      WHEN plugin_data.csf_profile_cohort_memberships.status = 'archived'
        THEN plugin_data.csf_profile_cohort_memberships.status
      ELSE 'active'
    END,
    updated_at = v_now;

  v_membership_status := CASE
    WHEN p_all_requirements_met IS TRUE THEN 'completed'
    WHEN p_all_requirements_met IS FALSE THEN 'not_completed'
    ELSE 'active'
  END;

  INSERT INTO plugin_data.csf_term_memberships (
    organization_id,
    profile_id,
    term_id,
    cohort_id,
    status,
    status_reason,
    eligibility_snapshot,
    accepted_at,
    activated_at,
    completed_at,
    updated_at
  ) VALUES (
    p_organization_id,
    v_profile_id,
    p_term_id,
    p_cohort_id,
    v_membership_status,
    'Imported from the reviewed class-history workbook.',
    jsonb_build_object(
      'sourceKind', 'class_history',
      'sourceId', p_source_id,
      'importRowId', p_import_row_id,
      'rowHash', p_row_hash,
      'allRequirementsMet', p_all_requirements_met
    ),
    v_now,
    v_now,
    CASE WHEN p_all_requirements_met IS TRUE THEN v_now ELSE NULL END,
    v_now
  )
  ON CONFLICT (organization_id, profile_id, term_id)
  DO UPDATE SET
    cohort_id = EXCLUDED.cohort_id,
    status = CASE
      WHEN plugin_data.csf_term_memberships.override_status IS NOT NULL
        OR plugin_data.csf_term_memberships.application_id IS NOT NULL
        THEN plugin_data.csf_term_memberships.status
      ELSE EXCLUDED.status
    END,
    status_reason = CASE
      WHEN plugin_data.csf_term_memberships.override_status IS NOT NULL
        OR plugin_data.csf_term_memberships.application_id IS NOT NULL
        THEN plugin_data.csf_term_memberships.status_reason
      ELSE EXCLUDED.status_reason
    END,
    eligibility_snapshot = plugin_data.csf_term_memberships.eligibility_snapshot || EXCLUDED.eligibility_snapshot,
    completed_at = CASE
      WHEN plugin_data.csf_term_memberships.override_status IS NOT NULL
        OR plugin_data.csf_term_memberships.application_id IS NOT NULL
        THEN plugin_data.csf_term_memberships.completed_at
      ELSE EXCLUDED.completed_at
    END,
    accepted_at = CASE
      WHEN plugin_data.csf_term_memberships.override_status IS NOT NULL
        OR plugin_data.csf_term_memberships.application_id IS NOT NULL
        THEN plugin_data.csf_term_memberships.accepted_at
      ELSE coalesce(plugin_data.csf_term_memberships.accepted_at, v_now)
    END,
    activated_at = CASE
      WHEN plugin_data.csf_term_memberships.override_status IS NOT NULL
        OR plugin_data.csf_term_memberships.application_id IS NOT NULL
        THEN plugin_data.csf_term_memberships.activated_at
      ELSE coalesce(plugin_data.csf_term_memberships.activated_at, v_now)
    END,
    updated_at = v_now;

  SELECT membership.status
  INTO v_membership_status
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = v_profile_id
    AND membership.term_id = p_term_id;

  DELETE FROM plugin_data.csf_credit_records
  WHERE organization_id = p_organization_id
    AND profile_id = v_profile_id
    AND term_id = p_term_id
    AND evidence @> jsonb_build_object(
      'processor', 'class_history_import',
      'sourceId', p_source_id
    );

  DELETE FROM plugin_data.csf_profile_activity_events
  WHERE organization_id = p_organization_id
    AND profile_id = v_profile_id
    AND term_id = p_term_id
    AND source_ref @> jsonb_build_object(
      'processor', 'class_history_import',
      'sourceId', p_source_id
    );

  DELETE FROM plugin_data.csf_meeting_attendance
  WHERE organization_id = p_organization_id
    AND profile_id = v_profile_id
    AND term_id = p_term_id
    AND source = 'sheet'
    AND match_details @> jsonb_build_object(
      'processor', 'class_history_import',
      'sourceId', p_source_id
    );

  FOR v_activity IN SELECT value FROM jsonb_array_elements(p_activities)
  LOOP
    IF nullif(trim(v_activity->>'slot'), '') IS NULL OR nullif(trim(v_activity->>'value'), '') IS NULL THEN
      RAISE EXCEPTION 'Each class-history activity needs a slot and value.';
    END IF;

    INSERT INTO plugin_data.csf_credit_records (
      organization_id,
      profile_id,
      term_id,
      source,
      points,
      point_type,
      status,
      verified_by,
      verified_at,
      evidence,
      updated_at
    ) VALUES (
      p_organization_id,
      v_profile_id,
      p_term_id,
      'sheet',
      1,
      'non_drive',
      'verified',
      p_actor_user_id,
      v_now,
      jsonb_build_object(
        'processor', 'class_history_import',
        'sourceId', p_source_id,
        'importRowId', p_import_row_id,
        'rowHash', p_row_hash,
        'slot', v_activity->>'slot',
        'title', v_activity->>'value',
        'legacyPointType', 'unknown'
      ),
      v_now
    );

    INSERT INTO plugin_data.csf_profile_activity_events (
      organization_id,
      profile_id,
      term_id,
      event_type,
      title,
      description,
      point_type,
      raw_points,
      counted_points,
      status,
      source,
      source_ref,
      updated_at
    ) VALUES (
      p_organization_id,
      v_profile_id,
      p_term_id,
      'legacy_import',
      v_activity->>'value',
      'Imported from a reviewed DVHS CSF class workbook.',
      'non_drive',
      1,
      1,
      'verified',
      'sheet',
      jsonb_build_object(
        'processor', 'class_history_import',
        'sourceId', p_source_id,
        'importRowId', p_import_row_id,
        'rowHash', p_row_hash,
        'slot', v_activity->>'slot'
      ),
      v_now
    );
    v_activity_count := v_activity_count + 1;
  END LOOP;

  FOR v_meeting IN SELECT value FROM jsonb_array_elements(p_meetings)
  LOOP
    IF nullif(trim(v_meeting->>'key'), '') IS NULL OR nullif(trim(v_meeting->>'value'), '') IS NULL THEN
      RAISE EXCEPTION 'Each class-history meeting needs a key and value.';
    END IF;

    v_status := v_meeting->>'status';
    IF v_status NOT IN ('unknown', 'attended', 'excused', 'missed', 'not_required') THEN
      RAISE EXCEPTION 'Invalid class-history attendance status.';
    END IF;

    INSERT INTO plugin_data.csf_meeting_attendance (
      organization_id,
      profile_id,
      term_id,
      meeting_key,
      meeting_label,
      status,
      source,
      source_row_id,
      recorded_by,
      match_status,
      match_confidence,
      match_details,
      updated_at
    ) VALUES (
      p_organization_id,
      v_profile_id,
      p_term_id,
      v_meeting->>'key',
      coalesce(nullif(v_meeting->>'label', ''), v_meeting->>'key'),
      v_status,
      'sheet',
      p_import_row_id,
      p_actor_user_id,
      'confirmed',
      1,
      jsonb_build_object(
        'processor', 'class_history_import',
        'sourceId', p_source_id,
        'importRowId', p_import_row_id,
        'rowHash', p_row_hash,
        'value', v_meeting->>'value'
      ),
      v_now
    )
    ON CONFLICT (profile_id, term_id, meeting_key)
    DO UPDATE SET
      meeting_label = EXCLUDED.meeting_label,
      status = EXCLUDED.status,
      source = EXCLUDED.source,
      source_row_id = EXCLUDED.source_row_id,
      recorded_by = EXCLUDED.recorded_by,
      match_status = EXCLUDED.match_status,
      match_confidence = EXCLUDED.match_confidence,
      match_details = EXCLUDED.match_details,
      updated_at = EXCLUDED.updated_at
    WHERE plugin_data.csf_meeting_attendance.source = 'sheet'
      AND plugin_data.csf_meeting_attendance.match_details->>'processor' = 'class_history_import'
      AND plugin_data.csf_meeting_attendance.match_details->>'sourceId' = p_source_id::text;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    v_meeting_count := v_meeting_count + v_affected;
  END LOOP;

  UPDATE plugin_data.csf_sheet_import_rows
  SET
    matched_profile_id = v_profile_id,
    import_status = v_import_status,
    errors = ARRAY[]::text[]
  WHERE organization_id = p_organization_id
    AND id = p_import_row_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    after_data
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'sheets.class_history_row_imported',
    'csf_profiles',
    v_profile_id,
    p_term_id,
    jsonb_build_object(
      'sourceId', p_source_id,
      'importRowId', p_import_row_id,
      'rowHash', p_row_hash,
      'activityCount', v_activity_count,
      'meetingCount', v_meeting_count,
      'membershipStatus', v_membership_status
    )
  );

  RETURN jsonb_build_object(
    'profileId', v_profile_id,
    'importStatus', v_import_status,
    'termId', p_term_id,
    'activityCount', v_activity_count,
    'meetingCount', v_meeting_count,
    'membershipStatus', v_membership_status
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_import_class_history_row(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_import_class_history_row(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_import_class_history_row(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) IS 'Atomically applies one reviewed legacy class-history row without creating or deciding a CSF term application.';

COMMIT;
