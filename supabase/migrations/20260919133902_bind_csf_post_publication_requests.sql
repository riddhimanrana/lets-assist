-- Bind every attachment replacement to the publication request prepared by
-- the server before any attachment metadata can change.
BEGIN;

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
      INSERT INTO plugin_data.csf_announcement_attachments (
        organization_id, announcement_id, position, bucket, object_path,
        file_name, mime_type, size_bytes, checksum_sha256, alt_text, created_by
      ) VALUES (
        p_organization_id, p_announcement_id, v_index, 'plugins', v_object_path,
        v_file_name, v_mime_type, v_size_bytes, v_checksum, v_alt_text,
        p_actor_user_id
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

COMMIT;
