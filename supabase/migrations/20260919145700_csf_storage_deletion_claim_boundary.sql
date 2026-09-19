BEGIN;

-- Storage deletion is an external side effect. A queue row must therefore be
-- fenced by a durable token before a worker removes the object, and only that
-- token may settle the row afterwards.
ALTER TABLE plugin_data.csf_storage_deletion_queue
  ADD COLUMN claim_token uuid,
  ADD COLUMN claimed_at timestamptz,
  ADD CONSTRAINT csf_storage_deletion_queue_claim_state_check CHECK (
    (claim_token IS NULL AND claimed_at IS NULL)
    OR (claim_token IS NOT NULL AND claimed_at IS NOT NULL)
  );

ALTER TABLE plugin_data.csf_announcement_attachments
  ADD COLUMN restore_request_id uuid;
ALTER TABLE plugin_data.csf_announcement_attachments
  DROP CONSTRAINT csf_announcement_attachments_object_path_scope_check,
  ADD CONSTRAINT csf_announcement_attachments_object_path_scope_check CHECK (
    object_path = organization_id::text || '/dvhs-csf/post-images/'
      || announcement_id::text || '/' || checksum_sha256
      || CASE mime_type
        WHEN 'image/jpeg' THEN '.jpg'
        WHEN 'image/png' THEN '.png'
        WHEN 'image/webp' THEN '.webp'
      END
  );

CREATE INDEX csf_storage_deletion_queue_unclaimed_idx
  ON plugin_data.csf_storage_deletion_queue (enqueued_at, id)
  WHERE claim_token IS NULL;

CREATE TABLE plugin_data.csf_storage_deletion_receipts (
  queue_id uuid NOT NULL,
  claim_token uuid NOT NULL,
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  bucket text NOT NULL,
  object_path text NOT NULL,
  succeeded boolean NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('deleted', 'retry_queued')),
  attempt_count_after integer NOT NULL CHECK (attempt_count_after >= 0),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (queue_id, claim_token),
  CONSTRAINT csf_storage_deletion_receipts_state_check CHECK (
    (succeeded AND outcome = 'deleted')
    OR (NOT succeeded AND outcome = 'retry_queued')
  )
);

CREATE INDEX csf_storage_deletion_receipts_path_idx
  ON plugin_data.csf_storage_deletion_receipts (bucket, object_path)
  WHERE succeeded;
CREATE INDEX csf_storage_deletion_receipts_organization_idx
  ON plugin_data.csf_storage_deletion_receipts (organization_id);

CREATE TABLE plugin_data.csf_attachment_restore_preparations (
  organization_id uuid NOT NULL,
  request_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  announcement_id uuid NOT NULL,
  bucket text NOT NULL,
  object_path text NOT NULL,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  PRIMARY KEY (organization_id, request_id, bucket, object_path),
  CONSTRAINT csf_attachment_restore_preparations_path_key
    UNIQUE (bucket, object_path),
  CONSTRAINT csf_attachment_restore_preparations_request_fkey
    FOREIGN KEY (organization_id, request_id)
    REFERENCES plugin_data.csf_post_publication_requests(
      organization_id, request_id
    ) ON DELETE CASCADE,
  CONSTRAINT csf_attachment_restore_preparations_post_fkey
    FOREIGN KEY (organization_id, announcement_id)
    REFERENCES plugin_data.csf_announcements(organization_id, id)
    ON DELETE CASCADE
);

ALTER TABLE plugin_data.csf_storage_deletion_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_attachment_restore_preparations ENABLE ROW LEVEL SECURITY;

-- Queue mutation is RPC-only. The private worker no longer receives a browser-
-- style table surface that could bypass the claim token.
REVOKE ALL ON TABLE plugin_data.csf_storage_deletion_queue
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE plugin_data.csf_storage_deletion_queue TO postgres;
REVOKE ALL ON TABLE plugin_data.csf_storage_deletion_receipts
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE plugin_data.csf_storage_deletion_receipts TO postgres;
REVOKE ALL ON TABLE plugin_data.csf_attachment_restore_preparations
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE plugin_data.csf_attachment_restore_preparations TO postgres;
REVOKE INSERT, UPDATE, DELETE
  ON TABLE plugin_data.csf_announcement_attachments FROM service_role;
