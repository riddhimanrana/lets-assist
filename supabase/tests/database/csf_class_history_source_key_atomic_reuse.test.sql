BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(47);

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

-- The annotation reviewer is deliberately different from the commit actor.
INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'f9000000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'annotation-reviewer@local.test',
  now(), '{}', '{}', now(), now()
);
UPDATE plugin_data.csf_sheet_import_rows
SET resolution_status = 'resolved', resolution_reason_code = 'annotation_met',
    resolution_notes = 'Officer confirmed the historical completion evidence.',
    resolved_by = 'f9000000-0000-4000-8000-000000000002',
    resolved_at = '2040-08-01T12:00:00Z'
WHERE id = 'f9600000-0000-4000-8000-000000000002';
CREATE TEMP TABLE annotation_decision_before AS
SELECT id, resolution_reason_code, resolution_notes, resolved_by, resolved_at
FROM plugin_data.csf_sheet_import_rows
WHERE id = 'f9600000-0000-4000-8000-000000000002';

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
CREATE TEMP TABLE annotation_binding_guards (case_name text PRIMARY KEY, refused boolean);
CREATE FUNCTION pg_temp.try_changed_annotation_binding(p_case text, p_target uuid)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  UPDATE plugin_data.csf_sheet_import_rows
  SET matched_profile_id = CASE WHEN p_case = 'wrong_target'
        THEN 'f9700000-0000-4000-8000-000000000099'::uuid ELSE p_target END,
      resolution_notes = CASE WHEN p_case = 'notes' THEN 'Changed decision.' ELSE resolution_notes END,
      resolution_reason_code = CASE WHEN p_case = 'reason'
        THEN 'commit_reused_source_key' ELSE resolution_reason_code END,
      resolved_by = CASE WHEN p_case IN ('reason', 'actor')
        THEN 'f9000000-0000-4000-8000-000000000001'::uuid ELSE resolved_by END
  WHERE id = 'f9600000-0000-4000-8000-000000000002';
  -- Roll back the attempted binding even if the guard incorrectly accepts it.
  RAISE EXCEPTION 'Binding was accepted.' USING ERRCODE = 'P0002';
EXCEPTION
  WHEN SQLSTATE '55000' THEN RETURN true;
  WHEN SQLSTATE 'P0002' THEN RETURN false;
END;
$$;

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
    '[{"slot":"activity_1","value":"Synthetic service","points":2}]'::jsonb,
    '[{"key":"meeting_1","value":"Present","status":"attended"}]'::jsonb, true,
    'f9000000-0000-4000-8000-000000000001'
  );
  RETURN NEXT;

  INSERT INTO annotation_binding_guards
  SELECT scenario, pg_temp.try_changed_annotation_binding(scenario, (result ->> 'profileId')::uuid)
  FROM unnest(ARRAY['notes', 'reason', 'actor', 'wrong_target']) AS cases(scenario);

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

SELECT extensions.is(
  (SELECT count(*)::integer FROM annotation_binding_guards WHERE refused), 4,
  'frozen binding refuses changed annotation notes, reason, actor, and wrong target');
SELECT extensions.is(
  (SELECT jsonb_build_array(r.resolution_reason_code, r.resolution_notes, r.resolved_by, r.resolved_at)
   FROM plugin_data.csf_sheet_import_rows r JOIN annotation_decision_before b USING (id)),
  (SELECT jsonb_build_array(resolution_reason_code, resolution_notes, resolved_by, resolved_at)
   FROM annotation_decision_before),
  'frozen source-key reuse preserves the other officer annotation decision exactly'
);
SELECT extensions.is(
  (SELECT commit_resolution_snapshot FROM plugin_data.csf_sheet_import_rows
   WHERE id = 'f9600000-0000-4000-8000-000000000002'),
  '{}'::jsonb,
  'source-key binding does not rewrite the frozen resolution snapshot'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_term_memberships
   WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
     AND term_id = 'f9300000-0000-4000-8000-000000000002'),
  'completed', 'annotation outcome survives identity binding into membership'
);

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, cohort_id, term_id,
  sheet_tab_name, row_number, normalized_data, row_hash,
  matched_profile_id, import_status
)
SELECT 'f9600000-0000-4000-8000-000000000008', organization_id,
  'f9500000-0000-4000-8000-000000000005', source_id, cohort_id, term_id,
  sheet_tab_name, row_number, normalized_data, repeat('8', 64),
  matched_profile_id, 'pending'
