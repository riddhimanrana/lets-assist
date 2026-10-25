BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(22);
SELECT extensions.ok(NOT EXISTS (
 SELECT 1 FROM unnest(ARRAY['public.csf_begin_personal_calendar_destination_provision(uuid,uuid,uuid,text,boolean)', 'public.csf_complete_personal_calendar_destination_provision(uuid,uuid,text,text,text)', 'public.adopt_verified_personal_calendar_destination(uuid,uuid,text)', 'public.list_personal_calendar_cleanup(uuid)']) f,
 unnest(ARRAY['anon','authenticated']) r WHERE has_function_privilege(r, f, 'EXECUTE')
), 'browser roles cannot impersonate actors for destination or cleanup operations');
SELECT extensions.ok((SELECT bool_and(NOT prosecdef AND proconfig @> ARRAY['search_path=""']) FROM pg_proc WHERE oid IN ('public.csf_begin_personal_calendar_destination_provision(uuid,uuid,uuid,text,boolean)'::regprocedure, 'public.csf_complete_personal_calendar_destination_provision(uuid,uuid,text,text,text)'::regprocedure,'public.adopt_verified_personal_calendar_destination(uuid,uuid,text)'::regprocedure,'public.list_personal_calendar_cleanup(uuid)'::regprocedure)), 'destination wrappers pin invoker privileges and search paths');
INSERT INTO auth.users (id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('fd000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','destination-'||n||'@local.test',now(),'{}','{}',now(),now() FROM generate_series(1,3) n;
INSERT INTO public.user_calendar_connections(id,user_id,provider,access_token,refresh_token,token_expires_at,calendar_email,is_active,preferences,granted_scopes,connection_type)
SELECT ('fd100000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,('fd000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
'google','fictional-access','fictional-refresh',now()+interval '1 hour','destination-'||n||'@local.test',true,
'{"volunteering_calendar_id":"legacy@example.test","theme":"keep"}','https://www.googleapis.com/auth/calendar.app.created','calendar' FROM generate_series(1,3) n;
INSERT INTO public.user_google_oauth_connection_bindings(connection_id,user_id,provider,purpose)
SELECT ('fd100000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,('fd000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'google','personal_calendar' FROM generate_series(1,2) n;
CREATE TEMP TABLE destination_results(label text PRIMARY KEY,data jsonb);
GRANT ALL ON destination_results TO service_role;
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.adopt_verified_personal_calendar_destination('fd000000-0000-4000-8000-000000000001','fd100000-0000-4000-8000-000000000002','legacy@example.test')$$,'42501',NULL,'another users connection cannot be adopted');
SELECT extensions.throws_ok($$SELECT public.adopt_verified_personal_calendar_destination('fd000000-0000-4000-8000-000000000003','fd100000-0000-4000-8000-000000000003','legacy@example.test')$$,'42501',NULL,'an unbound credential cannot be adopted');
SELECT extensions.throws_ok($$SELECT public.adopt_verified_personal_calendar_destination('fd000000-0000-4000-8000-000000000001','fd100000-0000-4000-8000-000000000001','primary')$$,'22023',NULL,'primary calendar adoption is refused');
SELECT extensions.throws_ok($$SELECT public.adopt_verified_personal_calendar_destination('fd000000-0000-4000-8000-000000000001','fd100000-0000-4000-8000-000000000001','unselected@example.test')$$,'42501',NULL,'changed preferences invalidate prior provider proof');
SELECT extensions.ok(public.adopt_verified_personal_calendar_destination('fd000000-0000-4000-8000-000000000001','fd100000-0000-4000-8000-000000000001','legacy@example.test'),'verified legacy calendar becomes the shared destination');
SELECT extensions.ok(public.adopt_verified_personal_calendar_destination('fd000000-0000-4000-8000-000000000001','fd100000-0000-4000-8000-000000000001','legacy@example.test'),'repeated adoption is idempotent');
SELECT extensions.is(public.csf_begin_personal_calendar_destination_provision('fd000000-0000-4000-8000-000000000001','fd100000-0000-4000-8000-000000000001','fd200000-0000-4000-8000-000000000001')->>'shouldCallProvider','false','platform and CSF reuse the same adopted destination without creation');
UPDATE public.user_calendar_connections SET preferences=preferences || '{"volunteering_calendar_id":"another@example.test"}' WHERE id='fd100000-0000-4000-8000-000000000001';
SELECT extensions.ok(NOT public.adopt_verified_personal_calendar_destination('fd000000-0000-4000-8000-000000000001','fd100000-0000-4000-8000-000000000001','another@example.test'),'later preference edits cannot overwrite authoritative state');
SELECT extensions.is((SELECT calendar_id FROM plugin_data.csf_personal_calendar_destinations WHERE user_id='fd000000-0000-4000-8000-000000000001'),'legacy@example.test','canonical identity stays pinned');
INSERT INTO destination_results VALUES('create',public.csf_begin_personal_calendar_destination_provision('fd000000-0000-4000-8000-000000000002','fd100000-0000-4000-8000-000000000002','fd200000-0000-4000-8000-000000000002'));
SELECT extensions.is((SELECT data->>'shouldCallProvider' FROM destination_results WHERE label='create'),'true','missing destination receives one durable provider claim');
SELECT extensions.ok(NOT public.adopt_verified_personal_calendar_destination('fd000000-0000-4000-8000-000000000002','fd100000-0000-4000-8000-000000000002','legacy@example.test'),'adoption cannot replace a concurrent provisioning claim');
SELECT extensions.is(public.csf_begin_personal_calendar_destination_provision('fd000000-0000-4000-8000-000000000002','fd100000-0000-4000-8000-000000000002','fd200000-0000-4000-8000-000000000003')->>'shouldCallProvider','false','concurrent first sync cannot create another calendar');
SELECT extensions.lives_ok($$SELECT public.csf_complete_personal_calendar_destination_provision((SELECT (data->>'operationId')::uuid FROM destination_results WHERE label='create'),'fd000000-0000-4000-8000-000000000002','unknown_outcome',NULL,'timeout')$$,'ambiguous creation is durably recorded');
SELECT extensions.ok(NOT public.adopt_verified_personal_calendar_destination('fd000000-0000-4000-8000-000000000002','fd100000-0000-4000-8000-000000000002','legacy@example.test'),'adoption cannot bypass an unknown provider outcome');
SELECT extensions.is(public.csf_begin_personal_calendar_destination_provision('fd000000-0000-4000-8000-000000000002','fd100000-0000-4000-8000-000000000002','fd200000-0000-4000-8000-000000000004')->>'shouldCallProvider','false','unknown creation remains blocked on every retry');
INSERT INTO app_private.personal_calendar_sync_receipts(source_kind,source_id,user_id,project_id,phase,legacy_event_id)
SELECT 'project',('fd300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fd000000-0000-4000-8000-000000000001',('fd300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'removing','syntheticevent'||n FROM generate_series(1,105) n;
SELECT extensions.is((SELECT count(*) FROM public.list_personal_calendar_cleanup('fd000000-0000-4000-8000-000000000001')),100::bigint,'orphan cleanup read is bounded and retains source-deleted entries');
SELECT extensions.is((SELECT count(*) FROM public.list_personal_calendar_cleanup('fd000000-0000-4000-8000-000000000002')),0::bigint,'cleanup list cannot expose another actor entries');
UPDATE app_private.personal_calendar_sync_receipts SET phase='removed' WHERE source_id='fd300000-0000-4000-8000-000000000001';
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM public.list_personal_calendar_cleanup('fd000000-0000-4000-8000-000000000001') WHERE source_id='fd300000-0000-4000-8000-000000000001'),'completed cleanup disappears so the next pending entry can be shown');
RESET ROLE;
INSERT INTO app_private.account_deletion_operations(target_user_id,requested_by,mode,phase)
VALUES('fd000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001','self_delete','database_pending');
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.csf_begin_personal_calendar_destination_provision('fd000000-0000-4000-8000-000000000001','fd100000-0000-4000-8000-000000000001','fd200000-0000-4000-8000-000000000005')$$,'42501',NULL,'pending account deletion refuses new destination claims');
SELECT extensions.throws_ok($$SELECT public.adopt_verified_personal_calendar_destination('fd000000-0000-4000-8000-000000000001','fd100000-0000-4000-8000-000000000001','another@example.test')$$,'42501',NULL,'pending account deletion refuses adoption');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
