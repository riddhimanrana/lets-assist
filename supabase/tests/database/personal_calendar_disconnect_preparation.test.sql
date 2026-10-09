BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(40);
SELECT extensions.ok(NOT has_function_privilege('anon','public.prepare_personal_calendar_disconnect(uuid,uuid,timestamptz)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.prepare_personal_calendar_disconnect(uuid,uuid,timestamptz)','EXECUTE'), 'browser roles cannot prepare another actor disconnect');
SELECT extensions.ok(has_function_privilege('service_role','public.prepare_personal_calendar_disconnect(uuid,uuid,timestamptz)','EXECUTE'), 'service role can prepare metadata');
SELECT extensions.ok((SELECT NOT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc
  WHERE oid='public.prepare_personal_calendar_disconnect(uuid,uuid,timestamptz)'::regprocedure), 'preparation uses invoker privileges and fixed search path');
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('d1710000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','disconnect-'||n||'@local.test',now(),'{}','{}',now(),now() FROM generate_series(1,3) n;
INSERT INTO public.user_calendar_connections(id,user_id,provider,access_token,refresh_token,token_expires_at,calendar_email,is_active,preferences,granted_scopes,connection_type)
SELECT ('d1711000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('d1710000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'google','fictional-access','fictional-refresh',now()+interval '1 hour','disconnect-'||n||'@local.test',false,
 '{"volunteering_calendar_id":"legacy@example.test","theme":"keep"}','https://www.googleapis.com/auth/calendar.app.created','calendar' FROM generate_series(1,3) n;
INSERT INTO public.user_google_oauth_connection_bindings(connection_id,user_id,provider,purpose)
SELECT ('d1711000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('d1710000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'google','personal_calendar' FROM generate_series(1,2) n;
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,require_login,status,visibility,workflow_status,creator_calendar_event_id)
SELECT ('d1712000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'d1710000-0000-4000-8000-000000000001','Synthetic disconnect project','Local','Synthetic','oneTime','manual',
 '{"oneTime":{"date":"2030-10-10","startTime":"10:00","endTime":"12:00","volunteers":20}}',true,'upcoming','public','published','legacyevent'||n FROM generate_series(1,2) n;
INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status,volunteer_calendar_event_id)
VALUES('d1713000-0000-4000-8000-000000000001','d1712000-0000-4000-8000-000000000002','d1710000-0000-4000-8000-000000000001','oneTime','approved','legacysignup');
INSERT INTO app_private.personal_calendar_sync_receipts(source_kind,source_id,user_id,project_id,phase,calendar_id,events,confirmed_event_ids)
VALUES('project','d1712000-0000-4000-8000-000000000002','d1710000-0000-4000-8000-000000000001','d1712000-0000-4000-8000-000000000002','synced','stored@example.test','[{"id":"legacyevent2","event":{"summary":"Keep existing"}}]',ARRAY['legacyevent2']);
INSERT INTO app_private.personal_calendar_sync_receipts(source_kind,source_id,user_id,project_id,phase,legacy_event_id)
VALUES('project','d1712000-0000-4000-8000-000000000008','d1710000-0000-4000-8000-000000000001','d1712000-0000-4000-8000-000000000008','removing','legacyorphan'),
 ('project','d1712000-0000-4000-8000-000000000009','d1710000-0000-4000-8000-000000000001','d1712000-0000-4000-8000-000000000009','removed','removedlegacy');
CREATE TEMP TABLE disconnect_snapshots(label text PRIMARY KEY,data jsonb);
GRANT ALL ON disconnect_snapshots TO service_role;
INSERT INTO disconnect_snapshots SELECT 'synced',to_jsonb(r) FROM app_private.personal_calendar_sync_receipts r WHERE source_id='d1712000-0000-4000-8000-000000000002';
INSERT INTO disconnect_snapshots SELECT 'removed',to_jsonb(r) FROM app_private.personal_calendar_sync_receipts r WHERE source_id='d1712000-0000-4000-8000-000000000009';
CREATE FUNCTION pg_temp.prepare_disconnect() RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.prepare_personal_calendar_disconnect('d1710000-0000-4000-8000-000000000001','d1711000-0000-4000-8000-000000000001',updated_at)
 FROM public.user_calendar_connections WHERE id='d1711000-0000-4000-8000-000000000001';
$$;
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.prepare_personal_calendar_disconnect(NULL,NULL,NULL)$$,'22023',NULL,'missing arguments are rejected');
SELECT extensions.throws_ok($$SELECT public.prepare_personal_calendar_disconnect('d1710000-0000-4000-8000-000000000001','d1711000-0000-4000-8000-000000000002',now())$$,'42501',NULL,'another account credential is refused');
SELECT extensions.throws_ok($$SELECT public.prepare_personal_calendar_disconnect('d1710000-0000-4000-8000-000000000003','d1711000-0000-4000-8000-000000000003',now())$$,'42501',NULL,'unbound credentials are refused');
SELECT extensions.throws_ok($$SELECT public.prepare_personal_calendar_disconnect('d1710000-0000-4000-8000-000000000001','d1711000-0000-4000-8000-000000000001',now()-interval '1 day')$$,'55000',NULL,'a stale credential revision is refused');
UPDATE app_private.personal_calendar_sync_receipts SET lease_until=clock_timestamp()+interval '1 minute' WHERE source_id='d1712000-0000-4000-8000-000000000002';
SELECT extensions.throws_ok($$SELECT pg_temp.prepare_disconnect()$$,'55P03',NULL,'active provider leases block disconnect metadata changes');
SELECT extensions.is((SELECT count(*) FROM app_private.personal_calendar_sync_receipts WHERE source_id='d1712000-0000-4000-8000-000000000001'),0::bigint,'busy refusal creates no partial receipt');
UPDATE app_private.personal_calendar_sync_receipts SET lease_until=NULL WHERE source_id='d1712000-0000-4000-8000-000000000002';
UPDATE public.user_calendar_connections SET preferences='{}' WHERE id='d1711000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.prepare_disconnect()$$,'55000',NULL,'missing legacy destination fails before any plan is written');
UPDATE public.user_calendar_connections SET preferences='{"volunteering_calendar_id":"primary"}' WHERE id='d1711000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.prepare_disconnect()$$,'55000',NULL,'primary destination cannot be captured as an owned secondary calendar');
UPDATE public.user_calendar_connections SET preferences='{"volunteering_calendar_id":"legacy@example.test","theme":"keep"}' WHERE id='d1711000-0000-4000-8000-000000000001';
UPDATE public.projects SET creator_calendar_event_id='legacysignup' WHERE id='d1712000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.prepare_disconnect()$$,'55000',NULL,'duplicate event ownership across project and signup fails closed');
UPDATE public.projects SET creator_calendar_event_id='bad/path' WHERE id='d1712000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.prepare_disconnect()$$,'55000',NULL,'malformed event identifiers are not retained as usable plans');
UPDATE public.projects SET creator_calendar_event_id='legacyevent1' WHERE id='d1712000-0000-4000-8000-000000000001';
INSERT INTO app_private.personal_calendar_sync_receipts(source_kind,source_id,user_id,project_id,phase,legacy_event_id)
VALUES('project','d1712000-0000-4000-8000-000000000001','d1710000-0000-4000-8000-000000000002','d1712000-0000-4000-8000-000000000001','synced','legacyevent1');
SELECT extensions.throws_ok($$SELECT pg_temp.prepare_disconnect()$$,'55000',NULL,'a receipt owned by another actor cannot be replaced');
DELETE FROM app_private.personal_calendar_sync_receipts WHERE source_id='d1712000-0000-4000-8000-000000000001';
INSERT INTO app_private.personal_calendar_sync_receipts(source_kind,source_id,user_id,project_id,phase,legacy_event_id)
SELECT 'project',('d1719000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'d1710000-0000-4000-8000-000000000001',('d1719000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'synced','bounded'||n FROM generate_series(1,2001) n;
SELECT extensions.throws_ok($$SELECT pg_temp.prepare_disconnect()$$,'54000',NULL,'an oversized receipt set is rejected atomically');
DELETE FROM app_private.personal_calendar_sync_receipts WHERE source_id::text LIKE 'd1719000-%';
INSERT INTO app_private.personal_calendar_sync_receipts(source_kind,source_id,user_id,project_id,phase)
SELECT 'project',('d1719100-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'d1710000-0000-4000-8000-000000000001',('d1719100-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'syncing' FROM generate_series(1,1998) n;
SELECT extensions.throws_ok($$SELECT pg_temp.prepare_disconnect()$$,'54000',NULL,'combined empty receipts and new live sources share one 2000-identity limit');
SELECT extensions.is((SELECT count(*) FROM app_private.personal_calendar_sync_receipts WHERE source_id='d1712000-0000-4000-8000-000000000001'),0::bigint,'combined-limit refusal writes no new plan');
DELETE FROM app_private.personal_calendar_sync_receipts WHERE source_id::text LIKE 'd1719100-%';
-- The size fixture bypasses schedule validation only while inserting known-valid rows.
RESET ROLE;
ALTER TABLE public.projects DISABLE TRIGGER enforce_project_schedule_validation;
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,require_login,status,visibility,workflow_status)
SELECT ('d1719200-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'d1710000-0000-4000-8000-000000000001','Synthetic unsynced source','Local','Synthetic','oneTime','manual',
 '{"oneTime":{"date":"2030-10-10","startTime":"10:00","endTime":"12:00","volunteers":20}}',true,'upcoming','public','published' FROM generate_series(1,5001) n;
ALTER TABLE public.projects ENABLE TRIGGER enforce_project_schedule_validation;
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT pg_temp.prepare_disconnect()$$,'54000',NULL,'too many unsynced sources are refused before broad row locking');
SELECT extensions.is((SELECT count(*) FROM app_private.personal_calendar_sync_receipts WHERE source_id='d1712000-0000-4000-8000-000000000001'),0::bigint,'source scan limit leaves cleanup plans unchanged');
DELETE FROM public.projects WHERE id::text LIKE 'd1719200-%';
RESET ROLE;
CREATE FUNCTION pg_temp.refuse_disconnect_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic prep failure'; END $$;
CREATE TRIGGER synthetic_disconnect_failure BEFORE UPDATE ON app_private.personal_calendar_sync_receipts
 FOR EACH ROW WHEN(NEW.source_id='d1712000-0000-4000-8000-000000000008') EXECUTE FUNCTION pg_temp.refuse_disconnect_update();
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT pg_temp.prepare_disconnect()$$,'P0001','Synthetic prep failure','a late metadata write failure rolls back the whole preparation');
SELECT extensions.is((SELECT count(*) FROM app_private.personal_calendar_sync_receipts WHERE source_id='d1712000-0000-4000-8000-000000000001'),0::bigint,'late failure rolls back earlier inserts');
SELECT extensions.ok((SELECT calendar_id IS NULL FROM app_private.personal_calendar_sync_receipts WHERE source_id='d1712000-0000-4000-8000-000000000008'),'late failure leaves orphan metadata untouched');
RESET ROLE;
DROP TRIGGER synthetic_disconnect_failure ON app_private.personal_calendar_sync_receipts;
SET LOCAL ROLE service_role;
INSERT INTO disconnect_snapshots SELECT 'credential',to_jsonb(c) FROM public.user_calendar_connections c WHERE id='d1711000-0000-4000-8000-000000000001';
INSERT INTO disconnect_snapshots VALUES('result',pg_temp.prepare_disconnect());
SELECT extensions.is((SELECT (data->>'prepared_count')::integer FROM disconnect_snapshots WHERE label='result'),3,'one project, one signup and one legacy orphan are prepared');
SELECT extensions.is((SELECT data->>'user_id' FROM disconnect_snapshots WHERE label='result'),'d1710000-0000-4000-8000-000000000001','result is actor-bound');
SELECT extensions.is((SELECT data->>'connection_id' FROM disconnect_snapshots WHERE label='result'),'d1711000-0000-4000-8000-000000000001','result is exact-connection-bound');
SELECT extensions.ok((SELECT (s.data->>'connection_updated_at')::timestamptz=c.updated_at FROM disconnect_snapshots s CROSS JOIN public.user_calendar_connections c WHERE s.label='result' AND c.id='d1711000-0000-4000-8000-000000000001'),'result carries the unchanged credential revision');
SELECT extensions.ok((SELECT phase='synced' AND calendar_id='legacy@example.test' AND legacy_event_id='legacyevent1' AND events='[{"id":"legacyevent1","event":null}]'::jsonb AND claim_token IS NULL AND cardinality(confirmed_event_ids)=0 FROM app_private.personal_calendar_sync_receipts WHERE source_id='d1712000-0000-4000-8000-000000000001'),'new legacy plan preserves synced intent without a lease or invented provider confirmation');
SELECT extensions.ok((SELECT phase='removing' AND calendar_id='legacy@example.test' AND events='[{"id":"legacyorphan","event":null}]'::jsonb AND claim_token IS NULL FROM app_private.personal_calendar_sync_receipts WHERE source_id='d1712000-0000-4000-8000-000000000008'),'an orphan retains its existing removing phase while gaining cleanup coordinates');
SELECT extensions.is((SELECT to_jsonb(r) FROM app_private.personal_calendar_sync_receipts r WHERE source_id='d1712000-0000-4000-8000-000000000002'),(SELECT data FROM disconnect_snapshots WHERE label='synced'),'existing synced generation, events, confirmations and timestamps are byte-identical');
SELECT extensions.is((SELECT to_jsonb(r) FROM app_private.personal_calendar_sync_receipts r WHERE source_id='d1712000-0000-4000-8000-000000000009'),(SELECT data FROM disconnect_snapshots WHERE label='removed'),'terminal receipts remain untouched');
SELECT extensions.is((SELECT to_jsonb(c) FROM public.user_calendar_connections c WHERE id='d1711000-0000-4000-8000-000000000001'),(SELECT data FROM disconnect_snapshots WHERE label='credential'),'inactive credentials and preferences remain untouched and can still disconnect');
SELECT extensions.is((SELECT creator_calendar_event_id FROM public.projects WHERE id='d1712000-0000-4000-8000-000000000001'),'legacyevent1','project compatibility pointer remains');
SELECT extensions.is((SELECT volunteer_calendar_event_id FROM public.project_signups WHERE id='d1713000-0000-4000-8000-000000000001'),'legacysignup','signup compatibility pointer remains');
SELECT extensions.is((pg_temp.prepare_disconnect()->>'prepared_count')::integer,0,'repeated preparation is idempotent');
SELECT extensions.is(public.claim_personal_calendar_sync('d1710000-0000-4000-8000-000000000001','project','d1712000-0000-4000-8000-000000000001','sync')->>'phase','synced','a disconnect that fails later does not block normal sync behind removal intent');
INSERT INTO app_private.personal_calendar_sync_receipts(source_kind,source_id,user_id,project_id,phase,legacy_event_id)
SELECT 'project',('d1718000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'d1710000-0000-4000-8000-000000000001',('d1718000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'synced','orphanpage'||n FROM generate_series(1,101) n;
SELECT extensions.is((pg_temp.prepare_disconnect()->>'prepared_count')::integer,101,'atomic preparation covers orphan entries beyond the UI cleanup page');
SELECT extensions.ok((SELECT bool_and(calendar_id='legacy@example.test' AND phase='synced') FROM app_private.personal_calendar_sync_receipts WHERE source_id::text LIKE 'd1718000-%'),'all orphan page coordinates retain their synced phase');
RESET ROLE;
INSERT INTO app_private.account_deletion_operations(target_user_id,requested_by,mode,phase)
VALUES('d1710000-0000-4000-8000-000000000001','d1710000-0000-4000-8000-000000000001','self_delete','database_pending');
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT pg_temp.prepare_disconnect()$$,'42501',NULL,'pending account removal refuses new metadata preparation');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok($$SELECT public.prepare_personal_calendar_disconnect('d1710000-0000-4000-8000-000000000001','d1711000-0000-4000-8000-000000000001',now())$$,'42501',NULL,'authenticated execution is denied before any actor impersonation');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT extensions.throws_ok($$SELECT public.prepare_personal_calendar_disconnect('d1710000-0000-4000-8000-000000000001','d1711000-0000-4000-8000-000000000001',now())$$,'42501',NULL,'anonymous execution is denied');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
