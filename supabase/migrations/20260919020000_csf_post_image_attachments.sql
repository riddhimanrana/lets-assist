-- Add private, organization-scoped image attachments to CSF posts.
BEGIN;

CREATE TABLE plugin_data.csf_announcement_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  announcement_id uuid NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 3),
  bucket text NOT NULL DEFAULT 'plugins' CHECK (bucket = 'plugins'),
  object_path text NOT NULL,
  file_name text NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 255),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 4194304),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  alt_text text NOT NULL CHECK (length(btrim(alt_text)) BETWEEN 1 AND 300),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_announcement_attachments_announcement_fkey
    FOREIGN KEY (organization_id, announcement_id)
    REFERENCES plugin_data.csf_announcements(organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT csf_announcement_attachments_post_position_key
    UNIQUE (organization_id, announcement_id, position)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT csf_announcement_attachments_post_checksum_key
    UNIQUE (organization_id, announcement_id, checksum_sha256),
  CONSTRAINT csf_announcement_attachments_bucket_path_key
    UNIQUE (bucket, object_path),
  CONSTRAINT csf_announcement_attachments_object_path_scope_check CHECK (
    object_path = organization_id::text || '/dvhs-csf/post-images/'
      || announcement_id::text || '/' || checksum_sha256
      || CASE mime_type
        WHEN 'image/jpeg' THEN '.jpg'
        WHEN 'image/png' THEN '.png'
        WHEN 'image/webp' THEN '.webp'
      END
  )
);

CREATE INDEX csf_announcement_attachments_post_idx
  ON plugin_data.csf_announcement_attachments (
    organization_id, announcement_id, position
  );

ALTER TABLE plugin_data.csf_announcement_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_announcement_attachments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE plugin_data.csf_announcement_attachments TO service_role;