FROM plugin_data.csf_sheet_import_rows
WHERE id = 'f9600000-0000-4000-8000-000000000001';

CREATE FUNCTION pg_temp.reimport_recorded_history(p_completion boolean)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT plugin_data.csf_import_class_history_row_v2(
    r.organization_id, r.matched_profile_id,
    'Rowan', 'Sample', 'rowan.sample@local.test', NULL,
    'rowan', 'sample', 'rowan.sample@local.test', NULL,
    r.cohort_id, r.term_id, r.source_id, r.id, r.row_hash,
    '[]'::jsonb, '[]'::jsonb, p_completion,
    'f9000000-0000-4000-8000-000000000001'
  ) FROM plugin_data.csf_sheet_import_rows r
  WHERE r.id = 'f9600000-0000-4000-8000-000000000008'
$$;
CREATE FUNCTION pg_temp.recorded_history_evidence()
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'credits', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM plugin_data.csf_credit_records c
      WHERE c.organization_id = 'f9100000-0000-4000-8000-000000000001'),
    'attendance', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM plugin_data.csf_meeting_attendance a
      WHERE a.organization_id = 'f9100000-0000-4000-8000-000000000001'),
    'events', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM plugin_data.csf_profile_activity_events e
      WHERE e.organization_id = 'f9100000-0000-4000-8000-000000000001')
  )
$$;
CREATE TEMP TABLE recorded_evidence_before AS SELECT pg_temp.recorded_history_evidence() AS evidence;
CREATE TEMP TABLE recorded_history_before AS
SELECT to_jsonb(m) AS membership FROM plugin_data.csf_term_memberships m
WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
  AND term_id = 'f9300000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  $$SELECT pg_temp.reimport_recorded_history(NULL)$$, '23514',
  'This semester already has a recorded outcome or application. Review it before replacing historical evidence.',
  'a changed-hash preview without completion cannot demote recorded history'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.reimport_recorded_history(false)$$, '23514',
  'This semester already has a recorded outcome or application. Review it before replacing historical evidence.',
  'an explicit negative result cannot replace recorded completion'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.reimport_recorded_history(true)$$, '23514',
  'This semester already has a recorded outcome or application. Review it before replacing historical evidence.',
  'an equal outcome cannot silently rewrite the recorded completion evidence'
);
SELECT extensions.is(
  (SELECT to_jsonb(m) FROM plugin_data.csf_term_memberships m
   WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
     AND term_id = 'f9300000-0000-4000-8000-000000000001'),
  (SELECT membership FROM recorded_history_before),
  'refused retries preserve the full membership including provenance and completion time'
);
SELECT extensions.is(
  (SELECT import_status FROM plugin_data.csf_sheet_import_rows
   WHERE id = 'f9600000-0000-4000-8000-000000000008'),
  'pending', 'refused retry does not record a successful row write'
);
SELECT extensions.is(pg_temp.recorded_history_evidence(),
  (SELECT evidence FROM recorded_evidence_before),
  'refused retries preserve imported credits, attendance, and activity evidence');
UPDATE plugin_data.csf_term_memberships SET status = 'not_completed', completed_at = NULL
WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
  AND term_id = 'f9300000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok(
  $$SELECT pg_temp.reimport_recorded_history(true)$$, '23514',
  'This semester already has a recorded outcome or application. Review it before replacing historical evidence.',
  'an import cannot silently reverse recorded non-completion'
);
UPDATE plugin_data.csf_term_memberships
SET status = 'active', override_status = 'completed',
    override_reason = 'Reviewed synthetic override.',
    overridden_by = 'f9000000-0000-4000-8000-000000000001', overridden_at = now()
WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
  AND term_id = 'f9300000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok(
  $$SELECT pg_temp.reimport_recorded_history(NULL)$$, '23514',
  'This semester already has a recorded outcome or application. Review it before replacing historical evidence.',
  'an officer override protects its evidence even when the base status is active'
);

UPDATE plugin_data.csf_term_memberships
SET status = 'active', override_status = NULL, override_reason = NULL,
    overridden_by = NULL, overridden_at = NULL
WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
  AND term_id = 'f9300000-0000-4000-8000-000000000001';
SELECT extensions.lives_ok(
  $$SELECT pg_temp.reimport_recorded_history(NULL)$$,
  'unreviewed active history remains writable through the approved import path'
);
-- A pending application can exist without a semester membership or account.
INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES (
  'f9710000-0000-4000-8000-000000000010',
  'f9100000-0000-4000-8000-000000000001',
  'Avery', 'Pending', 'avery', 'pending'
);
INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status
) VALUES (
  'f9810000-0000-4000-8000-000000000010',
  'f9100000-0000-4000-8000-000000000001',
  'f9710000-0000-4000-8000-000000000010',
  'f9200000-0000-4000-8000-000000000001',
  'f9300000-0000-4000-8000-000000000001', 'manual', 'submitted'
);
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, cohort_id, term_id,
  sheet_tab_name, row_number, normalized_data, row_hash,
  matched_profile_id, import_status
)
SELECT row_id, 'f9100000-0000-4000-8000-000000000001',
  'f9500000-0000-4000-8000-000000000005',
  'f9400000-0000-4000-8000-000000000001',
  'f9200000-0000-4000-8000-000000000001', term_id,
  tab_name, 10, '{"record":{"identity":{"firstName":"Avery","lastName":"Pending","sourceStudentKey":"PendingAvery"}}}',
  repeat('a',64), 'f9710000-0000-4000-8000-000000000010', 'pending'
FROM (VALUES
  ('f9600000-0000-4000-8000-000000000010'::uuid, 'f9300000-0000-4000-8000-000000000001'::uuid, 'F40'),
  ('f9600000-0000-4000-8000-000000000011'::uuid, 'f9300000-0000-4000-8000-000000000002'::uuid, 'S41')
) AS fixtures(row_id, term_id, tab_name);

SELECT extensions.is(
  (SELECT count(*) FROM plugin_data.csf_class_import_review_rows(
    'f9100000-0000-4000-8000-000000000001', 'f9500000-0000-4000-8000-000000000005', 50)
   WHERE id IN ('f9600000-0000-4000-8000-000000000010', 'f9600000-0000-4000-8000-000000000011')
     AND review_reason IS NULL),
  2::bigint, 'ready matched rows can be skipped without an intentional failed commit'
);
SELECT extensions.is(
  (SELECT count(*) FROM plugin_data.csf_class_import_review_rows(
    'f9100000-0000-4000-8000-000000000099', 'f9500000-0000-4000-8000-000000000005', 50)),
  0::bigint, 'a foreign organization cannot read another chapter preview'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'plugin_data.csf_class_import_review_rows(uuid,uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'plugin_data.csf_class_import_review_rows(uuid,uuid,integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'plugin_data.csf_class_import_review_rows(uuid,uuid,integer)', 'EXECUTE'),
  'preview row access remains server-only'
);
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, cohort_id, term_id,
  sheet_tab_name, row_number, normalized_data, row_hash, import_status
) VALUES (
  'f9600000-0000-4000-8000-000000000012', 'f9100000-0000-4000-8000-000000000001',
  'f9500000-0000-4000-8000-000000000005', 'f9400000-0000-4000-8000-000000000001',
  'f9200000-0000-4000-8000-000000000001', 'f9300000-0000-4000-8000-000000000001',
  'F40', 99, '{"record":{"identity":{"firstName":"Unknown","lastName":"Example"}}}',
  repeat('b',64), 'ambiguous'
);
SELECT extensions.ok(
  (SELECT array_position(array_agg(id), 'f9600000-0000-4000-8000-000000000012'::uuid)
      < array_position(array_agg(id), 'f9600000-0000-4000-8000-000000000010'::uuid)
   FROM plugin_data.csf_class_import_review_rows(
     'f9100000-0000-4000-8000-000000000001', 'f9500000-0000-4000-8000-000000000005', 50)),
  'unresolved rows sort before ready rows even with later sheet row numbers'
);

