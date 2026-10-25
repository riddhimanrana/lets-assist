-- Fictional committed fixtures let two sessions exercise the real row locks.
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SELECT extensions.plan(29);

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('cf740000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'authenticated','authenticated','calendar-deletion-'||n||'@local.test',now(),'{}','{}',now(),now()
FROM generate_series(1,3) n;
INSERT INTO public.organizations(id,name,username,type,join_code)
VALUES ('cf741000-0000-4000-8000-000000000001','Calendar deletion','calendar-deletion','nonprofit','747401');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
VALUES ('cf741000-0000-4000-8000-000000000001','cf740000-0000-4000-8000-000000000002','admin','active'),
  ('cf741000-0000-4000-8000-000000000001','cf740000-0000-4000-8000-000000000003','member','active');
INSERT INTO public.projects(id,creator_id,organization_id,title,location,description,event_type,verification_method,schedule,require_login)
SELECT ('cf742000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'cf740000-0000-4000-8000-000000000001','cf741000-0000-4000-8000-000000000001',
  'Calendar deletion '||n,'Local','Synthetic','oneTime','manual',
  '{"oneTime":{"date":"2031-10-01","startTime":"09:00","endTime":"10:00","volunteers":5}}',true
FROM generate_series(1,4) n;
INSERT INTO app_private.personal_calendar_sync_receipts(source_kind,source_id,user_id,project_id,phase)
VALUES ('project','cf742000-0000-4000-8000-000000000001','cf740000-0000-4000-8000-000000000001',
  'cf742000-0000-4000-8000-000000000001','removed');

SELECT extensions.ok(NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY[
    'public.claim_personal_calendar_sync(uuid,text,uuid,text,text,text)',
    'public.claim_personal_calendar_update(uuid,uuid,jsonb)',
    'public.prepare_project_deletion(uuid,uuid,boolean)',
    'public.finalize_project_deletion(uuid,uuid,uuid)']) signature,
    unnest(ARRAY['anon','authenticated']) role_name
  WHERE has_function_privilege(role_name,signature,'EXECUTE')
),'all four operations remain unavailable to browser roles');

SELECT extensions.ok(has_function_privilege('service_role',
  'app_private.project_calendar_deletion_pending(uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','app_private.project_calendar_deletion_pending(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','app_private.project_calendar_deletion_pending(uuid)','EXECUTE'),
  'only the server role may use the private deletion-status helper');
SELECT extensions.ok(NOT has_table_privilege('service_role',
  'app_private.project_deletion_operations','SELECT'),
  'calendar claims do not acquire direct access to deletion receipts');

SELECT extensions.dblink_connect('calendar_deletion',
  CASE WHEN inet_server_addr() IS NULL THEN 'host='||current_setting('unix_socket_directories')
    ELSE 'hostaddr='||host(inet_server_addr()) END
  ||' port='||current_setting('port')||' dbname='||current_database()
  ||' user='||current_user||' password='||current_user||' sslmode=disable');
SELECT extensions.dblink_exec('calendar_deletion','SET statement_timeout=''10s''');

BEGIN;
SELECT extensions.is(public.prepare_project_deletion('cf742000-0000-4000-8000-000000000001',
  'cf740000-0000-4000-8000-000000000002')->>'outcome','prepared',
  'an administrator prepares deletion after creator cleanup');
SELECT extensions.dblink_send_query('calendar_deletion',$query$
  SELECT public.claim_personal_calendar_sync('cf740000-0000-4000-8000-000000000001',
    'project','cf742000-0000-4000-8000-000000000001','sync')
$query$);
SELECT pg_sleep(0.2);
SELECT extensions.is(extensions.dblink_is_busy('calendar_deletion'),1,
  'the different creator waits for the project lock, not the administrator account lock');
COMMIT;
SELECT * FROM extensions.dblink_get_result('calendar_deletion',false) AS result(receipt jsonb);
SELECT extensions.ok(extensions.dblink_error_message('calendar_deletion') LIKE '%Project deletion in progress%',
  'the waiting claim checks the committed deletion marker');
SELECT * FROM extensions.dblink_get_result('calendar_deletion',false) AS result(receipt jsonb);
SELECT extensions.is((SELECT phase FROM app_private.personal_calendar_sync_receipts
  WHERE source_id='cf742000-0000-4000-8000-000000000001'),'removed',
  'a refused resync cannot reset the removed receipt or mint a provider lease');
