BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(21);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'f9000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'atomic-source-key-officer@local.test',
  now(), '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'f9100000-0000-4000-8000-000000000001',
  'Atomic Source Key Import',
  'atomic-source-key-import',
  'school',
  '985731'
);

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES (
  'f9100000-0000-4000-8000-000000000001',
  'f9000000-0000-4000-8000-000000000001',
  'admin',
  'active'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES
  (
    'f9200000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000001',
    2041,
    'Class of 2041'
  ),
  (
    'f9200000-0000-4000-8000-000000000002',
    'f9100000-0000-4000-8000-000000000001',
    2042,
    'Class of 2042'
  );

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester
) VALUES
  (
    'f9300000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000001',
    'F40', 'Fall 2040', '2040-2041', 'fall'
  ),
  (
    'f9300000-0000-4000-8000-000000000002',
    'f9100000-0000-4000-8000-000000000001',
    'S41', 'Spring 2041', '2040-2041', 'spring'
  );

INSERT INTO plugin_data.csf_cohort_terms (
  organization_id, cohort_id, term_id, grade_level, sheet_tab_name
) VALUES
  (
    'f9100000-0000-4000-8000-000000000001',
    'f9200000-0000-4000-8000-000000000001',
    'f9300000-0000-4000-8000-000000000001',
    11, 'F40'
  ),
  (
    'f9100000-0000-4000-8000-000000000001',
    'f9200000-0000-4000-8000-000000000001',
    'f9300000-0000-4000-8000-000000000002',
    11, 'S41'
  ),
  (
    'f9100000-0000-4000-8000-000000000001',
    'f9200000-0000-4000-8000-000000000002',
    'f9300000-0000-4000-8000-000000000001',
    10, 'F40'
  );

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, cohort_id, source_type, title, provider,
  spreadsheet_id, settings
) VALUES
  (
    'f9400000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000001',
    'f9200000-0000-4000-8000-000000000001',
    'class_history', 'Official Class of 2041 workbook', 'google_sheets',
    'atomic-workbook-a', '{"sourceKind":"class_history"}'::jsonb
  ),
  (
    'f9400000-0000-4000-8000-000000000002',
    'f9100000-0000-4000-8000-000000000001',
    'f9200000-0000-4000-8000-000000000002',
    'class_history', 'Official Class of 2042 workbook', 'google_sheets',
    'atomic-workbook-a', '{"sourceKind":"class_history"}'::jsonb
  );

-- Both semester previews exist before either row writes. This is the durable
-- state produced when separate ready previews are approved before the worker
-- reaches either row.
INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, mode, status, source_type, source_file_id
) VALUES
  (
    'f9500000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000001',
    'f9400000-0000-4000-8000-000000000001',
    'preview', 'completed', 'class_history', 'atomic-workbook-a'
  ),
  (
    'f9500000-0000-4000-8000-000000000002',
    'f9100000-0000-4000-8000-000000000001',
    'f9400000-0000-4000-8000-000000000001',
    'preview', 'completed', 'class_history', 'atomic-workbook-a'
  ),
  (
    'f9500000-0000-4000-8000-000000000003',
    'f9100000-0000-4000-8000-000000000001',
    'f9400000-0000-4000-8000-000000000001',
    'preview', 'completed', 'class_history', 'atomic-workbook-b'
  ),
  (
    'f9500000-0000-4000-8000-000000000004',
    'f9100000-0000-4000-8000-000000000001',
    'f9400000-0000-4000-8000-000000000002',
    'preview', 'completed', 'class_history', 'atomic-workbook-a'
  ),
  (
    'f9500000-0000-4000-8000-000000000005',
    'f9100000-0000-4000-8000-000000000001',
    'f9400000-0000-4000-8000-000000000001',
    'preview', 'completed', 'class_history', 'atomic-workbook-a'
  ),
  (
    'f9500000-0000-4000-8000-000000000006',
    'f9100000-0000-4000-8000-000000000001',
    'f9400000-0000-4000-8000-000000000001',
    'preview', 'completed', 'class_history', 'atomic-workbook-a'
  );

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, mode, status, source_type, source_file_id,
  preview_job_id
) VALUES
  (
    'f9510000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000001',
    'f9400000-0000-4000-8000-000000000001',
    'commit', 'running', 'class_history', 'atomic-workbook-a',
    'f9500000-0000-4000-8000-000000000001'
  ),
  (
    'f9510000-0000-4000-8000-000000000002',
    'f9100000-0000-4000-8000-000000000001',
    'f9400000-0000-4000-8000-000000000001',
    'commit', 'running', 'class_history', 'atomic-workbook-a',
    'f9500000-0000-4000-8000-000000000002'
  );

