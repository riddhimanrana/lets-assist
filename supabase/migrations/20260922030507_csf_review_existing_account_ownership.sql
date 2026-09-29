-- Record staff ownership approval without replacing an existing account link.
BEGIN;

CREATE FUNCTION plugin_data.csf_review_profile_account_ownership(
  p_organization_id uuid, p_profile_id uuid, p_actor_user_id uuid,
  p_account_email text, p_reason text, p_request_id uuid,
  p_account_id uuid, p_expected_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_email text := plugin_data.csf_normalize_email_text(p_account_email);
  v_reason text := nullif(btrim(p_reason), '');
  v_account plugin_data.csf_profile_accounts%ROWTYPE;
  v_after plugin_data.csf_profile_accounts%ROWTYPE;
  v_audit plugin_data.csf_admin_audit_events%ROWTYPE;
  v_request plugin_data.csf_profile_link_requests%ROWTYPE;
  v_resolved plugin_data.csf_profile_link_requests%ROWTYPE;
  v_cohort_id uuid;
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_profiles') THEN
    RAISE EXCEPTION 'Not authorized to review CSF account ownership.' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_account_id IS NULL OR p_expected_user_id IS NULL
    OR v_email IS NULL OR v_reason IS NULL OR length(v_reason) NOT BETWEEN 8 AND 500 THEN
    RAISE EXCEPTION 'Confirm the existing account and provide an identity verification reason of 8 to 500 characters.';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_profiles') THEN
    RAISE EXCEPTION 'Not authorized to review CSF account ownership.' USING ERRCODE = '42501';
  END IF;
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  PERFORM 1 FROM plugin_data.csf_profiles
    WHERE organization_id = p_organization_id AND id = p_profile_id AND record_status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active CSF profile in this organization.'; END IF;
  SELECT * INTO v_account FROM plugin_data.csf_profile_accounts
    WHERE organization_id = p_organization_id AND id = p_account_id FOR UPDATE;
  IF NOT FOUND OR v_account.profile_id IS DISTINCT FROM p_profile_id
    OR v_account.user_id IS DISTINCT FROM p_expected_user_id OR v_account.status <> 'verified' THEN
    RAISE EXCEPTION 'This account connection has changed. Reload before continuing.';
  END IF;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = p_organization_id AND id <> p_account_id AND status = 'verified'
      AND (user_id = p_expected_user_id OR profile_id = p_profile_id)) THEN
    RAISE EXCEPTION 'Another verified account connection needs review first.';
  END IF;
  PERFORM 1 FROM plugin_data.csf_profile_cohort_memberships m
    JOIN plugin_data.csf_cohorts c ON c.organization_id = m.organization_id AND c.id = m.cohort_id
    WHERE m.organization_id = p_organization_id AND m.profile_id = p_profile_id
      AND m.status = 'active' AND c.status = 'active' FOR SHARE OF m, c;
  IF (SELECT count(*) FROM plugin_data.csf_profile_cohort_memberships m
    JOIN plugin_data.csf_cohorts c ON c.organization_id = m.organization_id AND c.id = m.cohort_id
    WHERE m.organization_id = p_organization_id AND m.profile_id = p_profile_id
      AND m.status = 'active' AND c.status = 'active') <> 1 THEN
    RAISE EXCEPTION 'The CSF profile must have one active class.';
  END IF;
  SELECT m.cohort_id INTO v_cohort_id FROM plugin_data.csf_profile_cohort_memberships m
    JOIN plugin_data.csf_cohorts c ON c.organization_id = m.organization_id AND c.id = m.cohort_id
    WHERE m.organization_id = p_organization_id AND m.profile_id = p_profile_id
      AND m.status = 'active' AND c.status = 'active';
  PERFORM 1 FROM auth.users u JOIN public.organization_members m
    ON m.user_id = u.id AND m.organization_id = p_organization_id AND m.status = 'active'
    WHERE u.id = p_expected_user_id AND lower(btrim(u.email)) = v_email
      AND u.email_confirmed_at IS NOT NULL FOR SHARE OF u, m;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The confirmed login account or organization membership has changed. Reload before continuing.';
  END IF;
  SELECT * INTO v_audit FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = p_organization_id AND correlation_id = p_request_id
      AND action = 'profile.account_ownership_reviewed' LIMIT 1;
  IF FOUND THEN
    IF v_audit.actor_user_id IS DISTINCT FROM p_actor_user_id OR v_audit.target_id IS DISTINCT FROM p_account_id
      OR v_audit.after_data->>'profileId' IS DISTINCT FROM p_profile_id::text
      OR v_audit.after_data->>'userId' IS DISTINCT FROM p_expected_user_id::text
      OR v_audit.after_data->>'emailDigest' IS DISTINCT FROM md5(v_email)
      OR v_audit.after_data->>'reason' IS DISTINCT FROM v_reason THEN
      RAISE EXCEPTION 'This request ID was already used for a different ownership review.';
    END IF;
    IF v_account.connection_basis <> 'officer_decision' THEN
      RAISE EXCEPTION 'This account connection has changed. Reload before continuing.';
    END IF;
    RETURN jsonb_build_object('accountId', p_account_id, 'profileId', p_profile_id, 'replayed', true);
  END IF;
  IF v_account.connection_basis = 'officer_decision' THEN
    RETURN jsonb_build_object('accountId', p_account_id, 'profileId', p_profile_id, 'alreadyReviewed', true);
  END IF;
  UPDATE plugin_data.csf_profile_accounts SET connection_basis = 'officer_decision'
    WHERE organization_id = p_organization_id AND id = p_account_id RETURNING * INTO v_after;
  INSERT INTO plugin_data.csf_admin_audit_events(
    organization_id, actor_user_id, action, target_type, target_id, before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'profile.account_ownership_reviewed', 'csf_profile_accounts', p_account_id,
    to_jsonb(v_account), to_jsonb(v_after) || jsonb_build_object(
      'profileId', p_profile_id, 'userId', p_expected_user_id, 'cohortId', v_cohort_id,
      'emailDigest', md5(v_email), 'reason', v_reason), p_request_id, 'staff_verified_identity'
  );
  FOR v_request IN SELECT * FROM plugin_data.csf_profile_link_requests
    WHERE organization_id = p_organization_id AND user_id = p_expected_user_id AND cohort_id = v_cohort_id
      AND (matched_profile_id IS NULL OR matched_profile_id = p_profile_id)
      AND match_status IN ('pending', 'needs_review', 'auto_linked') ORDER BY id FOR UPDATE
  LOOP
    UPDATE plugin_data.csf_profile_link_requests SET match_status = 'resolved', matched_profile_id = p_profile_id,
      resolved_by = p_actor_user_id, resolved_at = now(), resolution_notes = v_reason
      WHERE organization_id = p_organization_id AND id = v_request.id RETURNING * INTO v_resolved;
    INSERT INTO plugin_data.csf_admin_audit_events(
      organization_id, actor_user_id, action, target_type, target_id, before_data, after_data, correlation_id, reason_code
    ) VALUES (p_organization_id, p_actor_user_id, 'profile.link_request_resolved_by_staff',
      'csf_profile_link_requests', v_request.id, to_jsonb(v_request), to_jsonb(v_resolved), p_request_id, 'staff_verified_identity');
  END LOOP;
  RETURN jsonb_build_object('accountId', p_account_id, 'profileId', p_profile_id, 'replayed', false);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_review_profile_account_ownership(uuid,uuid,uuid,text,text,uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_profile_account_ownership(uuid,uuid,uuid,text,text,uuid,uuid,uuid)
  TO service_role;

COMMIT;