CREATE TABLE plugin_data.csf_post_publication_requests (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  announcement_id uuid,
  attachment_count smallint NOT NULL CHECK (attachment_count BETWEEN 0 AND 4),
  attachment_total_bytes bigint NOT NULL CHECK (attachment_total_bytes BETWEEN 0 AND 12582912),
  attachment_status text NOT NULL DEFAULT 'pending'
    CHECK (attachment_status IN ('pending', 'saved')),
  email_requested boolean NOT NULL,
  email_status text NOT NULL
    CHECK (email_status IN ('not_requested', 'pending', 'queued', 'not_queued', 'unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, request_id),
  CONSTRAINT csf_post_publication_requests_post_fkey
    FOREIGN KEY (organization_id, announcement_id)
    REFERENCES plugin_data.csf_announcements(organization_id, id)
    ON DELETE CASCADE
);

ALTER TABLE plugin_data.csf_post_publication_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_post_publication_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE plugin_data.csf_post_publication_requests TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_begin_post_publication_request(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_attachment_count integer,
  p_attachment_total_bytes bigint,
  p_email_requested boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing plugin_data.csf_post_publication_requests%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
    OR p_attachment_count NOT BETWEEN 0 AND 4
    OR p_attachment_total_bytes NOT BETWEEN 0 AND 12582912
    OR p_email_requested IS NULL THEN
    RAISE EXCEPTION 'The post publication request is invalid.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );
  IF plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'manage_posts'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF posts.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
  FROM plugin_data.csf_post_publication_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.request_id = p_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_existing.attachment_count IS DISTINCT FROM p_attachment_count
      OR v_existing.attachment_total_bytes IS DISTINCT FROM p_attachment_total_bytes
      OR v_existing.email_requested IS DISTINCT FROM p_email_requested THEN
      RAISE EXCEPTION 'That post request identifier is already bound to a different publication.'
        USING ERRCODE = '55000';
    END IF;
    RETURN;
  END IF;

  INSERT INTO plugin_data.csf_post_publication_requests (
    organization_id, request_id, actor_user_id, attachment_count,
    attachment_total_bytes, email_requested, email_status
  ) VALUES (
    p_organization_id, p_request_id, p_actor_user_id, p_attachment_count,
    p_attachment_total_bytes, p_email_requested,
    CASE WHEN p_email_requested THEN 'pending' ELSE 'not_requested' END
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_begin_post_publication_request(
  uuid, uuid, uuid, integer, bigint, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_begin_post_publication_request(
  uuid, uuid, uuid, integer, bigint, boolean
) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_record_post_email_preparation(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_announcement_id uuid,
  p_outcome text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_outcome NOT IN ('queued', 'not_queued', 'unknown') THEN
    RAISE EXCEPTION 'The post email preparation outcome is invalid.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );
  IF plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'manage_posts'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF posts.' USING ERRCODE = '42501';
  END IF;
  UPDATE plugin_data.csf_post_publication_requests AS request
  SET announcement_id = p_announcement_id,
      email_status = p_outcome,
      updated_at = now()
  WHERE request.organization_id = p_organization_id
    AND request.request_id = p_request_id
    AND request.actor_user_id = p_actor_user_id
    AND request.email_requested
    AND request.attachment_status = 'saved'
    AND (request.announcement_id IS NULL OR request.announcement_id = p_announcement_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The post images must be saved before email preparation is recorded.'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_record_post_email_preparation(
  uuid, uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_post_email_preparation(
  uuid, uuid, uuid, uuid, text
) TO service_role;

CREATE UNIQUE INDEX csf_admin_audit_events_post_attachment_request_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id)
  WHERE correlation_id IS NOT NULL
    AND source_type = 'post_attachment_request'
    AND action = 'post_attachments_replaced';

CREATE OR REPLACE FUNCTION plugin_data.csf_enqueue_announcement_attachment_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO plugin_data.csf_storage_deletion_queue (
    organization_id, bucket, object_path
  ) VALUES (
    OLD.organization_id, OLD.bucket, OLD.object_path
  ) ON CONFLICT (bucket, object_path) DO NOTHING;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_enqueue_announcement_attachment_cleanup()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER csf_announcement_attachment_cleanup
AFTER DELETE ON plugin_data.csf_announcement_attachments
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_enqueue_announcement_attachment_cleanup();

CREATE OR REPLACE FUNCTION plugin_data.csf_resolve_post_publication_completion(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_announcement_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request plugin_data.csf_post_publication_requests%ROWTYPE;
BEGIN
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
    RETURN pg_catalog.jsonb_build_object('status', 'complete');
  END IF;
  IF v_request.announcement_id IS NOT NULL
    AND v_request.announcement_id IS DISTINCT FROM p_announcement_id THEN
    RAISE EXCEPTION 'That post request is bound to another post.' USING ERRCODE = '55000';
  END IF;
  UPDATE plugin_data.csf_post_publication_requests
  SET announcement_id = p_announcement_id, updated_at = now()
  WHERE organization_id = p_organization_id AND request_id = p_request_id;
  IF v_request.attachment_status <> 'saved' THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'incomplete', 'reason', 'attachments_not_saved'
    );
  END IF;
  IF v_request.email_status = 'pending' THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'incomplete', 'reason', 'email_preparation_unresolved'
    );
  END IF;
  RETURN pg_catalog.jsonb_build_object('status', 'complete');
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_resolve_post_publication_completion(
  uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_resolve_post_publication_completion(
  uuid, uuid, uuid, uuid
) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_post_attachments_ready_for_email(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_announcement_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  IF plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'manage_posts'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF posts.' USING ERRCODE = '42501';
  END IF;
  SELECT request.attachment_status INTO v_status
  FROM plugin_data.csf_post_publication_requests AS request
  LEFT JOIN plugin_data.csf_admin_audit_events AS mutation
    ON mutation.organization_id = request.organization_id
   AND mutation.correlation_id = request.request_id
   AND mutation.source_type = 'post_mutation_request'
  WHERE request.organization_id = p_organization_id
    AND coalesce(request.announcement_id, mutation.target_id) = p_announcement_id
  ORDER BY request.created_at DESC
  LIMIT 1;
  RETURN v_status IS NULL OR v_status = 'saved';
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_post_attachments_ready_for_email(
  uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_post_attachments_ready_for_email(
  uuid, uuid, uuid
) TO service_role;

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
        OR v_object_path IS DISTINCT FROM p_organization_id::text
          || '/dvhs-csf/post-images/' || p_announcement_id::text || '/'
          || v_checksum || CASE v_mime_type
            WHEN 'image/jpeg' THEN '.jpg'
            WHEN 'image/png' THEN '.png'
            WHEN 'image/webp' THEN '.webp'
          END THEN
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

  UPDATE plugin_data.csf_post_publication_requests
  SET announcement_id = p_announcement_id,
      attachment_status = 'saved',
      updated_at = now()
  WHERE organization_id = p_organization_id AND request_id = p_request_id;

  RETURN pg_catalog.jsonb_build_object('attachments', v_after);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_replace_post_attachments(
  uuid, uuid, uuid, jsonb, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_replace_post_attachments(
  uuid, uuid, uuid, jsonb, uuid
) TO service_role;

COMMENT ON TABLE plugin_data.csf_announcement_attachments IS
  'Private organization-scoped image evidence attached to one CSF announcement. Server loaders issue short-lived URLs only after audience authorization.';
COMMENT ON FUNCTION plugin_data.csf_replace_post_attachments(uuid, uuid, uuid, jsonb, uuid) IS
  'Service-only, permission-revalidated replacement of a post image set. Removed objects enter the durable storage deletion queue.';

COMMIT;
