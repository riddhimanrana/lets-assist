BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_staff_connect_profile_account(
  p_organization_id uuid, p_profile_id uuid, p_actor_user_id uuid,
  p_account_email text, p_reason text, p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_email text := plugin_data.csf_normalize_email_text(p_account_email);
  v_reason text := nullif(btrim(p_reason),'');
  v_user_id uuid;
  v_account_id uuid;
  v_cohort_id uuid;
  v_audit plugin_data.csf_admin_audit_events%ROWTYPE;
  v_link_request plugin_data.csf_profile_link_requests%ROWTYPE;
  v_resolved_request plugin_data.csf_profile_link_requests%ROWTYPE;
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_profiles') THEN
    RAISE EXCEPTION 'Not authorized to connect CSF accounts.' USING ERRCODE='42501';
  END IF;
  IF p_request_id IS NULL OR v_email IS NULL OR v_reason IS NULL OR length(v_reason)<8 OR length(v_reason)>500 THEN
    RAISE EXCEPTION 'Enter the account email and an identity verification reason of 8 to 500 characters.';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_profiles') THEN
    RAISE EXCEPTION 'Not authorized to connect CSF accounts.' USING ERRCODE='42501';
  END IF;
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  SELECT * INTO v_audit FROM plugin_data.csf_admin_audit_events
    WHERE organization_id=p_organization_id AND correlation_id=p_request_id
      AND action='profile.account_connected_by_staff' LIMIT 1;
  IF FOUND THEN
    IF v_audit.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_audit.after_data->>'profileId' IS DISTINCT FROM p_profile_id::text
      OR v_audit.after_data->>'emailDigest' IS DISTINCT FROM md5(v_email)
      OR v_audit.after_data->>'reason' IS DISTINCT FROM v_reason THEN
      RAISE EXCEPTION 'This request ID was already used for a different connection.';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM plugin_data.csf_profile_accounts
      WHERE organization_id=p_organization_id AND id=v_audit.target_id AND profile_id=p_profile_id AND status='verified') THEN
      RAISE EXCEPTION 'This account connection has changed. Reload before continuing.';
    END IF;
    RETURN jsonb_build_object('accountId',v_audit.target_id,'profileId',p_profile_id,'replayed',true);
  END IF;
  PERFORM 1 FROM plugin_data.csf_profiles WHERE organization_id=p_organization_id AND id=p_profile_id AND record_status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active CSF profile in this organization.'; END IF;
  IF (SELECT count(*) FROM plugin_data.csf_profile_cohort_memberships m
    JOIN plugin_data.csf_cohorts c ON c.organization_id=m.organization_id AND c.id=m.cohort_id AND c.status='active'
    WHERE m.organization_id=p_organization_id AND m.profile_id=p_profile_id AND m.status='active')<>1 THEN
    RAISE EXCEPTION 'The CSF profile must have one active class.';
  END IF;
  SELECT m.cohort_id INTO v_cohort_id FROM plugin_data.csf_profile_cohort_memberships m
    JOIN plugin_data.csf_cohorts c ON c.organization_id=m.organization_id AND c.id=m.cohort_id AND c.status='active'
    WHERE m.organization_id=p_organization_id AND m.profile_id=p_profile_id AND m.status='active';
  IF (SELECT count(*) FROM auth.users u JOIN public.organization_members m ON m.user_id=u.id AND m.organization_id=p_organization_id AND m.status='active' WHERE lower(btrim(u.email))=v_email AND u.email_confirmed_at IS NOT NULL)<>1 THEN
    RAISE EXCEPTION 'Exactly one active organization member must have that confirmed login email.';
  END IF;
  BEGIN
  SELECT u.id INTO STRICT v_user_id FROM auth.users u
    JOIN public.organization_members m ON m.user_id=u.id AND m.organization_id=p_organization_id AND m.status='active'
    WHERE lower(btrim(u.email))=v_email AND u.email_confirmed_at IS NOT NULL
    FOR SHARE OF u,m;
  EXCEPTION WHEN no_data_found OR too_many_rows THEN
    RAISE EXCEPTION 'Exactly one active organization member must have that confirmed login email.';
  END;
  IF NOT FOUND THEN RAISE EXCEPTION 'No active organization member has that confirmed login email. Ask them to join the organization first.'; END IF;
  IF EXISTS(SELECT 1 FROM plugin_data.csf_profile_accounts WHERE organization_id=p_organization_id AND user_id=v_user_id AND status='verified') THEN
    RAISE EXCEPTION 'This account is already connected. Unlink the incorrect connection before moving it.';
  END IF;
  IF EXISTS(SELECT 1 FROM plugin_data.csf_profile_accounts WHERE organization_id=p_organization_id AND profile_id=p_profile_id AND status='verified') THEN
    RAISE EXCEPTION 'This CSF profile already has a connected account. Review it before replacing it.';
  END IF;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id=p_organization_id AND status='pending'
      AND ((user_id=v_user_id AND profile_id<>p_profile_id)
        OR (profile_id=p_profile_id AND user_id<>v_user_id))) THEN
    RAISE EXCEPTION 'A competing account connection is awaiting ownership review. Resolve that hold first.';
  END IF;
  INSERT INTO plugin_data.csf_profile_accounts(organization_id,profile_id,user_id,status,is_primary,linked_by,linked_at,notes,connection_basis)
    VALUES(p_organization_id,p_profile_id,v_user_id,'verified',true,p_actor_user_id,now(),v_reason,'officer_decision')
    ON CONFLICT(organization_id,profile_id,user_id) DO UPDATE SET
      status='verified',is_primary=true,linked_by=excluded.linked_by,linked_at=excluded.linked_at,revoked_at=NULL,notes=excluded.notes,connection_basis='officer_decision'
    RETURNING id INTO v_account_id;
  INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,actor_profile_id,action,target_type,target_id,before_data,after_data,correlation_id,reason_code)
    VALUES(p_organization_id,p_actor_user_id,NULL,'profile.account_connected_by_staff','csf_profile_accounts',v_account_id,'{}',
      jsonb_build_object('profileId',p_profile_id,'userId',v_user_id,'cohortId',v_cohort_id,'emailDigest',md5(v_email),'reason',v_reason,'connectionBasis','officer_decision'),p_request_id,'staff_verified_identity');
  FOR v_link_request IN SELECT * FROM plugin_data.csf_profile_link_requests
    WHERE organization_id=p_organization_id AND user_id=v_user_id AND cohort_id=v_cohort_id
      AND match_status IN('pending','needs_review') ORDER BY id FOR UPDATE
  LOOP
    UPDATE plugin_data.csf_profile_link_requests SET match_status='resolved',matched_profile_id=p_profile_id,
      resolved_by=p_actor_user_id,resolved_at=now(),resolution_notes=v_reason
      WHERE organization_id=p_organization_id AND id=v_link_request.id
      RETURNING * INTO v_resolved_request;
    INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,actor_profile_id,
      action,target_type,target_id,before_data,after_data,correlation_id,reason_code)
      VALUES(p_organization_id,p_actor_user_id,NULL,'profile.link_request_resolved_by_staff',
        'csf_profile_link_requests',v_link_request.id,to_jsonb(v_link_request),
        to_jsonb(v_resolved_request),p_request_id,'staff_verified_identity');
  END LOOP;
  RETURN jsonb_build_object('accountId',v_account_id,'profileId',p_profile_id,'replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid) TO service_role;

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
      AND account.status IN ('verified', 'pending')
      AND account.user_id IS DISTINCT FROM v_request.user_id
  );

  v_account_claimed_elsewhere :=
    v_request.user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id = p_organization_id
        AND account.user_id = v_request.user_id
        AND account.status IN ('verified', 'pending')
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
REVOKE ALL ON FUNCTION plugin_data.csf_profile_link_connect_evidence(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_link_connect_evidence(uuid,uuid,uuid) TO service_role;


-- Preserve the generic operation UUID. Queue decisions also bind a real request.
CREATE OR REPLACE FUNCTION plugin_data.csf_staff_connect_requested_profile_account(
  p_organization_id uuid, p_profile_id uuid, p_actor_user_id uuid,
  p_account_email text, p_reason text, p_request_id uuid, p_link_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_request plugin_data.csf_profile_link_requests%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_result jsonb;
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_profiles') THEN
    RAISE EXCEPTION 'Not authorized to connect CSF accounts.' USING ERRCODE='42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_profiles') THEN
    RAISE EXCEPTION 'Not authorized to connect CSF accounts.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_request FROM plugin_data.csf_profile_link_requests
    WHERE organization_id=p_organization_id AND id=p_link_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.user_id IS NULL OR v_request.cohort_id IS NULL THEN
    RAISE EXCEPTION 'Choose an account connection request in this organization.';
  END IF;
  SELECT * INTO v_receipt FROM plugin_data.csf_admin_audit_events
    WHERE organization_id=p_organization_id AND correlation_id=p_request_id
      AND action='profile.request_account_connected_by_staff' LIMIT 1;
  IF FOUND THEN
    IF v_receipt.target_id IS DISTINCT FROM p_link_request_id
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.after_data->>'profileId' IS DISTINCT FROM p_profile_id::text
      OR v_receipt.after_data->>'userId' IS DISTINCT FROM v_request.user_id::text THEN
      RAISE EXCEPTION 'This request ID was already used for a different connection.';
    END IF;
    RETURN plugin_data.csf_staff_connect_profile_account(p_organization_id,p_profile_id,
      p_actor_user_id,p_account_email,p_reason,p_request_id);
  END IF;
  IF EXISTS(SELECT 1 FROM plugin_data.csf_admin_audit_events
    WHERE organization_id=p_organization_id AND correlation_id=p_request_id
      AND action='profile.account_connected_by_staff') THEN
    RAISE EXCEPTION 'This request ID was already used for a different connection.';
  END IF;
  IF v_request.match_status NOT IN ('pending','needs_review') THEN
    RAISE EXCEPTION 'This connection request has already been decided. Reload before continuing.';
  END IF;
  PERFORM 1 FROM auth.users u
    WHERE u.id=v_request.user_id AND u.email_confirmed_at IS NOT NULL
      AND plugin_data.csf_normalize_email_text(u.email)=plugin_data.csf_normalize_email_text(p_account_email)
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The requesting account email changed. Open the student record to verify their current account, then refresh this queue.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM plugin_data.csf_profile_cohort_memberships m
    WHERE m.organization_id=p_organization_id AND m.profile_id=p_profile_id
      AND m.cohort_id=v_request.cohort_id AND m.status='active') THEN
    RAISE EXCEPTION 'Choose a student record in the request class.';
  END IF;
  v_result := plugin_data.csf_staff_connect_profile_account(p_organization_id,p_profile_id,
    p_actor_user_id,p_account_email,p_reason,p_request_id);
  INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,
    target_type,target_id,before_data,after_data,correlation_id,reason_code)
    VALUES(p_organization_id,p_actor_user_id,'profile.request_account_connected_by_staff',
      'csf_profile_link_requests',p_link_request_id,
      jsonb_build_object('matchStatus',v_request.match_status),
      jsonb_build_object('profileId',p_profile_id,'userId',v_request.user_id,'cohortId',v_request.cohort_id),
      p_request_id,'staff_verified_identity');
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_staff_connect_requested_profile_account(uuid,uuid,uuid,text,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_staff_connect_requested_profile_account(uuid,uuid,uuid,text,text,uuid,uuid) TO service_role;

-- Existing duplicate rows stay intact as evidence. Conflicting decisions fail closed.
CREATE OR REPLACE FUNCTION plugin_data.csf_class_connection_request_id(
  p_organization_id uuid, p_cohort_id uuid, p_user_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_request_id uuid;
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':class-connection:' || p_cohort_id::text || ':' || p_user_id::text,0));
  PERFORM 1 FROM plugin_data.csf_profile_link_requests
    WHERE organization_id=p_organization_id AND cohort_id=p_cohort_id AND user_id=p_user_id
    ORDER BY id FOR UPDATE;
  IF (SELECT count(DISTINCT CASE WHEN match_status='rejected' THEN 'rejected'
      ELSE 'connected:' || coalesce(matched_profile_id::text,'missing') END)
    FROM plugin_data.csf_profile_link_requests
    WHERE organization_id=p_organization_id AND cohort_id=p_cohort_id AND user_id=p_user_id
      AND match_status IN ('rejected','resolved','auto_linked'))>1 THEN
    RAISE EXCEPTION 'This class has conflicting connection decisions. Staff must review them before you can continue.';
  END IF;
  SELECT id INTO v_request_id FROM plugin_data.csf_profile_link_requests
    WHERE organization_id=p_organization_id AND cohort_id=p_cohort_id AND user_id=p_user_id
    ORDER BY CASE WHEN match_status IN ('rejected','resolved','auto_linked') THEN 0 ELSE 1 END,
      created_at,id LIMIT 1;
  RETURN v_request_id;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_class_connection_request_id(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_class_connection_request_id(uuid,uuid,uuid) TO postgres;
-- A revoked connection is history, not a live ownership conflict.
-- Preserve pending conflicts and independently verified returning-account checks.
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
  v_new_profile boolean := false;
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
    IF v_existing_request_status <> 'rejected' AND v_existing_profile_id IS NOT NULL
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

    IF cardinality(v_candidate_ids) = 0
      AND p_confirmed_profile_id IS NULL AND p_declined_profile_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a
        WHERE a.organization_id = p_organization_id AND a.user_id = p_user_id)
    THEN
      INSERT INTO plugin_data.csf_profiles (
        organization_id, first_name, last_name, preferred_name, personal_email,
        normalized_first_name, normalized_last_name, normalized_personal_email, source_summary
      ) VALUES (p_organization_id, v_first_name, v_last_name, v_preferred_name, v_email,
        lower(v_first_name), lower(v_last_name), v_email,
        jsonb_build_object('createdBy','permanent_class_code','classCodeId',v_code.id,'accountOwnerUserId',p_user_id))
      RETURNING id INTO v_profile_id;
      INSERT INTO plugin_data.csf_profile_cohort_memberships
        (organization_id, profile_id, cohort_id, status)
        VALUES (p_organization_id, v_profile_id, v_code.cohort_id, 'active');
      v_new_profile := true;
      v_match_status := 'auto_linked';
      v_resolution_notes := 'Created a new profile for the verified signed-in account.';
    ELSE
      v_profile_id := NULL;
      v_match_status := 'needs_review';
      v_resolution_notes := 'A staff member must verify ownership before connecting an existing CSF record.';
    END IF;
  END IF;

  IF v_new_profile THEN
    INSERT INTO plugin_data.csf_profile_accounts (
      organization_id, profile_id, user_id, status, is_primary,
      linked_by, linked_at, notes, connection_basis
    ) VALUES (p_organization_id, v_profile_id, p_user_id, 'verified', true,
      p_user_id, v_now, 'Created with a new profile for the verified account.', 'verified_email');
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
    CASE WHEN v_new_profile THEN 'verified_email_class_join'
      WHEN v_match_status = 'auto_linked' THEN 'existing_verified_account_class_join'
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
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_join_class_by_code_identity_base(uuid,text,uuid,text,text,text,text,uuid,uuid) TO postgres;

