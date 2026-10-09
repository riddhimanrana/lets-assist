-- Committed synthetic fixtures let independent sessions prove the account fence.
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SET statement_timeout='8s';
SELECT extensions.plan(12);

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES
 ('e7c00000-0000-4000-8000-000000000001','authenticated','authenticated','shared-account-one@local.test',now(),'{}','{}',now(),now()),
 ('e7c00000-0000-4000-8000-000000000002','authenticated','authenticated','shared-account-two@local.test',now(),'{}','{}',now(),now());

SELECT extensions.dblink_connect(name,
 'hostaddr='||host(inet_server_addr())||' port='||current_setting('port')||
 ' dbname='||current_database()||' user='||current_user||' password='||current_user||
 ' sslmode=disable options='||quote_literal('-c statement_timeout=5000'))
FROM unnest(ARRAY['account_shared_writer','account_exclusive_remover']) AS names(name);

SELECT extensions.dblink_exec('account_shared_writer','BEGIN');
SELECT extensions.dblink_exec('account_shared_writer',
 $$SET LOCAL request.jwt.claim.sub='e7c00000-0000-4000-8000-000000000001'$$);
SELECT extensions.dblink_exec('account_shared_writer',
 $$INSERT INTO public.notifications(user_id,title,body,type)
 VALUES('e7c00000-0000-4000-8000-000000000002','Synthetic shared writer','Synthetic','general')$$);

BEGIN;
SET LOCAL request.jwt.claim.sub='e7c00000-0000-4000-8000-000000000001';
UPDATE public.profiles SET full_name='Synthetic concurrent writer'
WHERE id='e7c00000-0000-4000-8000-000000000001';
SELECT extensions.dblink_exec('account_exclusive_remover','BEGIN');
SELECT extensions.dblink_send_query('account_exclusive_remover',
 $$SELECT public.begin_account_deletion(
 'e7c00000-0000-4000-8000-000000000001','e7c00000-0000-4000-8000-000000000001')->>'phase'$$);
SELECT pg_sleep(0.1);
SELECT extensions.is(extensions.dblink_is_busy('account_exclusive_remover'),1,
 'account removal waits while ordinary writers hold shared account locks');
COMMIT;
SELECT pg_sleep(0.1);
SELECT extensions.is(extensions.dblink_is_busy('account_exclusive_remover'),1,
 'releasing one writer does not bypass another active writer');
SELECT extensions.dblink_exec('account_shared_writer','COMMIT');
SELECT extensions.is((SELECT phase FROM extensions.dblink_get_result('account_exclusive_remover') AS result(phase text)),
 'external_pending','removal proceeds after every earlier writer commits');
SELECT count(*) FROM extensions.dblink_get_result('account_exclusive_remover') AS result(phase text);

SELECT extensions.throws_ok($$INSERT INTO public.notifications(user_id,title,body,type)
 VALUES('e7c00000-0000-4000-8000-000000000001','Synthetic late reference','Synthetic','general')$$,
 '55P03','Account writes are temporarily unavailable. Retry the transaction.',
 'a late service reference refuses the exclusive removal lock without waiting');
SELECT extensions.throws_ok($$INSERT INTO storage.objects(bucket_id,name,owner)
 VALUES('data-exports','e7c00000-0000-4000-8000-000000000001/synthetic.zip','e7c00000-0000-4000-8000-000000000001')$$,
 '55P03','Account writes are temporarily unavailable. Retry the transaction.',
 'late Storage metadata refuses the exclusive removal lock without waiting');
SELECT set_config('request.jwt.claim.sub','e7c00000-0000-4000-8000-000000000001',false);
SELECT extensions.throws_ok($$UPDATE public.profiles SET full_name='Synthetic' WHERE false$$,
 '55P03','Account writes are temporarily unavailable. Retry the transaction.',
 'even a zero-row client write refuses removal lock contention');
SELECT set_config('request.jwt.claim.sub','',false);
SELECT extensions.lives_ok($$INSERT INTO public.notifications(user_id,title,body,type)
 VALUES('e7c00000-0000-4000-8000-000000000002','Synthetic unrelated writer','Synthetic','general')$$,
 'an unrelated account remains writable while removal is in progress');

SELECT extensions.dblink_exec('account_exclusive_remover','COMMIT');
SELECT extensions.throws_ok($$INSERT INTO public.notifications(user_id,title,body,type)
 VALUES('e7c00000-0000-4000-8000-000000000001','Synthetic pending reference','Synthetic','general')$$,
 '42501','Cannot create a reference to an account being deleted.',
 'service references recheck the committed deletion state after taking their shared lock');
SELECT set_config('request.jwt.claim.sub','e7c00000-0000-4000-8000-000000000001',false);
SELECT extensions.throws_ok($$UPDATE public.profiles SET full_name='Synthetic' WHERE false$$,
 '42501','Account deletion is pending or complete.',
 'client writes recheck committed pending state after the removal lock is released');
SELECT set_config('request.jwt.claim.sub','',false);
SELECT extensions.throws_ok($$INSERT INTO storage.objects(bucket_id,name,owner)
 VALUES('data-exports','e7c00000-0000-4000-8000-000000000001/synthetic.zip','e7c00000-0000-4000-8000-000000000001')$$,
 '42501','Storage writes are blocked for an account being deleted.',
 'Storage references remain fenced throughout external cleanup');
SELECT extensions.is((SELECT phase FROM app_private.account_deletion_operations
 WHERE target_user_id='e7c00000-0000-4000-8000-000000000001'),'external_pending',
 'rejected late writes do not change the durable cleanup phase');
SELECT extensions.is((SELECT count(*) FROM public.profiles
 WHERE id='e7c00000-0000-4000-8000-000000000002'),1::bigint,
 'the unrelated account retains its profile');

SELECT extensions.dblink_disconnect('account_shared_writer');
SELECT extensions.dblink_disconnect('account_exclusive_remover');
DELETE FROM public.notifications WHERE user_id IN
 ('e7c00000-0000-4000-8000-000000000001','e7c00000-0000-4000-8000-000000000002');
DELETE FROM auth.users WHERE id IN
 ('e7c00000-0000-4000-8000-000000000001','e7c00000-0000-4000-8000-000000000002');
DELETE FROM app_private.account_deletion_operations
 WHERE target_user_id='e7c00000-0000-4000-8000-000000000001';
SELECT * FROM extensions.finish();
RESET statement_timeout;
