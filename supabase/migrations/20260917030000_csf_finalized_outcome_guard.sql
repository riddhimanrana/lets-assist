-- Hold every new verdict against a finalized outcome, and pick the current
-- semester deterministically.
--
-- S2. The historical-outcome guard exempted acceptance. Only a rejection was
-- held against a `completed` or `not_completed` membership, so a green mark on
-- an applicant whose semester had already finished republished an acceptance
-- over that outcome. `not_completed` was the sharper case: a student who did
-- not meet the requirements was flipped back to accepted and active. The
-- reachable window is an open term that already carries finalized memberships,
-- which is exactly the state between requirement evaluation and term close.
--
-- Both the publish primitive and the release planner now hold any terminal
-- verdict against a finalized membership. The officer sees the row reported as
-- `historical_outcome` rather than watching it overwrite a finished semester.
--
-- S6. `csf_terms.is_current` has no unique index, so nothing stops two terms
-- carrying it. The member projection picked one with `LIMIT 1` and no order,
-- making a student's whole view depend on an arbitrary plan choice. The pick is
-- ordered now. A partial unique index is deliberately not added here: terms are
-- per cohort and the coordinator wants a canonical selection, not a constraint
-- that would reject legitimate rows.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_publish_sheet_application_decision(
  p_organization_id uuid,
  p_application_id uuid,
  p_decision text,
  p_reason text,
  p_actor_user_id uuid,
  p_basis jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_previous_status text;
  v_membership plugin_data.csf_term_memberships%ROWTYPE;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_correlation_id uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz := pg_catalog.now();
  v_membership_status text;
  v_reason_code plugin_data.csf_application_reason_code;
BEGIN
  IF p_decision NOT IN ('accepted', 'rejected', 'unreviewed') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = pg_catalog.format('Unsupported released Sheet decision: %s', p_decision);
  END IF;

  SELECT application.*
  INTO v_application
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'no_data_found', MESSAGE = 'CSF application not found.';
  END IF;

  v_previous_status := v_application.status;

  SELECT membership.*
  INTO v_membership
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = v_application.profile_id
    AND membership.term_id = v_application.term_id
  FOR UPDATE;

  -- Every verdict, not only a rejection. A green mark on a student whose
  -- semester already finished would republish an acceptance over that outcome,
  -- and `not_completed` is the sharper case: someone who did not meet the
  -- requirements would be flipped back to accepted and active. A finalized
  -- outcome is the chapter's published record either way.
  IF v_membership.status IN ('completed', 'not_completed') THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'A finalized term membership keeps its published outcome.',
      DETAIL = 'CSF_RELEASE_BLOCKER=historical_outcome';
  END IF;

  IF p_decision = 'accepted' THEN
    PERFORM plugin_data.csf_decide_term_application_policy_base(
      p_organization_id, p_application_id, 'accepted',
      coalesce(v_reason, 'Accepted in the chapter application review Sheet.'),
      p_actor_user_id
    );
    v_reason_code := 'approved_sheet_review'::plugin_data.csf_application_reason_code;

  ELSIF p_decision = 'rejected' AND v_membership.status IS DISTINCT FROM 'active' THEN
    PERFORM plugin_data.csf_decide_term_application_policy_base(
      p_organization_id, p_application_id, 'rejected',
      coalesce(v_reason, 'Rejected in the chapter application review Sheet.'),
      p_actor_user_id
    );
    v_reason_code := 'rejected_sheet_review'::plugin_data.csf_application_reason_code;

  ELSIF p_decision = 'rejected' THEN
    -- The base refuses to reject an active member. Here that is the point: the
    -- officer changed a published verdict and access has to follow. Earned
    -- points, proofs, and attendance stay untouched; only the term membership
    -- is revoked.
    UPDATE plugin_data.csf_term_applications
    SET
      status = 'rejected',
      submission_status = 'decided'::plugin_data.csf_application_submission_status,
      decision_status = 'rejected'::plugin_data.csf_application_decision_status,
      decision_reason_code = 'rejected_sheet_review'::plugin_data.csf_application_reason_code,
      decision_reason = coalesce(v_reason, 'Rejected in the chapter application review Sheet.'),
      decision_correlation_id = v_correlation_id,
      reviewed_by = p_actor_user_id,
      reviewed_at = v_now,
      review_notes = coalesce(v_reason, 'Rejected in the chapter application review Sheet.'),
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND id = p_application_id;

    UPDATE plugin_data.csf_term_memberships
    SET
      status = 'revoked',
      status_reason = coalesce(v_reason, 'Rejected in the chapter application review Sheet.'),
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND profile_id = v_application.profile_id
      AND term_id = v_application.term_id;

    INSERT INTO plugin_data.csf_application_status_events (
      organization_id, application_id, actor_user_id, previous_status,
      next_status, reason, reason_code, correlation_id, details
    )
    VALUES (
      p_organization_id, p_application_id, p_actor_user_id, v_previous_status,
      'rejected', v_reason, 'rejected_sheet_review'::plugin_data.csf_application_reason_code,
      v_correlation_id,
      pg_catalog.jsonb_build_object(
        'basis', 'sheet_review',
        'previousMembershipStatus', v_membership.status,
        'termMembershipStatus', 'revoked'
      )
    );
    v_reason_code := 'rejected_sheet_review'::plugin_data.csf_application_reason_code;

  ELSE
    -- Uncolored after publication. The chapter's instruction is that access
    -- follows the sheet immediately: the published outcome is retracted and the
    -- applicant presents as unreviewed again.
    UPDATE plugin_data.csf_term_applications
    SET
      status = 'needs_review',
      submission_status = 'ready'::plugin_data.csf_application_submission_status,
      decision_status = 'pending'::plugin_data.csf_application_decision_status,
      decision_reason_code = NULL,
      decision_reason = NULL,
      decision_correlation_id = v_correlation_id,
      reviewed_by = p_actor_user_id,
      reviewed_at = v_now,
      review_notes = 'The review Sheet row is no longer marked, so the published decision was withdrawn.',
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND id = p_application_id;

    UPDATE plugin_data.csf_term_memberships
    SET
      status = 'revoked',
      status_reason = 'The review Sheet row is no longer marked, so the published decision was withdrawn.',
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND profile_id = v_application.profile_id
      AND term_id = v_application.term_id
      AND status IN ('pending', 'accepted', 'active');

    INSERT INTO plugin_data.csf_application_status_events (
      organization_id, application_id, actor_user_id, previous_status,
      next_status, reason, correlation_id, details
    )
    VALUES (
      p_organization_id, p_application_id, p_actor_user_id, v_previous_status,
      'needs_review',
      'The review Sheet row is no longer marked, so the published decision was withdrawn.',
      v_correlation_id,
      pg_catalog.jsonb_build_object(
        'basis', 'sheet_review_retraction',
        'previousMembershipStatus', v_membership.status
      )
    );
    v_reason_code := NULL;
  END IF;

  -- The base stamps `approved_standard`/`approved_adviser_override`, which
  -- would read as "the in-product academic path cleared this applicant". It
  -- did not: an officer decided in the Sheet.
  IF v_reason_code IS NOT NULL THEN
    UPDATE plugin_data.csf_term_applications
    SET decision_reason_code = v_reason_code
    WHERE organization_id = p_organization_id
      AND id = p_application_id;
  END IF;

  SELECT membership.status
  INTO v_membership_status
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = v_application.profile_id
    AND membership.term_id = v_application.term_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  )
  VALUES (
    p_organization_id, p_actor_user_id,
    'application.sheet_review_' || CASE p_decision
      WHEN 'accepted' THEN 'accepted'
      WHEN 'rejected' THEN 'rejected'
      ELSE 'retracted'
    END,
    'csf_term_applications', p_application_id, v_application.term_id,
    pg_catalog.jsonb_build_object(
      'legacyStatus', v_previous_status,
      'decisionStatus', v_application.decision_status,
      'termMembershipStatus', v_membership.status
    ),
    pg_catalog.jsonb_build_object(
      -- Named explicitly so no reader mistakes this for computed eligibility.
      'decisionBasis', 'officer_external_sheet_review',
      'academicPreflightEvaluated', false,
      'eligibilityStatus', v_application.eligibility_status,
      'decision', p_decision,
      'reason', v_reason,
      'termMembershipStatus', v_membership_status,
      'source', coalesce(p_basis, '{}'::jsonb)
    ),
    v_correlation_id, 'sheet_application_review', p_application_id::text,
    CASE WHEN v_reason_code IS NULL THEN NULL ELSE v_reason_code::text END
  );

  RETURN pg_catalog.jsonb_build_object(
    'applicationId', p_application_id,
    'decision', p_decision,
    'termMembershipStatus', v_membership_status,
    'correlationId', v_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_release_sheet_application_decisions(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_term_id uuid,
  p_request_id uuid,
  p_application_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_term plugin_data.csf_terms%ROWTYPE;
  v_existing plugin_data.csf_application_decision_releases%ROWTYPE;
  v_release_id uuid;
  v_now timestamptz := pg_catalog.now();
  v_plan record;
  v_held jsonb;
  v_pending integer;
  v_accepted integer;
  v_rejected integer;
  v_held_count integer;
  v_fingerprint text;
BEGIN
  PERFORM plugin_data.csf_assert_sheet_decision_authority(
    p_organization_id, p_actor_user_id, 'decide_applications',
    'Not authorized to release CSF application decisions.'
  );

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'A stable release request identifier is required.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_decision_release_request:'
        || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );

  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'termId', p_term_id,
          'applicationIds', pg_catalog.to_jsonb(p_application_ids)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  SELECT release.* INTO v_existing
  FROM plugin_data.csf_application_decision_releases AS release
  WHERE release.organization_id = p_organization_id
    AND release.request_id = p_request_id;
  IF FOUND THEN
    -- Same request asked again is a replay. Same id aimed at another term or
    -- another subset is a different intent and must not read this receipt.
    IF v_existing.term_id IS DISTINCT FROM p_term_id
      OR v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION USING
        MESSAGE = 'That release request identifier is already bound to a different release.',
        DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=request_conflict',
        HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;

    SELECT term.* INTO v_term
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id AND term.id = v_existing.term_id;
    RETURN pg_catalog.jsonb_build_object(
      'releaseId', v_existing.id,
      'termId', v_existing.term_id,
      'released', v_existing.released_count,
      'accepted', v_existing.accepted_count,
      'rejected', v_existing.rejected_count,
      'pending', v_existing.pending_count,
      'held', v_existing.held,
      'heldCount', v_existing.held_count,
      'firstReleasedAt', v_term.decisions_first_released_at,
      'lastReleasedAt', v_term.decisions_last_released_at,
      'releaseCount', v_term.decisions_release_count,
      'replay', true
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_sheet_decision_term_lock_key(p_organization_id, p_term_id)
  );

  SELECT term.* INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'no_data_found', MESSAGE = 'CSF term not found.';
  END IF;
  IF v_term.application_review_source <> 'sheet' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'This term does not review applications in a Sheet.',
      DETAIL = 'CSF_SHEET_REVIEW_MODE=not_enabled';
  END IF;
  IF v_term.lifecycle_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'A closed term keeps its published outcomes.',
      DETAIL = 'CSF_RELEASE_BLOCKER=term_closed';
  END IF;

  -- Plan first, with every row locked, so the receipt can be written with its
  -- final counts before any publication happens.
  CREATE TEMP TABLE IF NOT EXISTS csf_decision_release_plan (
    application_id uuid,
    staged_decision text,
    staged_reason text,
    block_reason text,
    disposition text
  ) ON COMMIT DROP;
  DELETE FROM pg_temp.csf_decision_release_plan;

  INSERT INTO pg_temp.csf_decision_release_plan
  SELECT
    stage.application_id,
    stage.staged_decision,
    stage.staged_reason,
    CASE
      WHEN stage.block_reason IS NOT NULL THEN stage.block_reason
      WHEN stage.staged_decision = 'conflict' THEN 'unmapped_color'
      WHEN stage.staged_decision = 'rejected_with_explanation'
        AND nullif(pg_catalog.btrim(coalesce(stage.staged_reason, '')), '') IS NULL
        THEN 'missing_yellow_reason'
      WHEN stage.staged_decision
             IN ('accepted', 'rejected', 'rejected_with_explanation')
        AND membership.status IN ('completed', 'not_completed')
        THEN 'historical_outcome'
      ELSE NULL
    END,
    CASE
      WHEN stage.staged_decision = 'unreviewed' THEN 'pending'
      WHEN stage.blocks_release THEN 'held'
      WHEN stage.staged_decision
             IN ('accepted', 'rejected', 'rejected_with_explanation')
        AND membership.status IN ('completed', 'not_completed')
        THEN 'held'
      ELSE 'release'
    END
  FROM plugin_data.csf_application_decision_stages AS stage
  LEFT JOIN plugin_data.csf_term_memberships AS membership
    ON membership.organization_id = stage.organization_id
   AND membership.profile_id = stage.profile_id
   AND membership.term_id = stage.term_id
  WHERE stage.organization_id = p_organization_id
    AND stage.term_id = p_term_id
    AND stage.release_state = 'staged'
    AND (p_application_ids IS NULL OR stage.application_id = ANY(p_application_ids));

  SELECT
    pg_catalog.count(*) FILTER (WHERE disposition = 'pending'),
    pg_catalog.count(*) FILTER (WHERE disposition = 'held'),
    pg_catalog.count(*) FILTER (WHERE disposition = 'release' AND staged_decision = 'accepted'),
    pg_catalog.count(*) FILTER (
      WHERE disposition = 'release'
        AND staged_decision IN ('rejected', 'rejected_with_explanation')
    ),
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'applicationId', application_id,
          'blockReason', coalesce(block_reason, 'unmapped_color')
        )
        ORDER BY application_id
      ) FILTER (WHERE disposition = 'held'),
      '[]'::jsonb
    )
  INTO v_pending, v_held_count, v_accepted, v_rejected, v_held
  FROM pg_temp.csf_decision_release_plan;

  INSERT INTO plugin_data.csf_application_decision_releases (
    organization_id, term_id, actor_user_id, request_id, request_fingerprint,
    released_count, accepted_count, rejected_count, held_count, pending_count, held
  )
  VALUES (
    p_organization_id, p_term_id, p_actor_user_id, p_request_id, v_fingerprint,
    v_accepted + v_rejected, v_accepted, v_rejected, v_held_count, v_pending, v_held
  )
  RETURNING id INTO v_release_id;

  FOR v_plan IN
    SELECT * FROM pg_temp.csf_decision_release_plan
    WHERE disposition = 'release'
    ORDER BY application_id
  LOOP
    PERFORM plugin_data.csf_publish_sheet_application_decision(
      p_organization_id,
      v_plan.application_id,
      CASE WHEN v_plan.staged_decision = 'accepted' THEN 'accepted' ELSE 'rejected' END,
      v_plan.staged_reason,
      p_actor_user_id,
      pg_catalog.jsonb_build_object(
        'releaseId', v_release_id,
        'termId', p_term_id,
        'stagedDecision', v_plan.staged_decision,
        'trigger', 'term_release'
      )
    );

    UPDATE plugin_data.csf_application_decision_stages
    SET
      release_state = 'released',
      released_decision =
        CASE WHEN v_plan.staged_decision = 'accepted' THEN 'accepted' ELSE 'rejected' END,
      released_reason = v_plan.staged_reason,
      released_at = v_now,
      released_by = p_actor_user_id,
      release_id = v_release_id,
      last_applied_at = v_now,
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND application_id = v_plan.application_id;
  END LOOP;

  UPDATE plugin_data.csf_terms
  SET
    decisions_first_released_at = coalesce(decisions_first_released_at, v_now),
    decisions_last_released_at = v_now,
    decisions_release_count = decisions_release_count + 1,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_term_id
  RETURNING * INTO v_term;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    after_data, correlation_id, source_type, source_id
  )
  VALUES (
    p_organization_id, p_actor_user_id, 'application_decisions.released',
    'csf_application_decision_releases', v_release_id, p_term_id,
    pg_catalog.jsonb_build_object(
      'decisionBasis', 'officer_external_sheet_review',
      'released', v_accepted + v_rejected,
      'accepted', v_accepted,
      'rejected', v_rejected,
      'pending', v_pending,
      'held', v_held
    ),
    p_request_id, 'sheet_application_review', v_release_id::text
  );

  RETURN pg_catalog.jsonb_build_object(
    'releaseId', v_release_id,
    'termId', p_term_id,
    'released', v_accepted + v_rejected,
    'accepted', v_accepted,
    'rejected', v_rejected,
    'pending', v_pending,
    'held', v_held,
    'heldCount', v_held_count,
    'firstReleasedAt', v_term.decisions_first_released_at,
    'lastReleasedAt', v_term.decisions_last_released_at,
    'releaseCount', v_term.decisions_release_count,
    'replay', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_member_term_review_state(
  p_organization_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_membership_status text;
  v_pending boolean := false;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CSF member access denied.';
  END IF;

  SELECT account.profile_id
  INTO v_profile_id
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.user_id = p_actor_user_id
    AND account.status = 'verified'
    AND account.revoked_at IS NULL
  ORDER BY account.is_primary DESC, account.linked_at DESC
  LIMIT 1;

  -- `is_current` carries no unique index, so two terms can hold it. Order the
  -- pick instead of letting the plan choose which semester a member sees.
  SELECT term.* INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.is_current
  ORDER BY term.starts_at DESC NULLS LAST, term.created_at DESC, term.id DESC
  LIMIT 1;

  IF v_profile_id IS NULL OR v_term.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'termId', v_term.id,
      'reviewSource', v_term.application_review_source,
      'applicationPending', false,
      'memberToolsAvailable', false
    );
  END IF;

  SELECT membership.status
  INTO v_membership_status
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = v_profile_id
    AND membership.term_id = v_term.id;

  SELECT EXISTS (
    SELECT 1
    FROM plugin_data.csf_term_applications AS application
    WHERE application.organization_id = p_organization_id
      AND application.profile_id = v_profile_id
      AND application.term_id = v_term.id
      AND application.decision_status = 'pending'
  )
  INTO v_pending;

  RETURN pg_catalog.jsonb_build_object(
    'termId', v_term.id,
    'reviewSource', v_term.application_review_source,
    'applicationPending', v_pending,
    'memberToolsAvailable', coalesce(v_membership_status, '') IN ('accepted', 'active')
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_publish_sheet_application_decision(uuid, uuid, text, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_release_sheet_application_decisions(uuid, uuid, uuid, uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_release_sheet_application_decisions(uuid, uuid, uuid, uuid, uuid[])
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_member_term_review_state(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_member_term_review_state(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_publish_sheet_application_decision(uuid, uuid, text, text, uuid, jsonb) IS
  'Publishes one externally reviewed decision. A finalized term membership keeps its published outcome, whatever the Sheet now says.';

COMMIT;