-- Rotation changes the admission code, not an existing verified connection.
CREATE OR REPLACE FUNCTION plugin_data.csf_revalidate_class_code_connection_replay_legacy(
  p_organization_id uuid,
  p_user_id uuid,
  p_profile_id uuid,
  p_request_id uuid,
  p_result jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request plugin_data.csf_profile_link_requests%ROWTYPE;
  v_account plugin_data.csf_profile_accounts%ROWTYPE;
  v_blockers text[] := ARRAY[]::text[];
  v_active_cohort_ids uuid[] := ARRAY[]::uuid[];
  v_request_found boolean := false;
  v_account_found boolean := false;
  v_class_scope_valid boolean := false;
  v_profile_active boolean := false;
  v_organization_membership_active boolean := false;
  v_active_class_valid boolean := false;
  v_success_audit_exists boolean := false;
  v_verified_email_audit_exists boolean := false;
  v_request_owns_current_link boolean := false;
  v_core_link_valid boolean := false;
  v_link_revoked_count integer := 0;
  v_request_reopened boolean := false;
  v_correlation_id uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz := pg_catalog.now();
BEGIN
  IF NOT coalesce((p_result ->> 'connected')::boolean, false) THEN
    RETURN p_result;
  END IF;

  SELECT request.*
  INTO v_request
  FROM plugin_data.csf_profile_link_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.id = p_request_id
    AND request.user_id = p_user_id
  FOR UPDATE;
  v_request_found := FOUND;

  IF NOT v_request_found
    OR v_request.cohort_id IS NULL
    OR v_request.matched_profile_id IS DISTINCT FROM p_profile_id
    OR v_request.match_status NOT IN ('auto_linked', 'resolved')
  THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'request_state_changed');
  END IF;

  IF v_request_found
    AND v_request.cohort_id IS NOT NULL
  THEN
    SELECT EXISTS (
      SELECT 1
      FROM plugin_data.csf_cohorts AS cohort
      WHERE cohort.organization_id = p_organization_id
        AND cohort.id = v_request.cohort_id AND cohort.status = 'active'
        AND (v_request.class_join_code_id IS NULL OR EXISTS (
          SELECT 1 FROM plugin_data.csf_class_join_codes AS code
          WHERE code.organization_id=p_organization_id
            AND code.id=v_request.class_join_code_id
            AND code.cohort_id=v_request.cohort_id
            AND code.status IN ('active','rotated')
        ))
    )
    INTO v_class_scope_valid;
    IF NOT v_class_scope_valid THEN
      v_blockers := pg_catalog.array_append(v_blockers, 'class_scope_changed');
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = p_profile_id
      AND profile.record_status = 'active'
  )
  INTO v_profile_active;
  IF NOT v_profile_active THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'profile_not_active');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members AS member
    WHERE member.organization_id = p_organization_id
      AND member.user_id = p_user_id
      AND member.status = 'active'
  )
  INTO v_organization_membership_active;
  IF NOT v_organization_membership_active THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'organization_membership_not_active');
  END IF;

  SELECT coalesce(
    pg_catalog.array_agg(membership.cohort_id ORDER BY membership.cohort_id),
    ARRAY[]::uuid[]
  )
  INTO v_active_cohort_ids
  FROM plugin_data.csf_profile_cohort_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = p_profile_id
    AND membership.status = 'active';

  v_active_class_valid := v_request_found
    AND v_request.cohort_id IS NOT NULL
    AND pg_catalog.cardinality(v_active_cohort_ids) = 1
    AND v_active_cohort_ids[1] IS NOT DISTINCT FROM v_request.cohort_id;
  IF NOT v_active_class_valid THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'active_class_changed');
  END IF;

  SELECT account.*
  INTO v_account
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.user_id = p_user_id
    AND account.profile_id = p_profile_id
    AND account.status = 'verified'
  FOR UPDATE;
  v_account_found := FOUND;
  IF NOT v_account_found THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'verified_link_changed');
  END IF;

  IF v_request_found THEN
    SELECT EXISTS (
      SELECT 1
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.target_type = 'csf_profile_link_requests'
        AND audit.target_id = v_request.id
        AND (
          (
            v_request.match_status = 'auto_linked'
            AND audit.actor_user_id = p_user_id
            AND audit.actor_profile_id = p_profile_id
            AND audit.action IN (
              'class.join_code.connected',
              'profile.account_name_connected'
            )
            AND audit.correlation_id = v_request.claim_correlation_id
            AND audit.after_data ->> 'matchStatus' = 'auto_linked'
            AND audit.after_data ->> 'cohortId' = v_request.cohort_id::text
            AND audit.after_data ->> 'classCodeId' = v_request.class_join_code_id::text
          )
          OR (
            v_request.match_status = 'resolved'
            AND audit.actor_user_id = v_request.resolved_by
            AND audit.action = 'profile.link_request_resolved'
            AND audit.after_data ->> 'decision' = 'connect'
            AND audit.after_data ->> 'profileId' = p_profile_id::text
            AND audit.created_at = v_request.resolved_at
          )
        )
    )
    INTO v_success_audit_exists;

    SELECT EXISTS (
      SELECT 1
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.target_type = 'csf_profile_link_requests'
        AND audit.target_id = v_request.id
        AND audit.actor_user_id = p_user_id
        AND audit.actor_profile_id = p_profile_id
        AND audit.action = 'class.join_code.connected'
        AND audit.reason_code = 'verified_email_class_join'
        AND audit.correlation_id = v_request.claim_correlation_id
        AND audit.after_data ->> 'matchStatus' = 'auto_linked'
        AND audit.after_data ->> 'cohortId' = v_request.cohort_id::text
        AND audit.after_data ->> 'classCodeId' = v_request.class_join_code_id::text
    )
    INTO v_verified_email_audit_exists;
  END IF;

  IF v_request_found
    AND v_request.match_status IN ('auto_linked', 'resolved')
    AND NOT v_success_audit_exists
  THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'success_audit_missing');
  END IF;

  IF v_account_found AND v_request_found AND v_success_audit_exists THEN
    v_request_owns_current_link := CASE v_request.match_status
      WHEN 'auto_linked' THEN
        v_request.resolved_at IS NOT NULL
        AND v_account.linked_at = v_request.resolved_at
        AND v_account.linked_by = p_user_id
        AND v_account.notes IN (
          'Connected by one exact verified-email class match.',
          'Connected after the member confirmed the account-name match.'
        )
      WHEN 'resolved' THEN
        v_request.resolved_at IS NOT NULL
        AND v_request.resolved_by IS NOT NULL
        AND v_account.linked_at = v_request.resolved_at
        AND v_account.linked_by = v_request.resolved_by
        AND v_account.notes = 'Resolved by a CSF officer.'
      ELSE false
    END;
  END IF;

  v_core_link_valid := v_account_found
    AND v_class_scope_valid
    AND v_profile_active
    AND v_organization_membership_active
    AND v_active_class_valid;

  IF pg_catalog.cardinality(v_blockers) = 0 OR v_core_link_valid THEN
    IF v_request_found
      AND v_request.match_status = 'auto_linked'
      AND v_verified_email_audit_exists
      AND v_account_found
      AND v_account.notes = 'Connected by one exact verified-email class match.'
      AND v_request.resolution_notes =
        'Connected by one exact verified-email match in the selected class.'
    THEN
      RETURN p_result || pg_catalog.jsonb_build_object(
        'connectionBasis', 'verified_email',
        'verifiedEmailMatch', true
      );
    END IF;
    RETURN p_result;
  END IF;

  IF v_request_owns_current_link THEN
    UPDATE plugin_data.csf_profile_accounts
    SET status = 'revoked',
        is_primary = false,
        revoked_at = v_now,
        notes = 'Automatic safety hold after the class connection changed.'
    WHERE id = v_account.id
      AND status = 'verified';
    GET DIAGNOSTICS v_link_revoked_count = ROW_COUNT;
  END IF;

  IF v_request_found AND v_request.match_status IN ('auto_linked', 'resolved') THEN
    UPDATE plugin_data.csf_profile_link_requests
    SET match_status = 'needs_review',
        resolution_notes =
          'The previous account connection changed and requires officer review.',
        resolved_by = NULL,
        resolved_at = NULL,
        updated_at = v_now
    WHERE id = v_request.id;
    v_request_reopened := true;
  END IF;

  IF v_request_reopened THEN
    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id, actor_user_id, actor_profile_id, action, target_type,
      target_id, before_data, after_data, correlation_id, source_type,
      source_id, reason_code
    ) VALUES (
      p_organization_id, p_user_id, p_profile_id,
      'profile.link_request_revalidation_failed',
      'csf_profile_link_requests', v_request.id,
      pg_catalog.jsonb_build_object(
        'matchStatus', v_request.match_status,
        'profileLinkStatus', CASE WHEN v_account_found THEN 'verified' ELSE 'missing' END
      ),
      pg_catalog.jsonb_build_object(
        'matchStatus', CASE
          WHEN v_request_reopened THEN 'needs_review'
          ELSE v_request.match_status
        END,
        'profileLinkStatus', CASE
          WHEN v_link_revoked_count > 0 THEN 'revoked'
          ELSE 'unchanged'
        END,
        'blockerCodes', pg_catalog.to_jsonb(v_blockers),
        'classCodeId', v_request.class_join_code_id,
        'cohortId', v_request.cohort_id
      ),
      v_correlation_id, 'profile_connection_revalidation',
      coalesce(v_request.id::text, p_user_id::text),
      'profile_connection_revalidation_required'
    );
  END IF;

  RETURN p_result || pg_catalog.jsonb_build_object(
    'connected', false,
    'needsReview', v_request_reopened OR coalesce(v_request.match_status IN ('pending', 'needs_review'), false),
    'rejected', coalesce(v_request.match_status = 'rejected', false),
    'termMembershipCreated', false,
    'replayed', coalesce((p_result ->> 'replayed')::boolean, false)
  );
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_revalidate_class_code_connection_replay_legacy(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_revalidate_class_code_connection_replay_legacy(uuid,uuid,uuid,uuid,jsonb) TO postgres;

COMMIT;
