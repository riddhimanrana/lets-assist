-- Preserve bounded positional evidence for class-history activity and meeting cells.
--
-- The canonical record remains layout-independent and keeps its existing digest.
-- sourceEvidence records only approved activity and meeting cells, their exact
-- one-based source columns, and the saved activity point mode. This lets an
-- officer prove how repeated one-point slots produced the reviewed totals without
-- retaining unrelated workbook columns or changing commit identity.

CREATE OR REPLACE FUNCTION plugin_data.csf_normalized_record_schema(
  p_source_type text
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_source_type
    WHEN 'application_responses' THEN '{
      "identity": {"kind": "object", "fields": {
        "firstName": "string", "lastName": "string",
        "normalizedFirstName": "string", "normalizedLastName": "string"
      }},
      "contact": {"kind": "object", "fields": {
        "responseEmail": "string", "responseEmailState": "string",
        "preferredContactEmail": "string", "preferredContactEmailState": "string",
        "emailsAgree": "boolean"
      }},
      "cohort": {"kind": "object", "fields": {
        "gradeLevel": "number", "returningStatus": "string"
      }},
      "submission": {"kind": "object", "fields": {"submittedAt": "string"}},
      "claimedTotals": {"kind": "object", "fields": {
        "listIPoints": "number", "listIAndIIPoints": "number", "grandTotalPoints": "number"
      }},
      "courses": {"kind": "array", "fields": {
        "courseList": "string", "courseName": "string", "grade": "string", "isBonus": "boolean"
      }},
      "evidence": {"kind": "object", "fields": {
        "transcriptDriveFileId": "string", "transcriptAccessState": "string",
        "receiptDriveFileId": "string", "receiptAccessState": "string"
      }}
    }'::jsonb
    WHEN 'student_roster' THEN '{
      "identity": {"kind": "object", "fields": {
        "firstName": "string", "lastName": "string",
        "normalizedFirstName": "string", "normalizedLastName": "string"
      }},
      "contact": {"kind": "object", "fields": {
        "schoolEmail": "string", "schoolEmailState": "string",
        "personalEmail": "string", "personalEmailState": "string"
      }},
      "cohort": {"kind": "object", "fields": {"gradeLevel": "number"}}
    }'::jsonb
    WHEN 'class_history' THEN '{
      "identity": {"kind": "object", "fields": {
        "firstName": "string", "lastName": "string",
        "normalizedFirstName": "string", "normalizedLastName": "string"
      }},
      "contact": {"kind": "object", "fields": {
        "schoolEmail": "string", "schoolEmailState": "string",
        "personalEmail": "string", "personalEmailState": "string"
      }},
      "activities": {"kind": "array", "fields": {"label": "string", "points": "number"}},
      "meetings": {"kind": "array", "fields": {"key": "string", "label": "string", "state": "string"}},
      "requirements": {"kind": "object", "fields": {"allRequirementsMet": "boolean"}}
    }'::jsonb
    ELSE NULL
  END;
$$;

-- Validate one allowlisted normalized record against its schema, and fail closed.
--
-- Bounds are part of the schema, not an afterthought: an oversized nested value

