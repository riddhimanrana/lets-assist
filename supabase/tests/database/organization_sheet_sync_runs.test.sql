BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(91);
SELECT extensions.ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='app_private.organization_sheet_sync_runs'::regclass),'sheet sync runs force RLS');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) r,unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p WHERE has_table_privilege(r,'app_private.organization_sheet_sync_runs',p)),'no browser or service role reads or writes saved report cells directly');
SELECT extensions.ok(bool_and(NOT has_function_privilege('anon',f,'EXECUTE') AND NOT has_function_privilege('authenticated',f,'EXECUTE') AND has_function_privilege('service_role',f,'EXECUTE')),'run RPCs are service only')
FROM unnest(ARRAY['public.claim_organization_sheet_sync_run(uuid,uuid,text,timestamptz)','public.advance_organization_sheet_sync_run(uuid,uuid,uuid,text,jsonb)']) f;
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM unnest(ARRAY['app_private.authorize_organization_sheet_sync(uuid,uuid)','app_private.organization_sheet_sync_config_identity(public.organization_sheet_syncs)',
 'app_private.guard_organization_sheet_sync_run_delete()','app_private.purge_completed_organization_sheet_sync_runs(uuid)']) f,unnest(ARRAY['anon','authenticated','service_role']) r WHERE has_function_privilege(r,f,'EXECUTE')),'private helpers and the delete guard are not executable by any API role');
SELECT extensions.ok(bool_and(proconfig=ARRAY['search_path=""']::text[]),'every run function pins an empty search_path')
FROM pg_proc WHERE oid IN ('public.claim_organization_sheet_sync_run(uuid,uuid,text,timestamptz)'::regprocedure,'public.advance_organization_sheet_sync_run(uuid,uuid,uuid,text,jsonb)'::regprocedure,
 'app_private.authorize_organization_sheet_sync(uuid,uuid)'::regprocedure,'app_private.organization_sheet_sync_config_identity(public.organization_sheet_syncs)'::regprocedure,
 'app_private.guard_organization_sheet_sync_run_delete()'::regprocedure,'app_private.purge_completed_organization_sheet_sync_runs(uuid)'::regprocedure);
SELECT extensions.ok(bool_and(prosecdef),'public run RPCs own their table access')
FROM pg_proc WHERE oid IN ('public.claim_organization_sheet_sync_run(uuid,uuid,text,timestamptz)'::regprocedure,'public.advance_organization_sheet_sync_run(uuid,uuid,uuid,text,jsonb)'::regprocedure);
SELECT extensions.ok(EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
 WHERE c.conrelid='app_private.organization_sheet_sync_runs'::regclass AND c.contype='f' AND c.confrelid='auth.users'::regclass
  AND c.confdeltype='r' AND cardinality(c.conkey)=1 AND a.attname='actor_user_id' AND NOT a.attnotnull),'the run actor is a nullable reference that restricts deleting the account');
SELECT extensions.ok(EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='app_private.organization_sheet_sync_runs'::regclass AND c.contype='f'
 AND c.confrelid='public.organizations'::regclass AND c.confdeltype='c'),'a run row leaves with its organization once the delete guard allows it');
SELECT extensions.ok(EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='app_private.organization_sheet_sync_runs'::regclass AND NOT t.tgisinternal
 AND t.tgfoid='app_private.guard_account_deletion_reference()'::regprocedure),'new run actors pass the account deletion reference fence');
