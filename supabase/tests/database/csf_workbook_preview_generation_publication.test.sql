BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(43);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'cf000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'workbook-publication-officer@local.test',
  now(),
  '{}',
  '{}',
  now(),
  now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'cf100000-0000-4000-8000-000000000001',
  'Workbook Publication Fence',
  'workbook-publication-fence',
  'school',
  '986306'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  'admin',
  'active'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES (
  'cf200000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  2036,
  'Class of 2036'
), (
  'cf200000-0000-4000-8000-000000000002',
  'cf100000-0000-4000-8000-000000000001',
  2037,
  'Class of 2037'
);

INSERT INTO plugin_data.csf_class_workbooks (
  id, organization_id, cohort_id, drive_file_id, drive_owner_user_id,
  provider_version, provider_modified_at, discovered_tabs,
  source_candidates, last_checked_at, last_prepared_version, state
) VALUES (
  'cf300000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001',
  'synthetic-publication-file',
  'cf000000-0000-4000-8000-000000000001',
  '801',
  '2026-09-02T00:00:00Z',
  '[{"tabName":"Fall 2026"}]'::jsonb,
  '["synthetic-publication-file"]'::jsonb,
  now(),
  '800',
  'linked'
), (
  'cf300000-0000-4000-8000-000000000002',
  'cf100000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000002',
  NULL,
  'cf000000-0000-4000-8000-000000000001',
  NULL,
  NULL,
  '[]'::jsonb,
  '["synthetic-conflict-a","synthetic-conflict-b"]'::jsonb,
  now(),
  NULL,
  'blocked'
);

INSERT INTO plugin_data.csf_class_workbook_refresh_jobs (
  id, organization_id, workbook_id, drive_file_id, provider_version,
  requested_by, status, lease_token, lease_expires_at,
  claimed_owner_user_id, attempt_count, started_at
) VALUES (
  'cf400000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'cf300000-0000-4000-8000-000000000001',
  'synthetic-publication-file',
  '801',
  'cf000000-0000-4000-8000-000000000001',
  'running',
  'cf500000-0000-4000-8000-000000000001',
  now() + interval '5 minutes',
  'cf000000-0000-4000-8000-000000000001',
  1,
  now()
);

SELECT extensions.is(
  plugin_data.csf_assert_class_workbook_refresh_generation(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001',
    'cf400000-0000-4000-8000-000000000001',
    'cf500000-0000-4000-8000-000000000001',
    'cf300000-0000-4000-8000-000000000001',
    'cf200000-0000-4000-8000-000000000001',
    'synthetic-publication-file',
    '801'
  ) ->> 'valid',
  'true',
  'the exact active refresh generation receives a closed valid receipt'
);

CREATE TEMP TABLE workbook_publication_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

INSERT INTO workbook_publication_state
SELECT source_key, plugin_data.csf_register_sheet_source(
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  NULL,
  'class_history',
  jsonb_build_object(
    'cohortId', 'cf200000-0000-4000-8000-000000000001',
    'title', source_title,
    'provider', 'google_sheets',
    'spreadsheetId', 'synthetic-prior-publication-file',
    'driveFileId', 'synthetic-prior-publication-file',
    'syncMode', 'manual',
    'syncStatus', 'healthy',
    'lastSyncStatus', 'source_saved',
    'targetStrategy', 'fixed',
    'duplicatePolicy', 'match_email_then_name',
    'columnMappings', '{}'::jsonb,
    'tabMappings', '[]'::jsonb,
    'settings', jsonb_build_object(
      'sourceKind', 'class_history',
      'mappingVersion', 1
    )
  )
)
FROM (
  VALUES
    ('prior_omitted_source', 'Prior workbook omitted term'),
    ('prior_duplicate_source', 'Prior workbook duplicate term')
) AS fixture(source_key, source_title);

INSERT INTO workbook_publication_state
SELECT 'other_class_source', plugin_data.csf_register_sheet_source(
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  NULL,
  'class_history',
  jsonb_build_object(
    'cohortId', 'cf200000-0000-4000-8000-000000000002',
    'title', 'Class of 2037 - Fall 2026',
    'provider', 'google_sheets',
    'spreadsheetId', 'synthetic-other-class-file',
    'driveFileId', 'synthetic-other-class-file',
    'syncMode', 'manual',
    'syncStatus', 'not_synced',
    'lastSyncStatus', 'source_saved',
    'targetStrategy', 'fixed',
    'duplicatePolicy', 'match_email_then_name',
    'columnMappings', '{}'::jsonb,
    'tabMappings', '[]'::jsonb,
    'settings', jsonb_build_object(
      'sourceKind', 'class_history',
      'mappingVersion', 1
    )
  )
);