GRANT SELECT ON TABLE plugin_data.csf_announcement_attachments TO service_role;

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
  v_limit integer;
  v_queue plugin_data.csf_storage_deletion_queue%ROWTYPE;
  v_claim_token uuid;
  v_claimed_at timestamptz;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'The storage deletion claim limit must be between 1 and 500.'
      USING ERRCODE = '22023';
  END IF;
  v_limit := p_limit;

  FOR v_queue IN
    SELECT queue.*
    FROM plugin_data.csf_storage_deletion_queue AS queue
    WHERE queue.claim_token IS NULL
    ORDER BY queue.enqueued_at, queue.id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    -- A restored post attachment owns the deterministic path again. Cancel the
    -- stale cleanup while the queue row is locked, before issuing a claim.
    IF EXISTS (
      SELECT 1
      FROM plugin_data.csf_announcement_attachments AS attachment
      WHERE attachment.bucket = v_queue.bucket
        AND attachment.object_path = v_queue.object_path
    ) THEN
      DELETE FROM plugin_data.csf_storage_deletion_queue AS queue
      WHERE queue.id = v_queue.id
        AND queue.claim_token IS NULL;
      CONTINUE;
    END IF;

    v_claim_token := gen_random_uuid();
    v_claimed_at := now();
    UPDATE plugin_data.csf_storage_deletion_queue AS queue
    SET claim_token = v_claim_token,
        claimed_at = v_claimed_at
    WHERE queue.id = v_queue.id
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

