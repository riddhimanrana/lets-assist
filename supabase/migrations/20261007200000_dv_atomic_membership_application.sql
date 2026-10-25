-- Save member applications, identity changes, and audit evidence in one transaction.
BEGIN;

CREATE TABLE plugin_data.dv_sd_membership_write_receipts (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  membership_id uuid NOT NULL REFERENCES plugin_data.dv_sd_seasonal_memberships(id) ON DELETE CASCADE,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, actor_user_id, request_id)
);
ALTER TABLE plugin_data.dv_sd_membership_write_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON plugin_data.dv_sd_membership_write_receipts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON plugin_data.dv_sd_membership_write_receipts TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.save_dv_membership_application(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_input jsonb,
  p_submit boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_season_id uuid;
  v_student_id uuid;
  v_household_id uuid;
  v_requested_household_id uuid;
  v_guardian_id uuid;
  v_email text;
  v_guardian jsonb;
  v_existing plugin_data.dv_sd_seasonal_memberships%ROWTYPE;
  v_receipt plugin_data.dv_sd_membership_write_receipts%ROWTYPE;
  v_membership_id uuid;
  v_status text;
  v_hash text;
  v_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR p_organization_id IS NULL OR p_request_id IS NULL
    OR p_submit IS NULL OR p_input IS NULL OR jsonb_typeof(p_input) <> 'object'
    OR octet_length(p_input::text) > 65536 THEN
    RAISE EXCEPTION 'Invalid membership request.' USING ERRCODE = '22023';
  END IF;

  -- Share the account deletion mutex before taking tenant or row locks.
  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-account-write:' || p_actor_user_id::text, 0));
  IF NOT app_private.account_deletion_actor_is_active(p_actor_user_id) THEN
    RAISE EXCEPTION 'Account is not available for membership changes.' USING ERRCODE = '42501';
  END IF;
  -- Control-plane leases and entitlement triggers take this lock exclusively.
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
      AND status = 'active' AND role IN ('admin', 'staff', 'member') FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active organization membership required.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_plugin_access
    WHERE organization_id = p_organization_id AND plugin_key = 'dv-speech-debate'
      AND enabled AND is_accessible) THEN
    RAISE EXCEPTION 'DV plugin access is unavailable.' USING ERRCODE = '42501';
  END IF;

  v_hash := encode(extensions.digest(p_input::text || ':' || p_submit::text, 'sha256'), 'hex');
  SELECT * INTO v_receipt FROM plugin_data.dv_sd_membership_write_receipts
    WHERE organization_id = p_organization_id AND actor_user_id = p_actor_user_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_receipt.request_hash <> v_hash THEN
      RAISE EXCEPTION 'Request ID was already used for different membership data.' USING ERRCODE = '22023';
    END IF;
    RETURN v_receipt.result;
  END IF;

  v_season_id := (p_input->>'seasonId')::uuid;
  v_requested_household_id := nullif(p_input->>'householdId', '')::uuid;
  IF (p_input->>'organizationId')::uuid IS DISTINCT FROM p_organization_id
    OR nullif(btrim(p_input->>'legalName'), '') IS NULL
    OR length(p_input->>'legalName') > 160
    OR jsonb_typeof(p_input->'applicationData') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_input->'guardians') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid membership application.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_input->'guardians') NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'Provide between one and four guardians.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM plugin_data.org_seasons
    WHERE id = v_season_id AND organization_id = p_organization_id AND is_current FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Applications require the current organization season.' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_student_id FROM plugin_data.dv_sd_students
    WHERE organization_id = p_organization_id AND user_id = p_actor_user_id;
  SELECT * INTO v_existing FROM plugin_data.dv_sd_seasonal_memberships
    WHERE organization_id = p_organization_id AND season_id = v_season_id
      AND student_id = v_student_id FOR UPDATE;
  IF FOUND AND v_existing.status NOT IN ('draft', 'needs_action') THEN
    RAISE EXCEPTION 'Only draft or needs-action memberships can be edited.' USING ERRCODE = '55000';
  END IF;

  -- Refusal checks precede identity writes. Later errors roll back every write.
  v_household_id := coalesce(v_existing.household_id, v_requested_household_id);
  IF v_existing.id IS NOT NULL AND v_requested_household_id IS NOT NULL
    AND v_requested_household_id <> v_existing.household_id THEN
    RAISE EXCEPTION 'Staff must review household changes.' USING ERRCODE = '42501';
  END IF;
  IF v_household_id IS NULL AND v_student_id IS NOT NULL THEN
    IF (SELECT count(*) FROM plugin_data.dv_sd_household_students hs
      JOIN plugin_data.dv_sd_households h ON h.id = hs.household_id
      WHERE hs.student_id = v_student_id AND h.organization_id = p_organization_id AND h.status = 'active') > 1 THEN
      RAISE EXCEPTION 'Staff must resolve multiple active households.' USING ERRCODE = '22023';
    END IF;
    SELECT h.id INTO v_household_id FROM plugin_data.dv_sd_households h
      JOIN plugin_data.dv_sd_household_students hs ON hs.household_id = h.id
      WHERE hs.student_id = v_student_id AND h.organization_id = p_organization_id AND h.status = 'active';
  END IF;
  IF v_household_id IS NOT NULL THEN
    PERFORM 1 FROM plugin_data.dv_sd_households h
      JOIN plugin_data.dv_sd_household_students hs ON hs.household_id = h.id
      WHERE h.id = v_household_id AND h.organization_id = p_organization_id
        AND h.status = 'active' AND hs.student_id = v_student_id FOR SHARE OF h, hs;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Household does not belong to this student and organization.' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO plugin_data.dv_sd_students(organization_id, user_id, legal_name, preferred_name,
    school_email, personal_email, phone, graduation_year)
  VALUES (p_organization_id, p_actor_user_id, btrim(p_input->>'legalName'),
    nullif(btrim(p_input->>'preferredName'), ''), nullif(lower(btrim(p_input->>'schoolEmail')), ''),
    nullif(lower(btrim(p_input->>'personalEmail')), ''), nullif(btrim(p_input->>'phone'), ''),
    (p_input->>'graduationYear')::integer)
  ON CONFLICT (organization_id, user_id) DO UPDATE SET
    legal_name = EXCLUDED.legal_name, preferred_name = EXCLUDED.preferred_name,
    school_email = EXCLUDED.school_email, personal_email = EXCLUDED.personal_email,
    phone = EXCLUDED.phone, graduation_year = EXCLUDED.graduation_year, updated_at = now()
  RETURNING id INTO v_student_id;

  IF v_household_id IS NULL THEN
    INSERT INTO plugin_data.dv_sd_households(organization_id, display_name)
      VALUES (p_organization_id, btrim(p_input->>'legalName') || ' household') RETURNING id INTO v_household_id;
    INSERT INTO plugin_data.dv_sd_household_students(household_id, student_id)
      VALUES (v_household_id, v_student_id);
  END IF;

  FOR v_guardian IN SELECT value FROM jsonb_array_elements(p_input->'guardians') ORDER BY lower(btrim(value->>'email')) LOOP
    v_email := lower(btrim(v_guardian->>'email'));
    IF v_email IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      OR length(v_email) > 320 OR nullif(btrim(v_guardian->>'fullName'), '') IS NULL
      OR length(v_guardian->>'fullName') > 160 THEN
      RAISE EXCEPTION 'Invalid guardian contact.' USING ERRCODE = '22023';
    END IF;
    SELECT id INTO v_guardian_id FROM plugin_data.dv_sd_guardians
      WHERE organization_id = p_organization_id AND normalized_email = v_email FOR UPDATE;
    IF FOUND THEN
      IF NOT EXISTS (SELECT 1 FROM plugin_data.dv_sd_household_guardians
        WHERE household_id = v_household_id AND guardian_id = v_guardian_id) THEN
        RAISE EXCEPTION 'Staff must review an existing guardian before linking this household.' USING ERRCODE = '42501';
      END IF;
      -- Shared contact corrections stay in the application for staff review.
      CONTINUE;
    END IF;
    INSERT INTO plugin_data.dv_sd_guardians(organization_id, normalized_email, email, full_name, phone)
      VALUES (p_organization_id, v_email, v_email, btrim(v_guardian->>'fullName'), nullif(btrim(v_guardian->>'phone'), ''))
      RETURNING id INTO v_guardian_id;
    INSERT INTO plugin_data.dv_sd_household_guardians(household_id, guardian_id, relationship, is_primary_contact)
      VALUES (v_household_id, v_guardian_id, coalesce(nullif(btrim(v_guardian->>'relationship'), ''), 'guardian'),
        coalesce((v_guardian->>'isPrimaryContact')::boolean, false));
  END LOOP;

  v_status := CASE WHEN p_submit THEN 'submitted' ELSE 'draft' END;
  IF v_existing.id IS NULL THEN
    INSERT INTO plugin_data.dv_sd_seasonal_memberships(organization_id, season_id, student_id,
      household_id, status, application_data, submitted_at)
      VALUES (p_organization_id, v_season_id, v_student_id, v_household_id, v_status,
        p_input->'applicationData', CASE WHEN p_submit THEN now() ELSE NULL END)
      RETURNING id INTO v_membership_id;
  ELSE
    UPDATE plugin_data.dv_sd_seasonal_memberships SET
      status = v_status, application_data = p_input->'applicationData',
      submitted_at = CASE WHEN p_submit THEN now() ELSE NULL END,
      reviewed_by = NULL, reviewed_at = NULL, review_notes = NULL, updated_at = now()
      WHERE id = v_existing.id RETURNING id INTO v_membership_id;
  END IF;
  INSERT INTO plugin_data.dv_sd_audit_events(organization_id, season_id, actor_user_id, action,
    entity_type, entity_id, before_data, after_data, metadata)
    VALUES (p_organization_id, v_season_id, p_actor_user_id,
      CASE WHEN p_submit THEN 'membership.submitted' ELSE 'membership.draft_saved' END,
      'membership', v_membership_id, jsonb_build_object('status', v_existing.status),
      jsonb_build_object('status', v_status), jsonb_build_object('request_id', p_request_id));
  v_result := jsonb_build_object('id', v_membership_id, 'status', v_status);
  INSERT INTO plugin_data.dv_sd_membership_write_receipts(organization_id, actor_user_id, request_id,
    request_hash, membership_id, result)
    VALUES (p_organization_id, p_actor_user_id, p_request_id, v_hash, v_membership_id, v_result);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.save_dv_membership_application(uuid, uuid, uuid, jsonb, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.save_dv_membership_application(uuid, uuid, uuid, jsonb, boolean)
  TO service_role;

-- Staff decisions and requirement verification share the membership transaction.

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