INSERT INTO plugin_data.csf_sheet_import_commit_attempts (
  id, organization_id, commit_job_id, attempt_number, correlation_id,
  actor_user_id, actor_snapshot, status, lease_expires_at
) VALUES
  (
    'f9520000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000001',
    'f9510000-0000-4000-8000-000000000001', 1,
    'f9530000-0000-4000-8000-000000000001',
    'f9000000-0000-4000-8000-000000000001',
    '{"claimedBy":"f9000000-0000-4000-8000-000000000001"}'::jsonb,
    'running', now() + interval '5 minutes'
  ),
  (
    'f9520000-0000-4000-8000-000000000002',
    'f9100000-0000-4000-8000-000000000001',
    'f9510000-0000-4000-8000-000000000002', 1,
    'f9530000-0000-4000-8000-000000000002',
    'f9000000-0000-4000-8000-000000000001',
    '{"claimedBy":"f9000000-0000-4000-8000-000000000001"}'::jsonb,
    'running', now() + interval '5 minutes'
  );

-- Register after the synthetic preview rows are opened. Production opens these
-- previews through the generation-fenced worker; this focused test exercises
-- the identity commit seam without fabricating worker leases.
INSERT INTO plugin_data.csf_class_workbooks (
  id, organization_id, cohort_id, drive_file_id, drive_owner_user_id,
  provider_version, provider_modified_at, discovered_tabs,
  source_candidates, last_checked_at, last_prepared_version, state
) VALUES
  (
    'f9450000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000001',
    'f9200000-0000-4000-8000-000000000001',
    'atomic-workbook-a',
    'f9000000-0000-4000-8000-000000000001',
    '1', '2040-08-01T00:00:00Z', '[]'::jsonb,
    '["atomic-workbook-a"]'::jsonb, now(), '1', 'linked'
  ),
  (
    'f9450000-0000-4000-8000-000000000002',
    'f9100000-0000-4000-8000-000000000001',
    'f9200000-0000-4000-8000-000000000002',
    'atomic-workbook-a',
    'f9000000-0000-4000-8000-000000000001',
    '1', '2040-08-01T00:00:00Z', '[]'::jsonb,
    '["atomic-workbook-a"]'::jsonb, now(), '1', 'linked'
  );

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, cohort_id, term_id,
  sheet_tab_name, row_number, normalized_data, row_hash,
  matched_profile_id, import_status
) VALUES
  (
    'f9600000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000001',
    'f9500000-0000-4000-8000-000000000001',
    'f9400000-0000-4000-8000-000000000001',
    'f9200000-0000-4000-8000-000000000001',
    'f9300000-0000-4000-8000-000000000001',
    'F40', 2,
    '{"record":{"identity":{"firstName":"Rowan","lastName":"Sample","normalizedFirstName":"rowan","normalizedLastName":"sample","sourceStudentKey":"SampleRowan"},"contact":{"schoolEmail":"rowan.sample@local.test"}}}'::jsonb,
    repeat('1', 64), NULL, 'pending'
  ),
  (
    'f9600000-0000-4000-8000-000000000002',
    'f9100000-0000-4000-8000-000000000001',
    'f9500000-0000-4000-8000-000000000002',
    'f9400000-0000-4000-8000-000000000001',
    'f9200000-0000-4000-8000-000000000001',
    'f9300000-0000-4000-8000-000000000002',
    'S41', 2,
    '{"record":{"identity":{"firstName":"Rowan","lastName":"Sample","normalizedFirstName":"Ro wan","normalizedLastName":"SAMPLE","sourceStudentKey":"rowansample"},"contact":{"schoolEmail":"rowan.sample@local.test"}}}'::jsonb,
    repeat('2', 64), NULL, 'pending'
  ),
  (
    'f9600000-0000-4000-8000-000000000003',
    'f9100000-0000-4000-8000-000000000001',
    'f9500000-0000-4000-8000-000000000003',
    'f9400000-0000-4000-8000-000000000001',
    'f9200000-0000-4000-8000-000000000001',
    'f9300000-0000-4000-8000-000000000002',
    'S41', 3,
    '{"record":{"identity":{"firstName":"Rowan","lastName":"Sample","normalizedFirstName":"rowan","normalizedLastName":"sample","sourceStudentKey":"rowansample"}}}'::jsonb,
    repeat('3', 64), NULL, 'pending'
  ),
  (
    'f9600000-0000-4000-8000-000000000004',
    'f9100000-0000-4000-8000-000000000001',
    'f9500000-0000-4000-8000-000000000004',
    'f9400000-0000-4000-8000-000000000002',
    'f9200000-0000-4000-8000-000000000002',
    'f9300000-0000-4000-8000-000000000001',
    'F40', 2,
    '{"record":{"identity":{"firstName":"Rowan","lastName":"Sample","normalizedFirstName":"rowan","normalizedLastName":"sample","sourceStudentKey":"rowansample"}}}'::jsonb,
    repeat('4', 64), NULL, 'pending'
  ),
  (
    'f9600000-0000-4000-8000-000000000005',
    'f9100000-0000-4000-8000-000000000001',
    'f9500000-0000-4000-8000-000000000005',
    'f9400000-0000-4000-8000-000000000001',
    'f9200000-0000-4000-8000-000000000001',
    'f9300000-0000-4000-8000-000000000002',
    'S41', 4,
    '{"record":{"identity":{"firstName":"Rowans","lastName":"Ample","normalizedFirstName":"rowans","normalizedLastName":"ample","sourceStudentKey":"rowansample"}}}'::jsonb,
    repeat('5', 64), NULL, 'pending'
  ),
  (
    'f9600000-0000-4000-8000-000000000006',
    'f9100000-0000-4000-8000-000000000001',
    'f9500000-0000-4000-8000-000000000006',
    'f9400000-0000-4000-8000-000000000001',
    'f9200000-0000-4000-8000-000000000001',
    'f9300000-0000-4000-8000-000000000002',
    'S41', 5,
    '{"record":{"identity":{"firstName":"Rowan","lastName":"Sample","normalizedFirstName":"rowan","normalizedLastName":"sample","sourceStudentKey":"rowansample"}}}'::jsonb,
    repeat('6', 64), NULL, 'pending'
  );

