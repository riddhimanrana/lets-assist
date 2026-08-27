BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(12);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_profile_merge_preview_source_identity_base(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'the service role cannot bypass source-backed identity checks through the prior preview'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_profile_merge_preview(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'the service role can call the source-aware canonical preview'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_profile_merge_preview(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'browser-authenticated users cannot call the private preview directly'
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'aa100000-0000-4000-8000-000000000001',
  'Source-backed merge test',
  'source-backed-merge-test',
  'school',
  '981219'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES (
  'aa200000-0000-4000-8000-000000000001',
  'aa100000-0000-4000-8000-000000000001',
  2034,
  'Class of 2034'
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, mode, status, source_type, source_file_id
) VALUES
  (
    'aa300000-0000-4000-8000-000000000001',
    'aa100000-0000-4000-8000-000000000001',
    'preview', 'completed', 'class_history', 'official-class-sheet'
  ),
  (
    'aa300000-0000-4000-8000-000000000002',
    'aa100000-0000-4000-8000-000000000001',
    'preview', 'completed', 'class_history', 'replacement-class-sheet'
  ),
  (
    'aa300000-0000-4000-8000-000000000003',
    'aa100000-0000-4000-8000-000000000001',
    'preview', 'completed', 'class_history', 'official-class-sheet'
  );

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, sheet_tab_name, row_number, import_status
) VALUES
  ('aa400000-0000-4000-8000-000000000001', 'aa100000-0000-4000-8000-000000000001', 'aa300000-0000-4000-8000-000000000001', 'F24', 7, 'created'),
  ('aa400000-0000-4000-8000-000000000002', 'aa100000-0000-4000-8000-000000000001', 'aa300000-0000-4000-8000-000000000001', 'F25', 8, 'created'),
  ('aa400000-0000-4000-8000-000000000003', 'aa100000-0000-4000-8000-000000000001', 'aa300000-0000-4000-8000-000000000002', 'S25', 9, 'created'),
  ('aa400000-0000-4000-8000-000000000004', 'aa100000-0000-4000-8000-000000000001', 'aa300000-0000-4000-8000-000000000001', 'F24', 10, 'created'),
  ('aa400000-0000-4000-8000-000000000005', 'aa100000-0000-4000-8000-000000000001', 'aa300000-0000-4000-8000-000000000003', 'F24', 7, 'created'),
  ('aa400000-0000-4000-8000-000000000006', 'aa100000-0000-4000-8000-000000000001', 'aa300000-0000-4000-8000-000000000001', 'S26', 11, 'created');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  school_email, normalized_school_email, source_summary
) VALUES
  ('aa500000-0000-4000-8000-000000000001', 'aa100000-0000-4000-8000-000000000001', 'Sample', 'Member', 'sample', 'member', NULL, NULL, '{"importedFrom":"csf_sheet_sync","importRowId":"aa400000-0000-4000-8000-000000000001"}'),
  ('aa500000-0000-4000-8000-000000000002', 'aa100000-0000-4000-8000-000000000001', 'Sample', 'Member', 'sample', 'member', NULL, NULL, '{"importedFrom":"csf_sheet_sync","importRowId":"aa400000-0000-4000-8000-000000000002"}'),
  ('aa500000-0000-4000-8000-000000000003', 'aa100000-0000-4000-8000-000000000001', 'Sample', 'Member', 'sample', 'member', NULL, NULL, '{"importedFrom":"csf_sheet_sync","importRowId":"aa400000-0000-4000-8000-000000000003"}'),
  ('aa500000-0000-4000-8000-000000000004', 'aa100000-0000-4000-8000-000000000001', 'Sample', 'Member', 'sample', 'member', NULL, NULL, '{"importedFrom":"csf_sheet_sync","importRowId":"aa400000-0000-4000-8000-000000000004"}'),
  ('aa500000-0000-4000-8000-000000000005', 'aa100000-0000-4000-8000-000000000001', 'Sample', 'Member', 'sample', 'member', NULL, NULL, '{"importedFrom":"csf_sheet_sync","importRowId":"aa400000-0000-4000-8000-000000000005"}'),
  ('aa500000-0000-4000-8000-000000000006', 'aa100000-0000-4000-8000-000000000001', 'Sample', 'Member', 'sample', 'member', 'different@local.test', 'different@local.test', '{"importedFrom":"csf_sheet_sync","importRowId":"aa400000-0000-4000-8000-000000000006"}');

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
)
SELECT
  'aa100000-0000-4000-8000-000000000001',
  profile.id,
  'aa200000-0000-4000-8000-000000000001',
  'active'
