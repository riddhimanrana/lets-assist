-- Two officer decisions were unreachable through the UI.
--
-- 1. A duplicate student record could only be merged when the database found
--    an exact shared email. Absence of a shared email is missing
--    corroboration, not evidence that the records are different people, and
--    most imported roster rows carry no email at all. An officer who has
--    confirmed the student may now attest past that one finding. Everything
--    that actively contradicts the identity -- different names, different
--    school emails, different active class, different workbook rows -- and
--    every record-overlap conflict stay hard blockers.
--
-- 2. Connecting an account refused outright while any *pending* connection
--    competed for the same account or the same record. A pending row is an
--    unreviewed claim, and the officer decision is the review. The decision
--    now supersedes those claims and records each one. A *verified*
--    connection still has to be unlinked first.

BEGIN;

-- Transaction-local. Only the attested merge entrypoint sets it, after it has
-- rechecked the actor's authority and matched the attested findings against
-- the live preview under the identity lock. Nothing outside that transaction
-- can observe it and no client role can set it.
CREATE OR REPLACE FUNCTION plugin_data.csf_merge_identity_attested()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    pg_catalog.current_setting('plugin_data.csf_merge_identity_attested', true),
    'off'
  ) = 'on';
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_attestable_merge_conflict_types()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$ SELECT ARRAY['identity_email_missing']::text[] $$;

ALTER FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  RENAME TO csf_profile_merge_preview_officer_attestation_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_profile_merge_preview(
  p_organization_id uuid,
  p_source_profile_id uuid,
  p_target_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_preview jsonb;
  v_conflicts jsonb;
  v_attestable jsonb;
  v_blocking jsonb;
  v_attested boolean := plugin_data.csf_merge_identity_attested();
BEGIN
  v_preview := plugin_data.csf_profile_merge_preview_officer_attestation_base(
    p_organization_id, p_source_profile_id, p_target_profile_id
  );
  IF v_preview IS NULL OR pg_catalog.jsonb_typeof(v_preview) <> 'object' THEN
    RAISE EXCEPTION 'The CSF merge preview did not return a canonical object.';
  END IF;
  v_conflicts := v_preview -> 'conflicts';
  IF pg_catalog.jsonb_typeof(v_conflicts) <> 'array' THEN
    RAISE EXCEPTION 'The CSF merge preview did not return canonical conflicts.';
  END IF;

  SELECT
    coalesce(
      pg_catalog.jsonb_agg(entry.conflict ORDER BY entry.ordinal) FILTER (
        WHERE entry.conflict ->> 'type'
          = ANY (plugin_data.csf_attestable_merge_conflict_types())
      ),
      '[]'::jsonb
    ),
    coalesce(
      pg_catalog.jsonb_agg(entry.conflict ORDER BY entry.ordinal) FILTER (
        WHERE NOT (
          entry.conflict ->> 'type'
            = ANY (plugin_data.csf_attestable_merge_conflict_types())
        )
      ),
      '[]'::jsonb
    )
  INTO v_attestable, v_blocking
  FROM pg_catalog.jsonb_array_elements(v_conflicts)
    WITH ORDINALITY AS entry(conflict, ordinal);

  -- Without an attestation this returns exactly what the base layer returned,
  -- so every existing caller and every recorded contract is unchanged.
  RETURN v_preview || pg_catalog.jsonb_build_object(
    'conflicts', CASE WHEN v_attested THEN v_blocking ELSE v_conflicts END,
    'canMerge',
      pg_catalog.jsonb_array_length(v_blocking) = 0
      AND (v_attested OR pg_catalog.jsonb_array_length(v_attestable) = 0),
    'attestableConflicts', v_attestable,
    'canMergeWithOfficerAttestation',
      pg_catalog.jsonb_array_length(v_blocking) = 0,
    'officerIdentityAttested', v_attested
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_merge_profiles(
  p_organization_id uuid,
  p_source_profile_id uuid,
  p_target_profile_id uuid,
  p_reason text,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_attested_conflicts text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attested text[];
  v_pending text[];
  v_result jsonb;
BEGIN
  -- A service-role call is not actor authority, and this entrypoint is the one
  -- that can relax a finding. Recheck before anything else.
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id, p_actor_user_id, 'manage_profiles'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to merge CSF profiles.';
  END IF;

  SELECT coalesce(
    pg_catalog.array_agg(DISTINCT pg_catalog.btrim(entry)
      ORDER BY pg_catalog.btrim(entry)),
    ARRAY[]::text[]
  )
  INTO v_attested
  FROM pg_catalog.unnest(coalesce(p_attested_conflicts, ARRAY[]::text[]))
    AS entry
  WHERE pg_catalog.btrim(entry) <> '';

  IF pg_catalog.cardinality(v_attested) = 0 THEN
    RETURN plugin_data.csf_merge_profiles(
      p_organization_id, p_source_profile_id, p_target_profile_id,
      p_reason, p_actor_user_id, p_request_id
    );
  END IF;

  IF NOT (v_attested <@ plugin_data.csf_attestable_merge_conflict_types()) THEN
    RAISE EXCEPTION
      'That merge finding is not one an officer may attest past.';
  END IF;

  -- Read the live findings under the identity lock the merge itself takes, so
  -- the attestation describes the state the merge is about to act on.
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  SELECT coalesce(
    pg_catalog.array_agg(DISTINCT entry.conflict ->> 'type'
      ORDER BY entry.conflict ->> 'type'),
    ARRAY[]::text[]
  )
  INTO v_pending
  FROM pg_catalog.jsonb_array_elements(
    plugin_data.csf_profile_merge_preview(
      p_organization_id, p_source_profile_id, p_target_profile_id
    ) -> 'attestableConflicts'
  ) AS entry(conflict);

  IF v_attested IS DISTINCT FROM v_pending THEN
    RAISE EXCEPTION USING
      MESSAGE = 'The identity findings changed since this merge was previewed. Preview these records again before merging.',
      DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=saved_stale',
      HINT = 'CSF_RELOAD_REQUIRED=true';
  END IF;

  PERFORM pg_catalog.set_config(
    'plugin_data.csf_merge_identity_attested', 'on', true
  );
  v_result := plugin_data.csf_merge_profiles(
    p_organization_id, p_source_profile_id, p_target_profile_id,
    p_reason, p_actor_user_id, p_request_id
  );
  PERFORM pg_catalog.set_config(
    'plugin_data.csf_merge_identity_attested', 'off', true
  );

  -- The request-aware merge replays from its own receipt, so the attestation
  -- receipt is written once for the same request identifier.
  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = p_organization_id
      AND audit.correlation_id = p_request_id
      AND audit.action = 'profile.merge_identity_attested'
  ) THEN
    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id, actor_user_id, action, target_type, target_id,
      before_data, after_data, correlation_id, source_type, source_id,
      reason_code
    ) VALUES (
      p_organization_id, p_actor_user_id, 'profile.merge_identity_attested',
      'csf_profiles', p_target_profile_id, '{}'::jsonb,
      pg_catalog.jsonb_build_object(
        'sourceProfileId', p_source_profile_id,
        'attestedConflicts', pg_catalog.to_jsonb(v_attested),
        'reason', nullif(pg_catalog.btrim(coalesce(p_reason, '')), '')
      ),
      p_request_id, 'profile_merge_request', p_source_profile_id::text,
      'officer_attested_identity'
    );
  END IF;

  RETURN v_result || pg_catalog.jsonb_build_object(
    'attestedConflicts', pg_catalog.to_jsonb(v_attested)
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_merge_identity_attested()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_identity_attested() TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_attestable_merge_conflict_types()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_attestable_merge_conflict_types()
  TO postgres;
REVOKE ALL ON FUNCTION
  plugin_data.csf_profile_merge_preview_officer_attestation_base(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  plugin_data.csf_profile_merge_preview_officer_attestation_base(uuid, uuid, uuid)
  TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  TO postgres, service_role;
REVOKE ALL ON FUNCTION
  plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid, text[])
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid) IS
  'Returns the canonical merge preview and separates the findings an officer may attest past from the ones no attestation can clear.';
COMMENT ON FUNCTION
  plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid, text[]) IS
  'Officer-attested profile merge: clears only named missing-corroboration findings that still match the locked preview, records the attestation, and delegates to the request-aware merge.';

