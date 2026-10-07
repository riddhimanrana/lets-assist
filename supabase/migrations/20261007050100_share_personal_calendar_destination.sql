-- Reuse the existing personal calendar destination ledger for platform events.
BEGIN;
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