UPDATE plugin_data.csf_sheet_import_rows AS import_row
SET commit_frozen_at = now(),
    commit_frozen_by_job_id = CASE import_row.id
      WHEN 'f9600000-0000-4000-8000-000000000001'::uuid
        THEN 'f9510000-0000-4000-8000-000000000001'::uuid
      ELSE 'f9510000-0000-4000-8000-000000000002'::uuid
    END,
    commit_frozen_row_hash = import_row.row_hash,
    commit_frozen_source_id = import_row.source_id,
    commit_frozen_payload_hash = repeat('a', 64),
    commit_frozen_actor_user_id =
      'f9000000-0000-4000-8000-000000000001'::uuid,
    commit_frozen_actor_snapshot =
      '{"claimedBy":"f9000000-0000-4000-8000-000000000001"}'::jsonb,
    commit_resolution_snapshot = '{}'::jsonb,
    commit_outcome_state = 'frozen'
WHERE import_row.id IN (
  'f9600000-0000-4000-8000-000000000001',
  'f9600000-0000-4000-8000-000000000002'
);

UPDATE plugin_data.csf_sheet_import_rows AS import_row
SET commit_intent_attempt_id = CASE import_row.id
      WHEN 'f9600000-0000-4000-8000-000000000001'::uuid
        THEN 'f9520000-0000-4000-8000-000000000001'::uuid
      ELSE 'f9520000-0000-4000-8000-000000000002'::uuid
    END,
    commit_intent_correlation_id = CASE import_row.id
      WHEN 'f9600000-0000-4000-8000-000000000001'::uuid
        THEN 'f9530000-0000-4000-8000-000000000001'::uuid
      ELSE 'f9530000-0000-4000-8000-000000000002'::uuid
    END,
    commit_intent_started_at = now(),
    commit_outcome_state = 'in_flight'
