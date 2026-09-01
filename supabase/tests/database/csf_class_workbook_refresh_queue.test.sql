BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(27);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'cb000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'workbook-officer@local.test',
  now(),
  '{}',
  '{}',
  now(),
  now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'cb100000-0000-4000-8000-000000000001',
    'Workbook Queue One',
    'workbook-queue-one',
    'school',
    '976301'
  ),
  (
    'cb100000-0000-4000-8000-000000000002',
    'Workbook Queue Two',
    'workbook-queue-two',
    'school',
    '976302'
  );

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  (
    'cb100000-0000-4000-8000-000000000001',
    'cb000000-0000-4000-8000-000000000001',
    'admin',
    'active'
  ),
  (
    'cb100000-0000-4000-8000-000000000002',
    'cb000000-0000-4000-8000-000000000001',
    'admin',
    'active'
  );

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES (
  'cb200000-0000-4000-8000-000000000001',
  'cb100000-0000-4000-8000-000000000001',
  2033,
  'Class of 2033'
);

SELECT extensions.ok(
  to_regclass('plugin_data.csf_class_workbooks') IS NOT NULL,
  'the class workbook registry exists'
);
SELECT extensions.ok(
  to_regclass('plugin_data.csf_class_workbook_refresh_jobs') IS NOT NULL,
  'the durable workbook refresh queue exists'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_register_class_workbook(
    'cb100000-0000-4000-8000-000000000001',
    'cb200000-0000-4000-8000-000000000001',
    'synthetic-drive-file-one',
    'cb000000-0000-4000-8000-000000000001',
    '101',
    '2026-08-30T00:00:00Z',
    '[{"tabName":"Fall 2032"}]'::jsonb
  )$$,
  'an authorized officer can register one workbook for a class'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_class_workbooks
    WHERE organization_id = 'cb100000-0000-4000-8000-000000000001'
      AND cohort_id = 'cb200000-0000-4000-8000-000000000001'
  ),
  1,
  'the registry stores one workbook per organization and class'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_register_class_workbook(
    'cb100000-0000-4000-8000-000000000002',
    'cb200000-0000-4000-8000-000000000001',
    'cross-tenant-drive-file',
    'cb000000-0000-4000-8000-000000000001',
    '101',
    '2026-08-30T00:00:00Z',
    '[]'::jsonb
  )$$,
  '42501',
  'This class does not belong to the organization.',
  'a workbook cannot be registered against another tenant class'
);

CREATE TEMP TABLE workbook_test_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

INSERT INTO workbook_test_state
SELECT 'first_claim', plugin_data.csf_claim_class_workbook_check(
  'cb100000-0000-4000-8000-000000000001',
  'cb200000-0000-4000-8000-000000000001',
  'cb000000-0000-4000-8000-000000000001',
  300
);

SELECT extensions.is(
  (SELECT value ->> 'status' FROM workbook_test_state WHERE key = 'first_claim'),
  'leased',
  'the first metadata check claims a five-minute lease'
);
SELECT extensions.is(
  plugin_data.csf_claim_class_workbook_check(
    'cb100000-0000-4000-8000-000000000001',
    'cb200000-0000-4000-8000-000000000001',
    'cb000000-0000-4000-8000-000000000001',
    300
  ) ->> 'status',
  'unchanged',
  'a concurrent metadata check does not claim the active lease'
);

SELECT extensions.is(
  plugin_data.csf_complete_class_workbook_check(
    'cb100000-0000-4000-8000-000000000001',
    ((SELECT value ->> 'workbookId' FROM workbook_test_state WHERE key = 'first_claim'))::uuid,
    'cb000000-0000-4000-8000-000000000001',
    ((SELECT value ->> 'leaseToken' FROM workbook_test_state WHERE key = 'first_claim'))::uuid,
    '101',
    '2026-08-30T00:00:00Z'
  ) ->> 'status',
  'unchanged',
  'an unchanged provider version schedules no refresh work'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_class_workbook_refresh_jobs),
  0,
  'an unchanged provider version leaves the queue empty'
);

INSERT INTO workbook_test_state
SELECT 'changed_claim', plugin_data.csf_claim_class_workbook_check(
  'cb100000-0000-4000-8000-000000000001',
  'cb200000-0000-4000-8000-000000000001',
  'cb000000-0000-4000-8000-000000000001',
  300
);
INSERT INTO workbook_test_state
SELECT 'changed_result', plugin_data.csf_complete_class_workbook_check(
  'cb100000-0000-4000-8000-000000000001',
  ((SELECT value ->> 'workbookId' FROM workbook_test_state WHERE key = 'changed_claim'))::uuid,
  'cb000000-0000-4000-8000-000000000001',
  ((SELECT value ->> 'leaseToken' FROM workbook_test_state WHERE key = 'changed_claim'))::uuid,
  '102',
  '2026-08-30T00:01:00Z'
);

SELECT extensions.is(
  (SELECT value ->> 'status' FROM workbook_test_state WHERE key = 'changed_result'),
  'queued',
  'a changed provider version queues one refresh job'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_class_workbook_refresh_jobs),
  1,
  'the changed version has one durable queue record'
);

