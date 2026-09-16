-- Follow-ups to 20260916080000, which is already integrated and replayed. Its
-- bytes are untouched; everything here is a forward replacement.
--
--   C5  The attested merge replay bound the request identifier but not the
--       payload. It compared the actor, the target and the attested findings
--       and then answered from the receipt, so a retry carrying a different
--       reason returned the first call's result as though it were its own.
--       Every argument the attestation recorded is compared now, and a
--       mismatch raises request_conflict rather than replaying someone else's
--       correction. This is C7's defect reachable on the merge path.
--
--   C6  csf_resolve_profile_link_request reads the same relaxed connect
--       evidence as the direct officer connection, which reports a competing
--       pending claim as context rather than refusing it. The direct path
--       then closed those claims and recorded each one; the claims queue did
--       not, so resolving there left rivals live, unaudited and still
--       available to be verified later. The supersede is now one function
--       both paths call, and the queue path calls it only once a verified
--       connection exists so a rejection closes nothing. Neither path touches
--       a verified connection: both still require it to be unlinked first.

BEGIN;

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
  v_attestation plugin_data.csf_admin_audit_events%ROWTYPE;
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

  -- C5: an attested merge has to replay like an ordinary one. After a
  -- successful merge the source is 'merged', so re-reading the live preview
  -- first meant a retry of the same request raised either saved_stale or the
  -- already-merged error instead of returning the receipt. Answer from the
  -- attestation receipt when this exact request already carried one, and let
  -- the request-aware merge underneath replay its own.
  SELECT attestation.* INTO v_attestation
  FROM plugin_data.csf_admin_audit_events AS attestation
  WHERE attestation.organization_id = p_organization_id
    AND attestation.correlation_id = p_request_id
    AND attestation.action = 'profile.merge_identity_attested'
  LIMIT 1;
  IF FOUND THEN
    -- The receipt has to describe THIS merge, not merely this request id.
    -- Every argument the attestation recorded is compared, the reason
    -- included: replaying a different intent under the same identifier is the
    -- defect C7 fixed on the activity editor, and it is reachable here too.
    IF v_attestation.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_attestation.target_id IS DISTINCT FROM p_target_profile_id
      OR v_attestation.after_data ->> 'sourceProfileId'
        IS DISTINCT FROM p_source_profile_id::text
      OR v_attestation.after_data -> 'attestedConflicts'
        IS DISTINCT FROM pg_catalog.to_jsonb(v_attested)
      OR v_attestation.after_data ->> 'reason'
        IS DISTINCT FROM nullif(pg_catalog.btrim(coalesce(p_reason, '')), '')
      THEN
      RAISE EXCEPTION USING
        MESSAGE = 'That request identifier is already bound to a different change.',
        DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=request_conflict',
        HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;
    RETURN plugin_data.csf_merge_profiles(
      p_organization_id, p_source_profile_id, p_target_profile_id,
      p_reason, p_actor_user_id, p_request_id
    ) || pg_catalog.jsonb_build_object(
      'attestedConflicts', pg_catalog.to_jsonb(v_attested)
    );
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

