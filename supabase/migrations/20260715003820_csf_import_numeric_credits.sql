-- Normalize repeated legacy activity cells into one numeric award while
-- preserving the original class-history importer as the transactional source
-- of identity, membership, attendance, and audit state.

BEGIN;

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
  v_result jsonb;
  v_activity jsonb;
  v_points numeric(8,2);
  v_adjusted integer := 0;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF jsonb_typeof(coalesce(p_activities, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Class-history activities must be a JSON array.';
  END IF;

  FOR v_activity IN
    SELECT value FROM jsonb_array_elements(coalesce(p_activities, '[]'::jsonb))
  LOOP
    IF nullif(btrim(v_activity->>'slot'), '') IS NULL
       OR nullif(btrim(v_activity->>'value'), '') IS NULL THEN
      RAISE EXCEPTION 'Each class-history activity needs a slot and value.';
    END IF;
    BEGIN
      v_points := coalesce(nullif(v_activity->>'points', '')::numeric, 1);
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Imported activity points must be numeric.';
    END;
    IF v_points <= 0 OR v_points > 100 THEN
      RAISE EXCEPTION 'Imported activity points must be greater than zero and no more than 100.';
    END IF;
  END LOOP;

  v_result := plugin_data.csf_import_class_history_row(
    p_organization_id,
    p_profile_id,
    p_first_name,
    p_last_name,
    p_school_email,
    p_personal_email,
    p_normalized_first_name,
    p_normalized_last_name,
    p_normalized_school_email,
    p_normalized_personal_email,
    p_cohort_id,
    p_term_id,
    p_source_id,
    p_import_row_id,
    p_row_hash,
    p_activities,
    p_meetings,
    p_all_requirements_met,
    p_actor_user_id
  );

  FOR v_activity IN
    SELECT value FROM jsonb_array_elements(coalesce(p_activities, '[]'::jsonb))
  LOOP
    v_points := coalesce(nullif(v_activity->>'points', '')::numeric, 1);

    UPDATE plugin_data.csf_credit_records
    SET
      points = v_points,
      evidence = evidence || jsonb_build_object(
        'normalizedPoints', v_points,
        'sourceColumns', coalesce(v_activity->'sourceColumns', '[]'::jsonb),
        'mappingProcessor', 'class_history_import_v2'
      ),
      updated_at = now()
    WHERE organization_id = p_organization_id
      AND evidence @> jsonb_build_object(
        'processor', 'class_history_import',
        'sourceId', p_source_id,
        'importRowId', p_import_row_id,
        'slot', v_activity->>'slot'
      );

    UPDATE plugin_data.csf_profile_activity_events
    SET
      title = coalesce(nullif(v_activity->>'label', ''), v_activity->>'value'),
      raw_points = v_points,
      counted_points = v_points,
      source_ref = source_ref || jsonb_build_object(
        'normalizedPoints', v_points,
        'sourceColumns', coalesce(v_activity->'sourceColumns', '[]'::jsonb),
        'mappingProcessor', 'class_history_import_v2'
      ),
      updated_at = now()
    WHERE organization_id = p_organization_id
      AND source_ref @> jsonb_build_object(
        'processor', 'class_history_import',
        'sourceId', p_source_id,
        'importRowId', p_import_row_id,
        'slot', v_activity->>'slot'
      );

    v_adjusted := v_adjusted + 1;
  END LOOP;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    correlation_id,
    source_type,
    source_id,
    after_data
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'sheets.class_history_numeric_credits_normalized',
    'csf_sheet_import_rows',
    p_import_row_id,
    p_term_id,
    v_correlation_id,
    'sheet_import',
    p_source_id::text,
    jsonb_build_object(
      'importRowId', p_import_row_id,
      'rowHash', p_row_hash,
      'normalizedAwardCount', v_adjusted,
      'activities', p_activities
    )
  );

  RETURN v_result || jsonb_build_object(
    'normalizedAwardCount', v_adjusted,
    'correlationId', v_correlation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) IS
  'Atomically imports reviewed class history and normalizes repeated or explicitly-valued legacy activity cells into numeric awarded credit records.';

CREATE OR REPLACE FUNCTION plugin_data.csf_import_student_roster_row(
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
  p_source_id uuid,
  p_import_row_id uuid,
  p_row_hash text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_import_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_profile_id uuid;
  v_import_status text;
  v_candidate_ids uuid[];
  v_now timestamptz := now();
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF nullif(btrim(p_first_name), '') IS NULL
    OR nullif(btrim(p_last_name), '') IS NULL
    OR nullif(btrim(p_normalized_first_name), '') IS NULL
    OR nullif(btrim(p_normalized_last_name), '') IS NULL THEN
    RAISE EXCEPTION 'A first and last name are required for a roster import.';
  END IF;

  PERFORM 1
  FROM plugin_data.csf_cohorts AS cohort
  WHERE cohort.organization_id = p_organization_id
    AND cohort.id = p_cohort_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF class was not found.';
  END IF;

  PERFORM 1
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_id
    AND source.cohort_id = p_cohort_id
    AND coalesce(source.settings->>'sourceKind', '') = 'student_roster';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The Sheet source does not belong to this student-roster workflow.';
  END IF;

  SELECT import_row.*
  INTO v_import_row
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_import_row_id
    AND import_row.source_id = p_source_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reviewed roster import row was not found.';
  END IF;
  IF v_import_row.import_status <> 'pending'
    OR v_import_row.cohort_id IS DISTINCT FROM p_cohort_id
    OR v_import_row.row_hash IS DISTINCT FROM p_row_hash
    OR v_import_row.matched_profile_id IS DISTINCT FROM p_profile_id THEN
    RAISE EXCEPTION 'The roster row changed or still needs an officer decision.';
  END IF;

  IF p_profile_id IS NOT NULL THEN
    SELECT profile.id
    INTO v_profile_id
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = p_profile_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CSF profile was not found.';
    END IF;
    v_import_status := 'updated';
  ELSE
    SELECT array_agg(profile.id ORDER BY profile.id)
    INTO v_candidate_ids
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND (
        (nullif(btrim(p_normalized_school_email), '') IS NOT NULL
          AND profile.normalized_school_email = nullif(btrim(p_normalized_school_email), ''))
        OR
        (nullif(btrim(p_normalized_personal_email), '') IS NOT NULL
          AND profile.normalized_personal_email = nullif(btrim(p_normalized_personal_email), ''))
      );

    IF coalesce(array_length(v_candidate_ids, 1), 0) > 1 THEN
      RAISE EXCEPTION 'The roster row now matches multiple student records.';
    ELSIF coalesce(array_length(v_candidate_ids, 1), 0) = 1 THEN
      v_profile_id := v_candidate_ids[1];
      v_import_status := 'updated';
    ELSIF EXISTS (
      SELECT 1
      FROM plugin_data.csf_profiles AS profile
      WHERE profile.organization_id = p_organization_id
        AND profile.normalized_first_name = btrim(p_normalized_first_name)
        AND profile.normalized_last_name = btrim(p_normalized_last_name)
    ) THEN
      RAISE EXCEPTION 'A name-only roster match still requires an officer decision.';
    ELSE
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
        jsonb_build_object(
          'importedFrom', 'csf_student_roster',
          'sourceId', p_source_id,
          'importRowId', p_import_row_id,
          'rowHash', p_row_hash
        ),
        v_now
      )
      RETURNING id INTO v_profile_id;
      v_import_status := 'created';
    END IF;
  END IF;

  IF v_import_status = 'updated' THEN
    UPDATE plugin_data.csf_profiles AS profile
    SET
      school_email = coalesce(profile.school_email, nullif(btrim(p_school_email), '')),
      personal_email = coalesce(profile.personal_email, nullif(btrim(p_personal_email), '')),
      normalized_school_email = coalesce(profile.normalized_school_email, nullif(btrim(p_normalized_school_email), '')),
      normalized_personal_email = coalesce(profile.normalized_personal_email, nullif(btrim(p_normalized_personal_email), '')),
      source_summary = profile.source_summary || jsonb_build_object(
        'lastRosterImportRowId', p_import_row_id,
        'lastRosterRowHash', p_row_hash
      ),
      updated_at = v_now
    WHERE profile.organization_id = p_organization_id
      AND profile.id = v_profile_id;
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

  UPDATE plugin_data.csf_sheet_import_rows
  SET
    matched_profile_id = v_profile_id,
    import_status = v_import_status,
    resolution_status = 'resolved',
    resolution_reason_code = CASE WHEN v_import_status = 'created' THEN 'created_profile' ELSE 'unique_email_match' END,
    resolution_notes = 'Committed from the reviewed student roster preview.',
    resolved_by = p_actor_user_id,
    resolved_at = v_now,
    errors = ARRAY[]::text[]
  WHERE organization_id = p_organization_id
    AND id = p_import_row_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    correlation_id,
    source_type,
    source_id,
    after_data
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'sheets.student_roster_row_imported',
    'csf_profiles',
    v_profile_id,
    v_correlation_id,
    'sheet_import',
    p_source_id::text,
    jsonb_build_object(
      'sourceId', p_source_id,
      'importRowId', p_import_row_id,
      'rowHash', p_row_hash,
      'cohortId', p_cohort_id,
      'importStatus', v_import_status
    )
  );

  RETURN jsonb_build_object(
    'profileId', v_profile_id,
    'importStatus', v_import_status,
    'cohortId', p_cohort_id,
    'correlationId', v_correlation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_import_student_roster_row(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_import_student_roster_row(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, text, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_import_student_roster_row(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, text, uuid
) IS
  'Atomically creates or connects a student roster row without manufacturing an application, term membership, attendance, or service award.';

CREATE OR REPLACE FUNCTION plugin_data.csf_preserve_import_job_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF ROW(
    NEW.organization_id,
    NEW.source_id,
    NEW.initiated_by,
    NEW.mode,
    NEW.source_type,
    NEW.source_file_id,
    NEW.source_file_name,
    NEW.source_sheet_tab,
    NEW.source_range,
    NEW.source_modified_at,
    NEW.mapping_snapshot,
    NEW.mapping_version,
    NEW.retry_of_job_id,
    NEW.correlation_id,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.organization_id,
    OLD.source_id,
    OLD.initiated_by,
    OLD.mode,
    OLD.source_type,
    OLD.source_file_id,
    OLD.source_file_name,
    OLD.source_sheet_tab,
    OLD.source_range,
    OLD.source_modified_at,
    OLD.mapping_snapshot,
    OLD.mapping_version,
    OLD.retry_of_job_id,
    OLD.correlation_id,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'CSF import job provenance is immutable; create a retry job instead.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_preserve_import_row_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF ROW(
    NEW.organization_id,
    NEW.job_id,
    NEW.source_id,
    NEW.cohort_id,
    NEW.term_id,
    NEW.sheet_tab_name,
    NEW.row_number,
    NEW.source_range,
    NEW.raw_data,
    NEW.normalized_data,
    NEW.row_hash,
    NEW.warnings,
    NEW.mapping_version,
    NEW.retry_of_row_id,
    NEW.source_modified_at,
    NEW.correlation_id,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.organization_id,
    OLD.job_id,
    OLD.source_id,
    OLD.cohort_id,
    OLD.term_id,
    OLD.sheet_tab_name,
    OLD.row_number,
    OLD.source_range,
    OLD.raw_data,
    OLD.normalized_data,
    OLD.row_hash,
    OLD.warnings,
    OLD.mapping_version,
    OLD.retry_of_row_id,
    OLD.source_modified_at,
    OLD.correlation_id,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'CSF import row evidence is immutable; create a retry row instead.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS csf_sheet_import_jobs_preserve_snapshot
  ON plugin_data.csf_sheet_import_jobs;
CREATE TRIGGER csf_sheet_import_jobs_preserve_snapshot
BEFORE UPDATE ON plugin_data.csf_sheet_import_jobs
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_preserve_import_job_snapshot();

DROP TRIGGER IF EXISTS csf_sheet_import_rows_preserve_snapshot
  ON plugin_data.csf_sheet_import_rows;
CREATE TRIGGER csf_sheet_import_rows_preserve_snapshot
BEFORE UPDATE ON plugin_data.csf_sheet_import_rows
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_preserve_import_row_snapshot();

REVOKE ALL ON FUNCTION plugin_data.csf_preserve_import_job_snapshot()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_preserve_import_row_snapshot()
  FROM PUBLIC, anon, authenticated;

COMMIT;
