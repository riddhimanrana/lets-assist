-- Update synced personal calendar events in place under the existing receipt, generation, calendar and event IDs.
BEGIN;
ALTER TABLE app_private.personal_calendar_sync_receipts
  DROP CONSTRAINT personal_calendar_sync_receipts_phase_check,
  ADD CONSTRAINT personal_calendar_sync_receipts_phase_check
    CHECK (phase IN ('syncing', 'synced', 'updating', 'removing', 'removed')),
  ADD COLUMN update_source jsonb,
  ADD COLUMN update_planned_at timestamptz,
  ADD COLUMN update_connection_id uuid,
  ADD COLUMN update_connection_revision text,
  ADD CONSTRAINT personal_calendar_sync_receipts_update_state_check CHECK (
    (phase = 'updating' AND source_kind = 'project' AND update_source IS NOT NULL
      AND ((update_planned_at IS NULL) = (update_connection_id IS NULL))
      AND ((update_planned_at IS NULL) = (update_connection_revision IS NULL)))
    OR (phase <> 'updating' AND update_source IS NULL AND update_planned_at IS NULL
      AND update_connection_id IS NULL AND update_connection_revision IS NULL)
  );

-- The one projection of project fields that a calendar event is rendered from.
CREATE FUNCTION app_private.personal_calendar_project_source(p_project_id uuid, p_creator_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'creator_id', p.creator_id, 'title', p.title, 'description', p.description,
    'location', p.location, 'event_type', p.event_type, 'schedule', p.schedule,
    'project_timezone', p.project_timezone, 'status', p.status, 'workflow_status', p.workflow_status)
  FROM public.projects p WHERE p.id = p_project_id AND p.creator_id = p_creator_id;
$$;
REVOKE ALL ON FUNCTION app_private.personal_calendar_project_source(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.personal_calendar_project_source(uuid,uuid) TO service_role;

-- A nonsecret fingerprint of the active personal binding. The same connection ID can be
-- reauthorized as another Google account, so the row revision and identity are part of it.
-- NULL means the connection is not this user's active personal calendar binding.
CREATE FUNCTION app_private.personal_calendar_connection_revision(p_user_id uuid, p_connection_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
      c.id, (extract(epoch FROM c.updated_at) * 1000000)::bigint, c.calendar_email,
      (extract(epoch FROM c.connected_at) * 1000000)::bigint, b.identity_email,
      (extract(epoch FROM b.identity_verified_at) * 1000000)::bigint)::text, 'UTF8')), 'hex')
    FROM public.user_calendar_connections c
    JOIN public.user_google_oauth_connection_bindings b ON b.connection_id=c.id AND b.user_id=c.user_id AND b.provider=c.provider
    WHERE c.id=p_connection_id AND c.user_id=p_user_id AND c.provider='google' AND c.is_active
      AND b.purpose='personal_calendar' AND b.organization_id IS NULL AND b.plugin_key IS NULL;
