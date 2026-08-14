-- Close the last central-import lock inversion and remove caller authority over
-- row outcome classification.
--
-- The begin boundary used to lock the attempt/import row before the commit
-- boundary later asked for the organization identity lock. Profile merge takes
-- those resources in the opposite order. Both begin and commit now use the same
-- outer order:
--
--   1. organization identity advisory lock
--   2. current import-actor authorization
--   3. active target profiles, ordered by UUID
--   4. the historical operation's attempt/job/import-row locks
--
-- A transport caller cannot prove that a database transaction failed. The
-- replacement failure RPC therefore records only an unresolved unknown outcome.
-- Terminal failure remains reachable only through authoritative reconciliation
-- evidence. This migration deliberately does not invent an exception seam or a
-- caller-supplied SQLSTATE channel for terminal classification.

BEGIN;

ALTER FUNCTION plugin_data.csf_begin_import_row_for_attempt(uuid, uuid, uuid)
  RENAME TO csf_begin_import_row_for_attempt_identity_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_begin_import_row_for_attempt(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_import_row_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
  v_preview_job_id uuid;
  v_target_profile_id uuid;
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);

  SELECT
    coalesce(
      nullif(attempt.actor_snapshot->>'claimedBy', '')::uuid,
      attempt.actor_user_id
    ),
    commit_job.preview_job_id,
    import_row.commit_target_profile_id
  INTO v_actor_user_id, v_preview_job_id, v_target_profile_id
  FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
  JOIN plugin_data.csf_sheet_import_jobs AS commit_job
    ON commit_job.organization_id = attempt.organization_id
   AND commit_job.id = attempt.commit_job_id
  JOIN plugin_data.csf_sheet_import_rows AS import_row
    ON import_row.organization_id = attempt.organization_id
   AND import_row.job_id = commit_job.preview_job_id
   AND import_row.id = p_import_row_id
  WHERE attempt.organization_id = p_organization_id
    AND attempt.id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF import row was not found for this commit.'
      USING ERRCODE = '23503';
  END IF;

  PERFORM plugin_data.csf_assert_import_actor_for_job(
    p_organization_id, v_actor_user_id, v_preview_job_id
  );
  PERFORM plugin_data.csf_lock_active_import_profiles(
    p_organization_id, ARRAY[v_target_profile_id]::uuid[]
  );
  RETURN plugin_data.csf_begin_import_row_for_attempt_identity_base(
    p_organization_id, p_attempt_id, p_import_row_id
  );
END;
$$;

