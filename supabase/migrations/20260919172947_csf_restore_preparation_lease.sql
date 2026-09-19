BEGIN;

-- Keep a durable cleanup row while a deterministic post image is being
-- restored. The attachment insert consumes both the lease and cleanup row in
-- one transaction. If the upload flow stops early, the cleanup worker can take
-- the path after the lease expires.
ALTER TABLE plugin_data.csf_attachment_restore_preparations
  ADD COLUMN lease_expires_at timestamptz NOT NULL
    DEFAULT (now() + interval '15 minutes');

CREATE INDEX csf_attachment_restore_preparations_active_lease_idx
  ON plugin_data.csf_attachment_restore_preparations (
    bucket, object_path, lease_expires_at
  )
  WHERE consumed_at IS NULL;

-- Existing unconsumed preparations were created by the old boundary after it
-- removed their only cleanup row. Recreate that durable cleanup evidence.
INSERT INTO plugin_data.csf_storage_deletion_queue (
  organization_id, bucket, object_path
)
SELECT preparation.organization_id, preparation.bucket, preparation.object_path
FROM plugin_data.csf_attachment_restore_preparations AS preparation
WHERE preparation.consumed_at IS NULL
ON CONFLICT ON CONSTRAINT csf_storage_deletion_queue_bucket_path_key
DO NOTHING;

