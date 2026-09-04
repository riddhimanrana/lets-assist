BEGIN;

ALTER TABLE plugin_data.csf_profile_accounts
  ADD COLUMN connection_basis text NOT NULL DEFAULT 'unknown',
  ADD CONSTRAINT csf_profile_accounts_connection_basis_check CHECK (
    connection_basis IN (
      'unknown', 'verified_email', 'self_confirmed_account_name', 'officer_decision'
    )
  );

-- Only a new, matching connection audit can assign provenance. Existing links
-- remain unknown; notes and names are not a backfill source.
CREATE FUNCTION plugin_data.csf_record_connection_basis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request plugin_data.csf_profile_link_requests%ROWTYPE;
  v_basis text;
BEGIN
  IF NEW.target_type <> 'csf_profile_link_requests' THEN RETURN NEW; END IF;
  SELECT request.* INTO v_request
  FROM plugin_data.csf_profile_link_requests AS request
  WHERE request.organization_id = NEW.organization_id AND request.id = NEW.target_id;
  IF NOT FOUND OR v_request.resolved_at IS DISTINCT FROM NEW.created_at THEN
    RETURN NEW;
  END IF;

  IF NEW.action = 'class.join_code.connected'
    AND NEW.reason_code = 'verified_email_class_join'
    AND v_request.match_status = 'auto_linked'
    AND NEW.actor_user_id = v_request.user_id
    AND NEW.actor_profile_id = v_request.matched_profile_id
    AND NEW.correlation_id = v_request.claim_correlation_id
    AND NEW.after_data ->> 'cohortId' = v_request.cohort_id::text
    AND NEW.after_data ->> 'classCodeId' = v_request.class_join_code_id::text
  THEN
    v_basis := 'verified_email';
  ELSIF NEW.action = 'profile.link_request_resolved'
    AND v_request.match_status = 'resolved'
    AND NEW.actor_user_id = v_request.resolved_by
    AND NEW.after_data ->> 'decision' = 'connect'
    AND NEW.after_data ->> 'profileId' = v_request.matched_profile_id::text
  THEN
    v_basis := 'officer_decision';
  END IF;
  IF v_basis IS NOT NULL THEN
    UPDATE plugin_data.csf_profile_accounts AS account
    SET connection_basis = v_basis
    WHERE account.organization_id = NEW.organization_id
      AND account.profile_id = v_request.matched_profile_id
      AND account.user_id = v_request.user_id
      AND account.status = 'verified'
      AND account.linked_by = NEW.actor_user_id
      AND account.linked_at = v_request.resolved_at;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_record_connection_basis()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_connection_basis() TO postgres;
CREATE TRIGGER csf_record_connection_basis_after_audit
  AFTER INSERT ON plugin_data.csf_admin_audit_events
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_record_connection_basis();

ALTER FUNCTION plugin_data.csf_revalidate_class_code_connection_replay(uuid,uuid,uuid,uuid,jsonb)
  RENAME TO csf_revalidate_class_code_connection_replay_legacy;
