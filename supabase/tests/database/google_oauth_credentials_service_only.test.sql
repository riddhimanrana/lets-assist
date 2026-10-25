BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(34);

SELECT extensions.ok((SELECT relrowsecurity FROM pg_class
  WHERE oid='public.user_calendar_connections'::regclass), 'credential RLS remains enabled');
SELECT extensions.is((SELECT count(*) FROM app_private.client_relation_grant_catalog()
  WHERE relation_name='user_calendar_connections'), 0::bigint, 'credentials are absent from the browser relation catalog');

WITH roles(name) AS (VALUES ('anon'), ('authenticated')),
privileges(name) AS (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'))
SELECT extensions.ok(NOT has_table_privilege(roles.name, 'public.user_calendar_connections', privileges.name),
  roles.name || ' has no credential table ' || privileges.name)
FROM roles CROSS JOIN privileges;

WITH roles(name) AS (VALUES ('anon'), ('authenticated')),
privileges(name) AS (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES'))
SELECT extensions.ok(NOT has_any_column_privilege(roles.name, 'public.user_calendar_connections', privileges.name),
  roles.name || ' has no effective credential column ' || privileges.name)
FROM roles CROSS JOIN privileges;

SELECT extensions.ok((SELECT bool_and(has_table_privilege('service_role', 'public.user_calendar_connections', privilege))
  FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) privilege), 'service role retains exact credential CRUD');
SELECT extensions.ok((SELECT bool_and(NOT has_table_privilege('service_role', 'public.user_calendar_connections', privilege))
  FROM unnest(ARRAY['TRIGGER','TRUNCATE','REFERENCES','MAINTAIN']) privilege), 'service role has no credential DDL or maintenance grants');

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('c64b0000-0000-4000-8000-000000000001','authenticated','authenticated','credential-owner@local.test',now(),'{}','{}',now(),now()),
       ('c64b0000-0000-4000-8000-000000000002','authenticated','authenticated','credential-other@local.test',now(),'{}','{}',now(),now());

SET LOCAL ROLE service_role;
SELECT extensions.lives_ok($$INSERT INTO public.user_calendar_connections
  (id,user_id,provider,access_token,refresh_token,token_expires_at,calendar_email)
  VALUES ('c64b0010-0000-4000-8000-000000000001','c64b0000-0000-4000-8000-000000000001',
    'google','fictional-encrypted-access','fictional-encrypted-refresh',now()+interval '1 hour','credential-owner@local.test')$$,
  'service credential insert remains available');
SELECT extensions.is((SELECT count(*) FROM public.user_calendar_connections WHERE id='c64b0010-0000-4000-8000-000000000001'),
  1::bigint, 'service can read the exact credential');
SELECT extensions.lives_ok($$UPDATE public.user_calendar_connections SET access_token='fictional-refreshed-access'
  WHERE id='c64b0010-0000-4000-8000-000000000001' AND user_id='c64b0000-0000-4000-8000-000000000001'$$,
  'service refresh remains available');
SELECT extensions.is((SELECT access_token FROM public.user_calendar_connections WHERE id='c64b0010-0000-4000-8000-000000000001'),
  'fictional-refreshed-access', 'service refresh persisted');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','c64b0000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok($$SELECT access_token,refresh_token FROM public.user_calendar_connections
  WHERE user_id='c64b0000-0000-4000-8000-000000000001'$$, '42501', NULL, 'own-account browser cannot read ciphertext columns');
SELECT extensions.throws_ok($$UPDATE public.user_calendar_connections SET access_token='browser-replacement'
  WHERE user_id='c64b0000-0000-4000-8000-000000000001'$$, '42501', NULL, 'own-account browser cannot replace credential state');
SELECT extensions.throws_ok($$DELETE FROM public.user_calendar_connections
  WHERE user_id='c64b0000-0000-4000-8000-000000000001'$$, '42501', NULL, 'own-account browser cannot bypass disconnect cleanup');
SELECT extensions.throws_ok($$INSERT INTO public.user_calendar_connections
  (user_id,access_token,refresh_token,token_expires_at,calendar_email)
  VALUES ('c64b0000-0000-4000-8000-000000000001','browser-access','browser-refresh',now(),'credential-owner@local.test')$$,
  '42501', NULL, 'own-account browser cannot inject provider credentials');
SELECT extensions.throws_ok($$SELECT id FROM public.user_calendar_connections
  WHERE user_id='c64b0000-0000-4000-8000-000000000002'$$, '42501', NULL, 'another account is also inaccessible');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT extensions.throws_ok($$SELECT access_token FROM public.user_calendar_connections$$, '42501', NULL, 'anonymous reads are denied');
SELECT extensions.throws_ok($$UPDATE public.user_calendar_connections SET is_active=false$$, '42501', NULL, 'anonymous writes are denied');
SELECT extensions.throws_ok($$DELETE FROM public.user_calendar_connections$$, '42501', NULL, 'anonymous deletion is denied');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
SELECT extensions.lives_ok($$DELETE FROM public.user_calendar_connections
  WHERE id='c64b0010-0000-4000-8000-000000000001' AND user_id='c64b0000-0000-4000-8000-000000000001'$$,
  'service disconnect can remove the exact credential');
SELECT extensions.is((SELECT count(*) FROM public.user_calendar_connections WHERE id='c64b0010-0000-4000-8000-000000000001'),
  0::bigint, 'service disconnect removed the credential');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