WHERE import_row.id IN (
  'f9600000-0000-4000-8000-000000000001',
  'f9600000-0000-4000-8000-000000000002'
);

SELECT extensions.is(
  (
    SELECT pg_catalog.count(DISTINCT job_id)::integer
    FROM plugin_data.csf_sheet_import_rows
    WHERE id IN (
      'f9600000-0000-4000-8000-000000000001',
      'f9600000-0000-4000-8000-000000000002'
    )
      AND import_status = 'pending'
      AND matched_profile_id IS NULL
      AND commit_frozen_at IS NOT NULL
      AND commit_outcome_state = 'in_flight'
  ),
  2,
  'both contact-corroborated semester previews are separately frozen before either one writes'
);

SELECT extensions.is(
  plugin_data.csf_class_history_source_key_target(
    'f9100000-0000-4000-8000-000000000001',
    'f9600000-0000-4000-8000-000000000001'
  ),
  NULL::uuid,
  'the first official-workbook occurrence has no profile to reuse'
);

CREATE TEMP TABLE atomic_source_key_results (
  operation text PRIMARY KEY,
  result jsonb NOT NULL
);

-- One SQL statement mirrors the worker's row-batch loop. The resolver must be
-- volatile so the second call sees the first call's newly committed profile.
CREATE FUNCTION pg_temp.commit_atomic_source_key_terms()
RETURNS TABLE (operation text, result jsonb)
LANGUAGE plpgsql
AS $$
BEGIN
  operation := 'fall';
  result := plugin_data.csf_import_class_history_row_v2(
    'f9100000-0000-4000-8000-000000000001', NULL,
    'Rowan', 'Sample', 'rowan.sample@local.test', NULL,
    'rowan', 'sample', 'rowan.sample@local.test', NULL,
    'f9200000-0000-4000-8000-000000000001',
    'f9300000-0000-4000-8000-000000000001',
    'f9400000-0000-4000-8000-000000000001',
    'f9600000-0000-4000-8000-000000000001', repeat('1', 64),
    '[]'::jsonb, '[]'::jsonb, true,
    'f9000000-0000-4000-8000-000000000001'
  );
  RETURN NEXT;

  operation := 'spring';
  result := plugin_data.csf_import_class_history_row_v2(
    'f9100000-0000-4000-8000-000000000001', NULL,
    'Rowan', 'Sample', 'rowan.sample@local.test', NULL,
    'rowan', 'sample', 'rowan.sample@local.test', NULL,
    'f9200000-0000-4000-8000-000000000001',
    'f9300000-0000-4000-8000-000000000002',
    'f9400000-0000-4000-8000-000000000001',
    'f9600000-0000-4000-8000-000000000002', repeat('2', 64),
    '[]'::jsonb, '[]'::jsonb, true,
    'f9000000-0000-4000-8000-000000000001'
  );
  RETURN NEXT;
