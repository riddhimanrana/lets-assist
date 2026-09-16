-- A student who scans a class QR can never mint their own CSF record.
--
-- Three changes, one boundary:
--
--   1. `csf_join_class_by_code_identity_base` used to create a brand new
--      profile, connect it, and mark the request auto_linked whenever nothing
--      in the class matched the typed name. That is a student writing their
--      own roster record. It now files an officer review request instead, and
--      staff either create the profile or link the returning one. Everything
--      else in that function -- the locks, the access guards, the settled
--      request revalidation, the email candidate union -- is unchanged.
--
--   2. `csf_confirm_class_code_typed_name_match_identity_base` could connect a
--      student on the strength of a typed name alone, recording it as
--      `self_confirmed_account_name`. A name and a class code are both things
--      a classmate knows, so that was never ownership -- and an exact name is
--      no better than a tolerant one, because the attacker types the exact
--      name on purpose. A name may now only *select* a record. The proof is
--      the verified signed-in address matching a contact an officer curated
--      onto that record and onto no other, which is the basis the join path
--      already trusted. Every other outcome is an officer request, and no path
--      mints `self_confirmed_account_name` any more.
--
--      Rows already carrying that basis are left exactly as they are. They
--      were granted under the rule of their day, and withdrawing access from
--      real members is a staff decision, not a migration's.
--
--   3. `csf_record_class_join_member_intent` records what the student said
--      about themselves ("I'm a new member" / "I'm a returning member") on the
--      request the officer reviews, so the queue shows intent, class, and
--      account together. It writes only `submitted_returning_status`, only on
--      an unresolved request owned by that account, so it can neither edit
--      someone else's row nor reopen a settled decision.
--
-- The verified-email and officer-decision connection paths are untouched: a
-- returning member whose account email is already on their record still
-- connects without waiting. No published historical outcome is read or
-- written here.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_join_class_by_code_identity_base(
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
  v_pending_connection_conflict boolean;
  v_match_status text;
  v_resolution_notes text;
  v_correlation_id uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz := pg_catalog.now();
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
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

  IF EXISTS (SELECT 1 FROM public.organization_members m
    WHERE m.organization_id = p_organization_id AND m.user_id = p_user_id
      AND m.status IS DISTINCT FROM 'active') THEN
    RAISE EXCEPTION 'This account has inactive organization access; an administrator must review it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members m
    WHERE m.organization_id=p_organization_id AND m.user_id=p_user_id)
    AND (EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a
      WHERE a.organization_id=p_organization_id AND a.user_id=p_user_id)
      OR EXISTS (SELECT 1 FROM plugin_data.csf_profile_link_requests r
        WHERE r.organization_id=p_organization_id AND r.user_id=p_user_id)) THEN
    RAISE EXCEPTION 'Organization access was removed; an administrator must review it.';
  END IF;
  INSERT INTO public.organization_members (organization_id, user_id, role, status)
    VALUES (p_organization_id, p_user_id, 'member', 'active')
    ON CONFLICT (organization_id, user_id) DO NOTHING;

  SELECT account.profile_id
  INTO v_existing_profile_id
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.user_id = p_user_id
    AND account.status = 'verified'
    AND (account.connection_basis = 'officer_decision'
      OR (account.connection_basis = 'verified_email' AND EXISTS (
        SELECT 1 FROM plugin_data.csf_profiles owned
        WHERE owned.organization_id=account.organization_id AND owned.id=account.profile_id
          AND owned.source_summary->>'createdBy'='permanent_class_code'
          AND owned.source_summary->>'accountOwnerUserId'=p_user_id::text
      )))
  ORDER BY account.linked_at DESC, account.id
  LIMIT 1
  FOR UPDATE;

  v_request_id := plugin_data.csf_class_connection_request_id(
    p_organization_id, v_code.cohort_id, p_user_id);
  SELECT request.match_status, request.matched_profile_id
    INTO v_existing_request_status, v_existing_request_profile_id
    FROM plugin_data.csf_profile_link_requests request
    WHERE request.organization_id=p_organization_id AND request.id=v_request_id;

  IF v_request_id IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts account
      WHERE account.organization_id=p_organization_id AND account.status='pending'
        AND (account.user_id=p_user_id
          OR account.profile_id=coalesce(v_existing_profile_id,v_existing_request_profile_id)))
      INTO v_pending_connection_conflict;
    IF v_existing_request_status <> 'rejected' AND v_existing_profile_id IS NOT NULL
      AND NOT v_pending_connection_conflict
      AND v_existing_request_profile_id = v_existing_profile_id
      AND EXISTS (SELECT 1 FROM plugin_data.csf_profiles p
        WHERE p.organization_id = p_organization_id AND p.id = v_existing_profile_id
          AND p.record_status = 'active')
      AND 1 = (SELECT count(*) FROM plugin_data.csf_profile_cohort_memberships m
        WHERE m.organization_id = p_organization_id AND m.profile_id = v_existing_profile_id
          AND m.status = 'active')
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

    IF v_existing_request_status IN ('auto_linked', 'resolved') THEN
      UPDATE plugin_data.csf_profile_link_requests
      SET match_status = 'needs_review',
          resolution_notes =
            'The previous account connection requires renewed ownership review.',
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
      'profileId', NULL,
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
        OR lower(profile.reported_application_school_email) = v_email
        OR lower(profile.reported_application_personal_email) = v_email
      )
    UNION
    SELECT profile.id FROM plugin_data.csf_profiles profile
    WHERE profile.organization_id = p_organization_id AND profile.record_status = 'active'
      AND profile.id IN (p_confirmed_profile_id, p_declined_profile_id)
      AND EXISTS (SELECT 1 FROM plugin_data.csf_profile_cohort_memberships m
        WHERE m.organization_id = p_organization_id AND m.profile_id = profile.id
          AND m.cohort_id = v_code.cohort_id AND m.status = 'active')
    UNION
    SELECT v_existing_profile_id
    WHERE v_existing_profile_id IS NOT NULL
  ) AS candidate;

  IF v_existing_profile_id IS NOT NULL THEN
    v_profile_id := v_existing_profile_id;

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
          AND account.status = 'pending'
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
      v_resolution_notes := 'Joined using an existing verified account connection.';
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

    -- No self-service profile creation. A student whose name matches nothing
    -- in the class used to get a record minted for them here; now they wait
    -- for an officer, who creates the profile or links the returning record.
    -- The two notes differ so the queue can tell "nobody to match" apart from
    -- "several could match".
    v_profile_id := NULL;
    v_match_status := 'needs_review';
    v_resolution_notes := CASE
      WHEN cardinality(v_candidate_ids) = 0
        THEN 'No record in this class matched; a staff member creates the profile or links a returning record.'
      ELSE 'A staff member must verify ownership before connecting an existing CSF record.'
    END;
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
      THEN 'existing_verified_account_class_join'
      ELSE 'ownership_review_required' END
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