CREATE OR REPLACE FUNCTION plugin_data.csf_ack_storage_deletion_claim(
  p_queue_id uuid,
  p_claim_token uuid,
  p_succeeded boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_queue plugin_data.csf_storage_deletion_queue%ROWTYPE;
  v_receipt plugin_data.csf_storage_deletion_receipts%ROWTYPE;
  v_attempt_count integer;
  v_outcome text;
BEGIN
  IF p_queue_id IS NULL OR p_claim_token IS NULL OR p_succeeded IS NULL THEN
    RAISE EXCEPTION 'The storage deletion acknowledgement is invalid.'
      USING ERRCODE = '22023';
  END IF;

  SELECT receipt.* INTO v_receipt
  FROM plugin_data.csf_storage_deletion_receipts AS receipt
  WHERE receipt.queue_id = p_queue_id
    AND receipt.claim_token = p_claim_token;
  IF FOUND THEN
    IF v_receipt.succeeded IS DISTINCT FROM p_succeeded THEN
      RAISE EXCEPTION 'That storage deletion claim was acknowledged with a different outcome.'
        USING ERRCODE = '55000';
    END IF;
    RETURN jsonb_build_object(
      'status', v_receipt.outcome,
      'attemptCount', v_receipt.attempt_count_after
    );
  END IF;

  SELECT queue.* INTO v_queue
  FROM plugin_data.csf_storage_deletion_queue AS queue
  WHERE queue.id = p_queue_id
  FOR UPDATE;
  IF NOT FOUND OR v_queue.claim_token IS DISTINCT FROM p_claim_token THEN
    -- A concurrent acknowledgement can create its receipt while this call
    -- waits for the queue-row lock. Recheck the durable receipt before
    -- classifying the token as stale.
    SELECT receipt.* INTO v_receipt
    FROM plugin_data.csf_storage_deletion_receipts AS receipt
    WHERE receipt.queue_id = p_queue_id
      AND receipt.claim_token = p_claim_token;
    IF FOUND THEN
      IF v_receipt.succeeded IS DISTINCT FROM p_succeeded THEN
        RAISE EXCEPTION 'That storage deletion claim was acknowledged with a different outcome.'
          USING ERRCODE = '55000';
      END IF;
      RETURN jsonb_build_object(
        'status', v_receipt.outcome,
        'attemptCount', v_receipt.attempt_count_after
      );
    END IF;
    RAISE EXCEPTION 'The storage deletion claim is no longer current.'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_announcement_attachments AS attachment
    WHERE attachment.bucket = v_queue.bucket
      AND attachment.object_path = v_queue.object_path
  ) THEN
    RAISE EXCEPTION 'A live post attachment conflicts with the storage deletion claim.'
      USING ERRCODE = '55000';
  END IF;

  IF p_succeeded THEN
    v_attempt_count := v_queue.attempt_count;
    v_outcome := 'deleted';
    INSERT INTO plugin_data.csf_storage_deletion_receipts (
      queue_id, claim_token, organization_id, bucket, object_path,
      succeeded, outcome, attempt_count_after
    ) VALUES (
      p_queue_id, p_claim_token, v_queue.organization_id, v_queue.bucket,
      v_queue.object_path, true, v_outcome, v_attempt_count
    );
    DELETE FROM plugin_data.csf_storage_deletion_queue AS queue
    WHERE queue.id = p_queue_id
      AND queue.claim_token = p_claim_token;
  ELSE
    v_attempt_count := v_queue.attempt_count + 1;
    v_outcome := 'retry_queued';
    INSERT INTO plugin_data.csf_storage_deletion_receipts (
      queue_id, claim_token, organization_id, bucket, object_path,
      succeeded, outcome, attempt_count_after
    ) VALUES (
      p_queue_id, p_claim_token, v_queue.organization_id, v_queue.bucket,
      v_queue.object_path, false, v_outcome, v_attempt_count
    );
    UPDATE plugin_data.csf_storage_deletion_queue AS queue
    SET claim_token = NULL,
        claimed_at = NULL,
        last_attempt_at = now(),
        attempt_count = v_attempt_count,
        last_error = 'Storage removal failed.'
    WHERE queue.id = p_queue_id
      AND queue.claim_token = p_claim_token;
  END IF;

  RETURN jsonb_build_object(
    'status', v_outcome,
    'attemptCount', v_attempt_count
  );
END;
$$;

