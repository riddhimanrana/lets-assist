-- Source health belongs to the exact source state a commit claimed. A commit
-- may still settle its durable row and attempt receipts after the source moves,
-- but it must not mark the replacement source state healthy.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(4);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'da000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'source-settlement@local.test', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'da100000-0000-4000-8000-000000000001',
  'CSF Source Settlement', 'csf-source-settlement', 'school', '996211'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES (
  'da150000-0000-4000-8000-000000000001',
  'da100000-0000-4000-8000-000000000001',
  2028, 'Class of 2028'
);

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, cohort_id, provider,
  spreadsheet_id, drive_file_id, drive_access_state, drive_trashed,
  sync_mode, sync_status, last_sync_status, last_sync_error,
  last_committed_at, last_synced_at, settings
) VALUES
  (
    'da200000-0000-4000-8000-000000000001',
    'da100000-0000-4000-8000-000000000001',
    'student_roster', 'Current generic source',
    'da150000-0000-4000-8000-000000000001', 'google_sheets',
    'generic-current', 'generic-current', 'accessible', false,
    'manual', 'needs_attention', 'fixture_pending', 'fixture_error',
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
    '{"sourceKind":"student_roster","mappingVersion":1}'::jsonb
  ),
  (
    'da200000-0000-4000-8000-000000000002',
    'da100000-0000-4000-8000-000000000001',
    'class_history', 'Workbook generation A',
    'da150000-0000-4000-8000-000000000001', 'google_sheets',
    'workbook-file-a', 'workbook-file-a', 'accessible', false,
    'manual', 'needs_attention', 'fixture_pending', 'fixture_error',
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
    jsonb_build_object(
      'sourceKind', 'class_history',
      'mappingVersion', 1,
      'workbookId', 'da180000-0000-4000-8000-000000000001',
      'workbookRefreshJobId', 'da190000-0000-4000-8000-000000000001',
      'workbookProviderVersion', '1',
      'workbookDriveFileId', 'workbook-file-a'
    )
  ),
  (
    'da200000-0000-4000-8000-000000000003',
    'da100000-0000-4000-8000-000000000001',
    'student_roster', 'Generic source disabled after claim',
    'da150000-0000-4000-8000-000000000001', 'google_sheets',
    'generic-disabled', 'generic-disabled', 'accessible', false,
    'manual', 'needs_attention', 'fixture_pending', 'fixture_error',
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
    '{"sourceKind":"student_roster","mappingVersion":1}'::jsonb
  ),
  (
    'da200000-0000-4000-8000-000000000004',
    'da100000-0000-4000-8000-000000000001',
    'student_roster', 'Generic source remapped after claim',
    'da150000-0000-4000-8000-000000000001', 'google_sheets',
    'generic-remapped', 'generic-remapped', 'accessible', false,
    'manual', 'needs_attention', 'fixture_pending', 'fixture_error',
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
    '{"sourceKind":"student_roster","mappingVersion":1}'::jsonb
  );

INSERT INTO plugin_data.csf_class_workbooks (
  id, organization_id, cohort_id, drive_file_id, drive_owner_user_id,
  provider_version, last_prepared_version, state
) VALUES (
  'da180000-0000-4000-8000-000000000001',
  'da100000-0000-4000-8000-000000000001',
  'da150000-0000-4000-8000-000000000001',
  'workbook-file-a', 'da000000-0000-4000-8000-000000000001',
  '1', '1', 'linked'
);

INSERT INTO plugin_data.csf_class_workbook_refresh_jobs (
  id, organization_id, workbook_id, drive_file_id, provider_version,
  requested_by, claimed_owner_user_id, status, attempt_count,
  started_at, finished_at
) VALUES (
  'da190000-0000-4000-8000-000000000001',
  'da100000-0000-4000-8000-000000000001',
  'da180000-0000-4000-8000-000000000001',
  'workbook-file-a', '1',
  'da000000-0000-4000-8000-000000000001',
  'da000000-0000-4000-8000-000000000001',
  'completed', 1, now(), now()
);