CREATE FUNCTION pg_temp.import_pending_application_history(p_row_id uuid, p_completion boolean)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT plugin_data.csf_import_class_history_row_v2(
    r.organization_id, r.matched_profile_id,
    'Avery', 'Pending', NULL, NULL, 'avery', 'pending', NULL, NULL,
    r.cohort_id, r.term_id, r.source_id, r.id, r.row_hash,
    '[]'::jsonb, '[]'::jsonb, p_completion,
    'f9000000-0000-4000-8000-000000000001'
  ) FROM plugin_data.csf_sheet_import_rows r WHERE r.id=p_row_id
$$;
CREATE TEMP TABLE pending_application_before AS
SELECT to_jsonb(a) AS application FROM plugin_data.csf_term_applications a
WHERE id='f9810000-0000-4000-8000-000000000010';

SELECT extensions.throws_ok(
  $$SELECT pg_temp.import_pending_application_history('f9600000-0000-4000-8000-000000000010', NULL)$$,
  '23514', 'This semester already has an application. Use application review instead of importing class history.',
  'an accountless pending applicant cannot gain an active membership from history'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.import_pending_application_history('f9600000-0000-4000-8000-000000000010', true)$$,
  '23514', 'This semester already has an application. Use application review instead of importing class history.',
  'a history completion marker cannot approve a pending application'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.import_pending_application_history('f9600000-0000-4000-8000-000000000010', false)$$,
  '23514', 'This semester already has an application. Use application review instead of importing class history.',
  'a negative history marker cannot decide a pending application'
);
SELECT extensions.is(
  (SELECT count(*) FROM plugin_data.csf_term_memberships WHERE profile_id='f9710000-0000-4000-8000-000000000010'),
  0::bigint, 'refused history creates no semester membership'
);
SELECT extensions.is(
  (SELECT to_jsonb(a) FROM plugin_data.csf_term_applications a WHERE id='f9810000-0000-4000-8000-000000000010'),
  (SELECT application FROM pending_application_before), 'refusal leaves the pending application unchanged'
);
SELECT extensions.is(
  (SELECT import_status FROM plugin_data.csf_sheet_import_rows WHERE id='f9600000-0000-4000-8000-000000000010'),
  'pending', 'refusal leaves the immutable preview available for an audited skip'
);
SELECT extensions.lives_ok(
  $$SELECT pg_temp.import_pending_application_history('f9600000-0000-4000-8000-000000000011', NULL)$$,
  'an application in another semester does not block legitimate history'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_term_memberships WHERE profile_id='f9710000-0000-4000-8000-000000000010'
   AND term_id='f9300000-0000-4000-8000-000000000002'),
  'active', 'an accountless profile retains its separate historical semester'
);
SELECT extensions.ok(
  NOT has_function_privilege('service_role',
    'plugin_data.csf_import_class_history_row_identity_base(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'plugin_data.csf_import_class_history_row_identity_base(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)', 'EXECUTE'),
  'application guard preserves the fenced import execution boundary'
);

SELECT * FROM extensions.finish();
ROLLBACK;
