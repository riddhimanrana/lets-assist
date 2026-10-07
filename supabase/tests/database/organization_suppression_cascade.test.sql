BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(5);
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('fc800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'suppression-'||n||'@local.test',now(),'{}','{}',now(),now() FROM generate_series(1,2) n;
INSERT INTO public.organizations(id,name,username,type,join_code)
VALUES('fc810000-0000-4000-8000-000000000001','Suppression A','suppression-a','school','839951'),
 ('fc810000-0000-4000-8000-000000000002','Suppression B','suppression-b','school','839952');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
VALUES('fc810000-0000-4000-8000-000000000001','fc800000-0000-4000-8000-000000000001','member','active'),
 ('fc810000-0000-4000-8000-000000000002','fc800000-0000-4000-8000-000000000002','member','active');
DELETE FROM public.organization_members WHERE organization_id='fc810000-0000-4000-8000-000000000001';
SELECT extensions.is((SELECT count(*) FROM public.organization_autojoin_suppressions WHERE organization_id='fc810000-0000-4000-8000-000000000001'),
 1::bigint,'explicit membership removal still suppresses automatic rejoining');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
VALUES('fc810000-0000-4000-8000-000000000001','fc800000-0000-4000-8000-000000000001','member','active');
SELECT extensions.lives_ok($$DELETE FROM public.organizations WHERE id='fc810000-0000-4000-8000-000000000001'$$,
 'organization deletion does not create a suppression referencing its deleted parent');
SELECT extensions.is((SELECT count(*) FROM public.organization_autojoin_suppressions WHERE organization_id='fc810000-0000-4000-8000-000000000001'),
 0::bigint,'organization deletion removes its obsolete suppressions');
SELECT extensions.lives_ok($$DELETE FROM auth.users WHERE id='fc800000-0000-4000-8000-000000000002'$$,
 'Auth cascade does not create a suppression referencing its deleted user');
SELECT extensions.is((SELECT count(*) FROM public.organization_autojoin_suppressions WHERE user_id='fc800000-0000-4000-8000-000000000002'),
 0::bigint,'Auth deletion leaves no obsolete suppression');
SELECT * FROM extensions.finish();
ROLLBACK;
