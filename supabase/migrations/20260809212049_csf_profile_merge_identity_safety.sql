-- Relationship overlap alone cannot establish that two student profiles are
-- the same person. Add corroborating identity evidence to the canonical
-- preview and enforce that exact preview inside the locked merge transaction.

BEGIN;

ALTER FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  RENAME TO csf_profile_merge_preview_relationship_base;

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
  v_source plugin_data.csf_profiles%ROWTYPE;
  v_target plugin_data.csf_profiles%ROWTYPE;
  v_preview jsonb;
  v_conflicts jsonb;
  v_name_consistent boolean;
  v_exact_email_overlap boolean;
  v_school_email_conflict boolean;
  v_active_cohort_conflict boolean;
BEGIN
  v_preview := plugin_data.csf_profile_merge_preview_relationship_base(
    p_organization_id,
    p_source_profile_id,
    p_target_profile_id
  );

  SELECT profile.*
  INTO v_source
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_source_profile_id;

  SELECT profile.*
  INTO v_target
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_target_profile_id;

  v_name_consistent :=
    v_source.normalized_first_name = v_target.normalized_first_name
    AND v_source.normalized_last_name = v_target.normalized_last_name;

  v_exact_email_overlap := coalesce(
    (
      v_source.normalized_school_email IS NOT NULL
      AND v_source.normalized_school_email IN (
        v_target.normalized_school_email,
        v_target.normalized_personal_email
      )
    )
    OR (
      v_source.normalized_personal_email IS NOT NULL
      AND v_source.normalized_personal_email IN (
        v_target.normalized_school_email,
        v_target.normalized_personal_email
      )
    ),
    false
  );

  v_school_email_conflict :=
    v_source.normalized_school_email IS NOT NULL
    AND v_target.normalized_school_email IS NOT NULL
    AND v_source.normalized_school_email <> v_target.normalized_school_email;

  v_active_cohort_conflict :=
    EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_cohort_memberships AS membership
      WHERE membership.organization_id = p_organization_id
        AND membership.profile_id = p_source_profile_id
        AND membership.status = 'active'
    )
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_cohort_memberships AS membership
      WHERE membership.organization_id = p_organization_id
        AND membership.profile_id = p_target_profile_id
        AND membership.status = 'active'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_cohort_memberships AS source_membership
      JOIN plugin_data.csf_profile_cohort_memberships AS target_membership
        ON target_membership.organization_id = source_membership.organization_id
       AND target_membership.cohort_id = source_membership.cohort_id
       AND target_membership.profile_id = p_target_profile_id
       AND target_membership.status = 'active'
      WHERE source_membership.organization_id = p_organization_id
        AND source_membership.profile_id = p_source_profile_id
        AND source_membership.status = 'active'
    );

  v_conflicts := coalesce(v_preview->'conflicts', '[]'::jsonb);

  IF NOT v_name_consistent THEN
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'type', 'identity_name_mismatch',
      'label', 'The normalized first and last names do not identify the same student.'
    ));
  END IF;
  IF NOT v_exact_email_overlap THEN
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'type', 'identity_email_missing',
      'label', 'The records do not share an exact verified school or personal email.'
    ));
  END IF;
  IF v_school_email_conflict THEN
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'type', 'school_email_mismatch',
      'label', 'The records contain different school email identities.'
    ));
  END IF;
  IF v_active_cohort_conflict THEN
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'type', 'active_cohort_mismatch',
      'label', 'The records belong to different active graduating classes.'
    ));
  END IF;

  RETURN v_preview || jsonb_build_object(
    'conflicts', v_conflicts,
    'canMerge', jsonb_array_length(v_conflicts) = 0,
    'identityEvidence', jsonb_build_object(
      'nameConsistent', v_name_consistent,
      'exactEmailOverlap', v_exact_email_overlap,
      'schoolEmailConflict', v_school_email_conflict,
      'activeCohortConflict', v_active_cohort_conflict
    )
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid)
  RENAME TO csf_merge_profiles_identity_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_merge_profiles(
  p_organization_id uuid,
  p_source_profile_id uuid,
  p_target_profile_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- A service-role call is not actor authority. Recheck the named officer
  -- before taking identity locks or revealing whether either profile exists.
  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    'manage_profiles'
  ) THEN
    RAISE EXCEPTION 'Not authorized to merge CSF profiles.';
  END IF;

  -- Profile merges are rare. Blocking concurrent account/cohort writes during
  -- the short transaction makes the reviewed identity evidence authoritative.
  LOCK TABLE plugin_data.csf_profile_accounts IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE plugin_data.csf_profile_cohort_memberships IN SHARE ROW EXCLUSIVE MODE;

  RETURN plugin_data.csf_merge_profiles_identity_base(
    p_organization_id,
    p_source_profile_id,
    p_target_profile_id,
    p_reason,
    p_actor_user_id
  );
