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

-- Keep provider identities after source and compatibility-binding deletion.
CREATE TABLE app_private.organization_calendar_event_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 calendar_id text NOT NULL,
 source_kind text NOT NULL CHECK(source_kind IN ('project_schedule','csf_opportunity','csf_meeting_session','csf_deadline')),
 source_id uuid NOT NULL,
 occurrence_key text NOT NULL,
 event_id text NOT NULL,
 phase text NOT NULL CHECK(phase IN ('pending_create','pending_update','synced','pending_remove','removed')),
 event_payload jsonb,
 desired_payload jsonb,
 confirmed_payload jsonb,
 confirmed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,calendar_id,source_kind,source_id,occurrence_key),
 UNIQUE(organization_id,calendar_id,event_id)
);
CREATE TABLE app_private.organization_calendar_sync_leases (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL,
 calendar_id text NOT NULL,
 claim_token uuid NOT NULL,
 lease_until timestamptz NOT NULL,
 source_kinds text[] NOT NULL DEFAULT '{}'
);
ALTER TABLE app_private.organization_calendar_event_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.organization_calendar_event_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE app_private.organization_calendar_sync_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.organization_calendar_sync_leases FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.organization_calendar_event_receipts,app_private.organization_calendar_sync_leases FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON app_private.organization_calendar_event_receipts,app_private.organization_calendar_sync_leases TO service_role;

