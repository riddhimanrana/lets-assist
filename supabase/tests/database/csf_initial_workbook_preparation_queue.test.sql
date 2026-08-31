BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(15);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'cc000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'initial-workbook-officer@local.test',
  now(),
  '{}',
  '{}',
  now(),
  now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'cc100000-0000-4000-8000-000000000001',
    'Initial Workbook Queue One',
    'initial-workbook-queue-one',
    'school',
    '986301'
  ),
  (
    'cc100000-0000-4000-8000-000000000002',
    'Initial Workbook Queue Two',
    'initial-workbook-queue-two',
    'school',
    '986302'
  );

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'cc100000-0000-4000-8000-000000000001',
  'cc000000-0000-4000-8000-000000000001',
  'admin',
  'active'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES (
  'cc200000-0000-4000-8000-000000000001',
  'cc100000-0000-4000-8000-000000000001',
  2034,
  'Class of 2034'
);

CREATE TEMP TABLE initial_workbook_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

INSERT INTO initial_workbook_state
SELECT 'queued', plugin_data.csf_queue_class_workbook_preparation(
  'cc100000-0000-4000-8000-000000000001',
  'cc200000-0000-4000-8000-000000000001',
  'synthetic-initial-workbook-one',
  'cc000000-0000-4000-8000-000000000001',
  '501',
  '2026-08-31T00:00:00Z',
  '["F33","S34"]'::jsonb
);

SELECT extensions.is(
  (SELECT value ->> 'status' FROM initial_workbook_state WHERE key = 'queued'),
  'queued',
  'initial linking returns a durable queued state'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_class_workbooks
    WHERE cohort_id = 'cc200000-0000-4000-8000-000000000001'
  ),
  1,
  'initial linking registers one workbook for the class'
);
SELECT extensions.is(
  (
    SELECT last_prepared_version
    FROM plugin_data.csf_class_workbooks
    WHERE cohort_id = 'cc200000-0000-4000-8000-000000000001'
  ),
  NULL,
  'initial linking does not claim the workbook was already prepared'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_class_workbook_refresh_jobs
    WHERE drive_file_id = 'synthetic-initial-workbook-one'
      AND provider_version = '501'
  ),
  1,
  'initial linking queues one exact file generation'
);
SELECT extensions.is(
  plugin_data.csf_queue_class_workbook_preparation(
    'cc100000-0000-4000-8000-000000000001',
    'cc200000-0000-4000-8000-000000000001',
    'synthetic-initial-workbook-one',
    'cc000000-0000-4000-8000-000000000001',
    '501',
    '2026-08-31T00:00:00Z',
    '["F33","S34"]'::jsonb
  ) ->> 'status',
  'queued',
  'repeating the same unprepared generation is retry-safe'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_class_workbook_refresh_jobs
    WHERE drive_file_id = 'synthetic-initial-workbook-one'
      AND provider_version = '501'
  ),
  1,
  'repeating initial linking does not duplicate the queue item'
);

INSERT INTO initial_workbook_state
SELECT 'first_claim', plugin_data.csf_claim_class_workbook_refresh_job(120);
SELECT extensions.is(
  (SELECT value ->> 'driveFileId' FROM initial_workbook_state WHERE key = 'first_claim'),
  'synthetic-initial-workbook-one',
  'the worker claim is bound to the queued file generation'
);

SELECT plugin_data.csf_queue_class_workbook_preparation(
  'cc100000-0000-4000-8000-000000000001',
  'cc200000-0000-4000-8000-000000000001',
  'synthetic-initial-workbook-two',
  'cc000000-0000-4000-8000-000000000001',
  '501',
  '2026-08-31T00:01:00Z',
  '["F33","S34"]'::jsonb
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_class_workbook_refresh_jobs
    WHERE provider_version = '501'
  ),
  2,
  'two different files may have the same provider version without colliding'
);
SELECT extensions.is(
  plugin_data.csf_finish_class_workbook_refresh_job(
    ((SELECT value ->> 'jobId' FROM initial_workbook_state WHERE key = 'first_claim'))::uuid,
    ((SELECT value ->> 'leaseToken' FROM initial_workbook_state WHERE key = 'first_claim'))::uuid,
    'completed',
    '["F33","S34"]'::jsonb,
    2,
    0,
    0,
    NULL
  ) ->> 'status',
  'blocked',
  'a stale worker cannot mark a replacement workbook prepared'
);
SELECT extensions.is(
  (
    SELECT last_prepared_version
    FROM plugin_data.csf_class_workbooks
    WHERE cohort_id = 'cc200000-0000-4000-8000-000000000001'
  ),
  NULL,
  'stale worker settlement leaves the replacement unprepared'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_queue_class_workbook_preparation(
    'cc100000-0000-4000-8000-000000000002',
    'cc200000-0000-4000-8000-000000000001',
    'cross-tenant-workbook',
    'cc000000-0000-4000-8000-000000000001',
    '601',
    '2026-08-31T00:02:00Z',
    '[]'::jsonb
  )$$,
  '42501',
  'This officer is not an active member of the organization whose CSF import they are acting on.',
  'a workbook cannot be queued through another tenant'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_queue_class_workbook_preparation(uuid,uuid,text,uuid,text,text,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_queue_class_workbook_preparation(uuid,uuid,text,uuid,text,text,jsonb)',
    'EXECUTE'
  ),
  'only service role can execute the initial preparation queue function'
);
SELECT extensions.has_index(
  'plugin_data',
  'csf_class_workbook_refresh_jobs',
  'csf_workbook_refresh_jobs_tenant_state_idx',
  'workbook refresh jobs have an organization-first operational index'
);
SELECT extensions.has_index(
  'plugin_data',
  'csf_import_approval_batch_items',
  'csf_import_approval_items_tenant_batch_idx',
  'approval batch items have an organization-first operational index'
);
SELECT extensions.has_index(
  'plugin_data',
  'csf_import_row_batch_outcomes',
  'csf_import_row_outcomes_tenant_batch_idx',
  'row batch outcomes have an organization-first operational index'
);

SELECT * FROM extensions.finish();

ROLLBACK;