END;
$$;

CREATE UNIQUE INDEX csf_admin_audit_events_profile_merge_request_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id)
  WHERE correlation_id IS NOT NULL
    AND action = 'profile.merge_request_committed';

CREATE OR REPLACE FUNCTION plugin_data.csf_merge_profiles(
  p_organization_id uuid,
  p_source_profile_id uuid,
  p_target_profile_id uuid,
  p_reason text,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_source plugin_data.csf_profiles%ROWTYPE;
  v_target plugin_data.csf_profiles%ROWTYPE;
  v_request jsonb;
  v_result jsonb;
  v_request_fingerprint text;
  v_state_fingerprint text;
  v_merge_correlation_id uuid;
  v_review_id uuid;
  v_merge_audit_id uuid;
BEGIN
  -- A receipt reveals both identities and the fact of their merge. Check the
  -- actor's current canonical permission before looking for it.
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_profiles'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to merge CSF profiles.';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable profile-merge request identifier is required.';
  END IF;

  v_request := pg_catalog.jsonb_build_object(
    'sourceProfileId', p_source_profile_id,
    'targetProfileId', p_target_profile_id,
    'reason', nullif(pg_catalog.btrim(coalesce(p_reason, '')), '')
  );
  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_request::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_admin_request:'
        || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
  ORDER BY audit.created_at, audit.id
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'profile.merge_request_committed'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_profiles'
      OR v_receipt.target_id IS DISTINCT FROM p_target_profile_id
      OR v_receipt.after_data ->> 'requestFingerprint' IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION USING
        MESSAGE = 'That profile-merge request identifier is already bound to a different change.',
        DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=request_conflict',
        HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;

    -- Match the base merge's deterministic profile lock order so a replay
    -- cannot race a correction of either identity.
    PERFORM 1
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id IN (p_source_profile_id, p_target_profile_id)
    ORDER BY profile.id
    FOR UPDATE;

    SELECT profile.*
    INTO v_source
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = p_source_profile_id;
    SELECT profile.*
    INTO v_target
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = p_target_profile_id;

    v_state_fingerprint := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          pg_catalog.jsonb_build_object(
            'source', to_jsonb(v_source),
            'target', to_jsonb(v_target)
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );

    IF v_source.id IS NULL
      OR v_target.id IS NULL
      OR v_source.record_status IS DISTINCT FROM 'merged'
      OR v_source.merged_into_profile_id IS DISTINCT FROM p_target_profile_id
      OR v_target.record_status IS DISTINCT FROM 'active'
      OR v_receipt.after_data ->> 'stateFingerprint' IS DISTINCT FROM v_state_fingerprint
      OR NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_profile_merge_reviews AS review
        WHERE review.id = (v_receipt.after_data ->> 'reviewId')::uuid
          AND review.organization_id = p_organization_id
          AND review.source_profile_id = p_source_profile_id
          AND review.target_profile_id = p_target_profile_id
          AND review.reviewed_by = p_actor_user_id
          AND review.status = 'approved'
          AND review.correlation_id = (v_receipt.after_data ->> 'mergeCorrelationId')::uuid
      )
      OR NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_admin_audit_events AS merge_audit
        WHERE merge_audit.id = (v_receipt.after_data ->> 'mergeAuditId')::uuid
          AND merge_audit.organization_id = p_organization_id
          AND merge_audit.actor_user_id = p_actor_user_id
          AND merge_audit.action = 'profile.merge'
          AND merge_audit.target_type = 'csf_profiles'
          AND merge_audit.target_id = p_target_profile_id
          AND merge_audit.correlation_id = (v_receipt.after_data ->> 'mergeCorrelationId')::uuid
          AND merge_audit.after_data ->> 'sourceProfileId' = p_source_profile_id::text
      ) THEN
      RAISE EXCEPTION USING
        MESSAGE = 'The committed profile merge receipt is stale. Reload the member records for their current state.',
        DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=saved_stale',
        HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;

    RETURN v_receipt.after_data -> 'result';
  END IF;

  -- The five-argument implementation retains the exact identity preflight,
  -- table locks, moves, provenance, review, and domain audit. This overload
  -- adds the response-loss receipt in the same transaction.
  v_result := plugin_data.csf_merge_profiles(
    p_organization_id,
    p_source_profile_id,
    p_target_profile_id,
    p_reason,
    p_actor_user_id
  );

  SELECT profile.*
  INTO v_source
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_source_profile_id;
  SELECT profile.*
  INTO v_target
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_target_profile_id;
  IF v_source.id IS NULL
    OR v_target.id IS NULL
    OR v_source.record_status IS DISTINCT FROM 'merged'
    OR v_source.merged_into_profile_id IS DISTINCT FROM p_target_profile_id
    OR v_target.record_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'The profile merge did not leave the expected canonical identity state.';
  END IF;

  v_merge_correlation_id := nullif(v_result ->> 'correlationId', '')::uuid;
  v_review_id := nullif(v_result ->> 'reviewId', '')::uuid;
  SELECT audit.id
  INTO v_merge_audit_id
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.actor_user_id = p_actor_user_id
    AND audit.action = 'profile.merge'
    AND audit.target_type = 'csf_profiles'
    AND audit.target_id = p_target_profile_id
    AND audit.correlation_id = v_merge_correlation_id
    AND audit.after_data ->> 'sourceProfileId' = p_source_profile_id::text
  LIMIT 1;
  IF v_merge_correlation_id IS NULL
    OR v_review_id IS NULL
    OR v_merge_audit_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_merge_reviews AS review
      WHERE review.id = v_review_id
        AND review.organization_id = p_organization_id
        AND review.source_profile_id = p_source_profile_id
        AND review.target_profile_id = p_target_profile_id
        AND review.reviewed_by = p_actor_user_id
        AND review.status = 'approved'
        AND review.correlation_id = v_merge_correlation_id
    ) THEN
    RAISE EXCEPTION 'The profile merge did not produce complete audit evidence.';
  END IF;

  v_state_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'source', to_jsonb(v_source),
          'target', to_jsonb(v_target)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'profile.merge_request_committed',
    'csf_profiles',
    p_target_profile_id,
    pg_catalog.jsonb_build_object(
      'requestFingerprint', v_request_fingerprint,
      'stateFingerprint', v_state_fingerprint,
      'mergeCorrelationId', v_merge_correlation_id,
      'reviewId', v_review_id,
      'mergeAuditId', v_merge_audit_id,
      'result', v_result
    ),
    p_request_id,
    'profile_merge_request',
    p_source_profile_id::text,
    'duplicate_profile_merge_committed'
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_preview_relationship_base(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles_identity_base(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid) IS
  'Returns relationship conflicts plus exact identity corroboration; name similarity alone can never make a merge ready.';
COMMENT ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid) IS
  'Owner-internal compatibility implementation that revalidates authority and performs the locked identity-safe merge; service callers must use the request-aware overload.';
COMMENT ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid) IS
  'Request-aware profile merge entrypoint: reauthorizes before receipt evidence, binds actor and normalized intent, and replays only while the exact merged source, active target, review, and audit evidence remain current.';

COMMIT;
