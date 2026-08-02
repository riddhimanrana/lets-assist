-- Make the staff member-profile dialog one tenant-scoped transaction. The
-- request UUID is also the immutable audit correlation, so a dropped browser
-- response can be replayed exactly without repeating any profile, class,
-- application, decision, membership, or history write.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS csf_admin_audit_events_profile_write_request_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id)
  WHERE action IN ('profile.create', 'profile.edit');

CREATE OR REPLACE FUNCTION plugin_data.csf_upsert_profile(
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
  v_profile_id uuid;
  v_cohort_id uuid;
  v_term_id uuid;
  v_cohort_term_id uuid;
  v_cohort_membership_id uuid;
  v_application_id uuid;
  v_first_name text;
  v_middle_name text;
  v_last_name text;
  v_preferred_name text;
  v_school_email text;
  v_personal_email text;
  v_normalized_first_name text;
  v_normalized_last_name text;
  v_normalized_school_email text;
  v_normalized_personal_email text;
  v_nicknames text[] := ARRAY[]::text[];
  v_requested_application_status text;
  v_seed_application_status text;
  v_request_fingerprint text;
  v_expected_action text;
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_profile_before jsonb;
  v_profile_after jsonb;
  v_previous_application_status text;
  v_term_lifecycle_status text;
  v_existing_term_membership_status text;
  v_existing_term_membership_cohort_id uuid;
  v_decision_result jsonb;
  v_result jsonb;
  v_application_was_found boolean := false;
BEGIN
  IF p_organization_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Organization and actor are required to save a CSF member.';
  END IF;
  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    'manage_profiles'
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF member profiles.';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable profile-save request identifier is required.';
  END IF;
  IF pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'The profile-save request must be an object.';
  END IF;

  BEGIN
    v_profile_id := NULLIF(p_request ->> 'profileId', '')::uuid;
    v_cohort_id := NULLIF(p_request ->> 'cohortId', '')::uuid;
    v_term_id := NULLIF(p_request ->> 'termId', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Choose valid CSF member, class, and semester records.';
  END;

  v_operation := CASE WHEN v_profile_id IS NULL THEN 'create' ELSE 'edit' END;
  v_expected_action := 'profile.' || v_operation;
  v_first_name := NULLIF(pg_catalog.btrim(p_request ->> 'firstName'), '');
  v_middle_name := NULLIF(pg_catalog.btrim(p_request ->> 'middleName'), '');
  v_last_name := NULLIF(pg_catalog.btrim(p_request ->> 'lastName'), '');
  v_preferred_name := NULLIF(pg_catalog.btrim(p_request ->> 'preferredName'), '');
  v_school_email := plugin_data.csf_normalize_email_text(p_request ->> 'schoolEmail');
  v_personal_email := plugin_data.csf_normalize_email_text(p_request ->> 'personalEmail');
  v_normalized_first_name := plugin_data.csf_normalize_identity_part(v_first_name);
  v_normalized_last_name := plugin_data.csf_normalize_identity_part(v_last_name);
  v_normalized_school_email := v_school_email;
  v_normalized_personal_email := v_personal_email;

  IF v_first_name IS NULL OR v_last_name IS NULL THEN
    RAISE EXCEPTION 'First and last name are required.';
  END IF;
  IF pg_catalog.length(v_first_name) > 200
    OR pg_catalog.length(v_last_name) > 200
    OR pg_catalog.length(coalesce(v_middle_name, '')) > 200
    OR pg_catalog.length(coalesce(v_preferred_name, '')) > 200 THEN
    RAISE EXCEPTION 'CSF member name fields must be 200 characters or fewer.';
  END IF;
  IF pg_catalog.length(coalesce(v_school_email, '')) > 320
    OR pg_catalog.length(coalesce(v_personal_email, '')) > 320 THEN
    RAISE EXCEPTION 'CSF member email fields must be 320 characters or fewer.';
  END IF;
  IF v_school_email IS NOT NULL AND pg_catalog.strpos(v_school_email, '@') = 0 THEN
    RAISE EXCEPTION 'Enter a valid school email address.';
  END IF;
  IF v_personal_email IS NOT NULL AND pg_catalog.strpos(v_personal_email, '@') = 0 THEN
    RAISE EXCEPTION 'Enter a valid personal email address.';
  END IF;
  IF v_school_email IS NOT NULL AND v_school_email = v_personal_email THEN
    RAISE EXCEPTION 'School and personal email must be different addresses.';
  END IF;

  IF p_request ? 'nicknames' THEN
    IF pg_catalog.jsonb_typeof(p_request -> 'nicknames') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Nicknames must be an array of text values.';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_request -> 'nicknames') AS nickname(value)
      WHERE pg_catalog.jsonb_typeof(nickname.value) <> 'string'
    ) THEN
      RAISE EXCEPTION 'Nicknames must be an array of text values.';
    END IF;
    SELECT coalesce(
      pg_catalog.array_agg(
        pg_catalog.btrim(nickname.value #>> '{}')
        ORDER BY nickname.ordinality
      ) FILTER (WHERE NULLIF(pg_catalog.btrim(nickname.value #>> '{}'), '') IS NOT NULL),
      ARRAY[]::text[]
    )
    INTO v_nicknames
    FROM pg_catalog.jsonb_array_elements(p_request -> 'nicknames')
      WITH ORDINALITY AS nickname(value, ordinality);
  END IF;
  IF pg_catalog.cardinality(v_nicknames) > 20
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(v_nicknames) AS nickname(value)
      WHERE pg_catalog.length(nickname.value) > 200
    ) THEN
    RAISE EXCEPTION 'Use no more than 20 nicknames of 200 characters each.';
  END IF;

  IF v_operation = 'create' AND v_cohort_id IS NULL THEN
    RAISE EXCEPTION 'Choose an existing graduating class before adding this student.';
  END IF;
  IF v_term_id IS NOT NULL AND v_cohort_id IS NULL THEN
    RAISE EXCEPTION 'Choose the exact graduating class linked to this semester.';
  END IF;

  v_requested_application_status := CASE
    WHEN v_term_id IS NULL THEN NULL
    ELSE coalesce(NULLIF(pg_catalog.btrim(p_request ->> 'termMembershipStatus'), ''), 'needs_review')
  END;
  IF v_requested_application_status IS NOT NULL
    AND v_requested_application_status NOT IN ('submitted', 'needs_review', 'accepted') THEN
    RAISE EXCEPTION 'Choose a valid semester application status.';
  END IF;
  IF v_requested_application_status = 'accepted'
    AND NOT plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'decide_applications'
    ) THEN
    RAISE EXCEPTION 'Not authorized to accept CSF semester applications.';
  END IF;

  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'operation', v_operation,
          'profileId', v_profile_id,
          'firstName', v_first_name,
          'middleName', v_middle_name,
          'lastName', v_last_name,
          'preferredName', v_preferred_name,
          'nicknames', pg_catalog.to_jsonb(v_nicknames),
          'schoolEmail', v_school_email,
          'personalEmail', v_personal_email,
          'cohortId', v_cohort_id,
          'termId', v_term_id,
          'termMembershipStatus', v_requested_application_status
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- One organization lock protects the normalized-name/email uniqueness check
  -- and gives every profile write the same first lock. Exact rows are locked in
  -- profile -> cohort -> term -> cohort-term -> membership -> application order.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_upsert_profile:' || p_organization_id::text,
      0
    )
  );

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.action IN ('profile.create', 'profile.edit')
  LIMIT 1;

  IF FOUND THEN
    IF v_receipt.action <> v_expected_action
      OR v_receipt.after_data ->> 'actorUserId' IS DISTINCT FROM p_actor_user_id::text
      OR v_receipt.after_data ->> 'requestFingerprint' IS DISTINCT FROM v_request_fingerprint
      OR pg_catalog.jsonb_typeof(v_receipt.after_data -> 'result') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'That profile-save request identifier is already bound to different content.';
    END IF;
    RETURN (v_receipt.after_data -> 'result')
      || pg_catalog.jsonb_build_object('idempotent', true);
  END IF;

  IF v_operation = 'edit' THEN
    SELECT profile.*
    INTO v_profile
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = v_profile_id
      AND profile.record_status = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CSF member profile was not found in this organization.';
    END IF;
    v_profile_before := pg_catalog.jsonb_build_object(
      'firstName', v_profile.first_name,
      'middleName', v_profile.middle_name,
      'lastName', v_profile.last_name,
      'preferredName', v_profile.preferred_name,
      'nicknames', pg_catalog.to_jsonb(v_profile.nicknames),
      'hasSchoolEmail', v_profile.school_email IS NOT NULL,
      'hasPersonalEmail', v_profile.personal_email IS NOT NULL
    );
  END IF;

  IF v_cohort_id IS NOT NULL THEN
    PERFORM 1
    FROM plugin_data.csf_cohorts AS cohort
    WHERE cohort.organization_id = p_organization_id
      AND cohort.id = v_cohort_id
      AND cohort.status = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected graduating class was not found or is not active in this organization.';
    END IF;
  END IF;

  IF v_term_id IS NOT NULL THEN
    SELECT term.lifecycle_status
    INTO v_term_lifecycle_status
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id
      AND term.id = v_term_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected semester was not found in this organization.';
    END IF;
    IF v_term_lifecycle_status NOT IN ('planned', 'open') THEN
      RAISE EXCEPTION 'Closed or archived semesters cannot be changed from the member profile form.';
    END IF;

    SELECT cohort_term.id
    INTO v_cohort_term_id
    FROM plugin_data.csf_cohort_terms AS cohort_term
    WHERE cohort_term.organization_id = p_organization_id
      AND cohort_term.cohort_id = v_cohort_id
      AND cohort_term.term_id = v_term_id
      AND cohort_term.status = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected graduating class is not actively linked to this semester.';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_profiles AS duplicate
    WHERE duplicate.organization_id = p_organization_id
      AND duplicate.record_status = 'active'
      AND duplicate.id IS DISTINCT FROM v_profile_id
      AND duplicate.normalized_first_name = v_normalized_first_name
      AND duplicate.normalized_last_name = v_normalized_last_name
  ) THEN
    RAISE EXCEPTION 'Another active CSF member already has this normalized name. Review the existing record instead of creating a duplicate.';
  END IF;

  IF (v_normalized_school_email IS NOT NULL OR v_normalized_personal_email IS NOT NULL)
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_profiles AS duplicate
      WHERE duplicate.organization_id = p_organization_id
        AND duplicate.record_status = 'active'
        AND duplicate.id IS DISTINCT FROM v_profile_id
        AND (
          duplicate.normalized_school_email = ANY (
            ARRAY[v_normalized_school_email, v_normalized_personal_email]
          )
          OR duplicate.normalized_personal_email = ANY (
            ARRAY[v_normalized_school_email, v_normalized_personal_email]
          )
        )
    ) THEN
    RAISE EXCEPTION 'Another active CSF member already uses one of these email addresses. Review or link the existing record instead.';
  END IF;

  IF v_operation = 'create' THEN
    INSERT INTO plugin_data.csf_profiles (
      organization_id,
      first_name,
      middle_name,
      last_name,
      preferred_name,
      nicknames,
      school_email,
      personal_email,
      normalized_first_name,
      normalized_last_name,
      normalized_school_email,
      normalized_personal_email,
      source_summary,
      created_at,
      updated_at
    ) VALUES (
      p_organization_id,
      v_first_name,
      v_middle_name,
      v_last_name,
      v_preferred_name,
      v_nicknames,
      v_school_email,
      v_personal_email,
      v_normalized_first_name,
      v_normalized_last_name,
      v_normalized_school_email,
      v_normalized_personal_email,
      pg_catalog.jsonb_build_object(
        'createdBy', 'csf_staff',
        'actorUserId', p_actor_user_id,
        'profileWriteRequestId', p_request_id
      ),
      v_now,
      v_now
    )
    RETURNING * INTO v_profile;
    v_profile_id := v_profile.id;
  ELSE
    UPDATE plugin_data.csf_profiles
    SET
      first_name = v_first_name,
      middle_name = v_middle_name,
      last_name = v_last_name,
      preferred_name = v_preferred_name,
      nicknames = v_nicknames,
      school_email = v_school_email,
      personal_email = v_personal_email,
      normalized_first_name = v_normalized_first_name,
      normalized_last_name = v_normalized_last_name,
      normalized_school_email = v_normalized_school_email,
      normalized_personal_email = v_normalized_personal_email,
      source_summary = coalesce(source_summary, '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
          'lastEditedBy', 'csf_staff',
          'lastEditedByUserId', p_actor_user_id,
          'lastEditedAt', v_now,
          'profileWriteRequestId', p_request_id
        ),
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND id = v_profile_id
      AND record_status = 'active'
    RETURNING * INTO v_profile;
  END IF;

  v_profile_after := pg_catalog.jsonb_build_object(
    'firstName', v_profile.first_name,
    'middleName', v_profile.middle_name,
    'lastName', v_profile.last_name,
    'preferredName', v_profile.preferred_name,
    'nicknames', pg_catalog.to_jsonb(v_profile.nicknames),
    'hasSchoolEmail', v_profile.school_email IS NOT NULL,
    'hasPersonalEmail', v_profile.personal_email IS NOT NULL
  );

  IF v_cohort_id IS NOT NULL THEN
    PERFORM membership.id
    FROM plugin_data.csf_profile_cohort_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.profile_id = v_profile_id
    ORDER BY membership.id
    FOR UPDATE;

    UPDATE plugin_data.csf_profile_cohort_memberships
    SET status = 'transferred', updated_at = v_now
    WHERE organization_id = p_organization_id
      AND profile_id = v_profile_id
      AND cohort_id <> v_cohort_id
      AND status = 'active';

    INSERT INTO plugin_data.csf_profile_cohort_memberships (
      organization_id,
      profile_id,
      cohort_id,
      status,
      created_at,
      updated_at
    ) VALUES (
      p_organization_id,
      v_profile_id,
      v_cohort_id,
      'active',
      v_now,
      v_now
    )
    ON CONFLICT (profile_id, cohort_id) DO UPDATE
    SET status = 'active', updated_at = EXCLUDED.updated_at
    RETURNING id INTO v_cohort_membership_id;
  END IF;

  IF v_term_id IS NOT NULL THEN
    SELECT application.*
    INTO v_application
    FROM plugin_data.csf_term_applications AS application
    WHERE application.organization_id = p_organization_id
      AND application.profile_id = v_profile_id
      AND application.term_id = v_term_id
    FOR UPDATE;
    v_application_was_found := FOUND;

    IF v_application_was_found THEN
      v_application_id := v_application.id;
      v_previous_application_status := v_application.status;
      IF v_application.decision_status <> 'pending' THEN
        IF v_requested_application_status <> 'accepted'
          OR v_application.decision_status <> 'approved'
          OR v_application.status <> 'accepted' THEN
          RAISE EXCEPTION 'A decided semester application cannot be changed from the member profile form.';
        END IF;
        IF v_application.cohort_id <> v_cohort_id THEN
          RAISE EXCEPTION 'The accepted semester application belongs to a different graduating class.';
        END IF;
      ELSE
        UPDATE plugin_data.csf_term_applications
        SET
          cohort_id = v_cohort_id,
          status = CASE
            WHEN v_requested_application_status = 'accepted'
              THEN CASE WHEN status = 'draft' THEN 'needs_review' ELSE status END
            ELSE v_requested_application_status
          END,
          submission_status = CASE
            WHEN v_requested_application_status = 'accepted'
              THEN CASE WHEN submission_status = 'imported' THEN 'ready' ELSE submission_status END
            ELSE 'ready'::plugin_data.csf_application_submission_status
          END,
          submitted_at = coalesce(submitted_at, v_now),
          application_data = coalesce(application_data, '{}'::jsonb)
            || pg_catalog.jsonb_build_object('lastProfileWriteRequestId', p_request_id),
          updated_at = v_now
        WHERE organization_id = p_organization_id
          AND id = v_application.id
        RETURNING * INTO v_application;
      END IF;
    ELSE
      v_seed_application_status := CASE
        WHEN v_requested_application_status = 'accepted' THEN 'needs_review'
        ELSE v_requested_application_status
      END;
      INSERT INTO plugin_data.csf_term_applications (
        organization_id,
        profile_id,
        cohort_id,
        term_id,
        source,
        status,
        submission_status,
        decision_status,
        submitted_at,
        review_notes,
        application_data,
        created_at,
        updated_at
      ) VALUES (
        p_organization_id,
        v_profile_id,
        v_cohort_id,
        v_term_id,
        'manual',
        v_seed_application_status,
        'ready',
        'pending',
        v_now,
        'Created from the staff member profile workflow.',
        pg_catalog.jsonb_build_object(
          'createdFrom', 'manual_profile_write',
          'profileWriteRequestId', p_request_id
        ),
        v_now,
        v_now
      )
      RETURNING * INTO v_application;
      v_application_id := v_application.id;
      v_previous_application_status := NULL;
    END IF;

    PERFORM membership.id
    FROM plugin_data.csf_term_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.profile_id = v_profile_id
      AND membership.term_id = v_term_id
    FOR UPDATE;

    IF v_requested_application_status = 'accepted' THEN
      IF v_application_was_found
        AND v_application.decision_status = 'approved'
        AND v_application.status = 'accepted' THEN
        SELECT membership.status, membership.cohort_id
        INTO v_existing_term_membership_status, v_existing_term_membership_cohort_id
        FROM plugin_data.csf_term_memberships AS membership
        WHERE membership.organization_id = p_organization_id
          AND membership.profile_id = v_profile_id
          AND membership.term_id = v_term_id;
        IF NOT FOUND
          OR v_existing_term_membership_status NOT IN ('accepted', 'active', 'completed', 'not_completed')
          OR v_existing_term_membership_cohort_id IS DISTINCT FROM v_cohort_id THEN
          RAISE EXCEPTION 'The accepted semester application has inconsistent membership state and requires application review.';
        END IF;
      ELSE
        v_decision_result := plugin_data.csf_decide_term_application(
          p_organization_id,
          v_application_id,
          'accepted',
          'Accepted from the staff member profile workflow.',
          p_actor_user_id
        );
        SELECT application.*
        INTO v_application
        FROM plugin_data.csf_term_applications AS application
        WHERE application.organization_id = p_organization_id
          AND application.id = v_application_id;
      END IF;
    ELSIF NOT v_application_was_found
      OR v_previous_application_status IS DISTINCT FROM v_requested_application_status THEN
      INSERT INTO plugin_data.csf_application_status_events (
        organization_id,
        application_id,
        actor_user_id,
        previous_status,
        next_status,
        reason,
        correlation_id,
        details
      ) VALUES (
        p_organization_id,
        v_application_id,
        p_actor_user_id,
        v_previous_application_status,
        v_requested_application_status,
        'Saved from the staff member profile workflow.',
        p_request_id,
        pg_catalog.jsonb_build_object(
          'source', 'profile_write',
          'cohortId', v_cohort_id,
          'cohortTermId', v_cohort_term_id
        )
      );
    END IF;
  END IF;

  v_result := pg_catalog.jsonb_build_object(
    'profileId', v_profile_id,
    'cohortId', v_cohort_id,
    'cohortMembershipId', v_cohort_membership_id,
    'termId', v_term_id,
    'applicationId', v_application_id,
    'applicationStatus', CASE
      WHEN v_term_id IS NULL THEN NULL
      ELSE v_application.status
    END,
    'applicationDecision', v_decision_result,
    'requestId', p_request_id,
    'idempotent', false
  );

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
    'csf_profiles',
    v_profile_id,
    v_term_id,
    v_profile_before,
    pg_catalog.jsonb_build_object(
      'actorUserId', p_actor_user_id,
      'requestFingerprint', v_request_fingerprint,
      'profile', v_profile_after,
      'cohortId', v_cohort_id,
      'cohortTermId', v_cohort_term_id,
      'requestedApplicationStatus', v_requested_application_status,
      'result', v_result
    ),
    p_request_id,
    'staff_profile_write',
    p_request_id::text,
    CASE WHEN v_operation = 'create' THEN 'profile_created' ELSE 'profile_edited' END
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_upsert_profile(uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_upsert_profile(uuid, uuid, uuid, jsonb)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_upsert_profile(uuid, uuid, uuid, jsonb) IS
  'Service-only, permission-checked, replay-safe member create/edit that resolves existing tenant class and semester links and atomically commits profile identity, class history, optional application decision/membership, status history, and immutable staff audit.';

COMMIT;
