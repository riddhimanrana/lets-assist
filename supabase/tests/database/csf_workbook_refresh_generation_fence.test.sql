BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(62);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'ce000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'workbook-generation-officer@local.test',
  now(),
  '{}',
  '{}',
  now(),
  now()
), (
  'ce000000-0000-4000-8000-000000000002',
  'authenticated',
  'authenticated',
  'workbook-generation-checker@local.test',
  now(),
  '{}',
  '{}',
  now(),
  now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ce100000-0000-4000-8000-000000000001',
  'Workbook Generation Fence',
  'workbook-generation-fence',
  'school',
  '986305'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'ce100000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000001',
  'admin',
  'active'
), (
  'ce100000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000002',
  'admin',
  'active'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES (
  'ce200000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  2035,
  'Class of 2035'
);

INSERT INTO plugin_data.csf_class_workbooks (
  id, organization_id, cohort_id, drive_file_id, drive_owner_user_id,
  provider_version, provider_modified_at, discovered_tabs,
  source_candidates, last_checked_at, last_prepared_version, state
) VALUES (
  'ce300000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  'ce200000-0000-4000-8000-000000000001',
  'synthetic-generation-file',
  'ce000000-0000-4000-8000-000000000001',
  '701',
  '2026-09-02T00:00:00Z',
  '[{"tabName":"baseline"}]'::jsonb,
  '["synthetic-generation-file"]'::jsonb,
  now(),
  '700',
  'linked'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_claim_class_workbook_check(
    'ce100000-0000-4000-8000-000000000001',
    'ce200000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000001',
    NULL
  )$$,
  '22023',
  'Workbook check lease must be between 30 and 600 seconds.',
  'a null metadata-check duration is refused before claiming the workbook'
);
SELECT extensions.ok(
  (
    SELECT check_lease_token IS NULL AND check_lease_expires_at IS NULL
    FROM plugin_data.csf_class_workbooks
    WHERE id = 'ce300000-0000-4000-8000-000000000001'
  ),
  'a refused null metadata-check duration leaves workbook lease state unchanged'
);

INSERT INTO plugin_data.csf_class_workbook_refresh_jobs (
  id, organization_id, workbook_id, drive_file_id, provider_version, status
) VALUES (
  'ce400000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  'ce300000-0000-4000-8000-000000000001',
  'synthetic-generation-file',
  '700',
  'queued'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_claim_class_workbook_refresh_job(NULL)$$,
  '22023',
  'Workbook worker lease must be between 30 and 300 seconds.',
  'a null refresh lease duration is refused before claiming work'
);
SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_class_workbook_refresh_jobs
    WHERE id = 'ce400000-0000-4000-8000-000000000001'
  ),
  'queued',
  'a refused null refresh lease leaves the queued job unchanged'
);

SELECT extensions.is(
  plugin_data.csf_claim_class_workbook_refresh_job(120) ->> 'claimed',
  'false',
  'a queued refresh from an older provider version cannot be claimed'
);
SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_class_workbook_refresh_jobs
    WHERE id = 'ce400000-0000-4000-8000-000000000001'
  ),
  'blocked',
  'the stale queued generation becomes terminal'
);
SELECT extensions.is(
  (
    SELECT error_code
    FROM plugin_data.csf_class_workbook_refresh_jobs
    WHERE id = 'ce400000-0000-4000-8000-000000000001'
  ),
  'stale_workbook_generation',
  'the stale queued generation records the fixed operator reason'
);

INSERT INTO plugin_data.csf_class_workbook_refresh_jobs (
  id, organization_id, workbook_id, drive_file_id, provider_version, status
) VALUES (
  'ce400000-0000-4000-8000-000000000002',
  'ce100000-0000-4000-8000-000000000001',
  'ce300000-0000-4000-8000-000000000001',
  'synthetic-generation-file',
  '701',
  'queued'
);

CREATE TEMP TABLE workbook_generation_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

INSERT INTO workbook_generation_state
SELECT 'claim_701', plugin_data.csf_claim_class_workbook_refresh_job(120);

