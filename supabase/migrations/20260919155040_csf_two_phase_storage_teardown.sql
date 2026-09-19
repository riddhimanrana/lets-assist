BEGIN;

-- Preserve every Storage deletion queue row during organization teardown. The
-- caller must drain token-bound claims before durable cleanup evidence can go.
CREATE INDEX csf_storage_deletion_queue_org_unclaimed_idx
  ON plugin_data.csf_storage_deletion_queue (
    organization_id, enqueued_at, id
  )
  WHERE claim_token IS NULL;

CREATE OR REPLACE FUNCTION plugin_data.csf_claim_organization_storage_deletion_queue(
  p_organization_id uuid,
  p_limit integer
)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  bucket text,
  object_path text,
  attempt_count integer,
  claim_token uuid,
  claimed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_queue plugin_data.csf_storage_deletion_queue%ROWTYPE;
  v_claim_token uuid;
  v_claimed_at timestamptz;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'The storage deletion claim organization is required.'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'The storage deletion claim limit must be between 1 and 500.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  FOR v_queue IN
    SELECT queue.*
    FROM plugin_data.csf_storage_deletion_queue AS queue
    WHERE queue.organization_id = p_organization_id
      AND queue.claim_token IS NULL
    ORDER BY queue.enqueued_at, queue.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    IF EXISTS (
      SELECT 1
      FROM plugin_data.csf_announcement_attachments AS attachment
      WHERE attachment.bucket = v_queue.bucket
        AND attachment.object_path = v_queue.object_path
    ) THEN
      DELETE FROM plugin_data.csf_storage_deletion_queue AS queue
      WHERE queue.id = v_queue.id
        AND queue.organization_id = p_organization_id
        AND queue.claim_token IS NULL;
      CONTINUE;
    END IF;

    v_claim_token := gen_random_uuid();
    v_claimed_at := now();
    UPDATE plugin_data.csf_storage_deletion_queue AS queue
    SET claim_token = v_claim_token,
        claimed_at = v_claimed_at
    WHERE queue.id = v_queue.id
      AND queue.organization_id = p_organization_id
      AND queue.claim_token IS NULL;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    id := v_queue.id;
    organization_id := v_queue.organization_id;
    bucket := v_queue.bucket;
    object_path := v_queue.object_path;
    attempt_count := v_queue.attempt_count;
    claim_token := v_claim_token;
    claimed_at := v_claimed_at;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_purge_storage_deletion_queue(
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_queue_rows integer;
  v_claimed_queue_rows integer;
  v_receipts integer := 0;
  v_preparations integer := 0;
  v_attachments integer;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'The storage deletion purge organization is required.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  DELETE FROM plugin_data.csf_announcement_attachments
  WHERE organization_id = p_organization_id;
  GET DIAGNOSTICS v_attachments = ROW_COUNT;

  -- Lock every remaining queue row before deciding whether teardown may
  -- discard durable receipts. Claimed and retryable work must survive.
  PERFORM 1
  FROM plugin_data.csf_storage_deletion_queue AS queue
  WHERE queue.organization_id = p_organization_id
  ORDER BY queue.id
  FOR UPDATE;

  SELECT count(*)::integer,
         count(*) FILTER (WHERE queue.claim_token IS NOT NULL)::integer
  INTO v_queue_rows, v_claimed_queue_rows
  FROM plugin_data.csf_storage_deletion_queue AS queue
  WHERE queue.organization_id = p_organization_id;

  IF v_queue_rows > 0 THEN
    RETURN jsonb_build_object(
      'status', 'cleanup_required',
      'attachments', v_attachments,
      'queueRows', v_queue_rows,
      'claimedQueueRows', v_claimed_queue_rows,
      'receipts', 0,
      'preparations', 0
    );
  END IF;

  DELETE FROM plugin_data.csf_attachment_restore_preparations
  WHERE organization_id = p_organization_id;
  GET DIAGNOSTICS v_preparations = ROW_COUNT;
  DELETE FROM plugin_data.csf_storage_deletion_receipts
  WHERE organization_id = p_organization_id;
  GET DIAGNOSTICS v_receipts = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', 'purged',
    'attachments', v_attachments,
    'queueRows', 0,
    'claimedQueueRows', 0,
    'receipts', v_receipts,
    'preparations', v_preparations
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_claim_organization_storage_deletion_queue(
  uuid, integer
) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_purge_storage_deletion_queue(uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_claim_organization_storage_deletion_queue(
  uuid, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_organization_storage_deletion_queue(
  uuid, integer
) TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_purge_storage_deletion_queue(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_purge_storage_deletion_queue(uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_claim_organization_storage_deletion_queue(
  uuid, integer
) IS
  'Claims one organization cleanup batch while cancelling paths restored by live attachments.';
COMMENT ON FUNCTION plugin_data.csf_purge_storage_deletion_queue(uuid) IS
  'Runs two-phase organization Storage teardown without erasing unresolved cleanup work.';

COMMIT;
