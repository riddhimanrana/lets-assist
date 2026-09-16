-- A student who types their own name can connect to their own record.
--
-- Until now, confirming "Is this you?" always produced an officer request,
-- because an editable name is not proof of ownership. That was the right call
-- for a chapter with a handful of officers and a queue of a few dozen. It is
-- the wrong call for a launch where 897 students are on class rosters, 5 have
-- accounts, and every one of the other 892 would otherwise wait on an officer
-- click before seeing anything. The product owner made the trade on
-- 2026-09-15: a student may self-connect when the match is unambiguous and the
-- record is unclaimed, and the connection is recorded as self-confirmed so an
-- officer can see it and undo it.
--
-- What "unambiguous" means here is deliberately narrow and fully deterministic,
-- so the database can recompute it under the identity lock rather than trust
-- the browser:
--
--   * the last name matches exactly (normalized), and
--   * the first name matches exactly, or is a recorded preferred name or
--     nickname, or one is a prefix of the other with the shorter at least three
--     characters ("Sai" for "Saisampath"; not "S"), or the typed full name
--     equals first + middle + last, and
--   * exactly one active record in the class satisfies that, and
--   * that record has no account connection at all, this account has no
--     verified connection in the chapter, and this account's verified email is
--     not the canonical or reported address of some other record.
--
-- Anything looser (a bigram-similar spelling, two records that both fit,
-- a record already claimed) is still an officer request. The old v4 endpoint
-- is left exactly as it was for pages still holding its tokens.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_find_typed_name_candidates(
  p_organization_id uuid,
  p_cohort_id uuid,
  p_typed_full_name text
)
RETURNS TABLE (profile_id uuid, display_name text, match_kind text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH typed AS (
    SELECT
      plugin_data.csf_normalize_identity_part(p_typed_full_name) AS full_name,
      pg_catalog.string_to_array(
        plugin_data.csf_normalize_identity_part(p_typed_full_name), ' '
      ) AS parts
  ),
  typed_parts AS (
    SELECT
      full_name,
      parts[1] AS first_name,
      CASE WHEN pg_catalog.cardinality(parts) > 1
        THEN parts[pg_catalog.cardinality(parts)] ELSE '' END AS last_name
    FROM typed
  ),
  roster AS (
    SELECT
      profile.id,
      profile.normalized_first_name AS first_name,
      profile.normalized_last_name AS last_name,
      plugin_data.csf_normalize_identity_part(pg_catalog.concat_ws(' ',
        profile.first_name,
        nullif(pg_catalog.btrim(profile.middle_name), ''),
        profile.last_name)) AS full_name,
      pg_catalog.concat_ws(' ', profile.first_name, profile.last_name) AS display_name,
      ARRAY(
        SELECT plugin_data.csf_normalize_identity_part(alias)
        FROM pg_catalog.unnest(
          ARRAY[profile.preferred_name] || coalesce(profile.nicknames, ARRAY[]::text[])
        ) AS alias
        WHERE nullif(pg_catalog.btrim(alias), '') IS NOT NULL
      ) AS aliases
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.record_status = 'active'
      AND EXISTS (
        SELECT 1 FROM plugin_data.csf_profile_cohort_memberships AS membership
        WHERE membership.organization_id = p_organization_id
          AND membership.profile_id = profile.id
          AND membership.cohort_id = p_cohort_id
          AND membership.status = 'active'
      )
      -- A record with any live connection is never offered to someone else.
      AND NOT EXISTS (
        SELECT 1 FROM plugin_data.csf_profile_accounts AS account
        WHERE account.organization_id = p_organization_id
          AND account.profile_id = profile.id
          AND account.status IN ('pending', 'verified')
      )
  )
  SELECT
    roster.id,
    roster.display_name,
    CASE
      WHEN roster.full_name = typed_parts.full_name THEN 'exact_full'
      WHEN roster.first_name = typed_parts.first_name THEN 'exact'
      WHEN typed_parts.first_name = ANY(roster.aliases) THEN 'nickname'
      ELSE 'prefix'
    END AS match_kind
  FROM roster, typed_parts
  WHERE typed_parts.last_name <> ''
    AND typed_parts.first_name <> ''
    AND roster.last_name = typed_parts.last_name
    AND (
      roster.full_name = typed_parts.full_name
      OR roster.first_name = typed_parts.first_name
      OR typed_parts.first_name = ANY(roster.aliases)
      OR (
        pg_catalog.length(roster.first_name) >= 3
        AND pg_catalog.length(typed_parts.first_name) >= 3
        AND (
          roster.first_name LIKE typed_parts.first_name || '%'
          OR typed_parts.first_name LIKE roster.first_name || '%'
        )
      )
    )
  ORDER BY
    CASE
      WHEN roster.full_name = typed_parts.full_name THEN 0
      WHEN roster.first_name = typed_parts.first_name THEN 1
      WHEN typed_parts.first_name = ANY(roster.aliases) THEN 2
      ELSE 3
    END,
    roster.id;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_find_typed_name_candidates(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_find_typed_name_candidates(uuid,uuid,text)
  TO service_role;
COMMENT ON FUNCTION plugin_data.csf_find_typed_name_candidates(uuid,uuid,text) IS
  'Unclaimed active records in one class whose name tolerantly matches a typed full name: exact, preferred name or nickname, or a first-name prefix of at least three characters on an exact last name. Deterministic; the confirm RPC recomputes it.';

CREATE OR REPLACE FUNCTION plugin_data.csf_confirm_class_code_typed_name_match_identity_base(
  p_organization_id uuid,
  p_profile_id uuid,
  p_user_id uuid,
  p_verified_email text,
  p_class_join_code_id uuid,
  p_cohort_id uuid,
  p_typed_full_name text,
  p_typed_name_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := plugin_data.csf_normalize_email_text(p_verified_email);
  v_auth_email text;
  v_code plugin_data.csf_class_join_codes%ROWTYPE;
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_request plugin_data.csf_profile_link_requests%ROWTYPE;
  v_typed text := pg_catalog.btrim(coalesce(p_typed_full_name, ''));
  v_typed_first text;
  v_typed_last text;
  v_candidates uuid[] := ARRAY[]::uuid[];
  v_match_kind text;
  v_existing_profile uuid;
  v_allowed boolean := false;
  v_basis text;
  v_request_id uuid;
  v_correlation uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz := pg_catalog.now();
  v_result jsonb;
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'A verified account email is required.';
  END IF;
  SELECT plugin_data.csf_normalize_email_text(u.email) INTO v_auth_email
  FROM auth.users AS u
  WHERE u.id = p_user_id AND u.email_confirmed_at IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND OR v_auth_email IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'Use the verified email on your signed-in account.';
  END IF;
  IF v_typed = '' OR p_typed_name_hash !~ '^[a-f0-9]{64}$'
    OR p_typed_name_hash <> pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_typed, 'UTF8'), 'sha256'), 'hex')
  THEN
    -- The token was minted for a different name than the one being confirmed.
    RAISE EXCEPTION 'The name changed after this match was prepared.';
  END IF;

  SELECT code.* INTO v_code
  FROM plugin_data.csf_class_join_codes AS code
  WHERE code.organization_id = p_organization_id
    AND code.id = p_class_join_code_id
    AND code.cohort_id = p_cohort_id
    AND code.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This CSF class code is no longer active.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.organization_members AS member
    WHERE member.organization_id = p_organization_id
      AND member.user_id = p_user_id
      AND member.status IS DISTINCT FROM 'active'
  ) THEN
    RAISE EXCEPTION 'This account has inactive organization access; an administrator must review it.';
  END IF;

  SELECT request.* INTO v_request
  FROM plugin_data.csf_profile_link_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.class_join_code_id = p_class_join_code_id
    AND request.user_id = p_user_id
  FOR UPDATE;
  SELECT account.profile_id INTO v_existing_profile
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.user_id = p_user_id
    AND account.status = 'verified'
  FOR UPDATE;

  -- Replays: a settled request answers the same way every time.
  IF v_request.id IS NOT NULL AND v_request.match_status = 'rejected' THEN
    RETURN pg_catalog.jsonb_build_object(
      'connected', false, 'needsReview', false, 'rejected', true,
      'requestId', v_request.id, 'termMembershipCreated', false, 'replayed', true);
  END IF;
  IF v_request.matched_profile_id = p_profile_id
    AND (v_existing_profile = p_profile_id
      OR v_request.match_status IN ('auto_linked', 'resolved'))
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'connected', true, 'needsReview', false,
      'profileId', p_profile_id, 'requestId', v_request.id,
      'termMembershipCreated', false, 'replayed', true);
  END IF;
  IF v_request.id IS NOT NULL
    AND v_request.match_status IN ('pending', 'needs_review')
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'connected', false, 'needsReview', true,
      'requestId', v_request.id, 'termMembershipCreated', false, 'replayed', true);
  END IF;

  SELECT profile.* INTO v_profile
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_profile_id
    AND profile.record_status = 'active'
  FOR UPDATE;

  SELECT
    coalesce(pg_catalog.array_agg(candidate.profile_id ORDER BY candidate.profile_id), ARRAY[]::uuid[]),
    pg_catalog.max(candidate.match_kind) FILTER (WHERE candidate.profile_id = p_profile_id)
  INTO v_candidates, v_match_kind
  FROM plugin_data.csf_find_typed_name_candidates(
    p_organization_id, p_cohort_id, v_typed
  ) AS candidate;

  v_allowed := FOUND
    AND v_profile.id IS NOT NULL
    AND pg_catalog.cardinality(v_candidates) = 1
    AND v_candidates[1] = p_profile_id
    AND v_existing_profile IS NULL
    -- Any account row on the record, including a revoked one, means an
    -- officer has already had reason to look at it.
    AND NOT EXISTS (
      SELECT 1 FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id = p_organization_id
        AND (account.profile_id = p_profile_id OR account.user_id = p_user_id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM plugin_data.csf_profiles AS other
      WHERE other.organization_id = p_organization_id
        AND other.record_status = 'active'
        AND other.id <> p_profile_id
        AND v_email IN (
          other.normalized_school_email, other.normalized_personal_email,
          pg_catalog.lower(other.reported_application_school_email),
          pg_catalog.lower(other.reported_application_personal_email)
        )
    );

  IF v_allowed THEN
    v_basis := CASE
      WHEN v_email IN (
        v_profile.normalized_school_email, v_profile.normalized_personal_email,
        pg_catalog.lower(v_profile.reported_application_school_email),
        pg_catalog.lower(v_profile.reported_application_personal_email)
      ) THEN 'verified_email'
      ELSE 'self_confirmed_account_name'
    END;
    INSERT INTO public.organization_members (organization_id, user_id, role, status)
    VALUES (p_organization_id, p_user_id, 'member', 'active')
    ON CONFLICT (organization_id, user_id) DO NOTHING;
    INSERT INTO plugin_data.csf_profile_accounts (
      organization_id, profile_id, user_id, status, is_primary, linked_by,
      linked_at, notes, connection_basis
    ) VALUES (
      p_organization_id, p_profile_id, p_user_id, 'verified', true, p_user_id, v_now,
      'Connected after the member confirmed the name match (' || coalesce(v_match_kind, 'unknown') || ').',
      v_basis
    );
  END IF;

  SELECT pg_catalog.split_part(v_typed, ' ', 1),
    CASE WHEN pg_catalog.strpos(v_typed, ' ') > 0
      THEN pg_catalog.regexp_replace(v_typed, '^.*\s', '') ELSE '' END
  INTO v_typed_first, v_typed_last;

  INSERT INTO plugin_data.csf_profile_link_requests (
    organization_id, class_join_code_id, cohort_id, user_id,
    signed_in_email, first_name, last_name, personal_email,
    normalized_first_name, normalized_last_name, normalized_personal_email,
    matched_profile_id, candidate_profile_ids, match_status, resolution_notes,
    resolved_by, resolved_at, claim_correlation_id, submitted_returning_status, updated_at
  ) VALUES (
    p_organization_id, p_class_join_code_id, p_cohort_id, p_user_id,
    v_email,
    coalesce(nullif(v_typed_first, ''), 'Member'),
    coalesce(nullif(v_typed_last, ''), 'Record'),
    v_email,
    plugin_data.csf_normalize_identity_part(v_typed_first),
    plugin_data.csf_normalize_identity_part(v_typed_last),
    v_email,
    CASE WHEN v_allowed THEN p_profile_id END,
    v_candidates,
    CASE WHEN v_allowed THEN 'auto_linked' ELSE 'needs_review' END,
    CASE WHEN v_allowed
      THEN 'The member confirmed the single name match in this class (' || coalesce(v_match_kind, 'unknown') || ').'
      ELSE 'The member confirmed a name match that was not unambiguous; an officer decides.'
    END,
    CASE WHEN v_allowed THEN p_user_id END,
    CASE WHEN v_allowed THEN v_now END,
    v_correlation, 'unknown', v_now
  )
  ON CONFLICT (organization_id, class_join_code_id, user_id)
    WHERE class_join_code_id IS NOT NULL AND user_id IS NOT NULL
    DO UPDATE SET updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_request_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action, target_type, target_id,
    after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_user_id, CASE WHEN v_allowed THEN p_profile_id END,
    CASE WHEN v_allowed THEN 'profile.typed_name_connected' ELSE 'profile.typed_name_review_requested' END,
    'csf_profile_link_requests', v_request_id,
    pg_catalog.jsonb_build_object(
      'cohortId', p_cohort_id, 'classCodeId', p_class_join_code_id,
      'matchStatus', CASE WHEN v_allowed THEN 'auto_linked' ELSE 'needs_review' END,
      'matchKind', v_match_kind, 'connectionBasis', v_basis,
      'typedNameHash', p_typed_name_hash,
      'candidateCount', pg_catalog.cardinality(v_candidates),
      'termMembershipCreated', false),
    v_correlation, 'member_typed_name_match', v_request_id::text,
    CASE WHEN v_allowed THEN 'confirmed_typed_name_match' ELSE 'ambiguous_typed_name_match' END
  );

  v_result := pg_catalog.jsonb_build_object(
    'connected', v_allowed, 'needsReview', NOT v_allowed,
    'profileId', CASE WHEN v_allowed THEN p_profile_id END,
    'requestId', v_request_id,
    'connectionBasis', v_basis,
    'verifiedEmailMatch', coalesce(v_basis = 'verified_email', false),
    'matchKind', v_match_kind,
    'termMembershipCreated', false, 'replayed', false);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_confirm_class_code_typed_name_match(
  p_organization_id uuid,
  p_profile_id uuid,
  p_user_id uuid,
  p_verified_email text,
  p_class_join_code_id uuid,
  p_cohort_id uuid,
  p_typed_full_name text,
  p_typed_name_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Same lock as every other identity mutation, taken first.
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  v_result := plugin_data.csf_confirm_class_code_typed_name_match_identity_base(
    p_organization_id, p_profile_id, p_user_id, p_verified_email,
    p_class_join_code_id, p_cohort_id, p_typed_full_name, p_typed_name_hash
  );
  RETURN plugin_data.csf_revalidate_class_code_connection_replay(
    p_organization_id, p_user_id,
    nullif(v_result ->> 'profileId', '')::uuid,
    nullif(v_result ->> 'requestId', '')::uuid,
    v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_confirm_class_code_typed_name_match_identity_base(uuid,uuid,uuid,text,uuid,uuid,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_confirm_class_code_typed_name_match_identity_base(uuid,uuid,uuid,text,uuid,uuid,text,text)
  TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_confirm_class_code_typed_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_confirm_class_code_typed_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text)
  TO service_role;
COMMENT ON FUNCTION plugin_data.csf_confirm_class_code_typed_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text) IS
  'Connects a verified account to the one unclaimed class record its typed name unambiguously matches, recording the basis as self-confirmed; any ambiguity becomes an officer request. Product decision of 2026-09-15 superseding contract invariant 8 for this path.';

COMMIT;
