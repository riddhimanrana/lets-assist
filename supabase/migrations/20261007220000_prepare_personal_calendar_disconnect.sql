BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

-- Preserve local cleanup coordinates without requesting event removal.
CREATE FUNCTION public.prepare_personal_calendar_disconnect(
  p_actor_user_id uuid, p_connection_id uuid, p_expected_updated_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET lock_timeout = '2s' AS $$
DECLARE
  v_preferences jsonb;
  v_updated_at timestamptz;
  v_destination text;
  v_sources jsonb;
  v_count integer;
  v_prepared integer := 0;
BEGIN
  IF p_actor_user_id IS NULL OR p_connection_id IS NULL OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'Actor and connection are required' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'lets-assist-account-write:' || p_actor_user_id::text, 0));
  IF NOT app_private.account_deletion_actor_is_active(p_actor_user_id) THEN
    RAISE EXCEPTION 'Account unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT c.preferences,c.updated_at INTO v_preferences,v_updated_at
    FROM public.user_calendar_connections c
    JOIN public.user_google_oauth_connection_bindings b
      ON b.connection_id=c.id AND b.user_id=c.user_id AND b.provider=c.provider
    WHERE c.id=p_connection_id AND c.user_id=p_actor_user_id AND c.provider='google'
      AND b.purpose='personal_calendar' AND b.organization_id IS NULL AND b.plugin_key IS NULL
    FOR UPDATE OF c,b;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Personal connection unavailable' USING ERRCODE = '42501';
  END IF;

  IF v_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Personal connection changed' USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO v_count FROM (
    SELECT 1 FROM (
      SELECT id FROM public.projects WHERE creator_id=p_actor_user_id
      UNION ALL
      SELECT id FROM public.project_signups WHERE user_id=p_actor_user_id
      UNION ALL
      SELECT source_id FROM app_private.personal_calendar_sync_receipts
        WHERE user_id=p_actor_user_id AND phase<>'removed'
    ) candidates LIMIT 5001
  ) bounded;
  IF v_count>5000 THEN
    RAISE EXCEPTION 'Calendar source scan exceeds the disconnect limit' USING ERRCODE = '54000';
  END IF;
  -- Lock even currently unsynced sources so service/staff marker edits cannot
  -- enter the metadata snapshot while preparation is in progress.
  PERFORM 1 FROM public.projects WHERE creator_id=p_actor_user_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.project_signups WHERE user_id=p_actor_user_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM app_private.personal_calendar_sync_receipts
    WHERE user_id=p_actor_user_id AND phase<>'removed' ORDER BY source_kind,source_id FOR UPDATE;
  SELECT count(*) INTO v_count FROM (
    SELECT * FROM (
      SELECT 'project'::text AS kind,id AS source_id FROM public.projects
        WHERE creator_id=p_actor_user_id AND creator_calendar_event_id IS NOT NULL
      UNION
      SELECT 'signup',id FROM public.project_signups
        WHERE user_id=p_actor_user_id AND volunteer_calendar_event_id IS NOT NULL
      UNION
      SELECT source_kind,source_id FROM app_private.personal_calendar_sync_receipts
        WHERE user_id=p_actor_user_id AND phase<>'removed'
    ) identities LIMIT 2001
  ) bounded;
  IF v_count>2000 THEN
    RAISE EXCEPTION 'Calendar metadata exceeds the disconnect limit' USING ERRCODE = '54000';
  END IF;
  WITH live AS (
    SELECT 'project'::text AS kind,id AS source_id,id AS project_id,
      creator_calendar_event_id AS event_id,NULL::text AS schedule_id
    FROM public.projects WHERE creator_id=p_actor_user_id AND creator_calendar_event_id IS NOT NULL
    UNION ALL
    SELECT 'signup',id,project_id,volunteer_calendar_event_id,schedule_id
    FROM public.project_signups WHERE user_id=p_actor_user_id AND volunteer_calendar_event_id IS NOT NULL
  ), sources AS (
    SELECT * FROM live
    UNION ALL
    SELECT r.source_kind,r.source_id,r.project_id,coalesce(r.events->0->>'id',r.legacy_event_id),r.requested_schedule_id
    FROM app_private.personal_calendar_sync_receipts r
    WHERE r.user_id=p_actor_user_id AND r.phase<>'removed'
      AND coalesce(r.events->0->>'id',r.legacy_event_id) IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM live l WHERE l.kind=r.source_kind AND l.source_id=r.source_id)
  ) SELECT coalesce(jsonb_agg(to_jsonb(bounded)),'[]'::jsonb) INTO v_sources
    FROM (SELECT * FROM sources LIMIT 2001) bounded;
  IF jsonb_array_length(v_sources)>2000 THEN
    RAISE EXCEPTION 'Calendar metadata exceeds the disconnect limit' USING ERRCODE = '54000';
  END IF;

  IF EXISTS (SELECT 1 FROM app_private.personal_calendar_sync_receipts
    WHERE user_id=p_actor_user_id AND phase<>'removed' AND lease_until>clock_timestamp()) THEN
    RAISE EXCEPTION 'Calendar operation in progress' USING ERRCODE = '55P03';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_sources) s(kind text,source_id uuid,project_id uuid,event_id text,schedule_id text)
    LEFT JOIN app_private.personal_calendar_sync_receipts r ON r.source_kind=s.kind AND r.source_id=s.source_id
    WHERE s.event_id IS NULL OR length(s.event_id) NOT BETWEEN 5 AND 1024 OR s.event_id !~ '^[A-Za-z0-9_-]+$'
      OR (r.source_id IS NOT NULL AND (r.user_id<>p_actor_user_id OR r.project_id<>s.project_id OR r.phase='removed'
        OR coalesce(r.events->0->>'id',r.legacy_event_id) IS DISTINCT FROM s.event_id
        OR (r.calendar_id IS NULL AND (jsonb_array_length(r.events)>0 OR r.legacy_event_id IS DISTINCT FROM s.event_id OR cardinality(r.confirmed_event_ids)>0))
        OR (r.calendar_id IS NOT NULL AND (length(r.calendar_id) NOT BETWEEN 1 AND 1024 OR r.calendar_id !~ '^[A-Za-z0-9_.@#-]+$'
          OR r.calendar_id IN ('.','..','primary') OR jsonb_array_length(r.events)=0))))) THEN
    RAISE EXCEPTION 'Calendar metadata is inconsistent' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_sources) s(kind text,source_id uuid)
    LEFT JOIN app_private.personal_calendar_sync_receipts r ON r.source_kind=s.kind AND r.source_id=s.source_id
    WHERE r.calendar_id IS NULL
  ) THEN
    v_destination := v_preferences->>'volunteering_calendar_id';
    IF v_destination IS NULL OR length(v_destination) NOT BETWEEN 1 AND 1024
      OR v_destination !~ '^[A-Za-z0-9_.@#-]+$' OR v_destination IN ('.','..','primary') THEN
      RAISE EXCEPTION 'Legacy calendar destination is unavailable' USING ERRCODE = '55000';
    END IF;
  END IF;

  IF EXISTS (
    WITH coordinates AS (
      SELECT coalesce(r.calendar_id,v_destination) AS calendar_id,entry->>'id' AS event_id
      FROM jsonb_to_recordset(v_sources) s(kind text,source_id uuid,event_id text)
      LEFT JOIN app_private.personal_calendar_sync_receipts r ON r.source_kind=s.kind AND r.source_id=s.source_id
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN coalesce(jsonb_array_length(r.events),0)>0
        THEN r.events ELSE jsonb_build_array(jsonb_build_object('id',s.event_id)) END) entry
    ) SELECT 1 FROM coordinates
      GROUP BY calendar_id,event_id HAVING count(*)>1 OR event_id IS NULL
        OR length(event_id) NOT BETWEEN 5 AND 1024 OR event_id !~ '^[A-Za-z0-9_-]+$'
  ) THEN
    RAISE EXCEPTION 'Calendar event ownership is ambiguous' USING ERRCODE = '55000';
  END IF;

  INSERT INTO app_private.personal_calendar_sync_receipts(
    source_kind,source_id,user_id,project_id,phase,requested_schedule_id,legacy_event_id,calendar_id,events
  ) SELECT s.kind,s.source_id,p_actor_user_id,s.project_id,'synced',s.schedule_id,s.event_id,v_destination,
      jsonb_build_array(jsonb_build_object('id',s.event_id,'event',NULL))
    FROM jsonb_to_recordset(v_sources) s(kind text,source_id uuid,project_id uuid,event_id text,schedule_id text)
    WHERE NOT EXISTS (SELECT 1 FROM app_private.personal_calendar_sync_receipts r WHERE r.source_kind=s.kind AND r.source_id=s.source_id);
  GET DIAGNOSTICS v_prepared = ROW_COUNT;
  UPDATE app_private.personal_calendar_sync_receipts r
    SET calendar_id=v_destination,events=jsonb_build_array(jsonb_build_object('id',r.legacy_event_id,'event',NULL)),updated_at=clock_timestamp()
    FROM jsonb_to_recordset(v_sources) s(kind text,source_id uuid)
    WHERE r.source_kind=s.kind AND r.source_id=s.source_id AND r.user_id=p_actor_user_id AND r.calendar_id IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('user_id',p_actor_user_id,'connection_id',p_connection_id,'connection_updated_at',v_updated_at,'prepared_count',v_prepared+v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_personal_calendar_disconnect(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_personal_calendar_disconnect(uuid,uuid,timestamptz) TO service_role;
COMMENT ON FUNCTION public.prepare_personal_calendar_disconnect(uuid,uuid,timestamptz) IS
  'Atomically retains at most 2000 actor-owned calendar cleanup plans before disconnect. Preserves provider event IDs, existing phases and confirmations; refuses active leases and ambiguous ownership. No provider operation or credential mutation.';
COMMIT;
