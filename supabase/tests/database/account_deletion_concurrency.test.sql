-- Local synthetic writers commit to prove that the second admin revalidates.
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SELECT extensions.plan(9);
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('fd800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'delete-race-'||n||'@local.test',now(),'{}','{}',now(),now() FROM generate_series(1,4) n;
INSERT INTO public.organizations(id,name,username,type,join_code)
VALUES('fd810000-0000-4000-8000-000000000001','Deletion race','deletion-race','school','839931'),
 ('fd810000-0000-4000-8000-000000000002','Status race','status-race','school','839932');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
SELECT 'fd810000-0000-4000-8000-000000000001',id,'admin','active' FROM auth.users WHERE id IN
 ('fd800000-0000-4000-8000-000000000001','fd800000-0000-4000-8000-000000000002');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
SELECT 'fd810000-0000-4000-8000-000000000002',id,'admin','active' FROM auth.users WHERE id IN
 ('fd800000-0000-4000-8000-000000000003','fd800000-0000-4000-8000-000000000004');
SELECT extensions.dblink_connect('account_deletion_race', 'hostaddr='||host(inet_server_addr())||' port='||current_setting('port')||
 ' dbname='||current_database()||' user='||current_user||' password='||current_user||' sslmode=disable');
BEGIN;
SELECT extensions.is(public.begin_account_deletion('fd800000-0000-4000-8000-000000000001','fd800000-0000-4000-8000-000000000001')->>'phase',
 'external_pending','the first admin can leave while the second remains active');
SELECT extensions.dblink_send_query('account_deletion_race',$query$
 SELECT public.begin_account_deletion('fd800000-0000-4000-8000-000000000002','fd800000-0000-4000-8000-000000000002')->>'phase'
$query$);
SELECT pg_sleep(0.2);
SELECT extensions.is(extensions.dblink_is_busy('account_deletion_race'),1,'the second account waits for the shared organization membership mutex');
COMMIT;
CREATE TEMP TABLE account_race_result AS SELECT * FROM extensions.dblink_get_result('account_deletion_race') AS result(phase text);
SELECT extensions.is((SELECT phase FROM account_race_result),'blocked','the waiting deletion reruns preflight after the first commit');
SELECT extensions.is((SELECT count(*) FROM public.organization_members WHERE organization_id='fd810000-0000-4000-8000-000000000001' AND role='admin'),
 1::bigint,'one administrator remains after concurrent account deletion requests');
SELECT extensions.is((SELECT count(*) FROM public.profiles WHERE id='fd800000-0000-4000-8000-000000000002'),1::bigint,
 'the refused concurrent deletion preserves the remaining account');
SELECT extensions.dblink_disconnect('account_deletion_race');
SELECT extensions.dblink_connect('account_status_race', 'hostaddr='||host(inet_server_addr())||' port='||current_setting('port')||
 ' dbname='||current_database()||' user='||current_user||' password='||current_user||' sslmode=disable');
SELECT extensions.dblink_exec('account_status_race','SET ROLE authenticated');
SELECT extensions.dblink_exec('account_status_race',$query$SET request.jwt.claim.sub='fd800000-0000-4000-8000-000000000004'$query$);
BEGIN;
SELECT extensions.is(public.begin_account_deletion('fd800000-0000-4000-8000-000000000003','fd800000-0000-4000-8000-000000000003')->>'phase',
 'external_pending','another fixture begins removal with a second active admin');
SELECT extensions.dblink_send_query('account_status_race',$query$
 WITH changed AS (UPDATE public.organization_members SET status='inactive'
 WHERE organization_id='fd810000-0000-4000-8000-000000000002' AND user_id='fd800000-0000-4000-8000-000000000004' RETURNING id)
 SELECT count(*) FROM changed
$query$);
SELECT pg_sleep(0.2);
SELECT extensions.is(extensions.dblink_is_busy('account_status_race'),1,'direct authenticated status deactivation waits for the same organization mutex');
COMMIT;
SELECT * FROM extensions.dblink_get_result('account_status_race',false) AS result(affected bigint);
SELECT extensions.ok(extensions.dblink_error_message('account_status_race') LIKE '%cannot remove the final active organization admin%',
 'the waiting status change rechecks active admins after deletion commits');
SELECT extensions.is((SELECT status FROM public.organization_members WHERE organization_id='fd810000-0000-4000-8000-000000000002'
 AND user_id='fd800000-0000-4000-8000-000000000004'),'active','the remaining administrator stays active');
SELECT extensions.dblink_disconnect('account_status_race');
DELETE FROM app_private.account_deletion_operations WHERE target_user_id IN
 ('fd800000-0000-4000-8000-000000000001','fd800000-0000-4000-8000-000000000002','fd800000-0000-4000-8000-000000000003','fd800000-0000-4000-8000-000000000004');
DELETE FROM public.organization_members WHERE organization_id IN ('fd810000-0000-4000-8000-000000000001','fd810000-0000-4000-8000-000000000002');
DELETE FROM public.organizations WHERE id IN ('fd810000-0000-4000-8000-000000000001','fd810000-0000-4000-8000-000000000002');
DELETE FROM auth.users WHERE id IN ('fd800000-0000-4000-8000-000000000001','fd800000-0000-4000-8000-000000000002','fd800000-0000-4000-8000-000000000003','fd800000-0000-4000-8000-000000000004');
SELECT * FROM extensions.finish();