-- The renamed body is owner-internal. The public boundary above retains the
-- exact three-argument service contract while enforcing the shared outer order.
REVOKE ALL ON FUNCTION plugin_data.csf_begin_import_row_for_attempt_identity_base(
  uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_begin_import_row_for_attempt(
  uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_begin_import_row_for_attempt(
  uuid, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_begin_import_row_for_attempt_identity_base(
  uuid, uuid, uuid
) IS 'Owner-internal begin-intent body. The service boundary must first lock organization identity, reauthorize the frozen actor, and lock active import targets.';

COMMENT ON FUNCTION plugin_data.csf_begin_import_row_for_attempt(
  uuid, uuid, uuid
) IS 'Begins one central import row intent after the canonical identity-first lock order and current actor reauthorization.';

-- Remove the outcome selector completely. Keeping both overloads would preserve
-- the old service-role capability and make positional RPC calls ambiguous.
DROP FUNCTION IF EXISTS plugin_data.csf_fail_import_row_for_attempt(
  uuid, uuid, uuid, text, text, boolean
);

CREATE OR REPLACE FUNCTION plugin_data.csf_fail_import_row_for_attempt(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_import_row_id uuid,
  p_reason_code text,
  p_detail text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt plugin_data.csf_sheet_import_commit_attempts%ROWTYPE;
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_code text;
  v_detail text;
BEGIN
  -- This rejects a stale, expired, failed, aborted, or superseded attempt before
  -- it can inspect or settle a row.
  v_attempt := plugin_data.csf_assert_active_import_commit_attempt(
    p_organization_id, p_attempt_id
  );
  v_row := plugin_data.csf_assert_import_row_for_attempt(
    p_organization_id, p_attempt_id, p_import_row_id
  );

  -- Idempotent readback only. Transport settlement can never overwrite a real
  -- write, an authoritative/reconciled failure, an earlier unknown, or retained
  -- pre-ledger history.
  IF v_row.import_status <> 'pending'
    OR v_row.commit_outcome_state IN (
      'succeeded', 'failed', 'unknown', 'historical_unknown'
    )
  THEN
    RETURN jsonb_build_object(
      'recorded', false,
      'importStatus', v_row.import_status,
      'outcomeState', v_row.commit_outcome_state,
      'commitAttemptId', v_row.commit_attempt_id
    );
  END IF;

  -- A transport outcome exists only after begin recorded a live write intent.
  -- Neither a never-started frozen row nor another attempt's intent is this
  -- attempt's uncertainty to settle.
  IF v_row.commit_outcome_state <> 'in_flight'
    OR v_row.commit_intent_attempt_id IS DISTINCT FROM p_attempt_id
    OR v_row.commit_intent_correlation_id IS DISTINCT FROM v_attempt.correlation_id
  THEN
    RAISE EXCEPTION
      'Only the active attempt that started this CSF import write may record its transport outcome as unknown.'
      USING ERRCODE = '55P03';
  END IF;

  v_code := plugin_data.csf_bounded_reason_code(
    p_reason_code, 'row_outcome_unknown'
  );
  v_detail := plugin_data.csf_bounded_failure_detail(p_detail);

  UPDATE plugin_data.csf_sheet_import_rows
  SET commit_outcome_state = 'unknown',
      commit_outcome_unresolved = true,
      commit_outcome_code = v_code,
      commit_outcome_correlation_id = v_attempt.correlation_id,
      commit_outcome_note = coalesce(
        v_detail,
        'The authoritative outcome of this row could not be determined.'
      )
  WHERE organization_id = p_organization_id
    AND id = p_import_row_id;

  RETURN jsonb_build_object(
    'recorded', true,
    'outcomeState', 'unknown',
    'outcomeCode', v_code,
    'importStatus', v_row.import_status,
    'commitAttemptId', p_attempt_id,
    'correlationId', v_attempt.correlation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_fail_import_row_for_attempt(
  uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_fail_import_row_for_attempt(
  uuid, uuid, uuid, text, text
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_fail_import_row_for_attempt(
  uuid, uuid, uuid, text, text
) IS 'Records only an active attempt-owned unanswered transport outcome as unknown. It cannot classify a terminal failure or overwrite terminal, historical, duplicate, or other-attempt state.';

-- A failed row may carry one of two authoritative attempt links:
--
--   * commit_attempt_id when the database recorded a deterministic failure; or
--   * commit_intent_attempt_id when an unanswered transport was reconciled as not
--     written. In that shape commit_attempt_id must stay NULL because no write was
--     recorded, but the begin-intent attempt is still durable failure lineage.
--
-- The historical guard admitted a retry/skip only when the retained attempt equaled
-- OLD.commit_attempt_id. Teach the invariant the same database-derived fallback as
-- the settlement boundary; callers still cannot supply or fabricate an attempt id.
CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_import_row_attempt_lineage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_attempt plugin_data.csf_sheet_import_commit_attempts%ROWTYPE;
  v_commit plugin_data.csf_sheet_import_jobs%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.commit_frozen_at IS NOT NULL THEN
    IF ROW(
      NEW.commit_frozen_at, NEW.commit_frozen_by_job_id, NEW.commit_frozen_row_hash,
      NEW.commit_frozen_source_id, NEW.commit_frozen_source_revision,
      NEW.commit_frozen_payload_hash, NEW.commit_frozen_actor_user_id,
      NEW.commit_frozen_actor_snapshot, NEW.commit_target_profile_id,
      NEW.commit_resolution_snapshot
    ) IS DISTINCT FROM ROW(
      OLD.commit_frozen_at, OLD.commit_frozen_by_job_id, OLD.commit_frozen_row_hash,
      OLD.commit_frozen_source_id, OLD.commit_frozen_source_revision,
      OLD.commit_frozen_payload_hash, OLD.commit_frozen_actor_user_id,
      OLD.commit_frozen_actor_snapshot, OLD.commit_target_profile_id,
      OLD.commit_resolution_snapshot
    ) THEN
      RAISE EXCEPTION
        'This CSF import row has a frozen commit decision; it cannot be re-frozen while that commit is outstanding.'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.commit_target_profile_id IS NOT NULL
      AND NEW.matched_profile_id IS DISTINCT FROM OLD.commit_target_profile_id
    THEN
      RAISE EXCEPTION
        'This CSF import row is frozen to a reviewed member; it cannot be re-matched to another.'
        USING ERRCODE = '55000';
    END IF;
    IF OLD.commit_target_profile_id IS NULL
      AND OLD.matched_profile_id IS NOT NULL
      AND NEW.matched_profile_id IS DISTINCT FROM OLD.matched_profile_id
    THEN
      RAISE EXCEPTION
        'This CSF import row already records the member its commit created; it cannot be re-matched.'
        USING ERRCODE = '55000';
    END IF;
    IF OLD.commit_target_profile_id IS NULL
      AND OLD.matched_profile_id IS NULL
      AND NEW.matched_profile_id IS NOT NULL
      AND NOT (
        OLD.commit_outcome_state = 'in_flight'
        AND OLD.commit_intent_attempt_id IS NOT NULL
        AND OLD.import_status = 'pending'
        AND NEW.import_status IN ('created', 'updated')
        AND NEW.resolved_by IS NOT DISTINCT FROM OLD.commit_frozen_actor_user_id
      )
    THEN
      RAISE EXCEPTION
        'This CSF import row has no live write result that may establish its committed member.'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.import_status IS DISTINCT FROM OLD.import_status
      AND NOT (
        (OLD.import_status = 'pending' AND NEW.import_status IN ('created', 'updated', 'error'))
        OR (OLD.import_status = 'error' AND NEW.import_status IN ('pending', 'skipped')
          AND NEW.commit_retry_count > OLD.commit_retry_count
          AND NEW.commit_last_failed_attempt_id IS NOT DISTINCT FROM
            coalesce(OLD.commit_attempt_id, OLD.commit_intent_attempt_id)
          AND NEW.commit_attempt_id IS NULL)
      )
    THEN
      RAISE EXCEPTION
        'This CSF import row has a frozen commit decision; its include or skip decision cannot change while that commit is outstanding.'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.import_status <> 'pending'
      AND NEW.resolution_status IS DISTINCT FROM OLD.resolution_status
      AND NEW.commit_retry_count IS NOT DISTINCT FROM OLD.commit_retry_count
    THEN
      RAISE EXCEPTION
        'This CSF import row is already terminal for its frozen commit; its reconciliation state cannot be rewritten.'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.commit_outcome_state IS DISTINCT FROM OLD.commit_outcome_state THEN
    IF NOT (
      (OLD.commit_outcome_state = 'not_started' AND NEW.commit_outcome_state IN ('frozen', 'historical_unknown'))
      OR (OLD.commit_outcome_state = 'frozen' AND NEW.commit_outcome_state IN ('in_flight', 'failed'))
      OR (OLD.commit_outcome_state = 'in_flight' AND NEW.commit_outcome_state IN ('succeeded', 'failed', 'unknown'))
      OR (OLD.commit_outcome_state = 'unknown' AND NEW.commit_outcome_state IN ('succeeded', 'failed'))
      OR (OLD.commit_outcome_state = 'historical_unknown' AND NEW.commit_outcome_state = 'succeeded')
      OR (OLD.commit_outcome_state = 'failed' AND NEW.commit_outcome_state = 'frozen'
        AND NEW.commit_retry_count > OLD.commit_retry_count
        AND NEW.commit_last_failed_attempt_id IS NOT DISTINCT FROM
          coalesce(OLD.commit_attempt_id, OLD.commit_intent_attempt_id)
        AND NEW.commit_attempt_id IS NULL)
    ) THEN
      RAISE EXCEPTION
        'A CSF import row cannot move from commit outcome "%" to "%".',
        OLD.commit_outcome_state, NEW.commit_outcome_state
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.commit_outcome_state IN ('succeeded', 'failed')
    AND NEW.commit_outcome_state = OLD.commit_outcome_state
    AND OLD.commit_outcome_resolution IS NOT NULL
    AND NEW.commit_retry_count IS NOT DISTINCT FROM OLD.commit_retry_count
    AND ROW(NEW.commit_outcome_resolution, NEW.commit_outcome_resolved_by, NEW.commit_outcome_resolved_at)
      IS DISTINCT FROM
       ROW(OLD.commit_outcome_resolution, OLD.commit_outcome_resolved_by, OLD.commit_outcome_resolved_at)
  THEN
    RAISE EXCEPTION
      'A settled CSF import row outcome cannot be re-reconciled.'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.commit_attempt_id IS NOT NULL
    AND NEW.commit_attempt_id IS DISTINCT FROM OLD.commit_attempt_id
    AND NOT (
      NEW.commit_attempt_id IS NULL
      AND NEW.commit_last_failed_attempt_id IS NOT DISTINCT FROM OLD.commit_attempt_id
      AND NEW.commit_retry_count > OLD.commit_retry_count
    )
  THEN
    RAISE EXCEPTION
      'A CSF import row already records the commit attempt that wrote it; it cannot be cleared or re-pointed.'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.commit_attempt_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.commit_attempt_id IS NOT DISTINCT FROM NEW.commit_attempt_id THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_attempt
  FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
  WHERE attempt.id = NEW.commit_attempt_id
    AND attempt.organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The CSF commit attempt named by this import row does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_commit
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  WHERE commit_job.id = v_attempt.commit_job_id;
  IF NOT FOUND OR v_commit.mode <> 'commit' THEN
    RAISE EXCEPTION
      'A CSF import row may only name an attempt of a commit job.'
      USING ERRCODE = '23514';
  END IF;

  IF v_commit.preview_job_id IS DISTINCT FROM NEW.job_id THEN
    RAISE EXCEPTION
      'A CSF import row may only be committed by an attempt derived from its own preview.'
      USING ERRCODE = '23514';
  END IF;

  IF v_attempt.status <> 'running'
    OR v_attempt.lease_expires_at IS NULL
    OR v_attempt.lease_expires_at <= now()
    OR v_commit.active_commit_attempt_id IS DISTINCT FROM v_attempt.id
  THEN
    RAISE EXCEPTION
      'Only the active, unexpired CSF commit attempt may record row lineage.'
      USING ERRCODE = '55P03';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_import_row_attempt_lineage()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_settle_failed_import_row(
  p_organization_id uuid,
  p_import_row_id uuid,
  p_actor_user_id uuid,
  p_decision text,
  p_reason_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_commit plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_preview_job_id uuid;
  v_failed_attempt_id uuid;
  v_code text;
  v_running integer;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Deciding a failed CSF import row requires the acting officer.'
      USING ERRCODE = '23502';
  END IF;
  IF p_decision NOT IN ('retry', 'skip') THEN
    RAISE EXCEPTION 'A failed CSF import row may only be retried or skipped.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM plugin_data.csf_assert_import_actor_for_row(
    p_organization_id, p_actor_user_id, p_import_row_id
  );

  SELECT import_row.job_id INTO v_preview_job_id
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_import_row_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF import row was not found.' USING ERRCODE = '23503';
  END IF;

  PERFORM plugin_data.csf_lock_import_commit_coordinate(
    p_organization_id, v_preview_job_id, true
  );

  SELECT * INTO v_row
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_import_row_id
    AND import_row.job_id = v_preview_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF import row changed commit coordinates while it was being decided.'
      USING ERRCODE = '55P03';
  END IF;

  -- Authorization is revalidated after the canonical coordinate lock so a
  -- concurrent officer-role change cannot be hidden behind the initial lookup.
  PERFORM plugin_data.csf_assert_import_actor_for_job(
    p_organization_id, p_actor_user_id, v_row.job_id
  );

  SELECT * INTO v_commit
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  WHERE commit_job.organization_id = p_organization_id
    AND commit_job.mode = 'commit'
    AND commit_job.preview_job_id = v_row.job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This CSF import row has no commit to decide.' USING ERRCODE = '23503';
  END IF;

  IF v_row.commit_outcome_state <> 'failed' OR v_row.import_status <> 'error' THEN
    RETURN jsonb_build_object(
      'settled', false,
      'outcomeState', v_row.commit_outcome_state,
      'importStatus', v_row.import_status,
      'reason', 'not_a_decidable_failure'
    );
  END IF;

  SELECT count(*) INTO v_running
  FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
  WHERE attempt.commit_job_id = v_commit.id
    AND attempt.status = 'running'
    AND attempt.lease_expires_at > now();
  IF v_running > 0 THEN
    RAISE EXCEPTION
      'This CSF import is being committed right now; decide its failed rows once that attempt finishes.'
      USING ERRCODE = '55P03';
  END IF;

  -- A database-recorded write/failure names commit_attempt_id. A reconciled
  -- unanswered transport deliberately does not, but begin-intent still names the
  -- real attempt whose outcome was reviewed. Both values came from the locked row.
  v_failed_attempt_id := coalesce(
    v_row.commit_attempt_id,
    v_row.commit_intent_attempt_id
  );
  IF v_failed_attempt_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
    WHERE attempt.organization_id = p_organization_id
      AND attempt.commit_job_id = v_commit.id
      AND attempt.id = v_failed_attempt_id
  ) THEN
    RAISE EXCEPTION
      'This failed CSF import row has no authoritative attempt lineage to retain.'
      USING ERRCODE = '23514';
  END IF;

  v_code := plugin_data.csf_bounded_reason_code(
    p_reason_code,
    CASE WHEN p_decision = 'retry' THEN 'officer_requested_retry' ELSE 'officer_skipped_failed_row' END
  );

  IF p_decision = 'retry' THEN
    UPDATE plugin_data.csf_sheet_import_rows
    SET import_status = 'pending',
        errors = ARRAY[]::text[],
        commit_last_failed_attempt_id = v_failed_attempt_id,
        commit_attempt_id = NULL,
        commit_retry_count = commit_retry_count + 1,
        commit_outcome_state = 'frozen',
        commit_outcome_code = NULL,
        commit_outcome_note = NULL,
        commit_outcome_correlation_id = NULL,
        commit_outcome_resolution = NULL,
        commit_outcome_resolved_by = NULL,
        commit_outcome_resolved_at = NULL,
        -- A retry has no live intent until the successor attempt calls begin.
        commit_intent_attempt_id = NULL,
        commit_intent_correlation_id = NULL,
        commit_intent_started_at = NULL
    WHERE organization_id = p_organization_id
      AND id = p_import_row_id;
  ELSE
    UPDATE plugin_data.csf_sheet_import_rows
    SET import_status = 'skipped',
        commit_last_failed_attempt_id = v_failed_attempt_id,
        commit_attempt_id = NULL,
        commit_retry_count = commit_retry_count + 1,
        commit_outcome_code = v_code,
        commit_outcome_resolution = 'terminally_skipped',
        commit_outcome_resolved_by = p_actor_user_id,
        commit_outcome_resolved_at = now()
        -- Terminal skip retains the original intent coordinate as evidence; there
        -- will never be a successor begin-intent for this row.
    WHERE organization_id = p_organization_id
      AND id = p_import_row_id;
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    source_type, source_id, after_data
  ) VALUES (
    p_organization_id, p_actor_user_id, 'sheet_import.failed_row_settled',
    'csf_sheet_import_rows', p_import_row_id,
    'sheet_import', v_row.source_id::text,
    jsonb_build_object(
      'decision', p_decision,
      'reasonCode', v_code,
      'commitJobId', v_commit.id,
      'failedAttemptId', v_failed_attempt_id,
      'retryCount', v_row.commit_retry_count + 1,
      'priorOutcomeState', v_row.commit_outcome_state,
      'priorResolution', v_row.commit_outcome_resolution,
      'priorResolvedBy', v_row.commit_outcome_resolved_by,
      'priorResolvedAt', v_row.commit_outcome_resolved_at,
      'priorOutcomeCorrelationId', v_row.commit_outcome_correlation_id
    )
  );

  RETURN jsonb_build_object(
    'settled', true,
    'decision', p_decision,
    'outcomeState', CASE WHEN p_decision = 'retry' THEN 'frozen' ELSE 'failed' END,
    'importStatus', CASE WHEN p_decision = 'retry' THEN 'pending' ELSE 'skipped' END,
    'failedAttemptId', v_failed_attempt_id,
    'reasonCode', v_code
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_settle_failed_import_row(
  uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_settle_failed_import_row(
  uuid, uuid, uuid, text, text
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_settle_failed_import_row(
  uuid, uuid, uuid, text, text
) IS 'Retries or terminally skips a locked, reauthorized failed row while retaining its database-recorded write or begin-intent attempt as immutable failure lineage.';

COMMIT;
