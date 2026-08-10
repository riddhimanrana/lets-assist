-- Officer resolution of a CSF account-connection request must rest on a stable
-- identity attribute, never on a similar or even exact name alone.
--
-- The ranked suggestions the officer sees are a discovery aid computed from
-- name and email similarity. Before this migration nothing stopped a one-click
-- "Connect" from binding a student account to a same-named classmate: the
-- resolve RPC checked cohort agreement and account uniqueness, which two
-- distinct students in one class both satisfy.
--
-- The rule added here is deliberately not a score. A connection is authorized
-- only when the account's CURRENT, CONFIRMED authentication address exactly
-- matches an address the chapter already recorded on the student profile:
--
--   * `exact_email` — the confirmed `auth.users.email` for the requesting
--     account exactly equals the profile's school or personal email.
--
-- Request-form email fields remain conflict and review evidence only. They are
-- student-declared data and cannot authorize a binding. Even an exact name that
-- is unique in the requested cohort remains a ranking aid, never identity
-- corroboration: chapters can have incomplete rosters and same-name students.
--
-- Hard conflicts block regardless of corroboration. An officer who can satisfy
-- neither rule corrects the student record's email through the audited member
-- correction workflow first, or rejects the request and issues a direct
-- invitation to the student's real address. There is deliberately no override
-- flag: a bypass that a busy officer can click is the defect being fixed.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_profile_link_connect_evidence(
  p_organization_id uuid,
  p_request_id uuid,
  p_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_request plugin_data.csf_profile_link_requests%ROWTYPE;
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_verified_auth_email text;
  v_request_open boolean := false;
  v_auth_email_matches_snapshot boolean := false;
  v_exact_email_overlap boolean := false;
  v_verified_email_profile_matches integer := 0;
  v_exact_email_corroborated boolean := false;
  v_exact_name_match boolean := false;
  v_profile_active_cohort_count integer := 0;
  v_profile_active_cohort_id uuid;
  v_request_cohort_active boolean := false;
  v_profile_in_request_cohort boolean := false;
  v_same_name_cohort_rivals integer := 0;
  v_unique_exact_name boolean := false;
  v_school_email_conflict boolean := false;
  v_personal_email_conflict boolean := false;
  v_cohort_conflict boolean := false;
  v_profile_claimed_elsewhere boolean := false;
  v_account_claimed_elsewhere boolean := false;
  v_inactive_organization_membership boolean := false;
  v_corroboration text[] := ARRAY[]::text[];
  v_blockers text[] := ARRAY[]::text[];
BEGIN
  SELECT request.*
  INTO v_request
  FROM plugin_data.csf_profile_link_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This connection request no longer exists.';
  END IF;
  v_request_open := v_request.match_status IN ('pending', 'needs_review');

  SELECT profile.*
  INTO v_profile
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_profile_id
    AND profile.record_status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected student record no longer exists.';
  END IF;

  SELECT lower(btrim(account.email))
  INTO v_verified_auth_email
  FROM auth.users AS account
  WHERE account.id = v_request.user_id
    AND account.email_confirmed_at IS NOT NULL
    AND nullif(btrim(account.email), '') IS NOT NULL;

  v_auth_email_matches_snapshot := coalesce(
    v_verified_auth_email = nullif(lower(btrim(v_request.signed_in_email)), ''),
    false
  );

  v_exact_email_overlap := coalesce(
    v_verified_auth_email IS NOT NULL
    AND v_verified_auth_email IN (
      nullif(lower(btrim(v_profile.normalized_school_email)), ''),
      nullif(lower(btrim(v_profile.normalized_personal_email)), '')
    ),
    false
  );

  IF v_verified_auth_email IS NOT NULL THEN
    SELECT count(*)::integer
    INTO v_verified_email_profile_matches
    FROM plugin_data.csf_profiles AS candidate
    WHERE candidate.organization_id = p_organization_id
      AND candidate.record_status = 'active'
      AND (
        lower(btrim(candidate.normalized_school_email)) = v_verified_auth_email
        OR lower(btrim(candidate.normalized_personal_email)) = v_verified_auth_email
      );
  END IF;
  v_exact_email_corroborated :=
    v_auth_email_matches_snapshot
    AND v_exact_email_overlap
    AND v_verified_email_profile_matches = 1;

  v_exact_name_match := coalesce(
    lower(btrim(v_request.normalized_first_name))
      = lower(btrim(v_profile.normalized_first_name))
    AND lower(btrim(v_request.normalized_last_name))
      = lower(btrim(v_profile.normalized_last_name)),
    false
  );

  SELECT
    count(*)::integer,
    (array_agg(membership.cohort_id ORDER BY membership.cohort_id))[1]
  INTO v_profile_active_cohort_count, v_profile_active_cohort_id
  FROM plugin_data.csf_profile_cohort_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = p_profile_id
    AND membership.status = 'active';

  v_request_cohort_active :=
    v_request.cohort_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_cohorts AS cohort
      WHERE cohort.organization_id = p_organization_id
        AND cohort.id = v_request.cohort_id
        AND cohort.status = 'active'
    );
  v_profile_in_request_cohort :=
    v_profile_active_cohort_count = 1
    AND v_profile_active_cohort_id IS NOT DISTINCT FROM v_request.cohort_id;

  IF v_request.cohort_id IS NOT NULL THEN
    -- Name uniqueness remains useful review context, but it never authorizes a
    -- connection. A later roster import can always reveal another namesake.
    SELECT count(*)::integer
    INTO v_same_name_cohort_rivals
    FROM plugin_data.csf_profiles AS rival
    JOIN plugin_data.csf_profile_cohort_memberships AS rival_membership
      ON rival_membership.organization_id = rival.organization_id
     AND rival_membership.profile_id = rival.id
     AND rival_membership.cohort_id = v_request.cohort_id
     AND rival_membership.status = 'active'
    WHERE rival.organization_id = p_organization_id
      AND rival.id <> p_profile_id
      AND rival.record_status = 'active'
      AND lower(btrim(rival.normalized_first_name))
        = lower(btrim(v_profile.normalized_first_name))
      AND lower(btrim(rival.normalized_last_name))
        = lower(btrim(v_profile.normalized_last_name));
  END IF;

  v_unique_exact_name :=
    v_exact_name_match
    AND v_request.cohort_id IS NOT NULL
    AND v_profile_in_request_cohort
    AND v_same_name_cohort_rivals = 0;

  IF v_exact_email_corroborated THEN
    v_corroboration := array_append(v_corroboration, 'exact_email');
  END IF;
  -- Hard conflicts. Each of these is enough to block on its own, even when the
  -- corroboration above is present.
  v_school_email_conflict :=
    nullif(lower(btrim(coalesce(v_request.normalized_school_email, ''))), '') IS NOT NULL
    AND nullif(lower(btrim(coalesce(v_profile.normalized_school_email, ''))), '') IS NOT NULL
    AND lower(btrim(v_request.normalized_school_email))
      <> lower(btrim(v_profile.normalized_school_email));

  v_personal_email_conflict :=
    nullif(lower(btrim(coalesce(v_request.normalized_personal_email, ''))), '') IS NOT NULL
    AND nullif(lower(btrim(coalesce(v_profile.normalized_personal_email, ''))), '') IS NOT NULL
    AND lower(btrim(v_request.normalized_personal_email))
      <> lower(btrim(v_profile.normalized_personal_email));

  v_cohort_conflict :=
    NOT v_request_cohort_active
    OR v_profile_active_cohort_count <> 1
    OR NOT v_profile_in_request_cohort;

  v_profile_claimed_elsewhere := EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = p_profile_id
      AND account.status = 'verified'
      AND account.user_id IS DISTINCT FROM v_request.user_id
  );

  v_account_claimed_elsewhere :=
    v_request.user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id = p_organization_id
        AND account.user_id = v_request.user_id
        AND account.status = 'verified'
      AND account.profile_id <> p_profile_id
    );

  v_inactive_organization_membership :=
    v_request.user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_members AS member
      WHERE member.organization_id = p_organization_id
        AND member.user_id = v_request.user_id
        AND member.status IS DISTINCT FROM 'active'
    );

  IF NOT v_request_open THEN
    v_blockers := array_append(
      v_blockers,
      'This connection request has already been resolved.'
    );
  END IF;
  IF v_request.user_id IS NULL THEN
    v_blockers := array_append(
      v_blockers,
      'The student account is no longer available.'
    );
  ELSIF v_verified_auth_email IS NULL THEN
    v_blockers := array_append(
      v_blockers,
      'The student account does not have a current confirmed email.'
    );
  ELSIF NOT v_auth_email_matches_snapshot THEN
    v_blockers := array_append(
      v_blockers,
      'The account email changed after this request was submitted. Ask the student to submit a new request.'
    );
  END IF;
  IF v_verified_auth_email IS NOT NULL AND NOT v_exact_email_overlap THEN
    v_blockers := array_append(
      v_blockers,
      'The account''s confirmed email does not match this student record.'
    );
  ELSIF v_exact_email_overlap AND v_verified_email_profile_matches <> 1 THEN
    v_blockers := array_append(
      v_blockers,
      'The account''s confirmed email appears on multiple active student records.'
    );
  END IF;
  IF NOT v_exact_name_match THEN
    v_blockers := array_append(
      v_blockers,
      'The request name and student-record name do not match exactly.'
    );
  END IF;

  IF v_school_email_conflict THEN
    v_blockers := array_append(
      v_blockers,
      'The request and the student record carry different school email identities.'
    );
  END IF;
  IF v_personal_email_conflict THEN
    v_blockers := array_append(
      v_blockers,
      'The request and the student record carry different personal email identities.'
    );
  END IF;
  IF v_cohort_conflict THEN
    v_blockers := array_append(
      v_blockers,
      'The student record is active in a different graduating class than the request.'
    );
  END IF;
  IF v_profile_claimed_elsewhere THEN
    v_blockers := array_append(
      v_blockers,
      'That student record is already connected to another verified account.'
    );
  END IF;
  IF v_account_claimed_elsewhere THEN
    v_blockers := array_append(
      v_blockers,
      'This account is already connected to another CSF student record.'
    );
  END IF;
  IF v_inactive_organization_membership THEN
    v_blockers := array_append(
      v_blockers,
      'This account has inactive organization access; reactivate it through organization administration first.'
    );
  END IF;

  RETURN jsonb_build_object(
    'requestId', p_request_id,
    'profileId', p_profile_id,
    'canConnect', cardinality(v_blockers) = 0,
    'corroboration', to_jsonb(v_corroboration),
    'blockers', to_jsonb(v_blockers),
    'evidence', jsonb_build_object(
      'exactEmailOverlap', v_exact_email_overlap,
      'exactEmailUnique', v_verified_email_profile_matches = 1,
      'verifiedEmailProfileMatches', v_verified_email_profile_matches,
      'hasConfirmedAccountEmail', v_verified_auth_email IS NOT NULL,
      'confirmedEmailMatchesRequestSnapshot', v_auth_email_matches_snapshot,
      'exactNameMatch', v_exact_name_match,
      'uniqueExactNameInCohort', v_unique_exact_name,
      'requestCohortScoped', v_request.cohort_id IS NOT NULL,
      'requestCohortActive', v_request_cohort_active,
      'profileInRequestCohort', v_profile_in_request_cohort,
      'activeProfileCohortCount', v_profile_active_cohort_count,
      'sameNameCohortRivals', v_same_name_cohort_rivals,
      'schoolEmailConflict', v_school_email_conflict,
      'personalEmailConflict', v_personal_email_conflict,
      'cohortConflict', v_cohort_conflict,
      'profileClaimedElsewhere', v_profile_claimed_elsewhere,
      'accountClaimedElsewhere', v_account_claimed_elsewhere,
      'inactiveOrganizationMembership', v_inactive_organization_membership
    )
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_resolve_profile_link_request(uuid, uuid, uuid, text, text, uuid)
  RENAME TO csf_resolve_profile_link_request_corroboration_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_resolve_profile_link_request(
  p_organization_id uuid,
  p_request_id uuid,
  p_profile_id uuid,
  p_decision text,
  p_reason text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_evidence jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_request plugin_data.csf_profile_link_requests%ROWTYPE;
  v_result jsonb;
  v_original_correlation_id uuid;
  v_original_membership_granted boolean := false;
BEGIN
  -- Preserve the delegate's authorization-first contract. Besides keeping the
  -- established error semantics, this prevents an unauthorized caller using a
  -- service path from probing whether a request/profile pair has evidence.
  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'manage_profiles'
  ) THEN
    RAISE EXCEPTION 'Not authorized to resolve CSF profile connections.';
  END IF;

  -- A rejection removes no ambiguity and creates no binding, so it delegates
  -- unchanged and keeps its established authorization and reason errors.
  IF p_decision IS DISTINCT FROM 'connect' THEN
    RETURN plugin_data.csf_resolve_profile_link_request_corroboration_base(
      p_organization_id, p_request_id, p_profile_id, p_decision, p_reason,
      p_actor_user_id
    );
  END IF;

  IF v_reason IS NULL OR char_length(v_reason) < 4 THEN
    RAISE EXCEPTION 'A reason of at least four characters is required.';
  END IF;

  -- Authorization and the reason requirement stay in the delegate, and the
  -- delegate re-reads every row under its own FOR UPDATE locks. These table
  -- locks make the evidence computed below the same evidence that decides:
  -- without them a concurrent insert of a same-named classmate, or of a
  -- competing verified account, could land between this check and the write.
  --
  -- The ORDER matches csf_merge_profiles (accounts, then cohort memberships,
  -- then profiles). Both are rare, consequential identity operations that touch
  -- the same three tables; acquiring them in a different order would let a
  -- concurrent merge and connection deadlock each other.
  LOCK TABLE plugin_data.csf_profile_accounts IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE plugin_data.csf_profile_cohort_memberships IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE plugin_data.csf_profiles IN SHARE ROW EXCLUSIVE MODE;

  SELECT request.*
  INTO v_request
  FROM plugin_data.csf_profile_link_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This connection request has already been resolved.';
  END IF;

  -- A lost response must not tempt an officer into a second identity action.
  -- Return the original receipt only for an exact semantic replay whose linked
  -- account, organization access, single class, and immutable audit still all
  -- agree. Any changed target, actor, or rationale remains a hard refusal.
  IF v_request.match_status NOT IN ('pending', 'needs_review') THEN
    IF v_request.match_status = 'resolved'
      AND v_request.matched_profile_id IS NOT DISTINCT FROM p_profile_id
      AND v_request.resolved_by IS NOT DISTINCT FROM p_actor_user_id
      AND nullif(btrim(v_request.resolution_notes), '') IS NOT DISTINCT FROM v_reason
      AND EXISTS (
        SELECT 1
        FROM plugin_data.csf_profiles AS profile
        WHERE profile.organization_id = p_organization_id
          AND profile.id = p_profile_id
          AND profile.record_status = 'active'
      )
      AND EXISTS (
        SELECT 1
        FROM plugin_data.csf_profile_accounts AS account
        WHERE account.organization_id = p_organization_id
          AND account.profile_id = p_profile_id
          AND account.user_id = v_request.user_id
          AND account.status = 'verified'
      )
      AND EXISTS (
        SELECT 1
        FROM public.organization_members AS member
        WHERE member.organization_id = p_organization_id
          AND member.user_id = v_request.user_id
          AND member.status = 'active'
      )
      AND (
        SELECT count(*) = 1
          AND (array_agg(membership.cohort_id ORDER BY membership.cohort_id))[1]
            IS NOT DISTINCT FROM v_request.cohort_id
        FROM plugin_data.csf_profile_cohort_memberships AS membership
        WHERE membership.organization_id = p_organization_id
          AND membership.profile_id = p_profile_id
          AND membership.status = 'active'
      )
    THEN
      SELECT
        audit.correlation_id,
        coalesce((audit.after_data->>'membershipGranted')::boolean, false)
      INTO v_original_correlation_id, v_original_membership_granted
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.actor_user_id = p_actor_user_id
        AND audit.action = 'profile.link_request_resolved'
        AND audit.target_type = 'csf_profile_link_requests'
        AND audit.target_id = p_request_id
        AND audit.after_data->>'decision' = 'connect'
        AND audit.after_data->>'profileId' = p_profile_id::text
        AND audit.after_data->>'reason' = v_reason
      ORDER BY audit.created_at DESC
      LIMIT 1;
      IF v_original_correlation_id IS NOT NULL THEN
        RETURN jsonb_build_object(
          'requestId', p_request_id,
          'decision', 'connect',
          'profileId', p_profile_id,
          'membershipGranted', v_original_membership_granted,
          'correlationId', v_original_correlation_id,
          'idempotentReplay', true
        );
      END IF;
    END IF;
    RAISE EXCEPTION 'This connection request has already been resolved.';
  END IF;

  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'Choose the student record to connect.';
  END IF;
  IF v_request.user_id IS NULL THEN
    RAISE EXCEPTION 'The student account is no longer available.';
  END IF;

  -- Freeze the confirmed auth identity for the consequential evidence read.
  -- FOR SHARE blocks an email/confirmation update until this transaction ends.
  PERFORM 1
  FROM auth.users AS account
  WHERE account.id = v_request.user_id
  FOR SHARE;

  v_evidence := plugin_data.csf_profile_link_connect_evidence(
    p_organization_id, p_request_id, p_profile_id
  );
  IF NOT coalesce((v_evidence->>'canConnect')::boolean, false) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'This CSF account connection is not supported by corroborating identity evidence.',
      DETAIL = (v_evidence->'blockers')::text,
      HINT = 'Record the account''s confirmed email on the correct student profile, or reject this request and invite the student directly.';
  END IF;

  v_result := plugin_data.csf_resolve_profile_link_request_corroboration_base(
    p_organization_id, p_request_id, p_profile_id, p_decision, p_reason,
    p_actor_user_id
  );

  -- Preserve the exact non-PII authority snapshot beside the delegate's
  -- transition audit. Later edits to names, classes, or email fields cannot
  -- erase why this binding was allowed.
  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'profile.link_request_identity_evidence',
    'csf_profile_link_requests',
    p_request_id,
    v_request.term_id,
    '{}'::jsonb,
    jsonb_build_object(
      'profileId', p_profile_id,
      'corroboration', v_evidence->'corroboration',
      'exactEmailOverlap', v_evidence->'evidence'->'exactEmailOverlap',
      'exactEmailUnique', v_evidence->'evidence'->'exactEmailUnique',
      'confirmedEmailMatchesRequestSnapshot',
        v_evidence->'evidence'->'confirmedEmailMatchesRequestSnapshot',
      'exactNameMatch', v_evidence->'evidence'->'exactNameMatch',
      'profileInRequestCohort', v_evidence->'evidence'->'profileInRequestCohort',
      'activeProfileCohortCount',
        v_evidence->'evidence'->'activeProfileCohortCount'
    ),
    (v_result->>'correlationId')::uuid,
    'staff_action',
    p_request_id::text,
    'profile_connection_identity_corroborated'
  );

  RETURN v_result || jsonb_build_object('idempotentReplay', false);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_resolve_profile_link_request_corroboration_base(uuid, uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_link_connect_evidence(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_resolve_profile_link_request(uuid, uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_link_connect_evidence(uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_resolve_profile_link_request(uuid, uuid, uuid, text, text, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_profile_link_connect_evidence(uuid, uuid, uuid) IS
  'Canonical connect evidence for one CSF link request and candidate student record: current confirmed account-email corroboration plus hard identity conflicts. Declared request fields and ranked/name similarity are never authorization evidence.';
COMMENT ON FUNCTION plugin_data.csf_resolve_profile_link_request(uuid, uuid, uuid, text, text, uuid) IS
  'Authorizes first, locks identity state, requires current confirmed unique email plus exact name and single active class corroboration, records non-PII evidence, and returns exact semantic replays idempotently. Rejections are unchanged.';

COMMIT;
