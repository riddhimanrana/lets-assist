-- Make reusable cohort-link creation and activation one tenant-scoped,
-- replay-safe transaction. The operation accepts exact existing record IDs;
-- it never creates a class, semester, or class-semester association as a
-- side effect of sharing a link.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS csf_admin_audit_events_onboarding_link_request_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id)
  WHERE action IN (
    'onboarding_link.create',
    'onboarding_link.activate',
    'onboarding_link.deactivate'
  );

CREATE OR REPLACE FUNCTION plugin_data.csf_mutate_onboarding_link(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_request jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.now();
  v_operation text;
  v_expected_action text;
  v_link_id uuid;
  v_cohort_id uuid;
  v_term_id uuid;
  v_is_active boolean;
  v_title text;
  v_link_type text;
  v_google_form_url text;
  v_landing_message text;
  v_requested_code text;
  v_code text;
  v_request_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_link plugin_data.csf_onboarding_links%ROWTYPE;
  v_cohort plugin_data.csf_cohorts%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_cohort_term plugin_data.csf_cohort_terms%ROWTYPE;
  v_before jsonb;
  v_result jsonb;
BEGIN
  IF p_organization_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Organization and actor are required to manage a class invitation.';
  END IF;
  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    'manage_profiles'
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF class invitations.';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable class-invitation request identifier is required.';
  END IF;
  IF pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'The class-invitation request must be an object.';
  END IF;

  v_operation := NULLIF(pg_catalog.btrim(p_request ->> 'operation'), '');
  IF v_operation IS NULL OR v_operation NOT IN ('create', 'set_active') THEN
    RAISE EXCEPTION 'Choose a supported class-invitation operation.';
  END IF;

  BEGIN
    v_link_id := NULLIF(p_request ->> 'linkId', '')::uuid;
    v_cohort_id := NULLIF(p_request ->> 'cohortId', '')::uuid;
    v_term_id := NULLIF(p_request ->> 'termId', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Choose valid class-invitation, class, and semester records.';
  END;

  IF v_operation = 'create' THEN
    v_expected_action := 'onboarding_link.create';
    IF v_cohort_id IS NULL OR v_term_id IS NULL THEN
      RAISE EXCEPTION 'Choose an existing class and semester for this invitation.';
    END IF;

    v_title := NULLIF(pg_catalog.btrim(p_request ->> 'title'), '');
    v_link_type := coalesce(NULLIF(pg_catalog.btrim(p_request ->> 'linkType'), ''), 'combined');
    v_google_form_url := NULLIF(pg_catalog.btrim(p_request ->> 'googleFormUrl'), '');
    v_landing_message := NULLIF(pg_catalog.btrim(p_request ->> 'landingMessage'), '');
    v_requested_code := NULLIF(pg_catalog.lower(pg_catalog.btrim(p_request ->> 'code')), '');

    IF v_link_type NOT IN ('profile_connect', 'application_google_form', 'combined') THEN
      RAISE EXCEPTION 'Choose a valid class-invitation type.';
    END IF;
    IF pg_catalog.length(coalesce(v_title, '')) > 200 THEN
      RAISE EXCEPTION 'Keep the class-invitation name at 200 characters or fewer.';
    END IF;
    IF pg_catalog.length(coalesce(v_landing_message, '')) > 4000 THEN
      RAISE EXCEPTION 'Keep the student note at 4,000 characters or fewer.';
    END IF;
    IF v_google_form_url IS NOT NULL AND (
      pg_catalog.length(v_google_form_url) > 2048
      OR v_google_form_url !~* '^https://[^[:space:]]+$'
    ) THEN
      RAISE EXCEPTION 'Enter a valid HTTPS application-form URL.';
    END IF;
    IF v_requested_code IS NOT NULL AND (
      pg_catalog.length(v_requested_code) > 120
      OR v_requested_code !~ '^[a-z0-9][a-z0-9_-]*$'
    ) THEN
      RAISE EXCEPTION 'Use only lowercase letters, numbers, underscores, or hyphens in the class-invitation code.';
    END IF;
  ELSE
    IF v_link_id IS NULL THEN
      RAISE EXCEPTION 'Choose an existing class invitation.';
    END IF;
    IF NOT (p_request ? 'isActive')
      OR pg_catalog.jsonb_typeof(p_request -> 'isActive') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'Choose whether the class invitation should be active.';
    END IF;
    v_is_active := (p_request ->> 'isActive')::boolean;
    v_expected_action := CASE
      WHEN v_is_active THEN 'onboarding_link.activate'
      ELSE 'onboarding_link.deactivate'
    END;
  END IF;

  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'operation', v_operation,
          'linkId', v_link_id,
          'cohortId', v_cohort_id,
          'termId', v_term_id,
          'isActive', v_is_active,
          'title', v_title,
          'linkType', v_link_type,
          'googleFormUrl', v_google_form_url,
          'landingMessage', v_landing_message,
          'code', v_requested_code
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Every operation starts with the same tenant lock. It protects both the
  -- request receipt and deterministic tenant-local invitation-code creation.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_mutate_onboarding_link:' || p_organization_id::text,
      0
    )
  );

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.action IN (
      'onboarding_link.create',
      'onboarding_link.activate',
      'onboarding_link.deactivate'
    )
  LIMIT 1;

  IF FOUND THEN
    IF v_receipt.action <> v_expected_action
      OR v_receipt.after_data ->> 'actorUserId' IS DISTINCT FROM p_actor_user_id::text
      OR v_receipt.after_data ->> 'requestFingerprint' IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'This class-invitation request identifier is already bound to different content.';
    END IF;
    RETURN coalesce(v_receipt.after_data -> 'result', '{}'::jsonb)
      || pg_catalog.jsonb_build_object('idempotent', true);
  END IF;

  IF v_operation = 'create' THEN
    SELECT cohort.*
    INTO v_cohort
    FROM plugin_data.csf_cohorts AS cohort
    WHERE cohort.organization_id = p_organization_id
      AND cohort.id = v_cohort_id
      AND cohort.status = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected class was not found or is not active in this organization.';
    END IF;

    SELECT term.*
    INTO v_term
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id
      AND term.id = v_term_id
      AND term.lifecycle_status IN ('planned', 'open')
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected semester was not found or cannot accept class invitations in this organization.';
    END IF;

    SELECT cohort_term.*
    INTO v_cohort_term
    FROM plugin_data.csf_cohort_terms AS cohort_term
    WHERE cohort_term.organization_id = p_organization_id
      AND cohort_term.cohort_id = v_cohort_id
      AND cohort_term.term_id = v_term_id
      AND cohort_term.status = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected class is not actively linked to this semester.';
    END IF;

    v_title := coalesce(v_title, v_cohort.label || ' · ' || coalesce(v_term.label, v_term.code));
    IF pg_catalog.length(v_title) > 200 THEN
      RAISE EXCEPTION 'Keep the class-invitation name at 200 characters or fewer.';
    END IF;
    v_code := coalesce(
      v_requested_code,
      pg_catalog.lower(
        v_cohort.graduation_year::text || '-' || v_term.code || '-'
        || pg_catalog.left(pg_catalog.replace(p_request_id::text, '-', ''), 8)
      )
    );

    IF EXISTS (
      SELECT 1
      FROM plugin_data.csf_onboarding_links AS existing_link
      WHERE existing_link.organization_id = p_organization_id
        AND existing_link.code = v_code
    ) THEN
      RAISE EXCEPTION 'That class-invitation code is already in use in this organization.';
    END IF;

    BEGIN
      INSERT INTO plugin_data.csf_onboarding_links (
        organization_id,
        term_id,
        cohort_id,
        code,
        title,
        link_type,
        google_form_url,
        landing_message,
        is_active,
        created_by,
        invitation_scope,
        delivery_status,
        created_at,
        updated_at
      ) VALUES (
        p_organization_id,
        v_term_id,
        v_cohort_id,
        v_code,
        v_title,
        v_link_type,
        v_google_form_url,
        v_landing_message,
        true,
        p_actor_user_id,
        'cohort',
        'link_ready',
        v_now,
        v_now
      )
      RETURNING * INTO v_link;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'That class-invitation code is already in use in this organization.';
    END;

    v_result := pg_catalog.jsonb_build_object(
      'linkId', v_link.id,
      'code', v_link.code,
      'cohortId', v_link.cohort_id,
      'termId', v_link.term_id,
      'isActive', v_link.is_active,
      'requestId', p_request_id,
      'idempotent', false
    );
    v_before := NULL;
  ELSE
    SELECT link.*
    INTO v_link
    FROM plugin_data.csf_onboarding_links AS link
    WHERE link.organization_id = p_organization_id
      AND link.id = v_link_id
      AND link.invitation_scope = 'cohort'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The class invitation was not found in this organization.';
    END IF;

    v_cohort_id := v_link.cohort_id;
    v_term_id := v_link.term_id;
    IF v_is_active THEN
      IF v_cohort_id IS NULL THEN
        RAISE EXCEPTION 'The class invitation is missing its graduating class and cannot be reactivated.';
      END IF;

      SELECT cohort.*
      INTO v_cohort
      FROM plugin_data.csf_cohorts AS cohort
      WHERE cohort.organization_id = p_organization_id
        AND cohort.id = v_cohort_id
        AND cohort.status = 'active'
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'The class invitation cannot be reactivated because its class is missing or inactive.';
      END IF;

      SELECT term.*
      INTO v_term
      FROM plugin_data.csf_terms AS term
      WHERE term.organization_id = p_organization_id
        AND term.id = v_term_id
        AND term.lifecycle_status IN ('planned', 'open')
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'The class invitation cannot be reactivated because its semester is missing or closed.';
      END IF;

      SELECT cohort_term.*
      INTO v_cohort_term
      FROM plugin_data.csf_cohort_terms AS cohort_term
      WHERE cohort_term.organization_id = p_organization_id
        AND cohort_term.cohort_id = v_cohort_id
        AND cohort_term.term_id = v_term_id
        AND cohort_term.status = 'active'
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'The class invitation cannot be reactivated because its class-semester link is not active.';
      END IF;
    END IF;

    v_before := pg_catalog.jsonb_build_object(
      'isActive', v_link.is_active,
      'title', v_link.title,
      'code', v_link.code
    );
    UPDATE plugin_data.csf_onboarding_links
    SET
      is_active = v_is_active,
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND id = v_link_id
    RETURNING * INTO v_link;

    v_result := pg_catalog.jsonb_build_object(
      'linkId', v_link.id,
      'code', v_link.code,
      'cohortId', v_link.cohort_id,
      'termId', v_link.term_id,
      'isActive', v_link.is_active,
      'requestId', p_request_id,
      'idempotent', false
    );
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    v_expected_action,
    'csf_onboarding_links',
    v_link.id,
    v_link.term_id,
    v_before,
    pg_catalog.jsonb_build_object(
      'actorUserId', p_actor_user_id,
      'requestFingerprint', v_request_fingerprint,
      'link', pg_catalog.jsonb_build_object(
        'id', v_link.id,
        'code', v_link.code,
        'title', v_link.title,
        'cohortId', v_link.cohort_id,
        'termId', v_link.term_id,
        'isActive', v_link.is_active
      ),
      'result', v_result
    ),
    p_request_id,
    'staff_onboarding_link',
    p_request_id::text,
    CASE v_expected_action
      WHEN 'onboarding_link.create' THEN 'class_invitation_created'
      WHEN 'onboarding_link.activate' THEN 'class_invitation_activated'
      ELSE 'class_invitation_deactivated'
    END
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_mutate_onboarding_link(uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_mutate_onboarding_link(uuid, uuid, uuid, jsonb)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_mutate_onboarding_link(uuid, uuid, uuid, jsonb) IS
  'Service-only, permission-checked, replay-safe reusable class-link create/activate/deactivate operation that resolves only existing tenant classes, semesters, and active class-semester links and commits its immutable audit receipt atomically.';

COMMIT;
