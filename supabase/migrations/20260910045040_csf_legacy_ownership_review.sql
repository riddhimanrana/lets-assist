CREATE OR REPLACE FUNCTION plugin_data.csf_hold_unproven_account_connections(
  p_organization_id uuid, p_expected_account_ids uuid[]
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_account plugin_data.csf_profile_accounts%ROWTYPE;
  v_count integer;
  v_actual_ids uuid[];
  v_request plugin_data.csf_profile_link_requests%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  SELECT count(*), coalesce(array_agg(id ORDER BY id), ARRAY[]::uuid[]) INTO v_count,v_actual_ids FROM plugin_data.csf_profile_accounts
    WHERE organization_id=p_organization_id AND status='verified'
      AND NOT (connection_basis = 'officer_decision'
        OR (connection_basis = 'verified_email' AND EXISTS (
          SELECT 1 FROM plugin_data.csf_profiles owned
          WHERE owned.organization_id=csf_profile_accounts.organization_id
            AND owned.id=csf_profile_accounts.profile_id
            AND owned.source_summary->>'createdBy'='permanent_class_code'
            AND owned.source_summary->>'accountOwnerUserId'=csf_profile_accounts.user_id::text
        )));
  IF p_expected_account_ids IS NULL OR v_actual_ids IS DISTINCT FROM
    ARRAY(SELECT id FROM unnest(p_expected_account_ids) AS id ORDER BY id) THEN
    RAISE EXCEPTION 'Account review scope changed; inspect the preview before applying the hold.';
  END IF;
  FOR v_account IN SELECT * FROM plugin_data.csf_profile_accounts
    WHERE organization_id=p_organization_id AND status='verified'
      AND NOT (connection_basis = 'officer_decision'
        OR (connection_basis = 'verified_email' AND EXISTS (
          SELECT 1 FROM plugin_data.csf_profiles owned
          WHERE owned.organization_id=csf_profile_accounts.organization_id
            AND owned.id=csf_profile_accounts.profile_id
            AND owned.source_summary->>'createdBy'='permanent_class_code'
            AND owned.source_summary->>'accountOwnerUserId'=csf_profile_accounts.user_id::text
        )))
    ORDER BY id FOR UPDATE
  LOOP
    UPDATE plugin_data.csf_profile_accounts SET status='pending'
      WHERE organization_id=p_organization_id AND id=v_account.id;
    INSERT INTO plugin_data.csf_admin_audit_events
      (organization_id,action,target_type,target_id,before_data,after_data,correlation_id,reason_code)
    VALUES(p_organization_id,'profile.account_ownership_review_required','csf_profile_accounts',v_account.id,
      jsonb_build_object('status',v_account.status,'connectionBasis',v_account.connection_basis),
      jsonb_build_object('status','pending','profileId',v_account.profile_id,
        'organizationAccessChanged',false,'staffAccessChanged',false),
      gen_random_uuid(),'independent_ownership_not_established');
    FOR v_request IN SELECT * FROM plugin_data.csf_profile_link_requests
      WHERE organization_id=p_organization_id AND user_id=v_account.user_id
        AND matched_profile_id=v_account.profile_id AND match_status IN ('auto_linked','resolved')
      ORDER BY id FOR UPDATE
    LOOP
      UPDATE plugin_data.csf_profile_link_requests SET match_status='needs_review',
        resolved_by=NULL,resolved_at=NULL,updated_at=now(),
        resolution_notes='Staff must verify ownership before this account can access the student record.'
        WHERE organization_id=p_organization_id AND id=v_request.id;
      INSERT INTO plugin_data.csf_admin_audit_events
        (organization_id,action,target_type,target_id,before_data,after_data,correlation_id,reason_code)
      VALUES(p_organization_id,'profile.link_request_ownership_review_required','csf_profile_link_requests',v_request.id,
        jsonb_build_object('matchStatus',v_request.match_status),
        jsonb_build_object('matchStatus','needs_review','accountId',v_account.id),
        gen_random_uuid(),'independent_ownership_not_established');
    END LOOP;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_hold_unproven_account_connections(uuid,uuid[])
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_hold_unproven_account_connections(uuid,uuid[]) TO postgres;

-- The scoped operation is invoked only after its exact account set and ownership
-- review are checked. Installing this function does not change any accounts.
