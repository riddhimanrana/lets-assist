-- Freeze officer-approved previews and commit them outside the request.

CREATE TABLE plugin_data.csf_import_approval_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'partially_completed')),
  requested_count integer NOT NULL DEFAULT 0 CHECK (requested_count >= 0),
  queued_count integer NOT NULL DEFAULT 0 CHECK (queued_count >= 0),
  blocked_count integer NOT NULL DEFAULT 0 CHECK (blocked_count >= 0),
  stale_count integer NOT NULL DEFAULT 0 CHECK (stale_count >= 0),
  completed_count integer NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, request_id)
);

CREATE TABLE plugin_data.csf_import_commit_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  preview_job_id uuid NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'blocked', 'failed')),
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  result_counts jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(result_counts) = 'object'),
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, preview_job_id),
  FOREIGN KEY (preview_job_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_jobs (id, organization_id)
    ON DELETE CASCADE
);

CREATE TABLE plugin_data.csf_import_approval_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES plugin_data.csf_import_approval_batches(id) ON DELETE CASCADE,
  preview_job_id uuid NOT NULL,
  queue_id uuid REFERENCES plugin_data.csf_import_commit_queue(id) ON DELETE SET NULL,
  state text NOT NULL CHECK (state IN ('queued', 'blocked', 'stale', 'completed')),
  reason_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, preview_job_id),
  FOREIGN KEY (preview_job_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_jobs (id, organization_id)
    ON DELETE CASCADE
);

CREATE INDEX csf_import_commit_queue_claim_idx
  ON plugin_data.csf_import_commit_queue (created_at, id)
  WHERE status = 'queued';
CREATE INDEX csf_import_commit_queue_running_lease_idx
  ON plugin_data.csf_import_commit_queue (lease_expires_at)
  WHERE status = 'running';

ALTER TABLE plugin_data.csf_import_approval_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_import_commit_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_import_approval_batch_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_import_approval_batches
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE plugin_data.csf_import_commit_queue
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE plugin_data.csf_import_approval_batch_items
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE plugin_data.csf_import_approval_batches
  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE plugin_data.csf_import_commit_queue
  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE plugin_data.csf_import_approval_batch_items
  TO service_role;

CREATE FUNCTION plugin_data.csf_queue_import_preview_batch(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_preview_job_ids uuid[],
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch plugin_data.csf_import_approval_batches%ROWTYPE;
  v_preview_id uuid;
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_readiness jsonb;
  v_queue_id uuid;
  v_state text;
  v_reason text;
  v_queued integer := 0;
  v_blocked integer := 0;
  v_stale integer := 0;
  v_completed integer := 0;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A batch request ID is required.';
  END IF;
  IF coalesce(cardinality(p_preview_job_ids), 0) < 1
    OR cardinality(p_preview_job_ids) > 100
  THEN
    RAISE EXCEPTION 'Choose between one and 100 import previews.';
  END IF;
  IF cardinality(p_preview_job_ids) <> (
    SELECT count(DISTINCT preview_id)
    FROM unnest(p_preview_job_ids) AS preview_id
  ) THEN
    RAISE EXCEPTION 'Each import preview may appear only once.';
  END IF;

  SELECT * INTO v_batch
  FROM plugin_data.csf_import_approval_batches AS batch
  WHERE batch.organization_id = p_organization_id
    AND batch.request_id = p_request_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'batchId', v_batch.id,
      'requested', v_batch.requested_count,
      'queued', v_batch.queued_count,
      'blocked', v_batch.blocked_count,
      'stale', v_batch.stale_count,
      'completed', v_batch.completed_count,
      'replayed', true
    );
  END IF;

  INSERT INTO plugin_data.csf_import_approval_batches (
    organization_id, actor_user_id, request_id, requested_count
  ) VALUES (
    p_organization_id, p_actor_user_id, p_request_id,
    cardinality(p_preview_job_ids)
  )
  RETURNING * INTO v_batch;

  FOREACH v_preview_id IN ARRAY p_preview_job_ids LOOP
    v_state := 'stale';
    v_reason := 'preview_unavailable';
    v_queue_id := NULL;
    SELECT * INTO v_preview
    FROM plugin_data.csf_sheet_import_jobs AS preview
    WHERE preview.organization_id = p_organization_id
      AND preview.id = v_preview_id
      AND preview.mode = 'preview'
    FOR UPDATE;

    IF FOUND AND v_preview.status IN ('completed', 'needs_resolution') THEN
      BEGIN
        PERFORM plugin_data.csf_assert_import_actor(
          p_organization_id,
          p_actor_user_id,
          v_preview.source_type
        );
        v_readiness := plugin_data.csf_import_preview_readiness(
          p_organization_id,
          v_preview_id
        );
        IF v_readiness ->> 'commitState' = 'completed' THEN
          v_state := 'completed';
          v_reason := NULL;
          v_completed := v_completed + 1;
        ELSIF v_readiness ->> 'commitState' IN ('running', 'cancelled')
          OR coalesce((v_readiness ->> 'ambiguous')::integer, 0) > 0
          OR coalesce((v_readiness ->> 'conflict')::integer, 0) > 0
          OR coalesce((v_readiness ->> 'duplicate')::integer, 0) > 0
          OR coalesce((v_readiness ->> 'error')::integer, 0) > 0
          OR coalesce((v_readiness ->> 'pendingMissingCohort')::integer, 0) > 0
          OR coalesce((v_readiness ->> 'pendingMissingTerm')::integer, 0) > 0
          OR coalesce((v_readiness ->> 'pendingMissingMatch')::integer, 0) > 0
          OR coalesce((v_readiness ->> 'inFlight')::integer, 0) > 0
          OR coalesce((v_readiness ->> 'unknownOutcome')::integer, 0) > 0
          OR coalesce((v_readiness ->> 'historicalUnknown')::integer, 0) > 0
        THEN
          v_state := 'blocked';
          v_reason := 'preview_requires_review';
          v_blocked := v_blocked + 1;
        ELSE
          INSERT INTO plugin_data.csf_import_commit_queue (
            organization_id, preview_job_id, actor_user_id, status, updated_at
          ) VALUES (
            p_organization_id, v_preview_id, p_actor_user_id, 'queued', now()
          )
          ON CONFLICT (organization_id, preview_job_id) DO UPDATE
          SET actor_user_id = EXCLUDED.actor_user_id,
              status = CASE
                WHEN plugin_data.csf_import_commit_queue.status IN ('running', 'completed')
                  THEN plugin_data.csf_import_commit_queue.status
                ELSE 'queued'
              END,
              error_code = NULL,
              finished_at = NULL,
              updated_at = now()
          RETURNING id INTO v_queue_id;
          v_state := 'queued';
          v_reason := NULL;
          v_queued := v_queued + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_state := 'blocked';
        v_reason := 'actor_not_authorized';
        v_blocked := v_blocked + 1;
      END;
    ELSE
      v_stale := v_stale + 1;
    END IF;

    INSERT INTO plugin_data.csf_import_approval_batch_items (
      organization_id, batch_id, preview_job_id, queue_id, state, reason_code
    ) VALUES (
      p_organization_id, v_batch.id, v_preview_id, v_queue_id, v_state, v_reason
    );
  END LOOP;

  UPDATE plugin_data.csf_import_approval_batches
  SET queued_count = v_queued,
      blocked_count = v_blocked,
      stale_count = v_stale,
      completed_count = v_completed,
      status = CASE
        WHEN v_queued > 0 THEN 'queued'
        ELSE 'completed'
      END,
      updated_at = now()
  WHERE id = v_batch.id;

  RETURN jsonb_build_object(
    'batchId', v_batch.id,
    'requested', cardinality(p_preview_job_ids),
    'queued', v_queued,
    'blocked', v_blocked,
    'stale', v_stale,
    'completed', v_completed,
    'replayed', false
  );