SELECT extensions.is(
  (SELECT value ->> 'claimed' FROM workbook_generation_state WHERE key = 'claim_701'),
  'true',
  'a worker can claim the current provider generation'
);
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_heartbeat_class_workbook_refresh_generation(
      'ce100000-0000-4000-8000-000000000001',
      'ce000000-0000-4000-8000-000000000001',
      'ce400000-0000-4000-8000-000000000002',
      %L::uuid,
      'ce300000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      'synthetic-generation-file',
      '701',
      NULL
    )$$,
    (SELECT value ->> 'leaseToken'
     FROM workbook_generation_state WHERE key = 'claim_701')
  ),
  '22023',
  'Workbook worker lease must be between 30 and 300 seconds.',
  'a null heartbeat duration is refused'
);
SELECT extensions.ok(
  (
    SELECT status = 'running'
      AND lease_token::text = (
        SELECT value ->> 'leaseToken'
        FROM workbook_generation_state WHERE key = 'claim_701'
      )
      AND attempt_count = 1
    FROM plugin_data.csf_class_workbook_refresh_jobs
    WHERE id = 'ce400000-0000-4000-8000-000000000002'
  ),
  'a refused null heartbeat leaves the active generation unchanged'
);
INSERT INTO workbook_generation_state
SELECT 'heartbeat_701',
  plugin_data.csf_heartbeat_class_workbook_refresh_generation(
    'ce100000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000001',
    'ce400000-0000-4000-8000-000000000002',
    ((SELECT value ->> 'leaseToken'
      FROM workbook_generation_state WHERE key = 'claim_701'))::uuid,
    'ce300000-0000-4000-8000-000000000001',
    'ce200000-0000-4000-8000-000000000001',
    'synthetic-generation-file',
    '701',
    300
  );
SELECT extensions.is(
  (SELECT value ->> 'valid'
   FROM workbook_generation_state WHERE key = 'heartbeat_701'),
  'true',
  'the exact worker can heartbeat its current generation'
);
SELECT extensions.ok(
  (
    SELECT lease_expires_at > now() + interval '250 seconds'
    FROM plugin_data.csf_class_workbook_refresh_jobs
    WHERE id = 'ce400000-0000-4000-8000-000000000002'
  ),
  'the heartbeat extends the active job lease'
);
SELECT extensions.is(
  (
    SELECT lease_token::text
    FROM plugin_data.csf_class_workbook_refresh_jobs
    WHERE id = 'ce400000-0000-4000-8000-000000000002'
  ),
  (SELECT value ->> 'leaseToken'
   FROM workbook_generation_state WHERE key = 'claim_701'),
  'the heartbeat preserves the generation lease token'
);
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_heartbeat_class_workbook_refresh_generation(
      'ce100000-0000-4000-8000-000000000001',
      'ce000000-0000-4000-8000-000000000002',
      'ce400000-0000-4000-8000-000000000002',
      %L::uuid,
      'ce300000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      'synthetic-generation-file',
      '701',
      120
    )$$,
    (SELECT value ->> 'leaseToken'
     FROM workbook_generation_state WHERE key = 'claim_701')
  ),
  '55000',
  'The workbook refresh generation is no longer current.',
  'another authorized officer cannot heartbeat the owner worker generation'
);

UPDATE plugin_data.csf_class_workbooks
SET provider_version = '702',
    provider_modified_at = '2026-09-02T00:01:00Z',
    updated_at = now()
WHERE id = 'ce300000-0000-4000-8000-000000000001';

INSERT INTO plugin_data.csf_class_workbook_refresh_jobs (
  id, organization_id, workbook_id, drive_file_id, provider_version, status
) VALUES (
  'ce400000-0000-4000-8000-000000000003',
  'ce100000-0000-4000-8000-000000000001',
  'ce300000-0000-4000-8000-000000000001',
  'synthetic-generation-file',
  '702',
  'queued'
);

