BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(38);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'de000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'source-key-officer@local.test', now(),
  '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'de100000-0000-4000-8000-000000000001',
  'Source Key Commit Identity',
  'source-key-commit-identity',
  'school',
  '976501'
);

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES (
  'de100000-0000-4000-8000-000000000001',
  'de000000-0000-4000-8000-000000000001',
  'admin',
  'active'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES (
  'de200000-0000-4000-8000-000000000001',
  'de100000-0000-4000-8000-000000000001',
  2028,
  'Class of 2028'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester
) VALUES (
  'de210000-0000-4000-8000-000000000001',
  'de100000-0000-4000-8000-000000000001',
  'S26', 'Spring 2026', '2025-2026', 'spring'
);

INSERT INTO plugin_data.csf_cohort_terms (
  id, organization_id, cohort_id, term_id, grade_level, sheet_tab_name
) VALUES (
  'de220000-0000-4000-8000-000000000001',
  'de100000-0000-4000-8000-000000000001',
  'de200000-0000-4000-8000-000000000001',
  'de210000-0000-4000-8000-000000000001',
  10,
  'S26'
);

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, cohort_id, source_type, title, provider,
  spreadsheet_id, settings
) VALUES (
  'de230000-0000-4000-8000-000000000001',
  'de100000-0000-4000-8000-000000000001',
  'de200000-0000-4000-8000-000000000001',
  'class_history',
  'Official Class of 2028 workbook',
  'google_sheets',
  'official-workbook-2028',
  '{"sourceKind":"class_history"}'::jsonb
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, mode, status, source_type, source_file_id
) VALUES
  (
    'de300000-0000-4000-8000-000000000001',
    'de100000-0000-4000-8000-000000000001',
    'de230000-0000-4000-8000-000000000001',
    'preview', 'completed', 'class_history', 'official-workbook-2028'
  ),
  (
    'de300000-0000-4000-8000-000000000002',
    'de100000-0000-4000-8000-000000000001',
    'de230000-0000-4000-8000-000000000001',
    'preview', 'completed', 'class_history', 'official-workbook-2028'
  ),
  (
    'de300000-0000-4000-8000-000000000003',
    'de100000-0000-4000-8000-000000000001',
    'de230000-0000-4000-8000-000000000001',
    'preview', 'completed', 'class_history', 'different-workbook-2028'
  ),
  (
    'de300000-0000-4000-8000-000000000004',
    'de100000-0000-4000-8000-000000000001',
    'de230000-0000-4000-8000-000000000001',
    'preview', 'completed', 'class_history', 'official-workbook-2028'
  ),
  (
    'de300000-0000-4000-8000-000000000005',
    'de100000-0000-4000-8000-000000000001',
    'de230000-0000-4000-8000-000000000001',
    'preview', 'completed', 'class_history', 'official-workbook-2028'
  ),
  (
    'de300000-0000-4000-8000-000000000006',
    'de100000-0000-4000-8000-000000000001',
    'de230000-0000-4000-8000-000000000001',
    'preview', 'completed', 'class_history', 'official-workbook-2028'
  );

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  school_email, normalized_school_email
) VALUES (
  'de400000-0000-4000-8000-000000000001',
  'de100000-0000-4000-8000-000000000001',
  'Avery', 'Sample', 'avery', 'sample',
  'avery.sample@students.local.test',
  'avery.sample@students.local.test'
);

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, cohort_id, term_id,
  sheet_tab_name, row_number, normalized_data, row_hash,
  matched_profile_id, import_status
) VALUES
  (
    'de500000-0000-4000-8000-000000000001',
    'de100000-0000-4000-8000-000000000001',
    'de300000-0000-4000-8000-000000000001',
    'de230000-0000-4000-8000-000000000001',
    'de200000-0000-4000-8000-000000000001',
    'de210000-0000-4000-8000-000000000001',
    'F25', 2,
    '{"record":{"identity":{"firstName":"Avery","lastName":"Sample","normalizedFirstName":"avery","normalizedLastName":"sample","sourceStudentKey":"sampleavery"},"contact":{"schoolEmail":"avery.sample@students.local.test"}}}'::jsonb,
    repeat('1', 64),
    'de400000-0000-4000-8000-000000000001',
    'created'
  ),
  (
    'de500000-0000-4000-8000-000000000002',
    'de100000-0000-4000-8000-000000000001',
    'de300000-0000-4000-8000-000000000002',
    'de230000-0000-4000-8000-000000000001',
    'de200000-0000-4000-8000-000000000001',
    'de210000-0000-4000-8000-000000000001',
    'S26', 2,
    '{"record":{"identity":{"firstName":"Avery","lastName":"Sample","normalizedFirstName":"avery","normalizedLastName":"sample","sourceStudentKey":"Avery Sample"},"contact":{"schoolEmail":"avery.sample@students.local.test"}}}'::jsonb,
    repeat('2', 64),
    NULL,
    'pending'
  ),
  (
    'de500000-0000-4000-8000-000000000003',
    'de100000-0000-4000-8000-000000000001',
    'de300000-0000-4000-8000-000000000003',
    'de230000-0000-4000-8000-000000000001',
    'de200000-0000-4000-8000-000000000001',
    'de210000-0000-4000-8000-000000000001',
    'S26', 2,
    '{"record":{"identity":{"firstName":"Avery","lastName":"Sample","normalizedFirstName":"avery","normalizedLastName":"sample","sourceStudentKey":"averysample"}}}'::jsonb,
    repeat('3', 64),
    NULL,
    'pending'
  ),
  (
    'de500000-0000-4000-8000-000000000004',
    'de100000-0000-4000-8000-000000000001',
    'de300000-0000-4000-8000-000000000004',
    'de230000-0000-4000-8000-000000000001',
    'de200000-0000-4000-8000-000000000001',
    'de210000-0000-4000-8000-000000000001',
    'S26', 2,
    '{"record":{"identity":{"firstName":"Avery","lastName":"Sample","normalizedFirstName":"avery","normalizedLastName":"sample","sourceStudentKey":"differentstudent"}}}'::jsonb,
    repeat('4', 64),
    NULL,
    'pending'
  ),
  (
    'de500000-0000-4000-8000-000000000005',
    'de100000-0000-4000-8000-000000000001',
    'de300000-0000-4000-8000-000000000005',
    'de230000-0000-4000-8000-000000000001',
    'de200000-0000-4000-8000-000000000001',
    'de210000-0000-4000-8000-000000000001',
    'S26', 2,
    '{"annotations":{"4":{"background":"#b7e1cd"}},"record":{"identity":{"firstName":"Avery","lastName":"Sample","normalizedFirstName":"avery","normalizedLastName":"sample","sourceStudentKey":"averysample"},"contact":{"schoolEmail":"other.student@students.local.test"}}}'::jsonb,
    repeat('5', 64),
    NULL,
    'pending'
  ),
  (
    'de500000-0000-4000-8000-000000000007',
    'de100000-0000-4000-8000-000000000001',
    'de300000-0000-4000-8000-000000000006',
    'de230000-0000-4000-8000-000000000001',
    'de200000-0000-4000-8000-000000000001',
    'de210000-0000-4000-8000-000000000001',
    'S26', 3,
    '{"record":{"identity":{"firstName":"Avery","lastName":"Sample","normalizedFirstName":"avery","normalizedLastName":"sample","sourceStudentKey":"sampleavery"}}}'::jsonb,
    repeat('7', 64),
    NULL,
    'pending'
  );