INSERT INTO workbook_publication_state
SELECT 'legacy_unbound_source', plugin_data.csf_register_sheet_source(
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  NULL,
  'class_history',
  jsonb_build_object(
    'cohortId', 'cf200000-0000-4000-8000-000000000001',
    'title', 'Legacy Class of 2036 - Fall 2026',
    'provider', 'google_sheets',
    'spreadsheetId', 'synthetic-publication-file',
    'driveFileId', 'synthetic-publication-file',
    'syncMode', 'manual',
    'syncStatus', 'not_synced',
    'lastSyncStatus', 'source_saved',
    'targetStrategy', 'fixed',
    'duplicatePolicy', 'match_email_then_name',
    'columnMappings', '{}'::jsonb,
    'tabMappings', '[]'::jsonb,
    'settings', jsonb_build_object(
      'sourceKind', 'class_history',
      'mappingVersion', 1
    )
  )
);

INSERT INTO workbook_publication_state
SELECT 'conflicted_unbound_preview', plugin_data.csf_open_import_preview(
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  (SELECT (value ->> 'sourceId')::uuid
   FROM workbook_publication_state WHERE key = 'other_class_source'),
  'class_history',
  'synthetic-other-class-file',
  'Conflicted synthetic class workbook',
  'Fall 2026',
  '''Fall 2026''!A1:B1',
  now(),
  '{"providerVersion":"801"}'::jsonb,
  '{"mappingVersion":1}'::jsonb,
  1,
  NULL,
  NULL,
  repeat('c', 64),
  0,
  'csf-normalized-import/v1'
);
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_assert_import_preview_workbook_generation_current(
      'cf100000-0000-4000-8000-000000000001', %L::uuid
    )$$,
    (SELECT value ->> 'previewJobId'
     FROM workbook_publication_state WHERE key = 'conflicted_unbound_preview')
  ),
  '55000',
  'This class workbook must be prepared again before its imports can continue.',
  'a null-file multi-workbook conflict cannot pass as a generic import source'
);
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_seal_import_preview(
      'cf100000-0000-4000-8000-000000000001',
      'cf000000-0000-4000-8000-000000000001',
      %L::uuid,
      'completed',
      '{}'::jsonb
    )$$,
    (SELECT value ->> 'previewJobId'
     FROM workbook_publication_state WHERE key = 'conflicted_unbound_preview')
  ),
  '55000',
  'This class workbook must be prepared again before its imports can continue.',
  'a null-file multi-workbook conflict cannot publish an unbound preview'
);

INSERT INTO workbook_publication_state
SELECT 'legacy_unbound_preview', plugin_data.csf_open_import_preview(
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  (SELECT (value ->> 'sourceId')::uuid
   FROM workbook_publication_state WHERE key = 'legacy_unbound_source'),
  'class_history',
  'synthetic-publication-file',
  'Legacy synthetic class workbook',
  'Fall 2026',
  '''Fall 2026''!A1:B1',
  now(),
  '{"providerVersion":"801"}'::jsonb,
  '{"mappingVersion":1}'::jsonb,
  1,
  NULL,
  NULL,
  repeat('a', 64),
  0,
  'csf-normalized-import/v1'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_assert_import_preview_workbook_generation_current(
      'cf100000-0000-4000-8000-000000000001', %L::uuid
    )$$,
    (SELECT value ->> 'previewJobId'
     FROM workbook_publication_state WHERE key = 'legacy_unbound_preview')
  ),
  '55000',
  'This class workbook must be prepared again before its imports can continue.',
  'a legacy unbound class-workbook preview cannot pass the commit fence'
);
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_seal_import_preview(
      'cf100000-0000-4000-8000-000000000001',
      'cf000000-0000-4000-8000-000000000001',
      %L::uuid,
      'completed',
      '{}'::jsonb
    )$$,
    (SELECT value ->> 'previewJobId'
     FROM workbook_publication_state WHERE key = 'legacy_unbound_preview')
  ),
  '55000',
  'This class workbook must be prepared again before its imports can continue.',
  'a legacy unbound class-workbook preview cannot be published'
);

