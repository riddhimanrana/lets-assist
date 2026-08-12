-- AUD-034: authenticated reporters can read only their own server-written
-- moderation evidence and cannot mutate it directly.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(18);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('a3400000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'report-owner@local.test', now(), '{}', '{}', now(), now()),
  ('a3400000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'report-other@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.content_reports (
  id, reporter_id, content_type, content_id, reason, description
) VALUES
  ('a3410000-0000-4000-8000-000000000001',
   'a3400000-0000-4000-8000-000000000001', 'project',
   'a3420000-0000-4000-8000-000000000001', 'spam', 'owner report evidence'),
  ('a3410000-0000-4000-8000-000000000002',
   'a3400000-0000-4000-8000-000000000002', 'project',
   'a3420000-0000-4000-8000-000000000002', 'spam', 'other report evidence');

SELECT extensions.ok(has_table_privilege('authenticated', 'public.content_reports', 'SELECT'), 'authenticated retains SELECT');
SELECT extensions.ok(NOT has_table_privilege('authenticated', 'public.content_reports', 'INSERT'), 'authenticated has no INSERT');
SELECT extensions.ok(NOT has_table_privilege('authenticated', 'public.content_reports', 'UPDATE'), 'authenticated has no UPDATE');
SELECT extensions.ok(NOT has_table_privilege('authenticated', 'public.content_reports', 'DELETE'), 'authenticated has no DELETE');
SELECT extensions.ok(NOT has_table_privilege('anon', 'public.content_reports', 'INSERT'), 'anon has no INSERT');
SELECT extensions.ok(NOT has_table_privilege('anon', 'public.content_reports', 'UPDATE'), 'anon has no UPDATE');
SELECT extensions.ok(NOT has_table_privilege('anon', 'public.content_reports', 'DELETE'), 'anon has no DELETE');
SELECT extensions.ok(
  NOT has_column_privilege('authenticated', 'public.content_reports', 'reporter_id', 'INSERT'),
  'authenticated has no column-level reporter_id INSERT'
);
SELECT extensions.ok(
  NOT has_column_privilege('authenticated', 'public.content_reports', 'status', 'UPDATE'),
  'authenticated has no column-level status UPDATE'
);
SELECT extensions.ok(has_table_privilege('service_role', 'public.content_reports', 'SELECT,INSERT,UPDATE,DELETE'), 'service_role retains CRUD');

SELECT extensions.is(
  (SELECT array_agg(privilege ORDER BY privilege)
   FROM app_private.client_relation_grant_catalog()
   WHERE relation_name = 'content_reports' AND role_name = 'authenticated'),
  ARRAY['SELECT'::text],
  'catalog exposes authenticated SELECT only'
);
SELECT extensions.is(
  (SELECT count(*) FROM pg_policy
   WHERE polrelid = 'public.content_reports'::regclass
     AND polcmd IN ('a', 'w', 'd')),
  0::bigint,
  'content_reports has no client write policies'
);
SELECT extensions.is(
  (SELECT count(*) FROM pg_policy
   WHERE polrelid = 'public.content_reports'::regclass
     AND polname = 'content_reports_select_merged' AND polcmd = 'r'),
  1::bigint,
  'owner SELECT policy remains'
);

SET LOCAL request.jwt.claims =
  '{"sub":"a3400000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$INSERT INTO public.content_reports
      (reporter_id, content_type, content_id, reason, description)
    VALUES ('a3400000-0000-4000-8000-000000000001', 'project',
      'a3420000-0000-4000-8000-000000000003', 'spam', 'direct insert evidence')$$,
  '42501', NULL, 'authenticated direct INSERT fails'
);
SELECT extensions.throws_ok(
  $$UPDATE public.content_reports SET description = 'changed'
    WHERE id = 'a3410000-0000-4000-8000-000000000001'$$,
  '42501', NULL, 'authenticated direct UPDATE fails'
);
SELECT extensions.throws_ok(
  $$DELETE FROM public.content_reports
    WHERE id = 'a3410000-0000-4000-8000-000000000001'$$,
  '42501', NULL, 'authenticated direct DELETE fails'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.content_reports
   WHERE id = 'a3410000-0000-4000-8000-000000000001'),
  1::bigint,
  'reporter can SELECT their own report'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.content_reports
   WHERE id = 'a3410000-0000-4000-8000-000000000002'),
  0::bigint,
  'reporter cannot SELECT another users report'
);

RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
