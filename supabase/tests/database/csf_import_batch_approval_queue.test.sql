BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(80);

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

SELECT extensions.matches(
  pg_catalog.pg_get_functiondef(
    'plugin_data.csf_commit_import_row_batch(uuid,uuid,uuid,uuid[])'::regprocedure
  ),
  'pg_advisory_xact_lock',
  'row batch receipts serialize the organization and request coordinate'
);

SELECT extensions.ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'plugin_data.csf_commit_import_row_batch_unserialized(uuid,uuid,uuid,uuid[])'::regprocedure
    ),
    'WHEN OTHERS'
  ) = 0,
  'the row batch implementation does not terminalize unknown database failures'
);
SELECT extensions.matches(
  pg_catalog.pg_get_functiondef(
    'plugin_data.csf_commit_import_row_batch_unserialized(uuid,uuid,uuid,uuid[])'::regprocedure
  ),
  'WHEN SQLSTATE ''23505'' OR SQLSTATE ''23514''',
  'only row-local constraint refusals become failed row outcomes'
);
SELECT extensions.ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'plugin_data.csf_commit_import_row_batch_unserialized(uuid,uuid,uuid,uuid[])'::regprocedure
    ),
    'row_commit_refused'
  ) = 0,
  'retryable and unknown failures have no terminal catch-all receipt code'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_commit_import_row_batch_unserialized(uuid,uuid,uuid,uuid[])',
    'EXECUTE'
  ),
  'the unserialized row batch implementation remains owner-internal'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM regexp_matches(
      pg_catalog.pg_get_functiondef(
        'plugin_data.csf_claim_import_commit_queue(integer)'::regprocedure
      ),
      'csf_block_import_commit_queue',
      'g'
    )
  ),
  3,
  'all claim-time refusal paths settle their frozen approval item'
);

SELECT extensions.ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'plugin_data.csf_claim_import_commit_queue(integer)'::regprocedure
    ),
    'WHEN OTHERS'
  ) = 0,
  'the queue claim does not terminalize unknown authorization failures'
);
SELECT extensions.matches(
  pg_catalog.pg_get_functiondef(
    'plugin_data.csf_claim_import_commit_queue(integer)'::regprocedure
  ),
  'EXCEPTION WHEN SQLSTATE ''42501''',
  'only a proven authorization refusal blocks the queue item'
);

SELECT extensions.matches(
  pg_catalog.pg_get_functiondef(
    'plugin_data.csf_queue_import_preview_batch(uuid,uuid,uuid[],uuid)'::regprocedure
  ),
  'pg_advisory_xact_lock',
  'batch receipt creation serializes the organization and request coordinate'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_queue_import_preview_batch_unserialized(uuid,uuid,uuid[],uuid)',
    'EXECUTE'
  ),
  'the unserialized batch implementation remains owner-internal'
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

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_claim_import_commit_queue(NULL)$$,
  '22023',
  'Import worker lease must be between 30 and 1200 seconds.',
  'a null import lease duration is refused before claiming work'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_import_commit_queue LIMIT 1),
  'queued',
  'a refused null import lease leaves the queue item unchanged'
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
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_finish_import_commit_queue(
      %L::uuid, NULL, 'completed', '{"completed":1}'::jsonb, NULL
    )$$,
    (SELECT value ->> 'queueId' FROM batch_state WHERE key = 'claim')
  ),
  'P0001',
  'The import worker lease is no longer active.',
  'a null token cannot finish an import queue item'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_import_commit_queue LIMIT 1),
  'running',
  'a refused null finish token leaves the import lease active'
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
  '22023',
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

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, initiated_by, mode, status, source_type
) VALUES (
  'cd200000-0000-4000-8000-000000000004',
  'cd100000-0000-4000-8000-000000000001',
  'cd000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'student_roster'
);
INSERT INTO plugin_data.csf_import_approval_batches (
  id, organization_id, actor_user_id, request_id, status,
  requested_count, queued_count
) VALUES (
  'cd600000-0000-4000-8000-000000000001',
  'cd100000-0000-4000-8000-000000000001',
  NULL,
  'cd600000-0000-4000-8000-000000000002',
  'queued', 1, 1
);
INSERT INTO plugin_data.csf_import_commit_queue (
  id, organization_id, preview_job_id, actor_user_id, status
) VALUES (
  'cd600000-0000-4000-8000-000000000003',
  'cd100000-0000-4000-8000-000000000001',
  'cd200000-0000-4000-8000-000000000004',
  NULL,
  'queued'
);
INSERT INTO plugin_data.csf_import_approval_batch_items (
  organization_id, batch_id, preview_job_id, queue_id, state
) VALUES (
  'cd100000-0000-4000-8000-000000000001',
  'cd600000-0000-4000-8000-000000000001',
  'cd200000-0000-4000-8000-000000000004',
  'cd600000-0000-4000-8000-000000000003',
  'queued'
);

