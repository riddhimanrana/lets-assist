BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(39);
SELECT extensions.ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='app_private.organization_calendar_event_receipts'::regclass),'organization event receipts force RLS');
SELECT extensions.ok(NOT has_table_privilege('authenticated','app_private.organization_calendar_event_receipts','SELECT'),'browser cannot inspect provider receipt state');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM unnest(ARRAY['public.claim_organization_calendar_sync(uuid,uuid,text)','public.advance_organization_calendar_sync(uuid,uuid,uuid,text,jsonb)']) f,unnest(ARRAY['anon','authenticated']) r WHERE has_function_privilege(r,f,'EXECUTE')),'event RPCs reject browser impersonation');
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('ff000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','org-event-'||n||'@local.test',now(),'{}','{}',now(),now() FROM generate_series(1,2)n;
INSERT INTO public.organizations(id,name,username,type,join_code) VALUES('ff100000-0000-4000-8000-000000000001','Synthetic event organization','synthetic-event-organization','school','994104'),('ff100000-0000-4000-8000-000000000002','Other synthetic organization','synthetic-other-event-organization','school','994105');
INSERT INTO public.organization_members(organization_id,user_id,role,status) VALUES('ff100000-0000-4000-8000-000000000001','ff000000-0000-4000-8000-000000000001','admin','active');
INSERT INTO public.user_calendar_connections(id,user_id,provider,access_token,refresh_token,token_expires_at,calendar_email,is_active,preferences,granted_scopes,connection_type)
VALUES('ff200000-0000-4000-8000-000000000001','ff000000-0000-4000-8000-000000000001','google','fictional','fictional',now()+interval '1 hour','org-event@local.test',true,'{}','https://www.googleapis.com/auth/calendar.app.created','calendar');
INSERT INTO public.user_google_oauth_connection_bindings(connection_id,user_id,provider,purpose,organization_id)
VALUES('ff200000-0000-4000-8000-000000000001','ff000000-0000-4000-8000-000000000001','google','organization_calendar','ff100000-0000-4000-8000-000000000001');
INSERT INTO app_private.organization_calendar_destinations(organization_id,owner_user_id,connection_id,state,calendar_id)
VALUES('ff100000-0000-4000-8000-000000000001','ff000000-0000-4000-8000-000000000001','ff200000-0000-4000-8000-000000000001','ready','current@example.test');
INSERT INTO public.projects(id,creator_id,organization_id,title,location,description,event_type,verification_method,schedule,require_login,status,visibility,workflow_status)
SELECT ('ff300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ff000000-0000-4000-8000-000000000001',CASE WHEN n=3 THEN 'ff100000-0000-4000-8000-000000000002'::uuid ELSE 'ff100000-0000-4000-8000-000000000001'::uuid END,'Synthetic calendar event','Local','Synthetic','oneTime','manual','{"oneTime":{"date":"2030-10-10","startTime":"10:00","endTime":"12:00","volunteers":20}}',true,'upcoming','public','published' FROM generate_series(1,3)n;
CREATE TEMP TABLE org_event_results(label text PRIMARY KEY,data jsonb);
GRANT ALL ON org_event_results TO service_role;
CREATE FUNCTION pg_temp.org_event_step(p_step text,p_payload jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.advance_organization_calendar_sync('ff000000-0000-4000-8000-000000000001','ff100000-0000-4000-8000-000000000001',(data#>>'{}')::uuid,p_step,p_payload) FROM org_event_results WHERE label='claim';
$$;
CREATE FUNCTION pg_temp.org_event_plan(p_title text DEFAULT 'First') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('source_kinds',jsonb_build_array('project_schedule'),'events',jsonb_build_array(jsonb_build_object('source_kind','project_schedule','source_id','ff300000-0000-4000-8000-000000000001','occurrence_key','oneTime','event',jsonb_build_object('summary',p_title))));
$$;
CREATE FUNCTION pg_temp.org_event_confirm() RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.org_event_step('complete',jsonb_build_object('receipt_id',id,'event_id',event_id)) FROM app_private.organization_calendar_event_receipts WHERE source_id='ff300000-0000-4000-8000-000000000001';
$$;
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.claim_organization_calendar_sync('ff000000-0000-4000-8000-000000000002','ff100000-0000-4000-8000-000000000001','current@example.test')$$,'42501',NULL,'non-admin cannot start organization provider work');
SELECT extensions.throws_ok($$SELECT public.claim_organization_calendar_sync('ff000000-0000-4000-8000-000000000001','ff100000-0000-4000-8000-000000000001','different@example.test')$$,'55000',NULL,'calendar must equal authoritative destination');
INSERT INTO org_event_results VALUES('claim',to_jsonb(public.claim_organization_calendar_sync('ff000000-0000-4000-8000-000000000001','ff100000-0000-4000-8000-000000000001','current@example.test')));
SELECT extensions.throws_ok($$SELECT public.claim_organization_calendar_sync('ff000000-0000-4000-8000-000000000001','ff100000-0000-4000-8000-000000000001','current@example.test')$$,'55P03',NULL,'concurrent workers cannot plan conflicting snapshots');
SELECT extensions.throws_ok($$SELECT pg_temp.org_event_step('plan','{"source_kinds":[null],"events":[]}')$$,'22023',NULL,'null source kinds fail closed');
SELECT extensions.throws_ok($$SELECT pg_temp.org_event_step('plan','{"source_kinds":["project_schedule","project_schedule"],"events":[]}')$$,'22023',NULL,'duplicate source kinds fail closed');
SELECT extensions.throws_ok($$SELECT pg_temp.org_event_step('plan',jsonb_set(pg_temp.org_event_plan(),'{events,0,source_id}','"ff300000-0000-4000-8000-000000000003"'))$$,'55000',NULL,'cross-organization source cannot be exported');
SELECT extensions.throws_ok($$SELECT pg_temp.org_event_step('plan',jsonb_set(pg_temp.org_event_plan(),'{events,0,occurrence_key}','"invented"'))$$,'55000',NULL,'invented project occurrence cannot be exported');
SELECT extensions.lives_ok($$SELECT pg_temp.org_event_step('plan',pg_temp.org_event_plan())$$,'complete desired snapshot is saved before provider work');
SELECT extensions.is((SELECT count(*) FROM public.organization_calendar_events WHERE organization_id='ff100000-0000-4000-8000-000000000001'),0::bigint,'planning does not claim confirmed provider delivery');
SELECT extensions.is((SELECT phase FROM app_private.organization_calendar_event_receipts WHERE source_id='ff300000-0000-4000-8000-000000000001'),'pending_create','first event is a durable pending create');
SELECT extensions.ok((SELECT event_id~'^la[0-9a-f]+$' FROM app_private.organization_calendar_event_receipts WHERE source_id='ff300000-0000-4000-8000-000000000001'),'saved event ID has Google-compatible syntax');
INSERT INTO org_event_results VALUES('first',pg_temp.org_event_step('next'));
SELECT extensions.throws_ok($$SELECT pg_temp.org_event_step('finish')$$,'55000',NULL,'pending provider work cannot claim completion');
SELECT extensions.lives_ok($$SELECT pg_temp.org_event_step('plan',pg_temp.org_event_plan('Second'))$$,'new source snapshot queues behind unresolved provider payload');
SELECT extensions.is((SELECT event_payload->>'summary' FROM app_private.organization_calendar_event_receipts WHERE source_id='ff300000-0000-4000-8000-000000000001'),'First','pending payload is immutable on retry');
SELECT extensions.is((SELECT desired_payload->>'summary' FROM app_private.organization_calendar_event_receipts WHERE source_id='ff300000-0000-4000-8000-000000000001'),'Second','latest desired payload is retained separately');
SELECT extensions.lives_ok($$SELECT pg_temp.org_event_confirm()$$,'provider confirmation atomically stores the binding');
SELECT extensions.is((SELECT phase FROM app_private.organization_calendar_event_receipts WHERE source_id='ff300000-0000-4000-8000-000000000001'),'pending_update','newer desired payload remains queued after old create confirmation');
SELECT extensions.is((SELECT event_payload->>'summary' FROM app_private.organization_calendar_event_receipts WHERE source_id='ff300000-0000-4000-8000-000000000001'),'Second','next write uses the new immutable payload');
SELECT extensions.is((SELECT count(*) FROM public.organization_calendar_events WHERE organization_id='ff100000-0000-4000-8000-000000000001'),1::bigint,'provider confirmation records one compatibility binding');
DO $$BEGIN PERFORM pg_temp.org_event_confirm(); END$$;
SELECT extensions.is(pg_temp.org_event_step('next'),'null'::jsonb,'settled queue has no duplicate provider writes');
SELECT extensions.throws_ok($$SELECT pg_temp.org_event_step('plan','{"source_kinds":["project_schedule"],"events":[]}')$$,'55000',NULL,'incomplete source snapshot cannot delete a still-publishable event');
SELECT extensions.lives_ok($$SELECT pg_temp.org_event_step('plan',pg_temp.org_event_plan('Second'))$$,'unchanged snapshot is idempotent');
SELECT extensions.is(pg_temp.org_event_step('next'),'null'::jsonb,'unchanged event is not rewritten');
UPDATE app_private.organization_calendar_event_receipts SET confirmed_at=clock_timestamp()-interval '25 hours' WHERE source_id='ff300000-0000-4000-8000-000000000001';
DO $$BEGIN PERFORM pg_temp.org_event_step('plan',pg_temp.org_event_plan('Second')); END$$;
SELECT extensions.is(pg_temp.org_event_step('next')->>'phase','pending_update','daily provider reconciliation detects unchanged-source drift');
DO $$BEGIN PERFORM pg_temp.org_event_confirm(); END$$;
DO $$BEGIN PERFORM pg_temp.org_event_step('finish'); END$$;
UPDATE org_event_results SET data=to_jsonb(public.claim_organization_calendar_sync('ff000000-0000-4000-8000-000000000001','ff100000-0000-4000-8000-000000000001','current@example.test')) WHERE label='claim';
INSERT INTO app_private.organization_calendar_event_receipts(organization_id,calendar_id,source_kind,source_id,occurrence_key,event_id,phase)
VALUES('ff100000-0000-4000-8000-000000000001','current@example.test','csf_deadline','ff400000-0000-4000-8000-000000000001','primary','csfretained','synced');
DELETE FROM public.projects WHERE id='ff300000-0000-4000-8000-000000000001';
SELECT extensions.is((SELECT count(*) FROM public.organization_calendar_events WHERE organization_id='ff100000-0000-4000-8000-000000000001'),0::bigint,'project deletion cascades only the compatibility binding');
SELECT extensions.is((SELECT count(*) FROM app_private.organization_calendar_event_receipts WHERE source_id='ff300000-0000-4000-8000-000000000001'),1::bigint,'provider cleanup survives project deletion');
DO $$BEGIN PERFORM pg_temp.org_event_step('plan','{"source_kinds":["project_schedule"],"events":[]}'); END$$;
SELECT extensions.is(pg_temp.org_event_step('next')->>'phase','pending_remove','orphaned external event is scheduled for cleanup');
SELECT extensions.is((SELECT phase FROM app_private.organization_calendar_event_receipts WHERE source_kind='csf_deadline'),'synced','project sync cannot retire CSF projections');
DO $$BEGIN PERFORM pg_temp.org_event_confirm(); END$$;
SELECT extensions.is((SELECT phase FROM app_private.organization_calendar_event_receipts WHERE source_id='ff300000-0000-4000-8000-000000000001'),'removed','cleanup confirmation retains a removed receipt');
INSERT INTO public.projects(id,creator_id,organization_id,title,location,description,event_type,verification_method,schedule,require_login,status,visibility,workflow_status)
VALUES('ff300000-0000-4000-8000-000000000001','ff000000-0000-4000-8000-000000000001','ff100000-0000-4000-8000-000000000001','Synthetic restored project','Local','Synthetic','oneTime','manual','{"oneTime":{"date":"2030-10-10","startTime":"10:00","endTime":"12:00","volunteers":20}}',true,'upcoming','public','published');
DO $$BEGIN PERFORM pg_temp.org_event_step('plan',pg_temp.org_event_plan('Restored')); END$$;
SELECT extensions.isnt((SELECT event_id FROM app_private.organization_calendar_event_receipts WHERE source_id='ff300000-0000-4000-8000-000000000001'),(SELECT data->>'event_id' FROM org_event_results WHERE label='first'),'re-add does not reuse a tombstoned Google ID');
SELECT extensions.throws_ok($$SELECT pg_temp.org_event_step('complete',jsonb_build_object('receipt_id',(SELECT data->>'id' FROM org_event_results WHERE label='first'),'event_id',(SELECT data->>'event_id' FROM org_event_results WHERE label='first')))$$,'55000',NULL,'stale generation cannot confirm a new event');
DO $$BEGIN PERFORM pg_temp.org_event_confirm(); END$$;
DO $$BEGIN PERFORM pg_temp.org_event_step('plan',pg_temp.org_event_plan('Updated')); END$$;
INSERT INTO org_event_results VALUES('before-missing',pg_temp.org_event_step('next'));
DO $$BEGIN PERFORM pg_temp.org_event_step('missing',jsonb_build_object('receipt_id',(SELECT data->>'id' FROM org_event_results WHERE label='before-missing'),'event_id',(SELECT data->>'event_id' FROM org_event_results WHERE label='before-missing'))); END$$;
SELECT extensions.isnt((SELECT event_id FROM app_private.organization_calendar_event_receipts WHERE source_id='ff300000-0000-4000-8000-000000000001'),(SELECT data->>'event_id' FROM org_event_results WHERE label='before-missing'),'confirmed missing provider event receives a fresh saved ID');
SELECT extensions.is((SELECT phase FROM app_private.organization_calendar_event_receipts WHERE source_id='ff300000-0000-4000-8000-000000000001'),'pending_create','missing-event recovery creates instead of blindly updating');
UPDATE app_private.organization_calendar_sync_leases SET lease_until=clock_timestamp()-interval '1 second' WHERE organization_id='ff100000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.org_event_step('renew')$$,'55000',NULL,'expired worker cannot renew its own lease');
SELECT extensions.lives_ok($$SELECT public.claim_organization_calendar_sync('ff000000-0000-4000-8000-000000000001','ff100000-0000-4000-8000-000000000001','current@example.test')$$,'retry can take over expired lease without erasing receipts');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok($$SELECT public.claim_organization_calendar_sync('ff000000-0000-4000-8000-000000000001','ff100000-0000-4000-8000-000000000001','current@example.test')$$,'42501',NULL,'authenticated cannot call the provider-work claim');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
