-- Class-code joins learn to use the roster name.
--
-- The permanent class-code join matched on verified email only; with rosters
-- that carry no emails, a returning member whose account email the roster
-- never saw always got a duplicate profile. Now, when email evidence finds
-- nothing, a single exact normalized-name match among the class's unclaimed
-- active profiles becomes a candidate:
--   * student explicitly confirmed it (p_confirmed_profile_id) -> auto-link
--   * student explicitly declined it (p_declined_profile_id)   -> new profile,
--     with the near-miss recorded for officers
--   * neither                                                  -> needs_review
-- Two or more name matches always queue for review; zero behaves as before.
-- The RPC never links on name evidence without the student's confirmation,
-- and a confirmation is honored only if it equals the recomputed match.
--
-- Dropped and recreated (not overloaded): a second overload would make the
-- PostgREST rpc() call ambiguous. Existing callers pass the original seven
-- named parameters, which still resolve against the new signature.

DROP FUNCTION plugin_data.csf_join_class_by_code(
  uuid, text, uuid, text, text, text, text
);

CREATE FUNCTION plugin_data.csf_join_class_by_code(
  p_organization_id uuid,
  p_code text,
  p_user_id uuid,
  p_verified_email text,
  p_first_name text,
  p_last_name text,
  p_preferred_name text DEFAULT NULL,
  p_confirmed_profile_id uuid DEFAULT NULL,
  p_declined_profile_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code plugin_data.csf_class_join_codes%ROWTYPE;
  v_auth_email text;
  v_email text := lower(nullif(btrim(coalesce(p_verified_email, '')), ''));
  v_first_name text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last_name text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_preferred_name text := nullif(btrim(coalesce(p_preferred_name, '')), '');
  v_candidate_ids uuid[] := ARRAY[]::uuid[];
  v_name_candidate_ids uuid[] := ARRAY[]::uuid[];
  v_name_candidate boolean := false;
  v_profile_id uuid;
  v_existing_profile_id uuid;
  v_request_id uuid;
  v_match_status text;
  v_resolution_notes text;
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := now();
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'A verified account email is required.';
  END IF;
  IF v_first_name IS NULL OR v_last_name IS NULL THEN
    RAISE EXCEPTION 'First and last name are required.';
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

  SELECT code.*
  INTO v_code
  FROM plugin_data.csf_class_join_codes AS code
  WHERE code.organization_id = p_organization_id
    AND code.code = upper(btrim(coalesce(p_code, '')))
    AND code.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This CSF class code is no longer active.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_organization_id::text || ':class-code-join:' || p_user_id::text,
      0
    )
  );

  SELECT request.id, request.match_status, request.matched_profile_id
  INTO v_request_id, v_match_status, v_profile_id
  FROM plugin_data.csf_profile_link_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.class_join_code_id = v_code.id
    AND request.user_id = p_user_id
  ORDER BY request.created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF v_request_id IS NOT NULL
    -- A student who answered the "Is this you?" panel is finishing the SAME
    -- join, not replaying it: let the decisive retry supersede a needs_review
    -- row that only exists because no answer had been given yet.
    AND NOT (
      v_match_status = 'needs_review'
      AND (p_confirmed_profile_id IS NOT NULL OR p_declined_profile_id IS NOT NULL)
    )
  THEN
    RETURN jsonb_build_object(
      'connected', v_match_status = 'auto_linked',
      'needsReview', v_match_status = 'needs_review',
      'profileId', v_profile_id,
      'requestId', v_request_id,
      'replayed', true
    );
  END IF;
  v_profile_id := NULL;
  v_match_status := NULL;

  SELECT account.profile_id
  INTO v_existing_profile_id
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.user_id = p_user_id
    AND account.status = 'verified'
  FOR UPDATE;

  SELECT coalesce(array_agg(profile.id ORDER BY profile.id), ARRAY[]::uuid[])
  INTO v_candidate_ids
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.record_status = 'active'
    AND (
      profile.normalized_school_email = v_email
      OR profile.normalized_personal_email = v_email
    );

  IF v_existing_profile_id IS NOT NULL THEN
    v_candidate_ids := ARRAY(
      SELECT DISTINCT candidate_id
      FROM unnest(v_candidate_ids || ARRAY[v_existing_profile_id]) AS candidate_id
      ORDER BY candidate_id
    );
  END IF;

  IF cardinality(v_candidate_ids) = 0 THEN
    -- No email evidence. Before creating a brand-new profile, look for the
    -- student's exact normalized name among the class's unclaimed profiles.
    SELECT coalesce(array_agg(profile.id ORDER BY profile.id), ARRAY[]::uuid[])
    INTO v_name_candidate_ids
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.record_status = 'active'
      AND profile.normalized_last_name = lower(v_last_name)
      AND (
        profile.normalized_first_name = lower(v_first_name)
        OR lower(btrim(coalesce(profile.preferred_name, ''))) = lower(v_first_name)
      )
      AND EXISTS (
        SELECT 1
        FROM plugin_data.csf_profile_cohort_memberships AS membership
        WHERE membership.organization_id = p_organization_id
          AND membership.profile_id = profile.id
          AND membership.cohort_id = v_code.cohort_id
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
      AND p_confirmed_profile_id IS NOT NULL
      AND p_confirmed_profile_id = v_name_candidate_ids[1]
    THEN
      v_profile_id := v_name_candidate_ids[1];
      v_candidate_ids := v_name_candidate_ids;
      v_match_status := 'auto_linked';
      v_resolution_notes :=
        'Student confirmed the single exact name match through a permanent class code.';
    ELSIF cardinality(v_name_candidate_ids) = 1
      AND p_declined_profile_id IS NOT NULL
      AND p_declined_profile_id = v_name_candidate_ids[1]
    THEN
      -- Recorded so officers can see the near-miss next to the new profile.
      v_candidate_ids := v_name_candidate_ids;
      v_name_candidate_ids := ARRAY[]::uuid[];
      v_match_status := NULL; -- fall through to profile creation below
    ELSIF cardinality(v_name_candidate_ids) = 1 THEN
      v_name_candidate := true;
      v_candidate_ids := v_name_candidate_ids;
      v_match_status := 'needs_review';
      v_resolution_notes :=
        'A class record matches this name; the student has not confirmed it.';
    ELSIF cardinality(v_name_candidate_ids) > 1 THEN
      v_candidate_ids := v_name_candidate_ids;
      v_match_status := 'needs_review';
      v_resolution_notes :=
        'Multiple class records share this name; an officer must connect the right one.';
    END IF;

    IF v_match_status IS NULL THEN
      INSERT INTO plugin_data.csf_profiles (
        organization_id, first_name, last_name, preferred_name,
        personal_email, normalized_first_name, normalized_last_name,
        normalized_personal_email, source_summary
      ) VALUES (
        p_organization_id, v_first_name, v_last_name, v_preferred_name,
        v_email, lower(v_first_name), lower(v_last_name), v_email,
        jsonb_build_object('createdBy', 'permanent_class_code', 'classCodeId', v_code.id)
      )
      RETURNING id INTO v_profile_id;
      v_match_status := 'auto_linked';
      v_resolution_notes := CASE
        WHEN cardinality(v_candidate_ids) > 0
          THEN 'Created after the student declined the class name match.'
        ELSE 'Created from verified account identity through a permanent class code.'
      END;
    END IF;
  ELSIF cardinality(v_candidate_ids) = 1 THEN
    v_profile_id := v_candidate_ids[1];
    IF (v_existing_profile_id IS NOT NULL AND v_existing_profile_id <> v_profile_id)
      OR EXISTS (
        SELECT 1
        FROM plugin_data.csf_profile_accounts AS account
        WHERE account.organization_id = p_organization_id
          AND account.profile_id = v_profile_id
          AND account.status = 'verified'
          AND account.user_id <> p_user_id
      )
      OR NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_profile_cohort_memberships AS membership
        WHERE membership.organization_id = p_organization_id
          AND membership.profile_id = v_profile_id
          AND membership.cohort_id = v_code.cohort_id
          AND membership.status = 'active'
      )
    THEN
      v_match_status := 'needs_review';
      v_resolution_notes := 'Exact email evidence conflicts with an account or lasting class assignment.';
    ELSE
      v_match_status := 'auto_linked';
      v_resolution_notes := 'Connected by one exact verified-email match in the selected class.';
    END IF;
  ELSE
    v_profile_id := NULL;
    v_match_status := 'needs_review';
    v_resolution_notes := 'Multiple profiles share the verified email; no automatic match was made.';
  END IF;

  IF v_match_status = 'auto_linked' THEN
    INSERT INTO public.organization_members (
      organization_id, user_id, role, status
    ) VALUES (
      p_organization_id, p_user_id, 'member', 'active'
    )
    ON CONFLICT (organization_id, user_id) DO UPDATE
    SET status = 'active'
    WHERE public.organization_members.status = 'active';

    IF NOT EXISTS (
      SELECT 1 FROM public.organization_members AS member
      WHERE member.organization_id = p_organization_id
        AND member.user_id = p_user_id
        AND member.status = 'active'
    ) THEN
      RAISE EXCEPTION 'This account has inactive organization access; an administrator must review it.';
    END IF;

    INSERT INTO plugin_data.csf_profile_accounts (
      organization_id, profile_id, user_id, status, is_primary,
      linked_by, linked_at, notes
    ) VALUES (
      p_organization_id, v_profile_id, p_user_id, 'verified', true,
      p_user_id, v_now, 'Connected through an active permanent class code.'
    )
    ON CONFLICT (organization_id, profile_id, user_id) DO UPDATE
    SET status = 'verified',
        is_primary = true,
        linked_by = p_user_id,
        linked_at = v_now,
        revoked_at = NULL,
        notes = EXCLUDED.notes;

    INSERT INTO plugin_data.csf_profile_cohort_memberships (
      organization_id, profile_id, cohort_id, status, updated_at
    ) VALUES (
      p_organization_id, v_profile_id, v_code.cohort_id, 'active', v_now
    )
    ON CONFLICT (profile_id, cohort_id) DO UPDATE
    SET status = 'active', updated_at = v_now;
  END IF;

  INSERT INTO plugin_data.csf_profile_link_requests (
    organization_id, class_join_code_id, cohort_id, user_id,
    signed_in_email, first_name, last_name, preferred_name,
    personal_email, normalized_first_name, normalized_last_name,
    normalized_personal_email, matched_profile_id, candidate_profile_ids,
    match_status, resolution_notes, resolved_by, resolved_at,
    claim_correlation_id, submitted_returning_status, updated_at
  ) VALUES (
    p_organization_id, v_code.id, v_code.cohort_id, p_user_id,
    v_email, v_first_name, v_last_name, v_preferred_name,
    v_email, lower(v_first_name), lower(v_last_name),
    v_email, v_profile_id, v_candidate_ids, v_match_status,
    v_resolution_notes,
    CASE WHEN v_match_status = 'auto_linked' THEN p_user_id END,
    CASE WHEN v_match_status = 'auto_linked' THEN v_now END,
    v_correlation_id, 'unknown', v_now
  )
  ON CONFLICT (organization_id, class_join_code_id, user_id)
    WHERE class_join_code_id IS NOT NULL AND user_id IS NOT NULL
  DO UPDATE
  SET matched_profile_id = EXCLUDED.matched_profile_id,
      candidate_profile_ids = EXCLUDED.candidate_profile_ids,
      match_status = EXCLUDED.match_status,
      resolution_notes = EXCLUDED.resolution_notes,
      resolved_by = EXCLUDED.resolved_by,
      resolved_at = EXCLUDED.resolved_at,
      claim_correlation_id = EXCLUDED.claim_correlation_id,
      updated_at = v_now
  RETURNING id INTO v_request_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action, target_type,
    target_id, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_user_id, v_profile_id,
    CASE WHEN v_match_status = 'auto_linked'
      THEN 'class.join_code.connected' ELSE 'class.join_code.review_requested' END,
    'csf_profile_link_requests', v_request_id,
    jsonb_build_object(
      'cohortId', v_code.cohort_id,
      'classCodeId', v_code.id,
      'matchStatus', v_match_status,
      'candidateCount', cardinality(v_candidate_ids),
      'nameCandidate', v_name_candidate,
      'termMembershipCreated', false
    ),
    v_correlation_id, 'class_join_code', v_code.id::text,
    CASE
      WHEN v_match_status = 'auto_linked'
        AND p_confirmed_profile_id IS NOT NULL
        AND v_profile_id = p_confirmed_profile_id
        THEN 'confirmed_name_class_join'
      WHEN v_match_status = 'auto_linked' THEN 'verified_email_class_join'
      ELSE 'ambiguous_class_join'
    END
  );

  RETURN jsonb_build_object(
    'connected', v_match_status = 'auto_linked',
    'needsReview', v_match_status = 'needs_review',
    'nameCandidate', v_name_candidate,
    'profileId', v_profile_id,
    'requestId', v_request_id,
    'cohortId', v_code.cohort_id,
    'termMembershipCreated', false,
    'replayed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_join_class_by_code(
  uuid, text, uuid, text, text, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_join_class_by_code(
  uuid, text, uuid, text, text, text, text, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_join_class_by_code(
  uuid, text, uuid, text, text, text, text, uuid, uuid
) IS
  'Connects verified account identity to a lasting class; a single exact roster-name match links only with explicit student confirmation, everything ambiguous queues for review, and no path activates a semester membership.';