CREATE FUNCTION app_private.organization_calendar_source_is_publishable(p_org uuid,p_kind text,p_source uuid,p_occurrence text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE project public.projects;
BEGIN
 IF p_kind='project_schedule' THEN
  SELECT * INTO project FROM public.projects WHERE id=p_source AND organization_id=p_org
   AND status<>'cancelled' AND (workflow_status IS NULL OR workflow_status='published');
  IF NOT FOUND THEN RETURN false; END IF;
  IF project.event_type='oneTime' THEN RETURN p_occurrence='oneTime' AND jsonb_typeof(project.schedule->'oneTime')='object'; END IF;
  IF project.event_type='sameDayMultiArea' THEN RETURN EXISTS(SELECT 1 FROM jsonb_array_elements(project.schedule->'sameDayMultiArea'->'roles') r WHERE r->>'name'=p_occurrence); END IF;
  IF project.event_type='multiDay' THEN RETURN EXISTS(
   SELECT 1 FROM jsonb_array_elements(project.schedule->'multiDay') WITH ORDINALITY d(value,n),
    jsonb_array_elements(d.value->'slots') WITH ORDINALITY s(value,n)
   WHERE p_occurrence=(d.value->>'date')||'-'||(d.n-1)::text||'-'||(s.n-1)::text
  ); END IF;
  RETURN false;
 END IF;
 IF p_occurrence<>'primary' THEN RETURN false; END IF;
 IF p_kind='csf_opportunity' THEN RETURN EXISTS(SELECT 1 FROM plugin_data.csf_opportunities WHERE id=p_source AND organization_id=p_org AND status='published' AND starts_at IS NOT NULL); END IF;
 IF p_kind='csf_meeting_session' THEN RETURN EXISTS(
  SELECT 1 FROM plugin_data.csf_meeting_sessions s JOIN plugin_data.csf_meetings m ON m.id=s.meeting_id AND m.organization_id=s.organization_id
  WHERE s.id=p_source AND s.organization_id=p_org AND s.status IN ('scheduled','open') AND m.status='active' AND (s.starts_at IS NOT NULL OR s.session_date IS NOT NULL)
 ); END IF;
 IF p_kind='csf_deadline' THEN RETURN EXISTS(SELECT 1 FROM plugin_data.csf_term_deadlines WHERE id=p_source AND organization_id=p_org AND status IN ('planned','open') AND audience IN ('members','applicants','all')); END IF;
 RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION app_private.organization_calendar_source_is_publishable(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.organization_calendar_source_is_publishable(uuid,text,uuid,text) TO service_role;

CREATE FUNCTION public.claim_organization_calendar_sync(p_actor uuid,p_organization uuid,p_calendar_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE current_lease app_private.organization_calendar_sync_leases; new_token uuid:=gen_random_uuid();
BEGIN
 PERFORM app_private.authorize_organization_calendar_provider(p_actor,p_organization);
 PERFORM 1 FROM app_private.organization_calendar_destinations WHERE organization_id=p_organization AND owner_user_id=p_actor AND state='ready' AND calendar_id=p_calendar_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Organization calendar destination changed' USING ERRCODE='55000'; END IF;
 SELECT * INTO current_lease FROM app_private.organization_calendar_sync_leases WHERE organization_id=p_organization FOR UPDATE;
 IF FOUND AND current_lease.lease_until>clock_timestamp() THEN RAISE EXCEPTION 'Organization calendar sync already running' USING ERRCODE='55P03'; END IF;
 INSERT INTO app_private.organization_calendar_sync_leases(organization_id,actor_user_id,calendar_id,claim_token,lease_until)
 VALUES(p_organization,p_actor,p_calendar_id,new_token,clock_timestamp()+interval '90 seconds')
 ON CONFLICT(organization_id) DO UPDATE SET actor_user_id=EXCLUDED.actor_user_id,calendar_id=EXCLUDED.calendar_id,claim_token=EXCLUDED.claim_token,lease_until=EXCLUDED.lease_until,source_kinds='{}';
 RETURN new_token;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_organization_calendar_sync(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_organization_calendar_sync(uuid,uuid,text) TO service_role;

CREATE FUNCTION public.advance_organization_calendar_sync(p_actor uuid,p_organization uuid,p_claim uuid,p_step text,p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE current_lease app_private.organization_calendar_sync_leases; receipt app_private.organization_calendar_event_receipts;
 entry jsonb; kinds text[]; events jsonb; kind text; source uuid; occurrence text; payload jsonb; calendar text;
BEGIN
 PERFORM app_private.authorize_organization_calendar_provider(p_actor,p_organization);
 SELECT * INTO current_lease FROM app_private.organization_calendar_sync_leases WHERE organization_id=p_organization FOR UPDATE;
 IF NOT FOUND OR current_lease.actor_user_id IS DISTINCT FROM p_actor OR current_lease.claim_token IS DISTINCT FROM p_claim OR current_lease.lease_until<=clock_timestamp() THEN
  RAISE EXCEPTION 'Organization calendar lease changed or expired' USING ERRCODE='55000';
 END IF;
 PERFORM 1 FROM app_private.organization_calendar_destinations WHERE organization_id=p_organization AND owner_user_id=p_actor AND state='ready' AND calendar_id=current_lease.calendar_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Organization calendar destination changed' USING ERRCODE='55000'; END IF;
 UPDATE app_private.organization_calendar_sync_leases SET lease_until=clock_timestamp()+interval '90 seconds' WHERE organization_id=p_organization;
 IF p_step='release' THEN
  UPDATE app_private.organization_calendar_sync_leases SET lease_until=clock_timestamp() WHERE organization_id=p_organization;
  RETURN '{}';
 ELSIF p_step='renew' THEN RETURN '{}';
 ELSIF p_step='plan' THEN
  events:=p_payload->'events';
  IF jsonb_typeof(events) IS DISTINCT FROM 'array' OR jsonb_array_length(events)>10000 OR pg_column_size(p_payload)>8388608
   OR jsonb_typeof(p_payload->'source_kinds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid calendar projection plan' USING ERRCODE='22023'; END IF;
  SELECT array_agg(value) INTO kinds FROM jsonb_array_elements_text(p_payload->'source_kinds');
  IF kinds IS NULL OR array_length(kinds,1)>4 OR cardinality(kinds)<>(SELECT count(DISTINCT k) FROM unnest(kinds) k) OR EXISTS(SELECT 1 FROM unnest(kinds) k WHERE k IS NULL OR k NOT IN ('project_schedule','csf_opportunity','csf_meeting_session','csf_deadline')) THEN
   RAISE EXCEPTION 'Invalid calendar source kinds' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(events) e GROUP BY e->>'source_kind',e->>'source_id',e->>'occurrence_key' HAVING count(*)>1) THEN
   RAISE EXCEPTION 'Duplicate calendar projection' USING ERRCODE='22023';
  END IF;
  -- Adopt every known legacy identity before considering its source for removal.
  IF (SELECT count(*) FROM public.organization_calendar_events WHERE organization_id=p_organization AND source_kind=ANY(kinds))>10000 THEN
   RAISE EXCEPTION 'Legacy calendar binding limit exceeded' USING ERRCODE='54000';
  END IF;
  SELECT coalesce(previous_calendar_id,current_lease.calendar_id) INTO calendar FROM app_private.organization_calendar_destinations WHERE organization_id=p_organization;
  INSERT INTO app_private.organization_calendar_event_receipts(organization_id,calendar_id,source_kind,source_id,occurrence_key,event_id,phase)
  SELECT organization_id,calendar,source_kind,source_id,occurrence_key,event_id,'synced'
  FROM public.organization_calendar_events b WHERE organization_id=p_organization AND source_kind=ANY(kinds)
   AND NOT EXISTS(SELECT 1 FROM app_private.organization_calendar_event_receipts r WHERE r.organization_id=b.organization_id AND r.source_kind=b.source_kind AND r.source_id=b.source_id AND r.occurrence_key=b.occurrence_key)
  ON CONFLICT(organization_id,calendar_id,source_kind,source_id,occurrence_key) DO NOTHING;
  FOR entry IN SELECT value FROM jsonb_array_elements(events) LOOP
   kind:=entry->>'source_kind'; source:=(entry->>'source_id')::uuid; occurrence:=entry->>'occurrence_key'; payload:=entry->'event';
   IF kind IS NULL OR NOT(kind=ANY(kinds)) OR source IS NULL OR occurrence IS NULL OR length(occurrence) NOT BETWEEN 1 AND 500
    OR jsonb_typeof(payload) IS DISTINCT FROM 'object' OR pg_column_size(payload)>262144 THEN
    RAISE EXCEPTION 'Invalid calendar projection entry' USING ERRCODE='22023';
   END IF;
   IF NOT app_private.organization_calendar_source_is_publishable(p_organization,kind,source,occurrence) THEN
    RAISE EXCEPTION 'Calendar projection source changed' USING ERRCODE='55000';
   END IF;
   INSERT INTO app_private.organization_calendar_event_receipts(organization_id,calendar_id,source_kind,source_id,occurrence_key,event_id,phase,event_payload,desired_payload)
   VALUES(p_organization,current_lease.calendar_id,kind,source,occurrence,'la'||replace(gen_random_uuid()::text,'-',''),'pending_create',payload,payload)
   ON CONFLICT(organization_id,calendar_id,source_kind,source_id,occurrence_key) DO UPDATE SET
    event_id=CASE WHEN organization_calendar_event_receipts.phase='removed' THEN EXCLUDED.event_id ELSE organization_calendar_event_receipts.event_id END,
    phase=CASE WHEN organization_calendar_event_receipts.phase='removed' THEN 'pending_create'
      WHEN organization_calendar_event_receipts.phase IN ('pending_create','pending_update','pending_remove') THEN organization_calendar_event_receipts.phase
      WHEN organization_calendar_event_receipts.confirmed_payload IS DISTINCT FROM EXCLUDED.event_payload OR organization_calendar_event_receipts.confirmed_at IS NULL OR organization_calendar_event_receipts.confirmed_at<clock_timestamp()-interval '24 hours' THEN 'pending_update' ELSE 'synced' END,
    event_payload=CASE WHEN organization_calendar_event_receipts.phase IN ('pending_create','pending_update','pending_remove') THEN organization_calendar_event_receipts.event_payload ELSE EXCLUDED.event_payload END,
    desired_payload=EXCLUDED.desired_payload,updated_at=clock_timestamp();
  END LOOP;
  FOR receipt IN SELECT * FROM app_private.organization_calendar_event_receipts WHERE organization_id=p_organization AND source_kind=ANY(kinds) AND phase<>'removed' FOR UPDATE LOOP
   IF receipt.calendar_id=current_lease.calendar_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(events) e WHERE e->>'source_kind'=receipt.source_kind AND (e->>'source_id')::uuid=receipt.source_id AND e->>'occurrence_key'=receipt.occurrence_key) THEN CONTINUE; END IF;
   IF receipt.calendar_id=current_lease.calendar_id AND app_private.organization_calendar_source_is_publishable(p_organization,receipt.source_kind,receipt.source_id,receipt.occurrence_key) THEN
    RAISE EXCEPTION 'Calendar snapshot omitted a publishable tracked source' USING ERRCODE='55000';
   END IF;
   UPDATE app_private.organization_calendar_event_receipts SET phase='pending_remove',desired_payload=NULL,updated_at=clock_timestamp() WHERE id=receipt.id;
  END LOOP;
  UPDATE app_private.organization_calendar_sync_leases SET source_kinds=kinds WHERE organization_id=p_organization;
  RETURN '{}';
 ELSIF p_step='next' THEN
  SELECT * INTO receipt FROM app_private.organization_calendar_event_receipts
  WHERE organization_id=p_organization AND source_kind=ANY(current_lease.source_kinds) AND phase IN ('pending_create','pending_update','pending_remove')
  ORDER BY CASE WHEN phase='pending_remove' THEN 0 ELSE 1 END,updated_at,id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
  IF receipt.phase IN ('pending_create','pending_update') AND NOT app_private.organization_calendar_source_is_publishable(p_organization,receipt.source_kind,receipt.source_id,receipt.occurrence_key) THEN
   UPDATE app_private.organization_calendar_event_receipts SET phase='pending_remove',desired_payload=NULL,updated_at=clock_timestamp()
   WHERE id=receipt.id RETURNING * INTO receipt;
  END IF;
  RETURN to_jsonb(receipt);
 ELSIF p_step IN ('complete','missing') THEN
  SELECT * INTO receipt FROM app_private.organization_calendar_event_receipts
  WHERE id=(p_payload->>'receipt_id')::uuid AND organization_id=p_organization AND source_kind=ANY(current_lease.source_kinds) FOR UPDATE;
  IF NOT FOUND OR receipt.event_id IS DISTINCT FROM p_payload->>'event_id' OR receipt.phase NOT IN ('pending_create','pending_update','pending_remove') THEN
   RAISE EXCEPTION 'Calendar event receipt changed' USING ERRCODE='55000';
  END IF;
  IF p_step='missing' THEN
   IF receipt.phase NOT IN ('pending_create','pending_update') THEN RAISE EXCEPTION 'Invalid missing-event transition' USING ERRCODE='55000'; END IF;
   UPDATE app_private.organization_calendar_event_receipts SET event_id='la'||replace(gen_random_uuid()::text,'-',''),phase='pending_create',confirmed_payload=NULL,updated_at=clock_timestamp() WHERE id=receipt.id;
   RETURN '{}';
  END IF;
  IF receipt.phase='pending_remove' THEN
   DELETE FROM public.organization_calendar_events WHERE organization_id=p_organization AND source_kind=receipt.source_kind AND source_id=receipt.source_id AND occurrence_key=receipt.occurrence_key AND event_id=receipt.event_id;
   UPDATE app_private.organization_calendar_event_receipts SET phase=CASE WHEN desired_payload IS NULL THEN 'removed' ELSE 'pending_create' END,
    event_id=CASE WHEN desired_payload IS NULL THEN event_id ELSE 'la'||replace(gen_random_uuid()::text,'-','') END,
    event_payload=desired_payload,confirmed_payload=NULL,updated_at=clock_timestamp() WHERE id=receipt.id;
  ELSIF NOT app_private.organization_calendar_source_is_publishable(p_organization,receipt.source_kind,receipt.source_id,receipt.occurrence_key) THEN
   UPDATE app_private.organization_calendar_event_receipts SET phase='pending_remove',desired_payload=NULL,confirmed_payload=receipt.event_payload,updated_at=clock_timestamp() WHERE id=receipt.id;
  ELSE
   INSERT INTO public.organization_calendar_events(organization_id,project_id,schedule_id,source_kind,source_id,occurrence_key,event_id)
   VALUES(p_organization,CASE WHEN receipt.source_kind='project_schedule' THEN receipt.source_id ELSE NULL END,receipt.occurrence_key,receipt.source_kind,receipt.source_id,receipt.occurrence_key,receipt.event_id)
   ON CONFLICT(organization_id,source_kind,source_id,occurrence_key) DO UPDATE SET event_id=EXCLUDED.event_id,updated_at=clock_timestamp(),synced_at=clock_timestamp();
   UPDATE app_private.organization_calendar_event_receipts SET phase=CASE WHEN desired_payload IS DISTINCT FROM event_payload THEN 'pending_update' ELSE 'synced' END,
    confirmed_payload=event_payload,event_payload=desired_payload,confirmed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=receipt.id;
  END IF;
  RETURN '{}';
 ELSIF p_step='finish' THEN
  IF cardinality(current_lease.source_kinds)=0 OR EXISTS(SELECT 1 FROM app_private.organization_calendar_event_receipts WHERE organization_id=p_organization AND source_kind=ANY(current_lease.source_kinds) AND phase NOT IN ('synced','removed')) THEN
   RAISE EXCEPTION 'Calendar sync still has pending provider work' USING ERRCODE='55000';
  END IF;
  UPDATE app_private.organization_calendar_sync_leases SET lease_until=clock_timestamp() WHERE organization_id=p_organization;
  RETURN '{}';
 END IF;
 RAISE EXCEPTION 'Unknown calendar sync transition' USING ERRCODE='22023';
END;
$$;
REVOKE ALL ON FUNCTION public.advance_organization_calendar_sync(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.advance_organization_calendar_sync(uuid,uuid,uuid,text,jsonb) TO service_role;
COMMIT;
