-- Bind CSF import queue children to their tenant and retire the unsafe workbook registration path.

BEGIN;

DROP FUNCTION IF EXISTS plugin_data.csf_register_class_workbook(
  uuid, uuid, text, uuid, text, text, jsonb
);

ALTER TABLE plugin_data.csf_sheet_sources
  ADD CONSTRAINT csf_sheet_sources_cohort_organization_fkey
  FOREIGN KEY (cohort_id, organization_id)
  REFERENCES plugin_data.csf_cohorts (id, organization_id)
  ON DELETE SET NULL (cohort_id)
  NOT VALID;

ALTER TABLE plugin_data.csf_sheet_sources
  VALIDATE CONSTRAINT csf_sheet_sources_cohort_organization_fkey;

ALTER TABLE plugin_data.csf_import_approval_batches
  ADD CONSTRAINT csf_import_approval_batches_id_organization_key
  UNIQUE (id, organization_id);

ALTER TABLE plugin_data.csf_import_commit_queue
  ADD CONSTRAINT csf_import_commit_queue_id_organization_key
  UNIQUE (id, organization_id);

ALTER TABLE plugin_data.csf_import_row_batches
  ADD CONSTRAINT csf_import_row_batches_id_organization_key
  UNIQUE (id, organization_id);

ALTER TABLE plugin_data.csf_import_approval_batch_items
  ADD CONSTRAINT csf_import_approval_items_batch_organization_fkey
  FOREIGN KEY (batch_id, organization_id)
  REFERENCES plugin_data.csf_import_approval_batches (id, organization_id)
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE plugin_data.csf_import_approval_batch_items
  VALIDATE CONSTRAINT csf_import_approval_items_batch_organization_fkey;

ALTER TABLE plugin_data.csf_import_approval_batch_items
  ADD CONSTRAINT csf_import_approval_items_queue_organization_fkey
  FOREIGN KEY (queue_id, organization_id)
  REFERENCES plugin_data.csf_import_commit_queue (id, organization_id)
  ON DELETE SET NULL (queue_id)
  NOT VALID;

ALTER TABLE plugin_data.csf_import_approval_batch_items
  VALIDATE CONSTRAINT csf_import_approval_items_queue_organization_fkey;

CREATE INDEX csf_import_approval_items_org_queue_idx
  ON plugin_data.csf_import_approval_batch_items (organization_id, queue_id)
  WHERE queue_id IS NOT NULL;

ALTER TABLE plugin_data.csf_import_row_batch_outcomes
  ADD CONSTRAINT csf_import_row_outcomes_batch_organization_fkey
  FOREIGN KEY (batch_id, organization_id)
  REFERENCES plugin_data.csf_import_row_batches (id, organization_id)
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE plugin_data.csf_import_row_batch_outcomes
  VALIDATE CONSTRAINT csf_import_row_outcomes_batch_organization_fkey;

CREATE OR REPLACE FUNCTION plugin_data.csf_queue_import_preview_batch(
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
  v_preview_source_type text;
  v_requested_preview_ids uuid[];
  v_existing_preview_ids uuid[];
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

  FOREACH v_preview_id IN ARRAY p_preview_job_ids LOOP
    SELECT preview.source_type
    INTO v_preview_source_type
    FROM plugin_data.csf_sheet_import_jobs AS preview
    WHERE preview.organization_id = p_organization_id
      AND preview.id = v_preview_id
      AND preview.mode = 'preview';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'An import preview is no longer available.'
        USING ERRCODE = '22023';
    END IF;
    PERFORM plugin_data.csf_assert_import_actor(
      p_organization_id,
      p_actor_user_id,
      v_preview_source_type
    );
  END LOOP;

  SELECT array_agg(preview_id ORDER BY preview_id)
  INTO v_requested_preview_ids
  FROM unnest(p_preview_job_ids) AS preview_id;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf_import_approval_batch:'
        || p_organization_id::text
        || ':'
        || p_request_id::text,
      0
    )
  );

  SELECT * INTO v_batch
  FROM plugin_data.csf_import_approval_batches AS batch
  WHERE batch.organization_id = p_organization_id
    AND batch.request_id = p_request_id
  FOR UPDATE;

  IF FOUND THEN
    SELECT array_agg(item.preview_job_id ORDER BY item.preview_job_id)
    INTO v_existing_preview_ids
    FROM plugin_data.csf_import_approval_batch_items AS item
    WHERE item.organization_id = p_organization_id
      AND item.batch_id = v_batch.id;

    IF v_batch.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_existing_preview_ids IS DISTINCT FROM v_requested_preview_ids
    THEN
      RAISE EXCEPTION 'This batch request ID belongs to a different approval request.'
        USING ERRCODE = '22023';
    END IF;

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

  RETURN plugin_data.csf_queue_import_preview_batch_unserialized(
    p_organization_id,
    p_actor_user_id,
    p_preview_job_ids,
    p_request_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_queue_import_preview_batch(
  uuid, uuid, uuid[], uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_queue_import_preview_batch(
  uuid, uuid, uuid[], uuid
) TO service_role;

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
  WHERE id = p_queue_id
    AND organization_id = v_item.organization_id;

  UPDATE plugin_data.csf_import_approval_batch_items
  SET state = CASE p_status WHEN 'completed' THEN 'completed' ELSE 'blocked' END,
      reason_code = CASE p_status WHEN 'completed' THEN NULL ELSE left(p_error_code, 100) END
  WHERE organization_id = v_item.organization_id
    AND queue_id = p_queue_id;

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
    SELECT item.batch_id,
      count(*) FILTER (WHERE item.state = 'completed')::integer AS completed_count,
      count(*) FILTER (WHERE item.state = 'queued')::integer AS open_count,
      count(*) FILTER (WHERE item.state = 'blocked')::integer AS blocked_count,
      count(*) FILTER (WHERE item.state = 'stale')::integer AS stale_count
    FROM plugin_data.csf_import_approval_batch_items AS item
    WHERE item.organization_id = v_item.organization_id
      AND item.batch_id IN (
        SELECT batch_item.batch_id
        FROM plugin_data.csf_import_approval_batch_items AS batch_item
        WHERE batch_item.organization_id = v_item.organization_id
          AND batch_item.queue_id = p_queue_id
      )
    GROUP BY item.batch_id
  ) AS counts
  WHERE batch.id = counts.batch_id
    AND batch.organization_id = v_item.organization_id;

  RETURN jsonb_build_object('finished', true, 'status', p_status);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_finish_import_commit_queue(
  uuid, uuid, text, jsonb, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finish_import_commit_queue(
  uuid, uuid, text, jsonb, text
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_queue_import_preview_batch(
  uuid, uuid, uuid[], uuid
) IS
  'Serializes one organization-scoped approval request and refuses request-ID replay with a different actor or preview set.';

COMMENT ON FUNCTION plugin_data.csf_finish_import_commit_queue(
  uuid, uuid, text, jsonb, text
) IS
  'Settles one leased import queue item and its tenant-bound approval receipt.';

COMMIT;
