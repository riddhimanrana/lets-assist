-- Keep retryable and unknown import-worker failures outside terminal receipts.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_claim_import_commit_queue(
  p_lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item plugin_data.csf_import_commit_queue%ROWTYPE;
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_completed_commit plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_token uuid := gen_random_uuid();
BEGIN
  IF p_lease_seconds IS NULL
    OR p_lease_seconds < 30
    OR p_lease_seconds > 1200
  THEN
    RAISE EXCEPTION 'Import worker lease must be between 30 and 1200 seconds.'
      USING ERRCODE = '22023';
  END IF;

  SELECT queue.* INTO v_item
  FROM plugin_data.csf_import_commit_queue AS queue
  WHERE queue.status = 'queued'
     OR (queue.status = 'running' AND queue.lease_expires_at <= now())
  -- An expired retry runs before fresh work so a steady approval stream cannot
  -- starve reconciliation. Claiming it renews its lease and removes it from
  -- eligibility during the backoff window, when fresh approvals can proceed.
  -- The five-attempt cap below bounds how often one item can receive priority.
  ORDER BY CASE WHEN queue.status = 'running' THEN 0 ELSE 1 END,
           CASE
             WHEN queue.status = 'running' THEN queue.lease_expires_at
             ELSE queue.created_at
           END,
           queue.id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  SELECT * INTO v_preview
  FROM plugin_data.csf_sheet_import_jobs AS preview
  WHERE preview.organization_id = v_item.organization_id
    AND preview.id = v_item.preview_job_id
    AND preview.mode = 'preview'
  FOR UPDATE;
  IF NOT FOUND OR v_item.actor_user_id IS NULL THEN
    PERFORM plugin_data.csf_block_import_commit_queue(
      v_item.id,
      'preview_or_actor_missing'
    );
    RETURN jsonb_build_object('claimed', false);
  END IF;

  -- A prior worker can durably finalize the logical commit and lose only the
  -- later queue-settlement response. Reconcile that finished work before
  -- checking the original officer's current role. A partially completed job is
  -- terminal only while reclaiming the expired running queue that produced it.
  -- An officer may later resolve its remaining rows and explicitly requeue the
  -- same preview, in which case this queue row is queued and must be claimable.
  -- No new member write occurs during reconciliation, so a later role
  -- revocation must not strand an already-complete batch.
  SELECT commit_job.* INTO v_completed_commit
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  WHERE commit_job.organization_id = v_item.organization_id
    AND commit_job.mode = 'commit'
    AND commit_job.preview_job_id = v_item.preview_job_id
    AND (
      commit_job.status = 'completed'
      OR (
        commit_job.status = 'partially_completed'
        AND v_item.status = 'running'
      )
    )
  FOR UPDATE;
  IF FOUND THEN
    UPDATE plugin_data.csf_import_commit_queue
    SET status = 'running',
        lease_token = v_token,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        attempt_count = attempt_count + 1,
        started_at = coalesce(started_at, now()),
        finished_at = NULL,
        updated_at = now()
    WHERE id = v_item.id;

    PERFORM plugin_data.csf_finish_import_commit_queue(
      v_item.id,
      v_token,
      CASE
        WHEN v_completed_commit.status = 'completed' THEN 'completed'
        ELSE 'blocked'
      END,
      jsonb_build_object(
        'completed', CASE
          WHEN v_completed_commit.status = 'completed' THEN 1
          ELSE 0
        END,
        'blocked', CASE
          WHEN v_completed_commit.status = 'partially_completed' THEN 1
          ELSE 0
        END,
        'reconciledFromCommitJob', true,
        'commitJobId', v_completed_commit.id,
        'commitStatus', v_completed_commit.status
      ),
      CASE
        WHEN v_completed_commit.status = 'partially_completed'
          THEN 'import_partially_completed'
        ELSE NULL
      END
    );
    RETURN jsonb_build_object(
      'claimed', false,
      'reconciled', true,
      'status', CASE
        WHEN v_completed_commit.status = 'completed' THEN 'completed'
        ELSE 'blocked'
      END,
      'commitStatus', v_completed_commit.status
    );
  END IF;

  -- Unknown and retryable outcomes deliberately remain running until their
  -- lease expires. Five failed leases are enough to require officer review.
  -- Explicit reapproval resets this counter in the approval RPC.
  IF v_item.status = 'running' AND v_item.attempt_count >= 5 THEN
    PERFORM plugin_data.csf_block_import_commit_queue(
      v_item.id,
      'import_retry_attempts_exhausted'
    );
    RETURN jsonb_build_object(
      'claimed', false,
      'status', 'blocked',
      'retryExhausted', true
    );
  END IF;

  BEGIN
    PERFORM plugin_data.csf_assert_import_actor(
      v_item.organization_id,
      v_item.actor_user_id,
      v_preview.source_type
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    PERFORM plugin_data.csf_block_import_commit_queue(
      v_item.id,
      'actor_not_authorized'
    );
    RETURN jsonb_build_object('claimed', false);
  END;

  UPDATE plugin_data.csf_import_commit_queue
  SET status = 'running',
      lease_token = v_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempt_count = attempt_count + 1,
      started_at = coalesce(started_at, now()),
      finished_at = NULL,
      updated_at = now()
  WHERE id = v_item.id;

  RETURN jsonb_build_object(
    'claimed', true,
    'queueId', v_item.id,
    'leaseToken', v_token,
    'organizationId', v_item.organization_id,
    'previewJobId', v_item.preview_job_id,
    'actorUserId', v_item.actor_user_id
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_claim_import_commit_queue(integer) IS
  'Claims one import queue item. It first reconciles an already-completed logical commit, then terminalizes only a proven authorization refusal and re-raises transient or unknown authorization failures.';

REVOKE ALL ON FUNCTION plugin_data.csf_claim_import_commit_queue(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_import_commit_queue(integer)
  TO service_role;

CREATE FUNCTION plugin_data.csf_record_deterministic_import_row_failure(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_import_row_id uuid,
  p_reason_code text
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
BEGIN
  -- This helper is owner-internal. Its caller caught a structured database
  -- refusal in the same transaction, after the row subtransaction rolled back.
  v_attempt := plugin_data.csf_assert_active_import_commit_attempt(
    p_organization_id,
    p_attempt_id
  );
  v_row := plugin_data.csf_assert_import_row_for_attempt(
    p_organization_id,
    p_attempt_id,
    p_import_row_id
  );

  IF v_row.import_status <> 'pending'
    OR v_row.commit_outcome_state IN (
      'succeeded', 'failed', 'unknown', 'historical_unknown'
    )
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'recorded', false,
      'importStatus', v_row.import_status,
      'outcomeState', v_row.commit_outcome_state
    );
  END IF;
  IF v_row.commit_outcome_state = 'in_flight'
    AND (
      v_row.commit_intent_attempt_id IS DISTINCT FROM p_attempt_id
      OR v_row.commit_intent_correlation_id IS DISTINCT FROM v_attempt.correlation_id
    )
  THEN
    RAISE EXCEPTION 'Another import attempt owns this row write.'
      USING ERRCODE = '55P03';
  END IF;
  IF v_row.commit_outcome_state NOT IN ('frozen', 'in_flight') THEN
    RAISE EXCEPTION 'This import row is not eligible for deterministic failure settlement.'
      USING ERRCODE = '23514';
  END IF;

  v_code := plugin_data.csf_bounded_reason_code(
    p_reason_code,
    'row_commit_failed'
  );
  UPDATE plugin_data.csf_sheet_import_rows
  SET import_status = 'error',
      errors = ARRAY[v_code]::text[],
      commit_attempt_id = p_attempt_id,
      commit_outcome_state = 'failed',
      commit_outcome_unresolved = false,
      commit_outcome_code = v_code,
      commit_outcome_note = NULL
  WHERE organization_id = p_organization_id
    AND id = p_import_row_id;

  RETURN pg_catalog.jsonb_build_object(
    'recorded', true,
    'importStatus', 'error',
    'outcomeState', 'failed',
    'outcomeCode', v_code,
    'commitAttemptId', p_attempt_id
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_record_deterministic_import_row_failure(
  uuid, uuid, uuid, text
) IS
  'Owner-internal settlement for one structured database refusal caught by the receipt-backed row batch in the same transaction. It cannot classify transport failures.';

REVOKE ALL ON FUNCTION plugin_data.csf_record_deterministic_import_row_failure(
  uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_deterministic_import_row_failure(
  uuid, uuid, uuid, text
) TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_commit_import_row_batch_unserialized(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_request_id uuid,
  p_import_row_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch plugin_data.csf_import_row_batches%ROWTYPE;
  v_row_id uuid;
  v_result jsonb;
  v_outcome text;
  v_failure_receipt jsonb;
  v_failure_reason text;
  v_succeeded integer := 0;
  v_failed integer := 0;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A row batch request ID is required.';
  END IF;
  IF coalesce(cardinality(p_import_row_ids), 0) < 1
    OR cardinality(p_import_row_ids) > 50
  THEN
    RAISE EXCEPTION 'A row batch must contain between one and 50 rows.';
  END IF;
  IF cardinality(p_import_row_ids) <> (
    SELECT count(DISTINCT row_id) FROM unnest(p_import_row_ids) AS row_id
  ) THEN
    RAISE EXCEPTION 'Each import row may appear only once per batch.';
  END IF;

  SELECT * INTO v_batch
  FROM plugin_data.csf_import_row_batches AS batch
  WHERE batch.organization_id = p_organization_id
    AND batch.request_id = p_request_id;
  IF FOUND THEN
    IF v_batch.attempt_id IS DISTINCT FROM p_attempt_id
      OR v_batch.row_ids IS DISTINCT FROM p_import_row_ids
    THEN
      RAISE EXCEPTION 'This row batch request ID belongs to different work.';
    END IF;
    RETURN plugin_data.csf_import_row_batch_receipt(
      p_organization_id,
      p_request_id
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
    WHERE attempt.organization_id = p_organization_id
      AND attempt.id = p_attempt_id
      AND attempt.status = 'running'
      AND attempt.lease_expires_at > now()
  ) THEN
    RAISE EXCEPTION 'The import commit attempt is not active.';
  END IF;

  INSERT INTO plugin_data.csf_import_row_batches (
    organization_id, attempt_id, request_id, row_ids
  ) VALUES (
    p_organization_id, p_attempt_id, p_request_id, p_import_row_ids
  ) RETURNING * INTO v_batch;

  FOREACH v_row_id IN ARRAY p_import_row_ids LOOP
    BEGIN
      PERFORM plugin_data.csf_begin_import_row_for_attempt(
        p_organization_id,
        p_attempt_id,
        v_row_id
      );
      v_result := plugin_data.csf_commit_import_row_for_attempt(
        p_organization_id,
        p_attempt_id,
        v_row_id
      );
      v_outcome := CASE
        WHEN coalesce((v_result ->> 'replayed')::boolean, false) THEN 'recovered'
        WHEN v_result ->> 'importStatus' = 'created' THEN 'created'
        ELSE 'updated'
      END;
      INSERT INTO plugin_data.csf_import_row_batch_outcomes (
        organization_id, batch_id, import_row_id, outcome, result
      ) VALUES (
        p_organization_id,
        v_batch.id,
        v_row_id,
        v_outcome,
        jsonb_build_object(
          'profileId', v_result ->> 'profileId',
          'applicationId', v_result ->> 'applicationId'
        )
      );
      v_succeeded := v_succeeded + 1;
    EXCEPTION
      WHEN SQLSTATE '23505' OR SQLSTATE '23514' THEN
        v_failure_reason := CASE SQLSTATE
          WHEN '23505' THEN 'duplicate_refused'
          WHEN '23514' THEN 'constraint_refused'
        END;
        v_failure_receipt :=
          plugin_data.csf_record_deterministic_import_row_failure(
            p_organization_id,
            p_attempt_id,
            v_row_id,
            v_failure_reason
          );
        IF coalesce((v_failure_receipt ->> 'recorded')::boolean, false)
          IS DISTINCT FROM true
        THEN
          -- The caught database error did not prove a new terminal row state.
          -- Preserve the unresolved state and leave no batch receipt behind.
          RAISE;
        END IF;
        INSERT INTO plugin_data.csf_import_row_batch_outcomes (
          organization_id, batch_id, import_row_id, outcome, reason_code
        ) VALUES (
          p_organization_id,
          v_batch.id,
          v_row_id,
          'failed',
          v_failure_reason
        );
        v_failed := v_failed + 1;
    END;
  END LOOP;

  UPDATE plugin_data.csf_import_row_batches
  SET status = 'completed',
      succeeded_count = v_succeeded,
      failed_count = v_failed,
      completed_at = now()
  WHERE id = v_batch.id;
  RETURN plugin_data.csf_import_row_batch_receipt(
    p_organization_id,
    p_request_id
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_commit_import_row_batch_unserialized(
  uuid, uuid, uuid, uuid[]
) IS
  'Commits one bounded row batch, records only closed deterministic refusals, and re-raises retryable or unknown database failures.';

REVOKE ALL ON FUNCTION plugin_data.csf_commit_import_row_batch_unserialized(
  uuid, uuid, uuid, uuid[]
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_commit_import_row_batch_unserialized(
  uuid, uuid, uuid, uuid[]
) TO postgres;

CREATE FUNCTION plugin_data.csf_lock_import_approval_batches_for_queue(
  p_organization_id uuid,
  p_queue_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM batch.id
  FROM plugin_data.csf_import_approval_batches AS batch
  WHERE batch.organization_id = p_organization_id
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_import_approval_batch_items AS item
      WHERE item.organization_id = p_organization_id
        AND item.batch_id = batch.id
        AND item.queue_id = p_queue_id
        AND item.state = 'queued'
    )
  ORDER BY batch.id
  FOR UPDATE;
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_lock_import_approval_batches_for_queue(
  uuid, uuid
) IS
  'Owner-internal canonical lock for approval batches whose current queued item belongs to this import queue.';

REVOKE ALL ON FUNCTION plugin_data.csf_lock_import_approval_batches_for_queue(
  uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_lock_import_approval_batches_for_queue(
  uuid, uuid
) TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_block_import_commit_queue(
  p_queue_id uuid,
  p_error_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_organization_id uuid;
  v_batch_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT queue.organization_id
  INTO v_organization_id
  FROM plugin_data.csf_import_commit_queue AS queue
  WHERE queue.id = p_queue_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The import queue item is no longer available.'
      USING ERRCODE = '23503';
  END IF;

  PERFORM plugin_data.csf_lock_import_approval_batches_for_queue(
    v_organization_id,
    p_queue_id
  );
  SELECT coalesce(
    pg_catalog.array_agg(DISTINCT item.batch_id ORDER BY item.batch_id),
    ARRAY[]::uuid[]
  )
  INTO v_batch_ids
  FROM plugin_data.csf_import_approval_batch_items AS item
  WHERE item.organization_id = v_organization_id
    AND item.queue_id = p_queue_id
    AND item.state = 'queued';

  UPDATE plugin_data.csf_import_commit_queue
  SET status = 'blocked',
      error_code = left(coalesce(p_error_code, 'import_claim_refused'), 100),
      lease_token = NULL,
      lease_expires_at = NULL,
      finished_at = now(),
      updated_at = now()
  WHERE id = p_queue_id
    AND organization_id = v_organization_id;

  UPDATE plugin_data.csf_import_approval_batch_items
  SET state = 'blocked',
      reason_code = left(coalesce(p_error_code, 'import_claim_refused'), 100)
  WHERE organization_id = v_organization_id
    AND queue_id = p_queue_id
    AND state = 'queued';

  UPDATE plugin_data.csf_import_approval_batches AS batch
  SET completed_count = counts.completed_count,
      blocked_count = counts.blocked_count,
      stale_count = counts.stale_count,
      status = CASE
        WHEN counts.open_count > 0 THEN 'running'
        WHEN counts.blocked_count > 0 OR counts.stale_count > 0
          THEN 'partially_completed'
        ELSE 'completed'
      END,
      updated_at = now()
  FROM (
    SELECT
      item.batch_id,
      count(*) FILTER (WHERE item.state = 'completed')::integer
        AS completed_count,
      count(*) FILTER (WHERE item.state = 'queued')::integer AS open_count,
      count(*) FILTER (WHERE item.state = 'blocked')::integer AS blocked_count,
      count(*) FILTER (WHERE item.state = 'stale')::integer AS stale_count
    FROM plugin_data.csf_import_approval_batch_items AS item
    WHERE item.organization_id = v_organization_id
      AND item.batch_id = ANY (v_batch_ids)
    GROUP BY item.batch_id
  ) AS counts
  WHERE batch.id = counts.batch_id
    AND batch.organization_id = v_organization_id;
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_block_import_commit_queue(uuid, text) IS
  'Blocks one refused import queue item after locking and settling only its current queued approval item. Historical receipts remain immutable.';

REVOKE ALL ON FUNCTION plugin_data.csf_block_import_commit_queue(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_block_import_commit_queue(uuid, text)
  TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_finish_import_commit_queue(
  p_queue_id uuid,
  p_lease_token uuid,
  p_status text,
  p_result_counts jsonb,
  p_error_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item plugin_data.csf_import_commit_queue%ROWTYPE;
  v_batch_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_status NOT IN ('completed', 'blocked', 'failed') THEN
    RAISE EXCEPTION 'Choose a supported import queue result.';
  END IF;
  IF jsonb_typeof(p_result_counts) <> 'object' THEN
    RAISE EXCEPTION 'Import result counts must be an object.';
  END IF;

  SELECT * INTO v_item
  FROM plugin_data.csf_import_commit_queue AS queue
  WHERE queue.id = p_queue_id
  FOR UPDATE;
  IF p_lease_token IS NULL
    OR NOT FOUND
    OR v_item.status <> 'running'
    OR v_item.lease_token IS NULL
    OR v_item.lease_token IS DISTINCT FROM p_lease_token
    OR v_item.lease_expires_at IS NULL
    OR v_item.lease_expires_at <= now()
  THEN
    RAISE EXCEPTION 'The import worker lease is no longer active.';
  END IF;

  PERFORM plugin_data.csf_lock_import_approval_batches_for_queue(
    v_item.organization_id,
    p_queue_id
  );
  SELECT coalesce(
    pg_catalog.array_agg(DISTINCT item.batch_id ORDER BY item.batch_id),
    ARRAY[]::uuid[]
  )
  INTO v_batch_ids
  FROM plugin_data.csf_import_approval_batch_items AS item
  WHERE item.organization_id = v_item.organization_id
    AND item.queue_id = p_queue_id
    AND item.state = 'queued';

  UPDATE plugin_data.csf_import_commit_queue
  SET status = p_status,
      result_counts = p_result_counts,
      error_code = left(p_error_code, 100),
      lease_token = NULL,
      lease_expires_at = NULL,
      finished_at = now(),
      updated_at = now()
  WHERE id = p_queue_id
    AND organization_id = v_item.organization_id;

  UPDATE plugin_data.csf_import_approval_batch_items
  SET state = CASE p_status WHEN 'completed' THEN 'completed' ELSE 'blocked' END,
      reason_code = CASE
        WHEN p_status = 'completed' THEN NULL
        ELSE left(p_error_code, 100)
      END
  WHERE organization_id = v_item.organization_id
    AND queue_id = p_queue_id
    AND state = 'queued';

  UPDATE plugin_data.csf_import_approval_batches AS batch
  SET completed_count = counts.completed_count,
      blocked_count = counts.blocked_count,
      stale_count = counts.stale_count,
      status = CASE
        WHEN counts.open_count > 0 THEN 'running'
        WHEN counts.blocked_count > 0 OR counts.stale_count > 0
          THEN 'partially_completed'
        ELSE 'completed'
      END,
      updated_at = now()
  FROM (
    SELECT
      item.batch_id,
      count(*) FILTER (WHERE item.state = 'completed')::integer
        AS completed_count,
      count(*) FILTER (WHERE item.state = 'queued')::integer AS open_count,
      count(*) FILTER (WHERE item.state = 'blocked')::integer AS blocked_count,
      count(*) FILTER (WHERE item.state = 'stale')::integer AS stale_count
    FROM plugin_data.csf_import_approval_batch_items AS item
    WHERE item.organization_id = v_item.organization_id
      AND item.batch_id = ANY (v_batch_ids)
    GROUP BY item.batch_id
  ) AS counts
  WHERE batch.id = counts.batch_id
    AND batch.organization_id = v_item.organization_id;

  RETURN jsonb_build_object('finished', true, 'status', p_status);
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_finish_import_commit_queue(
  uuid, uuid, text, jsonb, text
) IS
  'Settles one leased import queue item after locking and settling only its current queued approval item. Historical receipts remain immutable.';

REVOKE ALL ON FUNCTION plugin_data.csf_finish_import_commit_queue(
  uuid, uuid, text, jsonb, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finish_import_commit_queue(
  uuid, uuid, text, jsonb, text
) TO service_role;

COMMIT;