REVOKE ALL ON FUNCTION plugin_data.csf_join_class_by_code_identity_base(uuid,text,uuid,text,text,text,text,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_join_class_by_code_identity_base(uuid,text,uuid,text,text,text,text,uuid,uuid) TO postgres;

COMMENT ON FUNCTION plugin_data.csf_join_class_by_code_identity_base(uuid,text,uuid,text,text,text,text,uuid,uuid) IS
  'Owner-internal class-code connection body. Connects only an account that already owns exactly one active record in the class; every other outcome is an officer review request. Never creates a profile.';

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
    -- Exact only. `nickname` and `prefix` are tolerant matches, and a student
    -- can type an alias they do not own, so those stay with an officer.
    -- coalesced so an absent kind is a plain false, never a NULL that would
    -- propagate into the `needsReview` payload.
    AND coalesce(v_match_kind, '') IN ('exact_full', 'exact')
    AND pg_catalog.cardinality(v_candidates) = 1
    AND v_candidates[1] = p_profile_id
    AND v_existing_profile IS NULL
    -- THE ownership proof. A typed name plus a class code is not one: both are
    -- things a classmate can know and type. The signed-in address is verified
    -- against auth.users above, so requiring it to equal a contact an officer
    -- curated on the record is what makes this a connection rather than a
    -- guess. Only the curated columns count: `reported_application_*` is
    -- documented "Never use for account ownership or automatic connection"
    -- (20260910043037) because a student typed it into their own application.
    AND v_email IN (
      coalesce(v_profile.normalized_school_email, ''),
      coalesce(v_profile.normalized_personal_email, '')
    )
    -- Any account row on the record, including a revoked one, means an
    -- officer has already had reason to look at it.
    AND NOT EXISTS (
      SELECT 1 FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id = p_organization_id
        AND (account.profile_id = p_profile_id OR account.user_id = p_user_id)
    )
    -- Collision guard. The reported columns are untrusted as proof but they
    -- are good evidence of doubt, so a shared address anywhere on another
    -- active record sends this to an officer.
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

  -- Either outcome makes the student an organization member, matching the
  -- class-code join: a review request must not lock them out of the feed.
  INSERT INTO public.organization_members (organization_id, user_id, role, status)
  VALUES (p_organization_id, p_user_id, 'member', 'active')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  IF v_allowed THEN
    -- Unconditional. `v_allowed` already proved the verified signed-in address
    -- is a curated contact on this record and on no other, so there is no
    -- branch left that could mint `self_confirmed_account_name`.
    v_basis := 'verified_email';
    INSERT INTO plugin_data.csf_profile_accounts (
      organization_id, profile_id, user_id, status, is_primary, linked_by,
      linked_at, notes, connection_basis
    ) VALUES (
      p_organization_id, p_profile_id, p_user_id, 'verified', true, p_user_id, v_now,
      'Connected on a verified account email matching a curated contact on this record; the name match ('
        || coalesce(v_match_kind, 'unknown') || ') only selected it.',
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
      THEN 'Connected on a verified account email matching a curated contact on this record (name match: ' || coalesce(v_match_kind, 'unknown') || ').'
      ELSE 'A name match (' || coalesce(v_match_kind, 'none') || ') is a suggestion, not ownership; an officer decides.'
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

REVOKE ALL ON FUNCTION plugin_data.csf_confirm_class_code_typed_name_match_identity_base(uuid,uuid,uuid,text,uuid,uuid,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_confirm_class_code_typed_name_match_identity_base(uuid,uuid,uuid,text,uuid,uuid,text,text)
  TO postgres;
COMMENT ON FUNCTION plugin_data.csf_confirm_class_code_typed_name_match_identity_base(uuid,uuid,uuid,text,uuid,uuid,text,text) IS
  'Owner-internal typed-name confirmation body. Self-connects only on a unique EXACT name match to a fully unclaimed record; nickname and prefix matches become officer review requests.';

-- What the student said about themselves, recorded on the request an officer
-- reviews. Not a decision and not evidence: it only tells staff which question
-- they are answering, "create this new member" or "find this returning record".
CREATE OR REPLACE FUNCTION plugin_data.csf_record_class_join_member_intent(
  p_organization_id uuid,
  p_request_id uuid,
  p_user_id uuid,
  p_intent text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_intent, '')), ''));
  v_request plugin_data.csf_profile_link_requests%ROWTYPE;