SELECT extensions.is(
  plugin_data.csf_finish_class_workbook_refresh_job(
    'ce400000-0000-4000-8000-000000000002',
    ((SELECT value ->> 'leaseToken' FROM workbook_generation_state WHERE key = 'claim_701'))::uuid,
    'completed',
    '[{"tabName":"stale-result"}]'::jsonb,
    1,
    0,
    0,
    NULL
  ) ->> 'status',
  'blocked',
  'an in-flight worker cannot settle after a newer provider version arrives'
);
SELECT extensions.is(
  (
    SELECT error_code
    FROM plugin_data.csf_class_workbook_refresh_jobs
    WHERE id = 'ce400000-0000-4000-8000-000000000002'
  ),
  'stale_workbook_generation',
  'the stale in-flight generation records the fixed operator reason'
);
SELECT extensions.is(
  (
    SELECT last_prepared_version
    FROM plugin_data.csf_class_workbooks
    WHERE id = 'ce300000-0000-4000-8000-000000000001'
  ),
  '700',
  'stale settlement cannot move the prepared version backward'
);
SELECT extensions.is(
  (
    SELECT discovered_tabs
    FROM plugin_data.csf_class_workbooks
    WHERE id = 'ce300000-0000-4000-8000-000000000001'
  ),
  '[{"tabName":"baseline"}]'::jsonb,
  'stale settlement cannot overwrite the discovered tab snapshot'
);

INSERT INTO workbook_generation_state
SELECT 'claim_702', plugin_data.csf_claim_class_workbook_refresh_job(120);

SELECT extensions.is(
  (SELECT value ->> 'providerVersion' FROM workbook_generation_state WHERE key = 'claim_702'),
  '702',
  'the next claim advances to the current provider generation'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_finish_class_workbook_refresh_job(
    'ce400000-0000-4000-8000-000000000003',
    NULL,
    'completed',
    '[{"tabName":"invalid-null-token"}]'::jsonb,
    1,
    0,
    0,
    NULL
  )$$,
  'P0001',
  'The workbook worker lease is no longer active.',
  'a null token cannot finish a workbook generation'
);
SELECT extensions.ok(
  (
    SELECT status = 'running'
      AND lease_token::text = (
        SELECT value ->> 'leaseToken'
        FROM workbook_generation_state WHERE key = 'claim_702'
      )
    FROM plugin_data.csf_class_workbook_refresh_jobs
    WHERE id = 'ce400000-0000-4000-8000-000000000003'
  ),
  'a refused null finish token leaves the generation lease unchanged'
);
SELECT extensions.throws_ok(
  pg_catalog.format(
    $$SELECT plugin_data.csf_finish_class_workbook_refresh_job(
      'ce400000-0000-4000-8000-000000000003',
      %L::uuid,
      'completed',
      '[{"tabName":"invalid-null-count"}]'::jsonb,
      NULL,
      0,
      0,
      NULL
    )$$,
    (SELECT value ->> 'leaseToken'
     FROM workbook_generation_state WHERE key = 'claim_702')
  ),
  'P0001',
  'Workbook result counts cannot be negative.',
  'a null reconciliation count cannot settle a workbook generation'
);
SELECT extensions.is(
  plugin_data.csf_finish_class_workbook_refresh_job(
    'ce400000-0000-4000-8000-000000000003',
    ((SELECT value ->> 'leaseToken' FROM workbook_generation_state WHERE key = 'claim_702'))::uuid,
    'completed',
    '[{"tabName":"current-result"}]'::jsonb,
    1,
    0,
    0,
    NULL
  ) ->> 'status',
  'completed',
  'the current provider generation can settle'
);
SELECT extensions.is(
  (
    SELECT last_prepared_version
    FROM plugin_data.csf_class_workbooks
    WHERE id = 'ce300000-0000-4000-8000-000000000001'
  ),
  '702',
  'the current settlement records the exact prepared generation'
);
SELECT extensions.is(
  (
    SELECT discovered_tabs
    FROM plugin_data.csf_class_workbooks
    WHERE id = 'ce300000-0000-4000-8000-000000000001'
  ),
  '[{"tabName":"current-result"}]'::jsonb,
  'the current settlement stores its discovered tab snapshot'
);
SELECT extensions.is(
  plugin_data.csf_queue_class_workbook_preparation(
    'ce100000-0000-4000-8000-000000000001',
    'ce200000-0000-4000-8000-000000000001',
    'synthetic-generation-file',
    'ce000000-0000-4000-8000-000000000001',
    '702',
    '2026-09-02T00:01:00Z',
    '[]'::jsonb
  ) ->> 'status',
  'unchanged',
  'a metadata-only repeat recognizes the prepared provider generation'
);
SELECT extensions.is(
  (
    SELECT discovered_tabs
    FROM plugin_data.csf_class_workbooks
    WHERE id = 'ce300000-0000-4000-8000-000000000001'
  ),
  '[{"tabName":"current-result"}]'::jsonb,
  'a metadata-only repeat preserves the prepared generation tab snapshot'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_complete_class_workbook_check(
    'ce100000-0000-4000-8000-000000000001',
    'ce300000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000002',
    NULL,
    '702',
    '2026-09-02T00:01:00Z'
  )$$,
  'P0001',
  'The workbook check lease is no longer active.',
  'a null token cannot complete an unleased metadata check'
);

