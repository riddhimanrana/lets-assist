BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(28);
SELECT extensions.ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='app_private.organization_sync_discovery_cursors'::regclass),'the discovery cursor forces RLS');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) r,unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p WHERE has_table_privilege(r,'app_private.organization_sync_discovery_cursors',p)),'no browser or service role reads or moves the cursor directly');
SELECT extensions.ok(NOT has_function_privilege('anon',f,'EXECUTE') AND NOT has_function_privilege('authenticated',f,'EXECUTE') AND has_function_privilege('service_role',f,'EXECUTE'),'the batch claim is service only')
FROM (VALUES('public.claim_organization_calendar_sync_batch(integer,timestamptz)')) v(f);
SELECT extensions.ok((SELECT prosecdef AND proconfig=ARRAY['search_path=""']::text[] FROM pg_proc WHERE oid='public.claim_organization_calendar_sync_batch(integer,timestamptz)'::regprocedure),'the batch claim owns its table access and pins an empty search_path');SELECT extensions.is((SELECT array_agg(worker ORDER BY worker) FROM app_private.organization_sync_discovery_cursors),ARRAY['organization-calendar-sync','organization-sheet-sync']::text[],'there is one cursor row for each worker');

-- Only the fixture below is due. Every change here is rolled back with the test.
UPDATE public.organization_calendar_syncs SET auto_sync=false;
UPDATE app_private.organization_sync_discovery_cursors SET last_organization_id=NULL;
-- Thirty-three organizations whose ids differ only in their last digits, as ids created together do.
INSERT INTO public.organizations(id,name,username,type,join_code)
SELECT ('ca1e0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic calendar batch '||n,'synthetic-calendar-batch-'||n,'school',(993100+n)::text FROM generate_series(1,33)n;
-- 1 to 29 never synced, 30 synced 61 minutes ago: thirty due. 31 is recent, 32 is switched off, 33 has no sync row.
INSERT INTO public.organization_calendar_syncs(organization_id,auto_sync,last_synced_at)
SELECT ('ca1e0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,n<>32,
 CASE WHEN n=30 THEN clock_timestamp()-interval '61 minutes' WHEN n=31 THEN clock_timestamp()-interval '59 minutes' END
FROM generate_series(1,32)n;
CREATE TEMP TABLE calendar_batches(label text PRIMARY KEY,data jsonb);
GRANT ALL ON calendar_batches TO service_role;
CREATE FUNCTION pg_temp.fixture_ids(p_from integer,p_to integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT coalesce(jsonb_agg('ca1e0000-0000-4000-8000-'||lpad(n::text,12,'0') ORDER BY n),'[]') FROM generate_series(p_from,p_to)n;
$$;

SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.claim_organization_calendar_sync_batch(0,clock_timestamp())$$,'22023',NULL,'a limit below one is refused');
SELECT extensions.throws_ok($$SELECT public.claim_organization_calendar_sync_batch(201,clock_timestamp())$$,'22023',NULL,'a limit above 200 is refused');
SELECT extensions.throws_ok($$SELECT public.claim_organization_calendar_sync_batch(NULL,clock_timestamp())$$,'22023',NULL,'a missing limit is refused');
SELECT extensions.throws_ok($$SELECT public.claim_organization_calendar_sync_batch(25,NULL)$$,'22023',NULL,'a missing run start is refused');
SELECT extensions.throws_ok($$SELECT public.claim_organization_calendar_sync_batch(25,'infinity')$$,'22023',NULL,'an infinite run start is refused');
SELECT extensions.throws_ok($$SELECT public.claim_organization_calendar_sync_batch(25,clock_timestamp()+interval '1 day')$$,'22023',NULL,'a run start in the future is refused, so nothing is made due early');
SELECT extensions.throws_ok($$SELECT public.claim_organization_calendar_sync_batch(25,clock_timestamp()-interval '1 day')$$,'22023',NULL,'a stale run start is refused');
RESET ROLE;
SELECT extensions.is((SELECT last_organization_id FROM app_private.organization_sync_discovery_cursors WHERE worker='organization-calendar-sync'),NULL::uuid,'a refused request does not move the cursor');
SET LOCAL ROLE service_role;

-- No selected organization is ever synced below, which is what a run of failing provider syncs looks like.
INSERT INTO calendar_batches VALUES('first',public.claim_organization_calendar_sync_batch(25,clock_timestamp()));
SELECT extensions.is((SELECT data FROM calendar_batches WHERE label='first'),jsonb_build_object('due_count',30,'organization_ids',pg_temp.fixture_ids(1,25)),'the first batch counts every due organization and takes the first 25 in id order');
INSERT INTO calendar_batches VALUES('second',public.claim_organization_calendar_sync_batch(25,clock_timestamp()));
SELECT extensions.is((SELECT data FROM calendar_batches WHERE label='second'),jsonb_build_object('due_count',30,'organization_ids',pg_temp.fixture_ids(26,30)||pg_temp.fixture_ids(1,20)),'the next batch starts after the last one and wraps once, though nothing was synced');
SELECT extensions.is((SELECT count(DISTINCT id) FROM calendar_batches,jsonb_array_elements_text(data->'organization_ids') id WHERE label IN ('first','second')),30::bigint,'two batches of 25 reach all 30 due organizations');
INSERT INTO calendar_batches VALUES('third',public.claim_organization_calendar_sync_batch(25,clock_timestamp()));
SELECT extensions.is((SELECT data->'organization_ids' FROM calendar_batches WHERE label='third'),pg_temp.fixture_ids(21,30)||pg_temp.fixture_ids(1,15),'the third batch carries on from where the second ended');
RESET ROLE;
SELECT extensions.is((SELECT last_organization_id FROM app_private.organization_sync_discovery_cursors WHERE worker='organization-calendar-sync'),'ca1e0000-0000-4000-8000-000000000015'::uuid,'the cursor rests on the last organization selected');
SELECT extensions.is((SELECT count(*) FROM public.organization_calendar_syncs WHERE organization_id::text LIKE 'ca1e0000-%' AND last_synced_at IS NULL AND auto_sync),29::bigint,'selecting a batch stamps no sync row');
-- Each call takes the same transaction-scoped lock, so a second caller waits for the first to commit its cursor.
-- This shows the lock is held. It does not run two sessions against each other.
SELECT extensions.ok(EXISTS(SELECT 1 FROM pg_locks l WHERE l.locktype='advisory' AND l.pid=pg_backend_pid() AND l.granted AND l.mode='ExclusiveLock'
 AND ((l.classid::bigint<<32)|l.objid::bigint)=hashtextextended('lets-assist-org-sync-discovery:organization-calendar-sync',0)),'a batch claim holds the discovery lock until its transaction ends');
SET LOCAL ROLE service_role;

SELECT extensions.is(public.claim_organization_calendar_sync_batch(1,clock_timestamp()),jsonb_build_object('due_count',30,'organization_ids',pg_temp.fixture_ids(16,16)),'a limit of one selects one organization and still counts all that are due');
INSERT INTO calendar_batches VALUES('wide',public.claim_organization_calendar_sync_batch(200,clock_timestamp()));
SELECT extensions.is((SELECT data FROM calendar_batches WHERE label='wide'),jsonb_build_object('due_count',30,'organization_ids',pg_temp.fixture_ids(17,30)||pg_temp.fixture_ids(1,16)),'a limit above the queue returns each due organization exactly once');
RESET ROLE;
-- An organization that synced leaves the queue. One that becomes due joins it.
UPDATE public.organization_calendar_syncs SET last_synced_at=clock_timestamp() WHERE organization_id='ca1e0000-0000-4000-8000-000000000017';
UPDATE public.organization_calendar_syncs SET last_synced_at=clock_timestamp()-interval '2 hours' WHERE organization_id='ca1e0000-0000-4000-8000-000000000031';
UPDATE public.organization_calendar_syncs SET auto_sync=true,last_synced_at=clock_timestamp()-interval '10 minutes' WHERE organization_id='ca1e0000-0000-4000-8000-000000000032';
SET LOCAL ROLE service_role;
SELECT extensions.is(public.claim_organization_calendar_sync_batch(3,clock_timestamp()),jsonb_build_object('due_count',30,'organization_ids',pg_temp.fixture_ids(18,20)),'only organizations that are enabled and due are counted and selected');
-- The run start decides what is due, not the time of the call.
SELECT extensions.is(public.claim_organization_calendar_sync_batch(200,clock_timestamp()-interval '10 minutes')->'due_count','29'::jsonb,'an organization synced 61 minutes ago is not due for a run that started 10 minutes ago');
RESET ROLE;
UPDATE public.organization_calendar_syncs SET auto_sync=false;
INSERT INTO calendar_batches SELECT 'resting',to_jsonb(last_organization_id) FROM app_private.organization_sync_discovery_cursors WHERE worker='organization-calendar-sync';
SET LOCAL ROLE service_role;
SELECT extensions.is(public.claim_organization_calendar_sync_batch(25,clock_timestamp()),'{"due_count":0,"organization_ids":[]}'::jsonb,'an empty queue is a zero count and an empty batch');
RESET ROLE;
SELECT extensions.is((SELECT to_jsonb(last_organization_id) FROM app_private.organization_sync_discovery_cursors WHERE worker='organization-calendar-sync'),(SELECT data FROM calendar_batches WHERE label='resting'),'an empty batch leaves the cursor where it was');
SELECT extensions.is((SELECT last_organization_id FROM app_private.organization_sync_discovery_cursors WHERE worker='organization-sheet-sync'),NULL::uuid,'no Calendar claim moved the Sheets cursor');
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok($$SELECT public.claim_organization_calendar_sync_batch(25,clock_timestamp())$$,'42501',NULL,'a browser role cannot claim a batch');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
