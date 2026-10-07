-- Reserve organization calendar creation before sending a Google request.
BEGIN;
CREATE TABLE app_private.organization_calendar_destinations (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
 owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 connection_id uuid REFERENCES public.user_calendar_connections(id) ON DELETE SET NULL,
 state text NOT NULL CHECK(state IN ('provisioning','ready','unknown_outcome','rejected')),
 calendar_id text,
 previous_calendar_id text,
 operation_id uuid NOT NULL DEFAULT gen_random_uuid(),
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((state='ready' AND calendar_id IS NOT NULL) OR (state<>'ready' AND calendar_id IS NULL))
);
CREATE INDEX organization_calendar_destinations_owner_idx ON app_private.organization_calendar_destinations(owner_user_id);
CREATE INDEX organization_calendar_destinations_connection_idx ON app_private.organization_calendar_destinations(connection_id);
ALTER TABLE app_private.organization_calendar_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.organization_calendar_destinations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.organization_calendar_destinations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON app_private.organization_calendar_destinations TO service_role;

CREATE FUNCTION app_private.authorize_organization_calendar_provider(p_actor uuid,p_organization uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE connection_id uuid;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lets-assist-account-write:'||p_actor::text,0));
 IF NOT app_private.account_deletion_actor_is_active(p_actor) THEN RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lets-assist-org-calendar:'||p_organization::text,0));
 PERFORM 1 FROM public.organization_members WHERE organization_id=p_organization AND user_id=p_actor AND role='admin' AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Organization calendar access denied' USING ERRCODE='42501'; END IF;
 SELECT c.id INTO connection_id FROM public.user_calendar_connections c
 JOIN public.user_google_oauth_connection_bindings b ON b.connection_id=c.id AND b.user_id=c.user_id AND b.provider=c.provider
 WHERE c.user_id=p_actor AND c.provider='google' AND c.is_active AND b.purpose='organization_calendar'
  AND b.organization_id=p_organization AND b.plugin_key IS NULL FOR SHARE OF c,b;
 IF connection_id IS NULL THEN RAISE EXCEPTION 'Organization calendar connection missing' USING ERRCODE='42501'; END IF;
 RETURN connection_id;
END;
$$;
REVOKE ALL ON FUNCTION app_private.authorize_organization_calendar_provider(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.authorize_organization_calendar_provider(uuid,uuid) TO service_role;

CREATE FUNCTION public.claim_organization_calendar_destination(p_actor uuid,p_organization uuid,p_allow_create boolean DEFAULT false,p_replace_calendar_id text DEFAULT NULL,p_verified_calendar_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE connection_id uuid; destination app_private.organization_calendar_destinations; legacy_id text; connection_email text;
BEGIN
 connection_id:=app_private.authorize_organization_calendar_provider(p_actor,p_organization);
 IF p_allow_create IS NULL THEN RAISE EXCEPTION 'Creation intent required' USING ERRCODE='22023'; END IF;
 SELECT * INTO destination FROM app_private.organization_calendar_destinations WHERE organization_id=p_organization FOR UPDATE;
 SELECT calendar_id INTO legacy_id FROM public.organization_calendar_syncs WHERE organization_id=p_organization FOR UPDATE;
 IF destination.state='provisioning' AND destination.started_at<clock_timestamp()-interval '5 minutes' THEN
  UPDATE app_private.organization_calendar_destinations SET state='unknown_outcome',completed_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE organization_id=p_organization RETURNING * INTO destination;
 END IF;
 IF destination.state IN ('provisioning','unknown_outcome') THEN RETURN to_jsonb(destination)||jsonb_build_object('should_create',false,'legacy_id',legacy_id); END IF;
 IF p_verified_calendar_id IS NOT NULL THEN
  IF length(p_verified_calendar_id) NOT BETWEEN 1 AND 1024 OR p_verified_calendar_id !~ '^[A-Za-z0-9_.@#-]+$' OR p_verified_calendar_id IN ('.','..','primary')
   OR p_verified_calendar_id IS DISTINCT FROM coalesce(destination.calendar_id,legacy_id) THEN
   RAISE EXCEPTION 'Calendar ownership proof is stale' USING ERRCODE='55000';
  END IF;
  INSERT INTO app_private.organization_calendar_destinations(organization_id,owner_user_id,connection_id,state,calendar_id,completed_at)
  VALUES(p_organization,p_actor,connection_id,'ready',p_verified_calendar_id,clock_timestamp())
  ON CONFLICT(organization_id) DO UPDATE SET owner_user_id=EXCLUDED.owner_user_id,connection_id=EXCLUDED.connection_id,state='ready',calendar_id=EXCLUDED.calendar_id,completed_at=clock_timestamp(),updated_at=clock_timestamp()
  RETURNING * INTO destination;
  SELECT calendar_email INTO connection_email FROM public.user_calendar_connections WHERE id=connection_id;
  INSERT INTO public.organization_calendar_syncs(organization_id,created_by,calendar_id,calendar_email,auto_sync)
  VALUES(p_organization,p_actor,p_verified_calendar_id,connection_email,true)
  ON CONFLICT(organization_id) DO UPDATE SET created_by=EXCLUDED.created_by,calendar_id=EXCLUDED.calendar_id,calendar_email=EXCLUDED.calendar_email,updated_at=clock_timestamp();
  RETURN to_jsonb(destination)||jsonb_build_object('should_create',false,'legacy_id',legacy_id);
 END IF;
 IF destination.state='ready' AND p_replace_calendar_id IS NULL THEN RETURN to_jsonb(destination)||jsonb_build_object('should_create',false,'legacy_id',legacy_id); END IF;
 IF NOT p_allow_create THEN RETURN jsonb_build_object('state',destination.state,'calendar_id',destination.calendar_id,'operation_id',destination.operation_id,'should_create',false,'legacy_id',legacy_id); END IF;
 IF p_replace_calendar_id IS DISTINCT FROM coalesce(destination.calendar_id,legacy_id) THEN
  RAISE EXCEPTION 'Calendar replacement proof is stale' USING ERRCODE='55000';
 END IF;
 INSERT INTO app_private.organization_calendar_destinations(organization_id,owner_user_id,connection_id,state,previous_calendar_id)
 VALUES(p_organization,p_actor,connection_id,'provisioning',legacy_id)
 ON CONFLICT(organization_id) DO UPDATE SET owner_user_id=EXCLUDED.owner_user_id,connection_id=EXCLUDED.connection_id,
  state='provisioning',previous_calendar_id=coalesce(organization_calendar_destinations.calendar_id,legacy_id),calendar_id=NULL,operation_id=gen_random_uuid(),started_at=clock_timestamp(),completed_at=NULL,updated_at=clock_timestamp()
 RETURNING * INTO destination;
 RETURN to_jsonb(destination)||jsonb_build_object('should_create',true,'legacy_id',legacy_id);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_organization_calendar_destination(uuid,uuid,boolean,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_organization_calendar_destination(uuid,uuid,boolean,text,text) TO service_role;

CREATE FUNCTION public.complete_organization_calendar_destination(p_actor uuid,p_organization uuid,p_operation uuid,p_outcome text,p_calendar_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE destination app_private.organization_calendar_destinations; connection_email text; active_owner boolean;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lets-assist-account-write:'||p_actor::text,0));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lets-assist-org-calendar:'||p_organization::text,0));
 SELECT * INTO destination FROM app_private.organization_calendar_destinations WHERE organization_id=p_organization FOR UPDATE;
 IF NOT FOUND OR destination.owner_user_id IS DISTINCT FROM p_actor OR destination.operation_id IS DISTINCT FROM p_operation OR p_operation IS NULL THEN
  RAISE EXCEPTION 'Calendar provisioning claim changed' USING ERRCODE='55000';
 END IF;
 IF p_outcome IS NULL OR p_outcome NOT IN ('ready','unknown_outcome','rejected')
  OR ((p_outcome='ready') IS DISTINCT FROM (p_calendar_id IS NOT NULL))
  OR (p_calendar_id IS NOT NULL AND (length(p_calendar_id) NOT BETWEEN 1 AND 1024 OR p_calendar_id !~ '^[A-Za-z0-9_.@#-]+$' OR p_calendar_id IN ('.','..','primary'))) THEN
  RAISE EXCEPTION 'Invalid calendar provisioning outcome' USING ERRCODE='22023';
 END IF;
 IF destination.state<>'provisioning' THEN
  IF destination.state=p_outcome AND destination.calendar_id IS NOT DISTINCT FROM p_calendar_id THEN RETURN to_jsonb(destination); END IF;
  RAISE EXCEPTION 'Calendar provisioning outcome already recorded' USING ERRCODE='55000';
 END IF;
 UPDATE app_private.organization_calendar_destinations SET state=p_outcome,calendar_id=p_calendar_id,completed_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE organization_id=p_organization RETURNING * INTO destination;
 IF p_outcome='ready' THEN
  SELECT calendar_email INTO connection_email FROM public.user_calendar_connections WHERE id=destination.connection_id;
  PERFORM 1 FROM public.organization_members WHERE organization_id=p_organization AND user_id=p_actor AND role='admin' AND status='active' FOR SHARE;
  active_owner:=FOUND AND app_private.account_deletion_actor_is_active(p_actor);
  IF active_owner THEN
   PERFORM 1 FROM public.user_calendar_connections c
   JOIN public.user_google_oauth_connection_bindings b ON b.connection_id=c.id AND b.user_id=c.user_id AND b.provider=c.provider
   WHERE c.id=destination.connection_id AND c.user_id=p_actor AND c.provider='google' AND c.is_active
    AND b.purpose='organization_calendar' AND b.organization_id=p_organization AND b.plugin_key IS NULL FOR SHARE OF c,b;
   active_owner:=FOUND;
  END IF;
  INSERT INTO public.organization_calendar_syncs(organization_id,created_by,calendar_id,calendar_email,auto_sync)
  VALUES(p_organization,p_actor,p_calendar_id,connection_email,active_owner)
  ON CONFLICT(organization_id) DO UPDATE SET created_by=EXCLUDED.created_by,calendar_id=EXCLUDED.calendar_id,
   calendar_email=EXCLUDED.calendar_email,auto_sync=organization_calendar_syncs.auto_sync AND EXCLUDED.auto_sync,updated_at=clock_timestamp();
 END IF;
 RETURN to_jsonb(destination);
END;
$$;
REVOKE ALL ON FUNCTION public.complete_organization_calendar_destination(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.complete_organization_calendar_destination(uuid,uuid,uuid,text,text) TO service_role;
COMMIT;