SELECT extensions.is(
  plugin_data.csf_claim_import_commit_queue(300) ->> 'claimed',
  'false',
  'a queue item whose approving actor disappeared is refused'
);
SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_import_commit_queue
    WHERE id = 'cd600000-0000-4000-8000-000000000003'
  ),
  'blocked',
  'claim-time refusal terminalizes the queue item'
);
SELECT extensions.is(
  (
    SELECT state
    FROM plugin_data.csf_import_approval_batch_items
    WHERE queue_id = 'cd600000-0000-4000-8000-000000000003'
  ),
  'blocked',
  'claim-time refusal terminalizes the frozen approval item'
);
SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_import_approval_batches
    WHERE id = 'cd600000-0000-4000-8000-000000000001'
  ),
  'partially_completed',
  'claim-time refusal settles the parent approval batch'
);
SELECT extensions.is(
  (
    SELECT blocked_count
    FROM plugin_data.csf_import_approval_batches
    WHERE id = 'cd600000-0000-4000-8000-000000000001'
  ),
  1,
  'the settled parent records its blocked item count'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = 'cd600000-0000-4000-8000-000000000001'
      AND action = 'sheets.import_batch_settled'
  ),
  1,
  'claim-time refusal writes one settlement audit event'
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, initiated_by, mode, status, source_type, preview_job_id
) VALUES
  (
    'cd200000-0000-4000-8000-000000000005',
    'cd100000-0000-4000-8000-000000000001',
    'cd000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'student_roster', NULL
  ),
  (
    'cd200000-0000-4000-8000-000000000006',
    'cd100000-0000-4000-8000-000000000001',
    'cd000000-0000-4000-8000-000000000001',
    'commit', 'completed', 'student_roster',
    'cd200000-0000-4000-8000-000000000005'
  );
INSERT INTO plugin_data.csf_import_approval_batches (
  id, organization_id, actor_user_id, request_id, status,
  requested_count, queued_count
) VALUES (
  'cd600000-0000-4000-8000-000000000004',
  'cd100000-0000-4000-8000-000000000001',
  'cd000000-0000-4000-8000-000000000001',
  'cd600000-0000-4000-8000-000000000005',
  'queued', 1, 1
);
INSERT INTO plugin_data.csf_import_commit_queue (
  id, organization_id, preview_job_id, actor_user_id, status
) VALUES (
  'cd600000-0000-4000-8000-000000000006',
  'cd100000-0000-4000-8000-000000000001',
  'cd200000-0000-4000-8000-000000000005',
  'cd000000-0000-4000-8000-000000000001',
  'queued'
);
INSERT INTO plugin_data.csf_import_approval_batch_items (
  organization_id, batch_id, preview_job_id, queue_id, state
) VALUES (
  'cd100000-0000-4000-8000-000000000001',
  'cd600000-0000-4000-8000-000000000004',
  'cd200000-0000-4000-8000-000000000005',
  'cd600000-0000-4000-8000-000000000006',
  'queued'
);
UPDATE public.organization_members
SET status = 'inactive'
WHERE organization_id = 'cd100000-0000-4000-8000-000000000001'
  AND user_id = 'cd000000-0000-4000-8000-000000000001';

SELECT extensions.is(
  plugin_data.csf_claim_import_commit_queue(300) ->> 'reconciled',
  'true',
  'a lost queue-settlement response reconciles from the completed logical commit'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_import_commit_queue
   WHERE id = 'cd600000-0000-4000-8000-000000000006'),
  'completed',
  'completed durable work closes the queue even after the approving actor is revoked'
);
SELECT extensions.is(
  (SELECT state FROM plugin_data.csf_import_approval_batch_items
   WHERE queue_id = 'cd600000-0000-4000-8000-000000000006'),
  'completed',
  'lost-response reconciliation completes the frozen approval item'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_import_approval_batches
   WHERE id = 'cd600000-0000-4000-8000-000000000004'),
  'completed',
  'lost-response reconciliation completes the parent approval batch'
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, initiated_by, mode, status, source_type, preview_job_id
) VALUES
  (
    'cd200000-0000-4000-8000-000000000007',
    'cd100000-0000-4000-8000-000000000001',
    'cd000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'student_roster', NULL
  ),
  (
    'cd200000-0000-4000-8000-000000000008',
    'cd100000-0000-4000-8000-000000000001',
    'cd000000-0000-4000-8000-000000000001',
    'commit', 'partially_completed', 'student_roster',
    'cd200000-0000-4000-8000-000000000007'
  );