SELECT extensions.ok((SELECT prosecdef FROM pg_proc WHERE oid='app_private.guard_organization_sheet_sync_run_delete()'::regprocedure)
 AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='public.organizations'::regclass AND NOT t.tgisinternal
  AND t.tgfoid='app_private.guard_organization_sheet_sync_run_delete()'::regprocedure AND t.tgtype::integer & 11=11),'the delete guard runs before each organization row is deleted');

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('c5e70000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','sheet-run-'||n||'@local.test',now(),'{}','{}',now(),now() FROM generate_series(1,3)n;
INSERT INTO public.organizations(id,name,username,type,join_code)
SELECT ('c5e71000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic sheet run '||n,'synthetic-sheet-run-'||n,'school',(994200+n)::text FROM generate_series(1,3)n;
-- User n administers organization n only. User 3 is also a plain member of organization 1.
INSERT INTO public.organization_members(organization_id,user_id,role,status)
SELECT ('c5e71000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('c5e70000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'admin','active' FROM generate_series(1,3)n;
INSERT INTO public.organization_members(organization_id,user_id,role,status) VALUES('c5e71000-0000-4000-8000-000000000001','c5e70000-0000-4000-8000-000000000003','member','active');
INSERT INTO public.user_calendar_connections(id,user_id,provider,access_token,refresh_token,token_expires_at,calendar_email,is_active,preferences,granted_scopes,granted_scopes_updated_at,connection_type)
SELECT ('c5e72000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('c5e70000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'google','fictional-access','fictional-refresh',now()+interval '1 hour','sheet-run-'||n||'@local.test',true,'{}','https://www.googleapis.com/auth/drive.file',now(),'sheets' FROM generate_series(1,3)n;
INSERT INTO public.user_google_oauth_connection_bindings(connection_id,user_id,provider,purpose,organization_id)
SELECT ('c5e72000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('c5e70000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'google','organization_sheets',('c5e71000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,3)n;
INSERT INTO public.organization_sheet_syncs(organization_id,created_by,sheet_id,sheet_url,range_a1,auto_sync)
SELECT ('c5e71000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('c5e70000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'synthetic-sheet-'||n,'https://docs.google.com/spreadsheets/d/synthetic-sheet-'||n,'A1:D9',true FROM generate_series(1,3)n;
UPDATE public.organization_sheet_syncs SET tab_name='Dev' WHERE organization_id='c5e71000-0000-4000-8000-000000000003';

CREATE TEMP TABLE sheet_run_results(label text PRIMARY KEY,data jsonb);
GRANT ALL ON sheet_run_results TO service_role;
-- Claims organization n as user n with the configuration revision saved right now.
CREATE FUNCTION pg_temp.sheet_claim(p_label text,n integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_actor uuid:=('c5e70000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; v_org uuid:=('c5e71000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; v jsonb;
BEGIN
 v:=public.claim_organization_sheet_sync_run(v_actor,v_org,'synthetic-sheet-'||n,(SELECT updated_at FROM public.organization_sheet_syncs WHERE organization_id=v_org))
  ||jsonb_build_object('actor',v_actor,'organization',v_org);
 INSERT INTO sheet_run_results VALUES(p_label,v) ON CONFLICT(label) DO UPDATE SET data=EXCLUDED.data;
 RETURN v;
END;
$$;
CREATE FUNCTION pg_temp.sheet_step(p_label text,p_step text,p_payload jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.advance_organization_sheet_sync_run((data->>'actor')::uuid,(data->>'organization')::uuid,(data->>'claim_token')::uuid,p_step,p_payload) FROM sheet_run_results WHERE label=p_label;
$$;
CREATE FUNCTION pg_temp.sheet_plan(p_changes jsonb DEFAULT '{}',p_rows jsonb DEFAULT '[["Name","Hours"],["=SUM(A1)",12.5]]',n integer DEFAULT 1) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('plan',jsonb_build_object('sheet_id','synthetic-sheet-'||n,'report_type','member-hours','tab_name','Member Hours','write_range_a1','A1:D9','stale_clear_range_a1','A1:D9',
  'ranges',jsonb_build_array('''Member Hours''!A1:B2','''Member Hours''!C1:D2'),'value_input_option','RAW')||p_changes,'rows',p_rows);
$$;
CREATE FUNCTION pg_temp.sheet_mutation(p_request integer,p_step integer,p_outcome text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('request_id','c5e7a000-0000-4000-8000-'||lpad(p_request::text,12,'0'),'step',p_step,'outcome',p_outcome));
$$;
-- Claims organization n, saves a report, completes both mutations and finalizes.
CREATE FUNCTION pg_temp.sheet_complete(p_label text,n integer,p_request integer,p_changes jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_temp.sheet_claim(p_label,n); PERFORM pg_temp.sheet_step(p_label,'plan',pg_temp.sheet_plan(p_changes,'[["Done"]]',n));
 PERFORM pg_temp.sheet_step(p_label,'begin',pg_temp.sheet_mutation(p_request,0)); PERFORM pg_temp.sheet_step(p_label,'acknowledge',pg_temp.sheet_mutation(p_request,0,'completed'));
 PERFORM pg_temp.sheet_step(p_label,'begin',pg_temp.sheet_mutation(p_request+1,1)); PERFORM pg_temp.sheet_step(p_label,'acknowledge',pg_temp.sheet_mutation(p_request+1,1,'completed'));
 RETURN pg_temp.sheet_step(p_label,'finalize');
END;
$$;

SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.claim_organization_sheet_sync_run('c5e70000-0000-4000-8000-000000000003','c5e71000-0000-4000-8000-000000000001','synthetic-sheet-1',(SELECT updated_at FROM public.organization_sheet_syncs WHERE organization_id='c5e71000-0000-4000-8000-000000000001'))$$,'42501',NULL,'a member who is not an admin cannot claim');
SELECT extensions.throws_ok($$SELECT public.claim_organization_sheet_sync_run('c5e70000-0000-4000-8000-000000000001','c5e71000-0000-4000-8000-000000000002','synthetic-sheet-2',(SELECT updated_at FROM public.organization_sheet_syncs WHERE organization_id='c5e71000-0000-4000-8000-000000000002'))$$,'42501',NULL,'an admin of one organization cannot claim another');
SELECT extensions.throws_ok($$SELECT public.claim_organization_sheet_sync_run('c5e70000-0000-4000-8000-000000000001','c5e71000-0000-4000-8000-000000000001','synthetic-sheet-1','2001-01-01 00:00:00+00')$$,'55000',NULL,'a stale configuration revision cannot claim');
SELECT extensions.throws_ok($$SELECT public.claim_organization_sheet_sync_run('c5e70000-0000-4000-8000-000000000001','c5e71000-0000-4000-8000-000000000001','synthetic-sheet-2',(SELECT updated_at FROM public.organization_sheet_syncs WHERE organization_id='c5e71000-0000-4000-8000-000000000001'))$$,'55000',NULL,'another destination cannot claim');
SELECT extensions.is(pg_temp.sheet_claim('one',1)->>'status','claimed','the first caller claims the organization');
SELECT extensions.is(pg_temp.sheet_claim('second',1),jsonb_build_object('status','busy','actor','c5e70000-0000-4000-8000-000000000001','organization','c5e71000-0000-4000-8000-000000000001'),'a second caller is refused while the claim is held and receives no token');
SELECT extensions.throws_ok($$SELECT public.advance_organization_sheet_sync_run('c5e70000-0000-4000-8000-000000000001','c5e71000-0000-4000-8000-000000000001',gen_random_uuid(),'plan',pg_temp.sheet_plan())$$,'55000',NULL,'an unknown claim token cannot advance the run');
SELECT extensions.throws_ok($$SELECT public.advance_organization_sheet_sync_run('c5e70000-0000-4000-8000-000000000002','c5e71000-0000-4000-8000-000000000001',(SELECT (data->>'claim_token')::uuid FROM sheet_run_results WHERE label='one'),'plan',pg_temp.sheet_plan())$$,'55000',NULL,'another actor cannot use the claim');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','begin',pg_temp.sheet_mutation(1,0))$$,'55000',NULL,'no mutation begins before the report is saved');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','plan',pg_temp.sheet_plan('{"value_input_option":"USER_ENTERED"}'))$$,'22023',NULL,'a report that would be evaluated as formulas is refused');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','plan',pg_temp.sheet_plan('{}','[["Name",true]]'))$$,'22023',NULL,'a boolean cell is refused');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','plan',pg_temp.sheet_plan('{}','[["Name",null]]'))$$,'22023',NULL,'a null cell is refused');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','plan',pg_temp.sheet_plan('{}','[["Name",{"formula":"=1"}]]'))$$,'22023',NULL,'an object cell is refused');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','plan',pg_temp.sheet_plan('{}','["Name"]'))$$,'22023',NULL,'a row that is not an array is refused');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','plan',pg_temp.sheet_plan('{"ranges":["a","b","c","d"]}'))$$,'22023',NULL,'more than one write and two clears is refused');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','plan',pg_temp.sheet_plan('{"sheet_id":"synthetic-sheet-2"}'))$$,'22023',NULL,'a report for another spreadsheet is refused');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','plan',pg_temp.sheet_plan('{"access_token":"fictional"}'))$$,'22023',NULL,'an unreviewed plan field is refused');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','plan',pg_temp.sheet_plan('{}',(SELECT jsonb_agg(jsonb_build_array('x')) FROM generate_series(1,10001))))$$,'22023',NULL,'more than 10,000 rows is refused');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','plan',pg_temp.sheet_plan('{}',(SELECT jsonb_agg(r) FROM (SELECT (SELECT jsonb_agg('x'::text) FROM generate_series(1,100)) r FROM generate_series(1,1001)) s)))$$,'22023',NULL,'more than 100,000 cells is refused');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','plan',pg_temp.sheet_plan('{}',(SELECT jsonb_agg(jsonb_build_array(repeat('x',1024))) FROM generate_series(1,8200))))$$,'22023',NULL,'more than 8 MiB of cells is refused');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','plan',pg_temp.sheet_plan('{"tab_name":"Another Tab"}'))$$,'22023',NULL,'a tab other than the saved one is refused');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','plan',pg_temp.sheet_plan('{"ranges":["''Member Hours''!A1:B"]}'))$$,'22023',NULL,'a range with an open end is refused');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','plan',pg_temp.sheet_plan('{"ranges":["''Another Tab''!A1:B2"]}'))$$,'22023',NULL,'a range on a tab the configuration does not name is refused');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','plan',pg_temp.sheet_plan('{"ranges":["''Member Hours''!A1:B2","''Another Tab''!C1:D2"]}'))$$,'22023',NULL,'ranges on two tabs are refused');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','plan',pg_temp.sheet_plan('{"write_range_a1":"B2:E9"}'))$$,'22023',NULL,'a write range other than the saved one is refused');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','plan',pg_temp.sheet_plan('{"stale_clear_range_a1":"A1:Z500"}'))$$,'22023',NULL,'a stale-cell range other than the saved one is refused');
SELECT extensions.is(pg_temp.sheet_step('one','plan',pg_temp.sheet_plan())->>'step_count','2','the report and its ranges are saved before any mutation');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','plan',pg_temp.sheet_plan('{}','[["Replaced"]]'))$$,'55000',NULL,'a saved report cannot be overwritten');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','finalize')$$,'55000',NULL,'completion is refused while mutations are pending');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','begin',pg_temp.sheet_mutation(1,1))$$,'22023',NULL,'a mutation cannot skip ahead of the saved order');
SELECT extensions.is(pg_temp.sheet_step('one','begin',pg_temp.sheet_mutation(1,0))->>'begun','true','the first mutation is recorded before it is sent');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','begin',pg_temp.sheet_mutation(2,0))$$,'55000',NULL,'a second mutation cannot begin while one is unacknowledged');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','acknowledge',pg_temp.sheet_mutation(2,0,'completed'))$$,'55000',NULL,'another request cannot acknowledge the open mutation');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','finalize')$$,'55000',NULL,'completion is refused while a mutation is unacknowledged');
SELECT extensions.is(pg_temp.sheet_step('one','acknowledge',pg_temp.sheet_mutation(1,0,'rejected'))->>'acknowledged','true','a definite rejection is acknowledged');
SELECT extensions.is(pg_temp.sheet_step('one','release')->>'released','true','a run with nothing in flight releases its claim');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','begin',pg_temp.sheet_mutation(3,0))$$,'55000',NULL,'a released claim cannot begin a mutation');
RESET ROLE;
SELECT extensions.is((SELECT report_rows FROM app_private.organization_sheet_sync_runs WHERE organization_id='c5e71000-0000-4000-8000-000000000001'),'[["Name","Hours"],["=SUM(A1)",12.5]]'::jsonb,'release keeps the saved report exactly');
INSERT INTO sheet_run_results SELECT 'first-run',jsonb_build_object('run_id',run_id) FROM app_private.organization_sheet_sync_runs WHERE organization_id='c5e71000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT extensions.is(pg_temp.sheet_claim('one',1)-'claim_token'-'actor'-'organization',jsonb_build_object('status','resume','run_id',(SELECT data->>'run_id' FROM sheet_run_results WHERE label='first-run'),'plan',pg_temp.sheet_plan()->'plan','rows','[["Name","Hours"],["=SUM(A1)",12.5]]'::jsonb),'a retry resumes the same run and receives the saved report unchanged');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','plan',pg_temp.sheet_plan('{}','[["Rebuilt"]]'))$$,'55000',NULL,'a resumed run cannot replace its report');
DO $$BEGIN
 PERFORM pg_temp.sheet_step('one','begin',pg_temp.sheet_mutation(4,0)); PERFORM pg_temp.sheet_step('one','acknowledge',pg_temp.sheet_mutation(4,0,'completed'));
 PERFORM pg_temp.sheet_step('one','begin',pg_temp.sheet_mutation(5,1)); PERFORM pg_temp.sheet_step('one','acknowledge',pg_temp.sheet_mutation(5,1,'completed'));
