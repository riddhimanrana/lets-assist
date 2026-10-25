-- Persist the full provider plan before creating any personal calendar event.
BEGIN;
CREATE TABLE app_private.personal_calendar_sync_receipts (
  source_kind text NOT NULL CHECK (source_kind IN ('project', 'signup')),
  source_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  generation uuid NOT NULL DEFAULT gen_random_uuid(),
  phase text NOT NULL CHECK (phase IN ('syncing', 'synced', 'removing', 'removed')),
  requested_schedule_id text,
  legacy_event_id text,
  calendar_id text,
  events jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(events) = 'array' AND jsonb_array_length(events) <= 500),
  confirmed_event_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  claim_token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_kind, source_id)
);
CREATE INDEX personal_calendar_sync_receipts_user_idx ON app_private.personal_calendar_sync_receipts(user_id);
ALTER TABLE app_private.personal_calendar_sync_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.personal_calendar_sync_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.personal_calendar_sync_receipts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.personal_calendar_sync_receipts TO service_role;

CREATE FUNCTION public.claim_personal_calendar_sync(
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
  ELSE
    IF v_receipt.phase = 'removed' THEN RETURN to_jsonb(v_receipt); END IF;
    IF v_receipt.phase <> 'removing' THEN
      UPDATE app_private.personal_calendar_sync_receipts SET phase = 'removing', confirmed_event_ids = ARRAY[]::text[]
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

CREATE FUNCTION public.advance_personal_calendar_sync(
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
BEGIN
  -- Take the account fence before source/receipt locks, matching account deletion.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lets-assist-account-write:' || p_actor_user_id::text, 0));
  SELECT * INTO v_receipt FROM app_private.personal_calendar_sync_receipts
    WHERE source_kind = p_source_kind AND source_id = p_source_id AND user_id = p_actor_user_id FOR UPDATE;
  IF NOT FOUND OR p_claim_token IS NULL OR v_receipt.claim_token IS DISTINCT FROM p_claim_token
    OR v_receipt.lease_until IS NULL OR v_receipt.lease_until <= clock_timestamp()
    OR v_receipt.phase NOT IN ('syncing', 'removing') THEN
    RAISE EXCEPTION 'Calendar claim expired' USING ERRCODE = '55000';
  END IF;
  IF v_receipt.phase = 'syncing' AND NOT app_private.account_deletion_actor_is_active(p_actor_user_id) THEN
    RAISE EXCEPTION 'Account unavailable' USING ERRCODE = '42501';
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

-- Reuse the existing personal calendar destination ledger for platform events.
CREATE FUNCTION public.csf_begin_personal_calendar_destination_provision(
  p_user_id uuid, p_connection_id uuid, p_request_id uuid,
  p_replace_calendar_id text DEFAULT NULL, p_allow_create boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lets-assist-account-write:' || p_user_id::text, 0));
  IF NOT app_private.account_deletion_actor_is_active(p_user_id) THEN
    RAISE EXCEPTION 'Account unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN plugin_data.csf_begin_personal_calendar_destination_provision(p_user_id,p_connection_id,p_request_id,p_replace_calendar_id,p_allow_create);
END;
$$;
REVOKE ALL ON FUNCTION public.csf_begin_personal_calendar_destination_provision(uuid,uuid,uuid,text,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.csf_begin_personal_calendar_destination_provision(uuid,uuid,uuid,text,boolean) TO service_role;

CREATE FUNCTION public.csf_complete_personal_calendar_destination_provision(
  p_operation_id uuid, p_user_id uuid, p_outcome text, p_calendar_id text, p_outcome_code text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- Completing an existing provider receipt remains possible during cleanup.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lets-assist-account-write:' || p_user_id::text, 0));
  RETURN plugin_data.csf_complete_personal_calendar_destination_provision(p_operation_id,p_user_id,p_outcome,p_calendar_id,p_outcome_code);
END;
$$;
REVOKE ALL ON FUNCTION public.csf_complete_personal_calendar_destination_provision(uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.csf_complete_personal_calendar_destination_provision(uuid,uuid,text,text,text) TO service_role;

CREATE FUNCTION public.adopt_verified_personal_calendar_destination(p_user_id uuid, p_connection_id uuid, p_calendar_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lets-assist-account-write:' || p_user_id::text, 0));
  IF NOT app_private.account_deletion_actor_is_active(p_user_id) THEN
    RAISE EXCEPTION 'Account unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_calendar_id IS NULL OR length(p_calendar_id) NOT BETWEEN 1 AND 1024
    OR p_calendar_id !~ '^[A-Za-z0-9_.@#-]+$' OR p_calendar_id IN ('.','..','primary') THEN
    RAISE EXCEPTION 'Invalid destination identity' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.user_calendar_connections c
    JOIN public.user_google_oauth_connection_bindings b ON b.connection_id=c.id AND b.user_id=c.user_id AND b.provider=c.provider
    WHERE c.id=p_connection_id AND c.user_id=p_user_id AND c.provider='google' AND c.is_active
      AND c.preferences->>'volunteering_calendar_id'=p_calendar_id
      AND b.purpose='personal_calendar' AND b.organization_id IS NULL AND b.plugin_key IS NULL FOR SHARE OF c,b;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Calendar connection changed' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('plugin_data.csf_personal_calendar_destination:' || p_user_id::text, 0));
  INSERT INTO plugin_data.csf_personal_calendar_destinations(user_id,connection_id,state,calendar_id,provider_confirmed_at)
    VALUES (p_user_id,p_connection_id,'ready',p_calendar_id,clock_timestamp()) ON CONFLICT(user_id) DO NOTHING;
  RETURN EXISTS(SELECT 1 FROM plugin_data.csf_personal_calendar_destinations
    WHERE user_id=p_user_id AND state='ready' AND calendar_id=p_calendar_id);
END;
$$;
REVOKE ALL ON FUNCTION public.adopt_verified_personal_calendar_destination(uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.adopt_verified_personal_calendar_destination(uuid,uuid,text) TO service_role;
COMMENT ON FUNCTION public.adopt_verified_personal_calendar_destination(uuid,uuid,text) IS
  'Server-only adoption after Google calendars.get and calendarList.get confirm the exact non-primary calendar is live and owned. Refuses changed connection preferences and never overwrites authoritative destination state.';

CREATE FUNCTION public.list_personal_calendar_cleanup(p_actor_user_id uuid)
RETURNS TABLE(source_kind text,source_id uuid,event_id text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
 SELECT r.source_kind,r.source_id,coalesce(r.events->0->>'id',r.legacy_event_id)
 FROM app_private.personal_calendar_sync_receipts r
 WHERE r.user_id=p_actor_user_id AND r.phase<>'removed'
   AND coalesce(r.events->0->>'id',r.legacy_event_id) IS NOT NULL
   AND ((r.source_kind='project' AND NOT EXISTS(SELECT 1 FROM public.projects p WHERE p.id=r.source_id AND p.creator_id=p_actor_user_id AND p.creator_calendar_event_id=coalesce(r.events->0->>'id',r.legacy_event_id)))
     OR (r.source_kind='signup' AND NOT EXISTS(SELECT 1 FROM public.project_signups s WHERE s.id=r.source_id AND s.user_id=p_actor_user_id AND s.volunteer_calendar_event_id=coalesce(r.events->0->>'id',r.legacy_event_id))))
 ORDER BY r.created_at,r.source_kind,r.source_id LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.list_personal_calendar_cleanup(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_personal_calendar_cleanup(uuid) TO service_role;
COMMIT;