FROM plugin_data.csf_profiles AS profile
WHERE profile.organization_id = 'aa100000-0000-4000-8000-000000000001';

SELECT extensions.ok(
  (plugin_data.csf_profile_merge_preview(
    'aa100000-0000-4000-8000-000000000001',
    'aa500000-0000-4000-8000-000000000002',
    'aa500000-0000-4000-8000-000000000001'
  )->>'canMerge')::boolean,
  'non-overlapping records from separate tabs of one official workbook are ready'
);
SELECT extensions.ok(
  (plugin_data.csf_profile_merge_preview(
    'aa100000-0000-4000-8000-000000000001',
    'aa500000-0000-4000-8000-000000000002',
    'aa500000-0000-4000-8000-000000000001'
  )->'identityEvidence'->>'sourceBackedWorkbookMatch')::boolean,
  'the preview records the source-backed identity evidence'
);
SELECT extensions.ok(
  NOT jsonb_path_exists(
    plugin_data.csf_profile_merge_preview(
      'aa100000-0000-4000-8000-000000000001',
      'aa500000-0000-4000-8000-000000000002',
      'aa500000-0000-4000-8000-000000000001'
    ),
    '$.conflicts[*] ? (@.type == "identity_email_missing")'
  ),
  'same-workbook evidence removes only the missing-email blocker'
);
SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'aa100000-0000-4000-8000-000000000001',
    'aa500000-0000-4000-8000-000000000003',
    'aa500000-0000-4000-8000-000000000001'
  )->>'canMerge')::boolean,
  'records from different workbook identities remain blocked'
);
SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'aa100000-0000-4000-8000-000000000001',
    'aa500000-0000-4000-8000-000000000004',
    'aa500000-0000-4000-8000-000000000001'
  )->>'canMerge')::boolean,
  'different rows in one tab remain blocked'
);
SELECT extensions.ok(
  (plugin_data.csf_profile_merge_preview(
    'aa100000-0000-4000-8000-000000000001',
    'aa500000-0000-4000-8000-000000000005',
    'aa500000-0000-4000-8000-000000000001'
  )->>'canMerge')::boolean,
  'an exact repeated workbook coordinate is recognized as the same source identity'
);
SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'aa100000-0000-4000-8000-000000000001',
    'aa500000-0000-4000-8000-000000000006',
    'aa500000-0000-4000-8000-000000000001'
  )->>'canMerge')::boolean,
  'a contact-bearing record never receives the source-only identity exception'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester
) VALUES (
  'aa600000-0000-4000-8000-000000000001',
  'aa100000-0000-4000-8000-000000000001',
  'F24', 'Fall 2024', '2024-2025', 'fall'
);
INSERT INTO plugin_data.csf_term_memberships (
  organization_id, profile_id, term_id, cohort_id, status
) VALUES
  ('aa100000-0000-4000-8000-000000000001', 'aa500000-0000-4000-8000-000000000001', 'aa600000-0000-4000-8000-000000000001', 'aa200000-0000-4000-8000-000000000001', 'active'),
  ('aa100000-0000-4000-8000-000000000001', 'aa500000-0000-4000-8000-000000000002', 'aa600000-0000-4000-8000-000000000001', 'aa200000-0000-4000-8000-000000000001', 'active');

SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'aa100000-0000-4000-8000-000000000001',
    'aa500000-0000-4000-8000-000000000002',
    'aa500000-0000-4000-8000-000000000001'
  )->>'canMerge')::boolean,
  'same-workbook identity never overrides an overlapping semester conflict'
);
SELECT extensions.ok(
  jsonb_path_exists(
    plugin_data.csf_profile_merge_preview(
      'aa100000-0000-4000-8000-000000000001',
      'aa500000-0000-4000-8000-000000000002',
      'aa500000-0000-4000-8000-000000000001'
    ),
    '$.conflicts[*] ? (@.type == "term_membership")'
  ),
  'the preview retains the exact overlapping-semester blocker'
);

SELECT * FROM extensions.finish();
ROLLBACK;