END$$;
INSERT INTO sheet_run_results VALUES('receipt',pg_temp.sheet_step('one','finalize'));
SELECT extensions.is((SELECT data-'last_synced_at'-'config_updated_at' FROM sheet_run_results WHERE label='receipt'),jsonb_build_object('completed',true,'organization_id','c5e71000-0000-4000-8000-000000000001','actor_user_id','c5e70000-0000-4000-8000-000000000001','run_id',(SELECT data->>'run_id' FROM sheet_run_results WHERE label='first-run'),'sheet_id','synthetic-sheet-1'),'completion returns an exact receipt for the actor, organization, destination and run');
SELECT extensions.ok((SELECT last_synced_at IS NOT NULL FROM public.organization_sheet_syncs WHERE organization_id='c5e71000-0000-4000-8000-000000000001'),'completion stamps the claimed configuration in the same transaction');
SELECT extensions.ok((SELECT last_synced_at IS NULL FROM public.organization_sheet_syncs WHERE organization_id='c5e71000-0000-4000-8000-000000000002'),'another organization is not stamped');
-- A finalize whose answer was lost is asked again with the same claim. It reads the saved receipt back.
SELECT extensions.is(pg_temp.sheet_step('one','finalize'),(SELECT data FROM sheet_run_results WHERE label='receipt'),'a repeated finalize for the same claim returns the identical receipt');
SELECT extensions.is(pg_temp.sheet_step('one','release'),'{"released":true,"status":"completed"}'::jsonb,'release after completion changes nothing');
SELECT extensions.is(pg_temp.sheet_step('one','finalize'),(SELECT data FROM sheet_run_results WHERE label='receipt'),'release cannot erase the completion receipt');
SELECT extensions.is((SELECT last_synced_at FROM public.organization_sheet_syncs WHERE organization_id='c5e71000-0000-4000-8000-000000000001'),(SELECT (data->>'last_synced_at')::timestamptz FROM sheet_run_results WHERE label='receipt'),'a repeated finalize does not stamp the configuration again');
SELECT extensions.throws_ok($$SELECT public.advance_organization_sheet_sync_run('c5e70000-0000-4000-8000-000000000002','c5e71000-0000-4000-8000-000000000001',(SELECT (data->>'claim_token')::uuid FROM sheet_run_results WHERE label='one'),'finalize')$$,'55000',NULL,'another actor cannot read the receipt with the completing claim');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','begin',pg_temp.sheet_mutation(12,0))$$,'55000',NULL,'a finished claim cannot begin another mutation');
RESET ROLE;
SELECT extensions.is((SELECT state||':'||(report_rows IS NULL AND plan IS NULL AND actor_user_id IS NULL AND connection_id IS NULL AND config_identity IS NULL)::text||':'||(claim_token IS NOT NULL)::text FROM app_private.organization_sheet_sync_runs WHERE organization_id='c5e71000-0000-4000-8000-000000000001'),'completed:true:true','a finished run holds no cells, plan, actor, connection or configuration, and keeps its claim as the receipt key');
SELECT extensions.is((SELECT array_agg(k ORDER BY k) FROM app_private.organization_sheet_sync_runs r,jsonb_object_keys(r.receipt) k WHERE r.organization_id='c5e71000-0000-4000-8000-000000000001'),ARRAY['config_updated_at','last_synced_at','sheet_id']::text[],'the saved receipt names the destination, its revision and the sync time only');
INSERT INTO sheet_run_results SELECT 'one-done',data FROM sheet_run_results WHERE label='one';
SET LOCAL ROLE service_role;