INSERT INTO workbook_publication_state
SELECT 'generic_application_source', plugin_data.csf_register_sheet_source(
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  NULL,
  'application_responses',
  '{
    "title":"Synthetic application responses",
    "provider":"google_sheets",
    "spreadsheetId":"synthetic-application-file",
    "driveFileId":"synthetic-application-file",
    "syncMode":"manual",
    "syncStatus":"healthy",
    "lastSyncStatus":"source_saved",
    "targetStrategy":"derive_from_grade",
    "duplicatePolicy":"match_email_then_name",
    "columnMappings":{},
    "tabMappings":[],
    "settings":{"sourceKind":"application_responses","mappingVersion":1}
  }'::jsonb
);
INSERT INTO workbook_publication_state
SELECT 'generic_application_preview', plugin_data.csf_open_import_preview(
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  (SELECT (value ->> 'sourceId')::uuid
   FROM workbook_publication_state WHERE key = 'generic_application_source'),
  'application_responses',
  'synthetic-application-file',
  'Synthetic application responses',
  'Fall 2026',
  '''Form Responses 1''!A1:B1',
  now(),
  '{"providerVersion":"801"}'::jsonb,
  '{"mappingVersion":1}'::jsonb,
  1,
  NULL,
  NULL,
  repeat('d', 64),
  0,
  'csf-normalized-import/v1'
);
INSERT INTO workbook_publication_state
SELECT 'disabled_application_source', plugin_data.csf_register_sheet_source(
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  (SELECT (value ->> 'sourceId')::uuid
   FROM workbook_publication_state WHERE key = 'generic_application_source'),
  'application_responses',
  '{
    "syncMode":"disabled",
    "syncStatus":"disabled",
    "lastSyncStatus":"unlinked",
    "settings":{"sourceKind":"application_responses","mappingVersion":1}
  }'::jsonb
);
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_assert_import_preview_workbook_generation_current(
      'cf100000-0000-4000-8000-000000000001', %L::uuid
    )$$,
    (SELECT value ->> 'previewJobId'
     FROM workbook_publication_state WHERE key = 'generic_application_preview')
  ),
  '55000',
  'This import source is no longer active.',
  'disabling a generic Google source invalidates its existing preview'
);

INSERT INTO workbook_publication_state
SELECT 'source', plugin_data.csf_register_class_workbook_sheet_source(
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  NULL,
  'class_history',
  jsonb_build_object(
    'cohortId', 'cf200000-0000-4000-8000-000000000001',
    'title', 'Class of 2036 - Fall 2026',
    'provider', 'google_sheets',
    'spreadsheetId', 'synthetic-publication-file',
    'driveFileId', 'synthetic-publication-file',
    'syncMode', 'manual',
    'syncStatus', 'not_synced',
    'lastSyncStatus', 'source_saved',
    'targetStrategy', 'fixed',
    'duplicatePolicy', 'match_email_then_name',
    'columnMappings', '{}'::jsonb,
    'tabMappings', '[]'::jsonb,
    'settings', jsonb_build_object(
      'sourceKind', 'class_history',
      'mappingVersion', 1
    )
  ),
  'cf400000-0000-4000-8000-000000000001',
  'cf500000-0000-4000-8000-000000000001',
  'cf300000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001',
  'synthetic-publication-file',
  '801'
);

SELECT extensions.is(
  (SELECT value ->> 'workbookGenerationBound'
   FROM workbook_publication_state WHERE key = 'source'),
  'true',
  'active class source registration reports that it bound the generation'
);
SELECT extensions.is(
  (
    SELECT settings ->> 'workbookRefreshJobId'
    FROM plugin_data.csf_sheet_sources
    WHERE id = (
      SELECT (value ->> 'sourceId')::uuid
      FROM workbook_publication_state WHERE key = 'source'
    )
  ),
  'cf400000-0000-4000-8000-000000000001',
  'the source stores the refresh job as system-owned generation evidence'
);

INSERT INTO workbook_publication_state
SELECT 'retired_' || source_key,
  plugin_data.csf_register_class_workbook_sheet_source(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001',
    (SELECT (value ->> 'sourceId')::uuid
     FROM workbook_publication_state WHERE key = source_key),
    'class_history',
    '{
      "syncMode":"disabled",
      "syncStatus":"disabled",
      "lastSyncStatus":"unlinked",
      "lastSyncError":null,
      "settings":{"sourceKind":"class_history","mappingVersion":1}
    }'::jsonb,
    'cf400000-0000-4000-8000-000000000001',
    'cf500000-0000-4000-8000-000000000001',
    'cf300000-0000-4000-8000-000000000001',
    'cf200000-0000-4000-8000-000000000001',
    'synthetic-publication-file',
    '801'
  )
FROM (
  VALUES ('prior_omitted_source'), ('prior_duplicate_source')
) AS fixture(source_key);
SELECT extensions.is(
  (
    SELECT pg_catalog.string_agg(
      value ->> 'workbookGenerationBound',
      ':' ORDER BY key
    )
    FROM workbook_publication_state
    WHERE key IN ('retired_prior_omitted_source', 'retired_prior_duplicate_source')
  ),
  'false:false',
  'the replacement generation retires an omitted term and prior duplicate'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_sheet_sources
    WHERE id IN (
      SELECT (value ->> 'sourceId')::uuid
      FROM workbook_publication_state
      WHERE key IN ('prior_omitted_source', 'prior_duplicate_source')
    )
      AND sync_mode = 'disabled'
      AND sync_status = 'disabled'
  ),
  2,
  'both prior-file sources become inactive under the exact new generation'
);
SELECT extensions.ok(
  (
    SELECT pg_catalog.bool_and(
      spreadsheet_id = 'synthetic-prior-publication-file'
      AND drive_file_id = 'synthetic-prior-publication-file'
    )
    FROM plugin_data.csf_sheet_sources
    WHERE id IN (
      SELECT (value ->> 'sourceId')::uuid
      FROM workbook_publication_state
      WHERE key IN ('prior_omitted_source', 'prior_duplicate_source')
    )
  ),
  'retirement preserves the prior workbook coordinates as source provenance'
);
SELECT extensions.is(
  (
    SELECT sync_mode
    FROM plugin_data.csf_sheet_sources
    WHERE id = (
      SELECT (value ->> 'sourceId')::uuid
      FROM workbook_publication_state WHERE key = 'source'
    )
  ),
  'manual',
  'retiring prior-file sources leaves the selected workbook source active'
);
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_register_class_workbook_sheet_source(
      'cf100000-0000-4000-8000-000000000001',
      'cf000000-0000-4000-8000-000000000001',
      %L::uuid,
      'class_history',
      '{
        "cohortId":"cf200000-0000-4000-8000-000000000001",
        "provider":"google_sheets",
        "spreadsheetId":"synthetic-publication-file",
        "driveFileId":"synthetic-publication-file",
        "syncMode":"manual"
      }'::jsonb,
      'cf400000-0000-4000-8000-000000000001',
      'cf500000-0000-4000-8000-000000000001',
      'cf300000-0000-4000-8000-000000000001',
      'cf200000-0000-4000-8000-000000000001',
      'synthetic-publication-file',
      '801'
    )$$,
    (SELECT value ->> 'sourceId'
     FROM workbook_publication_state WHERE key = 'other_class_source')
  ),
  '23514',
  'The source does not belong to the claimed class.',
  'a refresh lease cannot move another class source into the claimed class'
);
SELECT extensions.is(
  (
    SELECT cohort_id::text
    FROM plugin_data.csf_sheet_sources
    WHERE id = (
      SELECT (value ->> 'sourceId')::uuid
      FROM workbook_publication_state WHERE key = 'other_class_source'
    )
  ),
  'cf200000-0000-4000-8000-000000000002',
  'a refused cross-class update leaves the other source in its original class'
);
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_register_sheet_source(
      'cf100000-0000-4000-8000-000000000001',
      'cf000000-0000-4000-8000-000000000001',
      %L::uuid,
      'class_history',
      '{"settings":{"sourceKind":"class_history","mappingVersion":1,"workbookId":"cf300000-0000-4000-8000-000000000001"}}'::jsonb
    )$$,
    (SELECT value ->> 'sourceId'
     FROM workbook_publication_state WHERE key = 'source')
  ),
  '23514',
  'CSF source settings may not state "workbookId": the staged generation is written only by csf_attach_sheet_source_generation and the provider evidence only by csf_refresh_sheet_source_evidence.',
  'ordinary source registration cannot forge workbook generation evidence'
);
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_register_class_workbook_sheet_source(
      'cf100000-0000-4000-8000-000000000001',
      'cf000000-0000-4000-8000-000000000001',
      %L::uuid,
      'class_history',
      '{"syncMode":"disabled","syncStatus":"disabled","lastSyncStatus":"unlinked"}'::jsonb,
      'cf400000-0000-4000-8000-000000000001',
      'cf500000-0000-4000-8000-000000000001',
      'cf300000-0000-4000-8000-000000000001',
      'cf200000-0000-4000-8000-000000000001',
      'synthetic-publication-file',
      '801'
    )$$,
    (SELECT value ->> 'sourceId'
     FROM workbook_publication_state WHERE key = 'other_class_source')
  ),
  '23514',
  'The source does not belong to the claimed class.',
  'a refresh lease cannot retire another class source in the organization'
);
SELECT extensions.is(
  (
    SELECT sync_mode
    FROM plugin_data.csf_sheet_sources
    WHERE id = (
      SELECT (value ->> 'sourceId')::uuid
      FROM workbook_publication_state WHERE key = 'other_class_source'
    )
  ),
  'manual',
  'a refused cross-class retirement leaves the other source active'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_open_import_preview(
      'cf100000-0000-4000-8000-000000000001',
      'cf000000-0000-4000-8000-000000000001',
      %L::uuid,
      'class_history',
      'synthetic-publication-file',
      'Synthetic class workbook',
      'Fall 2026',
      '''Fall 2026''!A1:B1',
      now(),
      '{"providerVersion":"801"}'::jsonb,
      '{
        "mappingVersion": 1,
        "workbookId": "cf300000-0000-4000-8000-000000000001",
        "workbookRefreshJobId": "cf400000-0000-4000-8000-000000000001",
        "workbookProviderVersion": "801",
        "workbookDriveFileId": "synthetic-publication-file"
      }'::jsonb,
      1, NULL, NULL, repeat('b', 64), 0, 'csf-normalized-import/v1'
    )$$,
    (SELECT value ->> 'sourceId'
     FROM workbook_publication_state WHERE key = 'source')
  ),
  '42501',
  'Class workbook previews must be opened by their refresh worker.',
  'the generic preview opener cannot bypass the workbook generation fence'
);