BEGIN;
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.claim_personal_calendar_update(
  'cf740000-0000-4000-8000-000000000001','cf742000-0000-4000-8000-000000000001','{}')$$,
  '55000','Project deletion in progress','update claims use the same deletion fence through the actual server role');
COMMIT;
SELECT extensions.is(public.finalize_project_deletion(
  (SELECT id FROM app_private.project_deletion_operations WHERE project_id='cf742000-0000-4000-8000-000000000001'),
  'cf742000-0000-4000-8000-000000000001','cf740000-0000-4000-8000-000000000002')->>'outcome',
  'completed','settled creator cleanup permits deletion');
SELECT extensions.throws_ok($$SELECT public.claim_personal_calendar_sync(
  'cf740000-0000-4000-8000-000000000001','project','cf742000-0000-4000-8000-000000000001','sync')$$,
  'P0002','Calendar source not found','a deleted source cannot create a new calendar claim');

BEGIN;
SELECT extensions.is(public.claim_personal_calendar_sync('cf740000-0000-4000-8000-000000000001',
  'project','cf742000-0000-4000-8000-000000000002','sync')->>'phase','syncing',
  'the creator can claim a project before deletion begins');
SELECT extensions.dblink_send_query('calendar_deletion',$query$
  SELECT public.prepare_project_deletion('cf742000-0000-4000-8000-000000000002',
    'cf740000-0000-4000-8000-000000000002')
$query$);
SELECT pg_sleep(0.2);
SELECT extensions.is(extensions.dblink_is_busy('calendar_deletion'),1,
  'deletion waits for an uncommitted creator claim');
COMMIT;
CREATE TEMP TABLE calendar_deletion_result AS
SELECT * FROM extensions.dblink_get_result('calendar_deletion') AS result(receipt jsonb);
SELECT * FROM extensions.dblink_get_result('calendar_deletion') AS result(receipt jsonb);
SELECT extensions.is((SELECT receipt->>'outcome' FROM calendar_deletion_result),'calendar_in_progress',
  'the waiting deletion sees the committed provider lease and refuses preparation');
SELECT extensions.is((SELECT count(*) FROM app_private.project_deletion_operations
  WHERE project_id='cf742000-0000-4000-8000-000000000002'),0::bigint,
  'refusal creates no deletion operation or asset claim');

UPDATE app_private.personal_calendar_sync_receipts
SET lease_until=now()-interval '1 minute',events='[{"id":"calendar740event","event":{}}]'
WHERE source_id='cf742000-0000-4000-8000-000000000002';
SELECT extensions.is(public.prepare_project_deletion('cf742000-0000-4000-8000-000000000002',
  'cf740000-0000-4000-8000-000000000002')->>'outcome','calendar_in_progress',
  'lease expiry does not erase a durable create plan or prove provider cleanup');
UPDATE app_private.personal_calendar_sync_receipts SET events='[]'
WHERE source_id='cf742000-0000-4000-8000-000000000002';
SELECT extensions.is(public.prepare_project_deletion('cf742000-0000-4000-8000-000000000002',
  'cf740000-0000-4000-8000-000000000002')->>'outcome','prepared',
  'an expired never-planned create has no provider write to strand');
-- Model a legacy pending operation that predates the new fence.
UPDATE app_private.personal_calendar_sync_receipts SET events='[{"id":"calendar740event","event":{}}]'
WHERE source_id='cf742000-0000-4000-8000-000000000002';
SELECT extensions.is(public.finalize_project_deletion(
  (SELECT id FROM app_private.project_deletion_operations WHERE project_id='cf742000-0000-4000-8000-000000000002'),
  'cf742000-0000-4000-8000-000000000002','cf740000-0000-4000-8000-000000000002')->>'outcome',
  'calendar_in_progress','finalization also fences legacy pending operations with unresolved plans');
SELECT extensions.is((SELECT count(*) FROM public.projects
  WHERE id='cf742000-0000-4000-8000-000000000002'),1::bigint,'refused finalization preserves the source');
SELECT extensions.is(public.claim_personal_calendar_sync('cf740000-0000-4000-8000-000000000001',
  'project','cf742000-0000-4000-8000-000000000002','remove',NULL,'calendar740event')->>'phase',
  'removing','cleanup claims remain available while deletion is pending');