$$;
REVOKE ALL ON FUNCTION app_private.personal_calendar_connection_revision(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.personal_calendar_connection_revision(uuid,uuid) TO service_role;

-- Targeted lookup of the actor's own unresolved receipt, for cleanup after the source row is gone.
CREATE FUNCTION public.find_personal_calendar_receipt_event(p_actor_user_id uuid, p_source_kind text, p_source_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT coalesce(r.events->0->>'id', r.legacy_event_id)
    FROM app_private.personal_calendar_sync_receipts r
    WHERE r.source_kind = p_source_kind AND r.source_id = p_source_id
      AND r.user_id = p_actor_user_id AND r.phase <> 'removed';
$$;
REVOKE ALL ON FUNCTION public.find_personal_calendar_receipt_event(uuid,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_personal_calendar_receipt_event(uuid,text,uuid) TO service_role;

CREATE FUNCTION public.claim_personal_calendar_update(
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
COMMENT ON FUNCTION public.claim_personal_calendar_update(uuid,uuid,jsonb) IS
  'Server-only lease for updating an already synced creator calendar entry in place. Compares the trusted service read with the locked project, freezes that source, and keeps the generation, calendar and event IDs. Returns NULL when nothing was synced.';

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

CREATE OR REPLACE FUNCTION public.advance_personal_calendar_sync(
  p_actor_user_id uuid,
  p_source_kind text,
  p_source_id uuid,
  p_claim_token uuid,
  p_step text,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_receipt app_private.personal_calendar_sync_receipts%ROWTYPE;
  v_event_id text;
  v_first_id text;
  v_calendar_id text;
  v_connection_id uuid;
  v_connection_revision text;
  v_marker text;
  v_expected_ids text[];
BEGIN
  -- Take the account fence before source/receipt locks, matching account deletion.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lets-assist-account-write:' || p_actor_user_id::text, 0));
  SELECT * INTO v_receipt FROM app_private.personal_calendar_sync_receipts
    WHERE source_kind = p_source_kind AND source_id = p_source_id AND user_id = p_actor_user_id FOR UPDATE;
  IF NOT FOUND OR p_claim_token IS NULL OR v_receipt.claim_token IS DISTINCT FROM p_claim_token
    OR v_receipt.lease_until IS NULL OR v_receipt.lease_until <= clock_timestamp()
    OR v_receipt.phase NOT IN ('syncing', 'updating', 'removing') THEN
    RAISE EXCEPTION 'Calendar claim expired' USING ERRCODE = '55000';
  END IF;
  IF v_receipt.phase IN ('syncing', 'updating') AND NOT app_private.account_deletion_actor_is_active(p_actor_user_id) THEN
    RAISE EXCEPTION 'Account unavailable' USING ERRCODE = '42501';
  END IF;

  IF v_receipt.phase = 'updating' THEN
    IF p_step = 'release' THEN
      UPDATE app_private.personal_calendar_sync_receipts SET claim_token = NULL, lease_until = NULL, updated_at = clock_timestamp()
        WHERE source_kind = p_source_kind AND source_id = p_source_id RETURNING * INTO v_receipt;
      RETURN to_jsonb(v_receipt);
    END IF;
    IF p_step IS NULL OR p_step NOT IN ('plan', 'renew', 'confirm', 'finish') THEN
      RAISE EXCEPTION 'Invalid calendar step' USING ERRCODE = '22023';
    END IF;
    -- Every step that can lead to a provider write or an acknowledgement requires the exact frozen source.
    SELECT creator_calendar_event_id INTO v_marker FROM public.projects
      WHERE id = p_source_id AND creator_id = p_actor_user_id FOR UPDATE;
    IF NOT FOUND OR app_private.personal_calendar_project_source(p_source_id, p_actor_user_id) IS DISTINCT FROM v_receipt.update_source THEN
      RAISE EXCEPTION 'Calendar source changed' USING ERRCODE = '55000', HINT = 'calendar_source_changed';
    END IF;
    -- The project must still anchor this receipt's first saved event before anything is written.
    IF v_marker IS NULL OR v_marker IS DISTINCT FROM coalesce(v_receipt.events->0->>'id', v_receipt.legacy_event_id) THEN
      RAISE EXCEPTION 'Calendar event changed' USING ERRCODE = '55000', HINT = 'calendar_event_changed';
    END IF;
    IF p_step = 'plan' THEN
      v_calendar_id := p_payload->>'calendar_id';
      IF v_receipt.update_planned_at IS NOT NULL OR jsonb_typeof(p_payload->'events') IS DISTINCT FROM 'array'
        OR pg_column_size(p_payload) > 2097152
        OR v_calendar_id IS NULL OR length(v_calendar_id) NOT BETWEEN 1 AND 1024 OR v_calendar_id !~ '^[A-Za-z0-9_.@#-]+$'
        OR v_calendar_id IN ('.', '..', 'primary')
        OR (v_receipt.calendar_id IS NOT NULL AND v_calendar_id IS DISTINCT FROM v_receipt.calendar_id)
        OR p_payload->>'connection_id' IS NULL
        OR p_payload->>'connection_id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        RAISE EXCEPTION 'Invalid calendar plan' USING ERRCODE = '22023';
      END IF;
      v_connection_id := (p_payload->>'connection_id')::uuid;
      v_connection_revision := app_private.personal_calendar_connection_revision(p_actor_user_id, v_connection_id);
      -- The service names the row revision its credential was read at; a later rebind of the same ID is refused.
      IF v_connection_revision IS NULL OR (p_payload->>'connection_updated_at' IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.user_calendar_connections c
        WHERE c.id = v_connection_id AND c.user_id = p_actor_user_id
          AND c.updated_at = (p_payload->>'connection_updated_at')::timestamptz
      )) THEN
        RAISE EXCEPTION 'Calendar connection changed' USING ERRCODE = '42501', HINT = 'calendar_connection_changed';
      END IF;
      -- A legacy marker may adopt only the destination stored on the pinned connection.
      IF v_receipt.calendar_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM public.user_calendar_connections c
        WHERE c.id = v_connection_id AND c.user_id = p_actor_user_id AND c.preferences->>'volunteering_calendar_id' = v_calendar_id
      ) THEN
        RAISE EXCEPTION 'Calendar connection changed' USING ERRCODE = '42501', HINT = 'calendar_connection_changed';
      END IF;
      v_expected_ids := CASE
        WHEN jsonb_array_length(v_receipt.events) > 0 THEN
          ARRAY(SELECT e->>'id' FROM jsonb_array_elements(v_receipt.events) WITH ORDINALITY AS planned(e, n) ORDER BY n)
        WHEN v_receipt.legacy_event_id IS NOT NULL THEN ARRAY[v_receipt.legacy_event_id]
        ELSE ARRAY[]::text[] END;
      IF cardinality(v_expected_ids) = 0 THEN
        RAISE EXCEPTION 'Calendar event changed' USING ERRCODE = '55000', HINT = 'calendar_event_changed';
      END IF;
      IF jsonb_array_length(p_payload->'events') <> cardinality(v_expected_ids) THEN
        RAISE EXCEPTION 'Calendar occurrence count changed' USING ERRCODE = '55000', HINT = 'calendar_occurrence_count_changed';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'events') WITH ORDINALITY AS replacement(e, n)
        WHERE jsonb_typeof(e) IS DISTINCT FROM 'object' OR jsonb_typeof(e->'event') IS DISTINCT FROM 'object'
          OR e->>'id' IS DISTINCT FROM v_expected_ids[n::integer]) THEN
        RAISE EXCEPTION 'Invalid calendar events' USING ERRCODE = '22023';
      END IF;
      UPDATE app_private.personal_calendar_sync_receipts SET calendar_id = v_calendar_id, events = p_payload->'events',
        update_planned_at = clock_timestamp(), update_connection_id = v_connection_id,
        update_connection_revision = v_connection_revision, confirmed_event_ids = ARRAY[]::text[]
        WHERE source_kind = p_source_kind AND source_id = p_source_id RETURNING * INTO v_receipt;
    ELSE
      IF p_step <> 'renew' AND v_receipt.update_planned_at IS NULL THEN
        RAISE EXCEPTION 'Calendar events remain unconfirmed' USING ERRCODE = '55000';
      END IF;
      -- A disconnected, rebound or reauthorized account can neither write nor acknowledge this plan.
      IF v_receipt.update_connection_id IS NOT NULL
        AND app_private.personal_calendar_connection_revision(p_actor_user_id, v_receipt.update_connection_id)
          IS DISTINCT FROM v_receipt.update_connection_revision THEN
        RAISE EXCEPTION 'Calendar connection changed' USING ERRCODE = '42501', HINT = 'calendar_connection_changed';
      END IF;
      IF p_step = 'confirm' THEN
        v_event_id := p_payload->>'event_id';
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_receipt.events) e WHERE e->>'id' = v_event_id) THEN
          RAISE EXCEPTION 'Event is outside the calendar plan' USING ERRCODE = '22023';
        END IF;
        UPDATE app_private.personal_calendar_sync_receipts SET confirmed_event_ids =
          CASE WHEN v_event_id = ANY(confirmed_event_ids) THEN confirmed_event_ids ELSE array_append(confirmed_event_ids, v_event_id) END
          WHERE source_kind = p_source_kind AND source_id = p_source_id RETURNING * INTO v_receipt;
      ELSIF p_step = 'finish' THEN
        IF jsonb_array_length(v_receipt.events) = 0
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_receipt.events) e WHERE NOT (e->>'id' = ANY(v_receipt.confirmed_event_ids))) THEN
          RAISE EXCEPTION 'Calendar events remain unconfirmed' USING ERRCODE = '55000';
        END IF;
        v_first_id := v_receipt.events->0->>'id';
        UPDATE public.projects SET creator_synced_at = clock_timestamp()
          WHERE id = p_source_id AND creator_id = p_actor_user_id AND creator_calendar_event_id IS NOT DISTINCT FROM v_first_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Calendar source changed' USING ERRCODE = '55000', HINT = 'calendar_source_changed';
        END IF;
        UPDATE app_private.personal_calendar_sync_receipts SET phase = 'synced', update_source = NULL,
          update_planned_at = NULL, update_connection_id = NULL, update_connection_revision = NULL,
          claim_token = NULL, lease_until = NULL, updated_at = clock_timestamp()
          WHERE source_kind = p_source_kind AND source_id = p_source_id RETURNING * INTO v_receipt;
        RETURN to_jsonb(v_receipt);
      END IF;
    END IF;
    UPDATE app_private.personal_calendar_sync_receipts SET lease_until = clock_timestamp() + interval '90 seconds', updated_at = clock_timestamp()
      WHERE source_kind = p_source_kind AND source_id = p_source_id RETURNING * INTO v_receipt;
    RETURN to_jsonb(v_receipt);
  END IF;

  IF v_receipt.phase = 'syncing' AND p_step IS DISTINCT FROM 'release' AND NOT (
    (p_source_kind = 'project' AND EXISTS (SELECT 1 FROM public.projects WHERE id = p_source_id AND creator_id = p_actor_user_id))
    OR (p_source_kind = 'signup' AND EXISTS (SELECT 1 FROM public.project_signups WHERE id = p_source_id AND user_id = p_actor_user_id
      AND project_id = v_receipt.project_id AND schedule_id IS NOT DISTINCT FROM v_receipt.requested_schedule_id))
  ) THEN
    RAISE EXCEPTION 'Calendar source changed' USING ERRCODE = '55000';
  END IF;
  IF p_step = 'plan' THEN
    IF v_receipt.calendar_id IS NOT NULL OR jsonb_array_length(v_receipt.events) > 0
      OR p_payload->>'calendar_id' IS NULL OR length(p_payload->>'calendar_id') NOT BETWEEN 1 AND 1024 OR p_payload->>'calendar_id' !~ '^[A-Za-z0-9_.@#-]+$'
      OR p_payload->>'calendar_id' IN ('.', '..')
      OR jsonb_typeof(p_payload->'events') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid calendar plan' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_payload->'events') NOT BETWEEN 1 AND 500 OR pg_column_size(p_payload) > 2097152
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'events') e WHERE
        jsonb_typeof(e) IS DISTINCT FROM 'object' OR e->>'id' IS NULL OR length(e->>'id') NOT BETWEEN 5 AND 1024 OR e->>'id' !~ '^[A-Za-z0-9_-]+$'
        OR (v_receipt.phase = 'syncing' AND jsonb_typeof(e->'event') IS DISTINCT FROM 'object'))
      OR (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(p_payload->'events') e) <> jsonb_array_length(p_payload->'events')
      OR (v_receipt.phase = 'removing' AND (jsonb_array_length(p_payload->'events') <> 1
        OR (p_payload->'events'->0->>'id') IS DISTINCT FROM v_receipt.legacy_event_id)) THEN
      RAISE EXCEPTION 'Invalid calendar events' USING ERRCODE = '22023';
    END IF;
    UPDATE app_private.personal_calendar_sync_receipts SET calendar_id = p_payload->>'calendar_id', events = p_payload->'events'
      WHERE source_kind = p_source_kind AND source_id = p_source_id RETURNING * INTO v_receipt;
    IF v_receipt.phase = 'syncing' THEN
      IF p_source_kind = 'project' THEN
        UPDATE public.projects SET creator_calendar_event_id = v_receipt.events->0->>'id', creator_synced_at = NULL
          WHERE id = p_source_id AND creator_id = p_actor_user_id AND creator_calendar_event_id IS NULL;
      ELSE
        UPDATE public.project_signups SET volunteer_calendar_event_id = v_receipt.events->0->>'id', volunteer_synced_at = NULL
          WHERE id = p_source_id AND user_id = p_actor_user_id AND project_id = v_receipt.project_id
            AND schedule_id IS NOT DISTINCT FROM v_receipt.requested_schedule_id AND volunteer_calendar_event_id IS NULL;
      END IF;
      IF NOT FOUND THEN RAISE EXCEPTION 'Calendar source changed' USING ERRCODE = '55000'; END IF;
    END IF;
  ELSIF p_step = 'confirm' THEN
    v_event_id := p_payload->>'event_id';
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_receipt.events) e WHERE e->>'id' = v_event_id) THEN
      RAISE EXCEPTION 'Event is outside the calendar plan' USING ERRCODE = '22023';
    END IF;
    UPDATE app_private.personal_calendar_sync_receipts SET confirmed_event_ids =
      CASE WHEN v_event_id = ANY(confirmed_event_ids) THEN confirmed_event_ids ELSE array_append(confirmed_event_ids, v_event_id) END
      WHERE source_kind = p_source_kind AND source_id = p_source_id RETURNING * INTO v_receipt;
  ELSIF p_step = 'finish' THEN
    IF (v_receipt.phase = 'syncing' AND jsonb_array_length(v_receipt.events) = 0)
      OR (v_receipt.legacy_event_id IS NOT NULL AND jsonb_array_length(v_receipt.events) = 0)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_receipt.events) e WHERE NOT (e->>'id' = ANY(v_receipt.confirmed_event_ids))) THEN
      RAISE EXCEPTION 'Calendar events remain unconfirmed' USING ERRCODE = '55000';
    END IF;
    v_first_id := coalesce(v_receipt.events->0->>'id', v_receipt.legacy_event_id);
    IF p_source_kind = 'project' THEN
      UPDATE public.projects SET creator_calendar_event_id = CASE WHEN v_receipt.phase = 'syncing' THEN v_first_id ELSE NULL END,
        creator_synced_at = CASE WHEN v_receipt.phase = 'syncing' THEN clock_timestamp() ELSE NULL END
        WHERE id = p_source_id AND creator_id = p_actor_user_id AND creator_calendar_event_id IS NOT DISTINCT FROM v_first_id;
    ELSE
      UPDATE public.project_signups SET volunteer_calendar_event_id = CASE WHEN v_receipt.phase = 'syncing' THEN v_first_id ELSE NULL END,
        volunteer_synced_at = CASE WHEN v_receipt.phase = 'syncing' THEN clock_timestamp() ELSE NULL END
        WHERE id = p_source_id AND user_id = p_actor_user_id AND volunteer_calendar_event_id IS NOT DISTINCT FROM v_first_id
          AND (v_receipt.phase = 'removing' OR (project_id = v_receipt.project_id AND schedule_id IS NOT DISTINCT FROM v_receipt.requested_schedule_id));
    END IF;
    IF v_receipt.phase = 'syncing' AND NOT FOUND THEN
      RAISE EXCEPTION 'Calendar source changed' USING ERRCODE = '55000';
    END IF;
    UPDATE app_private.personal_calendar_sync_receipts SET phase = CASE WHEN v_receipt.phase = 'syncing' THEN 'synced' ELSE 'removed' END,
      claim_token = NULL, lease_until = NULL, updated_at = clock_timestamp()
      WHERE source_kind = p_source_kind AND source_id = p_source_id RETURNING * INTO v_receipt;
    RETURN to_jsonb(v_receipt);
  ELSIF p_step = 'release' THEN
    UPDATE app_private.personal_calendar_sync_receipts SET claim_token = NULL, lease_until = NULL, updated_at = clock_timestamp()
      WHERE source_kind = p_source_kind AND source_id = p_source_id RETURNING * INTO v_receipt;
    RETURN to_jsonb(v_receipt);
  ELSIF p_step IS DISTINCT FROM 'renew' THEN
    RAISE EXCEPTION 'Invalid calendar step' USING ERRCODE = '22023';
  END IF;
  UPDATE app_private.personal_calendar_sync_receipts SET lease_until = clock_timestamp() + interval '90 seconds', updated_at = clock_timestamp()
    WHERE source_kind = p_source_kind AND source_id = p_source_id RETURNING * INTO v_receipt;
  RETURN to_jsonb(v_receipt);
END;
$$;
REVOKE ALL ON FUNCTION public.advance_personal_calendar_sync(uuid,text,uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.advance_personal_calendar_sync(uuid,text,uuid,uuid,text,jsonb) TO service_role;
COMMIT;
