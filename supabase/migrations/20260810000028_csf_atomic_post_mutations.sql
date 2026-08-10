-- Keep CSF post persistence and its canonical staff audit in one transaction.
-- Email campaign preparation remains a separate, independently retry-safe
-- outcome after the post is known to be saved.

BEGIN;

-- Historical post audits used a generated correlation and no source type.
-- Restrict request uniqueness to the new receipt namespace so old data cannot
-- make this forward migration fail while every new post mutation still gets
-- exactly one immutable request receipt.
CREATE UNIQUE INDEX csf_admin_audit_events_post_mutation_request_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id)
  WHERE correlation_id IS NOT NULL
    AND source_type = 'post_mutation_request'
    AND action IN (
      'post_created',
      'post_updated',
      'post_pinned',
      'post_unpinned',
      'post_archived'
    );

-- Canonical mutation-owned state deliberately excludes email_campaign_id.
-- Campaign creation and backlink repair happen after the post transaction and
-- must not make a valid post receipt look stale. email_requested is included:
-- it is durable post intent and is sticky across edits.
CREATE FUNCTION plugin_data.csf_post_mutation_state(
  p_post plugin_data.csf_announcements
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'postId', (p_post).id,
    'organizationId', (p_post).organization_id,
    'termId', (p_post).term_id,
    'title', (p_post).title,
    'body', (p_post).body,
    'audience', (p_post).audience,
    'audienceCohortId', (p_post).audience_cohort_id,
    'status', (p_post).status,
    'pinned', (p_post).pinned,
    'publishedAtEpoch', CASE
      WHEN (p_post).published_at IS NULL THEN NULL
      ELSE extract(epoch FROM (p_post).published_at)
    END,
    'scheduledForEpoch', CASE
      WHEN (p_post).scheduled_for IS NULL THEN NULL
      ELSE extract(epoch FROM (p_post).scheduled_for)
    END,
    'expiresAtEpoch', CASE
      WHEN (p_post).expires_at IS NULL THEN NULL
      ELSE extract(epoch FROM (p_post).expires_at)
    END,
    'emailRequested', (p_post).email_requested,
    'createdBy', (p_post).created_by,
    'updatedBy', (p_post).updated_by,
    'createdAtEpoch', extract(epoch FROM (p_post).created_at),
    'updatedAtEpoch', extract(epoch FROM (p_post).updated_at)
  );
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_post_mutation_state(
  plugin_data.csf_announcements
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION plugin_data.csf_mutate_post(
  p_organization_id uuid,
  p_operation text,
  p_post_id uuid,
  p_payload jsonb,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_operation, '')));
  v_payload_keys text[];
  v_expected_action text;
  v_title text;
  v_body text;
  v_audience text;
  v_audience_cohort_id uuid;
  v_pinned boolean;
  v_publish boolean;
  v_scheduled_for timestamptz;
  v_scheduled_text text;
  v_send_email boolean;
  v_new_status text;
  v_new_published_at timestamptz;
  v_new_scheduled_for timestamptz;
  v_intent jsonb;
  v_request_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_before plugin_data.csf_announcements%ROWTYPE;
  v_after plugin_data.csf_announcements%ROWTYPE;
  v_before_state jsonb;
  v_after_state jsonb;
  v_state_fingerprint text;
  v_now timestamptz := pg_catalog.statement_timestamp();
