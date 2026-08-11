-- Make explicit CSF class/semester setup and maintenance transactional. These
-- service-only RPCs recheck the human actor from database truth, serialize one
-- organization's class/semester writes, reject missing or cross-tenant
-- targets, bind replay to a stable request UUID, and write the immutable audit
-- receipt in the same transaction as the authoritative rows.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_create_cohort_with_terms(
  p_organization_id uuid,
  p_request_id uuid,
  p_request jsonb,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing_audit plugin_data.csf_admin_audit_events%ROWTYPE;
  v_existing_cohort plugin_data.csf_cohorts%ROWTYPE;
  v_cohort plugin_data.csf_cohorts%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_request jsonb;
  v_graduation_year integer;
  v_label text;
  v_status text;
  v_index integer;
  v_source_year integer;
  v_calendar_year integer;
  v_grade_level integer;
  v_semester text;
  v_code text;
  v_term_label text;
  v_school_year text;
  v_starts_at date;
  v_ends_at date;
  v_term_codes jsonb := '[]'::jsonb;
  v_term_ids jsonb := '[]'::jsonb;
  v_created_term_count integer := 0;
  v_now timestamptz := now();
BEGIN
  IF p_actor_user_id IS NULL
    OR NOT plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_cohorts_terms'
    ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF classes and semesters.';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A class setup request identifier is required.';
  END IF;
  IF jsonb_typeof(p_request) <> 'object' THEN
    RAISE EXCEPTION 'Class setup payload must be an object.';
  END IF;
  IF coalesce(p_request ->> 'graduationYear', '') !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'Enter a valid graduation year.';
  END IF;

  v_graduation_year := (p_request ->> 'graduationYear')::integer;
  v_label := coalesce(
    nullif(btrim(coalesce(p_request ->> 'label', '')), ''),
    'Class of ' || v_graduation_year::text
  );
  v_status := coalesce(nullif(p_request ->> 'status', ''), 'active');
  IF v_graduation_year < 2000 OR v_graduation_year > 2100 THEN
    RAISE EXCEPTION 'Enter a graduation year between 2000 and 2100.';
  END IF;
  IF length(v_label) > 200 THEN
    RAISE EXCEPTION 'Keep the class name under 200 characters.';
  END IF;
  IF v_status NOT IN ('active', 'inactive', 'archived') THEN
    RAISE EXCEPTION 'Choose a valid class status.';
  END IF;

  v_request := jsonb_build_object(
    'graduationYear', v_graduation_year,
    'label', v_label,
    'status', v_status
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_class_term_management:' || p_organization_id::text,
      0
    )
  );

  SELECT audit.*
  INTO v_existing_audit
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
  ORDER BY audit.created_at, audit.id
  LIMIT 1;
  IF FOUND THEN
    IF v_existing_audit.action IS DISTINCT FROM 'cohort.create_with_terms'
      OR v_existing_audit.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_existing_audit.target_type IS DISTINCT FROM 'csf_cohorts'
      OR (v_existing_audit.after_data -> 'request') IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'That class setup request identifier is already bound to a different change.';
    END IF;
    RETURN jsonb_build_object(
      'cohortId', v_existing_audit.target_id,
      'generatedTermCount', coalesce((v_existing_audit.after_data ->> 'generatedTermCount')::integer, 0),
      'createdTermCount', coalesce((v_existing_audit.after_data ->> 'createdTermCount')::integer, 0),
      'correlationId', p_request_id,
      'idempotent', true
    );
  END IF;

  SELECT cohort.*
  INTO v_existing_cohort
  FROM plugin_data.csf_cohorts AS cohort
  WHERE cohort.organization_id = p_organization_id
    AND cohort.graduation_year = v_graduation_year
  FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'That graduating class already exists; open it instead of creating it again.';
  END IF;

  INSERT INTO plugin_data.csf_cohorts (
    organization_id,
    graduation_year,
    label,
    status,
    updated_at
  ) VALUES (
    p_organization_id,
    v_graduation_year,
    v_label,
    v_status,
    v_now
  )
  RETURNING * INTO v_cohort;

  FOR v_index IN 1..8 LOOP
    CASE v_index
      WHEN 1 THEN v_source_year := v_graduation_year - 4; v_semester := 'fall'; v_grade_level := 9;
      WHEN 2 THEN v_source_year := v_graduation_year - 3; v_semester := 'spring'; v_grade_level := 9;
      WHEN 3 THEN v_source_year := v_graduation_year - 3; v_semester := 'fall'; v_grade_level := 10;
      WHEN 4 THEN v_source_year := v_graduation_year - 2; v_semester := 'spring'; v_grade_level := 10;
      WHEN 5 THEN v_source_year := v_graduation_year - 2; v_semester := 'fall'; v_grade_level := 11;
      WHEN 6 THEN v_source_year := v_graduation_year - 1; v_semester := 'spring'; v_grade_level := 11;
      WHEN 7 THEN v_source_year := v_graduation_year - 1; v_semester := 'fall'; v_grade_level := 12;
      ELSE v_source_year := v_graduation_year; v_semester := 'spring'; v_grade_level := 12;
    END CASE;

    -- Match the established TypeScript term-code contract: two-digit years
    -- are interpreted in the 2000s.
    v_calendar_year := 2000 + mod(v_source_year, 100);
    v_code := CASE WHEN v_semester = 'fall' THEN 'F' ELSE 'S' END
      || pg_catalog.lpad(mod(v_calendar_year, 100)::text, 2, '0');
    v_term_label := CASE WHEN v_semester = 'fall' THEN 'Fall ' ELSE 'Spring ' END
      || v_calendar_year::text;
    v_school_year := CASE
      WHEN v_semester = 'fall'
        THEN v_calendar_year::text || '-' || (v_calendar_year + 1)::text
      ELSE (v_calendar_year - 1)::text || '-' || v_calendar_year::text
    END;
    v_starts_at := CASE
      WHEN v_semester = 'fall' THEN pg_catalog.make_date(v_calendar_year, 7, 1)
      ELSE pg_catalog.make_date(v_calendar_year, 1, 1)
    END;
    v_ends_at := CASE
      WHEN v_semester = 'fall' THEN pg_catalog.make_date(v_calendar_year, 12, 31)
      ELSE pg_catalog.make_date(v_calendar_year, 6, 30)
    END;

    SELECT term.*
    INTO v_term
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id
      AND term.code = v_code
    FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO plugin_data.csf_terms (
        organization_id,
        code,
        label,
        school_year,
        semester,
        starts_at,
        ends_at,
        updated_at
      ) VALUES (
        p_organization_id,
        v_code,
        v_term_label,
        v_school_year,
        v_semester,
        v_starts_at,
        v_ends_at,
        v_now
      )
      RETURNING * INTO v_term;
      v_created_term_count := v_created_term_count + 1;
    ELSIF v_term.school_year IS DISTINCT FROM v_school_year
      OR v_term.semester IS DISTINCT FROM v_semester THEN
      RAISE EXCEPTION 'Existing semester % has conflicting academic identity.', v_code;
    END IF;

    INSERT INTO plugin_data.csf_cohort_terms (
      organization_id,
      cohort_id,
      term_id,
      grade_level,
      sheet_tab_name,
      status,
      updated_at
    ) VALUES (
      p_organization_id,
      v_cohort.id,
      v_term.id,
      v_grade_level,
      v_code,
      'active',
      v_now
    );

    v_term_codes := v_term_codes || jsonb_build_array(v_code);
    v_term_ids := v_term_ids || jsonb_build_array(v_term.id);
  END LOOP;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    before_data,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'cohort.create_with_terms',
    'csf_cohorts',
    v_cohort.id,
    NULL,
    jsonb_build_object(
      'request', v_request,
      'cohortId', v_cohort.id,
      'generatedTermCount', 8,
      'createdTermCount', v_created_term_count,
      'termCodes', v_term_codes,
      'termIds', v_term_ids
    ),
    p_request_id,
    'staff_action',
    v_cohort.id::text,
    'cohort_created_with_terms'
  );

  RETURN jsonb_build_object(
    'cohortId', v_cohort.id,
    'generatedTermCount', 8,
    'createdTermCount', v_created_term_count,
    'correlationId', p_request_id,
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_create_term_for_cohort(
  p_organization_id uuid,
  p_request_id uuid,
  p_request jsonb,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing_audit plugin_data.csf_admin_audit_events%ROWTYPE;
  v_cohort plugin_data.csf_cohorts%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_existing_link plugin_data.csf_cohort_terms%ROWTYPE;
  v_link plugin_data.csf_cohort_terms%ROWTYPE;
  v_request jsonb;
  v_cohort_year integer;
  v_code text;
  v_label text;
  v_semester text;
  v_school_year text;
  v_starts_at date;
  v_ends_at date;
  v_application_opens_at timestamptz;
  v_application_closes_at timestamptz;
  v_sheet_tab_name text;
  v_is_current boolean;
  v_calendar_year integer;
  v_expected_semester text;
  v_expected_school_year text;
  v_grade_level integer;
  v_previous_current_term_id uuid;
  v_term_created boolean := false;
  v_now timestamptz := now();
BEGIN
  IF p_actor_user_id IS NULL
    OR NOT plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_cohorts_terms'
    ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF classes and semesters.';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A semester setup request identifier is required.';
  END IF;
  IF jsonb_typeof(p_request) <> 'object' THEN
    RAISE EXCEPTION 'Semester setup payload must be an object.';
  END IF;
  IF coalesce(p_request ->> 'cohortYear', '') !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'Choose a valid graduating class.';
  END IF;

  v_cohort_year := (p_request ->> 'cohortYear')::integer;
  v_code := upper(btrim(coalesce(p_request ->> 'termCode', '')));
  v_label := nullif(btrim(coalesce(p_request ->> 'label', '')), '');
  v_semester := lower(btrim(coalesce(p_request ->> 'semester', '')));
  v_school_year := btrim(coalesce(p_request ->> 'schoolYear', ''));
  v_starts_at := nullif(p_request ->> 'startsAt', '')::date;
  v_ends_at := nullif(p_request ->> 'endsAt', '')::date;
  v_application_opens_at := nullif(p_request ->> 'applicationOpensAt', '')::timestamptz;
  v_application_closes_at := nullif(p_request ->> 'applicationClosesAt', '')::timestamptz;
  v_sheet_tab_name := coalesce(
    nullif(btrim(coalesce(p_request ->> 'sheetTabName', '')), ''),
    v_code
  );
  v_is_current := coalesce((p_request ->> 'isCurrent')::boolean, false);

  IF v_cohort_year < 2000 OR v_cohort_year > 2100 THEN
    RAISE EXCEPTION 'Choose a valid graduating class.';
  END IF;
  IF v_code !~ '^[FS][0-9]{2}$' THEN
    RAISE EXCEPTION 'Choose a valid FYY or SYY semester code.';
  END IF;
  IF v_label IS NULL OR length(v_label) > 200 THEN
    RAISE EXCEPTION 'Enter a semester name between 1 and 200 characters.';
  END IF;
  IF v_starts_at IS NULL OR v_ends_at IS NULL OR v_ends_at < v_starts_at THEN
    RAISE EXCEPTION 'Semester dates must include a valid start and end window.';
  END IF;
  IF v_application_opens_at IS NOT NULL
    AND v_application_closes_at IS NOT NULL
    AND v_application_closes_at < v_application_opens_at THEN
    RAISE EXCEPTION 'Application closing time cannot be before its opening time.';
  END IF;

  v_calendar_year := 2000 + substring(v_code FROM 2 FOR 2)::integer;
  v_expected_semester := CASE WHEN left(v_code, 1) = 'F' THEN 'fall' ELSE 'spring' END;
  v_expected_school_year := CASE
    WHEN v_expected_semester = 'fall'
      THEN v_calendar_year::text || '-' || (v_calendar_year + 1)::text
    ELSE (v_calendar_year - 1)::text || '-' || v_calendar_year::text
  END;
  IF v_semester IS DISTINCT FROM v_expected_semester
    OR v_school_year IS DISTINCT FROM v_expected_school_year THEN
    RAISE EXCEPTION 'Semester code, season, and school year do not agree.';
  END IF;

  v_grade_level := CASE
    WHEN v_semester = 'fall' THEN 13 - (v_cohort_year - v_calendar_year)
    ELSE 12 - (v_cohort_year - v_calendar_year)
  END;
  IF v_grade_level NOT BETWEEN 9 AND 12 THEN
    v_grade_level := NULL;
  END IF;

  v_request := jsonb_build_object(
    'cohortYear', v_cohort_year,
    'termCode', v_code,
    'label', v_label,
    'semester', v_semester,
    'schoolYear', v_school_year,
    'startsAt', v_starts_at,
    'endsAt', v_ends_at,
    'applicationOpensAt', v_application_opens_at,
    'applicationClosesAt', v_application_closes_at,
    'sheetTabName', v_sheet_tab_name,
    'isCurrent', v_is_current
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_class_term_management:' || p_organization_id::text,
      0
    )
  );
  IF v_is_current THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'plugin_data.csf_set_current_term:' || p_organization_id::text,
        0
      )
    );
  END IF;

  SELECT audit.*
  INTO v_existing_audit
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
  ORDER BY audit.created_at, audit.id
  LIMIT 1;
  IF FOUND THEN
    IF v_existing_audit.action IS DISTINCT FROM 'term.create_for_cohort'
      OR v_existing_audit.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_existing_audit.target_type IS DISTINCT FROM 'csf_terms'
      OR (v_existing_audit.after_data -> 'request') IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'That semester setup request identifier is already bound to a different change.';
    END IF;
    RETURN jsonb_build_object(
      'termId', v_existing_audit.target_id,
      'cohortTermId', v_existing_audit.after_data ->> 'cohortTermId',
      'termCreated', coalesce((v_existing_audit.after_data ->> 'termCreated')::boolean, false),
      'correlationId', p_request_id,
      'idempotent', true
    );
  END IF;

  SELECT cohort.*
  INTO v_cohort
  FROM plugin_data.csf_cohorts AS cohort
  WHERE cohort.organization_id = p_organization_id
    AND cohort.graduation_year = v_cohort_year
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Graduating class was not found in this organization; create the class first.';
  END IF;
  IF v_cohort.status = 'archived' THEN
    RAISE EXCEPTION 'Archived classes cannot receive new semesters.';
  END IF;

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.code = v_code
  FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO plugin_data.csf_terms (
      organization_id,
      code,
      label,
      school_year,
      semester,
      starts_at,
      ends_at,
      application_opens_at,
      application_closes_at,
      updated_at
    ) VALUES (
      p_organization_id,
      v_code,
      v_label,
      v_school_year,
      v_semester,
      v_starts_at,
      v_ends_at,
      v_application_opens_at,
      v_application_closes_at,
      v_now
    )
    RETURNING * INTO v_term;
    v_term_created := true;
  ELSIF v_term.label IS DISTINCT FROM v_label
    OR v_term.school_year IS DISTINCT FROM v_school_year
    OR v_term.semester IS DISTINCT FROM v_semester
    OR v_term.starts_at IS DISTINCT FROM v_starts_at
    OR v_term.ends_at IS DISTINCT FROM v_ends_at
    OR v_term.application_opens_at IS DISTINCT FROM v_application_opens_at
    OR v_term.application_closes_at IS DISTINCT FROM v_application_closes_at THEN
    RAISE EXCEPTION 'That semester already exists with different details; use Edit semester instead.';
  END IF;

  SELECT link.*
  INTO v_existing_link
  FROM plugin_data.csf_cohort_terms AS link
  WHERE link.organization_id = p_organization_id
    AND link.cohort_id = v_cohort.id
    AND link.term_id = v_term.id
  FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'That semester is already linked to this graduating class.';
  END IF;

  INSERT INTO plugin_data.csf_cohort_terms (
    organization_id,
    cohort_id,
    term_id,
    grade_level,
    sheet_tab_name,
    status,
    updated_at
  ) VALUES (
    p_organization_id,
    v_cohort.id,
    v_term.id,
    v_grade_level,
    v_sheet_tab_name,
    'active',
    v_now
  )
  RETURNING * INTO v_link;

  IF v_is_current THEN
    SELECT term.id
    INTO v_previous_current_term_id
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id
      AND term.is_current = true
    ORDER BY term.id
    LIMIT 1
    FOR UPDATE;

    IF v_term.lifecycle_status IN ('closed', 'archived') THEN
      RAISE EXCEPTION 'Closed or archived CSF semesters cannot become current.';
    END IF;

    UPDATE plugin_data.csf_terms
    SET is_current = false,
        updated_at = v_now
    WHERE organization_id = p_organization_id
      AND is_current = true
      AND id <> v_term.id;

    UPDATE plugin_data.csf_terms
    SET is_current = true,
        updated_at = v_now
    WHERE organization_id = p_organization_id
      AND id = v_term.id
    RETURNING * INTO v_term;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Semester disappeared before it could become current.';
    END IF;
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
    'term.create_for_cohort',
    'csf_terms',
    v_term.id,
    v_term.id,
    jsonb_build_object(
      'request', v_request,
      'termId', v_term.id,
      'cohortId', v_cohort.id,
      'cohortTermId', v_link.id,
      'termCreated', v_term_created,
      'previousCurrentTermId', v_previous_current_term_id,
      'isCurrent', v_term.is_current
    ),
    p_request_id,
    'staff_action',
    v_link.id::text,
    'term_created_for_cohort'
  );

  RETURN jsonb_build_object(
    'termId', v_term.id,
    'cohortTermId', v_link.id,
    'termCreated', v_term_created,
    'correlationId', p_request_id,
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_update_cohort(
  p_organization_id uuid,
  p_request_id uuid,
  p_request jsonb,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing_audit plugin_data.csf_admin_audit_events%ROWTYPE;
  v_before plugin_data.csf_cohorts%ROWTYPE;
  v_after plugin_data.csf_cohorts%ROWTYPE;
  v_request jsonb;
  v_cohort_id uuid;
  v_label text;
  v_status text;
  v_now timestamptz := now();
BEGIN
  IF p_actor_user_id IS NULL
    OR NOT plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_cohorts_terms') THEN
    RAISE EXCEPTION 'Not authorized to manage CSF classes and semesters.';
  END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'A class edit request identifier is required.'; END IF;
  IF jsonb_typeof(p_request) <> 'object' THEN RAISE EXCEPTION 'Class edit payload must be an object.'; END IF;

  v_cohort_id := nullif(p_request ->> 'cohortId', '')::uuid;
  v_label := nullif(btrim(coalesce(p_request ->> 'label', '')), '');
  v_status := coalesce(nullif(p_request ->> 'status', ''), 'active');
  IF v_cohort_id IS NULL THEN RAISE EXCEPTION 'Class is required.'; END IF;
  IF v_label IS NULL OR length(v_label) > 200 THEN RAISE EXCEPTION 'Enter a class name between 1 and 200 characters.'; END IF;
  IF v_status NOT IN ('active', 'inactive', 'archived') THEN RAISE EXCEPTION 'Choose a valid class status.'; END IF;

  v_request := jsonb_build_object('cohortId', v_cohort_id, 'label', v_label, 'status', v_status);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('plugin_data.csf_class_term_management:' || p_organization_id::text, 0));

  SELECT audit.* INTO v_existing_audit
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id AND audit.correlation_id = p_request_id
  ORDER BY audit.created_at, audit.id LIMIT 1;
  IF FOUND THEN
    IF v_existing_audit.action IS DISTINCT FROM 'cohort.edit'
      OR v_existing_audit.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_existing_audit.target_type IS DISTINCT FROM 'csf_cohorts'
      OR v_existing_audit.target_id IS DISTINCT FROM v_cohort_id
      OR (v_existing_audit.after_data -> 'request') IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'That class edit request identifier is already bound to a different change.';
    END IF;
    RETURN jsonb_build_object('cohortId', v_cohort_id, 'correlationId', p_request_id, 'idempotent', true);
  END IF;

  SELECT cohort.* INTO v_before
  FROM plugin_data.csf_cohorts AS cohort
  WHERE cohort.organization_id = p_organization_id AND cohort.id = v_cohort_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Class was not found in this organization.'; END IF;

  UPDATE plugin_data.csf_cohorts
  SET label = v_label, status = v_status, updated_at = v_now
  WHERE organization_id = p_organization_id AND id = v_cohort_id
  RETURNING * INTO v_after;
  IF NOT FOUND THEN RAISE EXCEPTION 'Class disappeared before the edit could be saved.'; END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'cohort.edit', 'csf_cohorts', v_after.id,
    jsonb_build_object('label', v_before.label, 'status', v_before.status),
    jsonb_build_object('request', v_request, 'label', v_after.label, 'status', v_after.status),
    p_request_id, 'staff_action', v_after.id::text, 'cohort_edited'
  );

  RETURN jsonb_build_object('cohortId', v_after.id, 'correlationId', p_request_id, 'idempotent', false);
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_set_cohort_status(
  p_organization_id uuid,
  p_request_id uuid,
  p_request jsonb,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing_audit plugin_data.csf_admin_audit_events%ROWTYPE;
  v_before plugin_data.csf_cohorts%ROWTYPE;
  v_after plugin_data.csf_cohorts%ROWTYPE;
  v_request jsonb;
  v_cohort_id uuid;
  v_status text;
  v_action text;
  v_now timestamptz := now();
BEGIN
  IF p_actor_user_id IS NULL
    OR NOT plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_cohorts_terms') THEN
    RAISE EXCEPTION 'Not authorized to manage CSF classes and semesters.';
  END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'A class status request identifier is required.'; END IF;
  IF jsonb_typeof(p_request) <> 'object' THEN RAISE EXCEPTION 'Class status payload must be an object.'; END IF;

  v_cohort_id := nullif(p_request ->> 'cohortId', '')::uuid;
  v_status := coalesce(nullif(p_request ->> 'status', ''), 'archived');
  IF v_cohort_id IS NULL THEN RAISE EXCEPTION 'Class is required.'; END IF;
  IF v_status NOT IN ('active', 'inactive', 'archived') THEN RAISE EXCEPTION 'Choose a valid class status.'; END IF;
  v_action := CASE WHEN v_status = 'archived' THEN 'cohort.archive' ELSE 'cohort.status_update' END;
  v_request := jsonb_build_object('cohortId', v_cohort_id, 'status', v_status);

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('plugin_data.csf_class_term_management:' || p_organization_id::text, 0));
  SELECT audit.* INTO v_existing_audit
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id AND audit.correlation_id = p_request_id
  ORDER BY audit.created_at, audit.id LIMIT 1;
  IF FOUND THEN
    IF v_existing_audit.action IS DISTINCT FROM v_action
      OR v_existing_audit.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_existing_audit.target_type IS DISTINCT FROM 'csf_cohorts'
      OR v_existing_audit.target_id IS DISTINCT FROM v_cohort_id
      OR (v_existing_audit.after_data -> 'request') IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'That class status request identifier is already bound to a different change.';
    END IF;
    RETURN jsonb_build_object('cohortId', v_cohort_id, 'status', v_status, 'correlationId', p_request_id, 'idempotent', true);
  END IF;

  SELECT cohort.* INTO v_before
  FROM plugin_data.csf_cohorts AS cohort
  WHERE cohort.organization_id = p_organization_id AND cohort.id = v_cohort_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Class was not found in this organization.'; END IF;
  IF v_before.status = v_status THEN RAISE EXCEPTION 'Class already has that status.'; END IF;

  UPDATE plugin_data.csf_cohorts
  SET status = v_status, updated_at = v_now
  WHERE organization_id = p_organization_id AND id = v_cohort_id
  RETURNING * INTO v_after;
  IF NOT FOUND THEN RAISE EXCEPTION 'Class disappeared before its status could be changed.'; END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, v_action, 'csf_cohorts', v_after.id,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object('request', v_request, 'status', v_after.status),
    p_request_id, 'staff_action', v_after.id::text,
    CASE WHEN v_status = 'archived' THEN 'cohort_archived' ELSE 'cohort_status_updated' END
  );

  RETURN jsonb_build_object('cohortId', v_after.id, 'status', v_after.status, 'correlationId', p_request_id, 'idempotent', false);
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_update_cohort_term(
  p_organization_id uuid,
  p_request_id uuid,
  p_request jsonb,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing_audit plugin_data.csf_admin_audit_events%ROWTYPE;
  v_term_before plugin_data.csf_terms%ROWTYPE;
  v_term_after plugin_data.csf_terms%ROWTYPE;
  v_link_before plugin_data.csf_cohort_terms%ROWTYPE;
  v_link_after plugin_data.csf_cohort_terms%ROWTYPE;
  v_request jsonb;
  v_term_id uuid;
  v_cohort_term_id uuid;
  v_label text;
  v_starts_at date;
  v_ends_at date;
  v_sheet_tab_name text;
  v_link_status text;
  v_now timestamptz := now();
BEGIN
  IF p_actor_user_id IS NULL
    OR NOT plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_cohorts_terms') THEN
    RAISE EXCEPTION 'Not authorized to manage CSF classes and semesters.';
  END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'A semester edit request identifier is required.'; END IF;
  IF jsonb_typeof(p_request) <> 'object' THEN RAISE EXCEPTION 'Semester edit payload must be an object.'; END IF;

  v_term_id := nullif(p_request ->> 'termId', '')::uuid;
  v_cohort_term_id := nullif(p_request ->> 'cohortTermId', '')::uuid;
  v_label := nullif(btrim(coalesce(p_request ->> 'label', '')), '');
  v_starts_at := nullif(p_request ->> 'startsAt', '')::date;
  v_ends_at := nullif(p_request ->> 'endsAt', '')::date;
  v_sheet_tab_name := nullif(btrim(coalesce(p_request ->> 'sheetTabName', '')), '');
  v_link_status := coalesce(nullif(p_request ->> 'linkStatus', ''), 'active');
  IF v_term_id IS NULL OR v_cohort_term_id IS NULL THEN RAISE EXCEPTION 'Semester and class-semester link are required.'; END IF;
  IF v_label IS NULL OR length(v_label) > 200 THEN RAISE EXCEPTION 'Enter a semester name between 1 and 200 characters.'; END IF;
  IF v_starts_at IS NULL OR v_ends_at IS NULL OR v_ends_at < v_starts_at THEN RAISE EXCEPTION 'Semester dates must include a valid start and end window.'; END IF;
  IF v_sheet_tab_name IS NULL OR length(v_sheet_tab_name) > 200 THEN RAISE EXCEPTION 'Enter a Sheet tab name between 1 and 200 characters.'; END IF;
  IF v_link_status NOT IN ('active', 'inactive', 'archived') THEN RAISE EXCEPTION 'Choose a valid class-semester status.'; END IF;

  v_request := jsonb_build_object(
    'termId', v_term_id,
    'cohortTermId', v_cohort_term_id,
    'label', v_label,
    'startsAt', v_starts_at,
    'endsAt', v_ends_at,
    'sheetTabName', v_sheet_tab_name,
    'linkStatus', v_link_status
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('plugin_data.csf_class_term_management:' || p_organization_id::text, 0));
  SELECT audit.* INTO v_existing_audit
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id AND audit.correlation_id = p_request_id
  ORDER BY audit.created_at, audit.id LIMIT 1;
  IF FOUND THEN
    IF v_existing_audit.action IS DISTINCT FROM 'term.edit'
      OR v_existing_audit.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_existing_audit.target_type IS DISTINCT FROM 'csf_terms'
      OR v_existing_audit.target_id IS DISTINCT FROM v_term_id
      OR v_existing_audit.term_id IS DISTINCT FROM v_term_id
      OR (v_existing_audit.after_data -> 'request') IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'That semester edit request identifier is already bound to a different change.';
    END IF;
    RETURN jsonb_build_object('termId', v_term_id, 'cohortTermId', v_cohort_term_id, 'correlationId', p_request_id, 'idempotent', true);
  END IF;

  SELECT term.* INTO v_term_before
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id AND term.id = v_term_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Semester was not found in this organization.'; END IF;
  IF v_term_before.lifecycle_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'Closed or archived CSF semesters cannot be edited.';
  END IF;

  SELECT link.* INTO v_link_before
  FROM plugin_data.csf_cohort_terms AS link
  WHERE link.organization_id = p_organization_id
    AND link.id = v_cohort_term_id
    AND link.term_id = v_term_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Class-semester link was not found in this organization.'; END IF;

  UPDATE plugin_data.csf_terms
  SET label = v_label, starts_at = v_starts_at, ends_at = v_ends_at, updated_at = v_now
  WHERE organization_id = p_organization_id AND id = v_term_id
  RETURNING * INTO v_term_after;
  IF NOT FOUND THEN RAISE EXCEPTION 'Semester disappeared before the edit could be saved.'; END IF;

  UPDATE plugin_data.csf_cohort_terms
  SET sheet_tab_name = v_sheet_tab_name, status = v_link_status, updated_at = v_now
  WHERE organization_id = p_organization_id AND id = v_cohort_term_id AND term_id = v_term_id
  RETURNING * INTO v_link_after;
  IF NOT FOUND THEN RAISE EXCEPTION 'Class-semester link disappeared before the edit could be saved.'; END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'term.edit', 'csf_terms', v_term_after.id, v_term_after.id,
    jsonb_build_object(
      'label', v_term_before.label, 'startsAt', v_term_before.starts_at, 'endsAt', v_term_before.ends_at,
      'cohortTermId', v_link_before.id, 'sheetTabName', v_link_before.sheet_tab_name, 'linkStatus', v_link_before.status
    ),
    jsonb_build_object(
      'request', v_request,
      'label', v_term_after.label, 'startsAt', v_term_after.starts_at, 'endsAt', v_term_after.ends_at,
      'cohortTermId', v_link_after.id, 'sheetTabName', v_link_after.sheet_tab_name, 'linkStatus', v_link_after.status
    ),
    p_request_id, 'staff_action', v_link_after.id::text, 'term_and_class_link_edited'
  );

  RETURN jsonb_build_object('termId', v_term_after.id, 'cohortTermId', v_link_after.id, 'correlationId', p_request_id, 'idempotent', false);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_create_cohort_with_terms(uuid, uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_cohort_with_terms(uuid, uuid, jsonb, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_create_term_for_cohort(uuid, uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_term_for_cohort(uuid, uuid, jsonb, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_update_cohort(uuid, uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_update_cohort(uuid, uuid, jsonb, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_set_cohort_status(uuid, uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_cohort_status(uuid, uuid, jsonb, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_update_cohort_term(uuid, uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_update_cohort_term(uuid, uuid, jsonb, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_create_cohort_with_terms(uuid, uuid, jsonb, uuid)
  IS 'Service-only, permission-checked, replay-safe graduating-class setup that atomically creates the class, eight explicit semester links, any missing shared semesters, and its immutable audit receipt.';
COMMENT ON FUNCTION plugin_data.csf_create_term_for_cohort(uuid, uuid, jsonb, uuid)
  IS 'Service-only, permission-checked, replay-safe exceptional semester setup that requires an existing class and atomically creates or reuses the exact semester, links it, optionally selects it current, and writes immutable audit history.';
COMMENT ON FUNCTION plugin_data.csf_update_cohort(uuid, uuid, jsonb, uuid)
  IS 'Service-only, permission-checked, replay-safe class edit with exact tenant scope and same-transaction immutable audit history.';
COMMENT ON FUNCTION plugin_data.csf_set_cohort_status(uuid, uuid, jsonb, uuid)
  IS 'Service-only, permission-checked, replay-safe class status transition with exact tenant scope and same-transaction immutable audit history.';
COMMENT ON FUNCTION plugin_data.csf_update_cohort_term(uuid, uuid, jsonb, uuid)
  IS 'Service-only, permission-checked, replay-safe atomic edit of one semester and its exact class-semester link with immutable audit history.';

COMMIT;