SELECT extensions.has_function(
  'plugin_data', 'csf_class_import_review_rows',
  ARRAY['uuid', 'uuid', 'integer'], 'class identity review reader exists'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_class_import_review_rows(uuid,uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'plugin_data.csf_class_import_review_rows(uuid,uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'plugin_data.csf_class_import_review_rows(uuid,uuid,integer)', 'EXECUTE'),
  'only the backend can read protected review rows'
);
SELECT extensions.is(
  (SELECT count(*) FROM plugin_data.csf_class_import_review_rows(
    'de100000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000004', 25)),
  1::bigint, 'pending invalid source keys appear in officer review'
);
SELECT extensions.is(
  (SELECT review_reason FROM plugin_data.csf_class_import_review_rows(
    'de100000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000005', 25)),
  'identity_review', 'valid source keys with conflicting contact evidence remain reviewable'
);
SELECT extensions.is(
  (SELECT count(*) FROM plugin_data.csf_class_import_review_rows(
    'de100000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000003', 25)),
  0::bigint, 'valid new-workbook identities are not falsely added to review'
);
SELECT extensions.is(
  (SELECT count(*) FROM plugin_data.csf_class_import_review_rows(
    'de100000-0000-4000-8000-000000000002', 'de300000-0000-4000-8000-000000000004', 25)),
  0::bigint, 'another organization cannot read this job'
);
SELECT extensions.is(
  (SELECT count(*) FROM plugin_data.csf_class_import_review_rows(
    'de100000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000004', 0)),
  1::bigint, 'the requested limit is clamped to a usable bounded page'
);

SELECT extensions.has_function(
  'plugin_data',
  'csf_class_history_source_key_target',
  ARRAY['uuid', 'uuid'],
  'the internal source-key target lookup exists'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_class_history_source_key_target(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_class_history_source_key_target(uuid,uuid)',
    'EXECUTE'
  ),
  'the source-key target lookup remains owner-internal'
);

SELECT extensions.is(
  plugin_data.csf_class_history_source_key_target(
    'de100000-0000-4000-8000-000000000001',
    'de500000-0000-4000-8000-000000000002'
  ),
  'de400000-0000-4000-8000-000000000001'::uuid,
  'the same stable key in a later semester reuses the established profile'
);

SELECT extensions.is(
  plugin_data.csf_class_history_source_key_target(
    'de100000-0000-4000-8000-000000000001',
    'de500000-0000-4000-8000-000000000003'
  ),
  NULL::uuid,
  'a key from a different workbook cannot cross-link profiles'
);

SELECT extensions.is(
  plugin_data.csf_class_history_source_key_target(
    'de100000-0000-4000-8000-000000000001',
    'de500000-0000-4000-8000-000000000004'
  ),
  NULL::uuid,
  'a source key that does not match the row name cannot identify a profile'
);

SELECT extensions.is(
  plugin_data.csf_class_history_source_key_target(
    'de100000-0000-4000-8000-000000000001',
    'de500000-0000-4000-8000-000000000005'
  ),
  NULL::uuid,
  'conflicting canonical email evidence blocks source-key reuse'
);

SELECT extensions.is(
  plugin_data.csf_class_history_source_key_target(
    'de100000-0000-4000-8000-000000000001',
    'de500000-0000-4000-8000-000000000007'
  ),
  NULL::uuid,
  'an exact immutable workbook key cannot reuse a profile without contact corroboration'
);

SELECT extensions.is(
  plugin_data.csf_class_history_source_key_requires_review(
    'de100000-0000-4000-8000-000000000001',
    'de500000-0000-4000-8000-000000000007'
  ),
  true,
  'an exact immutable workbook key requires review when contact corroboration is absent'
);

SELECT extensions.is(
  (plugin_data.csf_import_preview_readiness(
    'de100000-0000-4000-8000-000000000001',
    'de300000-0000-4000-8000-000000000006'
  ) ->> 'pendingMissingMatch')::integer,
  1,
  'readiness blocks a later source-key row without contact corroboration'
);

SELECT extensions.is(
  (plugin_data.csf_import_preview_readiness(
    'de100000-0000-4000-8000-000000000001',
    'de300000-0000-4000-8000-000000000006'
  ) ->> 'pendingMissingSourceKey')::integer,
  0,
  'the accepted no-email row keeps its valid source key evidence'
);

SET LOCAL ROLE service_role;
SELECT extensions.is(
  (plugin_data.csf_import_preview_readiness(
    'de100000-0000-4000-8000-000000000001',
    'de300000-0000-4000-8000-000000000006'
  ) ->> 'pendingMissingMatch')::integer,
  1,
  'the server role reads the same contact-corroboration blocker'
);
RESET ROLE;

SELECT extensions.is(
  (plugin_data.csf_import_preview_readiness(
    'de100000-0000-4000-8000-000000000001',
    'de300000-0000-4000-8000-000000000002'
  ) ->> 'pendingMissingMatch')::integer,
  0,
  'a targetless class-history row with a stable key is batch-ready'
);

SELECT extensions.is(
  (plugin_data.csf_import_preview_readiness(
    'de100000-0000-4000-8000-000000000001',
    'de300000-0000-4000-8000-000000000002'
  ) ->> 'pendingMissingSourceKey')::integer,
  0,
  'stable keyed class history has no source-key blocker'
);

SELECT extensions.is(
  (plugin_data.csf_import_preview_readiness(
    'de100000-0000-4000-8000-000000000001',
    'de300000-0000-4000-8000-000000000004'
  ) ->> 'pendingMissingMatch')::integer,
  1,
  'an invalid targetless class-history key remains blocked'
);

SELECT extensions.is(
  (plugin_data.csf_import_preview_readiness(
    'de100000-0000-4000-8000-000000000001',
    'de300000-0000-4000-8000-000000000004'
  ) ->> 'pendingMissingSourceKey')::integer,
  1,
  'the readiness receipt names the missing stable-key blocker'
);

SELECT extensions.is(
  plugin_data.csf_class_history_source_key_target(
    'de100000-0000-4000-8000-000000000099',
    'de500000-0000-4000-8000-000000000002'
  ),
  NULL::uuid,
  'the target lookup cannot cross organizations'
);

CREATE TEMP TABLE source_key_batch_receipt (value jsonb NOT NULL);
INSERT INTO source_key_batch_receipt
SELECT plugin_data.csf_queue_import_preview_batch(
  'de100000-0000-4000-8000-000000000001',
  'de000000-0000-4000-8000-000000000001',
  ARRAY[
    'de300000-0000-4000-8000-000000000002',
    'de300000-0000-4000-8000-000000000004'
  ]::uuid[],
  'de600000-0000-4000-8000-000000000001'
);

SELECT extensions.is(
  (SELECT (value ->> 'queued')::integer FROM source_key_batch_receipt),
  1,
  'batch approval queues the stable keyed class-history preview'
);

SELECT extensions.is(
  (SELECT (value ->> 'blocked')::integer FROM source_key_batch_receipt),
  1,
  'batch approval keeps the invalid class-history key blocked'
);

SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer
   FROM plugin_data.csf_import_commit_queue
   WHERE organization_id = 'de100000-0000-4000-8000-000000000001'),
  1,
  'only the stable keyed preview enters the commit queue'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_import_class_history_row_v2(
    'de100000-0000-4000-8000-000000000001',
    NULL,
    'Avery', 'Sample',
    'avery.sample@students.local.test', NULL,
    'avery', 'sample',
    'avery.sample@students.local.test', NULL,
    'de200000-0000-4000-8000-000000000001',
    'de210000-0000-4000-8000-000000000001',
    'de230000-0000-4000-8000-000000000001',
    'de500000-0000-4000-8000-000000000002',
    repeat('2', 64),
    '[{"slot":"activity_1","label":"Service project","value":"Service project","points":1}]'::jsonb,
    '[]'::jsonb,
    true,
    'de000000-0000-4000-8000-000000000001'
  )$$,
  'the class-history write reuses the stable-key profile'
);

SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer
   FROM plugin_data.csf_profiles
   WHERE organization_id = 'de100000-0000-4000-8000-000000000001'),
  1,
  'reusing a workbook key creates no duplicate profile'
);

SELECT extensions.is(
  (SELECT matched_profile_id
   FROM plugin_data.csf_sheet_import_rows
   WHERE id = 'de500000-0000-4000-8000-000000000002'),
  'de400000-0000-4000-8000-000000000001'::uuid,
  'the committed semester row records the reused profile'
);

SELECT extensions.lives_ok($q$SELECT plugin_data.csf_review_import_annotation(
  'de100000-0000-4000-8000-000000000001','de000000-0000-4000-8000-000000000001',
  'de500000-0000-4000-8000-000000000005','de600000-0000-4000-8000-000000000001',
  'exception_met','Officer reviewed the fictional semester annotation.')$q$,
  'a conflicting valid key permits a separate annotation decision');
SELECT extensions.is((plugin_data.csf_import_preview_readiness(
  'de100000-0000-4000-8000-000000000001','de300000-0000-4000-8000-000000000005')->>'pendingMissingMatch')::integer,
  1,'annotation review does not clear an unresolved identity blocker');
SELECT extensions.lives_ok($q$SELECT plugin_data.csf_reconcile_sheet_import_row(
  'de100000-0000-4000-8000-000000000001','de500000-0000-4000-8000-000000000005',
  'de400000-0000-4000-8000-000000000001','match','Officer checked the stable workbook lineage.',
  'de000000-0000-4000-8000-000000000001',NULL,NULL)$q$,
  'an officer can resolve the pending identity blocker shown by Settings');