INSERT INTO workbook_generation_state
SELECT 'checker_claim', plugin_data.csf_claim_class_workbook_check(
  'ce100000-0000-4000-8000-000000000001',
  'ce200000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000002',
  300
);
SELECT extensions.is(
  (SELECT value ->> 'ownerUserId'
   FROM workbook_generation_state WHERE key = 'checker_claim'),
  'ce000000-0000-4000-8000-000000000001',
  'the metadata-check lease returns the stored Google owner, not the checker'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_fail_class_workbook_check(
    'ce100000-0000-4000-8000-000000000001',
    'ce300000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000002',
    NULL,
    'blocked',
    'synthetic_null_lease_failure'
  )$$,
  'P0001',
  'The workbook check lease is no longer active.',
  'a null token cannot settle a metadata-check failure'
);
SELECT extensions.is(
  (
    SELECT check_lease_token::text
    FROM plugin_data.csf_class_workbooks
    WHERE id = 'ce300000-0000-4000-8000-000000000001'
  ),
  (SELECT value ->> 'leaseToken'
   FROM workbook_generation_state WHERE key = 'checker_claim'),
  'a refused null failure token leaves the metadata lease unchanged'
);
SELECT extensions.is(
  plugin_data.csf_complete_class_workbook_check(
    'ce100000-0000-4000-8000-000000000001',
    'ce300000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000002',
    ((SELECT value ->> 'leaseToken'
      FROM workbook_generation_state WHERE key = 'checker_claim'))::uuid,
    '702',
    '2026-09-02T00:01:00Z'
  ) ->> 'status',
  'unchanged',
  'another officer can complete the metadata check'
);
SELECT extensions.is(
  (
    SELECT drive_owner_user_id::text
    FROM plugin_data.csf_class_workbooks
    WHERE id = 'ce300000-0000-4000-8000-000000000001'
  ),
  'ce000000-0000-4000-8000-000000000001',
  'a metadata checker cannot take ownership of the workbook OAuth connection'
);

INSERT INTO workbook_generation_state
SELECT 'expired_failure_claim', plugin_data.csf_claim_class_workbook_check(
  'ce100000-0000-4000-8000-000000000001',
  'ce200000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000002',
  30
);
UPDATE plugin_data.csf_class_workbooks
SET check_lease_expires_at = pg_catalog.now() - interval '1 second'
WHERE id = 'ce300000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok(
  pg_catalog.format(
    $$SELECT plugin_data.csf_fail_class_workbook_check(
      'ce100000-0000-4000-8000-000000000001',
      'ce300000-0000-4000-8000-000000000001',
      'ce000000-0000-4000-8000-000000000002',
      %L::uuid,
      'blocked',
      'synthetic_metadata_failure'
    )$$,
    (SELECT value ->> 'leaseToken'
     FROM workbook_generation_state WHERE key = 'expired_failure_claim')
  ),
  'P0001',
  'The workbook check lease is no longer active.',
  'an expired metadata failure cannot settle the workbook'
);
SELECT extensions.ok(
  (
    SELECT state = 'linked'
      AND last_error_code IS NULL
      AND check_lease_token = (
        SELECT (value ->> 'leaseToken')::uuid
        FROM workbook_generation_state WHERE key = 'expired_failure_claim'
      )
    FROM plugin_data.csf_class_workbooks
    WHERE id = 'ce300000-0000-4000-8000-000000000001'
  ),
  'a rejected stale failure leaves the workbook and expired lease unchanged'
);

