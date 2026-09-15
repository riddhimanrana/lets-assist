-- Preserve recorded history, reject conflicting workbook coordinates, and retain annotation decisions during identity reuse.
BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_import_class_history_row_identity_base(
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

  -- The outer import wrapper holds the organization identity lock. Lock the
  -- existing outcome before any imported profile or evidence can be replaced.
  PERFORM 1
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = p_profile_id
    AND membership.term_id = p_term_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_term_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.profile_id = p_profile_id
      AND membership.term_id = p_term_id
      AND (
        membership.status IN ('completed', 'not_completed')
        OR membership.override_status IS NOT NULL
        OR membership.application_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION
      'This semester already has a recorded outcome or application. Review it before replacing historical evidence.'
      USING ERRCODE = '23514';
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

CREATE OR REPLACE FUNCTION plugin_data.csf_profiles_share_class_source_key(
  p_organization_id uuid,
  p_source_profile_id uuid,
  p_target_profile_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM plugin_data.csf_profiles AS source
    JOIN plugin_data.csf_profiles AS target
      ON target.organization_id = source.organization_id
    JOIN plugin_data.csf_profile_class_source_keys(
      p_organization_id, p_source_profile_id
    ) AS source_key ON true
    JOIN plugin_data.csf_profile_class_source_keys(
      p_organization_id, p_target_profile_id
    ) AS target_key
      ON target_key.source_file_id = source_key.source_file_id
    CROSS JOIN LATERAL (
      SELECT
        pg_catalog.lower(pg_catalog.regexp_replace(
          source.normalized_first_name || source.normalized_last_name,
          '[[:space:]]+', '', 'g'
        )) AS source_first_last_key,
        pg_catalog.lower(pg_catalog.regexp_replace(
          source.normalized_last_name || source.normalized_first_name,
          '[[:space:]]+', '', 'g'
        )) AS source_last_first_key,
        pg_catalog.lower(pg_catalog.regexp_replace(
          target.normalized_first_name || target.normalized_last_name,
          '[[:space:]]+', '', 'g'
        )) AS target_first_last_key,
        pg_catalog.lower(pg_catalog.regexp_replace(
          target.normalized_last_name || target.normalized_first_name,
          '[[:space:]]+', '', 'g'
        )) AS target_last_first_key
    ) AS names
    WHERE source.organization_id = p_organization_id
      AND source.id = p_source_profile_id
      AND target.id = p_target_profile_id
      AND source_key.source_key IN (
        names.source_first_last_key, names.source_last_first_key,
        names.target_first_last_key, names.target_last_first_key
      )
      AND target_key.source_key IN (
        names.source_first_last_key, names.source_last_first_key,
        names.target_first_last_key, names.target_last_first_key
      )
      AND (
        source_key.sheet_tab_name IS DISTINCT FROM target_key.sheet_tab_name
        OR source_key.row_number = target_key.row_number
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_class_source_keys(
      p_organization_id, p_source_profile_id
    ) AS source_coordinate
    JOIN plugin_data.csf_profile_class_source_keys(
      p_organization_id, p_target_profile_id
    ) AS target_coordinate
      ON target_coordinate.source_file_id = source_coordinate.source_file_id
     AND target_coordinate.sheet_tab_name = source_coordinate.sheet_tab_name
    WHERE target_coordinate.row_number IS DISTINCT FROM source_coordinate.row_number
  )
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_import_class_history_row_v2(
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
  v_profile_id uuid := p_profile_id;
  v_result jsonb;
  v_reused_source_key boolean := false;
  v_bound integer := 0;
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id,
    p_actor_user_id,
    'class_history'
  );

  IF v_profile_id IS NULL THEN
    v_profile_id := plugin_data.csf_class_history_source_key_target(
      p_organization_id,
      p_import_row_id
    );
    v_reused_source_key := v_profile_id IS NOT NULL;

    IF v_profile_id IS NULL
      AND plugin_data.csf_class_history_source_key_requires_review(
        p_organization_id,
        p_import_row_id
      )
    THEN
      RAISE EXCEPTION
        'This workbook key needs officer review before another profile can be created.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_reused_source_key THEN
    UPDATE plugin_data.csf_sheet_import_rows AS import_row
    SET matched_profile_id = v_profile_id,
        resolution_status = 'resolved',
        resolution_reason_code = CASE
          WHEN import_row.resolution_reason_code IN (
            'annotation_met', 'annotation_not_met', 'annotation_exception_met'
          ) THEN import_row.resolution_reason_code
          ELSE 'commit_reused_source_key' END,
        resolution_notes = CASE
          WHEN import_row.resolution_reason_code IN (
            'annotation_met', 'annotation_not_met', 'annotation_exception_met'
          ) THEN import_row.resolution_notes
          ELSE 'The approved import reused the profile established by this workbook key.' END,
        resolved_by = CASE
          WHEN import_row.resolution_reason_code IN (
            'annotation_met', 'annotation_not_met', 'annotation_exception_met'
          ) THEN import_row.resolved_by ELSE p_actor_user_id END,
        resolved_at = CASE
          WHEN import_row.resolution_reason_code IN (
            'annotation_met', 'annotation_not_met', 'annotation_exception_met'
          ) THEN import_row.resolved_at ELSE pg_catalog.now() END
    WHERE import_row.organization_id = p_organization_id
      AND import_row.id = p_import_row_id
      AND import_row.import_status = 'pending'
      AND import_row.matched_profile_id IS NULL
      AND (
        import_row.commit_frozen_at IS NULL
        OR (
          import_row.commit_outcome_state = 'in_flight'
          AND import_row.commit_intent_attempt_id IS NOT NULL
          AND import_row.commit_frozen_actor_user_id = p_actor_user_id
        )
      );
    GET DIAGNOSTICS v_bound = ROW_COUNT;
    IF v_bound <> 1 THEN
      RAISE EXCEPTION
        'The class-history row changed before its stable workbook key could be bound.'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  PERFORM plugin_data.csf_lock_active_import_profiles(
    p_organization_id,
    ARRAY[v_profile_id]::uuid[]
  );

  v_result := plugin_data.csf_import_class_history_row_v2_source_key_base(
    p_organization_id, v_profile_id, p_first_name, p_last_name,
    p_school_email, p_personal_email, p_normalized_first_name,
    p_normalized_last_name, p_normalized_school_email,
    p_normalized_personal_email, p_cohort_id, p_term_id, p_source_id,
    p_import_row_id, p_row_hash, p_activities, p_meetings,
    p_all_requirements_met, p_actor_user_id
  );

  IF v_reused_source_key THEN
    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id, actor_user_id, action, target_type, target_id,
      term_id, source_type, source_id, after_data
    ) VALUES (
      p_organization_id, p_actor_user_id,
      'sheets.class_history_source_key_reused', 'csf_profiles', v_profile_id,
      p_term_id, 'sheet_import', p_source_id::text,
      pg_catalog.jsonb_build_object(
        'importRowId', p_import_row_id,
        'profileId', v_profile_id
      )
    );
  END IF;

  RETURN v_result || pg_catalog.jsonb_build_object(
    'sourceKeyProfileReused', v_reused_source_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_import_row_attempt_lineage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_attempt plugin_data.csf_sheet_import_commit_attempts%ROWTYPE;
  v_commit plugin_data.csf_sheet_import_jobs%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.commit_frozen_at IS NOT NULL THEN
    IF ROW(
      NEW.commit_frozen_at, NEW.commit_frozen_by_job_id, NEW.commit_frozen_row_hash,
      NEW.commit_frozen_source_id, NEW.commit_frozen_source_revision,
      NEW.commit_frozen_payload_hash, NEW.commit_frozen_actor_user_id,
      NEW.commit_frozen_actor_snapshot, NEW.commit_target_profile_id,
      NEW.commit_resolution_snapshot
    ) IS DISTINCT FROM ROW(
      OLD.commit_frozen_at, OLD.commit_frozen_by_job_id, OLD.commit_frozen_row_hash,
      OLD.commit_frozen_source_id, OLD.commit_frozen_source_revision,
      OLD.commit_frozen_payload_hash, OLD.commit_frozen_actor_user_id,
      OLD.commit_frozen_actor_snapshot, OLD.commit_target_profile_id,
      OLD.commit_resolution_snapshot
    ) THEN
      RAISE EXCEPTION
        'This CSF import row has a frozen commit decision; it cannot be re-frozen while that commit is outstanding.'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.commit_target_profile_id IS NOT NULL
      AND NEW.matched_profile_id IS DISTINCT FROM OLD.commit_target_profile_id
    THEN
      RAISE EXCEPTION
        'This CSF import row is frozen to a reviewed member; it cannot be re-matched to another.'
        USING ERRCODE = '55000';
    END IF;
    IF OLD.commit_target_profile_id IS NULL
      AND OLD.matched_profile_id IS NOT NULL
      AND NEW.matched_profile_id IS DISTINCT FROM OLD.matched_profile_id
    THEN
      RAISE EXCEPTION
        'This CSF import row already records the member its commit created; it cannot be re-matched.'
        USING ERRCODE = '55000';
    END IF;
    IF OLD.commit_target_profile_id IS NULL
      AND OLD.matched_profile_id IS NULL
      AND NEW.matched_profile_id IS NOT NULL
      AND NOT (
        OLD.commit_outcome_state = 'in_flight'
        AND OLD.commit_intent_attempt_id IS NOT NULL
        AND OLD.import_status = 'pending'
        AND (
          (
            NEW.import_status IN ('created', 'updated')
            AND NEW.resolved_by IS NOT DISTINCT FROM
              OLD.commit_frozen_actor_user_id
          )
          OR (
            NEW.import_status = 'pending'
            AND NEW.resolution_status = 'resolved'
            AND (
              (
                NEW.resolution_reason_code = 'commit_reused_source_key'
                AND coalesce(OLD.resolution_reason_code, '') NOT IN (
                  'annotation_met', 'annotation_not_met', 'annotation_exception_met'
                )
                AND NEW.resolved_by IS NOT DISTINCT FROM
                  OLD.commit_frozen_actor_user_id
              )
              OR (
                OLD.resolution_reason_code IN (
                  'annotation_met', 'annotation_not_met', 'annotation_exception_met'
                )
                AND ROW(
                  NEW.resolution_reason_code, NEW.resolution_notes,
                  NEW.resolved_by, NEW.resolved_at
                ) IS NOT DISTINCT FROM ROW(
                  OLD.resolution_reason_code, OLD.resolution_notes,
                  OLD.resolved_by, OLD.resolved_at
                )
              )
            )
            AND plugin_data.csf_class_history_source_key_target(
              OLD.organization_id,
              OLD.id
            ) = NEW.matched_profile_id
          )
        )
      )
    THEN
      RAISE EXCEPTION
        'This CSF import row has no live write result that may establish its committed member.'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.import_status IS DISTINCT FROM OLD.import_status
      AND NOT (
        (OLD.import_status = 'pending' AND NEW.import_status IN ('created', 'updated', 'error'))
        OR (OLD.import_status = 'error' AND NEW.import_status IN ('pending', 'skipped')
          AND NEW.commit_retry_count > OLD.commit_retry_count
          AND NEW.commit_last_failed_attempt_id IS NOT DISTINCT FROM
            coalesce(OLD.commit_attempt_id, OLD.commit_intent_attempt_id)
          AND NEW.commit_attempt_id IS NULL)
      )
    THEN
      RAISE EXCEPTION
        'This CSF import row has a frozen commit decision; its include or skip decision cannot change while that commit is outstanding.'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.import_status <> 'pending'
      AND NEW.resolution_status IS DISTINCT FROM OLD.resolution_status
      AND NEW.commit_retry_count IS NOT DISTINCT FROM OLD.commit_retry_count
    THEN
      RAISE EXCEPTION
        'This CSF import row is already terminal for its frozen commit; its reconciliation state cannot be rewritten.'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.commit_outcome_state IS DISTINCT FROM OLD.commit_outcome_state
  THEN
    IF NOT (
      (OLD.commit_outcome_state = 'not_started' AND NEW.commit_outcome_state IN ('frozen', 'historical_unknown'))
      OR (OLD.commit_outcome_state = 'frozen' AND NEW.commit_outcome_state IN ('in_flight', 'failed'))
      OR (OLD.commit_outcome_state = 'in_flight' AND NEW.commit_outcome_state IN ('succeeded', 'failed', 'unknown'))
      OR (OLD.commit_outcome_state = 'unknown' AND NEW.commit_outcome_state IN ('succeeded', 'failed'))
      OR (OLD.commit_outcome_state = 'historical_unknown' AND NEW.commit_outcome_state = 'succeeded')
      OR (OLD.commit_outcome_state = 'failed' AND NEW.commit_outcome_state = 'frozen'
        AND NEW.commit_retry_count > OLD.commit_retry_count
        AND NEW.commit_last_failed_attempt_id IS NOT DISTINCT FROM
          coalesce(OLD.commit_attempt_id, OLD.commit_intent_attempt_id)
        AND NEW.commit_attempt_id IS NULL)
    ) THEN
      RAISE EXCEPTION
        'A CSF import row cannot move from commit outcome "%" to "%".',
        OLD.commit_outcome_state, NEW.commit_outcome_state
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.commit_outcome_state IN ('succeeded', 'failed')
    AND NEW.commit_outcome_state = OLD.commit_outcome_state
    AND OLD.commit_outcome_resolution IS NOT NULL
    AND NEW.commit_retry_count IS NOT DISTINCT FROM OLD.commit_retry_count
    AND ROW(
      NEW.commit_outcome_resolution,
      NEW.commit_outcome_resolved_by,
      NEW.commit_outcome_resolved_at
    ) IS DISTINCT FROM ROW(
      OLD.commit_outcome_resolution,
      OLD.commit_outcome_resolved_by,
      OLD.commit_outcome_resolved_at
    )
  THEN
    RAISE EXCEPTION
      'A settled CSF import row outcome cannot be re-reconciled.'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.commit_attempt_id IS NOT NULL
    AND NEW.commit_attempt_id IS DISTINCT FROM OLD.commit_attempt_id
    AND NOT (
      NEW.commit_attempt_id IS NULL
      AND NEW.commit_last_failed_attempt_id IS NOT DISTINCT FROM
        OLD.commit_attempt_id
      AND NEW.commit_retry_count > OLD.commit_retry_count
    )
  THEN
    RAISE EXCEPTION
      'A CSF import row already records the commit attempt that wrote it; it cannot be cleared or re-pointed.'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.commit_attempt_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.commit_attempt_id IS NOT DISTINCT FROM NEW.commit_attempt_id
  THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_attempt
  FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
  WHERE attempt.id = NEW.commit_attempt_id
    AND attempt.organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The CSF commit attempt named by this import row does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_commit
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  WHERE commit_job.id = v_attempt.commit_job_id;
  IF NOT FOUND OR v_commit.mode <> 'commit' THEN
    RAISE EXCEPTION
      'A CSF import row may only name an attempt of a commit job.'
      USING ERRCODE = '23514';
  END IF;

  IF v_commit.preview_job_id IS DISTINCT FROM NEW.job_id THEN
    RAISE EXCEPTION
      'A CSF import row may only be committed by an attempt derived from its own preview.'
      USING ERRCODE = '23514';
  END IF;

  IF v_attempt.status <> 'running'
    OR v_attempt.lease_expires_at IS NULL
    OR v_attempt.lease_expires_at <= pg_catalog.now()
    OR v_commit.active_commit_attempt_id IS DISTINCT FROM v_attempt.id
  THEN
    RAISE EXCEPTION
      'Only the active, unexpired CSF commit attempt may record row lineage.'
      USING ERRCODE = '55P03';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_import_class_history_row_identity_base(uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION plugin_data.csf_import_class_history_row_identity_base(uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_import_class_history_row_v2(uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION plugin_data.csf_import_class_history_row_v2(uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_profiles_share_class_source_key(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION plugin_data.csf_profiles_share_class_source_key(uuid, uuid, uuid) TO postgres, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_import_row_attempt_lineage()
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION plugin_data.csf_enforce_import_row_attempt_lineage() TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_profile_merge_preview(
  p_organization_id uuid,
  p_source_profile_id uuid,
  p_target_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_preview jsonb;
  v_conflicts jsonb;
  v_exact_source_key_identity boolean := false;
  v_term_conflict_count integer := 0;
  v_term_overlap_count integer := 0;
  v_unsafe_term_count integer := 0;
  v_meeting_conflict_count integer := 0;
  v_meeting_overlap_count integer := 0;
  v_unsafe_meeting_count integer := 0;
  v_other_conflict_count integer := 0;
  v_can_consolidate boolean := false;
BEGIN
  v_preview := plugin_data.csf_profile_merge_preview_coordinate_alias_base(
    p_organization_id, p_source_profile_id, p_target_profile_id
  );
  IF v_preview IS NULL OR pg_catalog.jsonb_typeof(v_preview) <> 'object' THEN
    RAISE EXCEPTION 'The CSF merge preview did not return a canonical object.';
  END IF;
  v_conflicts := v_preview -> 'conflicts';
  IF pg_catalog.jsonb_typeof(v_conflicts) <> 'array' THEN
    RAISE EXCEPTION 'The CSF merge preview did not return canonical conflicts.';
  END IF;

  -- Older preview layers can already have waived an identity conflict. Keep
  -- contradictory workbook coordinates as an explicit final merge blocker.
  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_class_source_keys(
      p_organization_id, p_source_profile_id
    ) AS source_coordinate
    JOIN plugin_data.csf_profile_class_source_keys(
      p_organization_id, p_target_profile_id
    ) AS target_coordinate
      ON target_coordinate.source_file_id = source_coordinate.source_file_id
     AND target_coordinate.sheet_tab_name = source_coordinate.sheet_tab_name
    WHERE target_coordinate.row_number IS DISTINCT FROM source_coordinate.row_number
  ) THEN
    RETURN v_preview || pg_catalog.jsonb_build_object(
      'conflicts', v_conflicts || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'type', 'class_source_coordinate_conflict',
          'label', 'These records occupy different rows on the same workbook tab. Resolve their source identity before merging.'
        )
      ),
      'canMerge', false,
      'identityEvidence', coalesce(v_preview -> 'identityEvidence', '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
          'exactSourceStudentKeyMatch', false,
          'termMembershipConsolidationCount', 0
        ),
      'consolidatedMeetingAttendance', 0
    );
  END IF;

  v_exact_source_key_identity := plugin_data.csf_profiles_share_class_source_key(
    p_organization_id, p_source_profile_id, p_target_profile_id
  );
  SELECT
    pg_catalog.count(*) FILTER (WHERE entry.conflict ->> 'type' = 'term_membership')::integer,
    pg_catalog.count(*) FILTER (WHERE entry.conflict ->> 'type' = 'meeting_attendance')::integer,
    pg_catalog.count(*) FILTER (
      WHERE entry.conflict ->> 'type' NOT IN (
        'term_membership', 'meeting_attendance', 'identity_email_missing',
        'identity_name_mismatch'
      )
    )::integer
  INTO v_term_conflict_count, v_meeting_conflict_count, v_other_conflict_count
  FROM pg_catalog.jsonb_array_elements(v_conflicts) AS entry(conflict);

  SELECT pg_catalog.count(*)::integer,
    pg_catalog.count(*) FILTER (
      WHERE source_membership.status IS DISTINCT FROM target_membership.status
        OR source_membership.override_status IS DISTINCT FROM target_membership.override_status
        OR (
          source_membership.override_status IS NOT NULL
          AND (
            source_membership.override_reason IS DISTINCT FROM target_membership.override_reason
            OR source_membership.overridden_by IS DISTINCT FROM target_membership.overridden_by
            OR source_membership.overridden_at IS DISTINCT FROM target_membership.overridden_at
          )
        )
        OR (
          source_membership.cohort_id IS NOT NULL
          AND target_membership.cohort_id IS NOT NULL
          AND source_membership.cohort_id <> target_membership.cohort_id
        )
        OR (
          source_membership.application_id IS NOT NULL
          AND target_membership.application_id IS NOT NULL
          AND source_membership.application_id <> target_membership.application_id
        )
    )::integer
  INTO v_term_overlap_count, v_unsafe_term_count
  FROM plugin_data.csf_term_memberships AS source_membership
  JOIN plugin_data.csf_term_memberships AS target_membership
    ON target_membership.organization_id = source_membership.organization_id
   AND target_membership.term_id = source_membership.term_id
   AND target_membership.profile_id = p_target_profile_id
  WHERE source_membership.organization_id = p_organization_id
    AND source_membership.profile_id = p_source_profile_id;

  SELECT pg_catalog.count(*)::integer,
    pg_catalog.count(*) FILTER (
      WHERE source_attendance.status IS DISTINCT FROM target_attendance.status
    )::integer
  INTO v_meeting_overlap_count, v_unsafe_meeting_count
  FROM plugin_data.csf_meeting_attendance AS source_attendance
  JOIN plugin_data.csf_meeting_attendance AS target_attendance
    ON target_attendance.organization_id = source_attendance.organization_id
   AND target_attendance.term_id = source_attendance.term_id
   AND target_attendance.meeting_key = source_attendance.meeting_key
   AND target_attendance.profile_id = p_target_profile_id
  WHERE source_attendance.organization_id = p_organization_id
    AND source_attendance.profile_id = p_source_profile_id;

  v_can_consolidate := v_exact_source_key_identity
    AND v_other_conflict_count = 0
    AND v_term_overlap_count = v_term_conflict_count
    AND v_unsafe_term_count = 0
    AND v_meeting_overlap_count = v_meeting_conflict_count
    AND v_unsafe_meeting_count = 0;

  IF v_exact_source_key_identity THEN
    SELECT COALESCE(
      pg_catalog.jsonb_agg(entry.conflict ORDER BY entry.ordinal), '[]'::jsonb
    )
    INTO v_conflicts
    FROM pg_catalog.jsonb_array_elements(v_conflicts)
      WITH ORDINALITY AS entry(conflict, ordinal)
    WHERE entry.conflict ->> 'type' NOT IN (
        'identity_email_missing', 'identity_name_mismatch'
      )
      AND NOT (
        v_can_consolidate
        AND entry.conflict ->> 'type' IN ('term_membership', 'meeting_attendance')
      );
  END IF;

  RETURN v_preview || pg_catalog.jsonb_build_object(
    'conflicts', v_conflicts,
    'canMerge', pg_catalog.jsonb_array_length(v_conflicts) = 0,
    'profileReferencePlan', plugin_data.csf_profile_merge_reference_plan(
      p_organization_id, p_source_profile_id
    ),
    'consolidatedMeetingAttendance', CASE
      WHEN v_can_consolidate THEN v_meeting_overlap_count ELSE 0
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  TO postgres, service_role;

COMMIT;
