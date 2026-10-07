BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(44);
SELECT extensions.ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'app_private.personal_calendar_sync_receipts'::regclass), 'receipts force RLS');
SELECT extensions.ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app_private' AND tablename = 'personal_calendar_sync_receipts'), 'receipts have no browser policies');
SELECT extensions.ok(NOT has_table_privilege('authenticated', 'app_private.personal_calendar_sync_receipts', 'SELECT') AND NOT has_table_privilege('anon', 'app_private.personal_calendar_sync_receipts', 'SELECT'), 'browser roles cannot read provider plans');
SELECT extensions.ok(NOT EXISTS (
 SELECT 1 FROM unnest(ARRAY['public.claim_personal_calendar_sync(uuid,text,uuid,text,text,text)', 'public.advance_personal_calendar_sync(uuid,text,uuid,uuid,text,jsonb)']) f,
 unnest(ARRAY['anon','authenticated']) r WHERE has_function_privilege(r, f, 'EXECUTE')
), 'browser roles cannot invoke actor-accepting RPCs');
SELECT extensions.ok((SELECT bool_and(NOT prosecdef AND proconfig @> ARRAY['search_path=""']) FROM pg_proc WHERE oid IN ('public.claim_personal_calendar_sync(uuid,text,uuid,text,text,text)'::regprocedure, 'public.advance_personal_calendar_sync(uuid,text,uuid,uuid,text,jsonb)'::regprocedure)), 'service RPCs are invokers with fixed search paths');
SELECT extensions.ok(has_function_privilege('service_role', 'public.claim_personal_calendar_sync(uuid,text,uuid,text,text,text)', 'EXECUTE') AND has_function_privilege('service_role', 'public.advance_personal_calendar_sync(uuid,text,uuid,uuid,text,jsonb)', 'EXECUTE'), 'service role can invoke receipt RPCs');

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
SELECT ('fc000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'authenticated', 'authenticated', 'calendar-receipt-' || n || '@local.test', now(), '{}', '{}', now(), now() FROM generate_series(1,2) n;
INSERT INTO public.projects (id, creator_id, title, location, description, event_type, verification_method, schedule, require_login, status, visibility, workflow_status)
SELECT ('fc100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'fc000000-0000-4000-8000-000000000001', 'Synthetic calendar project', 'Local', 'Synthetic', 'oneTime', 'manual', '{"oneTime":{"date":"2030-10-10","startTime":"10:00","endTime":"12:00","volunteers":20}}', true, 'upcoming', 'public', 'published' FROM generate_series(1,4) n;
INSERT INTO public.project_signups (id, project_id, user_id, schedule_id, status)
VALUES ('fc200000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000002', 'oneTime', 'approved');
CREATE TEMP TABLE receipt_results (label text PRIMARY KEY, data jsonb NOT NULL);
GRANT ALL ON receipt_results TO service_role;
CREATE FUNCTION pg_temp.advance_receipt(p_label text, p_step text, p_payload jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.advance_personal_calendar_sync((data->>'user_id')::uuid, data->>'source_kind', (data->>'source_id')::uuid, (data->>'claim_token')::uuid, p_step, p_payload) FROM receipt_results WHERE label = p_label;
$$;
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.claim_personal_calendar_sync('fc000000-0000-4000-8000-000000000002','project','fc100000-0000-4000-8000-000000000001','sync')$$, 'P0002', NULL, 'cannot claim another creator project');
SELECT extensions.throws_ok($$SELECT public.claim_personal_calendar_sync('fc000000-0000-4000-8000-000000000001','signup','fc200000-0000-4000-8000-000000000001','sync','oneTime')$$, 'P0002', NULL, 'cannot claim another volunteer signup');
SELECT extensions.throws_ok($$SELECT public.claim_personal_calendar_sync('fc000000-0000-4000-8000-000000000002','signup','fc200000-0000-4000-8000-000000000001','sync','wrong')$$, 'P0002', NULL, 'signup schedule must match');
INSERT INTO receipt_results VALUES ('first', public.claim_personal_calendar_sync('fc000000-0000-4000-8000-000000000001','project','fc100000-0000-4000-8000-000000000001','sync'));
SELECT extensions.is((SELECT data->>'phase' FROM receipt_results WHERE label='first'), 'syncing', 'first sync reserves durable generation');
SELECT extensions.throws_ok($$SELECT public.claim_personal_calendar_sync('fc000000-0000-4000-8000-000000000001','project','fc100000-0000-4000-8000-000000000001','sync')$$, '55P03', NULL, 'a concurrent request cannot acquire the active lease');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_receipt('first','finish')$$, '55000', NULL, 'cannot mark an unplanned sync successful');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_receipt('first','plan','{"calendar_id":"owned@example.test","events":[{"id":"sameid","event":{}},{"id":"sameid","event":{}}]}')$$, '22023', NULL, 'duplicate event IDs are refused');
SELECT extensions.lives_ok($$SELECT pg_temp.advance_receipt('first','plan','{"calendar_id":"owned@example.test","events":[{"id":"eventfirst","event":{"summary":"Shift one"}},{"id":"eventsecond","event":{"summary":"Shift two"}}]}')$$, 'all occurrences are persisted together');
SELECT extensions.is((SELECT creator_calendar_event_id FROM public.projects WHERE id='fc100000-0000-4000-8000-000000000001'), 'eventfirst', 'partial progress has a compatibility anchor for removal');
SELECT extensions.ok((SELECT creator_synced_at IS NULL FROM public.projects WHERE id='fc100000-0000-4000-8000-000000000001'), 'planning does not claim successful sync');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_receipt('first','plan','{"calendar_id":"other@example.test","events":[{"id":"eventthird","event":{}}]}')$$, '22023', NULL, 'calendar and plan cannot be replaced');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_receipt('first','confirm','{"event_id":"unrelated"}')$$, '22023', NULL, 'confirmation cannot add unknown IDs');
SELECT extensions.lives_ok($$SELECT pg_temp.advance_receipt('first','confirm','{"event_id":"eventfirst"}')$$, 'first provider event can be confirmed');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_receipt('first','finish')$$, '55000', NULL, 'partial confirmation cannot mark sync complete');
DO $$BEGIN PERFORM pg_temp.advance_receipt('first','release'); END$$;
INSERT INTO receipt_results VALUES ('retry', public.claim_personal_calendar_sync('fc000000-0000-4000-8000-000000000001','project','fc100000-0000-4000-8000-000000000001','sync'));
SELECT extensions.is((SELECT data->>'generation' FROM receipt_results WHERE label='retry'), (SELECT data->>'generation' FROM receipt_results WHERE label='first'), 'retry retains the same generation');
SELECT extensions.is((SELECT data->'confirmed_event_ids' FROM receipt_results WHERE label='retry'), '["eventfirst"]'::jsonb, 'retry retains confirmed progress');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_receipt('first','renew')$$, '55000', NULL, 'a stale claim token is fenced');
DO $$BEGIN PERFORM pg_temp.advance_receipt('retry','confirm','{"event_id":"eventsecond"}'); END$$;
SELECT extensions.is(pg_temp.advance_receipt('retry','finish')->>'phase', 'synced', 'all confirmations settle sync atomically');
SELECT extensions.ok((SELECT creator_synced_at IS NOT NULL FROM public.projects WHERE id='fc100000-0000-4000-8000-000000000001'), 'completion timestamps the source');
SELECT extensions.throws_ok($$SELECT public.claim_personal_calendar_sync('fc000000-0000-4000-8000-000000000002','project',NULL,'remove',NULL,'eventfirst')$$, 'P0002', NULL, 'another actor cannot remove a receipt event');
INSERT INTO receipt_results VALUES ('remove', public.claim_personal_calendar_sync('fc000000-0000-4000-8000-000000000001','project',NULL,'remove',NULL,'eventfirst'));
SELECT extensions.is((SELECT data->'confirmed_event_ids' FROM receipt_results WHERE label='remove'), '[]'::jsonb, 'removal resets progress for all planned events');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_receipt('remove','finish')$$, '55000', NULL, 'removal waits for every occurrence');
DO $$BEGIN PERFORM pg_temp.advance_receipt('remove','confirm','{"event_id":"eventfirst"}'); END$$;
DO $$BEGIN PERFORM pg_temp.advance_receipt('remove','release'); END$$;
INSERT INTO receipt_results VALUES ('remove-retry', public.claim_personal_calendar_sync('fc000000-0000-4000-8000-000000000001','project',NULL,'remove',NULL,'eventfirst'));
SELECT extensions.is((SELECT data->'confirmed_event_ids' FROM receipt_results WHERE label='remove-retry'), '["eventfirst"]'::jsonb, 'interrupted removal retains progress');
DO $$BEGIN PERFORM pg_temp.advance_receipt('remove-retry','confirm','{"event_id":"eventsecond"}'); END$$;
SELECT extensions.is(pg_temp.advance_receipt('remove-retry','finish')->>'phase', 'removed', 'all provider removals settle locally');
SELECT extensions.ok((SELECT creator_calendar_event_id IS NULL AND creator_synced_at IS NULL FROM public.projects WHERE id='fc100000-0000-4000-8000-000000000001'), 'completed removal clears compatibility markers');
SELECT extensions.is(public.claim_personal_calendar_sync('fc000000-0000-4000-8000-000000000001','project',NULL,'remove',NULL,'eventfirst')->>'phase', 'removed', 'lost response removal retry is idempotent');
INSERT INTO receipt_results VALUES ('new', public.claim_personal_calendar_sync('fc000000-0000-4000-8000-000000000001','project','fc100000-0000-4000-8000-000000000001','sync'));
SELECT extensions.isnt((SELECT data->>'generation' FROM receipt_results WHERE label='new'), (SELECT data->>'generation' FROM receipt_results WHERE label='first'), 'remove then re-add uses a fresh generation');
SELECT extensions.is((SELECT data->'events' FROM receipt_results WHERE label='new'), '[]'::jsonb, 'new generation cannot reuse tombstoned IDs');
UPDATE app_private.personal_calendar_sync_receipts SET lease_until=clock_timestamp()-interval '1 second' WHERE source_id='fc100000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.advance_receipt('new','renew')$$, '55000', NULL, 'expired worker cannot renew itself');
SELECT extensions.lives_ok($$SELECT public.claim_personal_calendar_sync('fc000000-0000-4000-8000-000000000001','project','fc100000-0000-4000-8000-000000000001','sync')$$, 'another request can recover an expired worker');

