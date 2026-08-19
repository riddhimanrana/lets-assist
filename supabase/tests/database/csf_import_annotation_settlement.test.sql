BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(13);

-- ACL surface: browser roles must not settle rows.
SELECT has_function(
  'plugin_data', 'csf_apply_import_annotation_interpretation',
  ARRAY['uuid', 'uuid', 'text', 'text', 'uuid'],
  'annotation settlement RPC exists'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_apply_import_annotation_interpretation(uuid, uuid, text, text, uuid)',
    'EXECUTE'
  ),
  'anon cannot settle'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_apply_import_annotation_interpretation(uuid, uuid, text, text, uuid)',
    'EXECUTE'
  ),
  'authenticated cannot settle'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_apply_import_annotation_interpretation(uuid, uuid, text, text, uuid)',
    'EXECUTE'
  ),
  'service_role settles'
);

-- Fixture: one org, one actor, one source, one job, three rows.
INSERT INTO auth.users (id, email)
VALUES ('a1a10000-0000-4000-8000-000000000001', 'annotation-actor@local.test');
INSERT INTO public.organizations (id, name, username, type, join_code, created_by)
VALUES ('a1a10000-0000-4000-8000-000000000002', 'Annotation Settlement Org',
        'annotation-settlement-org', 'school', '990001',
        'a1a10000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, title, provider, spreadsheet_id
) VALUES (
  'a1a10000-0000-4000-8000-000000000003',
  'a1a10000-0000-4000-8000-000000000002',
  'Annotation fixture workbook', 'google_sheets', 'annotation-fixture'
);
INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_sheet_tab, mapping_version
) VALUES (
  'a1a10000-0000-4000-8000-000000000004',
  'a1a10000-0000-4000-8000-000000000002',
  'a1a10000-0000-4000-8000-000000000003',
  'a1a10000-0000-4000-8000-000000000001',
  'preview', 'needs_resolution', 'class_history', 'S26', 1
);

-- Row 2: the settleable shape -- only the activity-points error, annotated.
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, sheet_tab_name, row_number,
  raw_data, normalized_data, row_hash, import_status, errors, mapping_version
) VALUES (
  'a1a10000-0000-4000-8000-000000000005',
  'a1a10000-0000-4000-8000-000000000002',
  'a1a10000-0000-4000-8000-000000000004',
  'a1a10000-0000-4000-8000-000000000003',
  'S26', 2, '{}'::jsonb,
  jsonb_build_object(
    'annotations', jsonb_build_object('4', jsonb_build_object('background', '#b7e1cd')),
    'commitPayload', jsonb_build_object('allRequirementsMet', NULL)
  ),
  repeat('a', 64), 'error',
  ARRAY['Activity values without explicit numeric points require officer reconciliation: Activity 1.'],
  1
);
-- Row 3: carries a foreign blocker that must keep blocking.
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, sheet_tab_name, row_number,
  raw_data, normalized_data, row_hash, import_status, errors, mapping_version
) VALUES (
  'a1a10000-0000-4000-8000-000000000006',
  'a1a10000-0000-4000-8000-000000000002',
  'a1a10000-0000-4000-8000-000000000004',
  'a1a10000-0000-4000-8000-000000000003',
  'S26', 3, '{}'::jsonb,
  jsonb_build_object(
    'annotations', jsonb_build_object('4', jsonb_build_object('background', '#f4c7c3'))
  ),
  repeat('b', 64), 'error',
  ARRAY['Row has an incomplete name.'],
  1
);
-- Row 4: no presentation evidence at all.
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, sheet_tab_name, row_number,
  raw_data, normalized_data, row_hash, import_status, errors, mapping_version
) VALUES (
  'a1a10000-0000-4000-8000-000000000007',
  'a1a10000-0000-4000-8000-000000000002',
  'a1a10000-0000-4000-8000-000000000004',
  'a1a10000-0000-4000-8000-000000000003',
  'S26', 4, '{}'::jsonb,
  jsonb_build_object('annotations', '{}'::jsonb),
  repeat('c', 64), 'error',
  ARRAY['Activity values without explicit numeric points require officer reconciliation: Activity 1.'],
  1
);

