BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(29);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'cd000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'batch-officer@local.test', now(),
  '{}', '{}', now(), now()
);
INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'cd100000-0000-4000-8000-000000000001',
  'Import Batch Queue', 'import-batch-queue', 'school', '976401'
);
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'cd100000-0000-4000-8000-000000000001',
  'cd000000-0000-4000-8000-000000000001',
  'admin', 'active'
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, initiated_by, mode, status, source_type
) VALUES
  (
    'cd200000-0000-4000-8000-000000000001',
    'cd100000-0000-4000-8000-000000000001',
    'cd000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'student_roster'
  ),
  (
    'cd200000-0000-4000-8000-000000000002',
    'cd100000-0000-4000-8000-000000000001',
    'cd000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'student_roster'
  ),
  (
    'cd200000-0000-4000-8000-000000000003',
    'cd100000-0000-4000-8000-000000000001',
    'cd000000-0000-4000-8000-000000000001',
    'preview', 'failed', 'student_roster'
  );
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, sheet_tab_name, row_number, import_status
) VALUES (
  'cd300000-0000-4000-8000-000000000001',
  'cd100000-0000-4000-8000-000000000001',
  'cd200000-0000-4000-8000-000000000002',
  'Synthetic', 2, 'ambiguous'
);

SELECT extensions.ok(
  to_regclass('plugin_data.csf_import_approval_batches') IS NOT NULL,
  'the batch approval receipt table exists'
);
SELECT extensions.ok(
  to_regclass('plugin_data.csf_import_commit_queue') IS NOT NULL,
  'the durable commit queue exists'
);
SELECT extensions.ok(
  to_regclass('plugin_data.csf_import_row_batches') IS NOT NULL,
  'the idempotent 50-row batch receipt table exists'
);
SELECT extensions.ok(
  to_regprocedure(
    'plugin_data.csf_commit_import_row_batch(uuid,uuid,uuid,uuid[])'
  ) IS NOT NULL,
  'the bounded row batch RPC exists'
);

CREATE TEMP TABLE batch_state (key text PRIMARY KEY, value jsonb NOT NULL);
INSERT INTO batch_state
SELECT 'receipt', plugin_data.csf_queue_import_preview_batch(
  'cd100000-0000-4000-8000-000000000001',
  'cd000000-0000-4000-8000-000000000001',
  ARRAY[
    'cd200000-0000-4000-8000-000000000001',
    'cd200000-0000-4000-8000-000000000002',
    'cd200000-0000-4000-8000-000000000003'
  ]::uuid[],
  'cd400000-0000-4000-8000-000000000001'
);

SELECT extensions.is(
  (SELECT (value ->> 'queued')::integer FROM batch_state WHERE key = 'receipt'),
  1,
  'one ready preview is queued'
);
SELECT extensions.is(
  (SELECT (value ->> 'blocked')::integer FROM batch_state WHERE key = 'receipt'),
  1,
  'one unresolved preview remains blocked'
);
SELECT extensions.is(
  (SELECT (value ->> 'stale')::integer FROM batch_state WHERE key = 'receipt'),
  1,
  'one failed preview is reported stale'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_import_commit_queue),
  1,
  'only ready work enters the commit queue'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_queue_import_preview_batch(
    'cd100000-0000-4000-8000-000000000001',
    'cd000000-0000-4000-8000-000000000001',
    ARRAY[
      'cd200000-0000-4000-8000-000000000001',
      'cd200000-0000-4000-8000-000000000001'
    ]::uuid[],
    'cd400000-0000-4000-8000-000000000002'
  )$$,
  'P0001',
  'Each import preview may appear only once.',
  'duplicate preview IDs are refused before a receipt is created'
);

SELECT extensions.is(
  plugin_data.csf_queue_import_preview_batch(
    'cd100000-0000-4000-8000-000000000001',
    'cd000000-0000-4000-8000-000000000001',
    ARRAY[
      'cd200000-0000-4000-8000-000000000001',
      'cd200000-0000-4000-8000-000000000002',
      'cd200000-0000-4000-8000-000000000003'
    ]::uuid[],
    'cd400000-0000-4000-8000-000000000001'
  ) ->> 'replayed',
  'true',
  'reusing a request ID reads the durable batch receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_import_approval_batches),
  1,
  'batch receipt replay creates no duplicate batch'
);