UPDATE public.projects SET creator_calendar_event_id='legacyevent' WHERE id='fc100000-0000-4000-8000-000000000002';
INSERT INTO receipt_results VALUES ('legacy', public.claim_personal_calendar_sync('fc000000-0000-4000-8000-000000000001','project',NULL,'remove',NULL,'legacyevent'));
SELECT extensions.throws_ok($$SELECT pg_temp.advance_receipt('legacy','finish')$$, '55000', NULL, 'legacy event cannot be cleared without provider confirmation');
SELECT extensions.lives_ok($$SELECT pg_temp.advance_receipt('legacy','plan','{"calendar_id":"legacy@example.test","events":[{"id":"legacyevent","event":null}]}')$$, 'legacy removal pins its single known identity');
DELETE FROM public.projects WHERE id='fc100000-0000-4000-8000-000000000002';
SELECT extensions.is((SELECT count(*) FROM app_private.personal_calendar_sync_receipts WHERE source_id='fc100000-0000-4000-8000-000000000002'), 1::bigint, 'source deletion cannot erase external cleanup state');
DO $$BEGIN PERFORM pg_temp.advance_receipt('legacy','confirm','{"event_id":"legacyevent"}'); END$$;
SELECT extensions.is(pg_temp.advance_receipt('legacy','finish')->>'phase', 'removed', 'owned cleanup can finish after source deletion');
UPDATE public.projects SET creator_calendar_event_id='duplicatelegacy' WHERE id IN ('fc100000-0000-4000-8000-000000000003','fc100000-0000-4000-8000-000000000004');
SELECT extensions.throws_ok($$SELECT public.claim_personal_calendar_sync('fc000000-0000-4000-8000-000000000001','project',NULL,'remove',NULL,'duplicatelegacy')$$, '55000', NULL, 'ambiguous legacy event ownership fails closed');
RESET ROLE;
INSERT INTO app_private.account_deletion_operations(target_user_id, requested_by, mode, phase)
VALUES ('fc000000-0000-4000-8000-000000000002','fc000000-0000-4000-8000-000000000002','self_delete','database_pending');
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.claim_personal_calendar_sync('fc000000-0000-4000-8000-000000000002','signup','fc200000-0000-4000-8000-000000000001','sync','oneTime')$$, '42501', NULL, 'pending deletion prevents new calendar provider work');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok($$SELECT public.claim_personal_calendar_sync('fc000000-0000-4000-8000-000000000001','project','fc100000-0000-4000-8000-000000000001','sync')$$, '42501', NULL, 'a real authenticated role cannot impersonate the service caller');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT extensions.throws_ok($$SELECT public.claim_personal_calendar_sync('fc000000-0000-4000-8000-000000000001','project','fc100000-0000-4000-8000-000000000001','sync')$$, '42501', NULL, 'a real anonymous role cannot invoke calendar claims');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
