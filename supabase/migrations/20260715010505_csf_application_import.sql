-- Atomically turn an officer-reviewed application preview row into the
-- normalized operational record. Source Forms/Sheets and Drive files remain
-- immutable evidence; import never decides eligibility or membership.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_import_application_response_row(
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
  p_application_data jsonb,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_import_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_import_job plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_profile_id uuid;
  v_application_id uuid;
  v_existing_application plugin_data.csf_term_applications%ROWTYPE;
  v_candidate_ids uuid[];
  v_import_status text;
  v_submission_status plugin_data.csf_application_submission_status;
  v_legacy_status text;
  v_current_grade_level integer;
  v_returning_status text;
  v_source_submitted_at timestamptz;
  v_list_i_points numeric(8,2);
  v_list_i_ii_points numeric(8,2);
  v_grand_total_points numeric(8,2);
  v_most_checked_email text;
  v_transcript_file_id text;
  v_transcript_url text;
  v_receipt_file_id text;
  v_receipt_url text;
  v_receipt_application_file_id uuid;
  v_course jsonb;
  v_course_count integer := 0;
  v_missing_fields jsonb := '[]'::jsonb;
  v_dues_required boolean := true;
  v_now timestamptz := now();
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF jsonb_typeof(coalesce(p_application_data, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Application import data must be a JSON object.';
  END IF;
  IF jsonb_typeof(coalesce(p_application_data->'courses', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Application courses must be a JSON array.';
  END IF;
  IF nullif(btrim(p_first_name), '') IS NULL
    OR nullif(btrim(p_last_name), '') IS NULL
    OR nullif(btrim(p_normalized_first_name), '') IS NULL
    OR nullif(btrim(p_normalized_last_name), '') IS NULL THEN
    RAISE EXCEPTION 'A first and last name are required for an application import.';
  END IF;

  SELECT source.*
  INTO v_source
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_id
    AND source.cohort_id = p_cohort_id
    AND coalesce(source.settings->>'sourceKind', '') = 'application_responses';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The Sheet source does not belong to this application workflow.';
  END IF;

  PERFORM 1
  FROM plugin_data.csf_cohort_terms AS cohort_term
  WHERE cohort_term.organization_id = p_organization_id
    AND cohort_term.cohort_id = p_cohort_id
    AND cohort_term.term_id = p_term_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected class is not configured for this application semester.';
  END IF;

  SELECT import_row.*
  INTO v_import_row
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_import_row_id
    AND import_row.source_id = p_source_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reviewed application import row was not found.';
  END IF;
  IF v_import_row.import_status <> 'pending'
    OR v_import_row.cohort_id IS DISTINCT FROM p_cohort_id
    OR v_import_row.term_id IS DISTINCT FROM p_term_id
    OR v_import_row.row_hash IS DISTINCT FROM p_row_hash
    OR v_import_row.matched_profile_id IS DISTINCT FROM p_profile_id THEN
    RAISE EXCEPTION 'The application row changed or still needs an officer decision.';
  END IF;

  SELECT import_job.*
  INTO v_import_job
  FROM plugin_data.csf_sheet_import_jobs AS import_job
  WHERE import_job.organization_id = p_organization_id
    AND import_job.id = v_import_row.job_id
    AND import_job.source_id = p_source_id
    AND import_job.mode = 'preview'
    AND import_job.source_type = 'application_responses';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application preview provenance was not found.';
  END IF;

  IF p_profile_id IS NOT NULL THEN
    SELECT profile.id
    INTO v_profile_id
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = p_profile_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CSF profile was not found.'; END IF;
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
      RAISE EXCEPTION 'The application row now matches multiple student records.';
    ELSIF coalesce(array_length(v_candidate_ids, 1), 0) = 1 THEN
      v_profile_id := v_candidate_ids[1];
    ELSIF EXISTS (
      SELECT 1 FROM plugin_data.csf_profiles AS profile
      WHERE profile.organization_id = p_organization_id
        AND profile.normalized_first_name = btrim(p_normalized_first_name)
        AND profile.normalized_last_name = btrim(p_normalized_last_name)
    ) THEN
      RAISE EXCEPTION 'A name-only application match still requires an officer decision.';
    ELSE
      INSERT INTO plugin_data.csf_profiles (
        organization_id, first_name, last_name, school_email, personal_email,
        normalized_first_name, normalized_last_name,
        normalized_school_email, normalized_personal_email,
        source_summary, updated_at
      ) VALUES (
        p_organization_id, btrim(p_first_name), btrim(p_last_name),
        nullif(btrim(p_school_email), ''), nullif(btrim(p_personal_email), ''),
        btrim(p_normalized_first_name), btrim(p_normalized_last_name),
        nullif(btrim(p_normalized_school_email), ''),
        nullif(btrim(p_normalized_personal_email), ''),
        jsonb_build_object(
          'importedFrom', 'csf_application_response',
          'sourceId', p_source_id,
          'importRowId', p_import_row_id,
          'rowHash', p_row_hash
        ),
        v_now
      ) RETURNING id INTO v_profile_id;
    END IF;
  END IF;

  UPDATE plugin_data.csf_profiles AS profile
  SET
    school_email = coalesce(profile.school_email, nullif(btrim(p_school_email), '')),
    personal_email = coalesce(profile.personal_email, nullif(btrim(p_personal_email), '')),
    normalized_school_email = coalesce(profile.normalized_school_email, nullif(btrim(p_normalized_school_email), '')),
    normalized_personal_email = coalesce(profile.normalized_personal_email, nullif(btrim(p_normalized_personal_email), '')),
    source_summary = profile.source_summary || jsonb_build_object(
      'lastApplicationImportRowId', p_import_row_id,
      'lastApplicationRowHash', p_row_hash
    ),
    updated_at = v_now
  WHERE profile.organization_id = p_organization_id
    AND profile.id = v_profile_id;

  INSERT INTO plugin_data.csf_profile_cohort_memberships (
    organization_id, profile_id, cohort_id, status, updated_at
  ) VALUES (
    p_organization_id, v_profile_id, p_cohort_id, 'active', v_now
  ) ON CONFLICT (profile_id, cohort_id) DO NOTHING;

  BEGIN
    v_current_grade_level := nullif(p_application_data->>'currentGradeLevel', '')::integer;
    v_list_i_points := nullif(p_application_data->>'listIPoints', '')::numeric;
    v_list_i_ii_points := nullif(p_application_data->>'listIAndIIPoints', '')::numeric;
    v_grand_total_points := nullif(p_application_data->>'grandTotalPoints', '')::numeric;
    v_source_submitted_at := nullif(p_application_data->>'sourceSubmittedAt', '')::timestamptz;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
    RAISE EXCEPTION 'The normalized application contains an invalid grade, point total, or timestamp.';
  END;
  IF v_current_grade_level IS NOT NULL AND v_current_grade_level NOT BETWEEN 9 AND 12 THEN
    RAISE EXCEPTION 'Current grade level must be between 9 and 12.';
  END IF;

  v_returning_status := coalesce(nullif(p_application_data->>'returningStatus', ''), 'unknown');
  IF v_returning_status NOT IN ('new', 'returning', 'unknown') THEN v_returning_status := 'unknown'; END IF;
  v_most_checked_email := nullif(btrim(p_application_data->>'mostCheckedEmail'), '');
  v_transcript_file_id := nullif(btrim(p_application_data->>'transcriptDriveFileId'), '');
  v_transcript_url := nullif(btrim(p_application_data->>'transcriptUrl'), '');
  v_receipt_file_id := nullif(btrim(p_application_data->>'receiptDriveFileId'), '');
  v_receipt_url := nullif(btrim(p_application_data->>'receiptUrl'), '');
  v_missing_fields := coalesce(p_application_data->'missingFields', '[]'::jsonb);
  IF jsonb_typeof(v_missing_fields) <> 'array' THEN v_missing_fields := '[]'::jsonb; END IF;

  SELECT coalesce(policy.dues_required, true)
  INTO v_dues_required
  FROM plugin_data.csf_term_policies AS policy
  WHERE policy.organization_id = p_organization_id AND policy.term_id = p_term_id;
  v_dues_required := coalesce(v_dues_required, true);
  IF NOT v_dues_required THEN v_missing_fields := v_missing_fields - 'receipt'; END IF;
  IF v_transcript_file_id IS NULL AND NOT (v_missing_fields @> '["transcript"]'::jsonb) THEN
    v_missing_fields := v_missing_fields || '["transcript"]'::jsonb;
  END IF;
  IF v_course_count = 0 AND jsonb_array_length(coalesce(p_application_data->'courses', '[]'::jsonb)) = 0
    AND NOT (v_missing_fields @> '["course_data"]'::jsonb) THEN
    v_missing_fields := v_missing_fields || '["course_data"]'::jsonb;
  END IF;
  IF v_dues_required AND v_receipt_file_id IS NULL AND NOT (v_missing_fields @> '["receipt"]'::jsonb) THEN
    v_missing_fields := v_missing_fields || '["receipt"]'::jsonb;
  END IF;
  v_submission_status := CASE
    WHEN jsonb_array_length(v_missing_fields) > 0 THEN 'missing_information'::plugin_data.csf_application_submission_status
    ELSE 'ready'::plugin_data.csf_application_submission_status
  END;
  v_legacy_status := CASE WHEN v_submission_status = 'missing_information' THEN 'needs_action' ELSE 'needs_review' END;

  SELECT application.*
  INTO v_existing_application
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.profile_id = v_profile_id
    AND application.term_id = p_term_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_application.source NOT IN ('google_form_sheet', 'sheet', 'legacy_import')
      OR v_existing_application.decision_status <> 'pending'
      OR v_existing_application.submission_status IN ('under_review', 'decided')
      OR v_existing_application.reviewed_by IS NOT NULL
      OR v_existing_application.assigned_to IS NOT NULL
      OR (v_existing_application.source_file_id IS NOT NULL
        AND v_existing_application.source_file_id IS DISTINCT FROM v_import_job.source_file_id)
      OR EXISTS (
        SELECT 1 FROM plugin_data.csf_application_files AS file
        WHERE file.organization_id = p_organization_id
          AND file.application_id = v_existing_application.id
          AND file.verification_status <> 'unreviewed'
      )
      OR EXISTS (
        SELECT 1 FROM plugin_data.csf_dues_records AS dues
        WHERE dues.organization_id = p_organization_id
          AND dues.application_id = v_existing_application.id
          AND dues.status IN ('verified', 'waived')
      ) THEN
      RAISE EXCEPTION 'A reviewed or officer-managed application already exists and was not overwritten.';
    END IF;

    v_application_id := v_existing_application.id;
    v_import_status := 'updated';
    UPDATE plugin_data.csf_term_applications
    SET
      cohort_id = p_cohort_id,
      source = 'google_form_sheet',
      source_row_id = p_import_row_id,
      source_url = v_source.sheet_url,
      source_submitted_at = v_source_submitted_at,
      status = v_legacy_status,
      submission_status = v_submission_status,
      current_grade_level = v_current_grade_level,
      returning_status = v_returning_status,
      most_checked_email = v_most_checked_email,
      list_i_points = v_list_i_points,
      list_i_ii_points = v_list_i_ii_points,
      grand_total_points = v_grand_total_points,
      application_data = jsonb_build_object(
        'normalizedImport', p_application_data,
        'rowHash', p_row_hash,
        'importRowId', p_import_row_id
      ),
      source_file_id = v_import_job.source_file_id,
      source_file_name = v_import_job.source_file_name,
      source_sheet_tab = v_import_row.sheet_tab_name,
      source_row_number = v_import_row.row_number,
      source_modified_at = v_import_row.source_modified_at,
      source_import_job_id = v_import_job.id,
      source_import_row_id = p_import_row_id,
      updated_at = v_now
    WHERE organization_id = p_organization_id AND id = v_application_id;

    DELETE FROM plugin_data.csf_application_course_entries
    WHERE organization_id = p_organization_id AND application_id = v_application_id;
    DELETE FROM plugin_data.csf_application_files
    WHERE organization_id = p_organization_id
      AND application_id = v_application_id
      AND provider = 'google_drive'
      AND verification_status = 'unreviewed'
      AND file_type IN ('transcript', 'webstore_receipt');
  ELSE
    v_import_status := 'created';
    INSERT INTO plugin_data.csf_term_applications (
      organization_id, profile_id, cohort_id, term_id, source, source_row_id,
      source_url, source_submitted_at, status, submission_status,
      eligibility_status, decision_status, current_grade_level, returning_status,
      most_checked_email, list_i_points, list_i_ii_points, grand_total_points,
      submitted_at, application_data, source_file_id, source_file_name,
      source_sheet_tab, source_row_number, source_modified_at,
      source_import_job_id, source_import_row_id, updated_at
    ) VALUES (
      p_organization_id, v_profile_id, p_cohort_id, p_term_id,
      'google_form_sheet', p_import_row_id, v_source.sheet_url,
      v_source_submitted_at, v_legacy_status, v_submission_status,
      'pending', 'pending', v_current_grade_level, v_returning_status,
      v_most_checked_email, v_list_i_points, v_list_i_ii_points,
      v_grand_total_points, coalesce(v_source_submitted_at, v_now),
      jsonb_build_object(
        'normalizedImport', p_application_data,
        'rowHash', p_row_hash,
        'importRowId', p_import_row_id
      ),
      v_import_job.source_file_id, v_import_job.source_file_name,
      v_import_row.sheet_tab_name, v_import_row.row_number,
      v_import_row.source_modified_at, v_import_job.id, p_import_row_id, v_now
    ) RETURNING id INTO v_application_id;
  END IF;

  FOR v_course IN SELECT value FROM jsonb_array_elements(coalesce(p_application_data->'courses', '[]'::jsonb))
  LOOP
    IF coalesce(v_course->>'courseList', '') NOT IN ('I', 'II', 'III')
      OR nullif(btrim(v_course->>'courseName'), '') IS NULL THEN
      RAISE EXCEPTION 'Each imported course needs a valid list and course name.';
    END IF;
    INSERT INTO plugin_data.csf_application_course_entries (
      organization_id, application_id, course_list, course_name,
      grade, points, is_bonus, raw_line
    ) VALUES (
      p_organization_id, v_application_id, v_course->>'courseList',
      btrim(v_course->>'courseName'), nullif(btrim(v_course->>'grade'), ''),
      nullif(v_course->>'points', '')::numeric,
      coalesce((v_course->>'isBonus')::boolean, false),
      nullif(v_course->>'rawLine', '')
    );
    v_course_count := v_course_count + 1;
  END LOOP;

  IF v_transcript_file_id IS NOT NULL THEN
    INSERT INTO plugin_data.csf_application_files (
      organization_id, application_id, profile_id, term_id, file_type,
      bucket, object_path, original_filename, uploaded_by,
      provider, drive_file_id, drive_file_name, source_url, verification_status
    ) VALUES (
      p_organization_id, v_application_id, v_profile_id, p_term_id, 'transcript',
      NULL, NULL, 'Transcript from application response', p_actor_user_id,
      'google_drive', v_transcript_file_id,
      'Transcript from application response', v_transcript_url, 'unreviewed'
    );
  END IF;

  IF v_receipt_file_id IS NOT NULL THEN
    INSERT INTO plugin_data.csf_application_files (
      organization_id, application_id, profile_id, term_id, file_type,
      bucket, object_path, original_filename, uploaded_by,
      provider, drive_file_id, drive_file_name, source_url, verification_status
    ) VALUES (
      p_organization_id, v_application_id, v_profile_id, p_term_id, 'webstore_receipt',
      NULL, NULL, 'Dues receipt from application response', p_actor_user_id,
      'google_drive', v_receipt_file_id,
      'Dues receipt from application response', v_receipt_url, 'unreviewed'
    ) RETURNING id INTO v_receipt_application_file_id;
  END IF;

  INSERT INTO plugin_data.csf_application_checks (
    organization_id, application_id, check_type, status, mandatory,
    reason_code, summary, details
  ) VALUES
    (
      p_organization_id, v_application_id, 'identity', 'passed', true,
      'unique_import_match', 'Student identity is connected to this imported application.',
      jsonb_build_object('profileId', v_profile_id, 'importRowId', p_import_row_id)
    ),
    (
      p_organization_id, v_application_id, 'required_information',
      CASE WHEN v_current_grade_level IS NOT NULL AND v_most_checked_email IS NOT NULL
        THEN 'passed'::plugin_data.csf_application_check_status
        ELSE 'failed'::plugin_data.csf_application_check_status END,
      true,
      CASE WHEN v_current_grade_level IS NOT NULL AND v_most_checked_email IS NOT NULL
        THEN 'required_information_present' ELSE 'missing_information' END,
      CASE WHEN v_current_grade_level IS NOT NULL AND v_most_checked_email IS NOT NULL
        THEN 'Required application information is present.'
        ELSE 'Required application information is missing.' END,
      jsonb_build_object('missingFields', v_missing_fields)
    ),
    (
      p_organization_id, v_application_id, 'transcript', 'pending', true,
      CASE WHEN v_transcript_file_id IS NOT NULL THEN 'transcript_submitted' ELSE 'missing_transcript' END,
      CASE WHEN v_transcript_file_id IS NOT NULL
        THEN 'Transcript evidence was imported and awaits officer verification.'
        ELSE 'Transcript evidence is missing or inaccessible.' END,
      jsonb_build_object('driveFileId', v_transcript_file_id, 'sourceUrl', v_transcript_url)
    ),
    (
      p_organization_id, v_application_id, 'course_data',
      CASE WHEN v_course_count > 0 THEN 'passed'::plugin_data.csf_application_check_status
        ELSE 'pending'::plugin_data.csf_application_check_status END,
      true,
      CASE WHEN v_course_count > 0 THEN 'course_rows_imported' ELSE 'missing_course' END,
      CASE WHEN v_course_count > 0
        THEN 'Course rows were imported for officer review.'
        ELSE 'Course rows are required; aggregate totals alone do not establish eligibility.' END,
      jsonb_build_object('courseCount', v_course_count, 'sourceAggregateOnly', v_course_count = 0)
    ),
    (
      p_organization_id, v_application_id, 'academic_eligibility', 'pending', true,
      'awaiting_eligibility_review',
      'Academic eligibility must be evaluated from course rows and the policy snapshot.',
      jsonb_build_object(
        'courseCount', v_course_count,
        'sourceTotals', jsonb_build_object(
          'listI', v_list_i_points,
          'listIAndII', v_list_i_ii_points,
          'total', v_grand_total_points
        )
      )
    )
  ON CONFLICT (organization_id, application_id, check_type) DO UPDATE
  SET
    status = EXCLUDED.status,
    reason_code = EXCLUDED.reason_code,
    summary = EXCLUDED.summary,
    details = EXCLUDED.details,
    reviewed_by = NULL,
    reviewed_at = NULL,
    updated_at = v_now;

  UPDATE plugin_data.csf_dues_records
  SET
    status = CASE
      WHEN status = 'not_required' THEN status
      WHEN v_receipt_application_file_id IS NOT NULL
        THEN 'receipt_submitted'::plugin_data.csf_dues_status
      ELSE 'not_recorded'::plugin_data.csf_dues_status
    END,
    receipt_application_file_id = v_receipt_application_file_id,
    source = 'google_form_sheet',
    source_ref = jsonb_build_object(
      'sourceId', p_source_id,
      'importJobId', v_import_job.id,
      'importRowId', p_import_row_id,
      'rowHash', p_row_hash
    ),
    submitted_at = CASE WHEN v_receipt_application_file_id IS NOT NULL
      THEN coalesce(v_source_submitted_at, v_now) ELSE NULL END,
    verified_by = NULL,
    verified_at = NULL,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND application_id = v_application_id
    AND status NOT IN ('verified', 'waived');

  INSERT INTO plugin_data.csf_application_status_events (
    organization_id, application_id, actor_user_id, previous_status, next_status,
    reason, details, correlation_id, reason_code
  ) VALUES (
    p_organization_id, v_application_id, p_actor_user_id,
    CASE WHEN v_import_status = 'updated' THEN v_existing_application.status ELSE NULL END,
    v_legacy_status,
    'Imported from an officer-reviewed Google Sheet preview.',
    jsonb_build_object(
      'sourceId', p_source_id,
      'importJobId', v_import_job.id,
      'importRowId', p_import_row_id,
      'rowHash', p_row_hash,
      'submissionStatus', v_submission_status
    ),
    v_correlation_id,
    CASE WHEN v_submission_status = 'missing_information'
      THEN 'missing_information'::plugin_data.csf_application_reason_code ELSE NULL END
  );

  UPDATE plugin_data.csf_sheet_import_rows
  SET
    matched_profile_id = v_profile_id,
    matched_application_id = v_application_id,
    import_status = v_import_status,
    resolution_status = 'resolved',
    resolution_reason_code = CASE WHEN v_import_status = 'created'
      THEN 'application_created' ELSE 'application_refreshed' END,
    resolution_notes = 'Committed from the reviewed application response preview.',
    resolved_by = p_actor_user_id,
    resolved_at = v_now,
    errors = ARRAY[]::text[]
  WHERE organization_id = p_organization_id AND id = p_import_row_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    correlation_id, source_type, source_id, after_data
  ) VALUES (
    p_organization_id, p_actor_user_id,
    'sheets.application_response_row_imported', 'csf_term_applications',
    v_application_id, p_term_id, v_correlation_id, 'sheet_import', p_source_id::text,
    jsonb_build_object(
      'profileId', v_profile_id,
      'applicationId', v_application_id,
      'sourceId', p_source_id,
      'importJobId', v_import_job.id,
      'importRowId', p_import_row_id,
      'rowHash', p_row_hash,
      'importStatus', v_import_status,
      'submissionStatus', v_submission_status,
      'courseCount', v_course_count,
      'transcriptImported', v_transcript_file_id IS NOT NULL,
      'receiptImported', v_receipt_file_id IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'profileId', v_profile_id,
    'applicationId', v_application_id,
    'importStatus', v_import_status,
    'submissionStatus', v_submission_status,
    'correlationId', v_correlation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_import_application_response_row(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_import_application_response_row(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_import_application_response_row(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, uuid
) IS
  'Atomically imports an officer-reviewed application response with immutable Sheet provenance, normalized courses, private Drive evidence, typed checks, dues receipt state, and audit history; it never approves eligibility or membership.';

COMMIT;