SELECT extensions.is(
  plugin_data.csf_queue_class_workbook_preparation(
    'ce100000-0000-4000-8000-000000000001',
    'ce200000-0000-4000-8000-000000000001',
    'synthetic-generation-file',
    'ce000000-0000-4000-8000-000000000001',
    '799',
    '2026-09-02T00:02:00Z',
    '[]'::jsonb
  ) ->> 'status',
  'queued',
  'a new provider generation queues preparation'
);
SELECT extensions.is(
  (
    SELECT discovered_tabs
    FROM plugin_data.csf_class_workbooks
    WHERE id = 'ce300000-0000-4000-8000-000000000001'
  ),
  '[]'::jsonb,
  'a new provider generation resets the stale tab snapshot'
);
SELECT extensions.is(
  (
    SELECT last_prepared_version
    FROM plugin_data.csf_class_workbooks
    WHERE id = 'ce300000-0000-4000-8000-000000000001'
  ),
  NULL,
  'a new provider generation clears the prepared version'
);
DELETE FROM plugin_data.csf_class_workbook_refresh_jobs
WHERE workbook_id = 'ce300000-0000-4000-8000-000000000001'
  AND provider_version = '799';
UPDATE plugin_data.csf_class_workbooks
SET provider_version = '702',
    provider_modified_at = '2026-09-02T00:01:00Z',
    discovered_tabs = '[{"tabName":"current-result"}]'::jsonb,
    last_prepared_version = '702'
WHERE id = 'ce300000-0000-4000-8000-000000000001';
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_finish_class_workbook_refresh_job(uuid,uuid,text,jsonb,integer,integer,integer,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_finish_class_workbook_refresh_job(uuid,uuid,text,jsonb,integer,integer,integer,text)',
    'EXECUTE'
  ),
  'only service role can settle workbook refresh work'
);

UPDATE plugin_data.csf_class_workbooks
SET provider_version = '703',
    drive_owner_user_id = 'ce000000-0000-4000-8000-000000000001',
    state = 'linked',
    last_error_code = NULL
WHERE id = 'ce300000-0000-4000-8000-000000000001';

INSERT INTO plugin_data.csf_class_workbook_refresh_jobs (
  id, organization_id, workbook_id, drive_file_id, provider_version, status
) VALUES (
  'ce400000-0000-4000-8000-000000000004',
  'ce100000-0000-4000-8000-000000000001',
  'ce300000-0000-4000-8000-000000000001',
  'synthetic-generation-file',
  '703',
  'queued'
);

INSERT INTO workbook_generation_state
SELECT 'claim_703', plugin_data.csf_claim_class_workbook_refresh_job(120);

UPDATE plugin_data.csf_class_workbooks
SET drive_owner_user_id = NULL
WHERE id = 'ce300000-0000-4000-8000-000000000001';

SELECT extensions.is(
  plugin_data.csf_finish_class_workbook_refresh_job(
    'ce400000-0000-4000-8000-000000000004',
    ((SELECT value ->> 'leaseToken' FROM workbook_generation_state WHERE key = 'claim_703'))::uuid,
    'completed',
    '[]'::jsonb,
    0,
    0,
    0,
    NULL
  ) ->> 'status',
  'blocked',
  'a refresh cannot settle after its workbook owner is removed'
);
SELECT extensions.is(
  (
    SELECT state
    FROM plugin_data.csf_class_workbooks
    WHERE id = 'ce300000-0000-4000-8000-000000000001'
  ),
  'blocked',
  'owner removal blocks the workbook instead of leaving a false linked state'
);
SELECT extensions.is(
  (
    SELECT last_error_code
    FROM plugin_data.csf_class_workbooks
    WHERE id = 'ce300000-0000-4000-8000-000000000001'
  ),
  'workbook_owner_missing',
  'owner removal records the fixed workbook repair reason'
);

