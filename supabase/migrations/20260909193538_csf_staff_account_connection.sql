BEGIN;

CREATE FUNCTION plugin_data.csf_staff_connect_profile_account(
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
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_profiles') THEN
    RAISE EXCEPTION 'Not authorized to connect CSF accounts.' USING ERRCODE='42501';
  END IF;
  IF p_request_id IS NULL OR v_email IS NULL OR v_reason IS NULL OR length(v_reason)<8 OR length(v_reason)>500 THEN
    RAISE EXCEPTION 'Enter the account email and an identity verification reason of 8 to 500 characters.';
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
  INSERT INTO plugin_data.csf_profile_accounts(organization_id,profile_id,user_id,status,is_primary,linked_by,linked_at,notes,connection_basis)
    VALUES(p_organization_id,p_profile_id,v_user_id,'verified',true,p_actor_user_id,now(),v_reason,'officer_decision')
    ON CONFLICT(organization_id,profile_id,user_id) DO UPDATE SET
      status='verified',is_primary=true,linked_by=excluded.linked_by,linked_at=excluded.linked_at,revoked_at=NULL,notes=excluded.notes,connection_basis='officer_decision'
    RETURNING id INTO v_account_id;
  INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,actor_profile_id,action,target_type,target_id,before_data,after_data,correlation_id,reason_code)
    VALUES(p_organization_id,p_actor_user_id,NULL,'profile.account_connected_by_staff','csf_profile_accounts',v_account_id,'{}',
      jsonb_build_object('profileId',p_profile_id,'userId',v_user_id,'cohortId',v_cohort_id,'emailDigest',md5(v_email),'reason',v_reason,'connectionBasis','officer_decision'),p_request_id,'staff_verified_identity');
  UPDATE plugin_data.csf_profile_link_requests SET match_status='resolved',matched_profile_id=p_profile_id,resolved_by=p_actor_user_id,resolved_at=now(),resolution_notes=v_reason
    WHERE organization_id=p_organization_id AND user_id=v_user_id AND cohort_id=v_cohort_id AND match_status IN('pending','needs_review');
  RETURN jsonb_build_object('accountId',v_account_id,'profileId',p_profile_id,'replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid) TO service_role;

COMMIT;