SELECT extensions.ok((SELECT matched_profile_id='de400000-0000-4000-8000-000000000001'::uuid
  AND resolution_status='resolved' AND import_status='pending'
  AND normalized_data->'record'->'contact'->>'schoolEmail'='other.student@students.local.test'
  FROM plugin_data.csf_sheet_import_rows WHERE id='de500000-0000-4000-8000-000000000005'),
  'matching records the decision without rewriting conflicting source evidence');
SELECT extensions.is((SELECT resolution_reason_code FROM plugin_data.csf_sheet_import_rows
  WHERE id='de500000-0000-4000-8000-000000000005'),'annotation_exception_met',
  'matching a conflicting valid key retains its reviewed semester outcome');
SELECT extensions.is((plugin_data.csf_import_preview_readiness(
  'de100000-0000-4000-8000-000000000001','de300000-0000-4000-8000-000000000005')->>'pendingMissingMatch')::integer,
  0,'the resolved blocker clears authoritative readiness');
SELECT extensions.is(plugin_data.csf_reconcile_sheet_import_row(
  'de100000-0000-4000-8000-000000000001','de500000-0000-4000-8000-000000000005',
  'de400000-0000-4000-8000-000000000001','match','Officer checked the stable workbook lineage.',
  'de000000-0000-4000-8000-000000000001',NULL,NULL)->>'idempotent','true',
  'retrying the same match does not write another decision');