-- Prepare a deterministic post-image path before Storage upload. Holding the
-- queue row lock here orders preparation before any claim and leaves a one-use
-- database receipt that the later attachment insert must consume.
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

  SELECT queue.* INTO v_queue
  FROM plugin_data.csf_storage_deletion_queue AS queue
  WHERE queue.bucket = p_bucket
    AND queue.object_path = p_object_path
  FOR UPDATE;
  IF FOUND AND v_queue.claim_token IS NOT NULL THEN
    RAISE EXCEPTION 'Post attachment restoration must retry after storage cleanup reconciliation.'
      USING ERRCODE = '40001';
  END IF;
  IF FOUND THEN
    DELETE FROM plugin_data.csf_storage_deletion_queue AS queue
    WHERE queue.id = v_queue.id
      AND queue.claim_token IS NULL;
  END IF;

  INSERT INTO plugin_data.csf_attachment_restore_preparations (
    organization_id, request_id, actor_user_id, announcement_id,
    bucket, object_path, prepared_at, consumed_at
  ) VALUES (
    p_organization_id, p_request_id, p_actor_user_id, p_announcement_id,
    p_bucket, p_object_path, now(), NULL
  )
  ON CONFLICT ON CONSTRAINT csf_attachment_restore_preparations_path_key
  DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    request_id = EXCLUDED.request_id,
    actor_user_id = EXCLUDED.actor_user_id,
    announcement_id = EXCLUDED.announcement_id,
    prepared_at = now(),
    consumed_at = NULL;

  RETURN jsonb_build_object('status', 'prepared');
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
  IF FOUND AND v_queue.claim_token IS NOT NULL THEN
    RAISE EXCEPTION 'Post attachment restoration must retry after storage cleanup reconciliation.'
      USING ERRCODE = '40001';
  END IF;
  IF FOUND THEN
    RAISE EXCEPTION 'Post attachment storage must be prepared before restoration.'
      USING ERRCODE = '55000';
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
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post attachment storage must be prepared before restoration.'
      USING ERRCODE = '55000';
  END IF;
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
  v_receipts integer;
  v_preparations integer;
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
  DELETE FROM plugin_data.csf_attachment_restore_preparations
  WHERE organization_id = p_organization_id;
  GET DIAGNOSTICS v_preparations = ROW_COUNT;
  DELETE FROM plugin_data.csf_storage_deletion_receipts
  WHERE organization_id = p_organization_id;
  GET DIAGNOSTICS v_receipts = ROW_COUNT;
  DELETE FROM plugin_data.csf_storage_deletion_queue
  WHERE organization_id = p_organization_id;
  GET DIAGNOSTICS v_queue_rows = ROW_COUNT;
  RETURN jsonb_build_object(
    'attachments', v_attachments,
    'queueRows', v_queue_rows,
    'receipts', v_receipts,
    'preparations', v_preparations
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_replace_post_attachments(
  p_organization_id uuid,
  p_announcement_id uuid,
  p_actor_user_id uuid,
  p_attachments jsonb,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_post plugin_data.csf_announcements%ROWTYPE;
  v_item jsonb;
  v_index integer := 0;
  v_attachment_id uuid;
  v_existing plugin_data.csf_announcement_attachments%ROWTYPE;
  v_desired_ids uuid[] := ARRAY[]::uuid[];
  v_before jsonb;
  v_after jsonb;
  v_mime_type text;
  v_checksum text;
  v_object_path text;
  v_file_name text;
  v_alt_text text;
  v_size_bytes bigint;
  v_total_size_bytes bigint := 0;
  v_request_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_mutation_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_request plugin_data.csf_post_publication_requests%ROWTYPE;
  v_preflight_ids uuid[] := ARRAY[]::uuid[];
  v_preflight_checksums text[] := ARRAY[]::text[];
BEGIN
  IF p_organization_id IS NULL OR p_announcement_id IS NULL
    OR p_actor_user_id IS NULL OR p_request_id IS NULL
    OR p_attachments IS NULL
    OR pg_catalog.jsonb_typeof(p_attachments) <> 'array'
    OR pg_catalog.jsonb_array_length(p_attachments) > 4 THEN
    RAISE EXCEPTION 'Choose up to four valid post images.' USING ERRCODE = '22023';
  END IF;
  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_attachments::text, 'UTF8'), 'sha256'),
    'hex'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );
  IF plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'manage_posts'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF posts.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_request
  FROM plugin_data.csf_post_publication_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.request_id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That post image request was not prepared.' USING ERRCODE = '55000';
  END IF;
  IF v_request.actor_user_id IS DISTINCT FROM p_actor_user_id
    OR (v_request.announcement_id IS NOT NULL
      AND v_request.announcement_id IS DISTINCT FROM p_announcement_id)
    OR v_request.attachment_count IS DISTINCT FROM
      pg_catalog.jsonb_array_length(p_attachments) THEN
    RAISE EXCEPTION 'That post image request is already bound to another change.'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_mutation_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'post_mutation_request'
    AND audit.action IN ('post_created', 'post_updated')
  LIMIT 1;
  IF FOUND AND (
    v_mutation_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
    OR v_mutation_receipt.target_id IS DISTINCT FROM p_announcement_id
  ) THEN
    RAISE EXCEPTION 'That post image request is not bound to this post mutation.'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_post
  FROM plugin_data.csf_announcements AS announcement
  WHERE announcement.organization_id = p_organization_id
    AND announcement.id = p_announcement_id
  FOR UPDATE;
  IF NOT FOUND OR v_post.status = 'archived' THEN
    RAISE EXCEPTION 'That post is not available for attachment changes.' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'post_attachment_request'
    AND audit.action = 'post_attachments_replaced';
  IF FOUND THEN
    IF v_receipt.target_id IS DISTINCT FROM p_announcement_id
      OR v_receipt.after_data->>'requestFingerprint' IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'That post image request is already bound to another change.'
        USING ERRCODE = '55000';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'attachments', coalesce(v_receipt.after_data->'attachments', '[]'::jsonb),
      'idempotent', true
    );
  END IF;

  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_attachments)
  LOOP
    IF pg_catalog.jsonb_typeof(v_item) <> 'object'
      OR (v_item - ARRAY[
        'attachmentId', 'objectPath', 'fileName', 'mimeType', 'sizeBytes',
        'checksumSha256', 'altText'
      ]::text[]) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'A post image entry is invalid.' USING ERRCODE = '22023';
    END IF;
    v_alt_text := pg_catalog.btrim(v_item->>'altText');
    IF v_alt_text IS NULL OR length(v_alt_text) NOT BETWEEN 1 AND 300 THEN
      RAISE EXCEPTION 'Describe every post image in 1 to 300 characters.' USING ERRCODE = '22023';
    END IF;

    IF nullif(v_item->>'attachmentId', '') IS NOT NULL THEN
      IF (v_item - ARRAY['attachmentId', 'altText']::text[]) <> '{}'::jsonb THEN
        RAISE EXCEPTION 'A retained post image is invalid.' USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_attachment_id := (v_item->>'attachmentId')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'A retained post image is invalid.' USING ERRCODE = '22023';
      END;
      SELECT * INTO v_existing
      FROM plugin_data.csf_announcement_attachments AS attachment
      WHERE attachment.organization_id = p_organization_id
        AND attachment.announcement_id = p_announcement_id
        AND attachment.id = v_attachment_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'A retained post image no longer exists.' USING ERRCODE = '55000';
      END IF;
      IF v_attachment_id = ANY(v_preflight_ids) THEN
        RAISE EXCEPTION 'The same post image cannot be attached twice.' USING ERRCODE = '22023';
      END IF;
      v_total_size_bytes := v_total_size_bytes + v_existing.size_bytes;
      v_preflight_ids := pg_catalog.array_append(v_preflight_ids, v_attachment_id);
    ELSE
      IF v_item ? 'attachmentId' OR NOT (v_item ?& ARRAY[
        'objectPath', 'fileName', 'mimeType', 'sizeBytes',
        'checksumSha256', 'altText'
      ]::text[]) THEN
        RAISE EXCEPTION 'A post image entry is incomplete.' USING ERRCODE = '22023';
      END IF;
      v_mime_type := v_item->>'mimeType';
      v_checksum := pg_catalog.lower(v_item->>'checksumSha256');
      v_object_path := v_item->>'objectPath';
      v_file_name := pg_catalog.btrim(v_item->>'fileName');
      BEGIN
        v_size_bytes := (v_item->>'sizeBytes')::bigint;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'A post image size is invalid.' USING ERRCODE = '22023';
      END;
      IF v_mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp')
        OR v_checksum IS NULL OR v_checksum !~ '^[0-9a-f]{64}$'
        OR v_file_name IS NULL OR length(v_file_name) NOT BETWEEN 1 AND 255
        OR v_size_bytes NOT BETWEEN 1 AND 4194304
        OR v_object_path IS DISTINCT FROM (p_organization_id::text
          || '/dvhs-csf/post-images/' || p_announcement_id::text || '/'
          || v_checksum || CASE v_mime_type
            WHEN 'image/jpeg' THEN '.jpg'
            WHEN 'image/png' THEN '.png'
            WHEN 'image/webp' THEN '.webp'
          END) THEN
        RAISE EXCEPTION 'A post image does not match its stored evidence.' USING ERRCODE = '22023';
      END IF;
      IF v_checksum = ANY(v_preflight_checksums) THEN
        RAISE EXCEPTION 'The same post image cannot be attached twice.' USING ERRCODE = '22023';
      END IF;
      v_preflight_checksums := pg_catalog.array_append(v_preflight_checksums, v_checksum);
      v_total_size_bytes := v_total_size_bytes + v_size_bytes;
    END IF;
    IF v_total_size_bytes > 12582912 THEN
      RAISE EXCEPTION 'Post images must total 12 MB or less.' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF v_request.attachment_total_bytes IS DISTINCT FROM v_total_size_bytes THEN
    RAISE EXCEPTION 'That post image request does not match the prepared byte total.'
      USING ERRCODE = '55000';
  END IF;

  v_total_size_bytes := 0;
  v_attachment_id := NULL;
  v_existing := NULL;

  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', attachment.id,
    'position', attachment.position,
    'checksumSha256', attachment.checksum_sha256,
    'altText', attachment.alt_text
  ) ORDER BY attachment.position), '[]'::jsonb)
  INTO v_before
  FROM plugin_data.csf_announcement_attachments AS attachment
  WHERE attachment.organization_id = p_organization_id
    AND attachment.announcement_id = p_announcement_id;

  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_attachments)
  LOOP
    IF pg_catalog.jsonb_typeof(v_item) <> 'object'
      OR (v_item - ARRAY[
        'attachmentId', 'objectPath', 'fileName', 'mimeType', 'sizeBytes',
        'checksumSha256', 'altText'
      ]::text[]) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'A post image entry is invalid.' USING ERRCODE = '22023';
    END IF;
    v_alt_text := pg_catalog.btrim(v_item->>'altText');
    IF v_alt_text IS NULL OR length(v_alt_text) NOT BETWEEN 1 AND 300 THEN
      RAISE EXCEPTION 'Describe every post image in 1 to 300 characters.' USING ERRCODE = '22023';
    END IF;

    IF nullif(v_item->>'attachmentId', '') IS NOT NULL THEN
      IF (v_item - ARRAY['attachmentId', 'altText']::text[]) <> '{}'::jsonb THEN
        RAISE EXCEPTION 'A retained post image is invalid.' USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_attachment_id := (v_item->>'attachmentId')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'A retained post image is invalid.' USING ERRCODE = '22023';
      END;
      SELECT * INTO v_existing
      FROM plugin_data.csf_announcement_attachments AS attachment
      WHERE attachment.organization_id = p_organization_id
        AND attachment.announcement_id = p_announcement_id
        AND attachment.id = v_attachment_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'A retained post image no longer exists.' USING ERRCODE = '55000';
      END IF;
      IF v_attachment_id = ANY(v_desired_ids) THEN
        RAISE EXCEPTION 'The same post image cannot be attached twice.' USING ERRCODE = '22023';
      END IF;
      v_total_size_bytes := v_total_size_bytes + v_existing.size_bytes;
      UPDATE plugin_data.csf_announcement_attachments
      SET position = v_index, alt_text = v_alt_text, updated_at = now()
      WHERE id = v_attachment_id;
      v_desired_ids := pg_catalog.array_append(v_desired_ids, v_attachment_id);
    ELSE
      IF v_item ? 'attachmentId' OR NOT (v_item ?& ARRAY[
        'objectPath', 'fileName', 'mimeType', 'sizeBytes',
        'checksumSha256', 'altText'
      ]::text[]) THEN
        RAISE EXCEPTION 'A post image entry is incomplete.' USING ERRCODE = '22023';
      END IF;
      v_mime_type := v_item->>'mimeType';
      v_checksum := pg_catalog.lower(v_item->>'checksumSha256');
      v_object_path := v_item->>'objectPath';
      v_file_name := pg_catalog.btrim(v_item->>'fileName');
      BEGIN
        v_size_bytes := (v_item->>'sizeBytes')::bigint;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'A post image size is invalid.' USING ERRCODE = '22023';
      END;
      IF v_mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp')
        OR v_checksum IS NULL OR v_checksum !~ '^[0-9a-f]{64}$'
        OR v_file_name IS NULL OR length(v_file_name) NOT BETWEEN 1 AND 255
        OR v_size_bytes NOT BETWEEN 1 AND 4194304
        OR v_object_path IS DISTINCT FROM (p_organization_id::text
          || '/dvhs-csf/post-images/' || p_announcement_id::text || '/'
          || v_checksum || CASE v_mime_type
            WHEN 'image/jpeg' THEN '.jpg'
            WHEN 'image/png' THEN '.png'
            WHEN 'image/webp' THEN '.webp'
          END) THEN
        RAISE EXCEPTION 'A post image does not match its stored evidence.' USING ERRCODE = '22023';
      END IF;
      PERFORM plugin_data.csf_validate_attachment_restore_preparation(
        p_organization_id, p_actor_user_id, p_request_id, p_announcement_id,
        'plugins', v_object_path
      );
      INSERT INTO plugin_data.csf_announcement_attachments (
        organization_id, announcement_id, position, bucket, object_path,
        file_name, mime_type, size_bytes, checksum_sha256, alt_text, created_by,
        restore_request_id
      ) VALUES (
        p_organization_id, p_announcement_id, v_index, 'plugins', v_object_path,
        v_file_name, v_mime_type, v_size_bytes, v_checksum, v_alt_text,
        p_actor_user_id, p_request_id
      )
      ON CONFLICT (organization_id, announcement_id, checksum_sha256)
      DO UPDATE SET
        position = EXCLUDED.position,
        alt_text = EXCLUDED.alt_text,
        updated_at = now()
      RETURNING id INTO v_attachment_id;
      IF v_attachment_id = ANY(v_desired_ids) THEN
        RAISE EXCEPTION 'The same post image cannot be attached twice.' USING ERRCODE = '22023';
      END IF;
      v_total_size_bytes := v_total_size_bytes + v_size_bytes;
      v_desired_ids := pg_catalog.array_append(v_desired_ids, v_attachment_id);
    END IF;
    IF v_total_size_bytes > 12582912 THEN
      RAISE EXCEPTION 'Post images must total 12 MB or less.' USING ERRCODE = '22023';
    END IF;
    v_index := v_index + 1;
  END LOOP;

  DELETE FROM plugin_data.csf_announcement_attachments AS attachment
  WHERE attachment.organization_id = p_organization_id
    AND attachment.announcement_id = p_announcement_id
    AND NOT (attachment.id = ANY(v_desired_ids));

  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', attachment.id,
    'position', attachment.position,
    'checksumSha256', attachment.checksum_sha256,
    'altText', attachment.alt_text
  ) ORDER BY attachment.position), '[]'::jsonb)
  INTO v_after
  FROM plugin_data.csf_announcement_attachments AS attachment
  WHERE attachment.organization_id = p_organization_id
    AND attachment.announcement_id = p_announcement_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'post_attachments_replaced',
    'csf_announcement', p_announcement_id, v_before,
    pg_catalog.jsonb_build_object(
      'attachments', v_after,
      'requestFingerprint', v_request_fingerprint
    ),
    p_request_id, 'post_attachment_request', p_announcement_id::text,
    'officer_post_attachment_change'
  );

  UPDATE plugin_data.csf_post_publication_requests AS request
  SET announcement_id = p_announcement_id,
      attachment_status = 'saved',
      updated_at = now()
  WHERE request.organization_id = p_organization_id
    AND request.request_id = p_request_id
    AND request.actor_user_id = p_actor_user_id
    AND request.attachment_count = pg_catalog.jsonb_array_length(p_attachments)
    AND request.attachment_total_bytes = v_total_size_bytes
    AND (request.announcement_id IS NULL
      OR request.announcement_id = p_announcement_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That post image request changed before it could be saved.'
      USING ERRCODE = '40001';
  END IF;

  RETURN pg_catalog.jsonb_build_object('attachments', v_after);
END;
$$;

ALTER FUNCTION plugin_data.csf_replace_post_attachments(
  uuid, uuid, uuid, jsonb, uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_replace_post_attachments(
  uuid, uuid, uuid, jsonb, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_replace_post_attachments(
  uuid, uuid, uuid, jsonb, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_replace_post_attachments(
  uuid, uuid, uuid, jsonb, uuid
) IS
  'Service-only, permission-revalidated replacement of a post image set. Locks and validates the prepared publication request, matching post mutation receipt, attachment count, byte total, and saved payload fingerprint before marking it complete.';



-- A deterministic post-image path may be restored after a failed mutation.
-- Take the queue row lock before publishing that reference. An unclaimed stale
-- cleanup is cancelled; a worker claim is a serialization conflict and the
-- caller must retry after the external outcome is reconciled.
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
  -- Leave malformed paths to the table CHECK so this trigger does not replace
  -- the stable integrity error with a preparation error.
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
  IF FOUND THEN
    RAISE EXCEPTION 'Post attachment storage must be prepared before restoration.'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.restore_request_id IS NULL THEN
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
    AND preparation.consumed_at IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS csf_reconcile_attachment_restore_cleanup
  ON plugin_data.csf_announcement_attachments;
CREATE TRIGGER csf_reconcile_attachment_restore_cleanup
  BEFORE INSERT OR UPDATE OF bucket, object_path, restore_request_id
  ON plugin_data.csf_announcement_attachments
  FOR EACH ROW
  EXECUTE FUNCTION plugin_data.csf_reconcile_attachment_restore_cleanup();

ALTER FUNCTION plugin_data.csf_claim_storage_deletion_queue(integer)
  OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_ack_storage_deletion_claim(uuid, uuid, boolean)
  OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_prepare_announcement_attachment_restore(
  uuid, uuid, uuid, uuid, text, text
) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_validate_attachment_restore_preparation(
  uuid, uuid, uuid, uuid, text, text
) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_purge_storage_deletion_queue(uuid)
  OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_reconcile_attachment_restore_cleanup()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_claim_storage_deletion_queue(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_ack_storage_deletion_claim(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_prepare_announcement_attachment_restore(
  uuid, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_validate_attachment_restore_preparation(
  uuid, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_purge_storage_deletion_queue(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_reconcile_attachment_restore_cleanup()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_storage_deletion_queue(integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_ack_storage_deletion_claim(uuid, uuid, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_prepare_announcement_attachment_restore(
  uuid, uuid, uuid, uuid, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_purge_storage_deletion_queue(uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_claim_storage_deletion_queue(integer) IS
  'Claims unreferenced CSF Storage deletions with persistent tokens and cancels stale cleanup for live post attachments.';
COMMENT ON FUNCTION plugin_data.csf_ack_storage_deletion_claim(uuid, uuid, boolean) IS
  'Idempotently settles a CSF Storage deletion only for its current claim token; confirmed failure releases the row for retry.';
COMMENT ON FUNCTION plugin_data.csf_prepare_announcement_attachment_restore(
  uuid, uuid, uuid, uuid, text, text
) IS
  'Permission- and request-bound pre-upload fence for deterministic CSF post-image restoration paths.';
COMMENT ON FUNCTION plugin_data.csf_purge_storage_deletion_queue(uuid) IS
  'Service-only organization-scoped teardown of attachment metadata, queue rows, claim receipts, and restoration preparations.';
COMMENT ON FUNCTION plugin_data.csf_reconcile_attachment_restore_cleanup() IS
  'Serializes post attachment restoration with cleanup claims, cancelling only an unclaimed stale queue row.';

NOTIFY pgrst, 'reload schema';

COMMIT;