END;
$$;

CREATE FUNCTION plugin_data.csf_claim_import_commit_queue(
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
  v_token uuid := gen_random_uuid();
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 600 THEN
    RAISE EXCEPTION 'Import worker lease must be between 30 and 600 seconds.';
  END IF;
  SELECT queue.* INTO v_item
  FROM plugin_data.csf_import_commit_queue AS queue
  WHERE queue.status = 'queued'
     OR (queue.status = 'running' AND queue.lease_expires_at <= now())
  ORDER BY queue.created_at, queue.id
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
    UPDATE plugin_data.csf_import_commit_queue
    SET status = 'blocked', error_code = 'preview_or_actor_missing',
        finished_at = now(), updated_at = now()
    WHERE id = v_item.id;
    RETURN jsonb_build_object('claimed', false);
  END IF;
  BEGIN
    PERFORM plugin_data.csf_assert_import_actor(
      v_item.organization_id,
      v_item.actor_user_id,
      v_preview.source_type
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE plugin_data.csf_import_commit_queue
    SET status = 'blocked', error_code = 'actor_not_authorized',
        finished_at = now(), updated_at = now()
    WHERE id = v_item.id;
    RETURN jsonb_build_object('claimed', false);
  END;
  UPDATE plugin_data.csf_import_commit_queue
  SET status = 'running', lease_token = v_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempt_count = attempt_count + 1,
      started_at = coalesce(started_at, now()),
      finished_at = NULL, updated_at = now()
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

CREATE FUNCTION plugin_data.csf_finish_import_commit_queue(
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
  IF NOT FOUND OR v_item.status <> 'running'
    OR v_item.lease_token IS DISTINCT FROM p_lease_token
    OR v_item.lease_expires_at <= now()
  THEN
    RAISE EXCEPTION 'The import worker lease is no longer active.';
  END IF;
  UPDATE plugin_data.csf_import_commit_queue
  SET status = p_status,
      result_counts = p_result_counts,
      error_code = left(p_error_code, 100),
      lease_token = NULL,
      lease_expires_at = NULL,
      finished_at = now(),
      updated_at = now()
  WHERE id = p_queue_id;
  UPDATE plugin_data.csf_import_approval_batch_items
  SET state = CASE p_status WHEN 'completed' THEN 'completed' ELSE 'blocked' END,
      reason_code = CASE p_status WHEN 'completed' THEN NULL ELSE left(p_error_code, 100) END
  WHERE queue_id = p_queue_id;
  UPDATE plugin_data.csf_import_approval_batches AS batch
  SET completed_count = counts.completed_count,
      status = CASE
        WHEN counts.open_count > 0 THEN 'running'
        WHEN counts.blocked_count > 0 THEN 'partially_completed'
        ELSE 'completed'
      END,
      updated_at = now()
  FROM (
    SELECT item.batch_id,
      count(*) FILTER (WHERE item.state = 'completed')::integer AS completed_count,
      count(*) FILTER (WHERE item.state = 'queued')::integer AS open_count,
      count(*) FILTER (WHERE item.state IN ('blocked', 'stale'))::integer AS blocked_count
    FROM plugin_data.csf_import_approval_batch_items AS item
    WHERE item.batch_id IN (
      SELECT batch_item.batch_id
      FROM plugin_data.csf_import_approval_batch_items AS batch_item
      WHERE batch_item.queue_id = p_queue_id
    )
    GROUP BY item.batch_id
  ) AS counts
  WHERE batch.id = counts.batch_id;
  RETURN jsonb_build_object('finished', true, 'status', p_status);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_queue_import_preview_batch(uuid, uuid, uuid[], uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_queue_import_preview_batch(uuid, uuid, uuid[], uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_claim_import_commit_queue(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_import_commit_queue(integer)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_finish_import_commit_queue(uuid, uuid, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finish_import_commit_queue(uuid, uuid, text, jsonb, text)
  TO service_role;

COMMENT ON TABLE plugin_data.csf_import_approval_batches IS
  'Count-only officer approval receipts that freeze exact CSF preview IDs.';
COMMENT ON TABLE plugin_data.csf_import_commit_queue IS
  'Leased background work for approved CSF preview commits.';

CREATE TABLE plugin_data.csf_import_row_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL,
  request_id uuid NOT NULL,
  row_ids uuid[] NOT NULL CHECK (cardinality(row_ids) BETWEEN 1 AND 50),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed')),
  succeeded_count integer NOT NULL DEFAULT 0 CHECK (succeeded_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, request_id),
  FOREIGN KEY (attempt_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_commit_attempts (id, organization_id)
    ON DELETE CASCADE
);

CREATE TABLE plugin_data.csf_import_row_batch_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES plugin_data.csf_import_row_batches(id) ON DELETE CASCADE,
  import_row_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('created', 'updated', 'recovered', 'failed')),
  reason_code text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, import_row_id),
  FOREIGN KEY (import_row_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_rows (id, organization_id)
    ON DELETE CASCADE
);

ALTER TABLE plugin_data.csf_import_row_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_import_row_batch_outcomes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_import_row_batches
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE plugin_data.csf_import_row_batch_outcomes
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE plugin_data.csf_import_row_batches
  TO service_role;
GRANT SELECT, INSERT ON TABLE plugin_data.csf_import_row_batch_outcomes
  TO service_role;

CREATE FUNCTION plugin_data.csf_import_row_batch_receipt(
  p_organization_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE WHEN batch.id IS NULL THEN NULL ELSE jsonb_build_object(
    'batchId', batch.id,
    'requestId', batch.request_id,
    'status', batch.status,
    'succeeded', batch.succeeded_count,
    'failed', batch.failed_count,
    'outcomes', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'rowId', outcome.import_row_id,
        'status', outcome.outcome,
        'reasonCode', outcome.reason_code,
        'result', outcome.result
      ) ORDER BY outcome.created_at, outcome.id)
      FROM plugin_data.csf_import_row_batch_outcomes AS outcome
      WHERE outcome.organization_id = batch.organization_id
        AND outcome.batch_id = batch.id
    ), '[]'::jsonb)
  ) END
  FROM plugin_data.csf_import_row_batches AS batch
  WHERE batch.organization_id = p_organization_id
    AND batch.request_id = p_request_id;
$$;

CREATE FUNCTION plugin_data.csf_commit_import_row_batch(
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
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO plugin_data.csf_import_row_batch_outcomes (
        organization_id, batch_id, import_row_id, outcome, reason_code
      ) VALUES (
        p_organization_id,
        v_batch.id,
        v_row_id,
        'failed',
        CASE SQLSTATE
          WHEN '42501' THEN 'permission_refused'
          WHEN '23505' THEN 'duplicate_refused'
          WHEN '23514' THEN 'constraint_refused'
          ELSE 'row_commit_refused'
        END
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

REVOKE ALL ON FUNCTION plugin_data.csf_import_row_batch_receipt(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_import_row_batch_receipt(uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_commit_import_row_batch(uuid, uuid, uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_commit_import_row_batch(uuid, uuid, uuid, uuid[])
  TO service_role;

COMMENT ON TABLE plugin_data.csf_import_row_batches IS
  'Idempotent receipts for at most 50 CSF import rows committed in one database call.';
