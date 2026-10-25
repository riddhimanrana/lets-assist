BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
SELECT extensions.ok(has_function_privilege('service_role','public.manage_organization_staff_invite(uuid,uuid,text,integer)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.manage_organization_staff_invite(uuid,uuid,text,integer)','EXECUTE')
 AND NOT has_function_privilege('anon','public.manage_organization_staff_invite(uuid,uuid,text,integer)','EXECUTE'),
 'only the service can supply a freshly authenticated actor for staff capabilities');
SELECT extensions.ok((SELECT prosecdef AND provolatile='v' AND proconfig=ARRAY['search_path=""'] FROM pg_proc
 WHERE oid='public.manage_organization_staff_invite(uuid,uuid,text,integer)'::regprocedure), 'staff operation uses a fixed path and fresh authorization reads');
INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
VALUES ('fc707000-0000-4000-8000-000000000001','authenticated','authenticated','org-write-admin@local.test','{}','{}'),
 ('fc707000-0000-4000-8000-000000000002','authenticated','authenticated','org-write-other@local.test','{}','{}'),
 ('fc707000-0000-4000-8000-000000000003','authenticated','authenticated','org-write-inactive@local.test','{}','{}');
INSERT INTO public.organizations(id,name,username,type,join_code)
VALUES ('fc707100-0000-4000-8000-000000000001','Organization write fixture','org-write-fixture','school','970701'),
 ('fc707100-0000-4000-8000-000000000002','Organization delete fixture','org-delete-fixture','school','970702');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
SELECT o.id,a.id,'admin',CASE WHEN right(a.id::text,1)='3' THEN 'inactive' ELSE 'active' END
FROM public.organizations o CROSS JOIN auth.users a
WHERE o.id IN ('fc707100-0000-4000-8000-000000000001','fc707100-0000-4000-8000-000000000002')
 AND a.id IN ('fc707000-0000-4000-8000-000000000001','fc707000-0000-4000-8000-000000000002','fc707000-0000-4000-8000-000000000003');
SELECT set_config('request.jwt.claims','{"sub":"fc707000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT extensions.lives_ok($$UPDATE public.organizations SET name='Authorized name',description='Authorized description'
 WHERE id='fc707100-0000-4000-8000-000000000001'$$, 'an active admin can update normal profile fields');
SELECT extensions.is((SELECT name FROM public.organizations WHERE id='fc707100-0000-4000-8000-000000000001'), 'Authorized name',
 'the active-admin update actually persists');
SELECT extensions.throws_ok($$UPDATE public.organizations SET verified=true WHERE id='fc707100-0000-4000-8000-000000000001'$$,
 '42501','organization capability fields require a server-authorized operation','the profile boundary preserves trust-field restrictions');
SELECT extensions.throws_ok($$UPDATE public.organizations SET id='fc707100-0000-4000-8000-000000000099' WHERE id='fc707100-0000-4000-8000-000000000001'$$,
 '42501','Organization identity cannot be changed.','the profile write cannot move the organization identity');
SELECT extensions.throws_ok($$SELECT public.manage_organization_staff_invite('fc707000-0000-4000-8000-000000000002','fc707100-0000-4000-8000-000000000001','generate',30)$$,
 '42501',NULL,'a browser cannot impersonate another actor through the staff operation');
SELECT set_config('request.jwt.claims','{"sub":"fc707000-0000-4000-8000-000000000003","role":"authenticated"}',true);
WITH changed AS (UPDATE public.organizations SET name='Forbidden inactive update'
 WHERE id='fc707100-0000-4000-8000-000000000001' RETURNING id)
SELECT extensions.is(count(*)::integer,0,'an inactive admin cannot update through the direct Data API role') FROM changed;
WITH changed AS (DELETE FROM public.organizations WHERE id='fc707100-0000-4000-8000-000000000002' RETURNING id)
SELECT extensions.is(count(*)::integer,0,'an inactive admin cannot delete through the direct Data API role') FROM changed;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT extensions.is((public.manage_organization_staff_invite('fc707000-0000-4000-8000-000000000001','fc707100-0000-4000-8000-000000000001','generate',30)->>'success')::boolean,
 true,'an active admin receives a newly generated staff capability');
SELECT extensions.is((SELECT staff_join_token_issued_by FROM public.organizations WHERE id='fc707100-0000-4000-8000-000000000001'),
 'fc707000-0000-4000-8000-000000000001'::uuid,'the atomic operation binds the fresh actor as issuer');
SELECT extensions.is((public.manage_organization_staff_invite('fc707000-0000-4000-8000-000000000001','fc707100-0000-4000-8000-000000000001','get',30)->>'hasToken')::boolean,
 true,'the authorized read returns current staff details');
SELECT extensions.throws_ok($$SELECT public.manage_organization_staff_invite('fc707000-0000-4000-8000-000000000001','fc707100-0000-4000-8000-000000000001','generate',366)$$,
 '22023','Staff invitation expiry must be between 1 and 365 days.','staff expiry remains bounded to the UI maximum');
SELECT extensions.throws_ok(format('SELECT public.manage_organization_staff_invite(%L,%L,%L,30)',
 'fc707000-0000-4000-8000-000000000003','fc707100-0000-4000-8000-000000000001',operation),
 '42501','Only active admins can manage staff invitations.','inactive admin is refused at atomic staff '||operation)
FROM (VALUES('generate'),('get'),('revoke')) actions(operation);
UPDATE public.organization_members SET status='inactive' WHERE organization_id='fc707100-0000-4000-8000-000000000001'
 AND user_id='fc707000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT public.manage_organization_staff_invite('fc707000-0000-4000-8000-000000000001','fc707100-0000-4000-8000-000000000001','revoke',30)$$,
 '42501','Only active admins can manage staff invitations.','revocation after an earlier successful read cannot revoke the staff token');
SELECT extensions.is((public.manage_organization_staff_invite('fc707000-0000-4000-8000-000000000002','fc707100-0000-4000-8000-000000000001','revoke',30)->>'success')::boolean,
 true,'another active admin can revoke the staff capability');
SELECT extensions.ok((SELECT staff_join_token IS NULL AND staff_join_token_issued_by IS NULL AND staff_join_token_created_at IS NULL
 AND staff_join_token_expires_at IS NULL FROM public.organizations WHERE id='fc707100-0000-4000-8000-000000000001'),
 'successful revocation clears the token and issuer together');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"fc707000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
WITH changed AS (DELETE FROM public.organizations WHERE id='fc707100-0000-4000-8000-000000000002' RETURNING id)
SELECT extensions.is(count(*)::integer,1,'an active admin still deletes an authorized organization') FROM changed;
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