INSERT INTO plugin_data.csf_import_approval_batches (
  id, organization_id, actor_user_id, request_id, status,
  requested_count, queued_count
) VALUES (
  'cd600000-0000-4000-8000-000000000007',
  'cd100000-0000-4000-8000-000000000001',
  'cd000000-0000-4000-8000-000000000001',
  'cd600000-0000-4000-8000-000000000008',
  'queued', 1, 1
);
INSERT INTO plugin_data.csf_import_commit_queue (
  id, organization_id, preview_job_id, actor_user_id, status,
  lease_token, lease_expires_at, attempt_count, started_at
) VALUES (
  'cd600000-0000-4000-8000-000000000009',
  'cd100000-0000-4000-8000-000000000001',
  'cd200000-0000-4000-8000-000000000007',
  'cd000000-0000-4000-8000-000000000001',
  'running',
  'cd600000-0000-4000-8000-000000000010',
  now() - interval '1 second',
  1,
  now() - interval '10 minutes'
);
INSERT INTO plugin_data.csf_import_approval_batch_items (
  organization_id, batch_id, preview_job_id, queue_id, state
) VALUES (
  'cd100000-0000-4000-8000-000000000001',
  'cd600000-0000-4000-8000-000000000007',
  'cd200000-0000-4000-8000-000000000007',
  'cd600000-0000-4000-8000-000000000009',
  'queued'
);

INSERT INTO batch_state
SELECT 'partial_reconciliation', plugin_data.csf_claim_import_commit_queue(300);
SELECT extensions.is(
  (SELECT value ->> 'reconciled' FROM batch_state
   WHERE key = 'partial_reconciliation'),
  'true',
  'a lost queue response also reconciles a partially completed logical commit'
);
SELECT extensions.is(
  (SELECT value ->> 'status' FROM batch_state
   WHERE key = 'partial_reconciliation'),
  'blocked',
  'partial logical work receives a blocked queue settlement'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_import_commit_queue
   WHERE id = 'cd600000-0000-4000-8000-000000000009'),
  'blocked',
  'partial lost-response reconciliation never reports the queue completed'
);
SELECT extensions.is(
  (SELECT state FROM plugin_data.csf_import_approval_batch_items
   WHERE queue_id = 'cd600000-0000-4000-8000-000000000009'),
  'blocked',
  'partial lost-response reconciliation leaves the frozen item for review'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_import_approval_batches
   WHERE id = 'cd600000-0000-4000-8000-000000000007'),
  'partially_completed',
  'partial lost-response reconciliation settles the parent as partial'
);

UPDATE public.organization_members
SET status = 'active'
WHERE organization_id = 'cd100000-0000-4000-8000-000000000001'
  AND user_id = 'cd000000-0000-4000-8000-000000000001';