END;
$$;

INSERT INTO atomic_source_key_results (operation, result)
SELECT operation, result
FROM pg_temp.commit_atomic_source_key_terms();

SELECT extensions.is(
  (SELECT result ->> 'importStatus'
   FROM atomic_source_key_results WHERE operation = 'fall'),
  'created',
  'the first contact-corroborated term creates the profile'
);

SELECT extensions.is(
  plugin_data.csf_class_history_source_key_target(
    'f9100000-0000-4000-8000-000000000001',
    'f9600000-0000-4000-8000-000000000002'
  ),
  (
    SELECT matched_profile_id
    FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'f9600000-0000-4000-8000-000000000001'
  ),
  'the second term resolves through the source key and matching contact'
);

SELECT extensions.is(
  (SELECT result ->> 'importStatus'
   FROM atomic_source_key_results WHERE operation = 'spring'),
  'updated',
  'the later contact-corroborated term updates the established profile'
);

SELECT extensions.is(
  (SELECT result ->> 'sourceKeyProfileReused'
   FROM atomic_source_key_results WHERE operation = 'spring'),
  'true',
  'the later term receipt records source-key reuse'
);

SELECT extensions.is(
  (
    SELECT pg_catalog.count(*)::integer
    FROM plugin_data.csf_profiles
    WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
  ),
  1,
  'two contact-corroborated terms create exactly one profile'
);

SELECT extensions.is(
  (
    SELECT pg_catalog.count(DISTINCT matched_profile_id)::integer
    FROM plugin_data.csf_sheet_import_rows
    WHERE id IN (
      'f9600000-0000-4000-8000-000000000001',
      'f9600000-0000-4000-8000-000000000002'
    )
  ),
  1,
  'both term rows retain the same profile identity'
);

SELECT extensions.is(
  (
    SELECT pg_catalog.count(*)::integer
    FROM plugin_data.csf_term_memberships
    WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
      AND profile_id = (
        SELECT matched_profile_id
        FROM plugin_data.csf_sheet_import_rows
        WHERE id = 'f9600000-0000-4000-8000-000000000001'
      )
      AND term_id IN (
        'f9300000-0000-4000-8000-000000000001',
        'f9300000-0000-4000-8000-000000000002'
      )
  ),
  2,
  'the one profile keeps both imported term histories'
);

SELECT extensions.is(
  plugin_data.csf_class_history_source_key_target(
    'f9100000-0000-4000-8000-000000000001',
    'f9600000-0000-4000-8000-000000000006'
  ),
  NULL::uuid,
  'a name-only row cannot reuse the earlier profile without contact corroboration'
);

SELECT extensions.ok(
  plugin_data.csf_class_history_source_key_requires_review(
    'f9100000-0000-4000-8000-000000000001',
    'f9600000-0000-4000-8000-000000000006'
  ),
  'the name-only repeated key is routed to officer review'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_import_class_history_row_v2(
    'f9100000-0000-4000-8000-000000000001', NULL,
    'Rowan', 'Sample', NULL, NULL,
    'rowan', 'sample', NULL, NULL,
    'f9200000-0000-4000-8000-000000000001',
    'f9300000-0000-4000-8000-000000000002',
    'f9400000-0000-4000-8000-000000000001',
    'f9600000-0000-4000-8000-000000000006', repeat('6', 64),
    '[]'::jsonb, '[]'::jsonb, true,
    'f9000000-0000-4000-8000-000000000001'
  )$$,
  '23514',
  'This workbook key needs officer review before another profile can be created.',
  'the locked write refuses name-only automatic profile reuse'
);

SELECT extensions.is(
  plugin_data.csf_class_history_source_key_target(
    'f9100000-0000-4000-8000-000000000001',
    'f9600000-0000-4000-8000-000000000003'
  ),
  NULL::uuid,
  'the same key from another workbook cannot reuse the profile'
);

