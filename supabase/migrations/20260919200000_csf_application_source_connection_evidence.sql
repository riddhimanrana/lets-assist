-- Extend the existing officer-only connection evidence with one bounded
-- alternative to the current roster address. A committed application import
-- row may corroborate the confirmed account address when the row is still
-- bound to the selected active profile and class, its stored hashes agree,
-- and no other active profile carries the same source address.
--
-- The consequential resolve RPC already rechecks this evidence after taking
-- the organization identity lock. This migration changes no automatic join
-- behavior and keeps exact name, one active class, unlinked target, current
-- confirmed account address, and every existing conflict check mandatory.

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
  v_application_source_email_overlap boolean := false;
  v_application_source_email_profile_matches integer := 0;
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
  v_profile_already_linked boolean := false;
  v_account_already_linked boolean := false;
  v_inactive_organization_membership boolean := false;
  v_profile_held_elsewhere boolean := false;
  v_account_held_elsewhere boolean := false;
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
  -- A committed application response is immutable source evidence. Require the
  -- application, import row, profile, organization, and class coordinates to
  -- agree. The stored row hash must still match both frozen copies.
  IF v_verified_auth_email IS NOT NULL THEN
    SELECT
      EXISTS (
        SELECT 1
        FROM plugin_data.csf_term_applications AS application
        JOIN plugin_data.csf_sheet_import_rows AS source_row
          ON source_row.organization_id = application.organization_id
         AND source_row.id = application.source_import_row_id
         AND source_row.matched_profile_id = application.profile_id
        WHERE application.organization_id = p_organization_id
          AND application.profile_id = p_profile_id
          AND application.cohort_id = v_request.cohort_id
          AND source_row.cohort_id = v_request.cohort_id
          AND source_row.import_status IN ('created', 'updated')
          AND source_row.resolution_status = 'resolved'
          AND source_row.commit_frozen_at IS NOT NULL
          AND source_row.row_hash IS NOT NULL
          AND source_row.row_hash = source_row.commit_frozen_row_hash
          AND source_row.row_hash = source_row.normalized_data->>'rowHash'
          AND source_row.normalized_data->>'sourceType' = 'application_responses'
          AND v_verified_auth_email IN (
            nullif(lower(btrim(source_row.normalized_data->'record'->'contact'->>'responseEmail')), ''),
            nullif(lower(btrim(source_row.normalized_data->'record'->'contact'->>'preferredContactEmail')), '')
          )
      ),
      (
        SELECT count(DISTINCT candidate_application.profile_id)::integer
        FROM plugin_data.csf_term_applications AS candidate_application
        JOIN plugin_data.csf_profiles AS candidate_profile
          ON candidate_profile.organization_id = candidate_application.organization_id
         AND candidate_profile.id = candidate_application.profile_id
         AND candidate_profile.record_status = 'active'
        JOIN plugin_data.csf_sheet_import_rows AS candidate_source_row
          ON candidate_source_row.organization_id = candidate_application.organization_id
         AND candidate_source_row.id = candidate_application.source_import_row_id
         AND candidate_source_row.matched_profile_id = candidate_application.profile_id
        WHERE candidate_application.organization_id = p_organization_id
          AND candidate_source_row.import_status IN ('created', 'updated')
          AND candidate_source_row.resolution_status = 'resolved'
          AND candidate_source_row.commit_frozen_at IS NOT NULL
          AND candidate_source_row.row_hash IS NOT NULL
          AND candidate_source_row.row_hash = candidate_source_row.commit_frozen_row_hash
          AND candidate_source_row.row_hash = candidate_source_row.normalized_data->>'rowHash'
          AND candidate_source_row.normalized_data->>'sourceType' = 'application_responses'
          AND v_verified_auth_email IN (
            nullif(lower(btrim(candidate_source_row.normalized_data->'record'->'contact'->>'responseEmail')), ''),
            nullif(lower(btrim(candidate_source_row.normalized_data->'record'->'contact'->>'preferredContactEmail')), '')
          )
      )
    INTO
      v_application_source_email_overlap,
      v_application_source_email_profile_matches;
  END IF;

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

  IF v_auth_email_matches_snapshot
    AND v_exact_email_overlap
    AND v_verified_email_profile_matches = 1
  THEN
    v_corroboration := array_append(v_corroboration, 'exact_email');
  END IF;
  IF v_auth_email_matches_snapshot
    AND v_application_source_email_overlap
    AND v_application_source_email_profile_matches = 1
  THEN
    v_corroboration := array_append(
      v_corroboration,
      'application_source_email'
    );
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

  -- A verified connection elsewhere is a real conflict and still blocks. A
  -- pending one is an unreviewed claim, and this decision is the review, so it
  -- is reported as context and superseded when the officer connects.
  v_profile_claimed_elsewhere := EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = p_profile_id
      AND account.status = 'verified'
      AND account.user_id IS DISTINCT FROM v_request.user_id
  );

  v_profile_already_linked := EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = p_profile_id
      AND account.status = 'verified'
  );

  v_profile_held_elsewhere := EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = p_profile_id
      AND account.status = 'pending'
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

  v_account_already_linked :=
    v_request.user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id = p_organization_id
        AND account.user_id = v_request.user_id
        AND account.status = 'verified'
    );

  v_account_held_elsewhere :=
    v_request.user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id = p_organization_id
        AND account.user_id = v_request.user_id
        AND account.status = 'pending'
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
  IF v_verified_auth_email IS NOT NULL
    AND NOT v_exact_email_overlap
    AND NOT v_application_source_email_overlap
  THEN
    v_blockers := array_append(
      v_blockers,
      'The account''s confirmed email does not match this student record or its committed application source.'
    );
  ELSIF (
    v_exact_email_overlap
    AND v_verified_email_profile_matches <> 1
  ) OR (
    v_application_source_email_overlap
    AND v_application_source_email_profile_matches <> 1
  ) THEN
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
  IF v_profile_already_linked THEN
    v_blockers := array_append(
      v_blockers,
      'That student record is already connected to a verified account.'
    );
  END IF;
  IF v_account_already_linked THEN
    v_blockers := array_append(
      v_blockers,
      'This account is already connected to a CSF student record.'
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
      'applicationSourceEmailOverlap', v_application_source_email_overlap,
      'applicationSourceEmailUnique',
        v_application_source_email_profile_matches = 1,
      'applicationSourceEmailProfileMatches',
        v_application_source_email_profile_matches,
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
      'profileAlreadyLinked', v_profile_already_linked,
      'accountAlreadyLinked', v_account_already_linked,
      'profileHeldByPendingClaim', v_profile_held_elsewhere,
      'accountHeldByPendingClaim', v_account_held_elsewhere,
      'inactiveOrganizationMembership', v_inactive_organization_membership
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_link_connect_evidence(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_link_connect_evidence(uuid,uuid,uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_profile_link_connect_evidence(uuid,uuid,uuid) IS
  'Officer-only connection evidence. Requires current confirmed account identity, exact name, one active class, and an unlinked target. Email corroboration may come from one unique current roster address or one committed immutable application-source row; request-declared data and names alone never authorize a connection.';

COMMIT;
