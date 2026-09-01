-- Allow import commit leases to cover the worker route's full execution budget.

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

REVOKE ALL ON FUNCTION plugin_data.csf_claim_import_commit_queue(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_import_commit_queue(integer)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_claim_import_commit_queue(integer) IS
  'Claims one CSF import commit with a 30 to 1200 second fenced worker lease.';