-- These are privileged synthetic fixtures, not a supported preview-open path.
-- The test disables the generation publication guard only while inserting the
-- already-published snapshots, then restores it before exercising settlement.
ALTER TABLE plugin_data.csf_sheet_import_jobs
  DISABLE TRIGGER csf_sheet_import_jobs_workbook_open_guard;

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, mapping_snapshot, mapping_version, snapshot_row_count,
  snapshot_contract_version, source_content_hash, snapshot_hash
) VALUES
  (
    'da300000-0000-4000-8000-000000000001',
    'da100000-0000-4000-8000-000000000001',
    'da200000-0000-4000-8000-000000000001',
    'da000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'student_roster', 'generic-current',
    '{"version":1,"sourceType":"student_roster"}'::jsonb,
    1, 0, 'csf-normalized-import/v1', repeat('1', 64), repeat('2', 64)
  ),
  (
    'da300000-0000-4000-8000-000000000002',
    'da100000-0000-4000-8000-000000000001',
    'da200000-0000-4000-8000-000000000002',
    'da000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'class_history', 'workbook-file-a',
    jsonb_build_object(
      'version', 1,
      'sourceType', 'class_history',
      'workbookId', 'da180000-0000-4000-8000-000000000001',
      'workbookRefreshJobId', 'da190000-0000-4000-8000-000000000001',
      'workbookProviderVersion', '1',
      'workbookDriveFileId', 'workbook-file-a'
    ),
    1, 0, 'csf-normalized-import/v1', repeat('3', 64), repeat('4', 64)
  ),
  (
    'da300000-0000-4000-8000-000000000003',
    'da100000-0000-4000-8000-000000000001',
    'da200000-0000-4000-8000-000000000003',
    'da000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'student_roster', 'generic-disabled',
    '{"version":1,"sourceType":"student_roster"}'::jsonb,
    1, 0, 'csf-normalized-import/v1', repeat('5', 64), repeat('6', 64)
  ),
  (
    'da300000-0000-4000-8000-000000000004',
    'da100000-0000-4000-8000-000000000001',
    'da200000-0000-4000-8000-000000000004',
    'da000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'student_roster', 'generic-remapped',
    '{"version":1,"sourceType":"student_roster"}'::jsonb,
    1, 0, 'csf-normalized-import/v1', repeat('7', 64), repeat('8', 64)
  );

ALTER TABLE plugin_data.csf_sheet_import_jobs
  ENABLE TRIGGER csf_sheet_import_jobs_workbook_open_guard;

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  preview_job_id, commit_actor_user_id, commit_actor_snapshot, started_at
)
SELECT
  ('da310000-0000-4000-8000-' || right(preview.id::text, 12))::uuid,
  preview.organization_id,
  preview.source_id,
  preview.initiated_by,
  'commit', 'running', preview.source_type,
  preview.id,
  preview.initiated_by,
  '{}'::jsonb,
  now()
FROM plugin_data.csf_sheet_import_jobs AS preview
WHERE preview.id IN (
  'da300000-0000-4000-8000-000000000001',
  'da300000-0000-4000-8000-000000000002',
  'da300000-0000-4000-8000-000000000003',
  'da300000-0000-4000-8000-000000000004'
);

INSERT INTO plugin_data.csf_sheet_import_commit_attempts (
  id, organization_id, commit_job_id, attempt_number, correlation_id,
  actor_user_id, actor_snapshot, status, lease_expires_at
)
SELECT
  ('da400000-0000-4000-8000-' || right(commit_job.id::text, 12))::uuid,
  commit_job.organization_id,
  commit_job.id,
  1,
  ('da500000-0000-4000-8000-' || right(commit_job.id::text, 12))::uuid,
  commit_job.commit_actor_user_id,
  '{}'::jsonb,
  'running',
  now() + interval '5 minutes'
