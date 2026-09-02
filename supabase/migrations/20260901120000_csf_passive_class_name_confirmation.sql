-- Split class-code identity handling into two deliberate paths.
--
-- A manually entered name never creates or links a profile. One exact
-- verified-email record may still connect, while every other outcome creates
-- one durable officer-review request. A separate service-only confirmation
-- function handles the passive account-name candidate shown by the server.
-- It rechecks the active code, verified email, account-name snapshot, class,
-- unique unclaimed roster candidate, and organization access in one
-- transaction. Neither path creates a semester membership.

CREATE OR REPLACE FUNCTION plugin_data.csf_join_class_by_code(
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
  v_email text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_verified_email, '')), ''));
  v_first_name text := nullif(pg_catalog.btrim(coalesce(p_first_name, '')), '');
  v_last_name text := nullif(pg_catalog.btrim(coalesce(p_last_name, '')), '');
  v_preferred_name text := nullif(pg_catalog.btrim(coalesce(p_preferred_name, '')), '');
  v_candidate_ids uuid[] := ARRAY[]::uuid[];
  v_existing_profile_id uuid;
  v_profile_id uuid;
  v_request_id uuid;
  v_existing_request_status text;
  v_existing_request_profile_id uuid;
  v_match_status text;
  v_resolution_notes text;
  v_correlation_id uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz := pg_catalog.now();