CREATE OR REPLACE FUNCTION plugin_data.csf_derive_row_commit_payload(
  p_source_type text,
  p_record jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_identity jsonb := coalesce(p_record -> 'identity', '{}'::jsonb);
  v_contact jsonb := coalesce(p_record -> 'contact', '{}'::jsonb);
  v_first text := coalesce(plugin_data.csf_payload_string(v_identity -> 'firstName'), '');
  v_last text := coalesce(plugin_data.csf_payload_string(v_identity -> 'lastName'), '');
  v_school text;
  v_personal text;
  v_application jsonb := NULL;
  v_activities jsonb := NULL;
  v_meetings jsonb := NULL;
  v_requirements jsonb := 'null'::jsonb;
  v_entry jsonb;
  v_index integer := 0;
  v_label text;
  v_points jsonb;
  v_key text;
  v_state text;
  v_grade jsonb;
BEGIN
  IF plugin_data.csf_normalized_record_schema(p_source_type) IS NULL THEN
    RAISE EXCEPTION
      'CSF source type "%" is not eligible for the central commit path, so no commit payload may be derived for it.',
      coalesce(p_source_type, '<null>') USING ERRCODE = '23514';
  END IF;

  -- Canonical identity addresses, by source type. Application: none, ever.
  IF p_source_type = 'application_responses' THEN
    v_school := NULL;
    v_personal := NULL;
  ELSE
    -- Key ABSENT means the adapter recorded no state and the address stands.
    -- Key PRESENT but not exactly the string 'valid' -- including an explicit
    -- JSON null -- means the adapter could not validate it, so it is evidence
    -- for an officer and never canonical identity. `coalesce` would have
    -- collapsed those two into one and quietly promoted the second.
    v_school := CASE
      WHEN NOT (v_contact ? 'schoolEmailState')
        OR (v_contact ->> 'schoolEmailState') = 'valid'
        THEN plugin_data.csf_payload_string(v_contact -> 'schoolEmail')
      ELSE NULL
    END;
    v_personal := CASE
      WHEN NOT (v_contact ? 'personalEmailState')
        OR (v_contact ->> 'personalEmailState') = 'valid'
        THEN plugin_data.csf_payload_string(v_contact -> 'personalEmail')
      ELSE NULL
    END;
  END IF;

  IF p_source_type = 'application_responses' THEN
    DECLARE
      v_cohort jsonb := coalesce(p_record -> 'cohort', '{}'::jsonb);
      v_submission jsonb := coalesce(p_record -> 'submission', '{}'::jsonb);
      v_claimed jsonb := coalesce(p_record -> 'claimedTotals', '{}'::jsonb);
      v_evidence jsonb := coalesce(p_record -> 'evidence', '{}'::jsonb);
      v_courses jsonb := '[]'::jsonb;
      v_grade_level jsonb := plugin_data.csf_payload_number(v_cohort -> 'gradeLevel');
      v_preferred text := plugin_data.csf_payload_string(v_contact -> 'preferredContactEmail');
      v_course_name text;
      v_course_list text;
      v_missing jsonb := '[]'::jsonb;
    BEGIN
      FOR v_entry IN
        SELECT value FROM pg_catalog.jsonb_array_elements(
          CASE WHEN pg_catalog.jsonb_typeof(coalesce(p_record -> 'courses', '[]'::jsonb)) = 'array'
            THEN p_record -> 'courses' ELSE '[]'::jsonb END
        ) AS element(value)
      LOOP
        v_course_name := plugin_data.csf_payload_string(v_entry -> 'courseName');
        v_course_list := plugin_data.csf_payload_string(v_entry -> 'courseList');
        CONTINUE WHEN v_course_name IS NULL OR v_course_list IS NULL;
        v_grade := pg_catalog.to_jsonb(plugin_data.csf_payload_string(v_entry -> 'grade'));
        v_courses := v_courses || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'courseList', v_course_list,
          'courseName', v_course_name,
          'grade', coalesce(v_grade, 'null'::jsonb),
          -- Never derived from a course name: bonus weight is published policy.
          'points', NULL,
          'isBonus', false
        ));
      END LOOP;

      IF v_grade_level = 'null'::jsonb THEN
        v_missing := v_missing || pg_catalog.jsonb_build_array('current_grade_level');
      END IF;
      IF v_preferred IS NULL THEN
        v_missing := v_missing || pg_catalog.jsonb_build_array('most_checked_email');
      END IF;

      v_application := pg_catalog.jsonb_build_object(
        'currentGradeLevel', v_grade_level,
        'returningStatus', coalesce(plugin_data.csf_payload_string(v_cohort -> 'returningStatus'), 'unknown'),
        'sourceSubmittedAt', coalesce(pg_catalog.to_jsonb(plugin_data.csf_payload_string(v_submission -> 'submittedAt')), 'null'::jsonb),
        'mostCheckedEmail', coalesce(pg_catalog.to_jsonb(v_preferred), 'null'::jsonb),
        'listIPoints', NULL,
        'listIAndIIPoints', NULL,
        'grandTotalPoints', NULL,
        'claimedTotals', pg_catalog.jsonb_build_object(
          'listIPoints', plugin_data.csf_payload_number(v_claimed -> 'listIPoints'),
          'listIAndIIPoints', plugin_data.csf_payload_number(v_claimed -> 'listIAndIIPoints'),
          'grandTotalPoints', plugin_data.csf_payload_number(v_claimed -> 'grandTotalPoints')
        ),
        'transcriptDriveFileId', coalesce(pg_catalog.to_jsonb(plugin_data.csf_payload_string(v_evidence -> 'transcriptDriveFileId')), 'null'::jsonb),
        'transcriptUrl', NULL,
        'transcriptAccessState', coalesce(pg_catalog.to_jsonb(plugin_data.csf_payload_string(v_evidence -> 'transcriptAccessState')), 'null'::jsonb),
        'receiptDriveFileId', coalesce(pg_catalog.to_jsonb(plugin_data.csf_payload_string(v_evidence -> 'receiptDriveFileId')), 'null'::jsonb),
        'receiptUrl', NULL,
        'receiptAccessState', coalesce(pg_catalog.to_jsonb(plugin_data.csf_payload_string(v_evidence -> 'receiptAccessState')), 'null'::jsonb),
        'courses', v_courses,
        'missingFields', v_missing
      );
    END;
  END IF;

  IF p_source_type = 'class_history' THEN
    v_activities := '[]'::jsonb;
    FOR v_entry IN
      SELECT value FROM pg_catalog.jsonb_array_elements(
        CASE WHEN pg_catalog.jsonb_typeof(coalesce(p_record -> 'activities', '[]'::jsonb)) = 'array'
          THEN p_record -> 'activities' ELSE '[]'::jsonb END
      ) AS element(value)
    LOOP
      v_index := v_index + 1;
      v_label := plugin_data.csf_payload_string(v_entry -> 'label');
      v_points := plugin_data.csf_payload_number(v_entry -> 'points');
      -- Text without a positive number never becomes points.
      CONTINUE WHEN v_label IS NULL
        OR v_points = 'null'::jsonb
        OR (v_points #>> '{}')::numeric <= 0;
      v_activities := v_activities || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'slot', 'activity_' || v_index::text,
        'label', v_label,
        'value', v_label,
        'points', v_points,
        -- Deliberately empty: workbook layout is not part of a committed record.
        'sourceColumns', '[]'::jsonb
      ));
    END LOOP;

    v_meetings := '[]'::jsonb;
    FOR v_entry IN
      SELECT value FROM pg_catalog.jsonb_array_elements(
        CASE WHEN pg_catalog.jsonb_typeof(coalesce(p_record -> 'meetings', '[]'::jsonb)) = 'array'
          THEN p_record -> 'meetings' ELSE '[]'::jsonb END
      ) AS element(value)
    LOOP
      v_key := plugin_data.csf_payload_string(v_entry -> 'key');
      v_state := plugin_data.csf_payload_string(v_entry -> 'state');
      CONTINUE WHEN v_key IS NULL OR v_state IS NULL;
      v_meetings := v_meetings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'key', plugin_data.csf_meeting_key_from_label(v_key),
        'label', coalesce(plugin_data.csf_payload_string(v_entry -> 'label'), v_key),
        'value', v_state,
        'status', plugin_data.csf_meeting_attendance_value(v_state)
      ));
    END LOOP;

    IF pg_catalog.jsonb_typeof(coalesce(p_record -> 'requirements' -> 'allRequirementsMet', 'null'::jsonb)) = 'boolean' THEN
      v_requirements := p_record -> 'requirements' -> 'allRequirementsMet';
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
      'version', 'csf-commit-payload/v1',
      'sourceType', p_source_type,
      'identity', pg_catalog.jsonb_build_object(
        'firstName', v_first,
        'lastName', v_last,
        'normalizedFirstName', coalesce(
          plugin_data.csf_payload_string(v_identity -> 'normalizedFirstName'),
          plugin_data.csf_normalize_identity_part(v_first)
        ),
        'normalizedLastName', coalesce(
          plugin_data.csf_payload_string(v_identity -> 'normalizedLastName'),
          plugin_data.csf_normalize_identity_part(v_last)
        )
      ),
      'canonicalEmails', pg_catalog.jsonb_build_object(
        'schoolEmail', coalesce(pg_catalog.to_jsonb(v_school), 'null'::jsonb),
        'personalEmail', coalesce(pg_catalog.to_jsonb(v_personal), 'null'::jsonb),
        'normalizedSchoolEmail', coalesce(
          pg_catalog.to_jsonb(plugin_data.csf_normalize_email_text(v_school)), 'null'::jsonb
        ),
        'normalizedPersonalEmail', coalesce(
          pg_catalog.to_jsonb(plugin_data.csf_normalize_email_text(v_personal)), 'null'::jsonb
        )
      ),
      'applicationData', coalesce(v_application, 'null'::jsonb),
      'activities', coalesce(v_activities, 'null'::jsonb),
      'meetings', coalesce(v_meetings, 'null'::jsonb),
      'allRequirementsMet', CASE WHEN p_source_type = 'class_history' THEN v_requirements ELSE 'null'::jsonb END
    );