REVOKE ALL ON FUNCTION plugin_data.csf_revalidate_class_code_connection_replay_legacy(uuid,uuid,uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_revalidate_class_code_connection_replay_legacy(uuid,uuid,uuid,uuid,jsonb)
  TO postgres;

CREATE FUNCTION plugin_data.csf_revalidate_class_code_connection_replay(
  p_organization_id uuid, p_user_id uuid, p_profile_id uuid,
  p_request_id uuid, p_result jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
  v_basis text;
BEGIN
  v_result := plugin_data.csf_revalidate_class_code_connection_replay_legacy(
    p_organization_id, p_user_id, p_profile_id, p_request_id, p_result
  );
  IF coalesce((v_result ->> 'connected')::boolean, false) THEN
    SELECT account.connection_basis INTO v_basis
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = p_profile_id AND account.user_id = p_user_id
      AND account.status = 'verified';
    RETURN v_result || pg_catalog.jsonb_build_object(
      'connectionBasis', coalesce(v_basis, 'unknown'),
      'verifiedEmailMatch', coalesce(v_basis = 'verified_email', false)
    );
  END IF;
  RETURN v_result || pg_catalog.jsonb_build_object(
    'connectionBasis', NULL, 'verifiedEmailMatch', false
  );
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_revalidate_class_code_connection_replay(uuid,uuid,uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_revalidate_class_code_connection_replay(uuid,uuid,uuid,uuid,jsonb)
  TO postgres;

-- The existing RPC remains review-only for in-flight pages and version 3
-- tokens. Only the new server action can enter this version 4 policy.
CREATE FUNCTION plugin_data.csf_confirm_class_code_account_name_match_v4(
  p_organization_id uuid, p_profile_id uuid, p_user_id uuid,
  p_verified_email text, p_class_join_code_id uuid, p_cohort_id uuid,
  p_normalized_first_name text, p_normalized_last_name text,
  p_account_name_hash text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_email text := plugin_data.csf_normalize_email_text(p_verified_email);
  v_auth_email text;
  v_code plugin_data.csf_class_join_codes%ROWTYPE;
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_request plugin_data.csf_profile_link_requests%ROWTYPE;
  v_account_name text;
  v_candidates uuid[] := ARRAY[]::uuid[];
  v_existing_profile uuid;
  v_allowed boolean := false;
  v_basis text;
  v_request_id uuid;
  v_correlation uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz := pg_catalog.now();
  v_result jsonb;
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  IF v_email IS NULL THEN RAISE EXCEPTION 'A verified account email is required.'; END IF;
  SELECT plugin_data.csf_normalize_email_text(u.email) INTO v_auth_email
  FROM auth.users AS u WHERE u.id = p_user_id AND u.email_confirmed_at IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND OR v_auth_email IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'Use the verified email on your signed-in account.';
  END IF;
  SELECT code.* INTO v_code FROM plugin_data.csf_class_join_codes AS code
  WHERE code.organization_id = p_organization_id AND code.id = p_class_join_code_id
    AND code.cohort_id = p_cohort_id AND code.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This CSF class code is no longer active.'; END IF;

  SELECT pg_catalog.btrim(coalesce(profile.full_name, '')) INTO v_account_name
  FROM public.profiles AS profile WHERE profile.id = p_user_id FOR UPDATE;
  SELECT request.* INTO v_request FROM plugin_data.csf_profile_link_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.class_join_code_id = p_class_join_code_id AND request.user_id = p_user_id
  FOR UPDATE;
  SELECT account.profile_id INTO v_existing_profile
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id AND account.user_id = p_user_id
    AND account.status = 'verified' FOR UPDATE;

  IF v_request.id IS NOT NULL AND v_request.match_status = 'rejected' THEN
    RETURN pg_catalog.jsonb_build_object('connected', false, 'needsReview', false,
      'rejected', true, 'requestId', v_request.id, 'termMembershipCreated', false, 'replayed', true);
  END IF;
  IF v_request.matched_profile_id = p_profile_id
    AND (v_existing_profile = p_profile_id OR v_request.match_status IN ('auto_linked', 'resolved')) THEN
    RETURN plugin_data.csf_revalidate_class_code_connection_replay(
      p_organization_id, p_user_id, p_profile_id, v_request.id,
      pg_catalog.jsonb_build_object('connected', true, 'needsReview', false,
        'profileId', p_profile_id, 'requestId', v_request.id,
        'termMembershipCreated', false, 'replayed', true)
    );
  END IF;

  SELECT profile.* INTO v_profile FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id AND profile.id = p_profile_id
    AND profile.record_status = 'active' FOR UPDATE;
  IF FOUND AND v_account_name <> '' AND p_account_name_hash ~ '^[a-f0-9]{64}$'
    AND p_account_name_hash = pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_account_name, 'UTF8'), 'sha256'), 'hex')
  THEN
    SELECT coalesce(pg_catalog.array_agg(profile.id ORDER BY profile.id), ARRAY[]::uuid[])
    INTO v_candidates FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id AND profile.record_status = 'active'
      AND plugin_data.csf_normalize_identity_part(pg_catalog.concat_ws(' ',
        profile.first_name, nullif(pg_catalog.btrim(profile.middle_name), ''), profile.last_name))
        = plugin_data.csf_normalize_identity_part(v_account_name)
      AND EXISTS (SELECT 1 FROM plugin_data.csf_profile_cohort_memberships AS membership
        WHERE membership.organization_id = p_organization_id AND membership.profile_id = profile.id
          AND membership.cohort_id = p_cohort_id AND membership.status = 'active');

    v_allowed := pg_catalog.cardinality(v_candidates) = 1 AND v_candidates[1] = p_profile_id
      AND v_existing_profile IS NULL
      AND v_request.id IS NULL
      AND 1 = (SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_cohort_memberships AS membership
        WHERE membership.organization_id = p_organization_id AND membership.profile_id = p_profile_id
          AND membership.status = 'active')
      AND NOT EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts AS account
        WHERE account.organization_id = p_organization_id
          AND (account.profile_id = p_profile_id OR account.user_id = p_user_id))
      AND NOT EXISTS (SELECT 1 FROM public.organization_members AS member
        WHERE member.organization_id = p_organization_id AND member.user_id = p_user_id
          AND member.status IS DISTINCT FROM 'active')
      AND NOT EXISTS (SELECT 1 FROM plugin_data.csf_profiles AS other
        WHERE other.organization_id = p_organization_id AND other.record_status = 'active'
          AND other.id <> p_profile_id
          AND v_email IN (other.normalized_school_email, other.normalized_personal_email))
      AND (
        v_email IN (v_profile.normalized_school_email, v_profile.normalized_personal_email)
        OR (v_profile.normalized_school_email IS NULL AND v_profile.normalized_personal_email IS NULL)
      );
  END IF;
  v_allowed := coalesce(v_allowed, false);
  IF v_allowed THEN
    v_basis := CASE WHEN v_email IN (v_profile.normalized_school_email, v_profile.normalized_personal_email)
      THEN 'verified_email' ELSE 'self_confirmed_account_name' END;
    INSERT INTO public.organization_members (organization_id, user_id, role, status)
      VALUES (p_organization_id, p_user_id, 'member', 'active')
      ON CONFLICT (organization_id, user_id) DO NOTHING;
    INSERT INTO plugin_data.csf_profile_accounts (
      organization_id, profile_id, user_id, status, is_primary, linked_by,
      linked_at, notes, connection_basis
    ) VALUES (p_organization_id, p_profile_id, p_user_id, 'verified', true,
      p_user_id, v_now, 'Connected after the member confirmed the account-name match.', v_basis);
  END IF;

  INSERT INTO plugin_data.csf_profile_link_requests (
    organization_id, class_join_code_id, cohort_id, user_id,
    signed_in_email, first_name, last_name, personal_email,
    normalized_first_name, normalized_last_name, normalized_personal_email,
    matched_profile_id, candidate_profile_ids, match_status, resolution_notes,
    resolved_by, resolved_at, claim_correlation_id, submitted_returning_status, updated_at
  ) VALUES (
    p_organization_id, p_class_join_code_id, p_cohort_id, p_user_id,
    v_email, coalesce(v_profile.first_name, nullif(p_normalized_first_name, ''), 'Member'),
    coalesce(v_profile.last_name, nullif(p_normalized_last_name, ''), 'Record'), v_email,
    coalesce(v_profile.normalized_first_name, p_normalized_first_name),
    coalesce(v_profile.normalized_last_name, p_normalized_last_name), v_email,
    CASE WHEN v_allowed THEN p_profile_id END, v_candidates,
    CASE WHEN v_allowed THEN 'auto_linked' ELSE 'needs_review' END,
    CASE WHEN v_allowed THEN 'The member confirmed the single account-name match in this class.'
      ELSE 'The account connection needs officer review.' END,
    CASE WHEN v_allowed THEN p_user_id END, CASE WHEN v_allowed THEN v_now END,
    v_correlation, 'unknown', v_now
  ) ON CONFLICT (organization_id, class_join_code_id, user_id)
    WHERE class_join_code_id IS NOT NULL AND user_id IS NOT NULL
    DO UPDATE SET updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_request_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action, target_type, target_id,
    after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_user_id, CASE WHEN v_allowed THEN p_profile_id END,
    CASE WHEN v_allowed THEN 'profile.account_name_connected' ELSE 'profile.account_name_review_requested' END,
    'csf_profile_link_requests', v_request_id,
    pg_catalog.jsonb_build_object('cohortId', p_cohort_id, 'classCodeId', p_class_join_code_id,
      'matchStatus', CASE WHEN v_allowed THEN 'auto_linked' ELSE 'needs_review' END,
      'connectionBasis', v_basis, 'accountNameHash', p_account_name_hash,
      'candidateCount', pg_catalog.cardinality(v_candidates), 'termMembershipCreated', false),
    v_correlation, 'member_account_name_match', v_request_id::text,
    CASE WHEN v_allowed THEN 'confirmed_account_name_match' ELSE 'stale_account_name_match' END
  );
  v_result := pg_catalog.jsonb_build_object('connected', v_allowed, 'needsReview', NOT v_allowed,
    'profileId', CASE WHEN v_allowed THEN p_profile_id END, 'requestId', v_request_id,
    'connectionBasis', v_basis, 'verifiedEmailMatch', coalesce(v_basis = 'verified_email', false),
    'termMembershipCreated', false, 'replayed', v_request.id IS NOT NULL);
  RETURN plugin_data.csf_revalidate_class_code_connection_replay(
    p_organization_id, p_user_id, p_profile_id, v_request_id, v_result
  );
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_confirm_class_code_account_name_match_v4(uuid,uuid,uuid,text,uuid,uuid,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_confirm_class_code_account_name_match_v4(uuid,uuid,uuid,text,uuid,uuid,text,text,text)
  TO service_role;
COMMENT ON FUNCTION plugin_data.csf_confirm_class_code_account_name_match_v4(uuid,uuid,uuid,text,uuid,uuid,text,text,text)
  IS 'Service-only exact full-account-name confirmation. No fuzzy match, typed-name claim, profile creation, or semester activation. Editable account names carry lower identity assurance than verified email.';

CREATE FUNCTION plugin_data.csf_find_account_name_candidate(
  p_organization_id uuid, p_cohort_id uuid, p_account_full_name text
)
RETURNS TABLE (profile_id uuid, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH matches AS (
    SELECT profile.id,
      pg_catalog.concat_ws(' ', profile.first_name,
        nullif(pg_catalog.btrim(profile.middle_name), ''), profile.last_name) AS full_name,
      pg_catalog.count(*) OVER () AS candidate_count
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id AND profile.record_status = 'active'
      AND plugin_data.csf_normalize_identity_part(p_account_full_name) <> ''
      AND plugin_data.csf_normalize_identity_part(pg_catalog.concat_ws(' ', profile.first_name,
        nullif(pg_catalog.btrim(profile.middle_name), ''), profile.last_name))
        = plugin_data.csf_normalize_identity_part(p_account_full_name)
      AND EXISTS (SELECT 1 FROM plugin_data.csf_profile_cohort_memberships AS membership
        WHERE membership.organization_id = p_organization_id AND membership.profile_id = profile.id
          AND membership.cohort_id = p_cohort_id AND membership.status = 'active')
  )
  SELECT candidate.id, candidate.full_name FROM matches AS candidate
  WHERE candidate.candidate_count = 1
    AND NOT EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id = p_organization_id AND account.profile_id = candidate.id)
    AND 1 = (SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_cohort_memberships AS membership
      WHERE membership.organization_id = p_organization_id AND membership.profile_id = candidate.id
        AND membership.status = 'active')
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_find_account_name_candidate(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_find_account_name_candidate(uuid,uuid,text)
  TO service_role;

COMMIT;
