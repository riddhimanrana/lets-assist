-- Settle refused queue work and serialize row-batch request receipts.

BEGIN;

CREATE FUNCTION plugin_data.csf_block_import_commit_queue(
  p_queue_id uuid,
  p_error_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE plugin_data.csf_import_commit_queue
  SET status = 'blocked',
      error_code = left(coalesce(p_error_code, 'import_claim_refused'), 100),
      lease_token = NULL,
      lease_expires_at = NULL,
      finished_at = now(),
      updated_at = now()
  WHERE id = p_queue_id;

  UPDATE plugin_data.csf_import_approval_batch_items
  SET state = 'blocked',
      reason_code = left(coalesce(p_error_code, 'import_claim_refused'), 100)
  WHERE queue_id = p_queue_id;

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
    WHERE item.batch_id IN (
      SELECT batch_item.batch_id
      FROM plugin_data.csf_import_approval_batch_items AS batch_item
      WHERE batch_item.queue_id = p_queue_id
    )
    GROUP BY item.batch_id
  ) AS counts
  WHERE batch.id = counts.batch_id;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_block_import_commit_queue(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

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
  v_token uuid := gen_random_uuid();
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 1200 THEN
    RAISE EXCEPTION 'Import worker lease must be between 30 and 1200 seconds.';
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
    PERFORM plugin_data.csf_block_import_commit_queue(
      v_item.id,
      'preview_or_actor_missing'
    );
    RETURN jsonb_build_object('claimed', false);
  END IF;

  BEGIN
    PERFORM plugin_data.csf_assert_import_actor(
      v_item.organization_id,
      v_item.actor_user_id,
      v_preview.source_type
    );
  EXCEPTION WHEN OTHERS THEN
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

REVOKE ALL ON FUNCTION plugin_data.csf_claim_import_commit_queue(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_import_commit_queue(integer)
  TO service_role;

ALTER FUNCTION plugin_data.csf_commit_import_row_batch(
  uuid, uuid, uuid, uuid[]
)
  RENAME TO csf_commit_import_row_batch_unserialized;

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
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A row batch request ID is required.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf_import_row_batch:'
        || p_organization_id::text
        || ':'
        || p_request_id::text,
      0
    )
  );

  RETURN plugin_data.csf_commit_import_row_batch_unserialized(
    p_organization_id,
    p_attempt_id,
    p_request_id,
    p_import_row_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_commit_import_row_batch_unserialized(
  uuid, uuid, uuid, uuid[]
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_commit_import_row_batch(
  uuid, uuid, uuid, uuid[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_commit_import_row_batch(
  uuid, uuid, uuid, uuid[]
) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_claim_class_workbook_refresh_job(
  p_lease_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job plugin_data.csf_class_workbook_refresh_jobs%ROWTYPE;
  v_workbook plugin_data.csf_class_workbooks%ROWTYPE;
  v_token uuid := gen_random_uuid();
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION 'Workbook worker lease must be between 30 and 300 seconds.';
  END IF;

  SELECT job.* INTO v_job
  FROM plugin_data.csf_class_workbook_refresh_jobs AS job
  WHERE job.status = 'queued'
     OR (job.status = 'running' AND job.lease_expires_at <= now())
  ORDER BY job.created_at, job.id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  SELECT * INTO v_workbook
  FROM plugin_data.csf_class_workbooks AS workbook
  WHERE workbook.id = v_job.workbook_id
  FOR UPDATE;
  IF NOT FOUND OR v_workbook.drive_owner_user_id IS NULL THEN
    UPDATE plugin_data.csf_class_workbook_refresh_jobs
    SET status = 'blocked',
        error_code = 'workbook_owner_missing',
        lease_token = NULL,
        lease_expires_at = NULL,
        finished_at = now(),
        updated_at = now()
    WHERE id = v_job.id;
    UPDATE plugin_data.csf_class_workbooks
    SET state = 'blocked',
        last_error_code = 'workbook_owner_missing',
        updated_at = now()
    WHERE id = v_job.workbook_id;
    RETURN jsonb_build_object('claimed', false);
  END IF;

  IF v_workbook.drive_file_id IS DISTINCT FROM v_job.drive_file_id THEN
    UPDATE plugin_data.csf_class_workbook_refresh_jobs
    SET status = 'blocked',
        error_code = 'stale_workbook_generation',
        lease_token = NULL,
        lease_expires_at = NULL,
        finished_at = now(),
        updated_at = now()
    WHERE id = v_job.id;
    RETURN jsonb_build_object('claimed', false);
  END IF;

  BEGIN
    PERFORM plugin_data.csf_assert_import_actor(
      v_workbook.organization_id,
      v_workbook.drive_owner_user_id,
      'class_history'
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE plugin_data.csf_class_workbook_refresh_jobs
    SET status = 'blocked',
        error_code = 'workbook_owner_not_authorized',
        lease_token = NULL,
        lease_expires_at = NULL,
        finished_at = now(),
        updated_at = now()
    WHERE id = v_job.id;
    UPDATE plugin_data.csf_class_workbooks
    SET state = 'blocked',
        last_error_code = 'workbook_owner_not_authorized',
        updated_at = now()
    WHERE id = v_workbook.id;
    RETURN jsonb_build_object('claimed', false);
  END;

  UPDATE plugin_data.csf_class_workbook_refresh_jobs
  SET status = 'running',
      lease_token = v_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempt_count = attempt_count + 1,
      started_at = coalesce(started_at, now()),
      finished_at = NULL,
      updated_at = now()
  WHERE id = v_job.id;

  RETURN jsonb_build_object(
    'claimed', true,
    'jobId', v_job.id,
    'leaseToken', v_token,
    'organizationId', v_workbook.organization_id,
    'cohortId', v_workbook.cohort_id,
    'workbookId', v_workbook.id,
    'driveFileId', v_job.drive_file_id,
    'ownerUserId', v_workbook.drive_owner_user_id,
    'providerVersion', v_job.provider_version
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_claim_class_workbook_refresh_job(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_class_workbook_refresh_job(integer)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_block_import_commit_queue(uuid, text) IS
  'Settles a refused CSF import queue item and its frozen approval batch.';
COMMENT ON FUNCTION plugin_data.csf_commit_import_row_batch(
  uuid, uuid, uuid, uuid[]
) IS
  'Serializes one organization-scoped row-batch receipt before committing rows.';

COMMIT;
