-- Member self-service name-match confirmation.
--
-- Rosters carry only names and graduating classes, so the member connect flow
-- offers a masked "Is this you?" candidate when exactly one unclaimed active
-- profile in the chosen class matches the member's exact normalized name. The
-- decision to allow this is deliberate: the name is account-owned, the
-- candidate is shown masked, and the student explicitly confirms. Officer
-- resolution flows are unchanged; every ambiguous or conflicting case still
-- lands in the review queue.
--
-- The server action verifies a signed token before calling this function, but
-- the token is never trusted alone: the unique exact-name match is recomputed
-- inside the transaction, and any revalidation failure degrades to a
-- needs_review request instead of linking.

CREATE FUNCTION plugin_data.csf_confirm_profile_name_match(
  p_organization_id uuid,
  p_profile_id uuid,
  p_user_id uuid,
  p_verified_email text,
  p_cohort_id uuid,
  p_term_id uuid,
  p_normalized_first_name text,
  p_normalized_last_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth_email text;
  v_email text := lower(nullif(btrim(coalesce(p_verified_email, '')), ''));
  v_first_name text := nullif(btrim(coalesce(p_normalized_first_name, '')), '');
  v_last_name text := nullif(btrim(coalesce(p_normalized_last_name, '')), '');
  v_name_candidate_ids uuid[] := ARRAY[]::uuid[];
  v_existing_profile_id uuid;
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_term_lifecycle_status text;
  v_organization_membership_status text;
  v_membership_write_count integer := 0;
  v_membership_activated boolean := false;
  v_match_status text;
  v_resolution_notes text;
  v_request_id uuid;
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := now();
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'A verified account email is required.';
  END IF;
  IF v_first_name IS NULL OR v_last_name IS NULL THEN
    RAISE EXCEPTION 'First and last name are required.';
  END IF;
  IF p_cohort_id IS NULL OR p_term_id IS NULL THEN
    RAISE EXCEPTION 'Choose your graduating class and current semester.';
  END IF;

  SELECT lower("user".email)
  INTO v_auth_email
  FROM auth.users AS "user"
  WHERE "user".id = p_user_id
    AND "user".email_confirmed_at IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND OR v_auth_email IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'Use the verified email on your signed-in account.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-profile-account:' || p_organization_id::text || ':' || p_user_id::text,
      0
    )
  );

  SELECT account.profile_id
  INTO v_existing_profile_id
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.user_id = p_user_id
    AND account.status = 'verified'
  FOR UPDATE;

  -- An identical retry after a successful confirm is a replay, not an error.
  IF v_existing_profile_id IS NOT NULL AND v_existing_profile_id = p_profile_id THEN
    RETURN jsonb_build_object(
      'connected', true,
      'needsReview', false,
      'profileId', p_profile_id,
      'replayed', true
    );
  END IF;

  -- Recompute the unique exact-name candidate inside the transaction: an
  -- active, unclaimed profile with an active membership in the chosen class
  -- whose normalized name (or preferred name) equals the account name.
  SELECT coalesce(array_agg(profile.id ORDER BY profile.id), ARRAY[]::uuid[])
  INTO v_name_candidate_ids
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.record_status = 'active'
    AND profile.normalized_last_name = v_last_name
    AND (
      profile.normalized_first_name = v_first_name
      OR lower(btrim(coalesce(profile.preferred_name, ''))) = v_first_name
    )
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_cohort_memberships AS membership
      WHERE membership.organization_id = p_organization_id
        AND membership.profile_id = profile.id
        AND membership.cohort_id = p_cohort_id
        AND membership.status = 'active'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id = p_organization_id
        AND account.profile_id = profile.id
        AND account.status = 'verified'
    );

  IF cardinality(v_name_candidate_ids) = 1
    AND v_name_candidate_ids[1] = p_profile_id
    AND v_existing_profile_id IS NULL
  THEN
    SELECT profile.*
    INTO v_profile
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = p_profile_id
      AND profile.record_status = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The CSF student record is no longer active.';
    END IF;

    v_match_status := 'auto_linked';
    v_resolution_notes :=
      'Student confirmed the single exact name match in their class.';
  ELSE
    -- Anything short of one unambiguous, unclaimed, still-matching candidate
    -- becomes an officer review request rather than an error: the student
    -- still gets a durable "an officer will review this" outcome.
    v_match_status := 'needs_review';
    v_resolution_notes := CASE
      WHEN v_existing_profile_id IS NOT NULL
        THEN 'This account already has a verified CSF profile link; staff review is required.'
      WHEN cardinality(v_name_candidate_ids) > 1
        THEN 'Multiple class records share this name; an officer must connect the right one.'
      ELSE 'The confirmed name match is no longer available; staff review is required.'
    END;
  END IF;

  IF v_match_status = 'auto_linked' THEN
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

    INSERT INTO plugin_data.csf_profile_accounts (
      organization_id, profile_id, user_id, status, is_primary,
      linked_by, linked_at, notes
    ) VALUES (
      p_organization_id, p_profile_id, p_user_id, 'verified', true,
      p_user_id, v_now,
      'Connected by student-confirmed exact name match.'
    )
    ON CONFLICT (organization_id, profile_id, user_id) DO UPDATE
    SET status = 'verified',
        is_primary = true,
        linked_by = p_user_id,
        linked_at = v_now,
        revoked_at = NULL,
        notes = EXCLUDED.notes;

    -- An already-accepted application for the chosen semester activates the
    -- term membership, mirroring the verified-email auto-link path.
    SELECT term.lifecycle_status
    INTO v_term_lifecycle_status
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id
      AND term.id = p_term_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The CSF semester for this request no longer exists.';
    END IF;

    SELECT application.*
    INTO v_application
    FROM plugin_data.csf_term_applications AS application
    WHERE application.organization_id = p_organization_id
      AND application.profile_id = p_profile_id
      AND application.term_id = p_term_id
      AND application.cohort_id = p_cohort_id
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
        p_organization_id, p_profile_id, p_term_id,
        coalesce(v_application.cohort_id, p_cohort_id), v_application.id,
        'active', v_now, v_now,
        'Student confirmed their class name match.', v_now
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
    organization_id, term_id, cohort_id, user_id,
    signed_in_email, first_name, last_name,
    normalized_first_name, normalized_last_name,
    matched_profile_id, candidate_profile_ids, match_status,
    resolution_notes, resolved_by, resolved_at,
    claim_correlation_id, submitted_returning_status, updated_at
  ) VALUES (
    p_organization_id, p_term_id, p_cohort_id, p_user_id,
    v_email,
    coalesce(v_profile.first_name, initcap(v_first_name)),
    coalesce(v_profile.last_name, initcap(v_last_name)),
    v_first_name, v_last_name,
    CASE WHEN v_match_status = 'auto_linked' THEN p_profile_id END,
    v_name_candidate_ids, v_match_status, v_resolution_notes,
    CASE WHEN v_match_status = 'auto_linked' THEN p_user_id END,
    CASE WHEN v_match_status = 'auto_linked' THEN v_now END,
    v_correlation_id, 'unknown', v_now
  )
  RETURNING id INTO v_request_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action, target_type,
    target_id, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_user_id,
    CASE WHEN v_match_status = 'auto_linked' THEN p_profile_id END,
    CASE WHEN v_match_status = 'auto_linked'
      THEN 'profile.name_match_connected'
      ELSE 'profile.name_match_review_requested' END,
    'csf_profile_link_requests', v_request_id,
    jsonb_build_object(
      'cohortId', p_cohort_id,
      'termId', p_term_id,
      'matchStatus', v_match_status,
      'candidateCount', cardinality(v_name_candidate_ids),
      'termMembershipActivated', v_membership_activated
    ),
    v_correlation_id, 'member_name_match', v_request_id::text,
    CASE WHEN v_match_status = 'auto_linked'
      THEN 'confirmed_name_match' ELSE 'unconfirmable_name_match' END
  );

  RETURN jsonb_build_object(
    'connected', v_match_status = 'auto_linked',
    'needsReview', v_match_status = 'needs_review',
    'profileId', CASE WHEN v_match_status = 'auto_linked' THEN p_profile_id END,
    'requestId', v_request_id,
    'termMembershipActivated', v_membership_activated,
    'replayed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_confirm_profile_name_match(
  uuid, uuid, uuid, text, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_confirm_profile_name_match(
  uuid, uuid, uuid, text, uuid, uuid, text, text
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_confirm_profile_name_match(
  uuid, uuid, uuid, text, uuid, uuid, text, text
) IS
  'Links a member to the single exact-name roster match they explicitly confirmed, recomputing the match in-transaction; anything ambiguous degrades to an officer review request.';
