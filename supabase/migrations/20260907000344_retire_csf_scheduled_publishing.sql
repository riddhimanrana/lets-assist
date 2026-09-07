-- Retire automatic CSF publication without deleting posts or historical receipts.
BEGIN;
CREATE FUNCTION app_private.retire_csf_scheduled_posts()
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
LOCK TABLE plugin_data.csf_announcements IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO plugin_data.csf_admin_audit_events (
  organization_id, actor_user_id, action, target_type, target_id, term_id,
  before_data, after_data, correlation_id, source_type, source_id, reason_code
)
SELECT organization_id, NULL, 'post_schedule_retired', 'csf_announcement', id, term_id,
  jsonb_build_object('status', status, 'scheduledFor', scheduled_for,
    'scheduledBy', scheduled_by, 'scheduleRevision', schedule_revision,
    'holdReason', scheduled_publish_hold_reason),
  jsonb_build_object('status', 'draft', 'systemActor', 'scheduling_retirement',
    'emailQueued', false),
  gen_random_uuid(), 'scheduling_retirement', 'migration:20260907000344',
  'scheduled_publishing_removed'
FROM plugin_data.csf_announcements WHERE status = 'scheduled';

UPDATE plugin_data.csf_announcements
SET status = 'draft', scheduled_for = NULL, published_at = NULL, updated_at = now()
WHERE status = 'scheduled';
GET DIAGNOSTICS v_count = ROW_COUNT;
RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION app_private.retire_csf_scheduled_posts()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.retire_csf_scheduled_posts() TO postgres;
SELECT app_private.retire_csf_scheduled_posts();