INSERT INTO workbook_test_state
SELECT 'duplicate_claim', plugin_data.csf_claim_class_workbook_check(
  'cb100000-0000-4000-8000-000000000001',
  'cb200000-0000-4000-8000-000000000001',
  'cb000000-0000-4000-8000-000000000001',
  300
);
SELECT plugin_data.csf_complete_class_workbook_check(
  'cb100000-0000-4000-8000-000000000001',
  ((SELECT value ->> 'workbookId' FROM workbook_test_state WHERE key = 'duplicate_claim'))::uuid,
  'cb000000-0000-4000-8000-000000000001',
  ((SELECT value ->> 'leaseToken' FROM workbook_test_state WHERE key = 'duplicate_claim'))::uuid,
  '102',
  '2026-08-30T00:01:00Z'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_class_workbook_refresh_jobs),
  1,
  'a repeated check for the same version does not duplicate the job'
);

INSERT INTO workbook_test_state
SELECT 'worker_claim', plugin_data.csf_claim_class_workbook_refresh_job(120);
SELECT extensions.is(
  (SELECT value ->> 'claimed' FROM workbook_test_state WHERE key = 'worker_claim'),
  'true',
  'the worker claims queued refresh work'
);
SELECT extensions.is(
  plugin_data.csf_claim_class_workbook_refresh_job(120) ->> 'claimed',
  'false',
  'a second worker cannot claim the running job'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_finish_class_workbook_refresh_job(
    ((SELECT value ->> 'jobId' FROM workbook_test_state WHERE key = 'worker_claim'))::uuid,
    ((SELECT value ->> 'leaseToken' FROM workbook_test_state WHERE key = 'worker_claim'))::uuid,
    'completed',
    '[{"tabName":"Fall 2032"},{"tabName":"Spring 2033"}]'::jsonb,
    1,
    1,
    0,
    NULL
  )$$,
  'a leased worker can settle the refresh job'
);
SELECT extensions.is(
  (
    SELECT last_prepared_version
    FROM plugin_data.csf_class_workbooks
    WHERE cohort_id = 'cb200000-0000-4000-8000-000000000001'
  ),
  '102',
  'successful settlement records the exact prepared provider version'
);
SELECT extensions.is(
  (
    SELECT jsonb_array_length(discovered_tabs)
    FROM plugin_data.csf_class_workbooks
    WHERE cohort_id = 'cb200000-0000-4000-8000-000000000001'
  ),
  2,
  'successful settlement stores the discovered tab snapshot'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_finish_class_workbook_refresh_job(
    ((SELECT value ->> 'jobId' FROM workbook_test_state WHERE key = 'worker_claim'))::uuid,
    ((SELECT value ->> 'leaseToken' FROM workbook_test_state WHERE key = 'worker_claim'))::uuid,
    'completed',
    '[]'::jsonb,
    0,
    0,
    0,
    NULL
  )$$,
  'P0001',
  'The workbook worker lease is no longer active.',
  'a settled worker receipt cannot be replayed'
);

UPDATE plugin_data.csf_class_workbooks
SET drive_owner_user_id = NULL,
    provider_version = '103',
    state = 'linked',
    last_error_code = NULL
WHERE cohort_id = 'cb200000-0000-4000-8000-000000000001';
INSERT INTO plugin_data.csf_class_workbook_refresh_jobs (
  organization_id, workbook_id, drive_file_id, provider_version, status
)
SELECT organization_id, id, drive_file_id, '103', 'queued'
FROM plugin_data.csf_class_workbooks
WHERE cohort_id = 'cb200000-0000-4000-8000-000000000001';

SELECT extensions.is(
  plugin_data.csf_claim_class_workbook_refresh_job(120) ->> 'claimed',
  'false',
  'a refresh job whose Drive owner disappeared is refused'
);
SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_class_workbook_refresh_jobs
    WHERE provider_version = '103'
  ),
  'blocked',
  'the missing-owner refresh job becomes terminal'
);
SELECT extensions.is(
  (
    SELECT state
    FROM plugin_data.csf_class_workbooks
    WHERE cohort_id = 'cb200000-0000-4000-8000-000000000001'
  ),
  'blocked',
  'the workbook no longer appears healthy after its owner disappears'
);
SELECT extensions.is(
  (
    SELECT last_error_code
    FROM plugin_data.csf_class_workbooks
    WHERE cohort_id = 'cb200000-0000-4000-8000-000000000001'
  ),
  'workbook_owner_missing',
  'the workbook stores the owner-missing operator reason'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(proc.proacl, pg_catalog.acldefault('f', proc.proowner))
    ) AS privilege
    LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = privilege.grantee
    WHERE namespace.nspname = 'plugin_data'
      AND proc.proname LIKE 'csf_%class_workbook%'
      AND privilege.privilege_type = 'EXECUTE'
      AND privilege.grantee <> proc.proowner
      AND coalesce(role.rolname, 'PUBLIC') <> 'service_role'
  ),
  0,
  'workbook RPCs grant no non-owner role except service_role'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_claim_class_workbook_refresh_job(integer)',
    'EXECUTE'
  ),
  'service_role can claim refresh work'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_claim_class_workbook_refresh_job(integer)',
    'EXECUTE'
  ),
  'authenticated callers cannot claim refresh work'
);
SELECT extensions.ok(
  NOT has_table_privilege(
    'authenticated',
    'plugin_data.csf_class_workbooks',
    'SELECT'
  ),
  'the workbook registry is not browser-readable'
);
SELECT extensions.ok(
  NOT has_table_privilege(
    'authenticated',
    'plugin_data.csf_class_workbook_refresh_jobs',
    'SELECT'
  ),
  'the refresh queue is not browser-readable'
);

SELECT * FROM extensions.finish();

ROLLBACK;
