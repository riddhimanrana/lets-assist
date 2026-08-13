-- AUD-041: moderation evidence is written only by the reviewed server
-- transaction. Reporters keep owner-scoped reads, every direct write is
-- refused, a forged target cannot become evidence, the combined quota decision
-- is all-or-nothing, retries replay for a bounded window and then stop, the
-- reporter pseudonym is random rather than derived, and evidence outlives the
-- reporter's account.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(84);

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
  VALUES ('reporter_id'), ('status'), ('priority'), ('request_fingerprint'),
         ('request_sequence'), ('replay_expires_at'), ('reporter_reference')
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
  (SELECT count(*) FROM app_private.client_relation_grant_catalog()
   WHERE relation_name = 'reporter_references'),
  0::bigint,
  'the reporter pseudonym mapping is absent from the client catalog'
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

-- ---------------------------------------------------------------------------
-- The reporter pseudonym mapping is server-only
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  (SELECT relrowsecurity FROM pg_class
   WHERE oid = 'public.reporter_references'::regclass),
  'the reporter pseudonym mapping enforces row-level security'
);

SELECT extensions.is(
  (SELECT count(*) FROM pg_policy
   WHERE polrelid = 'public.reporter_references'::regclass),
  0::bigint,
  'the reporter pseudonym mapping grants no role a policy'
);

WITH client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
)
SELECT extensions.ok(
  NOT has_table_privilege(role_name, 'public.reporter_references', 'SELECT')
  AND NOT has_table_privilege(role_name, 'public.reporter_references', 'INSERT')
  AND NOT has_table_privilege(role_name, 'public.reporter_references', 'UPDATE')
  AND NOT has_table_privilege(role_name, 'public.reporter_references', 'DELETE'),
  format('%s holds no privilege on the reporter pseudonym mapping', role_name)
)
FROM client_roles;

SELECT extensions.is(
  (SELECT confdeltype FROM pg_constraint
   WHERE conname = 'reporter_references_reporter_id_fkey'
     AND conrelid = 'public.reporter_references'::regclass),
  'n'::"char",
  'deleting an account detaches its pseudonym instead of removing it'
);

-- ---------------------------------------------------------------------------
-- Function surface
-- ---------------------------------------------------------------------------

WITH client_roles(role_name) AS (
  VALUES ('public'), ('anon'), ('authenticated')
)
SELECT extensions.ok(
  NOT has_function_privilege(
    role_name,
    'public.submit_content_report(text,uuid,text,uuid,text,text,integer,text[],integer[],integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    role_name,
    'public.consume_content_report_attempt(text[],integer[],integer)',
    'EXECUTE'
  ),
  format('%s cannot execute either content report function', role_name)
)
FROM client_roles;

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.submit_content_report(text,uuid,text,uuid,text,text,integer,text[],integer[],integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.consume_content_report_attempt(text[],integer[],integer)',
    'EXECUTE'
  ),
  'service_role can execute both content report functions'
);

WITH definers(signature) AS (
  VALUES
    ('public.submit_content_report(text,uuid,text,uuid,text,text,integer,text[],integer[],integer)'),
    ('public.consume_content_report_attempt(text[],integer[],integer)')
)
SELECT extensions.ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']
   FROM pg_proc WHERE oid = signature::regprocedure),
  format('%s is SECURITY DEFINER with a pinned empty search_path', signature)
)
FROM definers;

SELECT extensions.ok(
  (SELECT NOT prosecdef AND proconfig @> ARRAY['search_path=""']
   FROM pg_proc
   WHERE oid = 'app_private.consume_rate_limit_buckets(text[],integer[],integer,timestamptz)'::regprocedure),
  'the shared quota helper runs as its caller with a pinned empty search_path'
);

WITH client_roles(role_name) AS (
  VALUES ('public'), ('anon'), ('authenticated')
)
SELECT extensions.ok(
  NOT has_function_privilege(
    role_name,
    'app_private.consume_rate_limit_buckets(text[],integer[],integer,timestamptz)',
    'EXECUTE'
  ),
  format('%s cannot execute the shared quota helper', role_name)
)
FROM client_roles;