UPDATE plugin_data.csf_class_workbooks
SET provider_version = '704',
    drive_owner_user_id = 'ce000000-0000-4000-8000-000000000001',
    state = 'linked',
    last_error_code = NULL
WHERE id = 'ce300000-0000-4000-8000-000000000001';
INSERT INTO plugin_data.csf_class_workbook_refresh_jobs (
  id, organization_id, workbook_id, drive_file_id, provider_version,
  requested_by, status, lease_token, lease_expires_at,
  claimed_owner_user_id, attempt_count, started_at
) VALUES (
  'ce400000-0000-4000-8000-000000000005',
  'ce100000-0000-4000-8000-000000000001',
  'ce300000-0000-4000-8000-000000000001',
  'synthetic-generation-file',
  '704',
  'ce000000-0000-4000-8000-000000000001',
  'running',
  'ce500000-0000-4000-8000-000000000005',
  now() - interval '1 second',
  'ce000000-0000-4000-8000-000000000001',
  5,
  now() - interval '10 minutes'
);
SELECT extensions.is(
  plugin_data.csf_claim_class_workbook_refresh_job(120) ->> 'errorCode',
  'refresh_attempts_exhausted',
  'an expired generation cannot be claimed after five attempts'
);
SELECT extensions.is(
  (
    SELECT status || ':' || error_code
    FROM plugin_data.csf_class_workbook_refresh_jobs
    WHERE id = 'ce400000-0000-4000-8000-000000000005'
  ),
  'blocked:refresh_attempts_exhausted',
  'the exhausted refresh job records a closed terminal reason'
);
SELECT extensions.is(
  (
    SELECT state || ':' || last_error_code
    FROM plugin_data.csf_class_workbooks
    WHERE id = 'ce300000-0000-4000-8000-000000000001'
  ),
  'blocked:refresh_attempts_exhausted',
  'the exhausted current generation leaves an officer-visible workbook task'
);
SELECT extensions.is(
  plugin_data.csf_queue_class_workbook_preparation(
    'ce100000-0000-4000-8000-000000000001',
    'ce200000-0000-4000-8000-000000000001',
    'synthetic-generation-file',
    'ce000000-0000-4000-8000-000000000001',
    '704',
    '2026-09-02T00:03:00Z',
    '[]'::jsonb
  ) ->> 'status',
  'queued',
  'an explicit officer relink can retry an exhausted unchanged Drive generation'
);
SELECT extensions.ok(
  (
    SELECT status = 'queued'
      AND attempt_count = 0
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
      AND claimed_owner_user_id IS NULL
    FROM plugin_data.csf_class_workbook_refresh_jobs
    WHERE id = 'ce400000-0000-4000-8000-000000000005'
  ),
  'the explicit retry clears terminal worker ownership and attempt state'
);

UPDATE plugin_data.csf_class_workbook_refresh_jobs
SET status = 'blocked',
    attempt_count = 5,
    result_counts = '{"prepared":1}'::jsonb,
    error_code = 'refresh_attempts_exhausted',
    finished_at = now()