SELECT extensions.throws_like($q$SELECT plugin_data.csf_reconcile_sheet_import_row(
  'de100000-0000-4000-8000-000000000001','de500000-0000-4000-8000-000000000003',
  'de400000-0000-4000-8000-000000000001','match','This row is not identity blocked.',
  'de000000-0000-4000-8000-000000000001',NULL,NULL)$q$,
  '%no longer needs a matching decision%','ordinary new-profile pending rows do not acquire a match override');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES (
  'de400000-0000-4000-8000-000000000002',
  'de100000-0000-4000-8000-000000000001',
  'Avery', 'Sample', 'avery', 'sample'
);
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, cohort_id, term_id,
  sheet_tab_name, row_number, normalized_data, row_hash,
  matched_profile_id, import_status
) VALUES (
  'de500000-0000-4000-8000-000000000006',
  'de100000-0000-4000-8000-000000000001',
  'de300000-0000-4000-8000-000000000001',
  'de230000-0000-4000-8000-000000000001',
  'de200000-0000-4000-8000-000000000001',
  'de210000-0000-4000-8000-000000000001',
  'F25', 3,
  '{"record":{"identity":{"firstName":"Avery","lastName":"Sample","normalizedFirstName":"avery","normalizedLastName":"sample","sourceStudentKey":"averysample"}}}'::jsonb,
  repeat('6', 64),
  'de400000-0000-4000-8000-000000000002',
  'created'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_class_history_source_key_target(
    'de100000-0000-4000-8000-000000000001',
    'de500000-0000-4000-8000-000000000002'
  )$$,
  '23514',
  'This workbook key already points to more than one CSF profile. Merge or resolve those profiles before importing another semester.',
  'an already duplicated workbook key stops for officer cleanup'
);

SELECT * FROM extensions.finish();
ROLLBACK;
