-- Fence each organization sheet export behind one durable run with a saved report and per-mutation receipts,
-- and hand the calendar worker its due organizations from one fair, durable discovery cursor.
BEGIN;
CREATE TABLE app_private.organization_sheet_sync_runs (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
 -- Held while the run is unresolved, so the account cannot be removed under it. Cleared on completion.
 actor_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 connection_id uuid,
 config_identity jsonb,
 run_id uuid NOT NULL DEFAULT gen_random_uuid(),
 state text NOT NULL CHECK(state IN ('claimed','planned','completed','outcome_unknown')),
 plan jsonb,
 report_rows jsonb,
 step_count smallint NOT NULL DEFAULT 0 CHECK(step_count BETWEEN 0 AND 3),
 completed_steps smallint NOT NULL DEFAULT 0,
 inflight_step smallint,
 inflight_request_id uuid,
 inflight_started_at timestamptz,
 rejected_step smallint,
 claim_token uuid,
 lease_until timestamptz,
 planned_at timestamptz,
 completed_at timestamptz,
 -- A digest of the completing claim, actor and organization. It proves a finalize retry without keeping the actor.
 completion_marker bytea,
 -- What completion answered: the spreadsheet, the configuration revision and the sync time. No cells and no plan.
 receipt jsonb,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(completed_steps BETWEEN 0 AND step_count),
 CHECK((inflight_step IS NULL)=(inflight_request_id IS NULL) AND (inflight_step IS NULL)=(inflight_started_at IS NULL)),
 CHECK(state NOT IN ('planned','outcome_unknown') OR (plan IS NOT NULL AND report_rows IS NOT NULL AND planned_at IS NOT NULL AND step_count>=1)),
 CHECK(state<>'outcome_unknown' OR inflight_step IS NOT NULL),
 CHECK(state NOT IN ('claimed','completed') OR (report_rows IS NULL AND inflight_step IS NULL)),
 CHECK(state='completed' OR (actor_user_id IS NOT NULL AND connection_id IS NOT NULL AND config_identity IS NOT NULL
  AND completion_marker IS NULL AND receipt IS NULL)),
 CHECK(state<>'completed' OR (actor_user_id IS NULL AND connection_id IS NULL AND config_identity IS NULL AND plan IS NULL
  AND lease_until IS NULL AND claim_token IS NOT NULL AND completion_marker IS NOT NULL AND receipt IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX organization_sheet_sync_runs_actor_idx ON app_private.organization_sheet_sync_runs(actor_user_id) WHERE actor_user_id IS NOT NULL;
CREATE INDEX organization_sheet_sync_runs_completed_idx ON app_private.organization_sheet_sync_runs(completed_at) WHERE state='completed';
ALTER TABLE app_private.organization_sheet_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.organization_sheet_sync_runs FORCE ROW LEVEL SECURITY;
-- No role reads or writes this table directly. The two service-only functions below are the whole interface.
REVOKE ALL ON app_private.organization_sheet_sync_runs FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE app_private.organization_sheet_sync_runs IS
 'One current organization sheet export per organization: the claim, the saved report rows and ranges, and a begin/acknowledge receipt for each provider mutation. Holds report cells but never token material. Completion clears the actor, connection, configuration, plan and cells and keeps only a receipt, which is removed after 30 days. An unresolved run restricts deleting its actor and its organization. An unacknowledged mutation stays outcome_unknown until an operator reconciles it.';
-- This table is created after the account-deletion fence inventory. The fence renders the whole row,
-- so it fires only for statements that set the actor and not for each step that carries the saved cells.
CREATE TRIGGER account_deletion_reference_fence BEFORE INSERT OR UPDATE OF actor_user_id ON app_private.organization_sheet_sync_runs
FOR EACH ROW EXECUTE FUNCTION app_private.guard_account_deletion_reference('actor_user_id');

-- A saved report or an uncertain mutation must not vanish with its organization. A finished run may.
CREATE FUNCTION app_private.guard_organization_sheet_sync_run_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Never waits: an account lock is taken before this one everywhere else, and a delete may hold other locks.
 IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('lets-assist-org-sheet-sync:'||OLD.id::text,0)) THEN
  RAISE EXCEPTION 'A spreadsheet sync for this organization is running. Retry the deletion shortly.' USING ERRCODE='55P03';
 END IF;
 IF EXISTS(SELECT 1 FROM app_private.organization_sheet_sync_runs r WHERE r.organization_id=OLD.id
  AND (r.state IN ('planned','outcome_unknown') OR (r.state='claimed' AND r.lease_until>clock_timestamp()))) THEN
  RAISE EXCEPTION 'This organization has a spreadsheet sync that has not finished. Finish or resolve that sync before deleting the organization.' USING ERRCODE='55006';
 END IF;
 RETURN OLD;
END;
$$;
-- Fired by the trigger only: no role holds EXECUTE.
REVOKE ALL ON FUNCTION app_private.guard_organization_sheet_sync_run_delete() FROM PUBLIC,anon,authenticated,service_role;
-- Named to fire before the row triggers that clean up an organization's credentials.
CREATE TRIGGER block_organization_delete_with_unresolved_sheet_sync BEFORE DELETE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION app_private.guard_organization_sheet_sync_run_delete();

-- Removes receipts of runs that finished more than 30 days ago, at most 200 a call. Never an unresolved run.
CREATE FUNCTION app_private.purge_completed_organization_sheet_sync_runs(p_except uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_removed integer;
BEGIN
 DELETE FROM app_private.organization_sheet_sync_runs r WHERE r.state='completed' AND r.organization_id IN (
  SELECT done.organization_id FROM app_private.organization_sheet_sync_runs done
  WHERE done.state='completed' AND done.completed_at<clock_timestamp()-interval '30 days' AND done.organization_id IS DISTINCT FROM p_except
  ORDER BY done.completed_at LIMIT 200 FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS v_removed=ROW_COUNT;
 RETURN v_removed;
END;
$$;
-- Internal helper for the definer functions below: no role holds EXECUTE.
REVOKE ALL ON FUNCTION app_private.purge_completed_organization_sheet_sync_runs(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Every saved column a sync depends on. The timestamp is rendered in UTC so the session time zone cannot change it.
CREATE FUNCTION app_private.organization_sheet_sync_config_identity(p_config public.organization_sheet_syncs)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('sheet_id',p_config.sheet_id,'tab_name',p_config.tab_name,'range_a1',p_config.range_a1,'report_type',p_config.report_type,
  'layout_config',p_config.layout_config,'created_by',p_config.created_by,
  'updated_at',to_char(p_config.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'));
$$;
-- Internal helper for the definer functions below: no role holds EXECUTE.
REVOKE ALL ON FUNCTION app_private.organization_sheet_sync_config_identity(public.organization_sheet_syncs) FROM PUBLIC,anon,authenticated,service_role;

-- Strips the whitespace the application's own trim strips, and nothing else. Each character is named by code point,
-- so no letter is ever removed: a tab called "Dev" keeps its "v".
CREATE FUNCTION app_private.organization_sheet_sync_trim(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT btrim(p_value,chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)
  ||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279));
$$;
-- Internal helper for the definer functions below: no role holds EXECUTE.
REVOKE ALL ON FUNCTION app_private.organization_sheet_sync_trim(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION app_private.authorize_organization_sheet_sync(p_actor uuid,p_organization uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_connection uuid;
BEGIN
 IF p_actor IS NULL OR p_organization IS NULL THEN RAISE EXCEPTION 'Sheet sync scope required' USING ERRCODE='22023'; END IF;
 -- The account fence comes before the organization lock, matching account deletion.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lets-assist-account-write:'||p_actor::text,0));
 IF NOT app_private.account_deletion_actor_is_active(p_actor) THEN RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lets-assist-org-sheet-sync:'||p_organization::text,0));
 PERFORM 1 FROM public.organization_members WHERE organization_id=p_organization AND user_id=p_actor AND role='admin' AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Organization sheet sync access denied' USING ERRCODE='42501'; END IF;
 SELECT c.id INTO v_connection FROM public.user_calendar_connections c
 JOIN public.user_google_oauth_connection_bindings b ON b.connection_id=c.id AND b.user_id=c.user_id AND b.provider=c.provider
 WHERE c.user_id=p_actor AND c.provider='google' AND c.is_active AND b.purpose='organization_sheets'
  AND b.organization_id=p_organization AND b.plugin_key IS NULL FOR SHARE OF c,b;
 IF v_connection IS NULL THEN RAISE EXCEPTION 'Organization sheet connection missing' USING ERRCODE='42501'; END IF;
 RETURN v_connection;
END;
$$;
-- Internal helper for the definer functions below: no role holds EXECUTE.
REVOKE ALL ON FUNCTION app_private.authorize_organization_sheet_sync(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.claim_organization_sheet_sync_run(p_actor uuid,p_organization uuid,p_sheet_id text,p_config_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_connection uuid; v_config public.organization_sheet_syncs; v_identity jsonb;
 v_run app_private.organization_sheet_sync_runs; v_token uuid:=gen_random_uuid();
BEGIN
 v_connection:=app_private.authorize_organization_sheet_sync(p_actor,p_organization);
 SELECT * INTO v_config FROM public.organization_sheet_syncs WHERE organization_id=p_organization FOR UPDATE;
 IF NOT FOUND OR p_sheet_id IS NULL OR p_config_updated_at IS NULL OR v_config.created_by IS DISTINCT FROM p_actor
  OR v_config.sheet_id IS DISTINCT FROM p_sheet_id OR v_config.updated_at IS DISTINCT FROM p_config_updated_at THEN
  RAISE EXCEPTION 'Organization sheet sync configuration changed' USING ERRCODE='55000';
 END IF;
 v_identity:=app_private.organization_sheet_sync_config_identity(v_config);
 -- Old receipts of other organizations are removed here, so no separate purge interface exists.
 PERFORM app_private.purge_completed_organization_sheet_sync_runs(p_organization);
 -- The organization lock is already held, so two first claims cannot both insert.
 SELECT * INTO v_run FROM app_private.organization_sheet_sync_runs WHERE organization_id=p_organization FOR UPDATE;
 IF FOUND THEN
  -- An uncertain provider mutation blocks every caller and every configuration.
  IF v_run.state='outcome_unknown' THEN RETURN jsonb_build_object('status','outcome_unknown'); END IF;
  IF v_run.lease_until IS NOT NULL AND v_run.lease_until>clock_timestamp() THEN RETURN jsonb_build_object('status','busy'); END IF;
  IF v_run.inflight_step IS NOT NULL THEN
   -- The lease ended with a request begun and never acknowledged. A timeout does not make it safe.
   UPDATE app_private.organization_sheet_sync_runs SET state='outcome_unknown',updated_at=clock_timestamp() WHERE organization_id=p_organization;
   RETURN jsonb_build_object('status','outcome_unknown');
  END IF;
  IF v_run.state='planned' AND v_run.config_identity=v_identity THEN
   -- Resume the saved report. The whole replacement replays from its first step.
   UPDATE app_private.organization_sheet_sync_runs SET actor_user_id=p_actor,connection_id=v_connection,claim_token=v_token,
    lease_until=clock_timestamp()+interval '5 minutes',completed_steps=0,updated_at=clock_timestamp()
   WHERE organization_id=p_organization RETURNING * INTO v_run;
   RETURN jsonb_build_object('status','resume','claim_token',v_token,'run_id',v_run.run_id,'plan',v_run.plan,'rows',v_run.report_rows);
  END IF;
 END IF;
 -- A first run, a finished run, a claim that never saved a report, or a saved report for a configuration that has since changed.
 -- A new run replaces the finished one's token and receipt, so the old claim can no longer read a completion back.
 INSERT INTO app_private.organization_sheet_sync_runs(organization_id,actor_user_id,connection_id,config_identity,run_id,state,claim_token,lease_until)
 VALUES(p_organization,p_actor,v_connection,v_identity,gen_random_uuid(),'claimed',v_token,clock_timestamp()+interval '5 minutes')
 ON CONFLICT(organization_id) DO UPDATE SET actor_user_id=EXCLUDED.actor_user_id,connection_id=EXCLUDED.connection_id,config_identity=EXCLUDED.config_identity,
  run_id=EXCLUDED.run_id,state='claimed',plan=NULL,report_rows=NULL,step_count=0,completed_steps=0,rejected_step=NULL,
  claim_token=EXCLUDED.claim_token,lease_until=EXCLUDED.lease_until,planned_at=NULL,completed_at=NULL,completion_marker=NULL,receipt=NULL,
  updated_at=clock_timestamp()
 RETURNING * INTO v_run;
 RETURN jsonb_build_object('status','claimed','claim_token',v_token,'run_id',v_run.run_id);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_organization_sheet_sync_run(uuid,uuid,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_organization_sheet_sync_run(uuid,uuid,text,timestamptz) TO service_role;

CREATE FUNCTION public.advance_organization_sheet_sync_run(p_actor uuid,p_organization uuid,p_claim uuid,p_step text,p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_run app_private.organization_sheet_sync_runs; v_config public.organization_sheet_syncs; v_connection uuid;
 v_plan jsonb; v_rows jsonb; v_cells bigint; v_invalid bigint; v_outcome text; v_stamp timestamptz; v_receipt jsonb;
 v_marker bytea; v_tab text; v_prefix text; v_range text;
BEGIN
 IF p_actor IS NULL OR p_organization IS NULL OR p_claim IS NULL OR p_step IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Invalid sheet sync transition' USING ERRCODE='22023';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lets-assist-account-write:'||p_actor::text,0));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lets-assist-org-sheet-sync:'||p_organization::text,0));
 SELECT * INTO v_run FROM app_private.organization_sheet_sync_runs WHERE organization_id=p_organization FOR UPDATE;
 IF NOT FOUND OR v_run.claim_token IS DISTINCT FROM p_claim THEN
  RAISE EXCEPTION 'Organization sheet sync claim changed' USING ERRCODE='55000';
 END IF;
 v_marker:=pg_catalog.sha256(pg_catalog.convert_to(p_claim::text||':'||p_actor::text||':'||p_organization::text,'UTF8'));

 -- A finished run answers its own claim with the saved receipt, so a finalize whose answer was lost can be asked again.
 -- Nothing is rebuilt, re-sent or re-stamped, and nothing here can clear the receipt.
 IF v_run.state='completed' THEN
  IF v_run.completion_marker IS DISTINCT FROM v_marker THEN
   RAISE EXCEPTION 'Organization sheet sync claim changed' USING ERRCODE='55000';
  END IF;
  IF p_step='finalize' THEN
   RETURN jsonb_build_object('completed',true,'organization_id',p_organization,'actor_user_id',p_actor,'run_id',v_run.run_id)||v_run.receipt;
  ELSIF p_step='release' THEN
   RETURN jsonb_build_object('released',true,'status','completed');
  END IF;
  RAISE EXCEPTION 'Organization sheet sync is already complete' USING ERRCODE='55000';
 END IF;
 IF v_run.actor_user_id IS DISTINCT FROM p_actor THEN
  RAISE EXCEPTION 'Organization sheet sync claim changed' USING ERRCODE='55000';
 END IF;

 -- An acknowledgement records what the provider answered. It needs the exact request, not fresh authority:
 -- refusing a known answer because access changed afterwards would turn it into an unknown one.
 IF p_step='acknowledge' THEN
  v_outcome:=p_payload->>'outcome';
  IF v_outcome IS NULL OR v_outcome NOT IN ('completed','rejected','unsent') THEN
   RAISE EXCEPTION 'Invalid sheet mutation outcome' USING ERRCODE='22023';
  END IF;
  IF v_run.state<>'planned' OR v_run.inflight_request_id IS NULL OR v_run.inflight_request_id::text IS DISTINCT FROM p_payload->>'request_id'
   OR v_run.inflight_step::text IS DISTINCT FROM p_payload->>'step' THEN
   RAISE EXCEPTION 'Sheet mutation acknowledgement does not match' USING ERRCODE='55000';
  END IF;
  UPDATE app_private.organization_sheet_sync_runs SET inflight_step=NULL,inflight_request_id=NULL,inflight_started_at=NULL,
   completed_steps=completed_steps+CASE WHEN v_outcome='completed' THEN 1 ELSE 0 END,
   rejected_step=CASE WHEN v_outcome='rejected' THEN v_run.inflight_step ELSE rejected_step END,updated_at=clock_timestamp()
  WHERE organization_id=p_organization;
  RETURN jsonb_build_object('acknowledged',true,'request_id',v_run.inflight_request_id,'step',v_run.inflight_step,'outcome',v_outcome);
 END IF;

 -- Release never clears an unacknowledged mutation and never touches the saved report.
 IF p_step='release' THEN
  IF v_run.inflight_step IS NOT NULL THEN
   UPDATE app_private.organization_sheet_sync_runs SET state='outcome_unknown',lease_until=clock_timestamp(),updated_at=clock_timestamp() WHERE organization_id=p_organization;
   RETURN jsonb_build_object('released',false,'status','outcome_unknown');
  END IF;
  IF v_run.state='claimed' THEN
   -- Nothing was saved or sent under this claim, so nothing is left to hold the actor or the organization.
   DELETE FROM app_private.organization_sheet_sync_runs WHERE organization_id=p_organization;
   RETURN jsonb_build_object('released',true);
  END IF;
  UPDATE app_private.organization_sheet_sync_runs SET claim_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE organization_id=p_organization;
  RETURN jsonb_build_object('released',true);
 END IF;

 IF v_run.state='outcome_unknown' THEN RAISE EXCEPTION 'Organization sheet sync outcome is unknown' USING ERRCODE='55000'; END IF;
 IF v_run.lease_until IS NULL OR v_run.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'Organization sheet sync lease expired' USING ERRCODE='55000'; END IF;
 v_connection:=app_private.authorize_organization_sheet_sync(p_actor,p_organization);
 SELECT * INTO v_config FROM public.organization_sheet_syncs WHERE organization_id=p_organization FOR UPDATE;
 IF NOT FOUND OR v_connection IS DISTINCT FROM v_run.connection_id
  OR app_private.organization_sheet_sync_config_identity(v_config) IS DISTINCT FROM v_run.config_identity THEN
  RAISE EXCEPTION 'Organization sheet sync configuration changed' USING ERRCODE='55000';
 END IF;

 IF p_step='plan' THEN
  -- The saved report is written once. A retry reads it back instead of replacing it.
  IF v_run.state<>'claimed' THEN RAISE EXCEPTION 'Sheet report snapshot is already saved' USING ERRCODE='55000'; END IF;
  v_plan:=p_payload->'plan'; v_rows:=p_payload->'rows';
  IF jsonb_typeof(v_plan) IS DISTINCT FROM 'object' OR jsonb_typeof(v_rows) IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Invalid sheet report snapshot' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(v_rows)>10000 OR octet_length(v_rows::text)>8388608 OR octet_length(v_plan::text)>16384
   OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_plan) k)
    IS DISTINCT FROM ARRAY['ranges','report_type','sheet_id','stale_clear_range_a1','tab_name','value_input_option','write_range_a1']::text[] THEN
   RAISE EXCEPTION 'Invalid sheet report snapshot' USING ERRCODE='22023';
  END IF;
  -- The tab is the saved one, or the default the sync uses when none is saved.
  v_tab:=coalesce(nullif(app_private.organization_sheet_sync_trim(v_config.tab_name),''),'Member Hours');
  -- RAW only: a saved cell is data and is never evaluated as a formula.
  IF v_plan->>'value_input_option' IS DISTINCT FROM 'RAW' OR v_plan->>'sheet_id' IS DISTINCT FROM v_config.sheet_id
   OR v_plan->>'report_type' IS DISTINCT FROM v_config.report_type
   OR jsonb_typeof(v_plan->'tab_name') IS DISTINCT FROM 'string' OR length(v_plan->>'tab_name') NOT BETWEEN 1 AND 200
   OR v_plan->>'tab_name' IS DISTINCT FROM v_tab
   OR jsonb_typeof(v_plan->'write_range_a1') NOT IN ('string','null') OR jsonb_typeof(v_plan->'stale_clear_range_a1') NOT IN ('string','null')
   -- Stale cells are cleared inside the saved range. The write starts from it, with the legacy default opened.
   -- The application opens exactly one form: the trimmed, case-sensitive text A1:H20, with no tab and no dollar signs.
   OR v_plan->>'stale_clear_range_a1' IS DISTINCT FROM v_config.range_a1
   OR v_plan->>'write_range_a1' IS DISTINCT FROM CASE WHEN app_private.organization_sheet_sync_trim(v_config.range_a1)='A1:H20' THEN 'A1' ELSE v_config.range_a1 END
   OR jsonb_typeof(v_plan->'ranges') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Invalid sheet report snapshot' USING ERRCODE='22023';
  END IF;
  -- One write and at most two stale-cell clears.
  IF jsonb_array_length(v_plan->'ranges') NOT BETWEEN 1 AND 3
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_plan->'ranges') r WHERE jsonb_typeof(r.value)<>'string' OR length(r.value#>>'{}') NOT BETWEEN 1 AND 500)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_rows) r WHERE jsonb_typeof(r.value)<>'array') THEN
   RAISE EXCEPTION 'Invalid sheet report snapshot' USING ERRCODE='22023';
  END IF;
  -- Every range is one closed rectangle on one quoted tab: both corners carry a column and a row.
  -- That tab is the saved tab, or the tab the saved range itself names.
  v_prefix:=substring(v_plan->'ranges'->>0 from '^(''(?:[^'']|'''')+'')!');
  v_range:=app_private.organization_sheet_sync_trim(coalesce(v_config.range_a1,''));
  IF v_prefix IS NULL
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_plan->'ranges') r(value)
    WHERE NOT starts_with(r.value,v_prefix||'!')
     OR substr(r.value,length(v_prefix)+2) !~ '^[A-Z]{1,3}[1-9][0-9]{0,6}:[A-Z]{1,3}[1-9][0-9]{0,6}$')
   OR NOT (v_prefix=''''||replace(v_tab,'''','''''')||''''
    OR starts_with(v_range,v_prefix||'!')
    OR starts_with(v_range,replace(substr(v_prefix,2,length(v_prefix)-2),'''''','''')||'!')) THEN
   RAISE EXCEPTION 'Invalid sheet report destination' USING ERRCODE='22023';
  END IF;
  SELECT count(*),count(*) FILTER(WHERE jsonb_typeof(c.value) NOT IN ('string','number')) INTO v_cells,v_invalid
  FROM jsonb_array_elements(v_rows) r CROSS JOIN LATERAL jsonb_array_elements(r.value) c;
  IF v_cells>100000 OR v_invalid>0 THEN RAISE EXCEPTION 'Invalid sheet report snapshot' USING ERRCODE='22023'; END IF;
  UPDATE app_private.organization_sheet_sync_runs SET state='planned',plan=v_plan,report_rows=v_rows,step_count=jsonb_array_length(v_plan->'ranges'),
   completed_steps=0,rejected_step=NULL,planned_at=clock_timestamp(),lease_until=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp()
  WHERE organization_id=p_organization RETURNING * INTO v_run;
  RETURN jsonb_build_object('planned',true,'run_id',v_run.run_id,'step_count',v_run.step_count);
 ELSIF p_step='begin' THEN
  IF v_run.state<>'planned' OR v_run.inflight_step IS NOT NULL OR v_run.completed_steps>=v_run.step_count THEN
   RAISE EXCEPTION 'Sheet mutation cannot begin' USING ERRCODE='55000';
  END IF;
  IF p_payload->>'step' IS DISTINCT FROM v_run.completed_steps::text OR p_payload->>'request_id' IS NULL
   OR p_payload->>'request_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'Invalid sheet mutation request' USING ERRCODE='22023';
  END IF;
  UPDATE app_private.organization_sheet_sync_runs SET inflight_step=v_run.completed_steps,inflight_request_id=(p_payload->>'request_id')::uuid,
   inflight_started_at=clock_timestamp(),lease_until=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp()
  WHERE organization_id=p_organization RETURNING * INTO v_run;
  RETURN jsonb_build_object('begun',true,'request_id',v_run.inflight_request_id,'step',v_run.inflight_step);
 ELSIF p_step='finalize' THEN
  IF v_run.state<>'planned' OR v_run.inflight_step IS NOT NULL OR v_run.completed_steps<>v_run.step_count THEN
   RAISE EXCEPTION 'Sheet sync still has pending provider work' USING ERRCODE='55000';
  END IF;
  -- The sync time is the time the written report was built, so a resumed report never reads as fresher than it is.
  UPDATE public.organization_sheet_syncs SET last_synced_at=v_run.planned_at
  WHERE organization_id=p_organization AND created_by=p_actor AND sheet_id=v_config.sheet_id AND updated_at=v_config.updated_at
  RETURNING last_synced_at INTO v_stamp;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization sheet sync configuration changed' USING ERRCODE='55000'; END IF;
  -- Rendered once and saved, so a retried finalize reads back exactly this answer.
  v_receipt:=jsonb_build_object('sheet_id',v_config.sheet_id,'config_updated_at',v_config.updated_at,'last_synced_at',v_stamp);
  -- The claim token stays as the key to that receipt. Everything that names the actor, the connection,
  -- the configuration, the ranges or the cells is cleared in this same transaction.
  UPDATE app_private.organization_sheet_sync_runs SET state='completed',actor_user_id=NULL,connection_id=NULL,config_identity=NULL,
   plan=NULL,report_rows=NULL,lease_until=NULL,completion_marker=v_marker,receipt=v_receipt,
   completed_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE organization_id=p_organization;
  RETURN jsonb_build_object('completed',true,'organization_id',p_organization,'actor_user_id',p_actor,'run_id',v_run.run_id)||v_receipt;
 END IF;
 RAISE EXCEPTION 'Unknown sheet sync transition' USING ERRCODE='22023';
END;
$$;
REVOKE ALL ON FUNCTION public.advance_organization_sheet_sync_run(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.advance_organization_sheet_sync_run(uuid,uuid,uuid,text,jsonb) TO service_role;

-- Where each scheduled worker's last batch of due organizations ended. One row per worker, moved only by the functions below.
CREATE TABLE app_private.organization_sync_discovery_cursors (
 worker text PRIMARY KEY CHECK(worker IN ('organization-calendar-sync','organization-sheet-sync')),
 -- A position in the organization id order, not a reference: the organization may since have been deleted.
 last_organization_id uuid,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO app_private.organization_sync_discovery_cursors(worker) VALUES('organization-calendar-sync'),('organization-sheet-sync');
ALTER TABLE app_private.organization_sync_discovery_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.organization_sync_discovery_cursors FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.organization_sync_discovery_cursors FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE app_private.organization_sync_discovery_cursors IS
 'For each scheduled worker, the organization id after which its next batch starts. A cursor moves when a batch is selected, whatever those syncs then do, so organizations that keep failing cannot hold the front of every run. It records what was selected, never what was synced.';

-- Counts one worker's due organizations and selects the next batch of them from one snapshot, then moves that
-- worker's cursor past the batch. It changes nothing else: no sync row, no provider state and no schedule.
-- A selected organization has been chosen for an attempt. Nothing here says the attempt was made or succeeded.
CREATE FUNCTION app_private.claim_organization_sync_discovery_batch(p_worker text,p_limit integer,p_run_started_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_after uuid; v_due bigint; v_ids uuid[];
BEGIN
 -- The run start is the caller's clock. It is accepted only close to this server's.
 IF p_worker IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 OR p_run_started_at IS NULL OR NOT isfinite(p_run_started_at)
  OR p_run_started_at<clock_timestamp()-interval '15 minutes' OR p_run_started_at>clock_timestamp()+interval '5 minutes' THEN
  RAISE EXCEPTION 'Invalid organization sync batch request' USING ERRCODE='22023';
 END IF;
 -- Callers of one worker take turns, so each reads the cursor the one before it saved. The workers do not wait for each other.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lets-assist-org-sync-discovery:'||p_worker,0));
 SELECT c.last_organization_id INTO v_after FROM app_private.organization_sync_discovery_cursors c WHERE c.worker=p_worker FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Organization sync discovery cursor is missing' USING ERRCODE='55000'; END IF;
 -- One statement, so the count and the batch describe the same rows. The batch reads on from the cursor
 -- in organization id order and wraps to the start at most once. Only the named worker's branch is read.
 WITH due AS MATERIALIZED (
  -- Calendars sync hourly.
  SELECT s.organization_id FROM public.organization_calendar_syncs s
  WHERE p_worker='organization-calendar-sync' AND s.auto_sync IS TRUE
   AND (s.last_synced_at IS NULL OR s.last_synced_at<=p_run_started_at-interval '60 minutes')
  UNION ALL
  -- Each sheet sync has its own interval: never under 15 minutes, and a day when the saved one is missing or not positive.
  SELECT DISTINCT s.organization_id FROM public.organization_sheet_syncs s
  WHERE p_worker='organization-sheet-sync' AND s.auto_sync IS TRUE
   AND (s.last_synced_at IS NULL OR s.last_synced_at<=p_run_started_at-make_interval(mins=>
    CASE WHEN s.sync_interval_minutes IS NULL OR s.sync_interval_minutes<=0 THEN 1440 ELSE greatest(s.sync_interval_minutes,15) END))
 ), ahead AS MATERIALIZED (
  SELECT d.organization_id FROM due d WHERE v_after IS NULL OR d.organization_id>v_after ORDER BY d.organization_id LIMIT p_limit
 ), wrapped AS MATERIALIZED (
  SELECT d.organization_id FROM due d WHERE v_after IS NOT NULL AND d.organization_id<=v_after ORDER BY d.organization_id
  LIMIT greatest(p_limit-(SELECT count(*) FROM ahead),0)
 )
 SELECT (SELECT count(*) FROM due),
  coalesce((SELECT array_agg(p.organization_id ORDER BY p.lap,p.organization_id)
   FROM (SELECT a.organization_id,0 AS lap FROM ahead a UNION ALL SELECT w.organization_id,1 FROM wrapped w) p),'{}'::uuid[])
 INTO v_due,v_ids;
 IF cardinality(v_ids)>0 THEN
  UPDATE app_private.organization_sync_discovery_cursors c SET last_organization_id=v_ids[cardinality(v_ids)],updated_at=clock_timestamp() WHERE c.worker=p_worker;
 END IF;
 RETURN jsonb_build_object('due_count',v_due,'organization_ids',to_jsonb(v_ids));
END;
$$;
-- Internal helper for the definer functions below: no role holds EXECUTE.
REVOKE ALL ON FUNCTION app_private.claim_organization_sync_discovery_batch(text,integer,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

-- The worker is fixed by each function, never sent by its caller.
CREATE FUNCTION public.claim_organization_calendar_sync_batch(p_limit integer,p_run_started_at timestamptz)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT app_private.claim_organization_sync_discovery_batch('organization-calendar-sync',p_limit,p_run_started_at);
$$;
REVOKE ALL ON FUNCTION public.claim_organization_calendar_sync_batch(integer,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_organization_calendar_sync_batch(integer,timestamptz) TO service_role;

CREATE FUNCTION public.claim_organization_sheet_sync_batch(p_limit integer,p_run_started_at timestamptz)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT app_private.claim_organization_sync_discovery_batch('organization-sheet-sync',p_limit,p_run_started_at);
$$;
REVOKE ALL ON FUNCTION public.claim_organization_sheet_sync_batch(integer,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_organization_sheet_sync_batch(integer,timestamptz) TO service_role;
-- The four public functions belong in the reviewed service RPC catalog. None is client callable.
COMMIT;