END;
$$;


CREATE OR REPLACE FUNCTION plugin_data.csf_append_import_preview_rows(p_organization_id uuid, p_actor_user_id uuid, p_preview_job_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  -- `source_id` and `mapping_version` are gone from this list on purpose: they
  -- are derived from the locked job, so a caller can no longer state a value
  -- that diverges from the preview the row belongs to.
  c_allowed_keys constant text[] := ARRAY[
    'cohort_id', 'term_id', 'sheet_tab_name', 'row_number', 'source_range',
    'raw_data', 'normalized_data', 'row_hash', 'matched_profile_id',
    'matched_application_id', 'import_status', 'errors', 'warnings',
    'retry_of_row_id', 'source_modified_at'
  ];
  -- Non-terminal only. A preview row may arrive already needing an officer decision, but
  -- it may never arrive claiming a commit outcome.
  c_allowed_status constant text[] := ARRAY[
    'pending', 'ambiguous', 'conflict', 'duplicate', 'error', 'skipped'
  ];
  -- `superseded` is NOT in that list. It is derived below, not selected: it
  -- asserts that an earlier attempt already committed exactly this evidence, and
  -- a caller able to state it could mark a changed row as already-imported and
  -- have the commit path skip it. The row terminal states an ancestor may be in
  -- for that assertion to hold are enumerated rather than "anything final".
  c_committed_parent_status constant text[] := ARRAY['created', 'updated', 'superseded'];
  -- Envelope keys the central Sheets flow states. `commitPayload` is absent:
  -- the RPC derives it, and a caller stating one is refused rather than merged.
  c_central_envelope_keys constant text[] := ARRAY[
    'contractVersion', 'snapshotHash', 'rowHash', 'sourceType', 'termCode',
    'targetStrategy', 'targetStatus', 'targetTermCode', 'targetTermLabel',
    'targetCohortYear', 'targetCohortLabel', 'targetErrors', 'matchBasis',
    'rejected', 'record', 'annotations', 'sourceEvidence'
  ];
  -- Presentation evidence limits. A sheet row has at most a few dozen columns,
  -- and a note is officer prose, not a document.
  c_max_annotation_columns constant integer := 60;
  c_max_annotation_note_chars constant integer := 4000;
  v_job plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_row jsonb;
  v_key text;
  v_status text;
  v_inserted integer := 0;
  v_replayed integer := 0;
  v_existing plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_normalized jsonb;
  v_raw jsonb;
  v_record jsonb;
  v_payload jsonb;
  v_digest text;
  v_central boolean;
  v_tab text;
  v_number integer;
  v_requested_superseded boolean;
  v_parent plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_evidence jsonb;
  v_entry jsonb;
  v_evidence_body jsonb;
  v_evidence_hash text;
BEGIN
  PERFORM plugin_data.csf_assert_preview_payload_bounds(p_rows);

  SELECT * INTO v_job
  FROM plugin_data.csf_sheet_import_jobs AS job
  WHERE job.organization_id = p_organization_id
    AND job.id = p_preview_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF preview job was not found for this organization.'
      USING ERRCODE = '23503';
  END IF;
  -- Only a preview still being constructed accepts rows. A sealed preview is immutable,
  -- and a commit job never accepts rows at all.
  IF v_job.mode <> 'preview' THEN
    RAISE EXCEPTION 'Only a CSF preview job may receive preview rows.' USING ERRCODE = '23514';
  END IF;
  IF v_job.status <> 'running' THEN
    RAISE EXCEPTION
      'This CSF preview is no longer being constructed; its rows are sealed.'
      USING ERRCODE = '55000';
  END IF;
  IF v_job.initiated_by IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION
      'Only the officer who started this CSF preview may add rows to it.'
      USING ERRCODE = '42501';
  END IF;
  -- Still authorized *now*, not merely at open time. A capability withdrawn
  -- mid-preview stops further rows; closing the job stays available through the
  -- narrower cleanup authority.
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id, p_actor_user_id, v_job.source_type
  );

  v_central := plugin_data.csf_normalized_record_schema(v_job.source_type) IS NOT NULL;

  FOR v_row IN SELECT jsonb_array_elements(p_rows)
  LOOP
    -- Cleared per row: a %ROWTYPE variable keeps the previous iteration's value
    -- otherwise, and a row with no retry parent would inherit the last one's.
    v_parent := NULL;
    v_raw := '{}'::jsonb;
    IF jsonb_typeof(v_row) <> 'object' THEN
      RAISE EXCEPTION 'Each CSF preview row must be a JSON object.' USING ERRCODE = '22023';
    END IF;
    -- Closed shape. A key nobody reviewed cannot arrive by being added upstream, and in
    -- particular none of the commit, freeze, intent, outcome, retry or settlement columns
    -- is nameable here at all.
    FOR v_key IN SELECT jsonb_object_keys(v_row)
    LOOP
      IF NOT (v_key = ANY (c_allowed_keys)) THEN
        RAISE EXCEPTION 'A CSF preview row may not set "%".', v_key USING ERRCODE = '23514';
      END IF;
    END LOOP;

    v_status := coalesce(nullif(btrim(coalesce(v_row->>'import_status', '')), ''), 'pending');
    v_requested_superseded := v_status = 'superseded';
    IF v_requested_superseded THEN
      -- Held as `pending` until the lineage below proves otherwise. A request
      -- that cannot be proved does not fall back to `superseded`.
      v_status := 'pending';
    ELSIF NOT (v_status = ANY (c_allowed_status)) THEN
      RAISE EXCEPTION
        'A CSF preview row may not be created with the terminal status "%".', v_status
        USING ERRCODE = '23514';
    END IF;
    v_tab := nullif(btrim(coalesce(v_row->>'sheet_tab_name', '')), '');
    IF v_tab IS NULL OR coalesce(v_row->>'row_number', '') !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'A CSF preview row needs a sheet tab and a positive row number.'
        USING ERRCODE = '22023';
    END IF;
    v_number := (v_row->>'row_number')::integer;
    IF jsonb_typeof(coalesce(v_row -> 'raw_data', '{}'::jsonb)) <> 'object'
      OR jsonb_typeof(coalesce(v_row -> 'normalized_data', '{}'::jsonb)) <> 'object'
    THEN
      RAISE EXCEPTION 'CSF preview row evidence must be recorded as JSON objects.'
        USING ERRCODE = '22023';
    END IF;

    v_normalized := coalesce(v_row -> 'normalized_data', '{}'::jsonb);
    -- No caller may state the authoritative payload, on any source type. On a
    -- contextual preview this is what stops a commit-shaped object from making
    -- an ineligible row look eligible; on a central one it is what stops a
    -- forged identity from being frozen under a valid row.
    IF v_normalized ? 'commitPayload' THEN
      RAISE EXCEPTION
        'A CSF preview row may not state its own commit payload; it is derived from the accepted record.'
        USING ERRCODE = '23514';
    END IF;

    IF v_central THEN
      FOR v_key IN SELECT jsonb_object_keys(v_normalized)
      LOOP
        IF NOT (v_key = ANY (c_central_envelope_keys)) THEN
          RAISE EXCEPTION
            'A CSF % preview row may not carry normalized_data."%".', v_job.source_type, v_key
            USING ERRCODE = '23514';
        END IF;
      END LOOP;
      -- Presentation evidence: cell fills and notes captured at acquisition.
      -- The interpreter treats these as officer signal, so their shape is part
      -- of the reviewed contract: an object keyed by positive column numbers,
      -- each value carrying only a bounded background hex and/or note text.
      IF v_normalized ? 'annotations' THEN
        IF jsonb_typeof(v_normalized -> 'annotations') <> 'object' THEN
          RAISE EXCEPTION 'CSF preview row annotations must be a JSON object.'
            USING ERRCODE = '22023';
        END IF;
        IF (SELECT count(*) FROM jsonb_object_keys(v_normalized -> 'annotations'))
          > c_max_annotation_columns
        THEN
          RAISE EXCEPTION 'A CSF preview row may not carry more than % annotated columns.',
            c_max_annotation_columns USING ERRCODE = '23514';
        END IF;
        FOR v_key IN SELECT jsonb_object_keys(v_normalized -> 'annotations')
        LOOP
          IF v_key !~ '^[1-9][0-9]{0,2}$' THEN
            RAISE EXCEPTION
              'CSF preview row annotations must be keyed by column number, not "%".', v_key
              USING ERRCODE = '23514';
          END IF;
          IF jsonb_typeof(v_normalized -> 'annotations' -> v_key) <> 'object' THEN
            RAISE EXCEPTION 'Each CSF preview row annotation must be a JSON object.'
              USING ERRCODE = '22023';
          END IF;
          IF EXISTS (
            SELECT 1 FROM jsonb_object_keys(v_normalized -> 'annotations' -> v_key) AS field
            WHERE field NOT IN ('background', 'note')
          ) THEN
            RAISE EXCEPTION
              'A CSF preview row annotation may carry only "background" and "note".'
              USING ERRCODE = '23514';
          END IF;
          IF v_normalized -> 'annotations' -> v_key ? 'background'
            AND coalesce(v_normalized -> 'annotations' -> v_key ->> 'background', '')
              !~ '^#[0-9a-f]{6}$'
          THEN
            RAISE EXCEPTION
              'A CSF preview row annotation background must be a lowercase #rrggbb color.'
              USING ERRCODE = '23514';
          END IF;
          IF v_normalized -> 'annotations' -> v_key ? 'note'
            AND (jsonb_typeof(v_normalized -> 'annotations' -> v_key -> 'note') <> 'string'
              OR length(v_normalized -> 'annotations' -> v_key ->> 'note')
                > c_max_annotation_note_chars)
          THEN
            RAISE EXCEPTION 'A CSF preview row annotation note must be bounded text.'
              USING ERRCODE = '23514';
          END IF;
        END LOOP;
      END IF;

      -- Positional source evidence is separate from the canonical record and its
      -- digest. It carries only approved activity and meeting cells.
      IF v_normalized ? 'sourceEvidence' THEN
        IF v_job.source_type <> 'class_history'
          OR jsonb_typeof(v_normalized -> 'sourceEvidence') <> 'object'
        THEN
          RAISE EXCEPTION 'Only a CSF class-history row may carry source evidence as a JSON object.'
            USING ERRCODE = '23514';
        END IF;
        v_evidence := v_normalized -> 'sourceEvidence';
        IF EXISTS (
          SELECT 1 FROM jsonb_object_keys(v_evidence) AS field
          WHERE field NOT IN (
            'version', 'activityPointMode', 'activities', 'meetings',
            'sourceEvidenceHash'
          )
        ) THEN
          RAISE EXCEPTION 'CSF class-history source evidence carries an unknown field.'
            USING ERRCODE = '23514';
        END IF;
        IF coalesce(v_evidence ->> 'version', '') <> 'csf-class-history-source/v1' THEN
          RAISE EXCEPTION 'CSF class-history source evidence needs the supported version.'
            USING ERRCODE = '23514';
        END IF;
        IF coalesce(v_evidence ->> 'activityPointMode', '') NOT IN
          ('explicit_numeric', 'one_per_populated_slot')
        THEN
          RAISE EXCEPTION 'CSF class-history source evidence needs a reviewed activity point mode.'
            USING ERRCODE = '23514';
        END IF;
        IF jsonb_typeof(coalesce(v_evidence -> 'activities', '[]'::jsonb)) <> 'array'
          OR jsonb_typeof(coalesce(v_evidence -> 'meetings', '[]'::jsonb)) <> 'array'
          OR jsonb_array_length(coalesce(v_evidence -> 'activities', '[]'::jsonb)) > 60
          OR jsonb_array_length(coalesce(v_evidence -> 'meetings', '[]'::jsonb)) > 60
        THEN
          RAISE EXCEPTION 'CSF class-history source evidence needs bounded activity and meeting arrays.'
            USING ERRCODE = '23514';
        END IF;
        FOR v_entry IN
          SELECT value FROM jsonb_array_elements(
            coalesce(v_evidence -> 'activities', '[]'::jsonb)
            || coalesce(v_evidence -> 'meetings', '[]'::jsonb)
          ) AS element(value)
        LOOP
          IF jsonb_typeof(v_entry) <> 'object'
            OR EXISTS (
              SELECT 1 FROM jsonb_object_keys(v_entry) AS field
              WHERE field NOT IN ('columnNumber', 'columnLabel', 'value')
            )
            OR NOT (v_entry ?& ARRAY['columnNumber', 'columnLabel', 'value'])
            OR jsonb_typeof(v_entry -> 'columnNumber') <> 'number'
            OR coalesce(v_entry ->> 'columnNumber', '') !~ '^[1-9][0-9]{0,2}$'
            OR jsonb_typeof(v_entry -> 'columnLabel') <> 'string'
            OR length(v_entry ->> 'columnLabel') NOT BETWEEN 1 AND 160
            OR jsonb_typeof(v_entry -> 'value') <> 'string'
            OR length(v_entry ->> 'value') NOT BETWEEN 1 AND 200
          THEN
            RAISE EXCEPTION 'Each CSF class-history source cell needs a bounded column number, label, and value.'
              USING ERRCODE = '23514';
          END IF;
        END LOOP;
        v_evidence_body := jsonb_build_object(
          'version', 'csf-class-history-source/v1',
          'coordinate', jsonb_build_object('tabName', v_tab, 'rowNumber', v_number),
          'activityPointMode', v_evidence ->> 'activityPointMode',
          'activities', coalesce(v_evidence -> 'activities', '[]'::jsonb),
          'meetings', coalesce(v_evidence -> 'meetings', '[]'::jsonb)
        );
        v_evidence_hash := plugin_data.csf_canonical_digest(v_evidence_body);
        IF v_evidence ? 'sourceEvidenceHash'
          AND coalesce(v_evidence ->> 'sourceEvidenceHash', '') IS DISTINCT FROM v_evidence_hash
        THEN
          RAISE EXCEPTION 'The stated class-history source evidence hash does not match its cells.'
            USING ERRCODE = '23514';
        END IF;
        v_normalized := jsonb_set(
          v_normalized,
          '{sourceEvidence}',
          v_evidence_body || jsonb_build_object('sourceEvidenceHash', v_evidence_hash)
        );
      END IF;

      -- An absent or unrecognized contract version fails closed for every
      -- variant: a row whose serialization rules are unknown cannot be hashed
      -- into evidence anybody can later verify.
      IF coalesce(v_normalized ->> 'contractVersion', '') <> 'csf-normalized-import/v1' THEN
        RAISE EXCEPTION
          'A CSF preview row must state the supported normalized import contract version.'
          USING ERRCODE = '23514';
      END IF;
      IF coalesce(v_normalized ->> 'sourceType', '') IS DISTINCT FROM v_job.source_type THEN
        RAISE EXCEPTION
          'A CSF preview row must agree with its preview about the source type.'
          USING ERRCODE = '23514';
      END IF;

      -- The allowlisted record, validated against the exact nested schema, then
      -- the payload and the digest DERIVED from it. Everything downstream reads
      -- these, so nothing downstream depends on a caller having been honest.
      v_record := plugin_data.csf_assert_canonical_record(
        v_job.source_type, coalesce(v_normalized -> 'record', '{}'::jsonb)
      );
      v_payload := plugin_data.csf_derive_row_commit_payload(v_job.source_type, v_record);
      v_digest := plugin_data.csf_canonical_digest(v_record);

      -- A caller digest is allowed to be present and is required to agree. A row
      -- whose stated digest names different evidence than the row carries is a
      -- forged coordinate, not a retry.
      IF nullif(v_row->>'row_hash', '') IS NOT NULL
        AND nullif(v_row->>'row_hash', '') IS DISTINCT FROM v_digest
      THEN
        RAISE EXCEPTION
          'The digest stated for CSF preview row %:% does not match the record it carries.',
          v_tab, v_number USING ERRCODE = '23514';
      END IF;
      IF nullif(v_normalized->>'rowHash', '') IS NOT NULL
        AND nullif(v_normalized->>'rowHash', '') IS DISTINCT FROM v_digest
      THEN
        RAISE EXCEPTION
          'The evidence digest inside CSF preview row %:% does not match the record it carries.',
          v_tab, v_number USING ERRCODE = '23514';
      END IF;

      -- An application row may never arrive with a caller-selected target. Only
      -- an officer resolution binds one, so accepting a match here would be the
      -- whole unresolved-application boundary bypassed by naming a profile.
      IF v_job.source_type = 'application_responses'
        AND nullif(v_row->>'matched_profile_id', '') IS NOT NULL
      THEN
        RAISE EXCEPTION
          'A CSF application preview row may not arrive already bound to a member; an officer resolves it.'
          USING ERRCODE = '23514';
      END IF;

      v_normalized := v_normalized
        || jsonb_build_object('record', v_record, 'rowHash', v_digest, 'commitPayload', v_payload);
    ELSE
      -- Contextual previews keep their own shapes but gain the same two
      -- guarantees: bounded evidence, and no path to central eligibility.
      IF octet_length(v_normalized::text) > 200000 THEN
        RAISE EXCEPTION 'This CSF preview row carries more evidence than the boundary accepts.'
          USING ERRCODE = '22023';
      END IF;
      v_digest := nullif(v_row->>'row_hash', '');
      -- And a contextual row retains NO raw payload at all.
      --
      -- A central row's `raw_data` is already constrained to the accepted
      -- canonical record. A contextual one was stored exactly as the caller sent
      -- it, bounded only by size, so an unmapped source password, an irrelevant
      -- qualitative answer, a hyperlink, a quoted source value or a rejected
      -- column arrived and stayed. Discarding it here rather than refusing the
      -- row is deliberate: refusal would make every existing contextual importer
      -- fail at runtime, while discarding retains nothing and needs no caller to
      -- change first. Nothing reads a contextual `raw_data`; the commit path
      -- reads `normalized_data`.
      v_raw := '{}'::jsonb;
    END IF;

    -- `raw_data` is either empty or exactly the same allowlisted record. A second,
    -- wider copy of the row is what previously carried discarded passwords,
    -- qualitative responses, and rejected columns into the database.
    IF v_central THEN
      IF coalesce(v_row -> 'raw_data', '{}'::jsonb) <> '{}'::jsonb
        AND coalesce(v_row -> 'raw_data', '{}'::jsonb) IS DISTINCT FROM v_record
      THEN
        RAISE EXCEPTION
          'A CSF preview row may only retain the accepted canonical record, never a second wider copy.'
          USING ERRCODE = '23514';
      END IF;
      -- Derived, not forwarded: the stored value is the record this RPC accepted,
      -- so it cannot differ from the record even by a key ordering.
      v_raw := CASE
        WHEN coalesce(v_row -> 'raw_data', '{}'::jsonb) = '{}'::jsonb THEN '{}'::jsonb
        ELSE v_record
      END;
    END IF;

    -- Exact tenant/cohort/term relationships. A row may not reach across tenants
    -- through any of its foreign coordinates.
    IF nullif(v_row->>'cohort_id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM plugin_data.csf_cohorts AS cohort
        WHERE cohort.organization_id = p_organization_id
          AND cohort.id = (v_row->>'cohort_id')::uuid
      )
    THEN
      RAISE EXCEPTION 'A CSF preview row must name a class of this organization.'
        USING ERRCODE = '23503';
    END IF;
    IF nullif(v_row->>'term_id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM plugin_data.csf_terms AS term
        WHERE term.organization_id = p_organization_id
          AND term.id = (v_row->>'term_id')::uuid
      )
    THEN
      RAISE EXCEPTION 'A CSF preview row must name a semester of this organization.'
        USING ERRCODE = '23503';
    END IF;
    IF nullif(v_row->>'matched_profile_id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM plugin_data.csf_profiles AS profile
        WHERE profile.organization_id = p_organization_id
          AND profile.id = (v_row->>'matched_profile_id')::uuid
      )
    THEN
      RAISE EXCEPTION 'A CSF preview row must name a member of this organization.'
        USING ERRCODE = '23503';
    END IF;
    -- A matched application must agree with the row on tenant, member, class and
    -- semester. An application belonging to a different member is not a weaker
    -- match; it is a different student's record.
    IF nullif(v_row->>'matched_application_id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM plugin_data.csf_term_applications AS application
        WHERE application.organization_id = p_organization_id
          AND application.id = (v_row->>'matched_application_id')::uuid
          AND (
            nullif(v_row->>'matched_profile_id', '') IS NULL
            OR application.profile_id = (v_row->>'matched_profile_id')::uuid
          )
          AND (
            nullif(v_row->>'term_id', '') IS NULL
            OR application.term_id = (v_row->>'term_id')::uuid
          )
      )
    THEN
      RAISE EXCEPTION
        'A CSF preview row must name an application of this organization that agrees with its member and semester.'
        USING ERRCODE = '23503';
    END IF;

    -- A retry parent must be a row of the exact parent preview at the exact
    -- sheet coordinate. Naming an arbitrary same-organization row would let a
    -- clean row inherit a different row's review history and terminal state.
    IF nullif(v_row->>'retry_of_row_id', '') IS NOT NULL THEN
      IF v_job.retry_of_job_id IS NULL THEN
        RAISE EXCEPTION
          'A CSF preview row may only name a retry parent when its preview is itself a retry.'
          USING ERRCODE = '23514';
      END IF;
      SELECT * INTO v_parent
      FROM plugin_data.csf_sheet_import_rows AS parent
      WHERE parent.organization_id = p_organization_id
        AND parent.id = (v_row->>'retry_of_row_id')::uuid
        AND parent.job_id = v_job.retry_of_job_id
        AND parent.source_id IS NOT DISTINCT FROM v_job.source_id
        AND parent.sheet_tab_name = v_tab
        AND parent.row_number = v_number;
      IF NOT FOUND THEN
        RAISE EXCEPTION
          'The retry parent named by CSF preview row %:% is not that row in the parent preview.',
          v_tab, v_number USING ERRCODE = '23503';
      END IF;
    END IF;

    -- `superseded`, derived. Four facts must all hold, and the row is left
    -- `pending` -- committable, reviewable -- if any of them does not:
    --
    --   1. exact parent lineage, already proved above;
    --   2. the same sheet coordinate, also proved above;
    --   3. the ancestor reached one of the enumerated committed terminal states;
    --   4. the canonical evidence is byte-identical to what that ancestor
    --      carried.
    --
    -- Without (4) a re-previewed row whose values changed would be marked
    -- already-imported and silently skipped by the commit path.
    IF v_requested_superseded THEN
      IF v_parent.id IS NOT NULL
        AND v_parent.import_status = ANY (c_committed_parent_status)
        AND v_parent.row_hash IS NOT NULL
        AND v_parent.row_hash IS NOT DISTINCT FROM v_digest
        AND v_parent.normalized_data IS NOT DISTINCT FROM v_normalized
      THEN
        v_status := 'superseded';
      END IF;
    END IF;

    -- Replay, decided by coordinate rather than by hoping the caller retries cleanly.
    SELECT * INTO v_existing
    FROM plugin_data.csf_sheet_import_rows AS existing
    WHERE existing.job_id = p_preview_job_id
      AND existing.sheet_tab_name = v_tab
      AND existing.row_number = v_number;
    IF FOUND THEN
      IF v_existing.row_hash IS DISTINCT FROM v_digest
        OR v_existing.normalized_data IS DISTINCT FROM v_normalized
        OR v_existing.import_status IS DISTINCT FROM v_status
      THEN
        RAISE EXCEPTION
          'A CSF preview row already exists at %:% describing different evidence; the preview would not describe one read of the source.',
          v_tab, v_number
          USING ERRCODE = '23505';
      END IF;
      v_replayed := v_replayed + 1;
      CONTINUE;
    END IF;

    INSERT INTO plugin_data.csf_sheet_import_rows (
      organization_id, job_id, source_id, cohort_id, term_id, sheet_tab_name, row_number,
      source_range, raw_data, normalized_data, row_hash, matched_profile_id,
      matched_application_id, import_status, errors, warnings, retry_of_row_id,
      source_modified_at, mapping_version
    ) VALUES (
      -- Tenant, job, source and mapping version all come from the locked job.
      p_organization_id, p_preview_job_id, v_job.source_id,
      nullif(v_row->>'cohort_id', '')::uuid,
      nullif(v_row->>'term_id', '')::uuid,
      v_tab,
      v_number,
      nullif(v_row->>'source_range', ''),
      coalesce(v_raw, '{}'::jsonb),
      v_normalized,
      v_digest,
      nullif(v_row->>'matched_profile_id', '')::uuid,
      nullif(v_row->>'matched_application_id', '')::uuid,
      v_status,
      coalesce(
        (SELECT array_agg(value::text) FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(v_row -> 'errors') = 'array' THEN v_row -> 'errors' ELSE '[]'::jsonb END
        ) AS value),
        ARRAY[]::text[]
      ),
      coalesce(
        (SELECT array_agg(value::text) FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(v_row -> 'warnings') = 'array' THEN v_row -> 'warnings' ELSE '[]'::jsonb END
        ) AS value),
        ARRAY[]::text[]
      ),
      nullif(v_row->>'retry_of_row_id', '')::uuid,
      nullif(v_row->>'source_modified_at', '')::timestamptz,
      v_job.mapping_version
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'previewJobId', p_preview_job_id,
    'inserted', v_inserted,
    'replayed', v_replayed
  );
END;
$function$

;

REVOKE ALL ON FUNCTION plugin_data.csf_normalized_record_schema(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_derive_row_commit_payload(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_append_import_preview_rows(uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_append_import_preview_rows(uuid, uuid, uuid, jsonb)
  TO service_role;
