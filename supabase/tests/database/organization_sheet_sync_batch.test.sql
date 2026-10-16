BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(19);
SELECT extensions.ok(NOT has_function_privilege('anon',f,'EXECUTE') AND NOT has_function_privilege('authenticated',f,'EXECUTE') AND has_function_privilege('service_role',f,'EXECUTE'),'the Sheets batch claim is service only')
FROM (VALUES('public.claim_organization_sheet_sync_batch(integer,timestamptz)')) v(f);
SELECT extensions.ok(bool_and(prosecdef AND proconfig=ARRAY['search_path=""']::text[]),'both batch claims own their table access and pin an empty search_path')
FROM pg_proc WHERE oid IN ('public.claim_organization_sheet_sync_batch(integer,timestamptz)'::regprocedure,'public.claim_organization_calendar_sync_batch(integer,timestamptz)'::regprocedure);
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM unnest(ARRAY['app_private.claim_organization_sync_discovery_batch(text,integer,timestamptz)','app_private.organization_sheet_sync_trim(text)']) f,
 unnest(ARRAY['anon','authenticated','service_role']) r WHERE has_function_privilege(r,f,'EXECUTE')),'no API role can call the shared batch helper, so none can name a worker');
SELECT extensions.ok(bool_and(proconfig=ARRAY['search_path=""']::text[]),'the private helpers pin an empty search_path')
FROM pg_proc WHERE oid IN ('app_private.claim_organization_sync_discovery_batch(text,integer,timestamptz)'::regprocedure,'app_private.organization_sheet_sync_trim(text)'::regprocedure);

-- Only the fixture below is due. Every change here is rolled back with the test.
UPDATE public.organization_sheet_syncs SET auto_sync=false;
UPDATE app_private.organization_sync_discovery_cursors SET last_organization_id=NULL;
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('5bee1000-0000-4000-8000-000000000001','authenticated','authenticated','sheet-batch@local.test',now(),'{}','{}',now(),now());
-- 240 organizations whose ids differ only in their last digits, as ids created together do.
INSERT INTO public.organizations(id,name,username,type,join_code)
SELECT ('5bee0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic sheet batch '||n,'synthetic-sheet-batch-'||n,'school',(990000+n)::text FROM generate_series(1,240)n;
-- 1 to 101 synced ten minutes ago on an hourly interval: more than a hundred that are not due, ahead of every due one.
-- 102 to 125 never synced. 126 to 131 test the interval. 132 to 240 are switched off.
INSERT INTO public.organization_sheet_syncs(organization_id,created_by,sheet_id,sheet_url,auto_sync,sync_interval_minutes,last_synced_at)
SELECT ('5bee0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'5bee1000-0000-4000-8000-000000000001','synthetic-batch-sheet-'||n,'https://docs.google.com/spreadsheets/d/synthetic-batch-sheet-'||n,
 n<=129 OR n=131,
 CASE n WHEN 126 THEN 5 WHEN 127 THEN 5 WHEN 128 THEN 0 WHEN 129 THEN -30 WHEN 131 THEN 60 ELSE CASE WHEN n<=101 THEN 60 ELSE 1440 END END,
 CASE WHEN n<=101 THEN clock_timestamp()-interval '10 minutes'
  -- Five minutes is read as fifteen: not due after ten, due after sixteen.
  WHEN n=126 THEN clock_timestamp()-interval '10 minutes' WHEN n=127 THEN clock_timestamp()-interval '16 minutes'
  -- An interval that is not positive is read as a day: not due after two hours, due after twenty-five.
  WHEN n=128 THEN clock_timestamp()-interval '2 hours' WHEN n=129 THEN clock_timestamp()-interval '25 hours'
  WHEN n=131 THEN clock_timestamp()-interval '61 minutes' END
FROM generate_series(1,240)n;
CREATE TEMP TABLE sheet_batches(label text PRIMARY KEY,data jsonb);
GRANT ALL ON sheet_batches TO service_role;
CREATE FUNCTION pg_temp.fixture_ids(p_from integer,p_to integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT coalesce(jsonb_agg('5bee0000-0000-4000-8000-'||lpad(n::text,12,'0') ORDER BY n),'[]') FROM generate_series(p_from,p_to)n;
$$;
CREATE FUNCTION pg_temp.fixture_state() RETURNS jsonb LANGUAGE sql AS $$
 SELECT to_jsonb(md5(string_agg(organization_id::text||':'||coalesce(last_synced_at::text,'never')||':'||auto_sync::text||':'||sync_interval_minutes::text,',' ORDER BY organization_id)))
 FROM public.organization_sheet_syncs WHERE organization_id::text LIKE '5bee0000-%';
$$;
INSERT INTO sheet_batches VALUES('before',pg_temp.fixture_state());

SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.claim_organization_sheet_sync_batch(0,clock_timestamp())$$,'22023',NULL,'a limit below one is refused');
SELECT extensions.throws_ok($$SELECT public.claim_organization_sheet_sync_batch(201,clock_timestamp())$$,'22023',NULL,'a limit above 200 is refused');
SELECT extensions.throws_ok($$SELECT public.claim_organization_sheet_sync_batch(25,clock_timestamp()+interval '1 day')$$,'22023',NULL,'a run start in the future is refused, so nothing is made due early');

-- No selected organization is ever synced below, which is what a run of failing provider syncs looks like.
-- Due: 102 to 125, 127, 129 and 131. That is 27, behind 101 that are not.
INSERT INTO sheet_batches VALUES('first',public.claim_organization_sheet_sync_batch(25,clock_timestamp()));
SELECT extensions.is((SELECT data FROM sheet_batches WHERE label='first'),jsonb_build_object('due_count',27,'organization_ids',pg_temp.fixture_ids(102,125)||pg_temp.fixture_ids(127,127)),
 'the count is exact past 101 organizations that are not due, each interval is honored with its 15 minute floor, and the batch is the first 25 in id order');
INSERT INTO sheet_batches VALUES('second',public.claim_organization_sheet_sync_batch(25,clock_timestamp()));
SELECT extensions.is((SELECT data FROM sheet_batches WHERE label='second'),jsonb_build_object('due_count',27,'organization_ids',pg_temp.fixture_ids(129,129)||pg_temp.fixture_ids(131,131)||pg_temp.fixture_ids(102,124)),
 'the next batch starts after the last one and wraps once, though nothing was synced');
SELECT extensions.is((SELECT count(DISTINCT id) FROM sheet_batches,jsonb_array_elements_text(data->'organization_ids') id WHERE label IN ('first','second')),27::bigint,'two batches of 25 reach all 27 due organizations');
RESET ROLE;
SELECT extensions.is((SELECT last_organization_id FROM app_private.organization_sync_discovery_cursors WHERE worker='organization-sheet-sync'),'5bee0000-0000-4000-8000-000000000124'::uuid,'the Sheets cursor rests on the last organization selected');
SELECT extensions.is((SELECT last_organization_id FROM app_private.organization_sync_discovery_cursors WHERE worker='organization-calendar-sync'),NULL::uuid,'no Sheets claim moved the Calendar cursor');
-- Each call takes a transaction-scoped lock for its own worker, so a second Sheets caller waits for the first to commit its cursor.
-- This shows which locks are held. It does not run two sessions against each other.
SELECT extensions.ok(EXISTS(SELECT 1 FROM pg_locks l WHERE l.locktype='advisory' AND l.pid=pg_backend_pid() AND l.granted AND l.mode='ExclusiveLock'
 AND ((l.classid::bigint<<32)|l.objid::bigint)=hashtextextended('lets-assist-org-sync-discovery:organization-sheet-sync',0)),'a Sheets batch claim holds the Sheets discovery lock until its transaction ends');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM pg_locks l WHERE l.locktype='advisory' AND l.pid=pg_backend_pid()
 AND ((l.classid::bigint<<32)|l.objid::bigint)=hashtextextended('lets-assist-org-sync-discovery:organization-calendar-sync',0)),'it does not take the Calendar discovery lock');