BEGIN
  IF p_confirmed_profile_id IS NOT NULL THEN
    RAISE EXCEPTION 'Name-only profile confirmation is no longer supported.';
  END IF;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'A verified account email is required.';
  END IF;
  IF v_first_name IS NULL OR v_last_name IS NULL THEN
    RAISE EXCEPTION 'First and last name are required.';
  END IF;

  SELECT pg_catalog.lower("user".email)
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
    AND code.code = pg_catalog.upper(pg_catalog.btrim(coalesce(p_code, '')))
    AND code.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This CSF class code is no longer active.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':class-code-join:' || p_user_id::text,
      0
    )
  );

  SELECT account.profile_id
  INTO v_existing_profile_id
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.user_id = p_user_id
    AND account.status = 'verified'
  ORDER BY account.linked_at DESC, account.id
  LIMIT 1
  FOR UPDATE;

  SELECT request.id, request.match_status, request.matched_profile_id
  INTO v_request_id, v_existing_request_status, v_existing_request_profile_id
  FROM plugin_data.csf_profile_link_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.class_join_code_id = v_code.id
    AND request.user_id = p_user_id
  ORDER BY request.created_at DESC, request.id
  LIMIT 1
  FOR UPDATE;

  IF v_request_id IS NOT NULL THEN
    IF v_existing_profile_id IS NOT NULL
      AND v_existing_request_profile_id = v_existing_profile_id
      AND EXISTS (
        SELECT 1
        FROM plugin_data.csf_profile_cohort_memberships AS membership
        WHERE membership.organization_id = p_organization_id
          AND membership.profile_id = v_existing_profile_id
          AND membership.cohort_id = v_code.cohort_id
          AND membership.status = 'active'
      )
    THEN
      RETURN pg_catalog.jsonb_build_object(
        'connected', true,
        'needsReview', false,
        'profileId', v_existing_profile_id,
        'requestId', v_request_id,
        'termMembershipCreated', false,
        'replayed', true
      );
    END IF;

    IF v_existing_request_status = 'auto_linked' THEN
      UPDATE plugin_data.csf_profile_link_requests
      SET match_status = 'needs_review',
          resolution_notes =
            'The previous account connection is no longer verified; officer review is required.',
          resolved_by = NULL,
          resolved_at = NULL,
          updated_at = v_now
      WHERE id = v_request_id;

      INSERT INTO plugin_data.csf_admin_audit_events (
        organization_id, actor_user_id, action, target_type, target_id,
        before_data, after_data, correlation_id, source_type, source_id,
        reason_code
      ) VALUES (
        p_organization_id, p_user_id,
        'profile.link_request_revalidation_failed',
        'csf_profile_link_requests', v_request_id,
        pg_catalog.jsonb_build_object(
          'matchStatus', v_existing_request_status,
          'profileId', v_existing_request_profile_id
        ),
        pg_catalog.jsonb_build_object('matchStatus', 'needs_review'),
        v_correlation_id, 'profile_connection_revalidation',
        v_request_id::text,
        'profile_connection_revalidation_required'
      );

      v_existing_request_status := 'needs_review';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'connected', false,
      'needsReview', v_existing_request_status IN ('pending', 'needs_review'),
      'rejected', v_existing_request_status = 'rejected',
      'profileId', v_existing_request_profile_id,
      'requestId', v_request_id,
      'termMembershipCreated', false,
      'replayed', true
    );
  END IF;

  SELECT coalesce(
    pg_catalog.array_agg(DISTINCT candidate.profile_id ORDER BY candidate.profile_id),
    ARRAY[]::uuid[]
  )
  INTO v_candidate_ids
  FROM (
    SELECT profile.id AS profile_id
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.record_status = 'active'
      AND (
        profile.normalized_school_email = v_email
        OR profile.normalized_personal_email = v_email
      )
    UNION
    SELECT v_existing_profile_id
    WHERE v_existing_profile_id IS NOT NULL
  ) AS candidate;

  IF pg_catalog.cardinality(v_candidate_ids) = 1 THEN
    v_profile_id := v_candidate_ids[1];

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_organization_id::text || ':profile-account-link:' || v_profile_id::text,
        0
      )
    );

    PERFORM 1
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = v_profile_id
      AND profile.record_status = 'active'
    FOR UPDATE;

    IF FOUND
      AND (v_existing_profile_id IS NULL OR v_existing_profile_id = v_profile_id)
      AND NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_profile_accounts AS account
        WHERE account.organization_id = p_organization_id
          AND account.profile_id = v_profile_id
          AND account.status = 'verified'
          AND account.user_id <> p_user_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_profile_accounts AS account
        WHERE account.organization_id = p_organization_id
          AND account.status <> 'verified'
          AND (
            account.user_id = p_user_id
            OR account.profile_id = v_profile_id
          )
      )
      AND 1 = (
        SELECT pg_catalog.count(*)
        FROM plugin_data.csf_profile_cohort_memberships AS membership
        WHERE membership.organization_id = p_organization_id
          AND membership.profile_id = v_profile_id
          AND membership.status = 'active'
      )
      AND EXISTS (
        SELECT 1
        FROM plugin_data.csf_profile_cohort_memberships AS membership
        WHERE membership.organization_id = p_organization_id
          AND membership.profile_id = v_profile_id
          AND membership.cohort_id = v_code.cohort_id
          AND membership.status = 'active'
      )
    THEN
      v_match_status := 'auto_linked';
      v_resolution_notes := 'Connected by one exact verified-email match in the selected class.';
    END IF;
  END IF;

  IF v_match_status IS NULL THEN
    IF pg_catalog.cardinality(v_candidate_ids) = 0 THEN
      SELECT coalesce(
        pg_catalog.array_agg(profile.id ORDER BY profile.id),
        ARRAY[]::uuid[]
      )
      INTO v_candidate_ids
      FROM plugin_data.csf_profiles AS profile
      WHERE profile.organization_id = p_organization_id
        AND profile.record_status = 'active'
        AND profile.normalized_last_name = pg_catalog.lower(v_last_name)
        AND (
          profile.normalized_first_name = pg_catalog.lower(v_first_name)
          OR pg_catalog.lower(pg_catalog.btrim(coalesce(profile.preferred_name, ''))) = pg_catalog.lower(v_first_name)
        )
        AND EXISTS (
          SELECT 1
          FROM plugin_data.csf_profile_cohort_memberships AS membership
          WHERE membership.organization_id = p_organization_id
            AND membership.profile_id = profile.id
            AND membership.cohort_id = v_code.cohort_id
            AND membership.status = 'active'
        );
    END IF;

    v_profile_id := NULL;
    v_match_status := 'needs_review';
    v_resolution_notes := CASE
      WHEN pg_catalog.cardinality(v_candidate_ids) = 0
        THEN 'The member entered a name that requires officer review.'
      WHEN pg_catalog.cardinality(v_candidate_ids) = 1
        THEN 'One class record may match the entered name; officer review is required.'
      ELSE 'Several records may match this account; officer review is required.'
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

    INSERT INTO plugin_data.csf_profile_accounts (
      organization_id, profile_id, user_id, status, is_primary,
      linked_by, linked_at, notes
    ) VALUES (
      p_organization_id, v_profile_id, p_user_id, 'verified', true,
      p_user_id, v_now, 'Connected by one exact verified-email class match.'
    )
    ON CONFLICT (organization_id, profile_id, user_id) DO UPDATE
    SET status = 'verified',
        is_primary = true,
        linked_by = p_user_id,
        linked_at = v_now,
        revoked_at = NULL,
        notes = EXCLUDED.notes;
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
    v_email, pg_catalog.lower(v_first_name), pg_catalog.lower(v_last_name),
    v_email, v_profile_id, v_candidate_ids, v_match_status,
    v_resolution_notes,
    CASE WHEN v_match_status = 'auto_linked' THEN p_user_id END,
    CASE WHEN v_match_status = 'auto_linked' THEN v_now END,
    v_correlation_id, 'unknown', v_now
  )
  ON CONFLICT (organization_id, class_join_code_id, user_id)
    WHERE class_join_code_id IS NOT NULL AND user_id IS NOT NULL
  DO UPDATE
  SET signed_in_email = EXCLUDED.signed_in_email,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      preferred_name = EXCLUDED.preferred_name,
      personal_email = EXCLUDED.personal_email,
      normalized_first_name = EXCLUDED.normalized_first_name,
      normalized_last_name = EXCLUDED.normalized_last_name,
      normalized_personal_email = EXCLUDED.normalized_personal_email,
      matched_profile_id = EXCLUDED.matched_profile_id,
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
    pg_catalog.jsonb_build_object(
      'cohortId', v_code.cohort_id,
      'classCodeId', v_code.id,
      'matchStatus', v_match_status,
      'candidateCount', pg_catalog.cardinality(v_candidate_ids),
      'termMembershipCreated', false
    ),
    v_correlation_id, 'class_join_code', v_code.id::text,
    CASE WHEN v_match_status = 'auto_linked'
      THEN 'verified_email_class_join' ELSE 'typed_name_review' END
  );

  RETURN pg_catalog.jsonb_build_object(
    'connected', v_match_status = 'auto_linked',
    'needsReview', v_match_status = 'needs_review',
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
  'Connects one exact verified-email class record or records one officer request. Typed names never create or link profiles, and no path creates semester membership.';

DROP FUNCTION IF EXISTS plugin_data.csf_join_class_by_code_pre_identity_guard(
  uuid, text, uuid, text, text, text, text, uuid, uuid
);

CREATE FUNCTION plugin_data.csf_confirm_class_code_account_name_match(
  p_organization_id uuid,
  p_profile_id uuid,
  p_user_id uuid,
  p_verified_email text,
  p_class_join_code_id uuid,
  p_cohort_id uuid,
  p_normalized_first_name text,
  p_normalized_last_name text,
  p_account_name_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code plugin_data.csf_class_join_codes%ROWTYPE;
  v_auth_email text;
  v_email text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_verified_email, '')), ''));
  v_first_name text := nullif(pg_catalog.btrim(coalesce(p_normalized_first_name, '')), '');
  v_last_name text := nullif(pg_catalog.btrim(coalesce(p_normalized_last_name, '')), '');
  v_supplied_name_hash text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_account_name_hash, '')), ''));
  v_account_name text;
  v_current_name_hash text;
  v_existing_profile_id uuid;
  v_name_candidate_ids uuid[] := ARRAY[]::uuid[];
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_match_status text;
  v_resolution_notes text;
  v_request_id uuid;
  v_existing_request_status text;
  v_forced_review_reason text;
  v_correlation_id uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz := pg_catalog.now();
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'A verified account email is required.';
  END IF;
  IF v_first_name IS NULL OR v_last_name IS NULL THEN
    RAISE EXCEPTION 'First and last name are required.';
  END IF;
  IF v_supplied_name_hash IS NULL OR v_supplied_name_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'The account-name snapshot is invalid.';
  END IF;

  SELECT pg_catalog.lower("user".email)
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
  WHERE code.id = p_class_join_code_id
    AND code.organization_id = p_organization_id
    AND code.cohort_id = p_cohort_id
    AND code.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This CSF class code is no longer active.';
  END IF;

  SELECT pg_catalog.btrim(coalesce(profile.full_name, ''))
  INTO v_account_name
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_account_name = '' THEN
    v_forced_review_reason :=
      'The account name is no longer available; officer review is required.';
  ELSE
    v_current_name_hash := pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_account_name, 'UTF8'), 'sha256'),
      'hex'
    );
    IF v_current_name_hash IS DISTINCT FROM v_supplied_name_hash THEN
      v_forced_review_reason :=
        'The account name changed after this match was prepared.';
    END IF;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':class-code-join:' || p_user_id::text,
      0
    )
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':profile-account-link:' || p_profile_id::text,
      0
    )
  );

  SELECT request.id, request.match_status
  INTO v_request_id, v_existing_request_status
  FROM plugin_data.csf_profile_link_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.class_join_code_id = p_class_join_code_id
    AND request.user_id = p_user_id
  ORDER BY request.created_at DESC, request.id
  LIMIT 1
  FOR UPDATE;
  IF v_existing_request_status = 'rejected' THEN
    RETURN pg_catalog.jsonb_build_object(
      'connected', false,
      'needsReview', false,
      'rejected', true,
      'requestId', v_request_id,
      'termMembershipCreated', false,
      'replayed', true
    );
  END IF;

  SELECT account.profile_id
  INTO v_existing_profile_id
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.user_id = p_user_id
    AND account.status = 'verified'
  ORDER BY account.linked_at DESC, account.id
  LIMIT 1
  FOR UPDATE;

  IF v_existing_profile_id = p_profile_id THEN
    RETURN pg_catalog.jsonb_build_object(
      'connected', true,
      'needsReview', false,
      'profileId', p_profile_id,
      'requestId', v_request_id,
      'termMembershipCreated', false,
      'replayed', true
    );
  END IF;

  IF v_forced_review_reason IS NULL THEN
    SELECT coalesce(
      pg_catalog.array_agg(profile.id ORDER BY profile.id),
      ARRAY[]::uuid[]
    )
    INTO v_name_candidate_ids
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.record_status = 'active'
      AND profile.normalized_last_name = v_last_name
      AND (
        profile.normalized_first_name = v_first_name
        OR pg_catalog.lower(pg_catalog.btrim(coalesce(profile.preferred_name, ''))) = v_first_name
      )
      AND 1 = (
        SELECT pg_catalog.count(*)
        FROM plugin_data.csf_profile_cohort_memberships AS membership
        WHERE membership.organization_id = p_organization_id
          AND membership.profile_id = profile.id
          AND membership.status = 'active'
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
    )
    AND NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id = p_organization_id
        AND account.status <> 'verified'
        AND (
          account.user_id = p_user_id
          OR account.profile_id = profile.id
        )
    );
  END IF;

  IF v_forced_review_reason IS NULL
    AND pg_catalog.cardinality(v_name_candidate_ids) = 1
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

    IF FOUND
      AND NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_profile_accounts AS account
        WHERE account.organization_id = p_organization_id
          AND account.profile_id = p_profile_id
          AND account.status = 'verified'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_profile_accounts AS account
        WHERE account.organization_id = p_organization_id
          AND account.status <> 'verified'
          AND (
            account.user_id = p_user_id
            OR account.profile_id = p_profile_id
          )
      )
      AND 1 = (
        SELECT pg_catalog.count(*)
        FROM plugin_data.csf_profile_cohort_memberships AS membership
        WHERE membership.organization_id = p_organization_id
          AND membership.profile_id = p_profile_id
          AND membership.status = 'active'
      )
      AND EXISTS (
        SELECT 1
        FROM plugin_data.csf_profile_cohort_memberships AS membership
        WHERE membership.organization_id = p_organization_id
          AND membership.profile_id = p_profile_id
          AND membership.cohort_id = p_cohort_id
          AND membership.status = 'active'
      )
    THEN
      v_match_status := 'auto_linked';
      v_resolution_notes := 'The member confirmed the single account-name match in this class.';
    END IF;
  END IF;

  IF v_match_status IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM plugin_data.csf_profiles AS profile
      WHERE profile.organization_id = p_organization_id
        AND profile.id = p_profile_id
    ) AND NOT p_profile_id = ANY(v_name_candidate_ids)
    THEN
      v_name_candidate_ids := ARRAY(
        SELECT DISTINCT candidate_id
        FROM pg_catalog.unnest(v_name_candidate_ids || ARRAY[p_profile_id]) AS candidate_id
        ORDER BY candidate_id
      );
    END IF;
    v_match_status := 'needs_review';
    v_resolution_notes := coalesce(v_forced_review_reason, CASE
      WHEN v_existing_profile_id IS NOT NULL
        THEN 'This account already has a different verified CSF record.'
      WHEN pg_catalog.cardinality(v_name_candidate_ids) > 1
        THEN 'Several class records share this account name.'
      ELSE 'The confirmed account-name match changed before it could be linked.'
    END);
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

    INSERT INTO plugin_data.csf_profile_accounts (
      organization_id, profile_id, user_id, status, is_primary,
      linked_by, linked_at, notes
    ) VALUES (
      p_organization_id, p_profile_id, p_user_id, 'verified', true,
      p_user_id, v_now, 'Connected after the member confirmed the account-name match.'
    )
    ON CONFLICT (organization_id, profile_id, user_id) DO UPDATE
    SET status = 'verified',
        is_primary = true,
        linked_by = p_user_id,
        linked_at = v_now,
        revoked_at = NULL,
        notes = EXCLUDED.notes;
  END IF;

  INSERT INTO plugin_data.csf_profile_link_requests (
    organization_id, class_join_code_id, cohort_id, user_id,
    signed_in_email, first_name, last_name, personal_email,
    normalized_first_name, normalized_last_name, normalized_personal_email,
    matched_profile_id, candidate_profile_ids, match_status,
    resolution_notes, resolved_by, resolved_at,
    claim_correlation_id, submitted_returning_status, updated_at
  ) VALUES (
    p_organization_id, p_class_join_code_id, p_cohort_id, p_user_id,
    v_email,
    coalesce(v_profile.first_name, pg_catalog.initcap(v_first_name)),
    coalesce(v_profile.last_name, pg_catalog.initcap(v_last_name)),
    v_email, v_first_name, v_last_name, v_email,
    CASE WHEN v_match_status = 'auto_linked' THEN p_profile_id END,
    v_name_candidate_ids, v_match_status, v_resolution_notes,
    CASE WHEN v_match_status = 'auto_linked' THEN p_user_id END,
    CASE WHEN v_match_status = 'auto_linked' THEN v_now END,
    v_correlation_id, 'unknown', v_now
  )
  ON CONFLICT (organization_id, class_join_code_id, user_id)
    WHERE class_join_code_id IS NOT NULL AND user_id IS NOT NULL
  DO UPDATE
  SET signed_in_email = EXCLUDED.signed_in_email,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      personal_email = EXCLUDED.personal_email,
      normalized_first_name = EXCLUDED.normalized_first_name,
      normalized_last_name = EXCLUDED.normalized_last_name,
      normalized_personal_email = EXCLUDED.normalized_personal_email,
      matched_profile_id = EXCLUDED.matched_profile_id,
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
    p_organization_id, p_user_id,
    CASE WHEN v_match_status = 'auto_linked' THEN p_profile_id END,
    CASE WHEN v_match_status = 'auto_linked'
      THEN 'profile.account_name_connected'
      ELSE 'profile.account_name_review_requested' END,
    'csf_profile_link_requests', v_request_id,
    pg_catalog.jsonb_build_object(
      'cohortId', p_cohort_id,
      'classCodeId', p_class_join_code_id,
      'matchStatus', v_match_status,
      'candidateCount', pg_catalog.cardinality(v_name_candidate_ids),
      'termMembershipCreated', false
    ),
    v_correlation_id, 'member_account_name_match', v_request_id::text,
    CASE WHEN v_match_status = 'auto_linked'
      THEN 'confirmed_account_name_match' ELSE 'stale_account_name_match' END
  );

  RETURN pg_catalog.jsonb_build_object(
    'connected', v_match_status = 'auto_linked',
    'needsReview', v_match_status = 'needs_review',
    'profileId', CASE WHEN v_match_status = 'auto_linked' THEN p_profile_id END,
    'requestId', v_request_id,
    'termMembershipCreated', false,
    'replayed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_confirm_class_code_account_name_match(
  uuid, uuid, uuid, text, uuid, uuid, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_confirm_class_code_account_name_match(
  uuid, uuid, uuid, text, uuid, uuid, text, text, text
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_confirm_class_code_account_name_match(
  uuid, uuid, uuid, text, uuid, uuid, text, text, text
) IS
  'Links one active, unclaimed class record after a signed account-name confirmation is revalidated. Changed or ambiguous evidence creates one officer request, and no path creates semester membership.';