-- A request begun and never acknowledged stays blocked after its lease ends.
SELECT extensions.isnt(pg_temp.sheet_claim('one',1)->>'run_id',(SELECT data->>'run_id' FROM sheet_run_results WHERE label='first-run'),'the next sync is a new run');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one-done','finalize')$$,'55000',NULL,'a new run ends the finished claim: it can no longer read a receipt');
DO $$BEGIN PERFORM pg_temp.sheet_step('one','plan',pg_temp.sheet_plan()); PERFORM pg_temp.sheet_step('one','begin',pg_temp.sheet_mutation(6,0)); END$$;
RESET ROLE;
UPDATE app_private.organization_sheet_sync_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE organization_id='c5e71000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','begin',pg_temp.sheet_mutation(7,0))$$,'55000',NULL,'an expired worker cannot begin another mutation');
SELECT extensions.is(pg_temp.sheet_claim('retry',1)->>'status','outcome_unknown','an expired lease with a request in flight is not taken over');
SELECT extensions.is(pg_temp.sheet_claim('retry',1)->>'claim_token',NULL,'a blocked organization hands out no claim');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('one','acknowledge',pg_temp.sheet_mutation(6,0,'completed'))$$,'55000',NULL,'a quarantined mutation is not relabelled by a late acknowledgement');
SELECT extensions.is(pg_temp.sheet_step('one','release')->>'released','false','release does not clear an unacknowledged mutation');
RESET ROLE;
UPDATE public.organization_sheet_syncs SET sheet_id='synthetic-sheet-1',range_a1='B2:E9',updated_at=updated_at+interval '1 hour' WHERE organization_id='c5e71000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT extensions.is(pg_temp.sheet_claim('retry',1)->>'status','outcome_unknown','a new configuration cannot replace a run with an uncertain mutation');
RESET ROLE;
SELECT extensions.is((SELECT state||':'||inflight_step::text||':'||(report_rows IS NOT NULL)::text FROM app_private.organization_sheet_sync_runs WHERE organization_id='c5e71000-0000-4000-8000-000000000001'),'outcome_unknown:0:true','the uncertain mutation and its report stay recorded');
SET LOCAL ROLE service_role;