-- Same function as the identity-guard migration, with the pending-hold
-- refusal replaced by an audited supersede.
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
  v_competing plugin_data.csf_profile_accounts%ROWTYPE;
  v_superseded_row plugin_data.csf_profile_accounts%ROWTYPE;
  v_superseded jsonb := '[]'::jsonb;
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
    RETURN jsonb_build_object('accountId',v_audit.target_id,'profileId',p_profile_id,'replayed',true,
      'supersededConnections','[]'::jsonb);
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
  -- A pending row is an unreviewed claim on this account or this record, and
  -- this officer decision is that review. Supersede each one and keep it as
  -- evidence. A verified connection is not touched here: the two checks above
  -- still require it to be unlinked first.
  FOR v_competing IN SELECT * FROM plugin_data.csf_profile_accounts
    WHERE organization_id=p_organization_id AND status='pending'
      AND ((user_id=v_user_id AND profile_id<>p_profile_id)
        OR (profile_id=p_profile_id AND user_id<>v_user_id))
    ORDER BY id FOR UPDATE
  LOOP
    UPDATE plugin_data.csf_profile_accounts SET status='rejected',is_primary=false,
      revoked_at=now(),notes=v_reason
      WHERE organization_id=p_organization_id AND id=v_competing.id
      RETURNING * INTO v_superseded_row;
    INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,actor_profile_id,
      action,target_type,target_id,before_data,after_data,correlation_id,reason_code)
      VALUES(p_organization_id,p_actor_user_id,NULL,'profile.account_connection_superseded',
        'csf_profile_accounts',v_competing.id,to_jsonb(v_competing),to_jsonb(v_superseded_row),
        p_request_id,'staff_verified_identity');
    v_superseded := v_superseded || jsonb_build_array(jsonb_build_object(
      'accountConnectionId',v_competing.id,'profileId',v_competing.profile_id));
  END LOOP;
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
  RETURN jsonb_build_object('accountId',v_account_id,'profileId',p_profile_id,'replayed',false,
    'supersededConnections',v_superseded);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid) IS
  'Officer account connection: supersedes competing pending claims as part of the decision and records each one; a verified connection still has to be unlinked first.';


-- Same evidence function as the identity-guard migration, with pending
-- claims demoted from blockers to reported context.
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
  'Connection-request evidence: a verified rival connection blocks, a pending claim is reported and left for the officer decision to supersede.';

COMMIT;
