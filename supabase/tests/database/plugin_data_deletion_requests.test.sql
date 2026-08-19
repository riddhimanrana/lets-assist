-- Durable, service-only request/receipt semantics for permanent plugin-data
-- deletion. The hook itself runs in TypeScript; this suite proves the database
-- claim boundary that prevents concurrent or cross-scope replay.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(35);

SELECT has_table(
  'private',
  'plugin_data_deletion_requests',
  'the private durable deletion receipt table exists'
);

SELECT function_privs_are(
  'public',
  'begin_plugin_data_deletion_request',
  ARRAY['uuid', 'text', 'uuid', 'text', 'uuid'],
  'service_role',
  ARRAY['EXECUTE'],
  'only the service role may acquire a deletion attempt'
);
SELECT function_privs_are(
  'public',
  'begin_plugin_data_deletion_request',
  ARRAY['uuid', 'text', 'uuid', 'text', 'uuid'],
  'authenticated',
  ARRAY[]::text[],
  'authenticated users cannot acquire deletion attempts directly'
);
SELECT function_privs_are(
  'public',
  'begin_plugin_data_deletion_request',
  ARRAY['uuid', 'text', 'uuid', 'text', 'uuid'],
  'anon',
  ARRAY[]::text[],
  'anonymous users cannot acquire deletion attempts directly'
);
SELECT function_privs_are(
  'public',
  'complete_plugin_data_deletion_request',
  ARRAY['uuid', 'uuid', 'text', 'text'],
  'service_role',
  ARRAY['EXECUTE'],
  'only the service role may finalize deletion attempts'
);
SELECT function_privs_are(
  'public',
  'complete_plugin_data_deletion_request',
  ARRAY['uuid', 'uuid', 'text', 'text'],
  'authenticated',
  ARRAY[]::text[],
  'authenticated users cannot finalize deletion attempts directly'
);
SELECT function_privs_are(
  'public',
  'record_plugin_data_deletion_audit_result',
  ARRAY['uuid', 'text', 'uuid', 'text'],
  'service_role',
  ARRAY['EXECUTE'],
  'only the service role may attach audit outcomes to deletion receipts'
);
SELECT function_privs_are(
  'public',
  'record_plugin_data_deletion_audit_result',
  ARRAY['uuid', 'text', 'uuid', 'text'],
  'authenticated',
  ARRAY[]::text[],
  'authenticated users cannot alter deletion audit outcomes directly'
);

SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'private.plugin_data_deletion_requests',
    'SELECT'
  ),
  'authenticated has no direct read privilege on private deletion receipts'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'private.plugin_data_deletion_requests',
    'INSERT,UPDATE,DELETE'
  ),
  'authenticated has no direct write privilege on private deletion receipts'
);
SELECT ok(
  has_table_privilege(
    'service_role',
    'private.plugin_data_deletion_requests',
    'SELECT,INSERT,UPDATE'
  ),
  'service role has the exact receipt mutation privileges it needs'
);
SELECT ok(
  NOT has_table_privilege(
    'service_role',
    'private.plugin_data_deletion_requests',
    'DELETE'
  ),
  'receipts cannot be deleted through the service role'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'c2000000-0000-4000-8000-000000000001';
SET LOCAL "request.jwt.claims" =
  '{"sub":"c2000000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT throws_ok(
  $$
    SELECT *
    FROM public.begin_plugin_data_deletion_request(
      'c1000000-0000-4000-8000-000000000001',
      'test-plugin',
      'c3000000-0000-4000-8000-000000000001',
      repeat('a', 64),
      'c2000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  NULL,
  'authenticated cannot bypass function ACLs to begin deletion'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.sub" = 'c2000000-0000-4000-8000-000000000001';
SET LOCAL "request.jwt.claims" =
  '{"sub":"c2000000-0000-4000-8000-000000000001","role":"service_role"}';

CREATE TEMP TABLE first_claim AS
SELECT *
FROM public.begin_plugin_data_deletion_request(
  'c1000000-0000-4000-8000-000000000001',
  'test-plugin',
  'c3000000-0000-4000-8000-000000000001',
  repeat('a', 64),
  'c2000000-0000-4000-8000-000000000001'
);

SELECT is(
  (SELECT decision FROM first_claim),
  'execute',
  'the first use of a request key acquires one hook execution'
);
SELECT is(
  (SELECT status FROM first_claim),
  'processing',
  'the durable receipt says processing before plugin code starts'
);
SELECT ok(
  (SELECT claim_token IS NOT NULL FROM first_claim),
  'the executing attempt receives an unguessable finalization token'
);
SELECT is(
  (SELECT attempt_count FROM first_claim),
  1,
  'the first execution records attempt one'
);

SELECT is(
  (
    SELECT decision
    FROM public.begin_plugin_data_deletion_request(
      'c1000000-0000-4000-8000-000000000001',
      'test-plugin',
      'c3000000-0000-4000-8000-000000000001',
      repeat('a', 64),
      'c2000000-0000-4000-8000-000000000001'
    )
  ),
  'in_progress',
  'a concurrent or lost-response replay cannot rerun a processing hook'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.begin_plugin_data_deletion_request(
      'c1000000-0000-4000-8000-000000000002',
      'test-plugin',
      'c3000000-0000-4000-8000-000000000001',
      repeat('b', 64),
      'c2000000-0000-4000-8000-000000000001'
    )
  $$,
  '22023',
  NULL,
  'one request key cannot be replayed for another organization'
);
SELECT throws_ok(
  $$
    SELECT *
    FROM public.begin_plugin_data_deletion_request(
      'c1000000-0000-4000-8000-000000000001',
      'other-plugin',
      'c3000000-0000-4000-8000-000000000001',
      repeat('c', 64),
      'c2000000-0000-4000-8000-000000000001'
    )
  $$,
  '22023',
  NULL,
  'one request key cannot be replayed for another plugin'
);
SELECT throws_ok(
  $$
    SELECT *
    FROM public.begin_plugin_data_deletion_request(
      'c1000000-0000-4000-8000-000000000001',
      'test-plugin',
      'c3000000-0000-4000-8000-000000000001',
      repeat('d', 64),
      'c2000000-0000-4000-8000-000000000002'
    )
  $$,
  '22023',
  NULL,
  'one request key cannot be replayed by another actor'
);
SELECT throws_ok(
  $$
    SELECT *
    FROM public.begin_plugin_data_deletion_request(
      'c1000000-0000-4000-8000-000000000001',
      'test-plugin',
      'c3000000-0000-4000-8000-000000000001',
      repeat('f', 64),
      'c2000000-0000-4000-8000-000000000001'
    )
  $$,
  '22023',
  NULL,
  'one request key cannot be rebound to different confirmation scope'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.begin_plugin_data_deletion_request(
      'c1000000-0000-4000-8000-000000000001',
      'test-plugin',
      'c3000000-0000-4000-8000-000000000002',
      repeat('e', 64),
      'c2000000-0000-4000-8000-000000000001'
    )
  $$,
  '55000',
  NULL,
  'a different request key cannot overlap an unresolved organization/plugin deletion'
);

SELECT is(
  public.complete_plugin_data_deletion_request(
    (SELECT request_id FROM first_claim),
    'c5000000-0000-4000-8000-000000000099',
    'succeeded',
    NULL
  ),
  false,
  'a wrong claim token cannot finalize another attempt'
);

SELECT is(
  public.complete_plugin_data_deletion_request(
    (SELECT request_id FROM first_claim),
    (SELECT claim_token FROM first_claim),
    'retryable_failed',
    'hook_reported_failure'
  ),
  true,
  'a reported idempotent-hook failure becomes explicitly retryable'
);
SELECT is(
  (
    SELECT safe_error_code
    FROM private.plugin_data_deletion_requests
    WHERE id = (SELECT request_id FROM first_claim)
  ),
  'hook_reported_failure',
  'the receipt stores only a bounded safe error code'
);

CREATE TEMP TABLE retry_claim AS
SELECT *
FROM public.begin_plugin_data_deletion_request(
  'c1000000-0000-4000-8000-000000000001',
  'test-plugin',
  'c3000000-0000-4000-8000-000000000001',
  repeat('a', 64),
  'c2000000-0000-4000-8000-000000000001'
);

SELECT is(
  (SELECT decision FROM retry_claim),
  'execute',
  'the same logical request can resume only from retryable_failed'
);
SELECT is(
  (SELECT attempt_count FROM retry_claim),
  2,
  'the durable receipt increments its attempt count on a safe retry'
);
SELECT isnt(
  (SELECT claim_token FROM retry_claim),
  (SELECT claim_token FROM first_claim),
  'a retry receives a fresh claim token'
);

SELECT is(
  public.complete_plugin_data_deletion_request(
    (SELECT request_id FROM retry_claim),
    (SELECT claim_token FROM retry_claim),
    'succeeded',
    NULL
  ),
  true,
  'the retry can finalize the logical request as succeeded'
);
SELECT is(
  (
    SELECT decision
    FROM public.begin_plugin_data_deletion_request(
      'c1000000-0000-4000-8000-000000000001',
      'test-plugin',
      'c3000000-0000-4000-8000-000000000001',
      repeat('a', 64),
      'c2000000-0000-4000-8000-000000000001'
    )
  ),
  'succeeded',
  'a lost response replays durable success without running plugin code'
);
SELECT is(
  public.complete_plugin_data_deletion_request(
    (SELECT request_id FROM retry_claim),
    (SELECT claim_token FROM retry_claim),
    'retryable_failed',
    'hook_reported_failure'
  ),
  false,
  'a terminal success cannot be rewritten into a retryable state'
);

SELECT is(
  public.record_plugin_data_deletion_audit_result(
    (SELECT request_id FROM retry_claim),
    'failed',
    NULL,
    'audit_write_failed'
  ),
  true,
  'audit failure is attached after deletion success without changing that success'
);
SELECT results_eq(
  $$
    SELECT status, audit_status, audit_error_code
    FROM private.plugin_data_deletion_requests
    WHERE id = (SELECT request_id FROM retry_claim)
  $$,
  $$
    VALUES ('succeeded'::text, 'failed'::text, 'audit_write_failed'::text)
  $$,
  'a failed audit never erases or makes the successful deletion replayable'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM private.plugin_data_deletion_requests
    WHERE request_key = 'c3000000-0000-4000-8000-000000000001'
  ),
  1,
  'all retries share one durable receipt'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