FROM plugin_data.csf_sheet_import_jobs AS commit_job
WHERE commit_job.id IN (
  'da310000-0000-4000-8000-000000000001',
  'da310000-0000-4000-8000-000000000002',
  'da310000-0000-4000-8000-000000000003',
  'da310000-0000-4000-8000-000000000004'
);

UPDATE plugin_data.csf_sheet_import_jobs AS commit_job
SET active_commit_attempt_id =
  ('da400000-0000-4000-8000-' || right(commit_job.id::text, 12))::uuid
WHERE commit_job.id IN (
  'da310000-0000-4000-8000-000000000001',
  'da310000-0000-4000-8000-000000000002',
  'da310000-0000-4000-8000-000000000003',
  'da310000-0000-4000-8000-000000000004'
);

-- Move each stale case only after its commit attempt has frozen the old state.
UPDATE plugin_data.csf_sheet_sources
SET sync_mode = 'disabled'
WHERE id = 'da200000-0000-4000-8000-000000000003';

UPDATE plugin_data.csf_sheet_sources
SET settings = jsonb_set(settings, '{mappingVersion}', '2'::jsonb)
WHERE id = 'da200000-0000-4000-8000-000000000004';

INSERT INTO plugin_data.csf_class_workbook_refresh_jobs (
  id, organization_id, workbook_id, drive_file_id, provider_version,
  requested_by, claimed_owner_user_id, status, attempt_count,
  started_at, finished_at
) VALUES (
  'da190000-0000-4000-8000-000000000002',
  'da100000-0000-4000-8000-000000000001',
  'da180000-0000-4000-8000-000000000001',
  'workbook-file-b', '2',
  'da000000-0000-4000-8000-000000000001',
  'da000000-0000-4000-8000-000000000001',
  'completed', 1, now(), now()
);

UPDATE plugin_data.csf_class_workbooks
SET drive_file_id = 'workbook-file-b',
    provider_version = '2',
    last_prepared_version = '2'
WHERE id = 'da180000-0000-4000-8000-000000000001';

UPDATE plugin_data.csf_sheet_sources
SET spreadsheet_id = 'workbook-file-b',
    drive_file_id = 'workbook-file-b',
    settings = jsonb_build_object(
      'sourceKind', 'class_history',
      'mappingVersion', 1,
      'workbookId', 'da180000-0000-4000-8000-000000000001',
      'workbookRefreshJobId', 'da190000-0000-4000-8000-000000000002',
      'workbookProviderVersion', '2',
      'workbookDriveFileId', 'workbook-file-b'
    )
WHERE id = 'da200000-0000-4000-8000-000000000002';

-- The relink transition owns its own source-health reset. Capture a distinct
-- post-relink B state so the assertion below isolates the old A worker's
-- finalize behavior.
UPDATE plugin_data.csf_sheet_sources
SET sync_status = 'needs_attention',
    last_sync_status = 'fixture_pending',
    last_sync_error = 'fixture_error',
    last_committed_at = '2026-01-01T00:00:00Z',
    last_synced_at = '2026-01-01T00:00:00Z'
WHERE id = 'da200000-0000-4000-8000-000000000002';

CREATE TEMP TABLE source_settlement_receipts (
  case_key text PRIMARY KEY,
  receipt jsonb NOT NULL
);

INSERT INTO source_settlement_receipts (case_key, receipt)
SELECT fixture.case_key,
  plugin_data.csf_finalize_import_commit_attempt(
    'da100000-0000-4000-8000-000000000001',
    fixture.attempt_id,
    '{}'::jsonb
  )
FROM (VALUES
  ('current', 'da400000-0000-4000-8000-000000000001'::uuid),
  ('workbook_relinked', 'da400000-0000-4000-8000-000000000002'::uuid),
  ('generic_disabled', 'da400000-0000-4000-8000-000000000003'::uuid),
  ('generic_remapped', 'da400000-0000-4000-8000-000000000004'::uuid)
) AS fixture(case_key, attempt_id);

