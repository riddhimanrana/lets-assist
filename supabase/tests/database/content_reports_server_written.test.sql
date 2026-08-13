-- AUD-041: moderation evidence is written only by the reviewed server
-- transaction. Reporters keep owner-scoped reads, every direct write is
-- refused, the combined quota decision is all-or-nothing, retries replay, and
-- evidence outlives the reporter's account.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(43);

-- ---------------------------------------------------------------------------
-- Effective privileges
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  has_table_privilege('authenticated', 'public.content_reports', 'SELECT'),
  'authenticated retains owner-scoped SELECT'
);

WITH client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
), write_privileges(privilege_name) AS (
  VALUES ('INSERT'), ('UPDATE'), ('DELETE')
)
SELECT extensions.ok(
  NOT has_table_privilege(role_name, 'public.content_reports', privilege_name),
  format('%s cannot %s public.content_reports', role_name, privilege_name)
)
FROM client_roles
CROSS JOIN write_privileges;

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.content_reports', 'SELECT'),
  'anon cannot read moderation evidence at all'
);

WITH evidence_columns(column_name) AS (
  VALUES ('reporter_id'), ('status'), ('priority'), ('request_key'),
         ('reporter_reference')
)
SELECT extensions.ok(
  NOT has_column_privilege(
    'authenticated', 'public.content_reports', column_name, 'INSERT'
  )
  AND NOT has_column_privilege(
    'authenticated', 'public.content_reports', column_name, 'UPDATE'
  ),
  format('authenticated holds no column write on content_reports.%s', column_name)
)
FROM evidence_columns;

SELECT extensions.ok(
  has_table_privilege(
    'service_role', 'public.content_reports', 'SELECT,INSERT,UPDATE,DELETE'
  ),
  'service_role retains the server write path'
);

SELECT extensions.is(
  (SELECT array_agg(privilege ORDER BY privilege)
   FROM app_private.client_relation_grant_catalog()
   WHERE relation_name = 'content_reports' AND role_name = 'authenticated'),
  ARRAY['SELECT'::text],
  'the reviewed relation catalog exposes authenticated SELECT only'
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
  'the owner SELECT policy remains'
);

WITH client_roles(role_name) AS (
  VALUES ('public'), ('anon'), ('authenticated')
)
SELECT extensions.ok(
  NOT has_function_privilege(
    role_name,
    'public.submit_content_report(text,uuid,text,uuid,text,text,text[],integer[],integer)',
    'EXECUTE'
  ),
  format('%s cannot execute the content report transaction', role_name)
)
FROM client_roles;

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.submit_content_report(text,uuid,text,uuid,text,text,text[],integer[],integer)',
    'EXECUTE'
  ),
  'service_role can execute the content report transaction'
);

SELECT extensions.ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']
   FROM pg_proc
   WHERE oid = 'public.submit_content_report(text,uuid,text,uuid,text,text,text[],integer[],integer)'::regprocedure),
  'the transaction is SECURITY DEFINER with a pinned empty search_path'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_index
    WHERE indexrelid = 'public.content_reports_request_key_uidx'::regclass
      AND indisunique
  ),
  'the idempotency key is unique'
);

SELECT extensions.is(
  (SELECT confdeltype FROM pg_constraint
   WHERE conname = 'content_reports_reporter_id_fkey'
     AND conrelid = 'public.content_reports'::regclass),
  'n'::"char",
  'deleting the reporter detaches the report rather than deleting it'
);