-- Settling the green row clears its error and records the resolution.
SELECT is(
  (plugin_data.csf_apply_import_annotation_interpretation(
    'a1a10000-0000-4000-8000-000000000002',
    'a1a10000-0000-4000-8000-000000000005',
    'met', 'Whole row filled green; All Reqs Met convention on S26 is a fill.',
    'a1a10000-0000-4000-8000-000000000001'
  )) ->> 'status',
  'settled',
  'green row settles'
);
SELECT results_eq(
  $q$SELECT import_status, resolution_status, resolution_reason_code,
        errors = ARRAY[]::text[],
        jsonb_typeof(normalized_data -> 'commitPayload' -> 'allRequirementsMet')
      FROM plugin_data.csf_sheet_import_rows
      WHERE id = 'a1a10000-0000-4000-8000-000000000005'$q$,
  $q$VALUES ('pending'::text, 'resolved'::text, 'annotation_met'::text, true, 'null'::text)$q$,
  'settlement resolves via reason code and leaves evidence immutable'
);
-- The commit path carries the settled outcome as the completion override.
SELECT ok(
  pg_get_functiondef((
    SELECT p.oid FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'plugin_data'
      AND p.proname = 'csf_commit_import_row_for_attempt_identity_base'
  )) LIKE '%annotation_met%',
  'commit honors annotation settlement outcomes'
);
SELECT is(
  (plugin_data.csf_apply_import_annotation_interpretation(
    'a1a10000-0000-4000-8000-000000000002',
    'a1a10000-0000-4000-8000-000000000005',
    'met', 'Replay of the same settlement.',
    'a1a10000-0000-4000-8000-000000000001'
  )) ->> 'status',
  'already_settled',
  'settlement is idempotent'
);

-- A row with any other blocker refuses settlement.
SELECT throws_like(
  $q$SELECT plugin_data.csf_apply_import_annotation_interpretation(
    'a1a10000-0000-4000-8000-000000000002',
    'a1a10000-0000-4000-8000-000000000006',
    'not_met', 'Red fill on the whole row.',
    'a1a10000-0000-4000-8000-000000000001'
  )$q$,
  '%non-annotation blocker%',
  'foreign blockers keep blocking'
);
-- A row without presentation evidence refuses settlement.
SELECT throws_like(
  $q$SELECT plugin_data.csf_apply_import_annotation_interpretation(
    'a1a10000-0000-4000-8000-000000000002',
    'a1a10000-0000-4000-8000-000000000007',
    'met', 'No evidence exists for this row.',
    'a1a10000-0000-4000-8000-000000000001'
  )$q$,
  '%no presentation evidence%',
  'evidence is required'
);
-- Outcome vocabulary is closed.
SELECT throws_like(
  $q$SELECT plugin_data.csf_apply_import_annotation_interpretation(
    'a1a10000-0000-4000-8000-000000000002',
    'a1a10000-0000-4000-8000-000000000005',
    'maybe', 'Bad outcome.',
    'a1a10000-0000-4000-8000-000000000001'
  )$q$,
  '%must be met, exception_met, or not_met%',
  'outcome vocabulary is closed'
);
-- A reason is required.
SELECT throws_like(
  $q$SELECT plugin_data.csf_apply_import_annotation_interpretation(
    'a1a10000-0000-4000-8000-000000000002',
    'a1a10000-0000-4000-8000-000000000005',
    'met', ' ',
    'a1a10000-0000-4000-8000-000000000001'
  )$q$,
  '%reason is required%',
  'a reason is required'
);
-- Cross-organization settlement is refused.
SELECT throws_like(
  $q$SELECT plugin_data.csf_apply_import_annotation_interpretation(
    'a1a10000-0000-4000-8000-0000000000ff',
    'a1a10000-0000-4000-8000-000000000005',
    'met', 'Wrong organization.',
    'a1a10000-0000-4000-8000-000000000001'
  )$q$,
  '%not found%',
  'cross-organization settlement is refused'
);

SELECT * FROM finish();
ROLLBACK;