INSERT INTO batch_state
SELECT 'partial_followup_approval', plugin_data.csf_queue_import_preview_batch(
  'cd100000-0000-4000-8000-000000000001',
  'cd000000-0000-4000-8000-000000000001',
  ARRAY['cd200000-0000-4000-8000-000000000007']::uuid[],
  'cd600000-0000-4000-8000-000000000011'
);
INSERT INTO batch_state
SELECT 'partial_followup_claim', plugin_data.csf_claim_import_commit_queue(300);
SELECT extensions.is(
  (SELECT value ->> 'claimed' FROM batch_state
   WHERE key = 'partial_followup_claim'),
  'true',
  'an officer-requeued partial commit can claim its remaining resolved rows'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_import_commit_queue
   WHERE id = 'cd600000-0000-4000-8000-000000000009'),
  'running',
  'the follow-up partial queue keeps its new worker lease'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_finish_import_commit_queue(
    'cd600000-0000-4000-8000-000000000009',
    ((SELECT value ->> 'leaseToken' FROM batch_state
      WHERE key = 'partial_followup_claim'))::uuid,
    'completed',
    '{"completed":1,"followup":true}'::jsonb,
    NULL
  )$$,
  'the follow-up worker can settle the requeued preview'
);
SELECT extensions.is(
  (SELECT state FROM plugin_data.csf_import_approval_batch_items
   WHERE batch_id = 'cd600000-0000-4000-8000-000000000007'
     AND queue_id = 'cd600000-0000-4000-8000-000000000009'),
  'blocked',
  'follow-up settlement does not rewrite the earlier blocked item'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_import_approval_batches
   WHERE id = 'cd600000-0000-4000-8000-000000000007'),
  'partially_completed',
  'follow-up settlement does not rewrite the earlier partial receipt'
);
SELECT extensions.is(
  (SELECT state FROM plugin_data.csf_import_approval_batch_items
   WHERE batch_id = (
     SELECT (value ->> 'batchId')::uuid FROM batch_state
     WHERE key = 'partial_followup_approval'
   )),
  'completed',
  'follow-up settlement completes only the new approval item'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_import_approval_batches
   WHERE id = (
     SELECT (value ->> 'batchId')::uuid FROM batch_state
     WHERE key = 'partial_followup_approval'
   )),
  'completed',
  'follow-up settlement completes only the new approval receipt'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'cd000000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'second-batch-officer@local.test', now(),
  '{}', '{}', now(), now()
);
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'cd100000-0000-4000-8000-000000000001',
  'cd000000-0000-4000-8000-000000000002',
  'admin', 'active'
);
INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, initiated_by, mode, status, source_type, preview_job_id
) VALUES
  (
    'cd200000-0000-4000-8000-000000000009',
    'cd100000-0000-4000-8000-000000000001',
    'cd000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'student_roster', NULL
  ),
  (
    'cd200000-0000-4000-8000-000000000010',
    'cd100000-0000-4000-8000-000000000001',
    'cd000000-0000-4000-8000-000000000001',
    'commit', 'partially_completed', 'student_roster',
    'cd200000-0000-4000-8000-000000000009'
  );
INSERT INTO plugin_data.csf_import_commit_queue (
  id, organization_id, preview_job_id, actor_user_id, status,
  lease_token, lease_expires_at, attempt_count, result_counts,
  error_code, started_at
) VALUES (
  'cd600000-0000-4000-8000-000000000012',
  'cd100000-0000-4000-8000-000000000001',
  'cd200000-0000-4000-8000-000000000009',
  'cd000000-0000-4000-8000-000000000001',
  'running',
  'cd600000-0000-4000-8000-000000000013',
  now() - interval '1 second',
  4,
  '{"oldAttempt":1}'::jsonb,
  'retryable_worker_failure',
  now() - interval '10 minutes'
);

INSERT INTO batch_state
SELECT 'expired_partial_reapproval', plugin_data.csf_queue_import_preview_batch(
  'cd100000-0000-4000-8000-000000000001',
  'cd000000-0000-4000-8000-000000000002',
  ARRAY['cd200000-0000-4000-8000-000000000009']::uuid[],
  'cd600000-0000-4000-8000-000000000014'
);
SELECT extensions.is(
  (SELECT (value ->> 'queued')::integer FROM batch_state
   WHERE key = 'expired_partial_reapproval'),
  1,
  'reapproval queues a partial commit whose prior worker lease expired'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_import_commit_queue
   WHERE id = 'cd600000-0000-4000-8000-000000000012'),
  'queued',
  'reapproval replaces the expired running state with queued work'
);
SELECT extensions.is(
  (SELECT actor_user_id FROM plugin_data.csf_import_commit_queue
   WHERE id = 'cd600000-0000-4000-8000-000000000012'),
  'cd000000-0000-4000-8000-000000000002'::uuid,
  'reapproval binds the queue to the new approving officer'
);
SELECT extensions.ok(
  (SELECT lease_token IS NULL AND lease_expires_at IS NULL
   FROM plugin_data.csf_import_commit_queue
   WHERE id = 'cd600000-0000-4000-8000-000000000012'),
  'reapproval clears the expired worker lease'
);
SELECT extensions.ok(
  (SELECT attempt_count = 0
      AND result_counts = '{}'::jsonb
      AND error_code IS NULL
      AND started_at IS NULL
   FROM plugin_data.csf_import_commit_queue
   WHERE id = 'cd600000-0000-4000-8000-000000000012'),
  'reapproval clears the prior retry state'
);
INSERT INTO batch_state
SELECT 'expired_partial_reapproval_claim',
       plugin_data.csf_claim_import_commit_queue(300);