-- ---------------------------------------------------------------------------
-- The reviewed submission transaction
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('a3400000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'report-owner@local.test', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('a3400000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'report-other@local.test', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

DELETE FROM public.api_rate_limits
WHERE rate_limit_key LIKE 'pgtap:content-report:%';

CREATE TEMP TABLE content_report_submission AS
SELECT * FROM public.submit_content_report(
  repeat('a', 64),
  'a3400000-0000-4000-8000-000000000001',
  'project',
  'a3420000-0000-4000-8000-000000000001',
  'hate_speech',
  'Durable moderation evidence about a reported project.',
  ARRAY['pgtap:content-report:user', 'pgtap:content-report:ip'],
  ARRAY[2, 3],
  600
);

SELECT extensions.ok(
  (SELECT allowed AND NOT replayed AND report_id IS NOT NULL
   FROM content_report_submission),
  'the first submission is accepted as a new report'
);

SELECT extensions.is(
  (SELECT ARRAY[status::text, priority::text]
   FROM public.content_reports
   WHERE request_key = repeat('a', 64)),
  ARRAY['pending'::text, 'high'::text],
  'moderation state is derived by the transaction, not supplied'
);

SELECT extensions.is(
  (SELECT reporter_reference
   FROM public.content_reports
   WHERE request_key = repeat('a', 64)),
  encode(
    extensions.digest(
      convert_to(
        'content-report-reporter:a3400000-0000-4000-8000-000000000001',
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ),
  'the pseudonymous reporter reference is derived, not reversible'
);

SELECT extensions.is(
  (SELECT array_agg(request_count ORDER BY rate_limit_key)
   FROM public.api_rate_limits
   WHERE rate_limit_key LIKE 'pgtap:content-report:%'),
  ARRAY[1, 1],
  'both quota buckets are charged exactly once'
);

CREATE TEMP TABLE content_report_replay AS
SELECT * FROM public.submit_content_report(
  repeat('a', 64),
  'a3400000-0000-4000-8000-000000000001',
  'project',
  'a3420000-0000-4000-8000-000000000001',
  'hate_speech',
  'Durable moderation evidence about a reported project.',
  ARRAY['pgtap:content-report:user', 'pgtap:content-report:ip'],
  ARRAY[2, 3],
  600
);

SELECT extensions.ok(
  (SELECT replay.allowed
     AND replay.replayed
     AND replay.report_id = original.report_id
   FROM content_report_replay AS replay
   CROSS JOIN content_report_submission AS original),
  'a retried submission replays the original report'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.content_reports WHERE request_key = repeat('a', 64)),
  1::bigint,
  'a retried submission creates no duplicate evidence'
);

SELECT extensions.is(
  (SELECT array_agg(request_count ORDER BY rate_limit_key)
   FROM public.api_rate_limits
   WHERE rate_limit_key LIKE 'pgtap:content-report:%'),
  ARRAY[1, 1],
  'a retried submission does not charge quota again'
);

-- Exhaust only the shared IP bucket. The user bucket must not be consumed by
-- the attempt that the IP bucket rejects.
UPDATE public.api_rate_limits
SET request_count = 3
WHERE rate_limit_key = 'pgtap:content-report:ip';

CREATE TEMP TABLE content_report_denied AS
SELECT * FROM public.submit_content_report(
  repeat('b', 64),
  'a3400000-0000-4000-8000-000000000001',
  'project',
  'a3420000-0000-4000-8000-000000000003',
  'spam',
  'A second report that must be refused by the shared quota bucket.',
  ARRAY['pgtap:content-report:user', 'pgtap:content-report:ip'],
  ARRAY[2, 3],
  600
);

SELECT extensions.ok(
  (SELECT NOT allowed AND NOT replayed AND report_id IS NULL AND reset_at IS NOT NULL
   FROM content_report_denied),
  'a denied combined quota returns no report and a reset time'
);

SELECT extensions.is(
  (SELECT request_count FROM public.api_rate_limits
   WHERE rate_limit_key = 'pgtap:content-report:user'),
  1,
  'the passing bucket is not consumed when another bucket rejects'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.content_reports WHERE request_key = repeat('b', 64)),
  0::bigint,
  'a denied submission writes no evidence'
);

SELECT extensions.throws_ok(
  $$SELECT public.submit_content_report(
      repeat('c', 64),
      'a3400000-0000-4000-8000-000000000001',
      'comment',
      'a3420000-0000-4000-8000-000000000004',
      'spam',
      'A target type the moderation queue cannot act on.',
      ARRAY['pgtap:content-report:user'],
      ARRAY[2],
      600
    )$$,
  'P0001',
  'unsupported content report target type',
  'the transaction refuses target types the queue cannot act on'
);

SELECT extensions.throws_ok(
  $$SELECT public.submit_content_report(
      'not-a-sha256',
      'a3400000-0000-4000-8000-000000000001',
      'project',
      'a3420000-0000-4000-8000-000000000005',
      'spam',
      'A submission carrying a malformed idempotency key.',
      ARRAY['pgtap:content-report:user'],
      ARRAY[2],
      600
    )$$,
  'P0001',
  'invalid content report request key',
  'the transaction refuses a malformed idempotency key'
);

-- ---------------------------------------------------------------------------
-- Direct browser access
-- ---------------------------------------------------------------------------

INSERT INTO public.content_reports (
  id, reporter_id, content_type, content_id, reason, description
) VALUES (
  'a3410000-0000-4000-8000-000000000002',
  'a3400000-0000-4000-8000-000000000002',
  'project',
  'a3420000-0000-4000-8000-000000000002',
  'spam',
  'Another reporter''s evidence.'
);

SET LOCAL request.jwt.claims =
  '{"sub":"a3400000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$INSERT INTO public.content_reports
      (reporter_id, content_type, content_id, reason, description)
    VALUES ('a3400000-0000-4000-8000-000000000001', 'project',
      'a3420000-0000-4000-8000-000000000006', 'spam', 'direct insert evidence')$$,
  '42501', NULL, 'an authenticated client cannot insert evidence directly'
);

SELECT extensions.throws_ok(
  $$UPDATE public.content_reports SET description = 'rewritten', status = 'resolved'
    WHERE reporter_id = 'a3400000-0000-4000-8000-000000000001'$$,
  '42501', NULL, 'an authenticated client cannot rewrite its own evidence'
);

SELECT extensions.throws_ok(
  $$DELETE FROM public.content_reports
    WHERE reporter_id = 'a3400000-0000-4000-8000-000000000001'$$,
  '42501', NULL, 'an authenticated client cannot delete its own evidence'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.content_reports
   WHERE request_key = repeat('a', 64)),
  1::bigint,
  'a reporter can still read the report they filed'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.content_reports
   WHERE id = 'a3410000-0000-4000-8000-000000000002'),
  0::bigint,
  'a reporter cannot read another reporter''s evidence'
);

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Retention across account deletion
-- ---------------------------------------------------------------------------

DELETE FROM auth.users WHERE id = 'a3400000-0000-4000-8000-000000000001';

SELECT extensions.is(
  (SELECT count(*) FROM public.content_reports WHERE request_key = repeat('a', 64)),
  1::bigint,
  'deleting the reporter account retains the report'
);

SELECT extensions.ok(
  (SELECT reporter_id IS NULL AND reporter_reference IS NOT NULL
   FROM public.content_reports
   WHERE request_key = repeat('a', 64)),
  'the actor link is detached while the pseudonymous reference remains'
);

SELECT * FROM extensions.finish();
ROLLBACK;