INSERT INTO workbook_publication_state
SELECT 'preview', plugin_data.csf_open_or_reuse_class_workbook_import_preview(
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  (SELECT (value ->> 'sourceId')::uuid
   FROM workbook_publication_state WHERE key = 'source'),
  'class_history',
  'synthetic-publication-file',
  'Synthetic class workbook',
  'Fall 2026',
  '''Fall 2026''!A1:B1',
  now(),
  '{"providerVersion":"801"}'::jsonb,
  '{
    "mappingVersion": 1,
    "workbookId": "cf300000-0000-4000-8000-000000000001",
    "workbookRefreshJobId": "cf400000-0000-4000-8000-000000000001",
    "workbookProviderVersion": "801",
    "workbookDriveFileId": "synthetic-publication-file"
  }'::jsonb,
  1, NULL, NULL, repeat('b', 64), 0, 'csf-normalized-import/v1',
  'cf400000-0000-4000-8000-000000000001',
  'cf500000-0000-4000-8000-000000000001',
  'cf300000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001',
  'synthetic-publication-file',
  '801'
);

SELECT extensions.is(
  (SELECT value ->> 'status'
   FROM workbook_publication_state WHERE key = 'preview'),
  'running',
  'the generation-bound source can open a preview under the active lease'
);
SELECT extensions.is(
  (SELECT value ->> 'reused'
   FROM workbook_publication_state WHERE key = 'preview'),
  'false',
  'the first fenced open reports that it created the preview'
);
INSERT INTO workbook_publication_state
SELECT 'preview_replay', plugin_data.csf_open_or_reuse_class_workbook_import_preview(
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  (SELECT (value ->> 'sourceId')::uuid
   FROM workbook_publication_state WHERE key = 'source'),
  'class_history',
  'synthetic-publication-file',
  'Synthetic class workbook',
  'Fall 2026',
  '''Fall 2026''!A1:B1',
  now(),
  '{"providerVersion":"801"}'::jsonb,
  '{
    "mappingVersion": 1,
    "workbookId": "cf300000-0000-4000-8000-000000000001",
    "workbookRefreshJobId": "cf400000-0000-4000-8000-000000000001",
    "workbookProviderVersion": "801",
    "workbookDriveFileId": "synthetic-publication-file"
  }'::jsonb,
  1, NULL, NULL, repeat('b', 64), 0, 'csf-normalized-import/v1',
  'cf400000-0000-4000-8000-000000000001',
  'cf500000-0000-4000-8000-000000000001',
  'cf300000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001',
  'synthetic-publication-file',
  '801'
);
SELECT extensions.is(
  (SELECT value ->> 'reused'
   FROM workbook_publication_state WHERE key = 'preview_replay'),
  'true',
  'a lost fenced-open response reuses the identical running preview'
);
SELECT extensions.is(
  (SELECT value ->> 'previewJobId'
   FROM workbook_publication_state WHERE key = 'preview_replay'),
  (SELECT value ->> 'previewJobId'
   FROM workbook_publication_state WHERE key = 'preview'),
  'fenced-open replay returns the same immutable preview id'
);
SELECT extensions.is(
  (SELECT value ->> 'status'
   FROM workbook_publication_state WHERE key = 'preview_replay'),
  'running',
  'a lost-response replay explicitly resumes construction of the running preview'
);
INSERT INTO workbook_publication_state
SELECT 'failure_preview', plugin_data.csf_open_or_reuse_class_workbook_import_preview(
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  (SELECT (value ->> 'sourceId')::uuid
   FROM workbook_publication_state WHERE key = 'source'),
  'class_history',
  'synthetic-publication-file',
  'Synthetic class workbook failure',
  'Spring 2027',
  '''Spring 2027''!A1:B1',
  now(),
  '{"providerVersion":"801"}'::jsonb,
  '{
    "mappingVersion": 1,
    "workbookId": "cf300000-0000-4000-8000-000000000001",
    "workbookRefreshJobId": "cf400000-0000-4000-8000-000000000001",
    "workbookProviderVersion": "801",
    "workbookDriveFileId": "synthetic-publication-file"
  }'::jsonb,
  1,
  (SELECT (value ->> 'previewJobId')::uuid
   FROM workbook_publication_state WHERE key = 'preview'),
  repeat('f', 64),
  repeat('e', 64),
  0,
  'csf-normalized-import/v1',
  'cf400000-0000-4000-8000-000000000001',
  'cf500000-0000-4000-8000-000000000001',
  'cf300000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001',
  'synthetic-publication-file',
  '801'
);
SELECT extensions.is(
  (SELECT value ->> 'status'
   FROM workbook_publication_state WHERE key = 'failure_preview'),
  'running',
  'the failure fixture opens under the current generation'
);
INSERT INTO workbook_publication_state
SELECT 'stale_failure_receipt', plugin_data.csf_fail_class_workbook_import_preview(
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  (SELECT (value ->> 'previewJobId')::uuid
   FROM workbook_publication_state WHERE key = 'failure_preview'),
  'synthetic_preview_failure',
  'Synthetic failure detail.',
  'cf400000-0000-4000-8000-000000000001',
  'cf500000-0000-4000-8000-000000000002',
  'cf300000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001',
  'synthetic-publication-file',
  '801'
);
SELECT extensions.is(
  (SELECT (value ->> 'failed') || ':' || (value ->> 'retryable') || ':'
       || (value ->> 'status')
   FROM workbook_publication_state WHERE key = 'stale_failure_receipt'),
  'false:true:generation_lost',
  'a stale worker receives a retryable generation-loss receipt'
);
SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_sheet_import_jobs
    WHERE id = (
      SELECT (value ->> 'previewJobId')::uuid
      FROM workbook_publication_state WHERE key = 'failure_preview'
    )
  ),
  'running',
  'a stale failure receipt leaves the resumed preview running'
);
INSERT INTO workbook_publication_state
SELECT 'current_failure_receipt', plugin_data.csf_fail_class_workbook_import_preview(
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  (SELECT (value ->> 'previewJobId')::uuid
   FROM workbook_publication_state WHERE key = 'failure_preview'),
  'synthetic_preview_failure',
  'Synthetic failure detail.',
  'cf400000-0000-4000-8000-000000000001',
  'cf500000-0000-4000-8000-000000000001',
  'cf300000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001',
  'synthetic-publication-file',
  '801'
);
SELECT extensions.is(
  (SELECT (value ->> 'failed') || ':' || (value ->> 'retryable') || ':'
       || (value ->> 'status')
   FROM workbook_publication_state WHERE key = 'current_failure_receipt'),
  'true:false:failed',
  'the current generation worker can settle its preview failure'
);
SELECT extensions.ok(
  (
    SELECT status = 'failed'
      AND error_message LIKE 'synthetic_preview_failure%'
    FROM plugin_data.csf_sheet_import_jobs
    WHERE id = (
      SELECT (value ->> 'previewJobId')::uuid
      FROM workbook_publication_state WHERE key = 'failure_preview'
    )
  ),
  'the current failure writes one bounded terminal preview state'
);
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_seal_import_preview(
      'cf100000-0000-4000-8000-000000000001',
      'cf000000-0000-4000-8000-000000000001',
      %L::uuid,
      'completed',
      '{}'::jsonb
    )$$,
    (SELECT value ->> 'previewJobId'
     FROM workbook_publication_state WHERE key = 'preview')
  ),
  '42501',
  'Class workbook previews must be sealed by their refresh worker.',
  'the generic seal cannot publish a class-workbook preview'
);
SELECT extensions.is(
  plugin_data.csf_seal_class_workbook_import_preview(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001',
    (SELECT (value ->> 'previewJobId')::uuid
     FROM workbook_publication_state WHERE key = 'preview'),
    'completed',
    '{}'::jsonb,
    'cf400000-0000-4000-8000-000000000001',
    'cf500000-0000-4000-8000-000000000001',
    'cf300000-0000-4000-8000-000000000001',
    'cf200000-0000-4000-8000-000000000001',
    'synthetic-publication-file',
    '801'
  ) ->> 'sealed',
  'true',
  'the exact refresh wrapper can publish its preview'
);
INSERT INTO workbook_publication_state
SELECT 'terminal_preview_replay',
  plugin_data.csf_open_or_reuse_class_workbook_import_preview(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001',
    (SELECT (value ->> 'sourceId')::uuid
     FROM workbook_publication_state WHERE key = 'source'),
    'class_history', 'synthetic-publication-file', 'Synthetic class workbook',
    'Fall 2026', '''Fall 2026''!A1:B1', now(),
    '{"providerVersion":"801"}'::jsonb,
    '{
      "mappingVersion": 1,
      "workbookId": "cf300000-0000-4000-8000-000000000001",
      "workbookRefreshJobId": "cf400000-0000-4000-8000-000000000001",
      "workbookProviderVersion": "801",
      "workbookDriveFileId": "synthetic-publication-file"
    }'::jsonb,
    1, NULL, NULL, repeat('b', 64), 0, 'csf-normalized-import/v1',
    'cf400000-0000-4000-8000-000000000001',
    'cf500000-0000-4000-8000-000000000001',
    'cf300000-0000-4000-8000-000000000001',
    'cf200000-0000-4000-8000-000000000001',
    'synthetic-publication-file', '801'
  );