-- The advisory lock has to be taken before the replay lookup. A read that
-- happened first would let two concurrent retries both observe "no report".
SELECT extensions.ok(
  position(
    'pg_advisory_xact_lock'
    IN pg_get_functiondef('public.submit_content_report(text,uuid,text,uuid,text,text,integer,text[],integer[],integer)'::regprocedure)
  ) < position(
    'replay_expires_at >'
    IN pg_get_functiondef('public.submit_content_report(text,uuid,text,uuid,text,text,integer,text[],integer[],integer)'::regprocedure)
  ),
  'the replay lookup happens under the advisory lock'
);

-- ---------------------------------------------------------------------------
-- Evidence shape
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_index
    WHERE indexrelid = 'public.content_reports_request_occurrence_uidx'::regclass
      AND indisunique
  ),
  'one fingerprint occurrence can be stored only once'
);

SELECT extensions.is(
  (SELECT confdeltype FROM pg_constraint
   WHERE conname = 'content_reports_reporter_id_fkey'
     AND conrelid = 'public.content_reports'::regclass),
  'n'::"char",
  'deleting the reporter detaches the report rather than deleting it'
);

SELECT extensions.is(
  (SELECT confdeltype FROM pg_constraint
   WHERE conname = 'content_reports_reporter_reference_fkey'
     AND conrelid = 'public.content_reports'::regclass),
  'r'::"char",
  'a pseudonym still referenced by evidence cannot be removed'
);

WITH expected_checks(check_name) AS (
  VALUES ('content_reports_request_fingerprint_format_check'),
         ('content_reports_request_sequence_positive_check'),
         ('content_reports_request_identity_complete_check')
)
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = check_name
      AND conrelid = 'public.content_reports'::regclass
      AND contype = 'c'
  ),
  format('%s constrains stored evidence', check_name)
)
FROM expected_checks;

-- ---------------------------------------------------------------------------
-- Fixtures
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

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'a3430000-0000-4000-8000-000000000001',
  'Reported Organization', 'reported-organization', 'nonprofit', '430001'
);

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login
) VALUES (
  'a3420000-0000-4000-8000-000000000001',
  'a3400000-0000-4000-8000-000000000002',
  'Reported Project', 'Local', 'Synthetic reported project fixture',
  'oneTime', 'manual',
  '{"oneTime":{"date":"2030-09-01","startTime":"09:00","endTime":"12:00","volunteers":20}}',
  true
);

DELETE FROM public.api_rate_limits
WHERE rate_limit_key LIKE 'pgtap:content-report%';

-- ---------------------------------------------------------------------------
-- A forged target never becomes evidence, and never costs report quota
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE forged_target_outcomes AS
SELECT 'project' AS target_type, submission.outcome
FROM public.submit_content_report(
  repeat('f1', 32), 'a3400000-0000-4000-8000-000000000001', 'project',
  'a3420000-0000-4000-8000-0000000000ff', 'spam',
  'A report naming a project identifier that does not exist.',
  600, ARRAY['pgtap:content-report:forged'], ARRAY[5], 600
) AS submission
UNION ALL
SELECT 'profile', submission.outcome
FROM public.submit_content_report(
  repeat('f2', 32), 'a3400000-0000-4000-8000-000000000001', 'profile',
  'a3400000-0000-4000-8000-0000000000ff', 'spam',
  'A report naming a profile identifier that does not exist.',
  600, ARRAY['pgtap:content-report:forged'], ARRAY[5], 600
) AS submission
UNION ALL
SELECT 'organization', submission.outcome
FROM public.submit_content_report(
  repeat('f3', 32), 'a3400000-0000-4000-8000-000000000001', 'organization',
  'a3430000-0000-4000-8000-0000000000ff', 'spam',
  'A report naming an organization identifier that does not exist.',
  600, ARRAY['pgtap:content-report:forged'], ARRAY[5], 600
) AS submission;

SELECT extensions.is(
  (SELECT array_agg(DISTINCT outcome) FROM forged_target_outcomes),
  ARRAY['invalid_target'::text],
  'a forged identifier is refused for every supported target type'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.content_reports
   WHERE request_fingerprint IN (repeat('f1', 32), repeat('f2', 32), repeat('f3', 32))),
  0::bigint,
  'a forged identifier stores no evidence'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.api_rate_limits
   WHERE rate_limit_key = 'pgtap:content-report:forged'
     AND request_count > 0),
  0::bigint,
  'a forged identifier does not consume stored-report quota'
);

