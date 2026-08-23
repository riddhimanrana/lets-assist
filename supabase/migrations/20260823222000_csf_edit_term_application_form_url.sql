-- The semester edit RPC also carries the Google Forms application URL now
-- that plugin_data.csf_terms.application_form_url replaced the onboarding-link
-- application links (20260823211000). Body otherwise identical to
-- 20260811001500.
BEGIN;

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
  v_application_opens_at timestamptz;
  v_application_closes_at timestamptz;
  v_has_application_open boolean;
  v_has_application_close boolean;
  v_has_application_window boolean;
  v_sheet_tab_name text;
  v_link_status text;
  v_application_form_url text;
  v_has_application_form_url boolean;
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
  v_has_application_open := p_request ? 'applicationOpensAt';
  v_has_application_close := p_request ? 'applicationClosesAt';
  v_has_application_window := v_has_application_open OR v_has_application_close;
  v_application_opens_at := nullif(p_request ->> 'applicationOpensAt', '')::timestamptz;
  v_application_closes_at := nullif(p_request ->> 'applicationClosesAt', '')::timestamptz;
  v_sheet_tab_name := nullif(btrim(coalesce(p_request ->> 'sheetTabName', '')), '');
  v_has_application_form_url := p_request ? 'applicationFormUrl';
  v_application_form_url := nullif(btrim(coalesce(p_request ->> 'applicationFormUrl', '')), '');
  v_link_status := coalesce(nullif(p_request ->> 'linkStatus', ''), 'active');
  IF v_term_id IS NULL OR v_cohort_term_id IS NULL THEN RAISE EXCEPTION 'Semester and class-semester link are required.'; END IF;
  IF v_label IS NULL OR length(v_label) > 200 THEN RAISE EXCEPTION 'Enter a semester name between 1 and 200 characters.'; END IF;
  IF v_starts_at IS NULL OR v_ends_at IS NULL OR v_ends_at < v_starts_at THEN RAISE EXCEPTION 'Semester dates must include a valid start and end window.'; END IF;
  IF v_has_application_open IS DISTINCT FROM v_has_application_close THEN
    RAISE EXCEPTION 'Enter both application dates or omit both application date fields.';
  END IF;
  IF v_has_application_window
    AND ((v_application_opens_at IS NULL) IS DISTINCT FROM (v_application_closes_at IS NULL)) THEN
    RAISE EXCEPTION 'Enter both application dates or leave both blank.';
  END IF;
  IF v_application_opens_at IS NOT NULL
    AND v_application_closes_at < v_application_opens_at THEN
    RAISE EXCEPTION 'Application closing date cannot be before its opening date.';
  END IF;
  IF v_sheet_tab_name IS NULL OR length(v_sheet_tab_name) > 200 THEN RAISE EXCEPTION 'Enter a Sheet tab name between 1 and 200 characters.'; END IF;
  IF v_link_status NOT IN ('active', 'inactive', 'archived') THEN RAISE EXCEPTION 'Choose a valid class-semester status.'; END IF;
  IF v_has_application_form_url
    AND v_application_form_url IS NOT NULL
    AND NOT (
      char_length(v_application_form_url) <= 2048
      AND (
        v_application_form_url ~ '^https://docs\.google\.com/forms/'
        OR v_application_form_url ~ '^https://forms\.gle/.'
      )
    ) THEN
    RAISE EXCEPTION 'The application form link must be a Google Forms URL.';
  END IF;

  v_request := jsonb_build_object(
    'termId', v_term_id,
    'cohortTermId', v_cohort_term_id,
    'label', v_label,
    'startsAt', v_starts_at,
    'endsAt', v_ends_at,
    'sheetTabName', v_sheet_tab_name,
    'linkStatus', v_link_status
  ) || CASE
    WHEN v_has_application_window THEN jsonb_build_object(
      'applicationOpensAt', v_application_opens_at,
      'applicationClosesAt', v_application_closes_at
    )
    ELSE '{}'::jsonb
  END || CASE
    WHEN v_has_application_form_url THEN jsonb_build_object(
      'applicationFormUrl', v_application_form_url
    )
    ELSE '{}'::jsonb
  END;

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
  SET
    label = v_label,
    starts_at = v_starts_at,
    ends_at = v_ends_at,
    application_opens_at = CASE
      WHEN v_has_application_window THEN v_application_opens_at
      ELSE application_opens_at
    END,
    application_closes_at = CASE
      WHEN v_has_application_window THEN v_application_closes_at
      ELSE application_closes_at
    END,
    application_form_url = CASE
      WHEN v_has_application_form_url THEN v_application_form_url
      ELSE application_form_url
    END,
    updated_at = v_now
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
      'label', v_term_before.label,
      'startsAt', v_term_before.starts_at,
      'endsAt', v_term_before.ends_at,
      'applicationOpensAt', v_term_before.application_opens_at,
      'applicationClosesAt', v_term_before.application_closes_at,
      'applicationFormUrl', v_term_before.application_form_url,
      'cohortTermId', v_link_before.id,
      'sheetTabName', v_link_before.sheet_tab_name,
      'linkStatus', v_link_before.status
    ),
    jsonb_build_object(
      'request', v_request,
      'label', v_term_after.label,
      'startsAt', v_term_after.starts_at,
      'endsAt', v_term_after.ends_at,
      'applicationOpensAt', v_term_after.application_opens_at,
      'applicationClosesAt', v_term_after.application_closes_at,
      'applicationFormUrl', v_term_after.application_form_url,
      'cohortTermId', v_link_after.id,
      'sheetTabName', v_link_after.sheet_tab_name,
      'linkStatus', v_link_after.status
    ),
    p_request_id, 'staff_action', v_link_after.id::text, 'term_and_class_link_edited'
  );

  RETURN jsonb_build_object('termId', v_term_after.id, 'cohortTermId', v_link_after.id, 'correlationId', p_request_id, 'idempotent', false);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_update_cohort_term(uuid, uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_update_cohort_term(uuid, uuid, jsonb, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_update_cohort_term(uuid, uuid, jsonb, uuid)
  IS 'Service-only, permission-checked, replay-safe atomic edit of one shared semester, its application window and form URL, and its exact class-semester link with immutable audit history.';

COMMIT;