SELECT extensions.is(
  (SELECT value ->> 'reused'
   FROM workbook_publication_state WHERE key = 'terminal_preview_replay'),
  'true',
  'an identical terminal preview is reused without reopening it'
);
SELECT extensions.is(
  (SELECT value ->> 'status'
   FROM workbook_publication_state WHERE key = 'terminal_preview_replay'),
  'completed',
  'terminal preview reuse preserves the settled status'
);
SELECT extensions.is(
  (SELECT value ->> 'previewJobId'
   FROM workbook_publication_state WHERE key = 'terminal_preview_replay'),
  (SELECT value ->> 'previewJobId'
   FROM workbook_publication_state WHERE key = 'preview'),
  'terminal preview reuse returns the same immutable preview id'
);
SELECT extensions.is(
  plugin_data.csf_finish_class_workbook_refresh_job(
    'cf400000-0000-4000-8000-000000000001',
    'cf500000-0000-4000-8000-000000000001',
    'completed',
    '[{"tabName":"Fall 2026"}]'::jsonb,
    1,
    0,
    0,
    NULL
  ) ->> 'status',
  'completed',
  'the refresh settles only after its preview is published'
);
SELECT extensions.lives_ok(
  format(
    $$SELECT plugin_data.csf_assert_import_preview_workbook_generation_current(
      'cf100000-0000-4000-8000-000000000001', %L::uuid
    )$$,
    (SELECT value ->> 'previewJobId'
     FROM workbook_publication_state WHERE key = 'preview')
  ),
  'the settled current generation passes the commit fence'
);