SELECT extensions.is(
  plugin_data.csf_class_history_source_key_target(
    'f9100000-0000-4000-8000-000000000001',
    'f9600000-0000-4000-8000-000000000004'
  ),
  NULL::uuid,
  'the same key from another cohort cannot reuse the profile'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_class_history_source_key_target(
    'f9100000-0000-4000-8000-000000000001',
    'f9600000-0000-4000-8000-000000000005'
  )$$,
  '23514',
  'This workbook key has conflicting immutable student names. Resolve the source rows before importing another semester.',
  'one normalized key split across different immutable names is refused'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_import_class_history_row_v2(
    'f9100000-0000-4000-8000-000000000001', NULL,
    'Rowans', 'Ample', NULL, NULL,
    'rowans', 'ample', NULL, NULL,
    'f9200000-0000-4000-8000-000000000001',
    'f9300000-0000-4000-8000-000000000002',
    'f9400000-0000-4000-8000-000000000001',
    'f9600000-0000-4000-8000-000000000005', repeat('5', 64),
    '[]'::jsonb, '[]'::jsonb, true,
    'f9000000-0000-4000-8000-000000000001'
  )$$,
  '23514',
  'This workbook key has conflicting immutable student names. Resolve the source rows before importing another semester.',
  'the locked write refuses a divergent source-key mapping before creating a profile'
);

SELECT extensions.is(
  (
    SELECT pg_catalog.count(*)::integer
    FROM plugin_data.csf_profiles
    WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
  ),
  1,
  'a divergent mapping leaves the established profile count unchanged'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES (
  'f9700000-0000-4000-8000-000000000001',
  'f9100000-0000-4000-8000-000000000001',
  'Rowan', 'Sample', 'rowan', 'sample'
);

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, cohort_id, term_id,
  sheet_tab_name, row_number, normalized_data, row_hash,
  matched_profile_id, import_status
) VALUES (
  'f9600000-0000-4000-8000-000000000007',
  'f9100000-0000-4000-8000-000000000001',
  'f9500000-0000-4000-8000-000000000001',
  'f9400000-0000-4000-8000-000000000001',
  'f9200000-0000-4000-8000-000000000001',
  'f9300000-0000-4000-8000-000000000001',
  'F40', 7,
  '{"record":{"identity":{"firstName":"Rowan","lastName":"Sample","normalizedFirstName":"rowan","normalizedLastName":"sample","sourceStudentKey":"rowansample"}}}'::jsonb,
  repeat('7', 64),
  'f9700000-0000-4000-8000-000000000001',
  'created'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_class_history_source_key_target(
    'f9100000-0000-4000-8000-000000000001',
    'f9600000-0000-4000-8000-000000000006'
  )$$,
  '23514',
  'This workbook key already points to more than one CSF profile. Merge or resolve those profiles before importing another semester.',
  'one workbook key mapped to multiple profiles is refused'
);

SELECT extensions.is(
  (
    SELECT routine.provolatile::text
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid =
      'plugin_data.csf_class_history_source_key_target(uuid,uuid)'::regprocedure
  ),
  'v',
  'the source-key resolver observes writes made earlier in one row-batch statement'
);

SELECT extensions.is(
  (
    SELECT routine.provolatile::text
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid =
      'plugin_data.csf_class_history_source_key_requires_review(uuid,uuid)'::regprocedure
  ),
  'v',
  'the fallback review check observes writes made earlier in one row-batch statement'
);

SELECT extensions.ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'plugin_data.csf_import_class_history_row_v2(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)'::regprocedure
    ),
    'PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id)'
  ) < pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'plugin_data.csf_import_class_history_row_v2(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)'::regprocedure
    ),
    'plugin_data.csf_class_history_source_key_target('
  ),
  'the source-key resolver runs only after the organization identity lock'
);

SELECT * FROM extensions.finish();
ROLLBACK;