-- ---------------------------------------------------------------------------
-- The reviewed submission transaction
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE content_report_submission AS
SELECT * FROM public.submit_content_report(
  repeat('a', 64),
  'a3400000-0000-4000-8000-000000000001',
  'project',
  'a3420000-0000-4000-8000-000000000001',
  'hate_speech',
  'Durable moderation evidence about a reported project.',
  600,
  ARRAY['pgtap:content-report:user', 'pgtap:content-report:ip'],
  ARRAY[2, 3],
  600
);

SELECT extensions.ok(
  (SELECT outcome = 'created' AND report_id IS NOT NULL AND reset_at IS NULL
   FROM content_report_submission),
  'the first submission is accepted as a new report'
);

SELECT extensions.is(
  (SELECT ARRAY[status::text, priority::text]
   FROM public.content_reports
   WHERE request_fingerprint = repeat('a', 64)),
  ARRAY['pending'::text, 'high'::text],
  'moderation state is derived by the transaction, not supplied'
);

SELECT extensions.is(
  (SELECT ARRAY[request_sequence, 1]
   FROM public.content_reports
   WHERE request_fingerprint = repeat('a', 64)),
  ARRAY[1, 1],
  'the first occurrence of a fingerprint is numbered one'
);

SELECT extensions.ok(
  (SELECT replay_expires_at > now()
   FROM public.content_reports
   WHERE request_fingerprint = repeat('a', 64)),
  'the replay deadline is set from the server clock'
);

SELECT extensions.is(
  (SELECT array_agg(request_count ORDER BY rate_limit_key)
   FROM public.api_rate_limits
   WHERE rate_limit_key LIKE 'pgtap:content-report:user'
      OR rate_limit_key LIKE 'pgtap:content-report:ip'),
  ARRAY[1, 1],
  'both quota buckets are charged exactly once'
);

-- ---------------------------------------------------------------------------
-- The reporter pseudonym
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  (SELECT mapping.reporter_id = 'a3400000-0000-4000-8000-000000000001'
   FROM public.content_reports AS report
   JOIN public.reporter_references AS mapping
     ON mapping.reference = report.reporter_reference
   WHERE report.request_fingerprint = repeat('a', 64)),
  'the stored pseudonym resolves to its reporter through the server-only mapping'
);

-- The predecessor stored sha256('content-report-reporter:' || id), which anyone
-- holding a candidate account id could recompute and confirm. A random UUID
-- cannot be, and this asserts the old value is genuinely gone rather than
-- merely renamed.
SELECT extensions.isnt(
  (SELECT reporter_reference::text
   FROM public.content_reports
   WHERE request_fingerprint = repeat('a', 64)),
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
  'the pseudonym is not recomputable from the account identifier'
);

-- ---------------------------------------------------------------------------
-- Bounded replay
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE content_report_replay AS
SELECT * FROM public.submit_content_report(
  repeat('a', 64),
  'a3400000-0000-4000-8000-000000000001',
  'project',
  'a3420000-0000-4000-8000-000000000001',
  'hate_speech',
  'Durable moderation evidence about a reported project.',
  600,
  ARRAY['pgtap:content-report:user', 'pgtap:content-report:ip'],
  ARRAY[2, 3],
  600
);

SELECT extensions.ok(
  (SELECT replay.outcome = 'replayed'
     AND replay.report_id = original.report_id
   FROM content_report_replay AS replay
   CROSS JOIN content_report_submission AS original),
  'a retried submission replays the original report'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.content_reports
   WHERE request_fingerprint = repeat('a', 64)),
  1::bigint,
  'a retried submission creates no duplicate evidence'
);

SELECT extensions.is(
  (SELECT array_agg(request_count ORDER BY rate_limit_key)
   FROM public.api_rate_limits
   WHERE rate_limit_key LIKE 'pgtap:content-report:user'
      OR rate_limit_key LIKE 'pgtap:content-report:ip'),
  ARRAY[1, 1],
  'a retried submission does not charge stored-report quota again'
);

-- Age the first report past its replay deadline. This is what a report that
-- moderators have since resolved or dismissed looks like: the same person
-- reporting the same content again must be able to file it again.
UPDATE public.content_reports
SET replay_expires_at = now() - interval '1 second'
WHERE request_fingerprint = repeat('a', 64);

CREATE TEMP TABLE content_report_after_window AS
SELECT * FROM public.submit_content_report(
  repeat('a', 64),
  'a3400000-0000-4000-8000-000000000001',
  'project',
  'a3420000-0000-4000-8000-000000000001',
  'hate_speech',
  'Durable moderation evidence about a reported project.',
  600,
  ARRAY['pgtap:content-report:user', 'pgtap:content-report:ip'],
  ARRAY[2, 3],
  600
);