INSERT INTO workbook_publication_state
SELECT 'disabled_source', plugin_data.csf_register_sheet_source(
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  (SELECT (value ->> 'sourceId')::uuid
   FROM workbook_publication_state WHERE key = 'source'),
  'class_history',
  '{
    "syncMode":"disabled",
    "syncStatus":"disabled",
    "lastSyncStatus":"unlinked",
    "settings":{"sourceKind":"class_history","mappingVersion":1}
  }'::jsonb
);
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_assert_import_preview_workbook_generation_current(
      'cf100000-0000-4000-8000-000000000001', %L::uuid
    )$$,
    (SELECT value ->> 'previewJobId'
     FROM workbook_publication_state WHERE key = 'preview')
  ),
  '55000',
  'This import source is no longer active.',
  'unlinking a source invalidates its already sealed preview'
);
INSERT INTO workbook_publication_state
SELECT 'restored_source', plugin_data.csf_register_sheet_source(
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  (SELECT (value ->> 'sourceId')::uuid
   FROM workbook_publication_state WHERE key = 'source'),
  'class_history',
  '{
    "syncMode":"manual",
    "syncStatus":"healthy",
    "lastSyncStatus":"source_saved",
    "settings":{"sourceKind":"class_history","mappingVersion":1}
  }'::jsonb
);