SELECT extensions.ok(
  (
    SELECT receipt ->> 'status' = 'completed'
      AND receipt ->> 'sourceSettlement' = 'settled'
      AND (receipt ->> 'sourceGenerationCurrent')::boolean
      AND NOT (receipt ? 'sourceSettlementReasonCode')
    FROM source_settlement_receipts
    WHERE case_key = 'current'
  )
  AND (
    SELECT sync_status = 'healthy'
      AND last_sync_status = 'commit_completed'
      AND last_sync_error IS NULL
      AND last_committed_at > '2026-01-01T00:00:00Z'
      AND last_synced_at > '2026-01-01T00:00:00Z'
    FROM plugin_data.csf_sheet_sources
    WHERE id = 'da200000-0000-4000-8000-000000000001'
  ),
  'the current source generation settles the durable commit and source health together'
);

SELECT extensions.ok(
  (
    SELECT receipt ->> 'status' = 'completed'
      AND receipt ->> 'sourceSettlement' = 'stale_source_state'
      AND NOT (receipt ->> 'sourceGenerationCurrent')::boolean
      AND receipt ->> 'sourceSettlementReasonCode' =
        'source_changed_before_settlement'
    FROM source_settlement_receipts
    WHERE case_key = 'workbook_relinked'
  )
  AND (
    SELECT sync_status = 'needs_attention'
      AND last_sync_status = 'fixture_pending'
      AND last_sync_error = 'fixture_error'
      AND last_committed_at = '2026-01-01T00:00:00Z'
      AND last_synced_at = '2026-01-01T00:00:00Z'
      AND spreadsheet_id = 'workbook-file-b'
    FROM plugin_data.csf_sheet_sources
    WHERE id = 'da200000-0000-4000-8000-000000000002'
  ),
  'a workbook A commit settles durably without marking relinked workbook B healthy'
);

SELECT extensions.ok(
  (
    SELECT receipt ->> 'status' = 'completed'
      AND receipt ->> 'sourceSettlement' = 'stale_source_state'
      AND NOT (receipt ->> 'sourceGenerationCurrent')::boolean
      AND receipt ->> 'sourceSettlementReasonCode' =
        'source_changed_before_settlement'
    FROM source_settlement_receipts
    WHERE case_key = 'generic_disabled'
  )
  AND (
    SELECT sync_mode = 'disabled'
      AND sync_status = 'needs_attention'
      AND last_sync_status = 'fixture_pending'
      AND last_sync_error = 'fixture_error'
      AND last_committed_at = '2026-01-01T00:00:00Z'
      AND last_synced_at = '2026-01-01T00:00:00Z'
    FROM plugin_data.csf_sheet_sources
    WHERE id = 'da200000-0000-4000-8000-000000000003'
  ),
  'a disabled generic source keeps its health while its old commit receipt settles'
);

SELECT extensions.ok(
  (
    SELECT receipt ->> 'status' = 'completed'
      AND receipt ->> 'sourceSettlement' = 'stale_source_state'
      AND NOT (receipt ->> 'sourceGenerationCurrent')::boolean
      AND receipt ->> 'sourceSettlementReasonCode' =
        'source_changed_before_settlement'
    FROM source_settlement_receipts
    WHERE case_key = 'generic_remapped'
  )
  AND (
    SELECT settings ->> 'mappingVersion' = '2'
      AND sync_status = 'needs_attention'
      AND last_sync_status = 'fixture_pending'
      AND last_sync_error = 'fixture_error'
      AND last_committed_at = '2026-01-01T00:00:00Z'
      AND last_synced_at = '2026-01-01T00:00:00Z'
    FROM plugin_data.csf_sheet_sources
    WHERE id = 'da200000-0000-4000-8000-000000000004'
  ),
  'a generic mapping v1 commit cannot update health after the source moves to v2'
);

SELECT * FROM extensions.finish();

ROLLBACK;