WHERE id = 'ce400000-0000-4000-8000-000000000005';
INSERT INTO workbook_generation_state
SELECT 'retry_checker_claim', plugin_data.csf_claim_class_workbook_check(
  'ce100000-0000-4000-8000-000000000001',
  'ce200000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000002',
  300
);
SELECT extensions.is(
  plugin_data.csf_complete_class_workbook_check(
    'ce100000-0000-4000-8000-000000000001',
    'ce300000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000002',
    ((SELECT value ->> 'leaseToken'
      FROM workbook_generation_state WHERE key = 'retry_checker_claim'))::uuid,
    '704',
    '2026-09-02T00:03:00Z'
  ) ->> 'status',
  'queued',
  'a later metadata check can explicitly retry an exhausted generation'
);
SELECT extensions.ok(
  (
    SELECT status = 'queued'
      AND attempt_count = 0
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
      AND claimed_owner_user_id IS NULL
      AND started_at IS NULL
      AND result_counts = '{}'::jsonb
    FROM plugin_data.csf_class_workbook_refresh_jobs
    WHERE id = 'ce400000-0000-4000-8000-000000000005'
  ),
  'the metadata retry clears terminal ownership, attempts, and stale counts'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_heartbeat_class_workbook_refresh_generation(uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_heartbeat_class_workbook_refresh_generation(uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer)',
    'EXECUTE'
  ),
  'only service role can heartbeat workbook refresh work'
);

INSERT INTO workbook_generation_state
SELECT 'unlink_source', plugin_data.csf_register_sheet_source(
  'ce100000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000001',
  NULL,
  'class_history',
  pg_catalog.jsonb_build_object(
    'cohortId', 'ce200000-0000-4000-8000-000000000001',
    'title', 'Synthetic class history',
    'provider', 'google_sheets',
    'spreadsheetId', 'synthetic-generation-file',
    'driveFileId', 'synthetic-generation-file',
    'syncMode', 'manual',
    'syncStatus', 'healthy',
    'lastSyncStatus', 'source_saved',
    'targetStrategy', 'fixed',
    'duplicatePolicy', 'match_email_then_name',
    'columnMappings', '{}'::jsonb,
    'tabMappings', '[]'::jsonb,
    'settings', pg_catalog.jsonb_build_object(
      'sourceKind', 'class_history',
      'mappingVersion', 1
    )
  )
);
UPDATE plugin_data.csf_class_workbooks
SET check_lease_token = 'ce500000-0000-4000-8000-000000000006',
    check_lease_expires_at = now() + interval '5 minutes'