SELECT extensions.ok(
  (SELECT later.outcome = 'created'
     AND later.report_id <> original.report_id
   FROM content_report_after_window AS later
   CROSS JOIN content_report_submission AS original),
  'an identical report filed after the replay window becomes a new report'
);

SELECT extensions.is(
  (SELECT array_agg(request_sequence ORDER BY request_sequence)
   FROM public.content_reports
   WHERE request_fingerprint = repeat('a', 64)),
  ARRAY[1, 2],
  'the second occurrence takes the next sequence number'
);

SELECT extensions.is(
  (SELECT count(DISTINCT reporter_reference)
   FROM public.content_reports
   WHERE request_fingerprint = repeat('a', 64)),
  1::bigint,
  'the same reporter keeps one pseudonym across reports'
);

SELECT extensions.is(
  (SELECT array_agg(request_count ORDER BY rate_limit_key)
   FROM public.api_rate_limits
   WHERE rate_limit_key LIKE 'pgtap:content-report:user'
      OR rate_limit_key LIKE 'pgtap:content-report:ip'),
  ARRAY[2, 2],
  'the report created after the window charges stored-report quota once'
);

-- ---------------------------------------------------------------------------
-- The combined quota decision
-- ---------------------------------------------------------------------------

-- Exhaust only the shared IP bucket. The user bucket must not be consumed by
-- the attempt that the IP bucket rejects.
UPDATE public.api_rate_limits
SET request_count = 3
WHERE rate_limit_key = 'pgtap:content-report:ip';

CREATE TEMP TABLE content_report_denied AS
SELECT * FROM public.submit_content_report(
  repeat('b', 64),
  'a3400000-0000-4000-8000-000000000001',
  'organization',
  'a3430000-0000-4000-8000-000000000001',
  'spam',
  'A second report that must be refused by the shared quota bucket.',
  600,
  ARRAY['pgtap:content-report:user', 'pgtap:content-report:ip'],
  ARRAY[2, 3],
  600
);

SELECT extensions.ok(
  (SELECT outcome = 'rate_limited' AND report_id IS NULL AND reset_at IS NOT NULL
   FROM content_report_denied),
  'a denied combined quota returns no report and a reset time'
);

SELECT extensions.ok(
  (SELECT denied.reset_at
     = limits.window_started_at + make_interval(secs => 600)
   FROM content_report_denied AS denied
   JOIN public.api_rate_limits AS limits
     ON limits.rate_limit_key = 'pgtap:content-report:ip'),
  'the reset time is the exhausted bucket window start plus the window'
);

SELECT extensions.is(
  (SELECT request_count FROM public.api_rate_limits
   WHERE rate_limit_key = 'pgtap:content-report:user'),
  2,
  'the passing bucket is not consumed when another bucket rejects'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.content_reports
   WHERE request_fingerprint = repeat('b', 64)),
  0::bigint,
  'a denied submission writes no evidence'
);

-- ---------------------------------------------------------------------------
-- Attempt metering
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  (SELECT allowed AND reset_at IS NULL
   FROM public.consume_content_report_attempt(
     ARRAY['pgtap:content-report-attempt:user'], ARRAY[2], 900
   )),
  'the attempt meter admits a caller under the ceiling'
);

SELECT extensions.is(
  (SELECT request_count FROM public.api_rate_limits
   WHERE rate_limit_key = 'pgtap:content-report-attempt:user'),
  1,
  'an admitted attempt is charged once'
);

-- A caller with no trusted address is metered on the user dimension alone
-- rather than sharing one bucket with every other address-less caller.
SELECT extensions.ok(
  (SELECT allowed
   FROM public.consume_content_report_attempt(
     ARRAY['pgtap:content-report-attempt:user'], ARRAY[2], 900
   )),
  'the attempt meter accepts a single-bucket decision when no address is known'
);

SELECT extensions.ok(
  (SELECT NOT allowed
     AND reset_at
       = (SELECT window_started_at + make_interval(secs => 900)
          FROM public.api_rate_limits
          WHERE rate_limit_key = 'pgtap:content-report-attempt:user')
   FROM public.consume_content_report_attempt(
     ARRAY['pgtap:content-report-attempt:user'], ARRAY[2], 900
   )),
  'the attempt meter refuses at the ceiling and reports when it resets'
);