BEGIN
  -- Authorization precedes receipt and announcement access. A service caller
  -- cannot use a revoked actor to learn whether a private post request exists.
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_posts'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF posts.';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable post request identifier is required.';
  END IF;
  IF v_operation NOT IN ('create', 'update', 'pin', 'archive') THEN
    RAISE EXCEPTION 'Choose a valid post operation.';
  END IF;
  IF pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Post mutation payload must be an object.';
  END IF;

  SELECT coalesce(
    pg_catalog.array_agg(payload_key.key ORDER BY payload_key.key),
    ARRAY[]::text[]
  )
  INTO v_payload_keys
  FROM pg_catalog.jsonb_object_keys(p_payload) AS payload_key(key);

  IF v_operation IN ('create', 'update') THEN
    IF v_payload_keys IS DISTINCT FROM ARRAY[
      'audience',
      'audienceCohortId',
      'body',
      'pinned',
      'publish',
      'scheduledFor',
      'sendEmail',
      'title'
    ]::text[] THEN
      RAISE EXCEPTION 'Post content payload has unexpected or missing fields.';
    END IF;
    IF v_operation = 'create' AND p_post_id IS NOT NULL THEN
      RAISE EXCEPTION 'A new post cannot name an existing post identifier.';
    END IF;
    IF v_operation = 'update' AND p_post_id IS NULL THEN
      RAISE EXCEPTION 'Choose a post to update.';
    END IF;
    IF pg_catalog.jsonb_typeof(p_payload -> 'title') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(p_payload -> 'body') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(p_payload -> 'audience') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(p_payload -> 'pinned') IS DISTINCT FROM 'boolean'
      OR pg_catalog.jsonb_typeof(p_payload -> 'publish') IS DISTINCT FROM 'boolean'
      OR pg_catalog.jsonb_typeof(p_payload -> 'sendEmail') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'Post content fields have invalid types.';
    END IF;

    v_title := nullif(pg_catalog.btrim(p_payload ->> 'title'), '');
    v_body := nullif(pg_catalog.btrim(p_payload ->> 'body'), '');
    v_audience := pg_catalog.lower(pg_catalog.btrim(p_payload ->> 'audience'));
    v_pinned := (p_payload ->> 'pinned')::boolean;
    v_publish := (p_payload ->> 'publish')::boolean;
    v_send_email := (p_payload ->> 'sendEmail')::boolean;

    IF v_title IS NULL OR pg_catalog.char_length(v_title) > 200 THEN
      RAISE EXCEPTION 'Enter a post title between 1 and 200 characters.';
    END IF;
    IF v_body IS NULL OR pg_catalog.char_length(v_body) > 10000 THEN
      RAISE EXCEPTION 'Enter a post message between 1 and 10000 characters.';
    END IF;
    IF v_audience NOT IN ('members', 'officers', 'class', 'public') THEN
      RAISE EXCEPTION 'Choose a valid post audience.';
    END IF;

    IF pg_catalog.jsonb_typeof(p_payload -> 'audienceCohortId') = 'null' THEN
      v_audience_cohort_id := NULL;
    ELSIF pg_catalog.jsonb_typeof(p_payload -> 'audienceCohortId') = 'string' THEN
      BEGIN
        v_audience_cohort_id := nullif(p_payload ->> 'audienceCohortId', '')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Choose a valid graduating class.';
      END;
    ELSE
      RAISE EXCEPTION 'Choose a valid graduating class.';
    END IF;
    IF v_audience = 'class' AND v_audience_cohort_id IS NULL THEN
      RAISE EXCEPTION 'A class post must name its graduating class.';
    END IF;
    IF v_audience <> 'class' AND v_audience_cohort_id IS NOT NULL THEN
      RAISE EXCEPTION 'Only class posts carry a graduating-class target.';
    END IF;

    IF pg_catalog.jsonb_typeof(p_payload -> 'scheduledFor') = 'null' THEN
      v_scheduled_for := NULL;
    ELSIF pg_catalog.jsonb_typeof(p_payload -> 'scheduledFor') = 'string' THEN
      v_scheduled_text := p_payload ->> 'scheduledFor';
      IF v_scheduled_text !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
        RAISE EXCEPTION 'Scheduled post time must include a timezone.';
      END IF;
      BEGIN
        v_scheduled_for := v_scheduled_text::timestamptz;
      EXCEPTION
        WHEN invalid_text_representation
          OR invalid_datetime_format
          OR datetime_field_overflow
          OR invalid_time_zone_displacement_value THEN
        RAISE EXCEPTION 'Choose a valid scheduled post time.';
      END;
    ELSE
      RAISE EXCEPTION 'Choose a valid scheduled post time.';
    END IF;

    IF v_publish AND v_scheduled_for IS NOT NULL THEN
      RAISE EXCEPTION 'A post cannot publish now and also carry a schedule.';
    END IF;
    IF v_send_email AND NOT v_publish THEN
      RAISE EXCEPTION 'Email goes out when a post is published, not before.';
    END IF;
    IF v_send_email AND v_audience = 'public' THEN
      RAISE EXCEPTION 'Public posts are not emailed; they live on the public page.';
    END IF;

    v_expected_action := CASE v_operation
      WHEN 'create' THEN 'post_created'
      ELSE 'post_updated'
    END;
    v_intent := pg_catalog.jsonb_build_object(
      'operation', v_operation,
      'postId', p_post_id,
      'title', v_title,
      'body', v_body,
      'audience', v_audience,
      'audienceCohortId', v_audience_cohort_id,
      'pinned', v_pinned,
      'publish', v_publish,
      'scheduledForEpoch', CASE
        WHEN v_scheduled_for IS NULL THEN NULL
        ELSE extract(epoch FROM v_scheduled_for)
      END,
      'sendEmail', v_send_email
    );
  ELSIF v_operation = 'pin' THEN
    IF p_post_id IS NULL THEN
      RAISE EXCEPTION 'Choose a post to pin or unpin.';
    END IF;
    IF v_payload_keys IS DISTINCT FROM ARRAY['pinned']::text[]
      OR pg_catalog.jsonb_typeof(p_payload -> 'pinned') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'Pin payload must contain one boolean pinned value.';
    END IF;
    v_pinned := (p_payload ->> 'pinned')::boolean;
    v_expected_action := CASE
      WHEN v_pinned THEN 'post_pinned'
      ELSE 'post_unpinned'
    END;
    v_intent := pg_catalog.jsonb_build_object(
      'operation', v_operation,
      'postId', p_post_id,
      'pinned', v_pinned
    );
  ELSE
    IF p_post_id IS NULL THEN
      RAISE EXCEPTION 'Choose a post to archive.';
    END IF;
    IF v_payload_keys IS DISTINCT FROM ARRAY[]::text[] THEN
      RAISE EXCEPTION 'Archive payload must be empty.';
    END IF;
    v_expected_action := 'post_archived';
    v_intent := pg_catalog.jsonb_build_object(
      'operation', v_operation,
      'postId', p_post_id
    );
  END IF;

  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'organizationId', p_organization_id,
          'actorUserId', p_actor_user_id,
          'intent', v_intent
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_post_mutation_request:'
        || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'post_mutation_request'
    AND audit.action IN (
      'post_created',
      'post_updated',
      'post_pinned',
      'post_unpinned',
      'post_archived'
    )
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM v_expected_action
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_announcement'
      OR v_receipt.target_id IS NULL
      OR (v_operation <> 'create' AND v_receipt.target_id IS DISTINCT FROM p_post_id)
      OR v_receipt.after_data ->> 'operation' IS DISTINCT FROM v_operation
      OR v_receipt.after_data ->> 'requestFingerprint' IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'That post request identifier is already bound to a different change.';
    END IF;

    SELECT announcement.*
    INTO v_after
    FROM plugin_data.csf_announcements AS announcement
    WHERE announcement.organization_id = p_organization_id
      AND announcement.id = v_receipt.target_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The committed post receipt no longer resolves to its post. Reload the feed.';
    END IF;

    v_after_state := plugin_data.csf_post_mutation_state(v_after);
    v_state_fingerprint := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(v_after_state::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    );
    IF v_receipt.after_data -> 'postState' IS DISTINCT FROM v_after_state
      OR v_receipt.after_data ->> 'stateFingerprint' IS DISTINCT FROM v_state_fingerprint THEN
      RAISE EXCEPTION 'The committed post change is no longer current. Reload the feed before trying again.';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'postId', v_after.id,
      'status', v_after.status,
      'emailRequested', v_after.email_requested,
      'idempotent', true
    );
  END IF;

  IF v_operation IN ('create', 'update') AND v_audience_cohort_id IS NOT NULL THEN
    PERFORM 1
    FROM plugin_data.csf_cohorts AS cohort
    WHERE cohort.organization_id = p_organization_id
      AND cohort.id = v_audience_cohort_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That graduating class does not belong to this chapter.';
    END IF;
  END IF;

  IF v_operation = 'create' THEN
    v_new_status := CASE
      WHEN v_publish THEN 'published'
      WHEN v_scheduled_for IS NOT NULL THEN 'scheduled'
      ELSE 'draft'
    END;
    v_new_published_at := CASE WHEN v_new_status = 'published' THEN v_now ELSE NULL END;
    v_new_scheduled_for := CASE WHEN v_new_status = 'scheduled' THEN v_scheduled_for ELSE NULL END;

    INSERT INTO plugin_data.csf_announcements (
      organization_id,
      title,
      body,
      audience,
      audience_cohort_id,
      status,
      pinned,
      published_at,
      scheduled_for,
      email_requested,
      created_by,
      updated_by,
      updated_at
    ) VALUES (
      p_organization_id,
      v_title,
      v_body,
      v_audience,
      v_audience_cohort_id,
      v_new_status,
      v_pinned,
      v_new_published_at,
      v_new_scheduled_for,
      v_send_email,
      p_actor_user_id,
      p_actor_user_id,
      v_now
    )
    RETURNING * INTO v_after;
  ELSE
    SELECT announcement.*
    INTO v_before
    FROM plugin_data.csf_announcements AS announcement
    WHERE announcement.organization_id = p_organization_id
      AND announcement.id = p_post_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That post was not found in this chapter.';
    END IF;
    IF v_before.status = 'archived' THEN
      RAISE EXCEPTION 'An archived post is history; create a new post instead.';
    END IF;

    v_before_state := plugin_data.csf_post_mutation_state(v_before);

    IF v_operation = 'update' THEN
      v_new_status := CASE
        WHEN v_before.status = 'published' THEN 'published'
        WHEN v_publish THEN 'published'
        WHEN v_scheduled_for IS NOT NULL THEN 'scheduled'
        ELSE 'draft'
      END;
      v_new_published_at := CASE
        WHEN v_before.status = 'published' THEN v_before.published_at
        WHEN v_new_status = 'published' THEN v_now
        ELSE NULL
      END;
      v_new_scheduled_for := CASE
        WHEN v_new_status = 'scheduled' THEN v_scheduled_for
        ELSE NULL
      END;

      UPDATE plugin_data.csf_announcements
      SET title = v_title,
          body = v_body,
          audience = v_audience,
          audience_cohort_id = v_audience_cohort_id,
          status = v_new_status,
          pinned = v_pinned,
          published_at = v_new_published_at,
          scheduled_for = v_new_scheduled_for,
          email_requested = v_before.email_requested OR v_send_email,
          updated_by = p_actor_user_id,
          updated_at = v_now
      WHERE organization_id = p_organization_id
        AND id = p_post_id
      RETURNING * INTO v_after;
    ELSIF v_operation = 'pin' THEN
      IF v_before.pinned IS NOT DISTINCT FROM v_pinned THEN
        RAISE EXCEPTION 'That post already has the requested pin state.';
      END IF;
      UPDATE plugin_data.csf_announcements
      SET pinned = v_pinned,
          updated_by = p_actor_user_id,
          updated_at = v_now
      WHERE organization_id = p_organization_id
        AND id = p_post_id
      RETURNING * INTO v_after;
    ELSE
      UPDATE plugin_data.csf_announcements
      SET status = 'archived',
          pinned = false,
          updated_by = p_actor_user_id,
          updated_at = v_now
      WHERE organization_id = p_organization_id
        AND id = p_post_id
      RETURNING * INTO v_after;
    END IF;
  END IF;

  IF v_after.id IS NULL THEN
    RAISE EXCEPTION 'The post mutation did not commit a post row.';
  END IF;

  v_after_state := plugin_data.csf_post_mutation_state(v_after);
  v_state_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_after_state::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    v_expected_action,
    'csf_announcement',
    v_after.id,
    v_after.term_id,
    v_before_state,
    pg_catalog.jsonb_build_object(
      'operation', v_operation,
      'requestFingerprint', v_request_fingerprint,
      'stateFingerprint', v_state_fingerprint,
      'postState', v_after_state
    ),
    p_request_id,
    'post_mutation_request',
    v_after.id::text,
    v_expected_action
  );

  RETURN pg_catalog.jsonb_build_object(
    'postId', v_after.id,
    'status', v_after.status,
    'emailRequested', v_after.email_requested,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_mutate_post(
  uuid, text, uuid, jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_mutate_post(
  uuid, text, uuid, jsonb, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_post_mutation_state(
  plugin_data.csf_announcements
) IS 'Internal canonical CSF post state used to verify immutable mutation receipts. Campaign/provider linkage is intentionally excluded.';
COMMENT ON FUNCTION plugin_data.csf_mutate_post(
  uuid, text, uuid, jsonb, uuid, uuid
) IS 'Service-only, manage_posts-authorized, replay-safe create/update/pin/archive boundary that commits one CSF post mutation and one immutable audit receipt atomically; email campaign orchestration remains separate.';

NOTIFY pgrst, 'reload schema';

COMMIT;