BEGIN
  IF v_intent IS NULL OR v_intent NOT IN ('new', 'returning') THEN
    RAISE EXCEPTION 'Choose whether you are a new or returning member.';
  END IF;

  -- Scoped to the account that filed the request and to an unresolved one, so
  -- this can neither touch another student's row nor reopen a settled
  -- decision. A miss is reported, not raised: the request itself already
  -- reached the queue and the intent is a hint on top of it.
  UPDATE plugin_data.csf_profile_link_requests AS request
  SET submitted_returning_status = v_intent,
      updated_at = pg_catalog.now()
  WHERE request.organization_id = p_organization_id
    AND request.id = p_request_id
    AND request.user_id = p_user_id
    AND request.match_status IN ('pending', 'needs_review')
  RETURNING request.* INTO v_request;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('recorded', false);
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_user_id, 'class.join_code.member_intent_declared',
    'csf_profile_link_requests', v_request.id,
    pg_catalog.jsonb_build_object(
      'cohortId', v_request.cohort_id,
      'classCodeId', v_request.class_join_code_id,
      'memberIntent', v_intent),
    coalesce(v_request.claim_correlation_id, pg_catalog.gen_random_uuid()),
    'class_join_code',
    coalesce(v_request.class_join_code_id::text, v_request.id::text),
    'member_intent_declared'
  );

  RETURN pg_catalog.jsonb_build_object(
    'recorded', true,
    'requestId', v_request.id,
    'memberIntent', v_intent
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_record_class_join_member_intent(uuid,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_class_join_member_intent(uuid,uuid,uuid,text)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_record_class_join_member_intent(uuid,uuid,uuid,text) IS
  'Service-only. Records the member''s declared new/returning intent on their own unresolved class-code connection request. Never links, creates, or resolves a record.';

COMMIT;