SELECT extensions.is(
  (SELECT request_count FROM public.api_rate_limits
   WHERE rate_limit_key = 'pgtap:content-report-attempt:user'),
  2,
  'a refused attempt does not push the bucket past its ceiling'
);

SELECT extensions.ok(
  (SELECT NOT allowed
   FROM public.consume_content_report_attempt(
     ARRAY['pgtap:content-report-attempt:user', 'pgtap:content-report-attempt:ip'],
     ARRAY[2, 50],
     900
   )),
  'an exhausted user bucket refuses the whole attempt decision'
);

SELECT extensions.is(
  (SELECT request_count FROM public.api_rate_limits
   WHERE rate_limit_key = 'pgtap:content-report-attempt:ip'),
  0,
  'the address bucket is not consumed when the user bucket rejects'
);

-- ---------------------------------------------------------------------------
-- Refusals the service never expects to see
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$SELECT public.submit_content_report(
      repeat('c', 64),
      'a3400000-0000-4000-8000-000000000001',
      'comment',
      'a3420000-0000-4000-8000-000000000004',
      'spam',
      'A target type the moderation queue cannot act on.',
      600, ARRAY['pgtap:content-report:user'], ARRAY[2], 600
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
      'a3420000-0000-4000-8000-000000000001',
      'spam',
      'A submission carrying a malformed request fingerprint.',
      600, ARRAY['pgtap:content-report:user'], ARRAY[2], 600
    )$$,
  'P0001',
  'invalid content report request fingerprint',
  'the transaction refuses a malformed request fingerprint'
);

SELECT extensions.throws_ok(
  $$SELECT public.submit_content_report(
      repeat('d', 64),
      'a3400000-0000-4000-8000-000000000001',
      'project',
      'a3420000-0000-4000-8000-000000000001',
      'spam',
      'A submission carrying an out-of-range replay window.',
      0, ARRAY['pgtap:content-report:user'], ARRAY[2], 600
    )$$,
  'P0001',
  'invalid content report replay window',
  'the transaction refuses a replay window it did not sanction'
);

SELECT extensions.throws_ok(
  $$SELECT public.consume_content_report_attempt(
      ARRAY['pgtap:content-report-attempt:user', 'pgtap:content-report-attempt:ip'],
      ARRAY[5],
      900
    )$$,
  'P0001',
  'invalid quota bucket set',
  'the attempt meter refuses misaligned bucket and limit arrays'
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
  'a3420000-0000-4000-8000-000000000001',
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
      'a3420000-0000-4000-8000-000000000001', 'spam', 'direct insert evidence')$$,
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

SELECT extensions.throws_ok(
  $$SELECT reference FROM public.reporter_references$$,
  '42501', NULL, 'an authenticated client cannot read the pseudonym mapping'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.content_reports
   WHERE request_fingerprint = repeat('a', 64)),
  2::bigint,
  'a reporter can still read the reports they filed'
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

CREATE TEMP TABLE reporter_pseudonym_before_deletion AS
SELECT DISTINCT reporter_reference AS reference
FROM public.content_reports
WHERE request_fingerprint = repeat('a', 64);

DELETE FROM auth.users WHERE id = 'a3400000-0000-4000-8000-000000000001';

SELECT extensions.is(
  (SELECT count(*) FROM public.content_reports
   WHERE request_fingerprint = repeat('a', 64)),
  2::bigint,
  'deleting the reporter account retains the reports'
);

SELECT extensions.ok(
  (SELECT bool_and(reporter_id IS NULL AND reporter_reference IS NOT NULL)
   FROM public.content_reports
   WHERE request_fingerprint = repeat('a', 64)),
  'the actor link is detached while the pseudonymous reference remains'
);

SELECT extensions.ok(
  (SELECT mapping.reporter_id IS NULL
   FROM public.reporter_references AS mapping
   JOIN reporter_pseudonym_before_deletion AS retained
     ON retained.reference = mapping.reference),
  'the pseudonym survives the account it used to describe'
);

SELECT extensions.is(
  (SELECT count(DISTINCT reporter_reference)
   FROM public.content_reports
   WHERE request_fingerprint = repeat('a', 64)),
  1::bigint,
  'the deleted reporter''s reports remain linked to each other'
);

SELECT * FROM extensions.finish();
ROLLBACK;
