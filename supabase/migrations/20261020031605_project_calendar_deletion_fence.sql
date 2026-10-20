-- Serialize personal calendar claims with project deletion and preserve
-- unfinished provider work for reconciliation. No existing records are changed.
BEGIN;

-- The receipt table stays owner-only. Claims learn only whether their locked
-- project is pending deletion; no table grant or browser capability is added.
CREATE FUNCTION app_private.project_calendar_deletion_pending(p_project_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM app_private.project_deletion_operations
    WHERE project_id = p_project_id AND phase = 'pending');
$$;
REVOKE ALL ON FUNCTION app_private.project_calendar_deletion_pending(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.project_calendar_deletion_pending(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_personal_calendar_update(
  p_actor_user_id uuid,
  p_project_id uuid,
  p_expected_source jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_marker text;
  v_source jsonb;
  v_receipt app_private.personal_calendar_sync_receipts%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR p_project_id IS NULL OR p_expected_source IS NULL
    OR jsonb_typeof(p_expected_source) IS DISTINCT FROM 'object' OR pg_column_size(p_expected_source) > 2097152 THEN
    RAISE EXCEPTION 'Invalid calendar update claim' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lets-assist-account-write:' || p_actor_user_id::text, 0));
  IF NOT app_private.account_deletion_actor_is_active(p_actor_user_id) THEN
    RAISE EXCEPTION 'Account unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT creator_calendar_event_id INTO v_marker FROM public.projects
    WHERE id = p_project_id AND creator_id = p_actor_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Calendar source not found' USING ERRCODE = 'P0002';
  END IF;
  -- The project row serializes claims with deletion preparation/finalization.
  IF app_private.project_calendar_deletion_pending(p_project_id) THEN
    RAISE EXCEPTION 'Project deletion in progress' USING ERRCODE = '55000', HINT = 'project_deletion_in_progress';
  END IF;
  v_source := app_private.personal_calendar_project_source(p_project_id, p_actor_user_id);
  SELECT * INTO v_receipt FROM app_private.personal_calendar_sync_receipts
    WHERE source_kind = 'project' AND source_id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    -- A project that was never synced has nothing to update and must not provision a calendar.
    IF v_marker IS NULL THEN RETURN NULL; END IF;
    INSERT INTO app_private.personal_calendar_sync_receipts(source_kind, source_id, user_id, project_id, phase, legacy_event_id)
      VALUES ('project', p_project_id, p_actor_user_id, p_project_id, 'synced', v_marker) ON CONFLICT (source_kind, source_id) DO NOTHING;
    SELECT * INTO v_receipt FROM app_private.personal_calendar_sync_receipts
      WHERE source_kind = 'project' AND source_id = p_project_id FOR UPDATE;
  END IF;
  IF v_receipt.user_id <> p_actor_user_id THEN
    RAISE EXCEPTION 'Calendar source ownership changed' USING ERRCODE = '42501';
  END IF;
  IF v_receipt.lease_until > clock_timestamp() THEN
    RAISE EXCEPTION 'Calendar operation in progress' USING ERRCODE = '55P03', HINT = 'calendar_operation_in_progress';
  END IF;
  -- A settled removal or a sync with no saved plan left nothing at the provider.
  IF v_marker IS NULL AND (v_receipt.phase = 'removed'
    OR (v_receipt.phase = 'syncing' AND jsonb_array_length(v_receipt.events) = 0)) THEN
    RETURN NULL;
  END IF;
  IF v_receipt.phase IN ('syncing', 'removing', 'removed') THEN
    RAISE EXCEPTION 'Calendar entry is not settled' USING ERRCODE = '55000', HINT = 'calendar_receipt_' || v_receipt.phase;
  END IF;
  IF v_marker IS NULL OR v_marker IS DISTINCT FROM coalesce(v_receipt.events->0->>'id', v_receipt.legacy_event_id) THEN
    RAISE EXCEPTION 'Calendar event changed' USING ERRCODE = '55000', HINT = 'calendar_event_changed';
  END IF;
  IF v_source->>'status' IS NOT DISTINCT FROM 'cancelled' OR coalesce(v_source->>'workflow_status', 'published') <> 'published' THEN
    RAISE EXCEPTION 'Calendar source is unavailable' USING ERRCODE = '55000', HINT = 'calendar_source_unavailable';
  END IF;
  -- The service formats events from its own read, so that read must equal the locked row.
  IF p_expected_source IS DISTINCT FROM v_source THEN
    RAISE EXCEPTION 'Calendar source changed' USING ERRCODE = '55000', HINT = 'calendar_source_changed';
  END IF;
  -- A new plan is needed for a first claim, a changed source, or a changed connection revision.
  -- The same lease-fenced event IDs are rewritten, so confirmations restart with the plan.
  IF v_receipt.phase = 'synced' OR v_receipt.update_source IS DISTINCT FROM v_source
    OR (v_receipt.update_connection_id IS NOT NULL
      AND app_private.personal_calendar_connection_revision(p_actor_user_id, v_receipt.update_connection_id)
        IS DISTINCT FROM v_receipt.update_connection_revision) THEN
    UPDATE app_private.personal_calendar_sync_receipts SET phase = 'updating', update_source = v_source,
      update_planned_at = NULL, update_connection_id = NULL, update_connection_revision = NULL,
      confirmed_event_ids = ARRAY[]::text[]
      WHERE source_kind = 'project' AND source_id = p_project_id RETURNING * INTO v_receipt;
  END IF;
  UPDATE public.projects SET creator_synced_at = NULL
    WHERE id = p_project_id AND creator_id = p_actor_user_id AND creator_synced_at IS NOT NULL;
  UPDATE app_private.personal_calendar_sync_receipts SET claim_token = gen_random_uuid(),
    lease_until = clock_timestamp() + interval '90 seconds', updated_at = clock_timestamp()
    WHERE source_kind = 'project' AND source_id = p_project_id RETURNING * INTO v_receipt;
  RETURN to_jsonb(v_receipt);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_personal_calendar_update(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_personal_calendar_update(uuid,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_personal_calendar_sync(
  p_actor_user_id uuid,
  p_source_kind text,
  p_source_id uuid,
  p_operation text,
  p_schedule_id text DEFAULT NULL,
  p_expected_event_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_source_id uuid := p_source_id;
  v_project_id uuid;
  v_claim_project_id uuid;
  v_marker text;
  v_receipt app_private.personal_calendar_sync_receipts%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR p_source_kind NOT IN ('project', 'signup')
    OR p_source_kind IS NULL OR p_operation NOT IN ('sync', 'remove') OR p_operation IS NULL
    OR length(p_schedule_id) > 300 THEN
    RAISE EXCEPTION 'Invalid calendar claim' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lets-assist-account-write:' || p_actor_user_id::text, 0));
  IF p_operation = 'sync' THEN
    IF NOT app_private.account_deletion_actor_is_active(p_actor_user_id) THEN
      RAISE EXCEPTION 'Account unavailable' USING ERRCODE = '42501';
    END IF;
    IF v_source_id IS NULL THEN
      RAISE EXCEPTION 'Source required' USING ERRCODE = '22023';
    END IF;
    -- Lock the parent before the signup or receipt. Preparation takes this
    -- same row lock before checking receipts and publishing its deletion marker.
    IF p_source_kind = 'project' THEN
      v_claim_project_id := p_source_id;
    ELSE
      SELECT project_id INTO v_claim_project_id FROM public.project_signups
        WHERE id = p_source_id AND user_id = p_actor_user_id AND schedule_id = p_schedule_id;
    END IF;
    PERFORM 1 FROM public.projects WHERE id = v_claim_project_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Calendar source not found' USING ERRCODE = 'P0002';
    END IF;
    IF app_private.project_calendar_deletion_pending(v_claim_project_id) THEN
      RAISE EXCEPTION 'Project deletion in progress' USING ERRCODE = '55000', HINT = 'project_deletion_in_progress';
    END IF;
  ELSE
    IF p_expected_event_id IS NULL OR length(p_expected_event_id) NOT BETWEEN 5 AND 1024 OR p_expected_event_id !~ '^[A-Za-z0-9_-]+$' THEN
      RAISE EXCEPTION 'Event required' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(*) FROM app_private.personal_calendar_sync_receipts
      WHERE source_kind = p_source_kind AND user_id = p_actor_user_id
        AND coalesce(events->0->>'id', legacy_event_id) = p_expected_event_id
        AND (p_source_id IS NULL OR source_id = p_source_id)) > 1 THEN
      RAISE EXCEPTION 'Ambiguous calendar event ownership' USING ERRCODE = '55000';
    END IF;
    SELECT source_id INTO v_source_id FROM app_private.personal_calendar_sync_receipts
      WHERE source_kind = p_source_kind AND user_id = p_actor_user_id
        AND coalesce(events->0->>'id', legacy_event_id) = p_expected_event_id
        AND (p_source_id IS NULL OR source_id = p_source_id);
    IF v_source_id IS NOT NULL THEN
      SELECT * INTO v_receipt FROM app_private.personal_calendar_sync_receipts
        WHERE source_kind = p_source_kind AND source_id = v_source_id FOR UPDATE;
    END IF;
  END IF;

  IF v_receipt.source_id IS NULL THEN
    IF p_operation = 'remove' AND (
      (p_source_kind = 'project' AND (SELECT count(*) FROM public.projects WHERE creator_id = p_actor_user_id
        AND creator_calendar_event_id = p_expected_event_id AND (p_source_id IS NULL OR id = p_source_id)) > 1)
      OR (p_source_kind = 'signup' AND (SELECT count(*) FROM public.project_signups WHERE user_id = p_actor_user_id
        AND volunteer_calendar_event_id = p_expected_event_id AND (p_source_id IS NULL OR id = p_source_id)) > 1)
    ) THEN
      RAISE EXCEPTION 'Ambiguous calendar event ownership' USING ERRCODE = '55000';
    END IF;
    IF p_source_kind = 'project' THEN
      SELECT id, id, creator_calendar_event_id INTO v_source_id, v_project_id, v_marker
        FROM public.projects WHERE creator_id = p_actor_user_id
          AND ((p_operation = 'sync' AND id = p_source_id)
            OR (p_operation = 'remove' AND creator_calendar_event_id = p_expected_event_id
              AND (p_source_id IS NULL OR id = p_source_id))) FOR UPDATE;
    ELSE
      SELECT id, project_id, volunteer_calendar_event_id INTO v_source_id, v_project_id, v_marker
        FROM public.project_signups WHERE user_id = p_actor_user_id
          AND ((p_operation = 'sync' AND id = p_source_id AND schedule_id = p_schedule_id)
            OR (p_operation = 'remove' AND volunteer_calendar_event_id = p_expected_event_id
              AND (p_source_id IS NULL OR id = p_source_id))) FOR UPDATE;
    END IF;
    IF v_source_id IS NULL THEN
      RAISE EXCEPTION 'Calendar source not found' USING ERRCODE = 'P0002';
    END IF;
    -- A signup may have moved while its parent lock was being acquired.
    IF p_operation = 'sync' AND v_project_id IS DISTINCT FROM v_claim_project_id THEN
      RAISE EXCEPTION 'Calendar source changed' USING ERRCODE = '55000', HINT = 'calendar_source_changed';
    END IF;
    INSERT INTO app_private.personal_calendar_sync_receipts(source_kind, source_id, user_id, project_id, phase, requested_schedule_id, legacy_event_id)
      VALUES (p_source_kind, v_source_id, p_actor_user_id, v_project_id,
        CASE WHEN p_operation = 'remove' THEN 'removing' WHEN v_marker IS NOT NULL THEN 'synced' ELSE 'syncing' END,
        p_schedule_id, v_marker) ON CONFLICT (source_kind, source_id) DO NOTHING;
    SELECT * INTO v_receipt FROM app_private.personal_calendar_sync_receipts
      WHERE source_kind = p_source_kind AND source_id = v_source_id FOR UPDATE;
  END IF;
  IF p_operation = 'remove' AND coalesce(v_receipt.events->0->>'id', v_receipt.legacy_event_id) IS DISTINCT FROM p_expected_event_id THEN
    RAISE EXCEPTION 'Calendar event changed' USING ERRCODE = '55000';
  END IF;
  IF v_receipt.user_id <> p_actor_user_id THEN
    RAISE EXCEPTION 'Calendar source ownership changed' USING ERRCODE = '42501';
  END IF;
  IF v_receipt.lease_until > clock_timestamp() THEN
    RAISE EXCEPTION 'Calendar operation in progress' USING ERRCODE = '55P03';
  END IF;
  IF p_operation = 'sync' THEN
    IF v_receipt.phase = 'removing' THEN
      RAISE EXCEPTION 'Finish removing this calendar entry first' USING ERRCODE = '55000';
    ELSIF v_receipt.phase = 'removed' THEN
      UPDATE app_private.personal_calendar_sync_receipts SET generation = gen_random_uuid(), phase = 'syncing',
        requested_schedule_id = p_schedule_id, legacy_event_id = NULL, calendar_id = NULL,
        events = '[]', confirmed_event_ids = ARRAY[]::text[]
        WHERE source_kind = p_source_kind AND source_id = v_source_id RETURNING * INTO v_receipt;
    ELSIF v_receipt.legacy_event_id IS NULL AND v_receipt.requested_schedule_id IS DISTINCT FROM p_schedule_id THEN
      RAISE EXCEPTION 'Calendar schedule selection changed' USING ERRCODE = '55000';
    END IF;
    IF v_receipt.phase = 'synced' THEN RETURN to_jsonb(v_receipt); END IF;
    -- An unfinished update is resumed only through claim_personal_calendar_update; a create claim takes no lease on it.
    IF v_receipt.phase = 'updating' THEN
      RETURN to_jsonb(v_receipt) || jsonb_build_object('claim_token', NULL);
    END IF;
  ELSE
    IF v_receipt.phase = 'removed' THEN RETURN to_jsonb(v_receipt); END IF;
    IF v_receipt.phase <> 'removing' THEN
      UPDATE app_private.personal_calendar_sync_receipts SET phase = 'removing', confirmed_event_ids = ARRAY[]::text[],
        update_source = NULL, update_planned_at = NULL, update_connection_id = NULL, update_connection_revision = NULL
        WHERE source_kind = p_source_kind AND source_id = v_source_id RETURNING * INTO v_receipt;
    END IF;
  END IF;
  UPDATE app_private.personal_calendar_sync_receipts SET claim_token = gen_random_uuid(),
    lease_until = clock_timestamp() + interval '90 seconds', updated_at = clock_timestamp()
    WHERE source_kind = p_source_kind AND source_id = v_source_id RETURNING * INTO v_receipt;
  RETURN to_jsonb(v_receipt);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_personal_calendar_sync(uuid,text,uuid,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_personal_calendar_sync(uuid,text,uuid,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_project_deletion(
  p_project_id uuid, p_actor_id uuid, p_replay_only boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_operation app_private.project_deletion_operations;
  v_refusal text;
  v_candidates integer;
  v_resumed boolean := false;
BEGIN
  IF p_project_id IS NULL OR p_actor_id IS NULL OR p_replay_only IS NULL THEN
    RAISE EXCEPTION 'Invalid project deletion scope.' USING ERRCODE = '22023';
  END IF;

  IF p_replay_only THEN
    SELECT * INTO v_operation
    FROM app_private.project_deletion_operations AS operation
    WHERE operation.project_id = p_project_id
      AND operation.phase = 'completed'
      AND operation.actor_id = p_actor_id
      AND NOT EXISTS (
        SELECT 1 FROM public.projects AS project WHERE project.id = p_project_id
      );
    IF FOUND THEN
      RETURN jsonb_build_object(
        'outcome', 'completed',
        'operationId', v_operation.id,
        'projectId', v_operation.project_id,
        'phase', 'completed',
        'replayed', true
      );
    END IF;
    RETURN jsonb_build_object('outcome', 'project_not_found');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-account-write:' || p_actor_id::text, 0));
  IF NOT app_private.account_deletion_actor_is_active(p_actor_id) THEN
    RETURN jsonb_build_object('outcome', 'forbidden');
  END IF;

  PERFORM 1 FROM public.projects AS project WHERE project.id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_operation
    FROM app_private.project_deletion_operations AS operation
    WHERE operation.project_id = p_project_id
      AND operation.phase = 'completed'
      AND operation.actor_id = p_actor_id;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'outcome', 'completed',
        'operationId', v_operation.id,
        'projectId', v_operation.project_id,
        'phase', 'completed',
        'replayed', true
      );
    END IF;
    RETURN jsonb_build_object('outcome', 'project_not_found');
  END IF;

  v_refusal := app_private.project_deletion_refusal(p_project_id, p_actor_id);
  IF v_refusal IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', v_refusal);
  END IF;

  -- Never delete past an uncertain provider create/update, even after its
  -- lease expires. A never-planned create with no live lease cannot write.
  -- Removing receipts remain durable cleanup authority after project deletion.
  IF EXISTS (
    SELECT 1 FROM app_private.personal_calendar_sync_receipts AS receipt
    WHERE receipt.project_id = p_project_id AND (
      receipt.lease_until > clock_timestamp()
      OR receipt.phase = 'updating'
      OR (receipt.phase = 'syncing' AND (
        receipt.legacy_event_id IS NOT NULL OR jsonb_array_length(receipt.events) > 0
      ))
    )
  ) THEN
    RETURN jsonb_build_object('outcome', 'calendar_in_progress');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-project-assets', 0));

  SELECT * INTO v_operation
  FROM app_private.project_deletion_operations AS operation
  WHERE operation.project_id = p_project_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_operation.phase <> 'pending' THEN
      RETURN jsonb_build_object('outcome', 'invalid_state');
    END IF;
    -- Any actor who is authorized now may carry an open deletion forward.
    UPDATE app_private.project_deletion_operations AS operation
    SET actor_id = p_actor_id, updated_at = now()
    WHERE operation.id = v_operation.id;
    v_resumed := true;
  ELSE
    SELECT count(*) INTO v_candidates
    FROM app_private.project_deletion_candidates(p_project_id);
    -- Refused rather than truncated: a partial claim would report a cleanup
    -- as complete while objects remained.
    IF v_candidates > 500 THEN
      RETURN jsonb_build_object('outcome', 'asset_limit', 'assetCount', v_candidates);
    END IF;

    INSERT INTO app_private.project_deletion_operations(project_id, actor_id)
    VALUES (p_project_id, p_actor_id)
    RETURNING * INTO v_operation;

    UPDATE app_private.project_asset_objects AS asset
    SET state = 'claimed', claim_operation_id = v_operation.id
    FROM app_private.project_deletion_candidates(p_project_id) AS candidate
    WHERE asset.bucket_id = candidate.bucket_id
      AND asset.object_name = candidate.object_name;
  END IF;

  RETURN jsonb_build_object(
    'outcome', CASE WHEN v_resumed THEN 'resumed' ELSE 'prepared' END,
    'operationId', v_operation.id,
    'projectId', p_project_id,
    'phase', 'pending',
    'objects', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'bucket', asset.bucket_id,
          'name', asset.object_name,
          'objectId', asset.object_id,
          'present', EXISTS (
            SELECT 1 FROM storage.objects AS stored
            WHERE stored.bucket_id = asset.bucket_id AND stored.name = asset.object_name
          )
        )
        ORDER BY asset.bucket_id, asset.object_name
      )
      FROM app_private.project_asset_objects AS asset
      WHERE asset.claim_operation_id = v_operation.id
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_project_deletion(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_project_deletion(uuid, uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_project_deletion(
  p_operation_id uuid, p_project_id uuid, p_actor_id uuid
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_operation app_private.project_deletion_operations;
  v_project_exists boolean;
  v_refusal text;
  v_remaining jsonb;
  v_deleted integer;
BEGIN
  IF p_operation_id IS NULL OR p_project_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Invalid project deletion scope.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-account-write:' || p_actor_id::text, 0));
  IF NOT app_private.account_deletion_actor_is_active(p_actor_id) THEN
    RETURN jsonb_build_object('outcome', 'forbidden');
  END IF;

  PERFORM 1 FROM public.projects AS project WHERE project.id = p_project_id FOR UPDATE;
  v_project_exists := FOUND;

  SELECT * INTO v_operation
  FROM app_private.project_deletion_operations AS operation
  WHERE operation.id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND OR v_operation.project_id <> p_project_id THEN
    RETURN jsonb_build_object('outcome', 'operation_mismatch');
  END IF;

  IF v_operation.phase = 'completed' THEN
    -- The project row is gone, so only the actor who completed it may read
    -- the receipt back.
    IF v_operation.actor_id <> p_actor_id THEN
      RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'completed',
      'operationId', v_operation.id,
      'projectId', v_operation.project_id,
      'phase', 'completed',
      'replayed', true
    );
  END IF;

  IF NOT v_project_exists THEN
    RETURN jsonb_build_object('outcome', 'project_not_found');
  END IF;

  v_refusal := app_private.project_deletion_refusal(p_project_id, p_actor_id);
  IF v_refusal IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', v_refusal);
  END IF;

  -- Never delete past an uncertain provider create/update, even after its
  -- lease expires. A never-planned create with no live lease cannot write.
  -- Removing receipts remain durable cleanup authority after project deletion.
  IF EXISTS (
    SELECT 1 FROM app_private.personal_calendar_sync_receipts AS receipt
    WHERE receipt.project_id = p_project_id AND (
      receipt.lease_until > clock_timestamp()
      OR receipt.phase = 'updating'
      OR (receipt.phase = 'syncing' AND (
        receipt.legacy_event_id IS NOT NULL OR jsonb_array_length(receipt.events) > 0
      ))
    )
  ) THEN
    RETURN jsonb_build_object('outcome', 'calendar_in_progress');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-project-assets', 0));

  -- A reported removal is not proof. Any object still stored under a claimed
  -- name, the claimed one or a replacement, blocks completion.
  SELECT jsonb_agg(
    jsonb_build_object(
      'bucket', asset.bucket_id,
      'name', asset.object_name,
      'objectId', asset.object_id,
      'replaced', stored.id IS DISTINCT FROM asset.object_id
    )
    ORDER BY asset.bucket_id, asset.object_name
  )
  INTO v_remaining
  FROM app_private.project_asset_objects AS asset
  JOIN storage.objects AS stored
    ON stored.bucket_id = asset.bucket_id AND stored.name = asset.object_name
  WHERE asset.claim_operation_id = v_operation.id;

  IF v_remaining IS NOT NULL THEN
    RETURN jsonb_build_object(
      'outcome', 'objects_remaining',
      'operationId', v_operation.id,
      'projectId', p_project_id,
      'phase', 'pending',
      'objects', v_remaining
    );
  END IF;

  UPDATE app_private.project_asset_objects AS asset
  SET state = 'deleted', deleted_at = coalesce(asset.deleted_at, now())
  WHERE asset.claim_operation_id = v_operation.id AND asset.state = 'claimed';

  DELETE FROM public.projects AS project WHERE project.id = p_project_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'Project deletion did not remove exactly one project.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE app_private.project_deletion_operations AS operation
  SET phase = 'completed', completed_at = now(), updated_at = now(), actor_id = p_actor_id
  WHERE operation.id = v_operation.id;

  RETURN jsonb_build_object(
    'outcome', 'completed',
    'operationId', v_operation.id,
    'projectId', p_project_id,
    'phase', 'completed',
    'replayed', false,
    'deletedObjectIds', coalesce((
      SELECT jsonb_agg(asset.object_id ORDER BY asset.bucket_id, asset.object_name)
      FROM app_private.project_asset_objects AS asset
      WHERE asset.claim_operation_id = v_operation.id
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_project_deletion(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_project_deletion(uuid, uuid, uuid) TO service_role;

COMMIT;