CREATE OR REPLACE FUNCTION plugin_data.csf_guard_announcement_schedule_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'scheduled' THEN
    RAISE EXCEPTION 'Post scheduling has been removed. Publish now or save a draft.'
      USING ERRCODE = '55000';
  END IF;
  NEW.scheduled_for := NULL;
  NEW.scheduled_by := NULL;
  NEW.schedule_revision := NULL;
  NEW.scheduled_publish_hold_reason := NULL;
  NEW.scheduled_publish_held_at := NULL;
  NEW.scheduled_publish_last_checked_at := NULL;
  IF NEW.status = 'archived' THEN NEW.pinned := false; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_announcement_schedule_lifecycle()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_announcement_schedule_lifecycle() TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_publish_due_posts(p_limit integer, p_worker_id text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'retired', true, 'examined', 0, 'published', 0, 'held', 0,
    'holds', jsonb_build_object('pluginUnavailable', 0, 'actorUnavailable', 0,
      'termUnavailable', 0, 'cohortUnavailable', 0, 'expired', 0,
      'scheduledEmailUnsupported', 0),
    'organizationIds', '[]'::jsonb
  );
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_publish_due_posts(integer, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_publish_due_posts(integer, text) TO postgres, service_role;
COMMENT ON FUNCTION plugin_data.csf_publish_due_posts(integer, text) IS
  'Retired compatibility entry point. Returns zero publication counts without reading or writing posts.';

CREATE OR REPLACE FUNCTION plugin_data.csf_mutate_post(
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
  v_status text;
  v_publish boolean;
  v_scheduled_text text;
  v_scheduled_for timestamptz;
  v_has_receipt boolean := false;
BEGIN
  -- Authorization and the stable request coordinate precede every receipt or
  -- post read. This wrapper deliberately repeats the inner primitive's check.
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

  IF nullif(pg_catalog.btrim(p_payload->>'scheduledFor'), '') IS NOT NULL THEN
    RAISE EXCEPTION 'Post scheduling has been removed. Publish now or save a draft.'
      USING ERRCODE = '55000';
  END IF;

  -- Same lock key and order as the inner receipt primitive. Re-acquiring this
  -- transaction lock inside the inner function is safe and keeps new requests,
  -- exact replays, and hostile request-id reuse serialized identically.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_post_mutation_request:'
        || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );

  SELECT EXISTS (
    SELECT 1
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
  )
  INTO v_has_receipt;

  -- The inner primitive owns fingerprint and current-state verification. A
  -- scheduled receipt replay after automatic publication reaches that check and
  -- returns its bounded stale-state refusal rather than becoming a second edit.
  IF v_has_receipt THEN
    RETURN plugin_data.csf_mutate_post_atomic_inner(
      p_organization_id,
      p_operation,
      p_post_id,
      p_payload,
      p_actor_user_id,
      p_request_id
    );
  END IF;

  IF v_operation = 'update' THEN
    SELECT announcement.status
    INTO v_status
    FROM plugin_data.csf_announcements AS announcement
    WHERE announcement.organization_id = p_organization_id
      AND announcement.id = p_post_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That post was not found in this chapter.';
    END IF;

    IF pg_catalog.jsonb_typeof(p_payload) = 'object'
      AND pg_catalog.jsonb_typeof(p_payload -> 'publish') = 'boolean' THEN
      v_publish := (p_payload ->> 'publish')::boolean;
    END IF;

    IF v_status = 'published'
      AND (
        v_publish IS DISTINCT FROM true
        OR pg_catalog.jsonb_typeof(p_payload -> 'scheduledFor')
          IS DISTINCT FROM 'null'
      ) THEN
      RAISE EXCEPTION
        'Published post edits stay live. Archive the post or create a new scheduled post.';
    END IF;
  END IF;

  -- A past time is not a schedule; Publish now is the explicit immediate path.
  -- Invalid timestamp shapes continue to the inner primitive for its canonical
  -- validation message.
  IF v_operation IN ('create', 'update')
    AND pg_catalog.jsonb_typeof(p_payload) = 'object'
    AND pg_catalog.jsonb_typeof(p_payload -> 'publish') = 'boolean'
    AND (p_payload ->> 'publish')::boolean = false
    AND pg_catalog.jsonb_typeof(p_payload -> 'scheduledFor') = 'string' THEN
    v_scheduled_text := p_payload ->> 'scheduledFor';
    IF v_scheduled_text ~ '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
      BEGIN
        v_scheduled_for := v_scheduled_text::timestamptz;
      EXCEPTION
        WHEN invalid_text_representation
          OR invalid_datetime_format
          OR datetime_field_overflow
          OR invalid_time_zone_displacement_value THEN
        v_scheduled_for := NULL;
      END;
      IF v_scheduled_for IS NOT NULL
        AND v_scheduled_for <= pg_catalog.statement_timestamp() THEN
        RAISE EXCEPTION
          'Choose a future time, or publish the post now.';
      END IF;
    END IF;
  END IF;

  RETURN plugin_data.csf_mutate_post_atomic_inner(
    p_organization_id,
    p_operation,
    p_post_id,
    p_payload,
    p_actor_user_id,
    p_request_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_mutate_post(
  uuid, text, uuid, jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_mutate_post(
  uuid, text, uuid, jsonb, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_mutate_post(
  uuid, text, uuid, jsonb, uuid, uuid
) IS 'Service-only CSF post mutation boundary. Authorization and request serialization precede reads; exact receipts retain inner fingerprint/state checks; published edits cannot pretend to become drafts or schedules; schedule times must be future.';
COMMENT ON FUNCTION plugin_data.csf_mutate_post_atomic_inner(
  uuid, text, uuid, jsonb, uuid, uuid
) IS 'Internal atomic post mutation and receipt primitive. Direct service_role execution is revoked; call csf_mutate_post instead.';

DO $$
DECLARE v_state record;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(592041, 1);
  FOR v_state IN SELECT release_sha, revision FROM app_private.csf_release_worker_controls
  WHERE scheduled_post_publisher FOR UPDATE
  LOOP
    PERFORM app_private.set_csf_release_worker_control(
      v_state.release_sha, 'scheduled_post_publisher', false, v_state.revision,
      gen_random_uuid(), 'migration:20260907000344', 'Scheduled publishing removed'
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.set_csf_release_worker_control(
  p_release_sha text, p_worker text, p_enabled boolean,
  p_expected_revision bigint, p_request_id uuid, p_actor text, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_request jsonb;
  v_prior app_private.csf_release_worker_receipts%ROWTYPE;
  v_state app_private.csf_release_worker_controls%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_worker = 'scheduled_post_publisher' AND p_enabled IS TRUE THEN
    RAISE EXCEPTION 'Scheduled publishing has been removed' USING ERRCODE = '55000';
  END IF;
  IF p_release_sha IS NULL OR p_release_sha !~ '^[0-9a-f]{40}$'
    OR p_worker IS NULL OR p_worker NOT IN ('workbook_refresh', 'import_commit', 'communications', 'scheduled_post_publisher')
    OR p_enabled IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0
    OR p_request_id IS NULL OR p_actor IS NULL OR length(trim(p_actor)) NOT BETWEEN 1 AND 200
    OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid worker transition' USING ERRCODE = '22023';
  END IF;
  v_request := jsonb_build_object('releaseSha', p_release_sha, 'worker', p_worker,
    'enabled', p_enabled, 'expectedRevision', p_expected_revision, 'actor', p_actor, 'reason', p_reason);
  -- Serializes request IDs across releases as well as transitions within one release.
  PERFORM pg_catalog.pg_advisory_xact_lock(592041, 1);
  SELECT * INTO v_prior FROM app_private.csf_release_worker_receipts WHERE request_id = p_request_id;
  IF FOUND THEN
    IF v_prior.request IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'Worker request identity conflict' USING ERRCODE = '22023';
    END IF;
    RETURN v_prior.result;
  END IF;
  INSERT INTO app_private.csf_release_worker_controls(release_sha)
    VALUES (p_release_sha) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT v_state FROM app_private.csf_release_worker_controls
    WHERE release_sha = p_release_sha FOR UPDATE;
  IF v_state.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Worker configuration changed' USING ERRCODE = '40001';
  END IF;
  IF p_enabled AND (
    (p_worker IN ('import_commit', 'communications', 'scheduled_post_publisher') AND NOT v_state.workbook_refresh)
    OR (p_worker IN ('communications', 'scheduled_post_publisher') AND NOT v_state.import_commit)
    OR (p_worker = 'scheduled_post_publisher' AND NOT v_state.communications)
  ) THEN
    RAISE EXCEPTION 'Enable preceding workers first' USING ERRCODE = '22023';
  END IF;
  UPDATE app_private.csf_release_worker_controls SET
    workbook_refresh = CASE WHEN p_worker = 'workbook_refresh' THEN p_enabled ELSE workbook_refresh END,
    import_commit = CASE WHEN p_worker = 'import_commit' THEN p_enabled ELSE import_commit END,
    communications = CASE WHEN p_worker = 'communications' THEN p_enabled ELSE communications END,
    scheduled_post_publisher = CASE WHEN p_worker = 'scheduled_post_publisher' THEN p_enabled ELSE scheduled_post_publisher END,
    revision = revision + 1, updated_at = now()
    WHERE release_sha = p_release_sha;
  v_result := public.read_csf_release_worker_controls(p_release_sha)
    || jsonb_build_object('requestId', p_request_id);
  INSERT INTO app_private.csf_release_worker_receipts(request_id, release_sha, request, result)
    VALUES (p_request_id, p_release_sha, v_request, v_result);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION app_private.set_csf_release_worker_control(text,text,boolean,bigint,uuid,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.set_csf_release_worker_control(text,text,boolean,bigint,uuid,text,text) TO postgres;


NOTIFY pgrst, 'reload schema';
COMMIT;