SELECT extensions.is(pg_temp.fixture_state(),(SELECT data FROM sheet_batches WHERE label='before'),'selecting batches changes no sync row: it stamps nothing and switches nothing off');

-- Every fixture organization becomes due: 240, more than one call may return.
UPDATE public.organization_sheet_syncs SET auto_sync=true,last_synced_at=NULL,sync_interval_minutes=1440 WHERE organization_id::text LIKE '5bee0000-%';
SET LOCAL ROLE service_role;
INSERT INTO sheet_batches VALUES('wide',public.claim_organization_sheet_sync_batch(200,clock_timestamp()));
SELECT extensions.is((SELECT data->'due_count' FROM sheet_batches WHERE label='wide'),'240'::jsonb,'the count is of every due organization, not of the batch');
SELECT extensions.is((SELECT jsonb_array_length(data->'organization_ids')::text||':'||(SELECT count(DISTINCT id) FROM jsonb_array_elements_text(data->'organization_ids') id)::text||':'||(data->'organization_ids'->>0) FROM sheet_batches WHERE label='wide'),
 '200:200:5bee0000-0000-4000-8000-000000000125','the largest batch is 200 distinct organizations, starting after the cursor');
RESET ROLE;
UPDATE public.organization_sheet_syncs SET auto_sync=false;
SET LOCAL ROLE service_role;
SELECT extensions.is(public.claim_organization_sheet_sync_batch(25,clock_timestamp()),'{"due_count":0,"organization_ids":[]}'::jsonb,'an empty queue is a zero count and an empty batch');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok($$SELECT public.claim_organization_sheet_sync_batch(25,clock_timestamp())$$,'42501',NULL,'a browser role cannot claim a batch');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