CREATE OR REPLACE FUNCTION plugin_data.csf_prepare_announcement_attachment_restore(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_announcement_id uuid,
  p_bucket text,
  p_object_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_queue plugin_data.csf_storage_deletion_queue%ROWTYPE;
  v_request plugin_data.csf_post_publication_requests%ROWTYPE;
  v_preparation plugin_data.csf_attachment_restore_preparations%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL OR p_actor_user_id IS NULL
    OR p_request_id IS NULL OR p_announcement_id IS NULL
    OR p_bucket IS DISTINCT FROM 'plugins'
    OR p_object_path IS NULL OR length(p_object_path) > 2000
    OR p_object_path NOT LIKE (
      p_organization_id::text || '/dvhs-csf/post-images/'
      || p_announcement_id::text || '/%'
    ) THEN
    RAISE EXCEPTION 'The post attachment restoration preparation is invalid.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );
  IF plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'manage_posts'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF posts.' USING ERRCODE = '42501';
  END IF;

  SELECT request.* INTO v_request
  FROM plugin_data.csf_post_publication_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.request_id = p_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.actor_user_id IS DISTINCT FROM p_actor_user_id
    OR (v_request.announcement_id IS NOT NULL
      AND v_request.announcement_id IS DISTINCT FROM p_announcement_id)
    OR v_request.attachment_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'The post attachment preparation request is not current.'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO plugin_data.csf_storage_deletion_queue (
    organization_id, bucket, object_path
  ) VALUES (
    p_organization_id, p_bucket, p_object_path
  )
  ON CONFLICT ON CONSTRAINT csf_storage_deletion_queue_bucket_path_key
  DO NOTHING;

  SELECT queue.* INTO v_queue
  FROM plugin_data.csf_storage_deletion_queue AS queue
  WHERE queue.bucket = p_bucket
    AND queue.object_path = p_object_path
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post attachment cleanup could not be reserved.'
      USING ERRCODE = '40001';
  END IF;
  IF v_queue.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'The post attachment cleanup belongs to another organization.'
      USING ERRCODE = '42501';
  END IF;
  IF v_queue.claim_token IS NOT NULL THEN
    RAISE EXCEPTION 'Post attachment restoration must retry after storage cleanup reconciliation.'
      USING ERRCODE = '40001';
  END IF;

  SELECT preparation.* INTO v_preparation
  FROM plugin_data.csf_attachment_restore_preparations AS preparation
  WHERE preparation.bucket = p_bucket
    AND preparation.object_path = p_object_path
  FOR UPDATE;
  IF FOUND
    AND v_preparation.consumed_at IS NULL
    AND v_preparation.lease_expires_at > now()
    AND (
      v_preparation.organization_id IS DISTINCT FROM p_organization_id
      OR v_preparation.request_id IS DISTINCT FROM p_request_id
      OR v_preparation.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_preparation.announcement_id IS DISTINCT FROM p_announcement_id
    ) THEN
    RAISE EXCEPTION 'Post attachment restoration is already being prepared.'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO plugin_data.csf_attachment_restore_preparations (
    organization_id, request_id, actor_user_id, announcement_id,
    bucket, object_path, prepared_at, lease_expires_at, consumed_at
  ) VALUES (
    p_organization_id, p_request_id, p_actor_user_id, p_announcement_id,
    p_bucket, p_object_path, now(), now() + interval '15 minutes', NULL
  )
  ON CONFLICT ON CONSTRAINT csf_attachment_restore_preparations_path_key
  DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    request_id = EXCLUDED.request_id,
    actor_user_id = EXCLUDED.actor_user_id,
    announcement_id = EXCLUDED.announcement_id,
    prepared_at = EXCLUDED.prepared_at,
    lease_expires_at = EXCLUDED.lease_expires_at,
    consumed_at = NULL;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'prepared',
    'leaseExpiresAt', now() + interval '15 minutes'
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_validate_attachment_restore_preparation(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_announcement_id uuid,
  p_bucket text,
  p_object_path text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_queue plugin_data.csf_storage_deletion_queue%ROWTYPE;
BEGIN
  SELECT queue.* INTO v_queue
  FROM plugin_data.csf_storage_deletion_queue AS queue
  WHERE queue.bucket = p_bucket
    AND queue.object_path = p_object_path
  FOR UPDATE;
  IF NOT FOUND OR v_queue.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'Post attachment storage must be prepared before restoration.'
      USING ERRCODE = '55000';
  END IF;
  IF v_queue.claim_token IS NOT NULL THEN
    RAISE EXCEPTION 'Post attachment restoration must retry after storage cleanup reconciliation.'
      USING ERRCODE = '40001';
  END IF;

  PERFORM 1
  FROM plugin_data.csf_attachment_restore_preparations AS preparation
  WHERE preparation.organization_id = p_organization_id
    AND preparation.request_id = p_request_id
    AND preparation.actor_user_id = p_actor_user_id
    AND preparation.announcement_id = p_announcement_id
    AND preparation.bucket = p_bucket
    AND preparation.object_path = p_object_path
    AND preparation.consumed_at IS NULL
    AND preparation.lease_expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post attachment storage must be prepared before restoration.'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_reconcile_attachment_restore_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_queue plugin_data.csf_storage_deletion_queue%ROWTYPE;
  v_preparation plugin_data.csf_attachment_restore_preparations%ROWTYPE;
BEGIN
  IF NEW.object_path IS DISTINCT FROM (
    NEW.organization_id::text || '/dvhs-csf/post-images/'
      || NEW.announcement_id::text || '/' || NEW.checksum_sha256
      || CASE NEW.mime_type
        WHEN 'image/jpeg' THEN '.jpg'
        WHEN 'image/png' THEN '.png'
        WHEN 'image/webp' THEN '.webp'
        ELSE ''
      END
  ) THEN
    RETURN NEW;
  END IF;

  SELECT queue.* INTO v_queue
  FROM plugin_data.csf_storage_deletion_queue AS queue
  WHERE queue.bucket = NEW.bucket
    AND queue.object_path = NEW.object_path
  FOR UPDATE;
  IF FOUND AND v_queue.claim_token IS NOT NULL THEN
    RAISE EXCEPTION 'Post attachment restoration must retry after storage cleanup reconciliation.'
      USING ERRCODE = '40001';
  END IF;
  IF NOT FOUND OR v_queue.organization_id IS DISTINCT FROM NEW.organization_id
    OR NEW.restore_request_id IS NULL THEN
    RAISE EXCEPTION 'Post attachment storage must be prepared before restoration.'
      USING ERRCODE = '55000';
  END IF;

  SELECT preparation.* INTO v_preparation
  FROM plugin_data.csf_attachment_restore_preparations AS preparation
  WHERE preparation.organization_id = NEW.organization_id
    AND preparation.request_id = NEW.restore_request_id
    AND preparation.actor_user_id = NEW.created_by
    AND preparation.announcement_id = NEW.announcement_id
    AND preparation.bucket = NEW.bucket
    AND preparation.object_path = NEW.object_path
    AND preparation.consumed_at IS NULL
    AND preparation.lease_expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post attachment storage must be prepared before restoration.'
      USING ERRCODE = '55000';
  END IF;

  UPDATE plugin_data.csf_attachment_restore_preparations AS preparation
  SET consumed_at = now()
  WHERE preparation.organization_id = v_preparation.organization_id
    AND preparation.request_id = v_preparation.request_id
    AND preparation.bucket = v_preparation.bucket
    AND preparation.object_path = v_preparation.object_path
    AND preparation.consumed_at IS NULL
    AND preparation.lease_expires_at > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post attachment storage must be prepared before restoration.'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM plugin_data.csf_storage_deletion_queue AS queue
  WHERE queue.id = v_queue.id
    AND queue.claim_token IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post attachment restoration must retry after storage cleanup reconciliation.'
      USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_claim_storage_deletion_queue(
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
  v_attempt_count integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'The storage deletion claim limit must be between 1 and 500.'
      USING ERRCODE = '22023';
  END IF;

  FOR v_queue IN
    SELECT queue.*
    FROM plugin_data.csf_storage_deletion_queue AS queue
    WHERE (queue.claim_token IS NULL
        OR queue.claimed_at <= now() - interval '15 minutes')
      AND NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_attachment_restore_preparations AS preparation
        WHERE preparation.bucket = queue.bucket
          AND preparation.object_path = queue.object_path
          AND preparation.consumed_at IS NULL
          AND preparation.lease_expires_at > now()
      )
    ORDER BY queue.enqueued_at, queue.id
    LIMIT p_limit
    FOR UPDATE OF queue SKIP LOCKED
  LOOP
    DELETE FROM plugin_data.csf_attachment_restore_preparations AS preparation
    WHERE preparation.bucket = v_queue.bucket
      AND preparation.object_path = v_queue.object_path
      AND preparation.consumed_at IS NULL
      AND preparation.lease_expires_at <= now();

    IF EXISTS (
      SELECT 1
      FROM plugin_data.csf_announcement_attachments AS attachment
      WHERE attachment.bucket = v_queue.bucket
        AND attachment.object_path = v_queue.object_path
    ) THEN
      DELETE FROM plugin_data.csf_storage_deletion_queue AS queue
      WHERE queue.id = v_queue.id
        AND (queue.claim_token IS NULL
          OR queue.claimed_at <= now() - interval '15 minutes');
      CONTINUE;
    END IF;

    v_claim_token := gen_random_uuid();
    v_claimed_at := now();
    v_attempt_count := v_queue.attempt_count;
    IF v_queue.claim_token IS NOT NULL THEN
      v_attempt_count := CASE
        WHEN v_attempt_count < 2147483647 THEN v_attempt_count + 1
        ELSE v_attempt_count
      END;
    END IF;

    UPDATE plugin_data.csf_storage_deletion_queue AS queue
    SET claim_token = v_claim_token,
        claimed_at = v_claimed_at,
        attempt_count = v_attempt_count,
        last_attempt_at = CASE
          WHEN v_queue.claim_token IS NOT NULL THEN v_claimed_at
          ELSE queue.last_attempt_at
        END,
        last_error = CASE
          WHEN v_queue.claim_token IS NOT NULL
            THEN 'Storage deletion claim lease expired.'
          ELSE queue.last_error
        END
    WHERE queue.id = v_queue.id
      AND (queue.claim_token IS NULL
        OR queue.claimed_at <= now() - interval '15 minutes');
    IF NOT FOUND THEN CONTINUE; END IF;

    id := v_queue.id;
    organization_id := v_queue.organization_id;
    bucket := v_queue.bucket;
    object_path := v_queue.object_path;
    attempt_count := v_attempt_count;
    claim_token := v_claim_token;
    claimed_at := v_claimed_at;
    RETURN NEXT;
  END LOOP;
END;
$$;

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
  v_attempt_count integer;
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
      AND (queue.claim_token IS NULL
        OR queue.claimed_at <= now() - interval '15 minutes')
      AND NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_attachment_restore_preparations AS preparation
        WHERE preparation.bucket = queue.bucket
          AND preparation.object_path = queue.object_path
          AND preparation.consumed_at IS NULL
          AND preparation.lease_expires_at > now()
      )
    ORDER BY queue.enqueued_at, queue.id
    LIMIT p_limit
    FOR UPDATE OF queue SKIP LOCKED
  LOOP
    DELETE FROM plugin_data.csf_attachment_restore_preparations AS preparation
    WHERE preparation.bucket = v_queue.bucket
      AND preparation.object_path = v_queue.object_path
      AND preparation.consumed_at IS NULL
      AND preparation.lease_expires_at <= now();

    IF EXISTS (
      SELECT 1
      FROM plugin_data.csf_announcement_attachments AS attachment
      WHERE attachment.bucket = v_queue.bucket
        AND attachment.object_path = v_queue.object_path
    ) THEN
      DELETE FROM plugin_data.csf_storage_deletion_queue AS queue
      WHERE queue.id = v_queue.id
        AND queue.organization_id = p_organization_id
        AND (queue.claim_token IS NULL
          OR queue.claimed_at <= now() - interval '15 minutes');
      CONTINUE;
    END IF;

    v_claim_token := gen_random_uuid();
    v_claimed_at := now();
    v_attempt_count := v_queue.attempt_count;
    IF v_queue.claim_token IS NOT NULL THEN
      v_attempt_count := CASE
        WHEN v_attempt_count < 2147483647 THEN v_attempt_count + 1
        ELSE v_attempt_count
      END;
    END IF;

    UPDATE plugin_data.csf_storage_deletion_queue AS queue
    SET claim_token = v_claim_token,
        claimed_at = v_claimed_at,
        attempt_count = v_attempt_count,
        last_attempt_at = CASE
          WHEN v_queue.claim_token IS NOT NULL THEN v_claimed_at
          ELSE queue.last_attempt_at
        END,
        last_error = CASE
          WHEN v_queue.claim_token IS NOT NULL
            THEN 'Storage deletion claim lease expired.'
          ELSE queue.last_error
        END
    WHERE queue.id = v_queue.id
      AND queue.organization_id = p_organization_id
      AND (queue.claim_token IS NULL
        OR queue.claimed_at <= now() - interval '15 minutes');
    IF NOT FOUND THEN CONTINUE; END IF;

    id := v_queue.id;
    organization_id := v_queue.organization_id;
    bucket := v_queue.bucket;
    object_path := v_queue.object_path;
    attempt_count := v_attempt_count;
    claim_token := v_claim_token;
    claimed_at := v_claimed_at;
    RETURN NEXT;
  END LOOP;
END;
$$;

ALTER FUNCTION plugin_data.csf_prepare_announcement_attachment_restore(
  uuid, uuid, uuid, uuid, text, text
) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_validate_attachment_restore_preparation(
  uuid, uuid, uuid, uuid, text, text
) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_reconcile_attachment_restore_cleanup()
  OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_claim_storage_deletion_queue(integer)
  OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_claim_organization_storage_deletion_queue(
  uuid, integer
) OWNER TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_prepare_announcement_attachment_restore(
  uuid, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_prepare_announcement_attachment_restore(
  uuid, uuid, uuid, uuid, text, text
) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_validate_attachment_restore_preparation(
  uuid, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_reconcile_attachment_restore_cleanup()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_claim_storage_deletion_queue(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_storage_deletion_queue(integer)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_claim_organization_storage_deletion_queue(
  uuid, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_organization_storage_deletion_queue(
  uuid, integer
) TO service_role;

COMMENT ON COLUMN plugin_data.csf_attachment_restore_preparations.lease_expires_at
  IS 'Deadline after which an unconsumed upload preparation becomes cleanup work again.';
COMMENT ON FUNCTION plugin_data.csf_prepare_announcement_attachment_restore(
  uuid, uuid, uuid, uuid, text, text
) IS
  'Creates a 15-minute restore lease while retaining a durable cleanup row until attachment metadata commits.';
COMMENT ON FUNCTION plugin_data.csf_validate_attachment_restore_preparation(
  uuid, uuid, uuid, uuid, text, text
) IS
  'Locks and validates the active restore lease and its unclaimed durable cleanup row.';
COMMENT ON FUNCTION plugin_data.csf_reconcile_attachment_restore_cleanup() IS
  'Consumes the active restore lease and cancels its cleanup row atomically with attachment metadata insertion.';
COMMENT ON FUNCTION plugin_data.csf_claim_storage_deletion_queue(integer) IS
  'Claims cleanup outside active restore leases and requeues abandoned preparations after their 15-minute lease.';
COMMENT ON FUNCTION plugin_data.csf_claim_organization_storage_deletion_queue(
  uuid, integer
) IS
  'Claims one organization cleanup batch outside active restore leases and requeues abandoned preparations after their 15-minute lease.';

NOTIFY pgrst, 'reload schema';

COMMIT;
