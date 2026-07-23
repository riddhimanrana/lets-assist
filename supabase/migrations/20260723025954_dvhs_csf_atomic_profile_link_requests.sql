-- Retire the legacy multi-statement profile-link Server Action.  Manual
-- reusable-link fallbacks and My CSF requests now perform matching, request
-- creation, any already-verified account activation, and audit logging in one
-- database transaction.
--
-- Exact reusable-link email matches are intentionally not auto-linked here.
-- They must continue through csf_profile_claim_candidate plus the signed,
-- short-lived claim token checked by the Server Action before
-- csf_confirm_profile_claim is invoked.

BEGIN;

ALTER TABLE plugin_data.csf_profile_link_requests
  ADD COLUMN IF NOT EXISTS submitted_grade_level smallint
    CHECK (submitted_grade_level BETWEEN 9 AND 12),
  ADD COLUMN IF NOT EXISTS submitted_returning_status text
    CHECK (submitted_returning_status IN ('new', 'returning', 'unknown'));

CREATE OR REPLACE FUNCTION plugin_data.csf_submit_profile_link_request(
  p_organization_id uuid,
  p_code text,
  p_user_id uuid,
  p_verified_email text,
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_preferred_name text,
  p_school_email text,
  p_personal_email text,
  p_normalized_first_name text,
  p_normalized_last_name text,
  p_cohort_year integer,
  p_term_code text,
  p_current_grade_level integer DEFAULT NULL,
  p_returning_status text DEFAULT 'unknown'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_link plugin_data.csf_onboarding_links%ROWTYPE;
  v_existing_request plugin_data.csf_profile_link_requests%ROWTYPE;
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_onboarding_link_id uuid;
  v_term_id uuid;
  v_cohort_id uuid;
  v_verified_email text := lower(btrim(coalesce(p_verified_email, '')));
  v_school_email text := nullif(lower(btrim(coalesce(p_school_email, ''))), '');
  v_personal_email text := nullif(lower(btrim(coalesce(p_personal_email, ''))), '');
  v_first_name text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_middle_name text := nullif(btrim(coalesce(p_middle_name, '')), '');
  v_last_name text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_preferred_name text := nullif(btrim(coalesce(p_preferred_name, '')), '');
  v_normalized_first_name text := nullif(btrim(coalesce(p_normalized_first_name, '')), '');
  v_normalized_last_name text := nullif(btrim(coalesce(p_normalized_last_name, '')), '');
  v_existing_profile_id uuid;
  v_profile_id uuid;
  v_verified_email_candidate_ids uuid[] := ARRAY[]::uuid[];
  v_review_candidate_ids uuid[] := ARRAY[]::uuid[];
  v_candidate_ids uuid[] := ARRAY[]::uuid[];
  v_match_status text := 'needs_review';
  v_resolution_notes text;
  v_link_source text := 'manual_review';
  v_request_id uuid;
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_membership_write_count integer := 0;
  v_membership_activated boolean := false;
  v_organization_membership_status text;
  v_profile_account_status text;
  v_term_lifecycle_status text;
  v_source_type text := 'member_workspace';
  v_source_id text;
  v_replay_valid boolean := false;
  v_replay_reconciled boolean := false;
  v_return_correlation_id uuid;
BEGIN
  IF v_verified_email = '' OR NOT EXISTS (
    SELECT 1
    FROM auth.users AS auth_user
    WHERE auth_user.id = p_user_id
      AND lower(btrim(coalesce(auth_user.email, ''))) = v_verified_email
      AND auth_user.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A verified account email is required.';
  END IF;
  IF v_first_name IS NULL OR v_last_name IS NULL
    OR v_normalized_first_name IS NULL OR v_normalized_last_name IS NULL
  THEN
    RAISE EXCEPTION 'First and last name are required.';
  END IF;
  IF p_current_grade_level IS NOT NULL
    AND p_current_grade_level NOT BETWEEN 9 AND 12
  THEN
    RAISE EXCEPTION 'Current grade must be between 9 and 12.';
  END IF;
  IF coalesce(p_returning_status, 'unknown') NOT IN ('new', 'returning', 'unknown') THEN
    RAISE EXCEPTION 'Invalid returning-member status.';
  END IF;

  IF nullif(btrim(coalesce(p_code, '')), '') IS NOT NULL THEN
    SELECT link.*
    INTO v_link
    FROM plugin_data.csf_onboarding_links AS link
    WHERE link.organization_id = p_organization_id
      AND link.code = btrim(p_code)
      AND link.invitation_scope = 'cohort'
      AND link.link_type IN ('profile_connect', 'combined')
    FOR UPDATE;

    IF NOT FOUND OR NOT v_link.is_active
      OR v_link.delivery_status NOT IN ('link_ready', 'sent')
      OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= v_now)
    THEN
      RAISE EXCEPTION 'This CSF class invitation is no longer active.';
    END IF;

    v_onboarding_link_id := v_link.id;
    v_term_id := v_link.term_id;
    v_cohort_id := v_link.cohort_id;
    v_source_type := 'cohort_invitation';
    v_source_id := v_link.id::text;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.organization_members AS member
      WHERE member.organization_id = p_organization_id
        AND member.user_id = p_user_id
        AND member.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Join this organization or use the current class invitation.';
    END IF;
    IF p_cohort_year IS NULL OR nullif(btrim(coalesce(p_term_code, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Choose your graduating class and current semester.';
    END IF;

    SELECT term.id
    INTO STRICT v_term_id
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id
      AND term.code = upper(btrim(p_term_code));

    SELECT cohort.id
    INTO STRICT v_cohort_id
    FROM plugin_data.csf_cohorts AS cohort
    WHERE cohort.organization_id = p_organization_id
      AND cohort.graduation_year = p_cohort_year
      AND cohort.status = 'active';

    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_cohort_terms AS cohort_term
      WHERE cohort_term.organization_id = p_organization_id
        AND cohort_term.cohort_id = v_cohort_id
        AND cohort_term.term_id = v_term_id
        AND cohort_term.status = 'active'
    ) THEN
      RAISE EXCEPTION 'The selected class is not active for this semester.';
    END IF;
    v_source_id := v_term_id::text;
  END IF;

  IF v_term_id IS NULL OR v_cohort_id IS NULL THEN
    RAISE EXCEPTION 'Use a current class and semester invitation.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-profile-account:' || p_organization_id::text || ':' || p_user_id::text,
      0
    )
  );

  -- An identical retry returns the original request.  Changed student details
  -- remain a new review attempt so an officer can see the correction history.
  SELECT request.*
  INTO v_existing_request
  FROM plugin_data.csf_profile_link_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.user_id = p_user_id
    AND request.onboarding_link_id IS NOT DISTINCT FROM v_onboarding_link_id
    AND request.term_id = v_term_id
    AND request.cohort_id = v_cohort_id
    AND (
      request.match_status = 'auto_linked'
      OR (
        request.match_status IN ('pending', 'needs_review')
        AND request.signed_in_email = v_verified_email
        AND request.first_name = v_first_name
        AND request.middle_name IS NOT DISTINCT FROM v_middle_name
        AND request.last_name = v_last_name
        AND request.preferred_name IS NOT DISTINCT FROM v_preferred_name
        AND request.normalized_first_name = v_normalized_first_name
        AND request.normalized_last_name = v_normalized_last_name
        AND request.normalized_school_email IS NOT DISTINCT FROM v_school_email
        AND request.normalized_personal_email IS NOT DISTINCT FROM v_personal_email
        AND request.submitted_grade_level IS NOT DISTINCT FROM p_current_grade_level
        AND request.submitted_returning_status = coalesce(p_returning_status, 'unknown')
      )
    )
  ORDER BY request.created_at DESC, request.id DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_return_correlation_id := v_existing_request.claim_correlation_id;
    IF v_existing_request.match_status = 'auto_linked' THEN
      v_replay_valid := v_existing_request.matched_profile_id IS NOT NULL;

      IF v_replay_valid THEN
        PERFORM 1
        FROM plugin_data.csf_profile_accounts AS account
        WHERE account.organization_id = p_organization_id
          AND account.profile_id = v_existing_request.matched_profile_id
          AND account.user_id = p_user_id
          AND account.status = 'verified'
        FOR UPDATE;
        v_replay_valid := FOUND;
      END IF;

      IF v_replay_valid THEN
        PERFORM 1
        FROM public.organization_members AS member
        WHERE member.organization_id = p_organization_id
          AND member.user_id = p_user_id
          AND member.status = 'active'
        FOR UPDATE;
        v_replay_valid := FOUND;
      END IF;

      IF v_replay_valid THEN
        PERFORM 1
        FROM plugin_data.csf_profile_cohort_memberships AS membership
        WHERE membership.organization_id = p_organization_id
          AND membership.profile_id = v_existing_request.matched_profile_id
          AND membership.cohort_id = v_cohort_id
          AND membership.status = 'active'
        FOR UPDATE;
        v_replay_valid := FOUND;
      END IF;

      IF v_replay_valid THEN
        v_replay_valid := NOT EXISTS (
          SELECT 1
          FROM plugin_data.csf_profile_cohort_memberships AS membership
          WHERE membership.organization_id = p_organization_id
            AND membership.profile_id = v_existing_request.matched_profile_id
            AND membership.status = 'active'
            AND membership.cohort_id <> v_cohort_id
        ) AND EXISTS (
          SELECT 1
          FROM plugin_data.csf_admin_audit_events AS audit
          WHERE audit.organization_id = p_organization_id
            AND audit.action = 'profile.existing_account_connected'
            AND audit.target_type = 'csf_profile_link_requests'
            AND audit.target_id = v_existing_request.id
            AND audit.correlation_id = v_existing_request.claim_correlation_id
        );
      END IF;

      IF NOT v_replay_valid THEN
        UPDATE plugin_data.csf_profile_link_requests
        SET match_status = 'needs_review',
            matched_profile_id = NULL,
            resolution_notes = 'The previous account connection could not be revalidated; staff review is required.',
            resolved_by = NULL,
            resolved_at = NULL,
            updated_at = v_now
        WHERE id = v_existing_request.id;

        INSERT INTO plugin_data.csf_admin_audit_events (
          organization_id, actor_user_id, action, target_type, target_id,
          term_id, before_data, after_data, correlation_id, source_type,
          source_id, reason_code
        ) VALUES (
          p_organization_id, p_user_id,
          'profile.link_request_revalidation_failed',
          'csf_profile_link_requests', v_existing_request.id,
          v_existing_request.term_id,
          jsonb_build_object(
            'matchStatus', v_existing_request.match_status,
            'profileId', v_existing_request.matched_profile_id
          ),
          jsonb_build_object('matchStatus', 'needs_review'),
          v_correlation_id, 'profile_connection_revalidation',
          v_existing_request.id::text,
          'profile_connection_revalidation_required'
        );

        v_existing_request.match_status := 'needs_review';
        v_existing_request.matched_profile_id := NULL;
        v_replay_reconciled := true;
        v_return_correlation_id := v_correlation_id;
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'requestId', v_existing_request.id,
      'profileId', CASE
        WHEN v_existing_request.match_status = 'auto_linked'
          THEN v_existing_request.matched_profile_id
        ELSE NULL
      END,
      'status', v_existing_request.match_status,
      'connected', v_existing_request.match_status = 'auto_linked',
      'termMembershipActivated', CASE
        WHEN v_existing_request.match_status = 'auto_linked' THEN coalesce((
          SELECT (audit.after_data->>'termMembershipActivated')::boolean
          FROM plugin_data.csf_admin_audit_events AS audit
          WHERE audit.organization_id = p_organization_id
            AND audit.action = 'profile.existing_account_connected'
            AND audit.target_type = 'csf_profile_link_requests'
            AND audit.target_id = v_existing_request.id
            AND audit.correlation_id = v_existing_request.claim_correlation_id
          ORDER BY audit.created_at DESC
          LIMIT 1
        ), false)
        ELSE false
      END,
      'correlationId', v_return_correlation_id,
      'idempotentReplay', NOT v_replay_reconciled
    );
  END IF;

  SELECT account.profile_id
  INTO v_existing_profile_id
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.user_id = p_user_id
    AND account.status = 'verified'
  ORDER BY account.is_primary DESC, account.linked_at DESC, account.id
  LIMIT 1
  FOR UPDATE;

  SELECT coalesce(array_agg(candidate.id ORDER BY candidate.id), ARRAY[]::uuid[])
  INTO v_verified_email_candidate_ids
  FROM (
    SELECT DISTINCT profile.id
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.record_status = 'active'
      AND (
        profile.normalized_school_email = v_verified_email
        OR profile.normalized_personal_email = v_verified_email
      )
  ) AS candidate;

  SELECT coalesce(array_agg(candidate.id ORDER BY candidate.id), ARRAY[]::uuid[])
  INTO v_review_candidate_ids
  FROM (
    SELECT DISTINCT profile.id
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.record_status = 'active'
      AND (
        (v_school_email IS NOT NULL AND profile.normalized_school_email = v_school_email)
        OR (v_personal_email IS NOT NULL AND profile.normalized_personal_email = v_personal_email)
        OR (
          profile.normalized_first_name = v_normalized_first_name
          AND profile.normalized_last_name = v_normalized_last_name
        )
      )
  ) AS candidate;

  SELECT coalesce(array_agg(candidate_id ORDER BY candidate_id), ARRAY[]::uuid[])
  INTO v_candidate_ids
  FROM (
    SELECT DISTINCT candidate_id
    FROM unnest(
      coalesce(ARRAY[v_existing_profile_id]::uuid[], ARRAY[]::uuid[])
      || v_verified_email_candidate_ids
      || v_review_candidate_ids
    ) AS candidate_id
    WHERE candidate_id IS NOT NULL
  ) AS candidates;

  IF v_existing_profile_id IS NOT NULL THEN
    SELECT profile.*
    INTO v_profile
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = v_existing_profile_id
      AND profile.record_status = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The connected CSF student record is no longer active.';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_cohort_memberships AS membership
      WHERE membership.organization_id = p_organization_id
        AND membership.profile_id = v_existing_profile_id
        AND membership.cohort_id = v_cohort_id
        AND membership.status = 'active'
    ) OR EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_cohort_memberships AS membership
      WHERE membership.organization_id = p_organization_id
        AND membership.profile_id = v_existing_profile_id
        AND membership.status = 'active'
        AND membership.cohort_id <> v_cohort_id
    ) THEN
      v_resolution_notes :=
        'The connected student record does not have one unambiguous active membership in this class; staff review is required.';
    ELSE
      v_profile_id := v_existing_profile_id;
      v_match_status := 'auto_linked';
      v_resolution_notes := 'Reused this account''s existing verified CSF profile link.';
      v_link_source := 'existing_verified_link';
    END IF;
  ELSIF cardinality(v_verified_email_candidate_ids) = 1 THEN
    -- Never turn submitted fallback details into a confirmation.  The caller
    -- must use the signed candidate token path for an exact class-link match.
    v_resolution_notes :=
      'An exact verified-email match requires explicit student confirmation or officer review.';
  ELSIF cardinality(v_verified_email_candidate_ids) > 1 THEN
    v_resolution_notes :=
      'The authenticated email matched multiple CSF profiles; staff review is required.';
  ELSIF cardinality(v_review_candidate_ids) > 0 THEN
    v_resolution_notes :=
      'Submitted identity details suggested an existing profile, but unverified details cannot link an account.';
  ELSE
    v_resolution_notes :=
      'No CSF profile matched the authenticated verified email; staff review is required.';
  END IF;

  IF v_match_status = 'auto_linked' THEN
    IF EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id = p_organization_id
        AND account.profile_id = v_profile_id
        AND account.status = 'verified'
        AND account.user_id <> p_user_id
    ) THEN
      RAISE EXCEPTION 'This student record is already connected to another verified account.';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.organization_members AS member
      WHERE member.organization_id = p_organization_id
        AND member.user_id = p_user_id
        AND member.status IS DISTINCT FROM 'active'
    ) THEN
      RAISE EXCEPTION 'This account has inactive organization access; an administrator must review it.';
    END IF;

    INSERT INTO public.organization_members (
      organization_id, user_id, role, status
    ) VALUES (
      p_organization_id, p_user_id, 'member', 'active'
    )
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    SELECT member.status
    INTO v_organization_membership_status
    FROM public.organization_members AS member
    WHERE member.organization_id = p_organization_id
      AND member.user_id = p_user_id
    FOR UPDATE;
    IF NOT FOUND OR v_organization_membership_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'This account has inactive organization access; an administrator must review it.';
    END IF;

    SELECT account.status
    INTO v_profile_account_status
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = v_profile_id
      AND account.user_id = p_user_id
    FOR UPDATE;
    IF NOT FOUND OR v_profile_account_status IS DISTINCT FROM 'verified' THEN
      RAISE EXCEPTION 'This CSF account connection requires officer review.';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_cohort_memberships AS membership
      WHERE membership.organization_id = p_organization_id
        AND membership.profile_id = v_profile_id
        AND membership.cohort_id = v_cohort_id
        AND membership.status = 'active'
    ) THEN
      RAISE EXCEPTION 'This CSF class connection requires officer review.';
    END IF;

    SELECT term.lifecycle_status
    INTO v_term_lifecycle_status
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id
      AND term.id = v_term_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The CSF semester for this request no longer exists.';
    END IF;

    SELECT application.*
    INTO v_application
    FROM plugin_data.csf_term_applications AS application
    WHERE application.organization_id = p_organization_id
      AND application.profile_id = v_profile_id
      AND application.term_id = v_term_id
      AND application.cohort_id = v_cohort_id
      AND application.status = 'accepted'
    ORDER BY application.reviewed_at DESC NULLS LAST, application.updated_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_application.id IS NOT NULL
      AND v_term_lifecycle_status NOT IN ('closed', 'archived')
    THEN
      INSERT INTO plugin_data.csf_term_memberships AS existing_membership (
        organization_id, profile_id, term_id, cohort_id, application_id,
        status, accepted_at, activated_at, status_reason, updated_at
      ) VALUES (
        p_organization_id, v_profile_id, v_term_id,
        coalesce(v_application.cohort_id, v_cohort_id), v_application.id,
        'active', v_now, v_now,
        'Existing verified Let''s Assist account connected to this CSF class.', v_now
      )
      ON CONFLICT (organization_id, profile_id, term_id) DO UPDATE
      SET cohort_id = EXCLUDED.cohort_id,
          application_id = EXCLUDED.application_id,
          status = 'active',
          activated_at = coalesce(existing_membership.activated_at, v_now),
          status_reason = EXCLUDED.status_reason,
          updated_at = v_now
      WHERE existing_membership.status IN ('pending', 'accepted', 'active')
        AND existing_membership.finalized_closure_id IS NULL;
      GET DIAGNOSTICS v_membership_write_count = ROW_COUNT;
      v_membership_activated := v_membership_write_count > 0;
    END IF;
  END IF;

  INSERT INTO plugin_data.csf_profile_link_requests (
    organization_id, onboarding_link_id, term_id, cohort_id, user_id,
    signed_in_email, first_name, middle_name, last_name, preferred_name,
    personal_email, school_email, normalized_first_name, normalized_last_name,
    normalized_personal_email, normalized_school_email, matched_profile_id,
    candidate_profile_ids, match_status, resolution_notes, resolved_by,
    resolved_at, claim_correlation_id, submitted_grade_level,
    submitted_returning_status, updated_at
  ) VALUES (
    p_organization_id, v_onboarding_link_id, v_term_id, v_cohort_id, p_user_id,
    v_verified_email, v_first_name, v_middle_name, v_last_name, v_preferred_name,
    v_personal_email, v_school_email, v_normalized_first_name, v_normalized_last_name,
    v_personal_email, v_school_email, v_profile_id, v_candidate_ids,
    v_match_status, v_resolution_notes,
    CASE WHEN v_match_status = 'auto_linked' THEN p_user_id ELSE NULL END,
    CASE WHEN v_match_status = 'auto_linked' THEN v_now ELSE NULL END,
    v_correlation_id, p_current_grade_level,
    coalesce(p_returning_status, 'unknown'), v_now
  )
  RETURNING id INTO v_request_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action, target_type,
    target_id, term_id, after_data, correlation_id, source_type, source_id,
    reason_code
  ) VALUES (
    p_organization_id, p_user_id, v_profile_id,
    CASE WHEN v_match_status = 'auto_linked'
      THEN 'profile.existing_account_connected'
      ELSE 'profile.link_request_submitted'
    END,
    'csf_profile_link_requests', v_request_id, v_term_id,
    jsonb_build_object(
      'profileId', v_profile_id,
      'cohortId', v_cohort_id,
      'matchStatus', v_match_status,
      'linkSource', v_link_source,
      'organizationMembershipActive', v_match_status = 'auto_linked',
      'termMembershipActivated', v_membership_activated,
      'currentGradeLevel', p_current_grade_level,
      'returningStatus', coalesce(p_returning_status, 'unknown')
    ),
    v_correlation_id, v_source_type, v_source_id,
    CASE WHEN v_match_status = 'auto_linked'
      THEN 'existing_verified_profile_connected'
      ELSE 'profile_connection_review_requested'
    END
  );

  RETURN jsonb_build_object(
    'requestId', v_request_id,
    'profileId', v_profile_id,
    'status', v_match_status,
    'connected', v_match_status = 'auto_linked',
    'termMembershipActivated', v_membership_activated,
    'correlationId', v_correlation_id,
    'idempotentReplay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_submit_profile_link_request(
  uuid, text, uuid, text, text, text, text, text, text, text, text, text,
  integer, text, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_submit_profile_link_request(
  uuid, text, uuid, text, text, text, text, text, text, text, text, text,
  integer, text, integer, text
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_submit_profile_link_request(
  uuid, text, uuid, text, text, text, text, text, text, text, text, text,
  integer, text, integer, text
) IS
  'Atomically submits a manual CSF account-connection request; only an already verified profile may be reused without the signed exact-match claim flow.';

COMMIT;