UPDATE app_private.personal_calendar_sync_receipts SET claim_token=NULL,lease_until=NULL
WHERE source_id='cf742000-0000-4000-8000-000000000002';
SELECT extensions.is(public.finalize_project_deletion(
  (SELECT id FROM app_private.project_deletion_operations WHERE project_id='cf742000-0000-4000-8000-000000000002'),
  'cf742000-0000-4000-8000-000000000002','cf740000-0000-4000-8000-000000000002')->>'outcome',
  'completed','retained removal authority permits the existing administrator deletion flow');
SELECT extensions.is((SELECT phase FROM app_private.personal_calendar_sync_receipts
  WHERE source_id='cf742000-0000-4000-8000-000000000002'),'removing',
  'deletion retains the receipt for provider cleanup after its source is gone');

UPDATE public.projects SET creator_calendar_event_id='calendar740update'
WHERE id='cf742000-0000-4000-8000-000000000003';
BEGIN;
SELECT extensions.is(public.claim_personal_calendar_update('cf740000-0000-4000-8000-000000000001',
  'cf742000-0000-4000-8000-000000000003',app_private.personal_calendar_project_source(
    'cf742000-0000-4000-8000-000000000003','cf740000-0000-4000-8000-000000000001'))->>'phase',
  'updating','an ordinary settled event can still enter the update protocol');
SELECT extensions.dblink_send_query('calendar_deletion',$query$
  SELECT public.prepare_project_deletion('cf742000-0000-4000-8000-000000000003',
    'cf740000-0000-4000-8000-000000000002')
$query$);
SELECT pg_sleep(0.2);
SELECT extensions.is(extensions.dblink_is_busy('calendar_deletion'),1,
  'deletion waits for an uncommitted update claim');
COMMIT;
CREATE TEMP TABLE calendar_update_deletion_result AS
SELECT * FROM extensions.dblink_get_result('calendar_deletion') AS result(receipt jsonb);
SELECT * FROM extensions.dblink_get_result('calendar_deletion') AS result(receipt jsonb);
SELECT extensions.is((SELECT receipt->>'outcome' FROM calendar_update_deletion_result),'calendar_in_progress',
  'the waiting deletion sees the update claim after commit');
UPDATE app_private.personal_calendar_sync_receipts SET lease_until=now()-interval '1 minute'
WHERE source_id='cf742000-0000-4000-8000-000000000003';
SELECT extensions.is(public.prepare_project_deletion('cf742000-0000-4000-8000-000000000003',
  'cf740000-0000-4000-8000-000000000002')->>'outcome','calendar_in_progress',
  'an expired update still requires reconciliation before deletion');
SELECT extensions.is(public.prepare_project_deletion('cf742000-0000-4000-8000-000000000004',
  'cf740000-0000-4000-8000-000000000003')->>'outcome','forbidden',
  'the calendar guard does not replace actor authorization');
INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status)
VALUES ('cf743000-0000-4000-8000-000000000001','cf742000-0000-4000-8000-000000000004',
  'cf740000-0000-4000-8000-000000000003','oneTime','approved');
SELECT extensions.is(public.prepare_project_deletion('cf742000-0000-4000-8000-000000000004',
  'cf740000-0000-4000-8000-000000000002')->>'outcome','prepared',
  'an unrelated project remains deletable');
SELECT extensions.throws_ok($$SELECT public.claim_personal_calendar_sync(
  'cf740000-0000-4000-8000-000000000003','signup','cf743000-0000-4000-8000-000000000001',
  'sync','oneTime')$$,'55000','Project deletion in progress',
  'signup calendar claims fence their parent project before creating a receipt');
SELECT extensions.is((SELECT count(*) FROM app_private.personal_calendar_sync_receipts
  WHERE source_id='cf743000-0000-4000-8000-000000000001'),0::bigint,
  'a refused signup claim leaves no provider intent');
SELECT extensions.dblink_disconnect('calendar_deletion');
DELETE FROM public.project_signups WHERE id='cf743000-0000-4000-8000-000000000001';

DELETE FROM app_private.personal_calendar_sync_receipts WHERE user_id='cf740000-0000-4000-8000-000000000001';
DELETE FROM app_private.project_deletion_operations WHERE project_id::text LIKE 'cf742000-%';
DELETE FROM public.projects WHERE id::text LIKE 'cf742000-%';
DELETE FROM public.organization_members WHERE organization_id='cf741000-0000-4000-8000-000000000001';
DELETE FROM public.organizations WHERE id='cf741000-0000-4000-8000-000000000001';
DELETE FROM auth.users WHERE id::text LIKE 'cf740000-%';
SELECT * FROM extensions.finish();