-- C6: the supersede both officer decision paths share.
--
-- A pending row is an unreviewed claim on this account or this record, and an
-- officer decision IS that review. csf_staff_connect_profile_account closed
-- those claims and recorded each one; csf_resolve_profile_link_request, which
-- reads the same relaxed evidence, did not, so resolving through the claims
-- queue left competing claims live, unaudited and still available to be
-- verified later. Neither path touches a VERIFIED connection: both still
-- require that to be unlinked first.
CREATE OR REPLACE FUNCTION plugin_data.csf_supersede_competing_profile_claims(
  p_organization_id uuid,
  p_profile_id uuid,
  p_user_id uuid,
  p_reason text,
  p_actor_user_id uuid,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_competing plugin_data.csf_profile_accounts%ROWTYPE;
  v_superseded_row plugin_data.csf_profile_accounts%ROWTYPE;
  v_superseded jsonb := '[]'::jsonb;
BEGIN
  IF p_user_id IS NULL OR p_profile_id IS NULL THEN
    RETURN v_superseded;
  END IF;
  FOR v_competing IN SELECT * FROM plugin_data.csf_profile_accounts
    WHERE organization_id = p_organization_id AND status = 'pending'
      AND ((user_id = p_user_id AND profile_id <> p_profile_id)
        OR (profile_id = p_profile_id AND user_id <> p_user_id))
    ORDER BY id FOR UPDATE
  LOOP
    UPDATE plugin_data.csf_profile_accounts
    SET status = 'rejected', is_primary = false,
      revoked_at = pg_catalog.now(), notes = p_reason
    WHERE organization_id = p_organization_id AND id = v_competing.id
    RETURNING * INTO v_superseded_row;
    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id, actor_user_id, actor_profile_id, action, target_type,
      target_id, before_data, after_data, correlation_id, reason_code
    ) VALUES (
      p_organization_id, p_actor_user_id, NULL,
      'profile.account_connection_superseded', 'csf_profile_accounts',
      v_competing.id, pg_catalog.to_jsonb(v_competing),
      pg_catalog.to_jsonb(v_superseded_row), p_correlation_id,
      'staff_verified_identity'
    );
    v_superseded := v_superseded || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'accountConnectionId', v_competing.id,
        'profileId', v_competing.profile_id
      )
    );
  END LOOP;
  RETURN v_superseded;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_supersede_competing_profile_claims(
  uuid, uuid, uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_supersede_competing_profile_claims(
  uuid, uuid, uuid, text, uuid, uuid
) TO postgres;

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
  -- C6: one supersede, called from both decision paths. The claims path used
  -- to consume the same relaxed evidence and leave every competing pending
  -- claim live and unaudited, so the migration header's promise held for one
  -- entrypoint and not the other.
  v_superseded := plugin_data.csf_supersede_competing_profile_claims(
    p_organization_id, p_profile_id, v_user_id, v_reason, p_actor_user_id,
    p_request_id
  );
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
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_request plugin_data.csf_profile_link_requests%ROWTYPE;
  v_result jsonb;
  v_original_correlation_id uuid;
  v_original_membership_granted boolean := false;
  v_superseded jsonb := '[]'::jsonb;
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'manage_profiles'
  ) THEN
    RAISE EXCEPTION 'Not authorized to resolve CSF profile connections.';
  END IF;

  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);

  IF p_decision IS DISTINCT FROM 'connect' THEN
    RETURN plugin_data.csf_resolve_profile_link_request_corroboration_base(
      p_organization_id, p_request_id, p_profile_id, p_decision, p_reason,
      p_actor_user_id
    );
  END IF;

  IF v_reason IS NULL OR pg_catalog.char_length(v_reason) < 4 THEN
    RAISE EXCEPTION 'A reason of at least four characters is required.';
  END IF;

  SELECT request.*
  INTO v_request
  FROM plugin_data.csf_profile_link_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This connection request has already been resolved.';
  END IF;

  IF v_request.match_status NOT IN ('pending', 'needs_review') THEN
    IF v_request.match_status = 'resolved'
      AND v_request.matched_profile_id IS NOT DISTINCT FROM p_profile_id
      AND v_request.resolved_by IS NOT DISTINCT FROM p_actor_user_id
      AND nullif(pg_catalog.btrim(v_request.resolution_notes), '') IS NOT DISTINCT FROM v_reason
      AND EXISTS (
        SELECT 1 FROM plugin_data.csf_profiles AS profile
        WHERE profile.organization_id = p_organization_id
          AND profile.id = p_profile_id AND profile.record_status = 'active'
      )
      AND EXISTS (
        SELECT 1 FROM plugin_data.csf_profile_accounts AS account
        WHERE account.organization_id = p_organization_id
          AND account.profile_id = p_profile_id
          AND account.user_id = v_request.user_id
          AND account.status = 'verified'
      )
      AND EXISTS (
        SELECT 1 FROM public.organization_members AS member
        WHERE member.organization_id = p_organization_id
          AND member.user_id = v_request.user_id AND member.status = 'active'
      )
      AND (
        SELECT pg_catalog.count(*) = 1
          AND (pg_catalog.array_agg(membership.cohort_id ORDER BY membership.cohort_id))[1]
            IS NOT DISTINCT FROM v_request.cohort_id
        FROM plugin_data.csf_profile_cohort_memberships AS membership
        WHERE membership.organization_id = p_organization_id
          AND membership.profile_id = p_profile_id
          AND membership.status = 'active'
      )
    THEN
      SELECT audit.correlation_id,
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
        RETURN pg_catalog.jsonb_build_object(
          'requestId', p_request_id, 'decision', 'connect',
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

  -- C6: this path reads the same relaxed connect evidence as the direct
  -- officer connection, which reports a competing pending claim as context
  -- rather than refusing. The direct path then closes those claims; this one
  -- did not, so resolving through the queue left rivals live, unaudited and
  -- available to be verified later. Superseded only once a verified
  -- connection actually exists, so a rejection closes nothing.
  IF EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts AS connected
    WHERE connected.organization_id = p_organization_id
      AND connected.profile_id = p_profile_id
      AND connected.user_id = v_request.user_id
      AND connected.status = 'verified'
  ) THEN
    v_superseded := plugin_data.csf_supersede_competing_profile_claims(
      p_organization_id, p_profile_id, v_request.user_id, v_reason,
      p_actor_user_id, (v_result->>'correlationId')::uuid
    );
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id,
    'profile.link_request_identity_evidence', 'csf_profile_link_requests',
    p_request_id, v_request.term_id, '{}'::jsonb,
    pg_catalog.jsonb_build_object(
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
    (v_result->>'correlationId')::uuid, 'staff_action', p_request_id::text,
    'profile_connection_identity_corroborated'
  );

  RETURN v_result || pg_catalog.jsonb_build_object('idempotentReplay', false) || pg_catalog.jsonb_build_object(
    'supersededConnections', v_superseded
  );
END;
$$;

REVOKE ALL ON FUNCTION
  plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid, text[])
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_supersede_competing_profile_claims(
  uuid, uuid, uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_supersede_competing_profile_claims(
  uuid, uuid, uuid, text, uuid, uuid
) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_resolve_profile_link_request(uuid,uuid,uuid,text,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_resolve_profile_link_request(uuid,uuid,uuid,text,text,uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_supersede_competing_profile_claims(uuid,uuid,uuid,text,uuid,uuid) IS
  'Closes and records the pending claims an officer decision reviews. Called by both the direct connection and the claims-queue resolution so the two cannot drift.';
COMMENT ON FUNCTION
  plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid, text[]) IS
  'Officer-attested profile merge: replays from an attestation receipt bound to the whole request, clears only named missing-corroboration findings still matching the locked preview, and delegates to the request-aware merge.';

NOTIFY pgrst, 'reload schema';

COMMIT;
