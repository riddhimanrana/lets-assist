-- Staff decisions and requirement verification share the membership transaction.
BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.review_dv_membership_application(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_input jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_membership plugin_data.dv_sd_seasonal_memberships%ROWTYPE;
  v_receipt plugin_data.dv_sd_membership_write_receipts%ROWTYPE;
  v_status text;
  v_notes text;
  v_season_id uuid;
  v_expected_updated_at timestamptz;
  v_hash text;
  v_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR p_organization_id IS NULL OR p_request_id IS NULL
    OR p_input IS NULL OR jsonb_typeof(p_input) <> 'object'
    OR octet_length(p_input::text) > 16384 THEN
    RAISE EXCEPTION 'Invalid membership review.' USING ERRCODE = '22023';
  END IF;
  v_status := p_input->>'status';
  v_notes := nullif(btrim(p_input->>'notes'), '');
  v_season_id := (p_input->>'seasonId')::uuid;
  v_expected_updated_at := (p_input->>'expectedUpdatedAt')::timestamptz;
  IF (p_input->>'organizationId')::uuid IS DISTINCT FROM p_organization_id
    OR v_season_id IS NULL OR v_expected_updated_at IS NULL
    OR p_input->>'expectedStatus' IS NULL OR p_input->>'membershipId' IS NULL
    OR v_status IS NULL OR v_status NOT IN ('needs_action','approved','rejected','suspended','expired')
    OR length(v_notes) > 4000 THEN
    RAISE EXCEPTION 'Invalid membership review.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-account-write:' || p_actor_user_id::text, 0));
  IF NOT app_private.account_deletion_actor_is_active(p_actor_user_id) THEN
    RAISE EXCEPTION 'Account is not available for membership changes.' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('plugin-control-plane-entitlements', 0));
  IF EXISTS (SELECT 1 FROM private.plugin_control_plane_transition_locks
    WHERE organization_id = p_organization_id AND plugin_key = 'dv-speech-debate' AND expires_at > now()) THEN
    RAISE EXCEPTION 'DV plugin transition is in progress.' USING ERRCODE = '40001';
  END IF;
  PERFORM 1 FROM public.organization_plugin_installs
    WHERE organization_id = p_organization_id AND plugin_key = 'dv-speech-debate' FOR SHARE;
  PERFORM 1 FROM public.plugins WHERE key = 'dv-speech-debate' FOR SHARE;
  PERFORM 1 FROM public.organization_members
    WHERE organization_id = p_organization_id AND user_id = p_actor_user_id
      AND status = 'active' AND role IN ('admin','staff') FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active organization staff access required.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_plugin_access
    WHERE organization_id = p_organization_id AND plugin_key = 'dv-speech-debate'
      AND enabled AND is_accessible) THEN
    RAISE EXCEPTION 'DV plugin access is unavailable.' USING ERRCODE = '42501';
  END IF;

  v_hash := encode(extensions.digest('review:' || p_input::text, 'sha256'), 'hex');
  SELECT * INTO v_receipt FROM plugin_data.dv_sd_membership_write_receipts
    WHERE organization_id = p_organization_id AND actor_user_id = p_actor_user_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_receipt.request_hash <> v_hash THEN
      RAISE EXCEPTION 'Request ID was already used for different membership data.' USING ERRCODE = '22023';
    END IF;
    RETURN v_receipt.result;
  END IF;

  PERFORM 1 FROM plugin_data.org_seasons
    WHERE id = v_season_id AND organization_id = p_organization_id AND is_current FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Historical memberships require a separate correction workflow.' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_membership FROM plugin_data.dv_sd_seasonal_memberships
    WHERE id = (p_input->>'membershipId')::uuid AND organization_id = p_organization_id
      AND season_id = v_season_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership does not belong to this organization and season.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM plugin_data.dv_sd_students
    WHERE id = v_membership.student_id AND organization_id = p_organization_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership student is outside this organization.' USING ERRCODE = '42501';
  END IF;
  IF v_membership.status IS DISTINCT FROM p_input->>'expectedStatus'
    OR v_membership.updated_at IS DISTINCT FROM v_expected_updated_at THEN
    RAISE EXCEPTION 'Membership changed. Reload before reviewing.' USING ERRCODE = '40001';
  END IF;
  IF v_membership.status = 'draft' THEN
    RAISE EXCEPTION 'A draft must be submitted before staff review.' USING ERRCODE = '55000';
  END IF;

  -- Parent row lock blocks new requirement links; row locks block concurrent edits.
  PERFORM 1 FROM plugin_data.dv_sd_membership_requirements
    WHERE membership_id = v_membership.id ORDER BY id FOR SHARE;
  IF v_status = 'approved' THEN
    IF EXISTS (SELECT 1 FROM plugin_data.dv_sd_membership_requirements
      WHERE membership_id = v_membership.id AND requirement_type <> 'staff_review'
        AND status NOT IN ('verified','waived')) THEN
      RAISE EXCEPTION 'Outstanding membership requirements must be verified or waived.' USING ERRCODE = '55000';
    END IF;
    INSERT INTO plugin_data.dv_sd_membership_requirements(membership_id,requirement_type,status,verified_by,verified_at)
      VALUES (v_membership.id,'staff_review','verified',p_actor_user_id,now())
      ON CONFLICT (membership_id,requirement_type) DO UPDATE SET
        status = 'verified', verified_by = EXCLUDED.verified_by, verified_at = EXCLUDED.verified_at, updated_at = now();
  END IF;
  UPDATE plugin_data.dv_sd_seasonal_memberships SET status = v_status, review_notes = v_notes,
    reviewed_by = p_actor_user_id, reviewed_at = now(), updated_at = clock_timestamp()
    WHERE id = v_membership.id;
  INSERT INTO plugin_data.dv_sd_audit_events(organization_id,season_id,actor_user_id,action,
    entity_type,entity_id,before_data,after_data,metadata)
    VALUES (p_organization_id,v_season_id,p_actor_user_id,'membership.' || v_status,
      'membership',v_membership.id,jsonb_build_object('status',v_membership.status),
      jsonb_build_object('status',v_status,'notes',v_notes),jsonb_build_object('request_id',p_request_id,
        'staff_review_verified',v_status = 'approved'));
  v_result := jsonb_build_object('id',v_membership.id,'status',v_status);
  INSERT INTO plugin_data.dv_sd_membership_write_receipts(organization_id,actor_user_id,request_id,
    request_hash,membership_id,result)
    VALUES (p_organization_id,p_actor_user_id,p_request_id,v_hash,v_membership.id,v_result);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.review_dv_membership_application(uuid,uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.review_dv_membership_application(uuid,uuid,uuid,jsonb)
  TO service_role;

COMMIT;