INSERT INTO batch_state
SELECT 'claim', plugin_data.csf_claim_import_commit_queue(300);
SELECT extensions.is(
  (SELECT value ->> 'claimed' FROM batch_state WHERE key = 'claim'),
  'true',
  'one worker claims the queued preview'
);
SELECT extensions.is(
  plugin_data.csf_claim_import_commit_queue(300) ->> 'claimed',
  'false',
  'a concurrent worker cannot claim the running preview'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_finish_import_commit_queue(
    ((SELECT value ->> 'queueId' FROM batch_state WHERE key = 'claim'))::uuid,
    ((SELECT value ->> 'leaseToken' FROM batch_state WHERE key = 'claim'))::uuid,
    'completed',
    '{"completed":1}'::jsonb,
    NULL
  )$$,
  'the leased worker can settle its queue receipt'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_import_commit_queue LIMIT 1),
  'completed',
  'successful settlement closes the commit queue item'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_import_approval_batches LIMIT 1),
  'partially_completed',
  'blocked and stale siblings keep the batch partially completed'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_finish_import_commit_queue(
    ((SELECT value ->> 'queueId' FROM batch_state WHERE key = 'claim'))::uuid,
    ((SELECT value ->> 'leaseToken' FROM batch_state WHERE key = 'claim'))::uuid,
    'completed', '{}'::jsonb, NULL
  )$$,
  'P0001',
  'The import worker lease is no longer active.',
  'a settled queue receipt cannot be replayed'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_claim_import_commit_queue(900)$$,
  'the worker can claim with a lease longer than the route execution budget'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_claim_import_commit_queue(1201)$$,
  'P0001',
  'Import worker lease must be between 30 and 1200 seconds.',
  'the claim RPC still rejects excessive lease durations'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_claim_import_commit_queue(integer)',
    'EXECUTE'
  ),
  'service_role can claim import work'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_claim_import_commit_queue(integer)',
    'EXECUTE'
  ),
  'authenticated callers cannot claim import work'
);
SELECT extensions.ok(
  NOT has_table_privilege(
    'authenticated', 'plugin_data.csf_import_commit_queue', 'SELECT'
  ),
  'the commit queue is not browser-readable'
);
SELECT extensions.ok(
  NOT has_table_privilege(
    'authenticated', 'plugin_data.csf_import_approval_batches', 'SELECT'
  ),
  'approval receipts are not browser-readable'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_commit_import_row_batch(
    'cd100000-0000-4000-8000-000000000001',
    'cd500000-0000-4000-8000-000000000001',
    'cd500000-0000-4000-8000-000000000002',
    ARRAY(SELECT md5(value::text)::uuid FROM generate_series(1, 51) AS value)
  )$$,
  'P0001',
  'A row batch must contain between one and 50 rows.',
  'the row batch RPC refuses more than 50 rows'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_commit_import_row_batch(
    'cd100000-0000-4000-8000-000000000001',
    'cd500000-0000-4000-8000-000000000001',
    'cd500000-0000-4000-8000-000000000003',
    ARRAY[
      'cd500000-0000-4000-8000-000000000004',
      'cd500000-0000-4000-8000-000000000004'
    ]::uuid[]
  )$$,
  'P0001',
  'Each import row may appear only once per batch.',
  'the row batch RPC refuses duplicate row IDs'
);
SELECT extensions.is(
  plugin_data.csf_import_row_batch_receipt(
    'cd100000-0000-4000-8000-000000000001',
    'cd500000-0000-4000-8000-000000000005'
  ),
  NULL::jsonb,
  'a missing request ID has no fabricated row batch receipt'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_commit_import_row_batch(uuid,uuid,uuid,uuid[])',
    'EXECUTE'
  ),
  'service_role can commit a bounded row batch'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_commit_import_row_batch(uuid,uuid,uuid,uuid[])',
    'EXECUTE'
  ),
  'authenticated callers cannot commit row batches'
);
SELECT extensions.ok(
  NOT has_table_privilege(
    'authenticated', 'plugin_data.csf_import_row_batches', 'SELECT'
  ),
  'row batch receipts are not browser-readable'
);

SELECT * FROM extensions.finish();
ROLLBACK;