UPDATE plugin_data.csf_class_workbooks
SET state = 'blocked',
    last_error_code = 'synthetic_operator_block'
WHERE id = 'cf300000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_assert_import_preview_workbook_generation_current(
      'cf100000-0000-4000-8000-000000000001', %L::uuid
    )$$,
    (SELECT value ->> 'previewJobId'
     FROM workbook_publication_state WHERE key = 'preview')
  ),
  '55000',
  'This workbook changed after the preview. Prepare it again.',
  'a blocked workbook invalidates its already sealed preview'
);
UPDATE plugin_data.csf_class_workbooks
SET state = 'linked',
    last_error_code = NULL
WHERE id = 'cf300000-0000-4000-8000-000000000001';

UPDATE plugin_data.csf_class_workbooks
SET provider_version = '802',
    updated_at = now()
WHERE id = 'cf300000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_assert_import_preview_workbook_generation_current(
      'cf100000-0000-4000-8000-000000000001', %L::uuid
    )$$,
    (SELECT value ->> 'previewJobId'
     FROM workbook_publication_state WHERE key = 'preview')
  ),
  '55000',
  'This workbook changed after the preview. Prepare it again.',
  'a later Drive generation makes the old preview stale'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_assert_class_workbook_refresh_generation(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001',
    'cf400000-0000-4000-8000-000000000001',
    'cf500000-0000-4000-8000-000000000001',
    'cf300000-0000-4000-8000-000000000001',
    'cf200000-0000-4000-8000-000000000001',
    'synthetic-publication-file',
    '801'
  )$$,
  '55000',
  'The workbook refresh generation is no longer current.',
  'a stale worker cannot mutate another Drive generation'
);
SELECT extensions.is(
  plugin_data.csf_open_or_reuse_class_workbook_import_preview(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001',
    (SELECT (value ->> 'sourceId')::uuid
     FROM workbook_publication_state WHERE key = 'source'),
    'class_history', 'synthetic-publication-file', 'Synthetic class workbook',
    'Fall 2026', '''Fall 2026''!A1:B1', now(),
    '{"providerVersion":"801"}'::jsonb,
    '{
      "mappingVersion": 1,
      "workbookId": "cf300000-0000-4000-8000-000000000001",
      "workbookRefreshJobId": "cf400000-0000-4000-8000-000000000001",
      "workbookProviderVersion": "801",
      "workbookDriveFileId": "synthetic-publication-file"
    }'::jsonb,
    1, NULL, NULL, repeat('b', 64), 0, 'csf-normalized-import/v1',
    'cf400000-0000-4000-8000-000000000001',
    'cf500000-0000-4000-8000-000000000001',
    'cf300000-0000-4000-8000-000000000001',
    'cf200000-0000-4000-8000-000000000001',
    'synthetic-publication-file', '801'
  ) ->> 'reasonCode',
  'workbook_refresh_generation_lost',
  'a stale worker receives a structured retryable generation-loss receipt'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_register_class_workbook_sheet_source(uuid,uuid,uuid,text,jsonb,uuid,uuid,uuid,uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_register_class_workbook_sheet_source(uuid,uuid,uuid,text,jsonb,uuid,uuid,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'only service role can mutate a class source under a refresh lease'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_seal_class_workbook_import_preview(uuid,uuid,uuid,text,jsonb,uuid,uuid,uuid,uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_seal_class_workbook_import_preview(uuid,uuid,uuid,text,jsonb,uuid,uuid,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'only service role can seal a preview under a refresh lease'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_open_or_reuse_class_workbook_import_preview(uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone,jsonb,jsonb,integer,uuid,text,text,integer,text,uuid,uuid,uuid,uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_open_or_reuse_class_workbook_import_preview(uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone,jsonb,jsonb,integer,uuid,text,text,integer,text,uuid,uuid,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'only service role can atomically open a class workbook preview'
);

SELECT * FROM extensions.finish();

ROLLBACK;