WHERE id = 'ce300000-0000-4000-8000-000000000001';
INSERT INTO workbook_generation_state
SELECT 'unlink_worker_claim', plugin_data.csf_claim_class_workbook_refresh_job(120);
SELECT extensions.is(
  (SELECT value ->> 'claimed' FROM workbook_generation_state
   WHERE key = 'unlink_worker_claim'),
  'true',
  'the unlink fixture starts with an active worker generation'
);
INSERT INTO workbook_generation_state
SELECT 'unlink_receipt', plugin_data.csf_unlink_class_workbook(
  'ce100000-0000-4000-8000-000000000001',
  'ce200000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000002'
);
SELECT extensions.is(
  (SELECT value ->> 'unlinked' FROM workbook_generation_state
   WHERE key = 'unlink_receipt'),
  'true',
  'the atomic unlink returns a closed success receipt'
);
SELECT extensions.is(
  (SELECT (value ->> 'disabledSourceCount') || ':'
       || (value ->> 'cancelledRefreshJobCount')
   FROM workbook_generation_state WHERE key = 'unlink_receipt'),
  '1:1',
  'the unlink receipt counts the disabled source and revoked worker generation'
);
SELECT extensions.ok(
  (
    SELECT state = 'unlinked'
      AND check_lease_token IS NULL
      AND check_lease_expires_at IS NULL
    FROM plugin_data.csf_class_workbooks
    WHERE id = 'ce300000-0000-4000-8000-000000000001'
  ),
  'unlink marks the workbook unlinked and revokes its metadata lease'
);
SELECT extensions.ok(
  (
    SELECT status = 'blocked'
      AND error_code = 'workbook_unlinked'
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
      AND claimed_owner_user_id IS NULL
    FROM plugin_data.csf_class_workbook_refresh_jobs
    WHERE id = 'ce400000-0000-4000-8000-000000000005'
  ),
  'unlink revokes the active refresh worker generation'
);
SELECT extensions.ok(
  (
    SELECT sync_mode = 'disabled'
      AND sync_status = 'disabled'
      AND last_sync_status = 'unlinked'
      AND last_sync_error IS NULL
    FROM plugin_data.csf_sheet_sources
    WHERE id = (
      SELECT (value ->> 'sourceId')::uuid
      FROM workbook_generation_state WHERE key = 'unlink_source'
    )
  ),
  'unlink disables every matching class history source in the same transaction'
);
SELECT extensions.throws_ok(
  pg_catalog.format(
    $$SELECT plugin_data.csf_assert_class_workbook_refresh_generation(
      'ce100000-0000-4000-8000-000000000001',
      'ce000000-0000-4000-8000-000000000001',
      'ce400000-0000-4000-8000-000000000005',
      %L::uuid,
      'ce300000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      'synthetic-generation-file',
      '704'
    )$$,
    (SELECT value ->> 'leaseToken' FROM workbook_generation_state
     WHERE key = 'unlink_worker_claim')
  ),
  '55000',
  'The workbook refresh generation is no longer current.',
  'an unlinked workbook cannot publish another source from the old worker lease'
);
SELECT extensions.throws_ok(
  pg_catalog.format(
    $$SELECT plugin_data.csf_finish_class_workbook_refresh_job(
      'ce400000-0000-4000-8000-000000000005',
      %L::uuid,
      'completed',
      '[]'::jsonb,
      0,
      0,
      0,
      NULL
    )$$,
    (SELECT value ->> 'leaseToken' FROM workbook_generation_state
     WHERE key = 'unlink_worker_claim')
  ),
  'P0001',
  'The workbook worker lease is no longer active.',
  'the revoked worker cannot relink the workbook during settlement'
);
SELECT extensions.is(
  (
    SELECT pg_catalog.count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND action = 'sheets.class_workbook_unlinked'
      AND actor_user_id = 'ce000000-0000-4000-8000-000000000002'
      AND source_id = 'ce200000-0000-4000-8000-000000000001'
      AND after_data ->> 'disabledSourceCount' = '1'
      AND after_data ->> 'cancelledRefreshJobCount' = '1'
  ),
  1,
  'unlink writes one coordinate-only officer audit event'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_unlink_class_workbook(uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_unlink_class_workbook(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'only service role can unlink a class workbook'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES (
  'ce200000-0000-4000-8000-000000000002',
  'ce100000-0000-4000-8000-000000000001',
  2036,
  'Class of 2036'
);
INSERT INTO plugin_data.csf_class_workbooks (
  id, organization_id, cohort_id, drive_file_id, drive_owner_user_id,
  provider_version, source_candidates, state, last_error_code
) VALUES (
  'ce300000-0000-4000-8000-000000000002',
  'ce100000-0000-4000-8000-000000000001',
  'ce200000-0000-4000-8000-000000000002',
  'synthetic-reprepare-file',
  'ce000000-0000-4000-8000-000000000001',
  '800',
  '["synthetic-reprepare-file"]'::jsonb,
  'blocked',
  'workbook_generation_reprepare_required'
);
INSERT INTO workbook_generation_state
SELECT 'reprepare_claim', plugin_data.csf_claim_class_workbook_check(
  'ce100000-0000-4000-8000-000000000001',
  'ce200000-0000-4000-8000-000000000002',
  'ce000000-0000-4000-8000-000000000001',
  300
);
SELECT extensions.is(
  (SELECT value ->> 'status'
   FROM workbook_generation_state WHERE key = 'reprepare_claim'),
  'leased',
  'the generation reprepare state can claim a fresh metadata-check lease'
);
SELECT extensions.ok(
  (
    SELECT check_lease_token IS NOT NULL
      AND check_lease_expires_at > now()
      AND state = 'blocked'
      AND last_error_code = 'workbook_generation_reprepare_required'
    FROM plugin_data.csf_class_workbooks
    WHERE id = 'ce300000-0000-4000-8000-000000000002'
  ),
  'the recovery claim keeps the workbook blocked until metadata completion'
);

SELECT * FROM extensions.finish();

ROLLBACK;