SELECT extensions.is(
  (SELECT value ->> 'claimed' FROM batch_state
   WHERE key = 'expired_partial_reapproval_claim'),
  'true',
  'the new approval is claimed instead of mistaken for a lost settlement'
);
SELECT extensions.is(
  (SELECT value ->> 'queueId' FROM batch_state
   WHERE key = 'expired_partial_reapproval_claim'),
  'cd600000-0000-4000-8000-000000000012',
  'the follow-up claim returns the reapproved queue item'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_finish_import_commit_queue(
    'cd600000-0000-4000-8000-000000000012',
    ((SELECT value ->> 'leaseToken' FROM batch_state
      WHERE key = 'expired_partial_reapproval_claim'))::uuid,
    'completed',
    '{"completed":1,"reapproved":true}'::jsonb,
    NULL
  )$$,
  'the worker can settle the reapproved queue item'
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, initiated_by, mode, status, source_type
) VALUES
  (
    'cd200000-0000-4000-8000-000000000011',
    'cd100000-0000-4000-8000-000000000001',
    'cd000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'student_roster'
  ),
  (
    'cd200000-0000-4000-8000-000000000012',
    'cd100000-0000-4000-8000-000000000001',
    'cd000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'student_roster'
  );
INSERT INTO plugin_data.csf_import_commit_queue (
  id, organization_id, preview_job_id, actor_user_id, status,
  lease_token, lease_expires_at, attempt_count, created_at
) VALUES
  (
    'cd600000-0000-4000-8000-000000000015',
    'cd100000-0000-4000-8000-000000000001',
    'cd200000-0000-4000-8000-000000000011',
    'cd000000-0000-4000-8000-000000000001',
    'running',
    'cd600000-0000-4000-8000-000000000016',
    now() - interval '1 second',
    4,
    now() - interval '1 hour'
  ),
  (
    'cd600000-0000-4000-8000-000000000017',
    'cd100000-0000-4000-8000-000000000001',
    'cd200000-0000-4000-8000-000000000012',
    'cd000000-0000-4000-8000-000000000001',
    'queued',
    NULL,
    NULL,
    0,
    now()
  );

INSERT INTO batch_state
SELECT 'retry_fairness_claim', plugin_data.csf_claim_import_commit_queue(300);
SELECT extensions.is(
  (SELECT value ->> 'queueId' FROM batch_state
   WHERE key = 'retry_fairness_claim'),
  'cd600000-0000-4000-8000-000000000015',
  'an expired retry runs before fresh work so approvals cannot starve it'
);
SELECT extensions.is(
  (SELECT attempt_count::text FROM plugin_data.csf_import_commit_queue
   WHERE id = 'cd600000-0000-4000-8000-000000000015'),
  '5',
  'claiming the retry advances its bounded attempt counter'
);
INSERT INTO batch_state
SELECT 'fresh_during_retry_backoff', plugin_data.csf_claim_import_commit_queue(300);
SELECT extensions.is(
  (SELECT value ->> 'queueId' FROM batch_state
   WHERE key = 'fresh_during_retry_backoff'),
  'cd600000-0000-4000-8000-000000000017',
  'fresh work proceeds while the failed retry is inside its renewed lease backoff'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_finish_import_commit_queue(
    'cd600000-0000-4000-8000-000000000017',
    ((SELECT value ->> 'leaseToken' FROM batch_state
      WHERE key = 'fresh_during_retry_backoff'))::uuid,
    'completed',
    '{"completed":1}'::jsonb,
    NULL
  )$$,
  'the fresh queue item settles during retry backoff'
);
UPDATE plugin_data.csf_import_commit_queue
SET lease_expires_at = now() - interval '1 second'
WHERE id = 'cd600000-0000-4000-8000-000000000015';
INSERT INTO batch_state
SELECT 'retry_exhaustion', plugin_data.csf_claim_import_commit_queue(300);
SELECT extensions.is(
  (SELECT value ->> 'retryExhausted' FROM batch_state
   WHERE key = 'retry_exhaustion'),
  'true',
  'five expired worker leases require officer review'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_import_commit_queue
   WHERE id = 'cd600000-0000-4000-8000-000000000015'),
  'blocked',
  'the exhausted retry leaves the worker queue'
);
SELECT extensions.is(
  (SELECT error_code FROM plugin_data.csf_import_commit_queue
   WHERE id = 'cd600000-0000-4000-8000-000000000015'),
  'import_retry_attempts_exhausted',
  'the exhausted retry records a closed review reason'
);

SELECT * FROM extensions.finish();
ROLLBACK;