-- With nothing in flight, an expired lease is taken over with the saved report.
DO $$BEGIN PERFORM pg_temp.sheet_claim('two',2); PERFORM pg_temp.sheet_step('two','plan',pg_temp.sheet_plan('{}','[["Saved"]]',2)); END$$;
RESET ROLE;
UPDATE app_private.organization_sheet_sync_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE organization_id='c5e71000-0000-4000-8000-000000000002';
INSERT INTO sheet_run_results SELECT 'two-old',data FROM sheet_run_results WHERE label='two';
SET LOCAL ROLE service_role;
SELECT extensions.is(pg_temp.sheet_claim('two',2)->'rows','[["Saved"]]'::jsonb,'a safe takeover reuses the saved report');
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('two-old','begin',pg_temp.sheet_mutation(8,0))$$,'55000',NULL,'the replaced claim cannot mutate');
-- The configuration changes while the run is held: nothing more goes to the old one.
RESET ROLE;
UPDATE public.organization_sheet_syncs SET range_a1='B2:E9',updated_at=updated_at+interval '1 hour' WHERE organization_id='c5e71000-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('two','begin',pg_temp.sheet_mutation(9,0))$$,'55000',NULL,'no mutation begins for a configuration that has changed');
SELECT extensions.is(pg_temp.sheet_step('two','release')->>'released','true','the old run releases without touching its report');
SELECT extensions.is(pg_temp.sheet_claim('two',2)->>'status','claimed','a new configuration starts a new run when nothing is uncertain');
RESET ROLE;
SELECT extensions.is((SELECT state||':'||(report_rows IS NULL)::text FROM app_private.organization_sheet_sync_runs WHERE organization_id='c5e71000-0000-4000-8000-000000000002'),'claimed:true','the superseded report is not carried into the new configuration');
UPDATE public.user_calendar_connections SET is_active=false WHERE id='c5e72000-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_step('two','plan',pg_temp.sheet_plan('{}','[["After disconnect"]]',2))$$,'42501',NULL,'a deactivated Google connection cannot save a report under an existing claim');
RESET ROLE;

-- Deletion and retention. Organization 1 has an uncertain mutation and organization 2 a held claim.
SELECT extensions.throws_ok($$DELETE FROM public.organizations WHERE id='c5e71000-0000-4000-8000-000000000001'$$,'55006',NULL,'an organization with an unresolved run cannot be deleted');
SELECT extensions.throws_ok($$DELETE FROM public.organizations WHERE id='c5e71000-0000-4000-8000-000000000002'$$,'55006',NULL,'an organization with a held claim cannot be deleted');
SET LOCAL ROLE service_role;
SELECT extensions.is(pg_temp.sheet_step('two','release')->>'released','true','a claim that saved nothing is released');
-- Organization 3 saved a tab named "Dev". Trimming whitespace must leave its last letter alone.
SELECT extensions.is(pg_temp.sheet_complete('three',3,20,'{"tab_name":"Dev","ranges":["''Dev''!A1:B2","''Dev''!C1:D2"]}')->>'completed','true','a third organization completes a run on its saved tab, Dev');
-- Every authorized claim sweeps old receipts of other organizations, whatever it then answers.
SELECT extensions.is(pg_temp.sheet_claim('retry',1)->>'status','outcome_unknown','the blocked organization still answers outcome_unknown');
RESET ROLE;
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM app_private.organization_sheet_sync_runs WHERE organization_id='c5e71000-0000-4000-8000-000000000002'),'releasing a claim that saved nothing leaves no run row behind');
SELECT extensions.is((SELECT state FROM app_private.organization_sheet_sync_runs WHERE organization_id='c5e71000-0000-4000-8000-000000000003'),'completed','a receipt newer than 30 days is kept');
UPDATE app_private.organization_sheet_sync_runs SET completed_at=clock_timestamp()-interval '31 days' WHERE organization_id='c5e71000-0000-4000-8000-000000000003';
UPDATE app_private.organization_sheet_sync_runs SET planned_at=clock_timestamp()-interval '60 days',updated_at=clock_timestamp()-interval '60 days' WHERE organization_id='c5e71000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
DO $$BEGIN PERFORM pg_temp.sheet_claim('retry',1); END$$;
RESET ROLE;
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM app_private.organization_sheet_sync_runs WHERE organization_id='c5e71000-0000-4000-8000-000000000003'),'a receipt older than 30 days is removed by a later claim');
SELECT extensions.is((SELECT state FROM app_private.organization_sheet_sync_runs WHERE organization_id='c5e71000-0000-4000-8000-000000000001'),'outcome_unknown','an unresolved run is never removed, however old it is');
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT pg_temp.sheet_complete('three-wrong',3,40,'{"tab_name":"De","ranges":["''De''!A1:B2","''De''!C1:D2"]}')$$,'22023',NULL,'a tab that is the saved one with a letter trimmed off is refused');
SELECT extensions.is(pg_temp.sheet_complete('three',3,30,'{"tab_name":"Dev","ranges":["''Dev''!A1:B2","''Dev''!C1:D2"]}')->>'completed','true','the organization completes a new run after its old receipt was removed');
RESET ROLE;
SELECT extensions.lives_ok($$DELETE FROM public.organizations WHERE id='c5e71000-0000-4000-8000-000000000003'$$,'an organization whose run is finished can be deleted');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM app_private.organization_sheet_sync_runs WHERE organization_id='c5e71000-0000-4000-8000-000000000003'),'the finished run leaves with its organization');
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok($$SELECT public.claim_organization_sheet_sync_run('c5e70000-0000-4000-8000-000000000001','c5e71000-0000-4000-8000-000000000001','synthetic-sheet-1',now())$$,'42501',NULL,'a browser role cannot call the claim');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
